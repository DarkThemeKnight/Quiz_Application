import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  QuestionDetailDto,
  Paginated,
  QuestionSummaryDto,
  SubjectDto,
  TopicDto,
} from '@recall/shared';
import {
  api,
  makeSubject,
  questionPayloads,
  setupTestApp,
  teardown,
  type TestContext,
} from './helpers.js';

describe('subjects, topics, collections and questions', () => {
  let ctx: TestContext;
  let call: ReturnType<typeof api>;
  let subjectId: string;
  let topicId: string;

  beforeAll(async () => {
    ctx = await setupTestApp();
    call = api(ctx);
    ({ subjectId, topicId } = await makeSubject(ctx, 'History'));
  });
  afterAll(async () => teardown(ctx));

  it('enforces case-insensitive unique subject names', async () => {
    expect((await call('POST', '/api/subjects', { name: 'history' })).status).toBe(409);
    expect((await call('POST', '/api/subjects', { name: '' })).status).toBe(400);
  });

  it('supports nested topics and prevents cycles', async () => {
    const child = await call<{ id: string }>('POST', '/api/topics', {
      subjectId,
      parentTopicId: topicId,
      name: 'Child',
    });
    expect(child.status).toBe(201);
    const grandchild = await call<{ id: string }>('POST', '/api/topics', {
      subjectId,
      parentTopicId: child.json.id,
      name: 'Grandchild',
    });
    const cycle = await call('PATCH', `/api/topics/${topicId}`, {
      parentTopicId: grandchild.json.id,
    });
    expect(cycle.status).toBe(400);
    const self = await call('PATCH', `/api/topics/${topicId}`, { parentTopicId: topicId });
    expect(self.status).toBe(400);
    const topics = await call<TopicDto[]>('GET', `/api/topics?subjectId=${subjectId}`);
    expect(topics.json.length).toBe(3);
  });

  it('creates every question type through the API', async () => {
    const p = questionPayloads(subjectId, topicId);
    for (const payload of [p.single, p.multi, p.trueFalse, p.fill]) {
      const res = await call<QuestionDetailDto>('POST', '/api/questions', {
        ...payload,
        tagNames: ['Core', 'core'],
      });
      expect(res.status, JSON.stringify(res.json)).toBe(201);
      expect(res.json.kind).toBe(payload.kind);
      expect(res.json.tags).toEqual(['Core']);
      expect(res.json.revision).toBe(1);
    }
    const tf = await call<Paginated<QuestionSummaryDto>>('GET', '/api/questions?kind=true_false');
    const detail = await call<QuestionDetailDto>('GET', `/api/questions/${tf.json.items[0]?.id}`);
    expect(detail.json.correctBoolean).toBe(false);
  });

  it('rejects malformed questions with field details', async () => {
    const p = questionPayloads(subjectId, topicId);
    const badGap = await call<{ error: { details: { path: string }[] } }>(
      'POST',
      '/api/questions',
      {
        ...p.fill,
        body: 'Water is {{blank:h}}2{{ blank:o }}.',
      },
    );
    expect(badGap.status).toBe(400);
    expect(badGap.json.error.details.some((d) => d.path === 'body')).toBe(true);
    const twoCorrect = await call('POST', '/api/questions', {
      ...p.single,
      options: [
        { body: 'A', isCorrect: true },
        { body: 'B', isCorrect: true },
      ],
    });
    expect(twoCorrect.status).toBe(400);
    const tfNull = await call('POST', '/api/questions', { ...p.trueFalse, correctBoolean: null });
    expect(tfNull.status).toBe(400);
    const otherSubject = await makeSubject(ctx, 'Other');
    const wrongTopic = await call('POST', '/api/questions', {
      ...p.single,
      topicId: otherSubject.topicId,
    });
    expect(wrongTopic.status).toBe(400);
  });

  it('bumps the revision only when content changes', async () => {
    const p = questionPayloads(subjectId, topicId);
    const created = await call<QuestionDetailDto>('POST', '/api/questions', {
      ...p.single,
      body: 'Revision check?',
    });
    const id = created.json.id;
    const options = created.json.options.map(({ id: optionId, body, isCorrect }) => ({
      id: optionId,
      body,
      isCorrect,
    }));
    const same = await call<QuestionDetailDto>('PUT', `/api/questions/${id}`, {
      ...p.single,
      body: 'Revision check?',
      options,
      reviewStatus: 'verified',
    });
    expect(same.json.revision).toBe(1);
    expect(same.json.reviewStatus).toBe('verified');
    const changed = await call<QuestionDetailDto>('PUT', `/api/questions/${id}`, {
      ...p.single,
      body: 'Revision check, edited?',
      options,
    });
    expect(changed.json.revision).toBe(2);
    expect(changed.json.options.map((o) => o.id)).toEqual(options.map((o) => o.id));
  });

  it('warns about duplicates by normalised prompt', async () => {
    const dupes = await call<{ id: string }[]>('POST', '/api/questions/duplicates', {
      body: '  which IS a primary colour of light ',
    });
    expect(dupes.json.length).toBeGreaterThan(0);
  });

  it('restores an archived draft as a draft and a published question as published', async () => {
    const p = questionPayloads(subjectId, topicId);
    const draft = await call<QuestionDetailDto>('POST', '/api/questions', {
      ...p.trueFalse,
      body: 'Draft to archive',
      status: 'draft',
    });
    expect(
      (await call<QuestionDetailDto>('POST', `/api/questions/${draft.json.id}/archive`)).json
        .status,
    ).toBe('archived');
    expect(
      (await call<QuestionDetailDto>('POST', `/api/questions/${draft.json.id}/restore`)).json
        .status,
    ).toBe('draft');

    const published = await call<QuestionDetailDto>('POST', '/api/questions', {
      ...p.trueFalse,
      body: 'Published to archive',
    });
    await call('POST', `/api/questions/${published.json.id}/archive`);
    expect(
      (await call<QuestionDetailDto>('POST', `/api/questions/${published.json.id}/restore`)).json
        .status,
    ).toBe('published');
  });

  it('requires archiving before permanent deletion; archived questions are hidden by default', async () => {
    const p = questionPayloads(subjectId, topicId);
    const created = await call<QuestionDetailDto>('POST', '/api/questions', {
      ...p.trueFalse,
      body: 'Delete me',
    });
    const id = created.json.id;
    expect((await call('DELETE', `/api/questions/${id}`)).status).toBe(409);
    expect(
      (await call<QuestionDetailDto>('POST', `/api/questions/${id}/archive`)).json.status,
    ).toBe('archived');
    const list = await call<Paginated<QuestionSummaryDto>>('GET', '/api/questions?q=Delete%20me');
    expect(list.json.total).toBe(0);
    const archived = await call<Paginated<QuestionSummaryDto>>(
      'GET',
      '/api/questions?status=archived',
    );
    expect(archived.json.items.some((q) => q.id === id)).toBe(true);
    expect(
      (await call('PUT', `/api/questions/${id}`, { ...p.trueFalse, body: 'Edit archived' })).status,
    ).toBe(409);
    expect((await call('DELETE', `/api/questions/${id}`)).status).toBe(200);
    expect((await call('GET', `/api/questions/${id}`)).status).toBe(404);
  });

  it('filters by search text, subject, topic subtree, tag and collection', async () => {
    const collection = await call<{ id: string }>('POST', '/api/collections', {
      name: 'Interview Prep',
    });
    const list = await call<Paginated<QuestionSummaryDto>>(
      'GET',
      `/api/questions?subjectId=${subjectId}`,
    );
    const first = list.json.items[0];
    expect(first).toBeDefined();
    await call('POST', `/api/collections/${collection.json.id}/questions`, {
      action: 'add',
      questionIds: [first?.id],
    });
    const inCollection = await call<Paginated<QuestionSummaryDto>>(
      'GET',
      `/api/questions?collectionId=${collection.json.id}`,
    );
    expect(inCollection.json.items.map((q) => q.id)).toEqual([first?.id]);
    expect(
      (await call<Paginated<QuestionSummaryDto>>('GET', '/api/questions?tag=CORE')).json.total,
    ).toBeGreaterThan(0);
    expect(
      (await call<Paginated<QuestionSummaryDto>>('GET', '/api/questions?q=even%20numbers')).json
        .total,
    ).toBe(1);
    expect(
      (await call<Paginated<QuestionSummaryDto>>('GET', `/api/questions?topicId=${topicId}`)).json
        .total,
    ).toBeGreaterThan(0);
    // LIKE wildcards are escaped.
    expect(
      (await call<Paginated<QuestionSummaryDto>>('GET', '/api/questions?q=%25')).json.total,
    ).toBe(0);
    // Deleting a collection keeps its questions.
    await call('DELETE', `/api/collections/${collection.json.id}`);
    expect((await call('GET', `/api/questions/${first?.id}`)).status).toBe(200);
  });

  it('protects subjects and topics that still have questions', async () => {
    expect((await call('DELETE', `/api/subjects/${subjectId}`)).status).toBe(409);
    expect((await call('DELETE', `/api/topics/${topicId}`)).status).toBe(409);
    const subjects = await call<SubjectDto[]>('GET', '/api/subjects');
    expect(subjects.json.find((s) => s.id === subjectId)?.questionCount).toBeGreaterThan(0);
  });
});
