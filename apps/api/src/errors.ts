import type { FastifyError, FastifyInstance } from 'fastify';
import type { z } from 'zod';

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'CONFLICT', message, details);
export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);

export function zodDetails(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
}

/** Parse with a Zod schema, converting failures into a 400 validation error. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Some fields are invalid.',
      zodDetails(result.error),
    );
  }
  return result.data;
}

const PG_UNIQUE = '23505';
const PG_FK = '23503';

export function registerErrorHandler(
  app: FastifyInstance,
  opts: { spa: boolean } = { spa: false },
): void {
  app.setErrorHandler((error: FastifyError | AppError | Error, request, reply) => {
    const requestId = request.id;
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
        requestId,
      });
    }
    // Drizzle wraps driver errors; the PostgreSQL SQLSTATE may be on `cause`.
    const pgCode =
      (error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code;
    if (pgCode === PG_UNIQUE) {
      return reply.status(409).send({
        error: { code: 'CONFLICT', message: 'An item with that name already exists.' },
        requestId,
      });
    }
    if (pgCode === PG_FK) {
      return reply.status(409).send({
        error: { code: 'IN_USE', message: 'This item is referenced by other records.' },
        requestId,
      });
    }
    const fe = error as FastifyError;
    if (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500) {
      const code =
        fe.statusCode === 429
          ? 'RATE_LIMITED'
          : fe.statusCode === 413
            ? 'PAYLOAD_TOO_LARGE'
            : 'BAD_REQUEST';
      const message =
        fe.statusCode === 429
          ? 'Too many requests. Please wait and try again.'
          : fe.statusCode === 413
            ? 'Request is too large.'
            : 'The request could not be processed.';
      return reply.status(fe.statusCode).send({ error: { code, message }, requestId });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply
      .status(500)
      .send({ error: { code: 'INTERNAL', message: 'Something went wrong.' }, requestId });
  });

  app.setNotFoundHandler((request, reply) => {
    // SPA fallback: unknown GET paths outside /api serve the app shell (client-side routing).
    if (opts.spa && request.method === 'GET' && !request.url.startsWith('/api/')) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply
      .status(404)
      .send({ error: { code: 'NOT_FOUND', message: 'Route not found.' }, requestId: request.id });
  });
}
