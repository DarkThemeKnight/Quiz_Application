import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  DEFAULT_PREFERENCES,
  changePasswordSchema,
  loginSchema,
  profileUpdateSchema,
  type AuthSessionInfo,
  type Me,
} from '@recall/shared';
import type { AppDeps } from '../app.js';
import { requireAuth } from '../app.js';
import { authSessions, owners } from '../db/schema.js';
import { AppError, notFound, parse } from '../errors.js';
import {
  burnVerification,
  hashPassword,
  passwordProblems,
  verifyPassword,
} from '../auth/password.js';
import {
  createAuthSession,
  revokeAllAuthSessions,
  revokeAuthSession,
  SESSION_COOKIE,
} from '../auth/sessions.js';

/** Per-username lockout in addition to per-IP rate limiting. In-memory: single local process. */
const FAILURE_LIMIT = 10;
const LOCKOUT_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; lockedUntil: number }>();

export function resetLoginFailures(): void {
  failures.clear();
}

export async function authRoutes(
  app: FastifyInstance,
  { config, database }: AppDeps,
): Promise<void> {
  const { db } = database;

  const setCookie = (reply: FastifyReply, token: string, expiresAt: Date) =>
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'strict',
      path: '/',
      expires: expiresAt,
    });
  const clearCookie = (reply: FastifyReply) =>
    reply.clearCookie(SESSION_COOKIE, {
      path: '/',
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'strict',
    });

  async function loadMe(ownerId: string): Promise<Me> {
    const [owner] = await db.select().from(owners).where(eq(owners.id, ownerId));
    if (!owner) throw notFound('Owner');
    return {
      id: owner.id,
      username: owner.username,
      displayName: owner.displayName || owner.username,
      preferences: { ...DEFAULT_PREFERENCES, ...owner.preferences },
    };
  }

  app.get('/auth/status', async (request) => {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(owners);
    return { ownerConfigured: (row?.n ?? 0) > 0, authenticated: request.auth !== null };
  });

  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = parse(loginSchema, request.body);
      const key = body.username.toLowerCase();
      const state = failures.get(key);
      if (state && state.lockedUntil > Date.now()) {
        throw new AppError(429, 'LOCKED', 'Too many failed attempts. Try again in a few minutes.');
      }
      const [owner] = await db
        .select()
        .from(owners)
        .where(sql`lower(${owners.username}) = ${key}`);
      const ok = owner
        ? await verifyPassword(owner.passwordHash, body.password)
        : (await burnVerification(body.password), false);
      if (!owner || !ok) {
        const next = { count: (state?.count ?? 0) + 1, lockedUntil: 0 };
        if (next.count >= FAILURE_LIMIT) {
          next.lockedUntil = Date.now() + LOCKOUT_MS;
          next.count = 0;
        }
        failures.set(key, next);
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Username or password is incorrect.');
      }
      failures.delete(key);
      const { token, expiresAt } = await createAuthSession(db, {
        ownerId: owner.id,
        secret: config.sessionSecret,
        ttlMs: config.sessionTtlMs,
        userAgent: request.headers['user-agent'] ?? '',
      });
      setCookie(reply, token, expiresAt);
      return loadMe(owner.id);
    },
  );

  app.post('/auth/logout', async (request, reply) => {
    if (request.auth) await revokeAuthSession(db, request.auth.sessionId);
    clearCookie(reply);
    return { ok: true };
  });

  app.get('/auth/me', async (request) => loadMe(requireAuth(request).ownerId));

  app.patch('/auth/me', async (request) => {
    const auth = requireAuth(request);
    const body = parse(profileUpdateSchema, request.body);
    const current = await loadMe(auth.ownerId);
    await db
      .update(owners)
      .set({
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.preferences
          ? { preferences: { ...current.preferences, ...body.preferences } }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(owners.id, auth.ownerId));
    return loadMe(auth.ownerId);
  });

  app.post(
    '/auth/password',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request) => {
      const auth = requireAuth(request);
      const body = parse(changePasswordSchema, request.body);
      const [owner] = await db.select().from(owners).where(eq(owners.id, auth.ownerId));
      if (!owner || !(await verifyPassword(owner.passwordHash, body.currentPassword))) {
        throw new AppError(400, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
      }
      const problems = passwordProblems(body.newPassword, owner.username);
      if (problems.length) throw new AppError(400, 'WEAK_PASSWORD', problems.join(' '));
      await db
        .update(owners)
        .set({
          passwordHash: await hashPassword(body.newPassword),
          passwordChangedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(owners.id, owner.id));
      await revokeAllAuthSessions(db, owner.id, auth.sessionId);
      return { ok: true };
    },
  );

  app.get('/auth/sessions', async (request): Promise<AuthSessionInfo[]> => {
    const auth = requireAuth(request);
    const rows = await db
      .select()
      .from(authSessions)
      .where(
        and(
          eq(authSessions.ownerId, auth.ownerId),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, sql`now()`),
        ),
      )
      .orderBy(desc(authSessions.lastUsedAt));
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      userAgent: r.userAgent,
      current: r.id === auth.sessionId,
    }));
  });

  app.delete('/auth/sessions/:id', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.uuid() }), request.params);
    await db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(authSessions.id, id), eq(authSessions.ownerId, auth.ownerId)));
    return { ok: true };
  });

  app.post('/auth/sessions/revoke-others', async (request) => {
    const auth = requireAuth(request);
    await revokeAllAuthSessions(db, auth.ownerId, auth.sessionId);
    return { ok: true };
  });
}
