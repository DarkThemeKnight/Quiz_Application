import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  answerPutSchema,
  historyQuerySchema,
  itemFlagsSchema,
  sessionCreateSchema,
  sessionProgressSchema,
} from '@recall/shared';
import type { AppDeps } from '../app.js';
import { requireAuth } from '../app.js';
import { parse } from '../errors.js';
import {
  abandonSession,
  createSession,
  getResult,
  getSession,
  listSessions,
  saveAnswer,
  submitSession,
  updateItemFlags,
  updateProgress,
} from '../services/sessions.js';
import { scheduleForReview } from '../services/owner.js';

const idParam = z.object({ id: z.uuid() });
const itemParam = z.object({ id: z.uuid(), itemId: z.uuid() });

export async function sessionRoutes(app: FastifyInstance, { database }: AppDeps): Promise<void> {
  const { db } = database;

  app.get('/sessions', async (request) =>
    listSessions(db, requireAuth(request).ownerId, parse(historyQuerySchema, request.query)),
  );

  app.post('/sessions', async (request, reply) => {
    const auth = requireAuth(request);
    const id = await createSession(db, auth.ownerId, parse(sessionCreateSchema, request.body));
    return reply.status(201).send(await getSession(db, auth.ownerId, id));
  });

  app.get('/sessions/:id', async (request) =>
    getSession(db, requireAuth(request).ownerId, parse(idParam, request.params).id),
  );

  app.put('/sessions/:id/items/:itemId/answer', async (request) => {
    const { id, itemId } = parse(itemParam, request.params);
    return saveAnswer(
      db,
      requireAuth(request).ownerId,
      id,
      itemId,
      parse(answerPutSchema, request.body),
    );
  });

  app.patch('/sessions/:id/items/:itemId', async (request) => {
    const { id, itemId } = parse(itemParam, request.params);
    return updateItemFlags(
      db,
      requireAuth(request).ownerId,
      id,
      itemId,
      parse(itemFlagsSchema, request.body),
    );
  });

  app.put('/sessions/:id/progress', async (request) => {
    const { id } = parse(idParam, request.params);
    await updateProgress(
      db,
      requireAuth(request).ownerId,
      id,
      parse(sessionProgressSchema, request.body).currentPosition,
    );
    return { ok: true };
  });

  app.post('/sessions/:id/submit', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(idParam, request.params);
    await submitSession(db, auth.ownerId, id, 'manual');
    return getResult(db, auth.ownerId, id);
  });

  app.post('/sessions/:id/abandon', async (request) => {
    const { id } = parse(idParam, request.params);
    await abandonSession(db, requireAuth(request).ownerId, id);
    return { ok: true };
  });

  app.get('/sessions/:id/result', async (request) =>
    getResult(db, requireAuth(request).ownerId, parse(idParam, request.params).id),
  );

  app.post('/review/schedule', async (request) => {
    const body = parse(
      z.object({ questionIds: z.array(z.uuid()).min(1).max(500) }).strict(),
      request.body,
    );
    return {
      scheduled: await scheduleForReview(db, requireAuth(request).ownerId, body.questionIds),
    };
  });
}
