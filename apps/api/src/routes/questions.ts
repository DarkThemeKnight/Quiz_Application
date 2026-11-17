import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { questionInputSchema, questionListQuerySchema } from '@recall/shared';
import type { AppDeps } from '../app.js';
import { parse } from '../errors.js';
import {
  createQuestion,
  deleteQuestion,
  findDuplicates,
  getQuestion,
  listQuestions,
  questionStats,
  setArchived,
  updateQuestion,
} from '../services/questions.js';

const idParam = z.object({ id: z.uuid() });

export async function questionRoutes(app: FastifyInstance, { database }: AppDeps): Promise<void> {
  const { db } = database;

  app.get('/questions', async (request) =>
    listQuestions(db, parse(questionListQuerySchema, request.query)),
  );
  app.get('/questions/stats', async () => questionStats(db));

  app.post('/questions/duplicates', async (request) => {
    const body = parse(
      z.object({ body: z.string().max(5000), excludeId: z.uuid().optional() }).strict(),
      request.body,
    );
    return findDuplicates(db, body.body, body.excludeId);
  });

  app.get('/questions/:id', async (request) => getQuestion(db, parse(idParam, request.params).id));

  app.post('/questions', async (request, reply) => {
    const input = parse(questionInputSchema, request.body);
    const id = await createQuestion(db, input);
    return reply.status(201).send(await getQuestion(db, id));
  });

  app.put('/questions/:id', async (request) => {
    const { id } = parse(idParam, request.params);
    await updateQuestion(db, id, parse(questionInputSchema, request.body));
    return getQuestion(db, id);
  });

  app.post('/questions/:id/archive', async (request) => {
    const { id } = parse(idParam, request.params);
    await setArchived(db, id, true);
    return getQuestion(db, id);
  });

  app.post('/questions/:id/restore', async (request) => {
    const { id } = parse(idParam, request.params);
    await setArchived(db, id, false);
    return getQuestion(db, id);
  });

  app.delete('/questions/:id', async (request) => {
    await deleteQuestion(db, parse(idParam, request.params).id);
    return { ok: true };
  });
}
