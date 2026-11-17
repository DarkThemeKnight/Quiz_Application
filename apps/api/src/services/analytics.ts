import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import {
  rankTopics,
  ratio,
  toPercent,
  type AnalyticsDto,
  type AnalyticsRange,
  type DashboardDto,
  type RateStat,
  type TopicPerformanceDto,
  type TrendPointDto,
} from '@recall/shared';
import type { Db } from '../db/client.js';
import { questions, reviewSchedule, studySessions, subjects } from '../db/schema.js';
import { getPreferences } from './owner.js';
import { summarize } from './sessions.js';

/**
 * Metric definitions (see docs/decisions/0004-metrics.md):
 * - "Answer" = a session item with state 'answered' whose correctness is final (graded_at set).
 *   Practice items count once checked, exam items once the exam is submitted.
 *   Skipped/unanswered items are reported separately and excluded from accuracy.
 * - Practice accuracy = correct practice answers ÷ practice answers (pooled, not averaged).
 * - Average exam score = mean of per-exam percentages (correct ÷ assigned) of submitted exams.
 * - Exam pooled accuracy = Σ correct ÷ Σ assigned across submitted exams.
 * Subject/topic/kind/difficulty come from the item snapshot, i.e. as they were when answered.
 */

const rate = (correct: number, total: number): RateStat => ({
  correct,
  total,
  percent: toPercent(ratio(correct, total), 1),
});

export function safeTimeZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

function rangeStart(range: AnalyticsRange, now: Date): Date | null {
  const days = { '7d': 7, '30d': 30, '90d': 90, '365d': 365, all: null }[range];
  return days === null ? null : new Date(now.getTime() - days * 86_400_000);
}

interface AnswerFilter {
  from: Date | null;
  subjectId?: string | undefined;
  mode?: 'practice' | 'exam' | 'all' | undefined;
}

/** WHERE fragment over `si` (session_items) joined to `ss` (study_sessions). */
function answerWhere(f: AnswerFilter, state: 'answered' | 'skipped' = 'answered'): SQL {
  const parts: SQL[] = [sql`si.graded_at is not null`, sql`si.state = ${state}`];
  if (f.from) parts.push(sql`si.graded_at >= ${f.from.toISOString()}::timestamptz`);
  if (f.subjectId) parts.push(sql`si.snapshot->'subject'->>'id' = ${f.subjectId}`);
  if (f.mode && f.mode !== 'all') parts.push(sql`ss.mode = ${f.mode}`);
  return sql.join(parts, sql` and `);
}

const FROM_ITEMS = sql`session_items si join study_sessions ss on ss.id = si.session_id`;

async function rows<T>(db: Db, query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as T[];
}

async function topicTallies(db: Db, f: AnswerFilter): Promise<TopicPerformanceDto[]> {
  const data = await rows<{
    topic_id: string | null;
    topic_name: string | null;
    subject_id: string;
    subject_name: string;
    attempts: number;
    correct: number;
    last_at: Date;
  }>(
    db,
    sql`select si.snapshot->'topic'->>'id' as topic_id,
               max(si.snapshot->'topic'->>'name') as topic_name,
               si.snapshot->'subject'->>'id' as subject_id,
               max(si.snapshot->'subject'->>'name') as subject_name,
               count(*)::int as attempts,
               count(*) filter (where si.is_correct)::int as correct,
               max(si.graded_at) as last_at
        from ${FROM_ITEMS}
        where ${answerWhere(f)}
        group by 1, 3`,
  );
  return rankTopics(
    data.map((r) => ({
      topicId: r.topic_id,
      topicName: r.topic_name ?? `${r.subject_name} (no topic)`,
      subjectId: r.subject_id,
      subjectName: r.subject_name,
      attempts: r.attempts,
      correct: r.correct,
      lastAttemptAt: new Date(r.last_at).toISOString(),
    })),
  ).map((t) => ({
    topicId: t.topicId,
    label: t.topicName,
    subjectId: t.subjectId,
    subjectName: t.subjectName,
    attempts: t.attempts,
    correct: t.correct,
    percent: toPercent(t.accuracy, 1),
    status: t.status,
    lastAttemptAt: t.lastAttemptAt,
  }));
}

async function trend(
  db: Db,
  f: AnswerFilter,
  opts: { from: Date; to: Date; bucket: 'day' | 'week'; tz: string },
): Promise<TrendPointDto[]> {
  const data = await rows<{
    bucket: string;
    mode: 'practice' | 'exam';
    total: number;
    correct: number;
  }>(
    db,
    sql`select to_char(date_trunc(${opts.bucket}, si.graded_at at time zone ${opts.tz}), 'YYYY-MM-DD') as bucket,
               ss.mode, count(*)::int as total, count(*) filter (where si.is_correct)::int as correct
        from ${FROM_ITEMS}
        where ${answerWhere({ ...f, from: null })}
          and date_trunc(${opts.bucket}, si.graded_at at time zone ${opts.tz})
              >= date_trunc(${opts.bucket}, ${opts.from.toISOString()}::timestamptz at time zone ${opts.tz})
        group by 1, 2`,
  );
  const series = await rows<{ bucket: string }>(
    db,
    sql`select to_char(d, 'YYYY-MM-DD') as bucket
        from generate_series(
          date_trunc(${opts.bucket}, ${opts.from.toISOString()}::timestamptz at time zone ${opts.tz}),
          date_trunc(${opts.bucket}, ${opts.to.toISOString()}::timestamptz at time zone ${opts.tz}),
          ${opts.bucket === 'day' ? sql`interval '1 day'` : sql`interval '1 week'`}
        ) d`,
  );
  return series.map(({ bucket }) => {
    const p = data.find((d) => d.bucket === bucket && d.mode === 'practice');
    const e = data.find((d) => d.bucket === bucket && d.mode === 'exam');
    return {
      date: bucket,
      practice: rate(p?.correct ?? 0, p?.total ?? 0),
      exam: rate(e?.correct ?? 0, e?.total ?? 0),
    };
  });
}

async function examStats(db: Db, ownerId: string, from: Date | null, subjectId?: string) {
  const conditions: SQL[] = [
    eq(studySessions.ownerId, ownerId),
    eq(studySessions.mode, 'exam'),
    eq(studySessions.status, 'submitted'),
  ];
  if (from)
    conditions.push(sql`${studySessions.submittedAt} >= ${from.toISOString()}::timestamptz`);
  if (subjectId) {
    conditions.push(
      sql`exists (select 1 from session_items x where x.session_id = ${studySessions.id} and x.snapshot->'subject'->>'id' = ${subjectId})`,
    );
  }
  const exams = await db
    .select({
      id: studySessions.id,
      title: studySessions.title,
      submittedAt: studySessions.submittedAt,
      correct: studySessions.scoreCorrect,
      total: studySessions.scoreTotal,
    })
    .from(studySessions)
    .where(and(...conditions))
    .orderBy(desc(studySessions.submittedAt));
  const percents = exams
    .map((e) => ratio(e.correct ?? 0, e.total ?? 0))
    .filter((p): p is number => p !== null);
  const pooledCorrect = exams.reduce((n, e) => n + (e.correct ?? 0), 0);
  const pooledTotal = exams.reduce((n, e) => n + (e.total ?? 0), 0);
  return {
    exams,
    average: percents.length
      ? toPercent(percents.reduce((a, b) => a + b, 0) / percents.length, 1)
      : null,
    pooled: rate(pooledCorrect, pooledTotal),
  };
}

async function totals(db: Db, f: AnswerFilter) {
  const [row] = await rows<{
    answers: number;
    unique_q: number;
    practice_total: number;
    practice_correct: number;
  }>(
    db,
    sql`select count(*)::int as answers,
               count(distinct coalesce(si.question_id::text, si.snapshot->>'questionId'))::int as unique_q,
               count(*) filter (where ss.mode = 'practice')::int as practice_total,
               count(*) filter (where ss.mode = 'practice' and si.is_correct)::int as practice_correct
        from ${FROM_ITEMS} where ${answerWhere(f)}`,
  );
  const [skipped] = await rows<{ n: number }>(
    db,
    sql`select count(*)::int as n from ${FROM_ITEMS} where ${answerWhere(f, 'skipped')}`,
  );
  return {
    answers: row?.answers ?? 0,
    uniqueQuestions: row?.unique_q ?? 0,
    practice: rate(row?.practice_correct ?? 0, row?.practice_total ?? 0),
    skipped: skipped?.n ?? 0,
  };
}

async function dueCount(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reviewSchedule)
    .innerJoin(questions, eq(questions.id, reviewSchedule.questionId))
    .where(and(eq(questions.status, 'published'), sql`${reviewSchedule.nextDueAt} <= now()`));
  return row?.n ?? 0;
}

export async function getDashboard(
  db: Db,
  ownerId: string,
  tzInput?: string,
): Promise<DashboardDto> {
  const tz = safeTimeZone(tzInput);
  const now = new Date();
  const from30 = rangeStart('30d', now);
  const prefs = await getPreferences(db, ownerId);
  const [
    bankRows,
    subjectRow,
    allTime,
    last30,
    exams,
    topicsPerf,
    trend14,
    due,
    activeRows,
    recentRows,
  ] = await Promise.all([
    db
      .select({ status: questions.status, n: sql<number>`count(*)::int` })
      .from(questions)
      .groupBy(questions.status),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(subjects)
      .where(sql`${subjects.archivedAt} is null`),
    totals(db, { from: null }),
    totals(db, { from: from30 }),
    examStats(db, ownerId, from30),
    topicTallies(db, { from: rangeStart('90d', now) }),
    trend(
      db,
      { from: null },
      { from: new Date(now.getTime() - 13 * 86_400_000), to: now, bucket: 'day', tz },
    ),
    prefs.spacedReview ? dueCount(db) : Promise.resolve(null),
    db
      .select()
      .from(studySessions)
      .where(and(eq(studySessions.ownerId, ownerId), eq(studySessions.status, 'active')))
      .orderBy(desc(studySessions.updatedAt))
      .limit(1),
    db
      .select()
      .from(studySessions)
      .where(and(eq(studySessions.ownerId, ownerId), eq(studySessions.status, 'submitted')))
      .orderBy(desc(studySessions.submittedAt))
      .limit(6),
  ]);
  const bank = (s: string) => bankRows.find((r) => r.status === s)?.n ?? 0;
  const [active] = await summarize(db, activeRows);
  return {
    bank: {
      published: bank('published'),
      draft: bank('draft'),
      archived: bank('archived'),
      subjects: subjectRow[0]?.n ?? 0,
    },
    uniqueQuestionsAnswered: allTime.uniqueQuestions,
    totalAnswers: allTime.answers,
    practiceAccuracy30d: last30.practice,
    averageExamScore30d: { percent: exams.average, exams: exams.exams.length },
    dueForReview: due,
    spacedReview: prefs.spacedReview,
    activeSession: active ?? null,
    recentSessions: await summarize(db, recentRows),
    weakTopics: topicsPerf.filter((t) => t.status === 'weak').slice(0, 3),
    topicPerformance: topicsPerf.slice(0, 8),
    trend14d: trend14,
  };
}

export async function getAnalytics(
  db: Db,
  ownerId: string,
  q: { range: AnalyticsRange; subjectId?: string | undefined; mode: 'practice' | 'exam' | 'all' },
  tzInput?: string,
): Promise<AnalyticsDto> {
  const tz = safeTimeZone(tzInput);
  const now = new Date();
  const from = rangeStart(q.range, now);
  const f: AnswerFilter = { from, subjectId: q.subjectId, mode: q.mode };
  const prefs = await getPreferences(db, ownerId);

  let trendFrom = from;
  if (!trendFrom) {
    const [first] = await rows<{ first: Date | null }>(
      db,
      sql`select min(si.graded_at) as first from ${FROM_ITEMS} where ${answerWhere(f)}`,
    );
    trendFrom = first?.first ? new Date(first.first) : new Date(now.getTime() - 29 * 86_400_000);
  }
  const spanDays = (now.getTime() - trendFrom.getTime()) / 86_400_000;

  const [
    tot,
    exams,
    topicPerf,
    trendPoints,
    byKind,
    byDifficulty,
    bySubject,
    mostMissed,
    boxes,
    due,
    sessionsSubmitted,
  ] = await Promise.all([
    totals(db, f),
    examStats(db, ownerId, from, q.subjectId),
    topicTallies(db, f),
    trend(db, f, { from: trendFrom, to: now, bucket: spanDays > 120 ? 'week' : 'day', tz }),
    rows<{ kind: string; total: number; correct: number; avg_ms: number | null; timed: number }>(
      db,
      sql`select si.snapshot->>'kind' as kind, count(*)::int as total, count(*) filter (where si.is_correct)::int as correct,
                   avg(si.time_spent_ms) filter (where si.time_spent_ms between 1000 and 1800000)::float as avg_ms,
                   count(*) filter (where si.time_spent_ms between 1000 and 1800000)::int as timed
            from ${FROM_ITEMS} where ${answerWhere(f)} group by 1`,
    ),
    rows<{ difficulty: string; total: number; correct: number }>(
      db,
      sql`select si.snapshot->>'difficulty' as difficulty, count(*)::int as total, count(*) filter (where si.is_correct)::int as correct
            from ${FROM_ITEMS} where ${answerWhere(f)} group by 1`,
    ),
    rows<{ subject_id: string; subject_name: string; total: number; correct: number }>(
      db,
      sql`select si.snapshot->'subject'->>'id' as subject_id, max(si.snapshot->'subject'->>'name') as subject_name,
                   count(*)::int as total, count(*) filter (where si.is_correct)::int as correct
            from ${FROM_ITEMS} where ${answerWhere(f)} group by 1 order by 3 desc`,
    ),
    rows<{
      question_id: string;
      body: string;
      kind: string;
      attempts: number;
      incorrect: number;
      last_at: Date;
    }>(
      db,
      sql`select si.question_id, max(si.snapshot->>'body') as body, max(si.snapshot->>'kind') as kind,
                   count(*)::int as attempts, count(*) filter (where not si.is_correct)::int as incorrect,
                   max(si.graded_at) as last_at
            from ${FROM_ITEMS} where ${answerWhere(f)} and si.question_id is not null
            group by si.question_id
            having count(*) filter (where not si.is_correct) > 0
            order by count(*) filter (where not si.is_correct) desc,
                     count(*) filter (where not si.is_correct)::float / count(*) desc, max(si.graded_at) desc
            limit 10`,
    ),
    db
      .select({ box: reviewSchedule.box, n: sql<number>`count(*)::int` })
      .from(reviewSchedule)
      .innerJoin(questions, eq(questions.id, reviewSchedule.questionId))
      .where(eq(questions.status, 'published'))
      .groupBy(reviewSchedule.box),
    dueCount(db),
    rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from study_sessions ss where ss.owner_id = ${ownerId} and ss.status = 'submitted'
            ${from ? sql`and ss.submitted_at >= ${from.toISOString()}::timestamptz` : sql``}
            ${q.mode !== 'all' ? sql`and ss.mode = ${q.mode}` : sql``}`,
    ),
  ]);

  const order = { single_choice: 0, multi_choice: 1, true_false: 2, fill_gap: 3 } as const;
  return {
    range: q.range,
    from: from?.toISOString() ?? null,
    to: now.toISOString(),
    totals: {
      answers: tot.answers,
      uniqueQuestions: tot.uniqueQuestions,
      skipped: tot.skipped,
      sessionsSubmitted: sessionsSubmitted[0]?.n ?? 0,
      practice: tot.practice,
      examPooled: exams.pooled,
      averageExamScore: exams.average,
      examsCompleted: exams.exams.length,
    },
    trend: trendPoints,
    byKind: byKind
      .map((k) => ({
        kind: k.kind as keyof typeof order,
        ...rate(k.correct, k.total),
        avgTimeMs: k.timed > 0 && k.avg_ms !== null ? Math.round(k.avg_ms) : null,
        timedAnswers: k.timed,
      }))
      .sort((a, b) => order[a.kind] - order[b.kind]),
    byDifficulty: (['easy', 'medium', 'hard'] as const).map((d) => {
      const r = byDifficulty.find((x) => x.difficulty === d);
      return { difficulty: d, ...rate(r?.correct ?? 0, r?.total ?? 0) };
    }),
    bySubject: bySubject.map((s) => ({
      subjectId: s.subject_id,
      subjectName: s.subject_name,
      ...rate(s.correct, s.total),
    })),
    topics: topicPerf,
    mostMissed: mostMissed.map((m) => ({
      questionId: m.question_id,
      body: m.body,
      kind: m.kind as keyof typeof order,
      attempts: m.attempts,
      incorrect: m.incorrect,
      lastAttemptAt: new Date(m.last_at).toISOString(),
    })),
    exams: exams.exams.slice(0, 50).map((e) => ({
      id: e.id,
      title: e.title,
      submittedAt: e.submittedAt?.toISOString() ?? '',
      percent: toPercent(ratio(e.correct ?? 0, e.total ?? 0), 1),
      questionCount: e.total ?? 0,
    })),
    review: {
      enabled: prefs.spacedReview,
      dueNow: due,
      byBox: [1, 2, 3, 4, 5].map((box) => ({
        box,
        count: boxes.find((b) => b.box === box)?.n ?? 0,
      })),
    },
  };
}
