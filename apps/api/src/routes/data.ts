import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { importRequestSchema } from '@recall/shared';
import type { AppDeps } from '../app.js';
import { requireAuth } from '../app.js';
import { REPO_ROOT } from '../config.js';
import { parse } from '../errors.js';
import {
  commitImport,
  exportBank,
  exportBankCsv,
  exportProgress,
  previewImport,
} from '../services/importer.js';

const IMPORT_BODY_LIMIT = 6_000_000;
export const SAMPLE_BANK_PATH = resolve(REPO_ROOT, 'examples/sample_bank.json');

const stamp = () => new Date().toISOString().slice(0, 10);

export async function dataRoutes(app: FastifyInstance, { database }: AppDeps): Promise<void> {
  const { db } = database;

  app.post('/import/questions/validate', { bodyLimit: IMPORT_BODY_LIMIT }, async (request) =>
    previewImport(db, parse(importRequestSchema, request.body)),
  );

  app.post(
    '/import/questions/commit',
    { bodyLimit: IMPORT_BODY_LIMIT, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => commitImport(db, parse(importRequestSchema, request.body)),
  );

  /** Loads the neutral, clearly-labelled sample bank shipped in examples/. Idempotent. */
  app.post('/import/sample', async () => {
    const content = readFileSync(SAMPLE_BANK_PATH, 'utf8');
    return commitImport(db, { format: 'json', content, duplicates: 'skip' });
  });

  app.get('/export/questions', async (request, reply) => {
    const q = parse(
      z.object({
        format: z.enum(['json', 'csv']).default('json'),
        includeArchived: z.enum(['true', 'false']).default('false'),
      }),
      request.query,
    );
    const includeArchived = q.includeArchived === 'true';
    if (q.format === 'csv') {
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="recall-question-bank-${stamp()}.csv"`)
        .send(await exportBankCsv(db, includeArchived));
    }
    return reply
      .header('Content-Disposition', `attachment; filename="recall-question-bank-${stamp()}.json"`)
      .send(await exportBank(db, includeArchived));
  });

  app.get('/export/progress', async (request, reply) =>
    reply
      .header('Content-Disposition', `attachment; filename="recall-progress-${stamp()}.json"`)
      .send(await exportProgress(db, requireAuth(request).ownerId)),
  );
}
