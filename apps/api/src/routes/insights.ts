import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { analyticsQuerySchema } from '@recall/shared';
import type { AppDeps } from '../app.js';
import { requireAuth } from '../app.js';
import { parse } from '../errors.js';
import { getAnalytics, getDashboard } from '../services/analytics.js';

const tzQuery = z.object({ tz: z.string().max(64).optional() });

export async function insightRoutes(app: FastifyInstance, { database }: AppDeps): Promise<void> {
  const { db } = database;

  app.get('/dashboard', async (request) => {
    const { tz } = parse(tzQuery.loose(), request.query);
    return getDashboard(db, requireAuth(request).ownerId, tz);
  });

  app.get('/analytics', async (request) => {
    const query = parse(analyticsQuerySchema.extend(tzQuery.shape), request.query);
    return getAnalytics(db, requireAuth(request).ownerId, query, query.tz);
  });
}
