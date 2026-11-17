import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  ImportCommitDto,
  ImportPreviewDto,
  Paginated,
  QuestionStatsDto,
  QuestionSummaryDto,
} from '@recall/shared';
import { REPO_ROOT } from '../src/config.js';
import { api, setupTestApp, teardown, type TestContext } from './helpers.js';

const sampleJson = readFileSync(resolve(REPO_ROOT, 'examples/question_bank.sample.json'), 'utf8');
const sampleCsv = readFileSync(resolve(REPO_ROOT, 'examples/question_bank.sample.csv'), 'utf8');

describe('import and export', () => {
  let ctx: TestContext;
  let call: ReturnType<typeof api>;
  beforeAll(async () => {
    ctx = await setupTestApp();
    call = api(ctx);
  });
  afterAll(async () => teardown(ctx));

  const stats = async () => (await call<QuestionStatsDto>('GET', '/api/questions/stats')).json;

  it('previews without writing anything', async () => {
    const preview = await call<ImportPreviewDto>('POST', '/api/import/questions/validate', {
      format: 'json',
      content: sampleJson,
    });
    expect(preview.status).toBe(200);
    expect(preview.json).toMatchObject({ fatal: null, totalRows: 5, validRows: 5, errorRows: 0 });
    expect(preview.json.newSubjects).toEqual(['General Study']);
    expect(preview.json.newTopics.length).toBe(4);
    expect((await stats()).published).toBe(0);
  });

  it('rejects a batch with any bad row and writes nothing', async () => {
    const file = JSON.parse(sampleJson) as { questions: unknown[] };
    file.questions.push({
      type: 'fill_gap',
      prompt: 'Broken {{blank:1}}',
      blanks: [{ key: '9', acceptedAnswers: ['x'] }],
    });
    const content = JSON.stringify(file);
    const preview = await call<ImportPreviewDto>('POST', '/api/import/questions/validate', {
      format: 'json',
      content,
    });
    expect(preview.json.errorRows).toBe(1);
    expect(preview.json.rows[5]?.errors.length).toBeGreaterThan(0);
    const commit = await call<{ error: { code: string } }>('POST', '/api/import/questions/commit', {
      format: 'json',
      content,
    });
    expect(commit.status).toBe(422);
    expect(commit.json.error.code).toBe('IMPORT_INVALID');
    expect(await stats()).toMatchObject({ published: 0, subjects: 0 });
  });

  it('commits a valid JSON batch atomically and skips duplicates on re-import', async () => {
    const commit = await call<ImportCommitDto>('POST', '/api/import/questions/commit', {
      format: 'json',
      content: sampleJson,
    });
    expect(commit.json).toEqual({
      imported: 5,
      skippedDuplicates: 0,
      createdSubjects: 1,
      createdTopics: 4,
    });
    const again = await call<ImportCommitDto>('POST', '/api/import/questions/commit', {
      format: 'json',
      content: sampleJson,
    });
    expect(again.json).toMatchObject({ imported: 0, skippedDuplicates: 5 });
    const preview = await call<ImportPreviewDto>('POST', '/api/import/questions/validate', {
      format: 'json',
      content: sampleJson,
    });
    expect(preview.json.duplicateRows).toBe(5);
  });

  it('imports CSV with aliases and booleans intact', async () => {
    const commit = await call<ImportCommitDto>('POST', '/api/import/questions/commit', {
      format: 'csv',
      content: sampleCsv,
    });
    expect(commit.json.imported).toBe(3);
    const list = await call<Paginated<QuestionSummaryDto>>(
      'GET',
      '/api/questions?kind=fill_gap&q=5%20%2B%207',
    );
    const detail = await call<{ blanks: unknown }>(
      'GET',
      `/api/questions/${list.json.items[0]?.id}`,
    );
    expect(detail.json.blanks).toEqual([{ key: '1', acceptedAnswers: ['12', 'twelve'] }]);
  });

  it('reports fatal file problems', async () => {
    const bad = await call<ImportPreviewDto>('POST', '/api/import/questions/validate', {
      format: 'csv',
      content: 'prompt\nhello',
    });
    expect(bad.json.fatal).toMatch(/Missing/);
    expect(
      (await call('POST', '/api/import/questions/validate', { format: 'xml', content: 'x' }))
        .status,
    ).toBe(400);
  });

  it('loads the labelled sample bank idempotently', async () => {
    const first = await call<ImportCommitDto>('POST', '/api/import/sample');
    expect(first.json.imported).toBeGreaterThanOrEqual(20);
    const second = await call<ImportCommitDto>('POST', '/api/import/sample');
    expect(second.json.imported).toBe(0);
  });

  it('exports a bank file that re-imports cleanly (round trip)', async () => {
    const exported = await call<{ format: string; questions: unknown[] }>(
      'GET',
      '/api/export/questions',
    );
    expect(exported.res.headers['content-disposition']).toMatch(/attachment/);
    expect(exported.json.format).toBe('recall-studio-question-bank');
    const total = (await stats()).published;
    expect(exported.json.questions).toHaveLength(total);
    const preview = await call<ImportPreviewDto>('POST', '/api/import/questions/validate', {
      format: 'json',
      content: exported.body,
    });
    expect(preview.json.errorRows).toBe(0);
    expect(preview.json.duplicateRows).toBe(total);
    const csv = await call('GET', '/api/export/questions?format=csv');
    expect(csv.res.headers['content-type']).toMatch(/text\/csv/);
    const csvPreview = await call<ImportPreviewDto>('POST', '/api/import/questions/validate', {
      format: 'csv',
      content: csv.body,
    });
    expect(csvPreview.json.errorRows).toBe(0);
    expect(csvPreview.json.totalRows).toBe(total);
  });

  it('exports progress as JSON', async () => {
    const progress = await call<{ format: string; sessions: unknown[] }>(
      'GET',
      '/api/export/progress',
    );
    expect(progress.json.format).toBe('recall-studio-progress');
    expect(Array.isArray(progress.json.sessions)).toBe(true);
  });
});
