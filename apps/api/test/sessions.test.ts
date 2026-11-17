import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type {
  DashboardDto,
  QuestionDetailDto,
  SessionDto,
  SessionResultDto,
  AnalyticsDto,
} from '@recall/shared';
import { reviewSchedule, studySessions } from '../src/db/schema.js';
import {
  api,
  makeSubject,
  questionPayloads,
  setupTestApp,
  teardown,
  type TestContext,
} from './helpers.js';

describe('study sessions, grading, history and analytics', () => {
  let ctx: TestContext;
  let call: ReturnType<typeof api>;
  let subjectId: string;
  let topicId: string;
  const ids: Record<'single' | 'multi' | 'trueFalse' | 'fill', string> = {
    single: '',
    multi: '',
    trueFalse: '',
    fill: '',
  };

  beforeAll(async () => {
    ctx = await setupTestApp();
    call = api(ctx);
    ({ subjectId, topicId } = await makeSubject(ctx, 'Chemistry'));
    const p = questionPayloads(subjectId, topicId);
    for (const key of Object.keys(ids) as (keyof typeof ids)[]) {
      ids[key] = (await call<QuestionDetailDto>('POST', '/api/questions', p[key])).json.id;
    }
  });
  afterAll(async () => teardown(ctx));

  const createSession = (body: Record<string, unknown>) =>
    call<SessionDto>('POST', '/api/sessions', { shuffle: false, ...body });
  const itemFor = (session: SessionDto, questionKind: string) => {
    const item = session.items.find((i) => i.question.kind === questionKind);
    if (!item) throw new Error(`no ${questionKind} item`);
    return item;
  };

  it('shows honest zero-data dashboard values', async () => {
    const dash = await call<DashboardDto>('GET', '/api/dashboard?tz=Europe/London');
    expect(dash.status).toBe(200);
    expect(dash.json.totalAnswers).toBe(0);
    expect(dash.json.practiceAccuracy30d.percent).toBeNull();
    expect(dash.json.averageExamScore30d).toEqual({ percent: null, exams: 0 });
    expect(dash.json.weakTopics).toEqual([]);
    expect(dash.json.trend14d).toHaveLength(14);
    expect(dash.json.trend14d.every((p) => p.practice.percent === null)).toBe(true);
    expect(dash.json.bank.published).toBe(4);
  });

  it('returns 422 when no questions match', async () => {
    const res = await createSession({ mode: 'practice', count: 5, selection: 'due' });
    expect(res.status).toBe(422);
  });

  it('practice: grades on check, reveals feedback only after, and is idempotent', async () => {
    const created = await createSession({ mode: 'practice', count: 10 });
    expect(created.status).toBe(201);
    const session = created.json;
    expect(session.items).toHaveLength(4);
    // No answer keys before checking.
    expect(JSON.stringify(session.items)).not.toMatch(/isCorrect|acceptedAnswers|"oxygen"|RGB/);
    expect(session.items.every((i) => i.feedback === null)).toBe(true);

    const tf = itemFor(session, 'true_false');
    const url = `/api/sessions/${session.id}/items/${tf.id}/answer`;
    // A missing value is not "false".
    expect((await call('PUT', url, { answer: { kind: 'true_false' } })).status).toBe(400);
    expect((await call('PUT', url, { answer: { kind: 'true_false', value: null } })).status).toBe(
      400,
    );
    const checked = await call<SessionDto['items'][number]>('PUT', url, {
      answer: { kind: 'true_false', value: false },
      elapsedMs: 4000,
    });
    expect(checked.status).toBe(200);
    expect(checked.json.feedback?.isCorrect).toBe(true);
    expect(checked.json.feedback?.correctBoolean).toBe(false);
    // Replaying the same answer is fine; changing it is not.
    expect((await call('PUT', url, { answer: { kind: 'true_false', value: false } })).status).toBe(
      200,
    );
    expect((await call('PUT', url, { answer: { kind: 'true_false', value: true } })).status).toBe(
      409,
    );

    const multi = itemFor(session, 'multi_choice');
    const partial = await call<SessionDto['items'][number]>(
      'PUT',
      `/api/sessions/${session.id}/items/${multi.id}/answer`,
      {
        answer: { kind: 'multi_choice', optionIds: [multi.question.options[0]?.id] },
      },
    );
    expect(partial.json.feedback?.isCorrect).toBe(false);
    expect(partial.json.feedback?.correctOptionIds).toHaveLength(2);

    const fill = itemFor(session, 'fill_gap');
    const fillRes = await call<SessionDto['items'][number]>(
      'PUT',
      `/api/sessions/${session.id}/items/${fill.id}/answer`,
      {
        answer: { kind: 'fill_gap', blanks: { h: ' h ', o: 'OXYGEN' } },
      },
    );
    expect(fillRes.json.feedback?.isCorrect).toBe(true);
    expect(fillRes.json.feedback?.acceptedAnswers).toEqual([
      { key: 'h', acceptedAnswers: ['H'] },
      { key: 'o', acceptedAnswers: ['O', 'oxygen'] },
    ]);
    // jsonb does not preserve object key order; the same answer must still be idempotent.
    expect(
      (
        await call('PUT', `/api/sessions/${session.id}/items/${fill.id}/answer`, {
          answer: { kind: 'fill_gap', blanks: { o: 'OXYGEN', h: ' h ' } },
        })
      ).status,
    ).toBe(200);

    // Unknown option ids are rejected rather than graded.
    const single = itemFor(session, 'single_choice');
    expect(
      (
        await call('PUT', `/api/sessions/${session.id}/items/${single.id}/answer`, {
          answer: { kind: 'single_choice', optionId: 'nope' },
        })
      ).status,
    ).toBe(400);
    // Skip the single-choice item.
    expect(
      (await call('PATCH', `/api/sessions/${session.id}/items/${single.id}`, { skipped: true }))
        .status,
    ).toBe(200);

    // Reload keeps state.
    const reloaded = await call<SessionDto>('GET', `/api/sessions/${session.id}`);
    expect(reloaded.json.items.filter((i) => i.state === 'answered')).toHaveLength(3);
    expect(itemFor(reloaded.json, 'single_choice').state).toBe('skipped');

    const result = await call<SessionResultDto>('POST', `/api/sessions/${session.id}/submit`);
    expect(result.status).toBe(200);
    expect(result.json.score).toMatchObject({
      total: 4,
      correct: 2,
      incorrect: 1,
      skipped: 1,
      unanswered: 0,
      percent: 50,
    });
    // Submitting again is idempotent.
    const again = await call<SessionResultDto>('POST', `/api/sessions/${session.id}/submit`);
    expect(again.json.score.correct).toBe(2);
    // Submitted sessions are immutable.
    expect(
      (
        await call('PUT', `/api/sessions/${session.id}/items/${single.id}/answer`, {
          answer: { kind: 'single_choice', optionId: single.question.options[0]?.id },
        })
      ).status,
    ).toBe(409);
  });

  it('exam: hides feedback until submission and grades unanswered as incorrect', async () => {
    const created = await createSession({ mode: 'exam', count: 4, timeLimitMinutes: 15 });
    const session = created.json;
    expect(session.endsAt).not.toBeNull();
    const single = itemFor(session, 'single_choice');
    const saved = await call<SessionDto['items'][number]>(
      'PUT',
      `/api/sessions/${session.id}/items/${single.id}/answer`,
      {
        answer: { kind: 'single_choice', optionId: single.question.options[1]?.id },
      },
    );
    expect(saved.json.feedback).toBeNull();
    // Exam answers may be changed before submission.
    const changed = await call<SessionDto['items'][number]>(
      'PUT',
      `/api/sessions/${session.id}/items/${single.id}/answer`,
      {
        answer: { kind: 'single_choice', optionId: single.question.options[0]?.id },
      },
    );
    expect(changed.json.state).toBe('answered');
    expect(
      JSON.stringify((await call<SessionDto>('GET', `/api/sessions/${session.id}`)).json),
    ).not.toMatch(/isCorrect"|explanation/);
    // Results are not available early.
    expect((await call('GET', `/api/sessions/${session.id}/result`)).status).toBe(409);
    const result = await call<SessionResultDto>('POST', `/api/sessions/${session.id}/submit`);
    expect(result.json.score).toMatchObject({ total: 4, correct: 1, unanswered: 3, percent: 25 });
    expect(result.json.session.submitReason).toBe('manual');
  });

  it('exam deadline is server-authoritative', async () => {
    const created = await createSession({ mode: 'exam', count: 4, timeLimitMinutes: 1 });
    const session = created.json;
    const tf = itemFor(session, 'true_false');
    await call('PUT', `/api/sessions/${session.id}/items/${tf.id}/answer`, {
      answer: { kind: 'true_false', value: false },
    });
    // Simulate the deadline passing.
    await ctx.database.db
      .update(studySessions)
      .set({
        startedAt: sql`now() - interval '2 minutes'`,
        endsAt: sql`now() - interval '1 minute'`,
      })
      .where(eq(studySessions.id, session.id));
    const late = await call<{ error: { code: string } }>(
      'PUT',
      `/api/sessions/${session.id}/items/${tf.id}/answer`,
      {
        answer: { kind: 'true_false', value: true },
      },
    );
    expect(late.status).toBe(409);
    expect(late.json.error.code).toBe('DEADLINE_PASSED');
    const reloaded = await call<SessionDto>('GET', `/api/sessions/${session.id}`);
    expect(reloaded.json.status).toBe('submitted');
    expect(reloaded.json.submitReason).toBe('timeout');
    expect(reloaded.json.score?.correct).toBe(1);
    // Duration is capped at the deadline, never negative.
    const result = await call<SessionResultDto>('GET', `/api/sessions/${session.id}/result`);
    expect(result.json.durationMs).toBeGreaterThanOrEqual(59_000);
    expect(result.json.durationMs).toBeLessThanOrEqual(61_000);
  });

  it('a 15-question exam persists its score and review after reload', async () => {
    const p = questionPayloads(subjectId, topicId);
    const extra: string[] = [];
    for (let i = 0; i < 11; i++) {
      extra.push(
        (
          await call<QuestionDetailDto>('POST', '/api/questions', {
            ...p.trueFalse,
            body: `Statement number ${i}`,
            correctBoolean: i % 2 === 0,
          })
        ).json.id,
      );
    }
    const created = await createSession({
      mode: 'exam',
      count: 15,
      timeLimitMinutes: 30,
      shuffle: true,
    });
    expect(created.json.items).toHaveLength(15);
    for (const item of created.json.items.filter((i) => i.question.kind === 'true_false')) {
      await call('PUT', `/api/sessions/${created.json.id}/items/${item.id}/answer`, {
        answer: { kind: 'true_false', value: true },
      });
    }
    const submitted = await call<SessionResultDto>(
      'POST',
      `/api/sessions/${created.json.id}/submit`,
    );
    const reread = await call<SessionResultDto>('GET', `/api/sessions/${created.json.id}/result`);
    expect(reread.json.score).toEqual(submitted.json.score);
    expect(reread.json.items).toHaveLength(15);
    // 6 statements with correctBoolean=true among the extras answered "true"; the Moon one is false.
    expect(reread.json.score.correct).toBe(6);
  });

  it('editing or deleting a question never changes completed history', async () => {
    const created = await createSession({ mode: 'practice', count: 1, questionIds: [ids.single] });
    const item = created.json.items[0];
    if (!item) throw new Error('missing item');
    await call('PUT', `/api/sessions/${created.json.id}/items/${item.id}/answer`, {
      answer: { kind: 'single_choice', optionId: item.question.options[0]?.id },
    });
    const before = await call<SessionResultDto>('POST', `/api/sessions/${created.json.id}/submit`);
    expect(before.json.score.correct).toBe(1);

    const p = questionPayloads(subjectId, topicId);
    // Flip the correct answer and rewrite the prompt.
    await call('PUT', `/api/questions/${ids.single}`, {
      ...p.single,
      body: 'Completely different prompt',
      options: [
        { body: 'Red', isCorrect: false },
        { body: 'Brown', isCorrect: true },
      ],
    });
    const after = await call<SessionResultDto>('GET', `/api/sessions/${created.json.id}/result`);
    expect(after.json.score).toEqual(before.json.score);
    expect(after.json.items[0]?.snapshot.body).toBe('Which is a primary colour of light?');
    expect(after.json.items[0]?.isCorrect).toBe(true);
    expect(after.json.items[0]?.liveStatus).toBe('edited');

    await call('POST', `/api/questions/${ids.single}/archive`);
    expect(
      (await call<SessionResultDto>('GET', `/api/sessions/${created.json.id}/result`)).json.items[0]
        ?.liveStatus,
    ).toBe('archived');
    await call('DELETE', `/api/questions/${ids.single}`);
    const deleted = await call<SessionResultDto>('GET', `/api/sessions/${created.json.id}/result`);
    expect(deleted.json.items[0]?.liveStatus).toBe('deleted');
    expect(deleted.json.score).toEqual(before.json.score);
  });

  it('updates the Leitner schedule and supports due/incorrect selection', async () => {
    const rows = await ctx.database.db.select().from(reviewSchedule);
    // Last seen in the 15-question exam, answered "true" (wrong) → back to box 1.
    const tf = rows.find((r) => r.questionId === ids.trueFalse);
    expect(tf).toMatchObject({ box: 1, latestOutcome: false, attempts: 3 });
    // Answered correctly once in practice → box 2.
    const fill = rows.find((r) => r.questionId === ids.fill);
    expect(fill).toMatchObject({ box: 2, latestOutcome: true });
    const multi = rows.find((r) => r.questionId === ids.multi);
    expect(multi).toMatchObject({ box: 1, latestOutcome: false });

    const incorrect = await createSession({ mode: 'practice', count: 10, selection: 'incorrect' });
    expect(incorrect.json.items.map((i) => i.question.kind)).toContain('multi_choice');
    expect(incorrect.json.title).toMatch(/Missed/);
    const due = await createSession({ mode: 'practice', count: 10, selection: 'due' });
    expect(due.status).toBe(201);
    expect(due.json.items.some((i) => i.question.kind === 'multi_choice')).toBe(true);
    await call('POST', `/api/sessions/${incorrect.json.id}/abandon`);
    await call('POST', `/api/sessions/${due.json.id}/abandon`);
  });

  it('dashboard and analytics aggregate numerators and denominators', async () => {
    const dash = await call<DashboardDto>('GET', '/api/dashboard');
    expect(dash.json.totalAnswers).toBeGreaterThan(0);
    expect(dash.json.uniqueQuestionsAnswered).toBeLessThanOrEqual(dash.json.totalAnswers);
    // Practice: first session 2/3 answered + retry session 1/1 = 3/4.
    expect(dash.json.practiceAccuracy30d).toEqual({ correct: 3, total: 4, percent: 75 });
    // Exams: 25%, 25% (1/4 timeout), 6/15 = 40% → mean 30%.
    expect(dash.json.averageExamScore30d.exams).toBe(3);
    expect(dash.json.averageExamScore30d.percent).toBe(30);
    expect(dash.json.recentSessions.length).toBeGreaterThan(0);
    expect(dash.json.activeSession).toBeNull();

    const analytics = await call<AnalyticsDto>('GET', '/api/analytics?range=30d');
    expect(analytics.status).toBe(200);
    // Exam pooled: (1 + 1 + 6) / (4 + 4 + 15)
    expect(analytics.json.totals.examPooled).toMatchObject({ correct: 8, total: 23 });
    expect(analytics.json.totals.skipped).toBe(1);
    expect(analytics.json.byKind.find((k) => k.kind === 'true_false')?.total).toBeGreaterThan(0);
    expect(analytics.json.byDifficulty).toHaveLength(3);
    expect(analytics.json.mostMissed.length).toBeGreaterThan(0);
    expect(analytics.json.topics[0]?.status).toBeDefined();
    const practiceOnly = await call<AnalyticsDto>('GET', '/api/analytics?range=all&mode=practice');
    expect(practiceOnly.json.totals.answers).toBe(4);
    expect((await call('GET', '/api/analytics?range=forever')).status).toBe(400);
  });

  it('lists history with pagination', async () => {
    const history = await call<{ items: { status: string }[]; total: number }>(
      'GET',
      '/api/sessions?pageSize=2',
    );
    expect(history.json.items).toHaveLength(2);
    expect(history.json.total).toBeGreaterThan(2);
    const abandoned = await call<{ items: { status: string }[] }>(
      'GET',
      '/api/sessions?status=abandoned',
    );
    expect(abandoned.json.items.every((s) => s.status === 'abandoned')).toBe(true);
  });
});
