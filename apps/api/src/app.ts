import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import { AppError, registerErrorHandler } from './errors.js';
import { resolveAuthSession, SESSION_COOKIE, type AuthContext } from './auth/sessions.js';
import { authRoutes } from './routes/auth.js';
import { taxonomyRoutes } from './routes/taxonomy.js';
import { questionRoutes } from './routes/questions.js';
import { sessionRoutes } from './routes/sessions.js';
import { insightRoutes } from './routes/insights.js';
import { dataRoutes } from './routes/data.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export interface AppDeps {
  config: AppConfig;
  database: Database;
}

/** Routes reachable without a session. Everything else under /api requires authentication. */
const PUBLIC_ROUTES = new Set([
  'GET /api/health',
  'GET /api/auth/status',
  'POST /api/auth/login',
  'POST /api/auth/logout',
]);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in.');
  return request.auth;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    trustProxy: config.trustProxy,
    bodyLimit: 1_000_000,
    genReqId: () => crypto.randomUUID(),
    logger:
      config.logLevel === 'silent'
        ? false
        : {
            level: config.logLevel,
            // Never log credentials, cookies or request bodies (answers, imports).
            redact: {
              paths: [
                'req.headers.cookie',
                'req.headers.authorization',
                'res.headers["set-cookie"]',
                'body',
                'password',
              ],
              censor: '[redacted]',
            },
            serializers: {
              req: (req: FastifyRequest) => ({
                method: req.method,
                url: req.url.split('?')[0],
                id: req.id,
              }),
            },
          },
  });

  const spa = config.env !== 'test' && existsSync(config.webDistDir);
  registerErrorHandler(app, { spa });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });

  app.decorateRequest('auth', null);

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    if (_request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/')) return;
    // Cross-site request protection for state-changing calls: exact Origin match required.
    if (!SAFE_METHODS.has(request.method)) {
      const origin = request.headers.origin;
      if (!origin || !config.allowedOrigins.includes(origin)) {
        throw new AppError(403, 'BAD_ORIGIN', 'Request origin is not allowed.');
      }
    }
    const token = request.cookies[SESSION_COOKIE];
    if (token)
      request.auth = await resolveAuthSession(deps.database.db, config.sessionSecret, token);
    const routeKey = `${request.method} ${request.url.split('?')[0]}`;
    if (!PUBLIC_ROUTES.has(routeKey) && !request.auth) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in.');
    }
  });

  app.get('/api/health', async () => {
    await deps.database.pool.query('select 1');
    return { ok: true };
  });

  await app.register(async (api) => authRoutes(api, deps), { prefix: '/api' });
  await app.register(async (api) => taxonomyRoutes(api, deps), { prefix: '/api' });
  await app.register(async (api) => questionRoutes(api, deps), { prefix: '/api' });
  await app.register(async (api) => sessionRoutes(api, deps), { prefix: '/api' });
  await app.register(async (api) => insightRoutes(api, deps), { prefix: '/api' });
  await app.register(async (api) => dataRoutes(api, deps), { prefix: '/api' });

  // Production: serve the built SPA from the same origin.
  if (spa) {
    await app.register(fastifyStatic, {
      root: config.webDistDir,
      wildcard: false,
      index: ['index.html'],
    });
  }
  return app;
}
