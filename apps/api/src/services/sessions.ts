import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  answerSchema,
  answersEqual,
  clampDurationMs,
  gradeAnswer,
  summarizeScore,
  toPublicQuestion,
  validateAnswerForQuestion,
  type Answer,
  type Paginated,
  type ResultItemDto,
  type SessionCreateInput,
  type SessionDto,
  type SessionItemDto,
  type SessionResultDto,
  type SessionSummaryDto,
  type sessionCreateSchema,
} from '@recall/shared';
import type { z } from 'zod';
import type { Db, Tx } from '../db/client.js';
import {
  collectionQuestions,
  collections,
  questions,
  questionTags,
  reviewSchedule,
  sessionItems,
  studySessions,
  subjects,
  tags,
  topics,
  type SelectionConfig,
} from '../db/schema.js';
import { AppError, conflict, notFound, zodDetails } from '../errors.js';
import { iso } from '../lib/text.js';
import { getPreferences, recordReviewOutcomes } from './owner.js';
import { buildSnapshots, topicSubtree } from './questions.js';

type CreateInput = z.output<typeof sessionCreateSchema>;
type SessionRow = typeof studySessions.$inferSelect;
type ItemRow = typeof sessionItems.$inferSelect;

/** Network grace for answers saved right at the exam deadline. */
export const DEADLINE_GRACE_MS = 2000;

const uuidList = (ids: string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

/* ---------- Selection ---------- */

export async function selectQuestionIds(db: Tx, input: CreateInput): Promise<string[]> {
  const where: SQL[] = [eq(questions.status, 'published')];
  if (input.questionIds.length) where.push(inArray(questions.id, input.questionIds));
  if (input.subjectIds.length) where.push(inArray(questions.subjectId, input.subjectIds));
  if (input.topicIds.length)
    where.push(sql`${questions.topicId} in ${topicSubtree(input.topicIds)}`);
  if (input.collectionIds.length) {
    where.push(
      sql`exists (select 1 from ${collectionQuestions} cq where cq.question_id = questions.id and cq.collection_id in (${uuidList(input.collectionIds)}))`,
    );
  }
  if (input.tags.length) {
    where.push(
      sql`exists (select 1 from ${questionTags} qt join ${tags} t on t.id = qt.tag_id where qt.question_id = questions.id and lower(t.name) in (${sql.join(
        input.tags.map((t) => sql`lower(${t})`),
        sql`, `,
      )}))`,
    );
  }
  if (input.difficulties.length) where.push(inArray(questions.difficulty, input.difficulties));
  if (input.kinds.length) where.push(inArray(questions.kind, input.kinds));
  switch (input.selection) {
    case 'new':
      where.push(
        sql`not exists (select 1 from ${sessionItems} si where si.question_id = questions.id and si.graded_at is not null and si.state = 'answered')`,
      );
      break;
    case 'incorrect':
      // The most recent graded answer for the question was wrong.
      where.push(
        sql`(select si.is_correct from ${sessionItems} si where si.question_id = questions.id and si.graded_at is not null and si.state = 'answered' order by si.graded_at desc limit 1) = false`,
      );
      break;
    case 'due':
      where.push(
        sql`exists (select 1 from ${reviewSchedule} rs where rs.question_id = questions.id and rs.next_due_at <= now())`,
      );
      break;
    case 'any':
      break;
  }
  const order = input.shuffle ? [sql`random()`] : [asc(questions.createdAt), asc(questions.id)];
  const rows = await db
    .select({ id: questions.id })
    .from(questions)
    .where(and(...where))
    .orderBy(...order)
    .limit(input.count);
  if (input.questionIds.length && !input.shuffle) {
    const pos = new Map(input.questionIds.map((id, i) => [id, i]));
    rows.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
  }
  return rows.map((r) => r.id);
}

async function deriveTitle(db: Tx, input: CreateInput): Promise<string> {
  if (input.title) return input.title;
  const parts: string[] = [];
  if (input.topicIds.length) {
    const rows = await db
      .select({ name: topics.name })
      .from(topics)
      .where(inArray(topics.id, input.topicIds));
    parts.push(...rows.map((r) => r.name));
  } else if (input.subjectIds.length) {
    const rows = await db
      .select({ name: subjects.name })
      .from(subjects)
      .where(inArray(subjects.id, input.subjectIds));
    parts.push(...rows.map((r) => r.name));
  }
  if (input.collectionIds.length) {
    const rows = await db
      .select({ name: collections.name })
      .from(collections)
      .where(inArray(collections.id, input.collectionIds));
    parts.push(...rows.map((r) => r.name));
  }
  const prefix =
    input.selection === 'incorrect'
      ? 'Missed questions'
      : input.selection === 'due'
        ? 'Due for review'
        : input.selection === 'new'
          ? 'New questions'
          : input.questionIds.length
            ? 'Retry'
            : '';
  const scope = parts.length
    ? parts.slice(0, 3).join(', ') + (parts.length > 3 ? ` +${parts.length - 3}` : '')
    : 'All subjects';
  return (prefix ? `${prefix} · ${scope}` : scope).slice(0, 120);
}

export async function createSession(db: Db, ownerId: string, input: CreateInput): Promise<string> {
  return db.transaction(async (tx) => {
    const ids = await selectQuestionIds(tx, input);
    if (ids.length === 0) {
      throw new AppError(
        422,
        'NO_QUESTIONS',
        'No published questions match these settings. Try widening the filters or adding questions.',
      );
    }
    const snapshots = await buildSnapshots(tx, ids);
    const now = new Date();
    const timeLimitSeconds =
      input.mode === 'exam' && input.timeLimitMinutes ? input.timeLimitMinutes * 60 : null;
    const selectionConfig: SelectionConfig = {
      subjectIds: input.subjectIds,
      topicIds: input.topicIds,
      collectionIds: input.collectionIds,
      tags: input.tags,
      difficulties: input.difficulties,
      kinds: input.kinds,
      questionIds: input.questionIds,
      selection: input.selection,
      shuffle: input.shuffle,
      requestedCount: input.count,
    };
    const [session] = await tx
      .insert(studySessions)
      .values({
        ownerId,
        mode: input.mode,
        status: 'active',
        title: await deriveTitle(tx, input),
        selectionConfig,
        questionCount: ids.length,
        allowSkip: input.allowSkip,
        timeLimitSeconds,
        startedAt: now,
        endsAt: timeLimitSeconds ? new Date(now.getTime() + timeLimitSeconds * 1000) : null,
      })
      .returning({ id: studySessions.id });
    if (!session) throw new Error('insert failed');
    await tx.insert(sessionItems).values(
      ids.map((questionId, position) => {
        const snapshot = snapshots.get(questionId);
        if (!snapshot) throw new Error('snapshot missing');
        return { sessionId: session.id, questionId, position, snapshot };
      }),
    );
    return session.id;
  });
}

/* ---------- Loading & DTOs ---------- */

async function loadSession(
  tx: Tx,
  ownerId: string,
  id: string,
  forUpdate = false,
): Promise<SessionRow> {
  const query = tx
    .select()
    .from(studySessions)
    .where(and(eq(studySessions.id, id), eq(studySessions.ownerId, ownerId)));
  const [row] = forUpdate ? await query.for('update') : await query;
  if (!row) throw notFound('Session');
  return row;
}

async function loadItems(tx: Tx, sessionId: string): Promise<ItemRow[]> {
  return tx
    .select()
    .from(sessionItems)
    .where(eq(sessionItems.sessionId, sessionId))
    .orderBy(asc(sessionItems.position));
}

function isPastDeadline(session: SessionRow, now: Date, graceMs = 0): boolean {
  return session.endsAt !== null && now.getTime() > session.endsAt.getTime() + graceMs;
}

function feedbackAllowed(session: SessionRow, item: ItemRow): boolean {
  return session.status === 'submitted' || (session.mode === 'practice' && item.locked);
}

function toItemDto(session: SessionRow, item: ItemRow, includeHint: boolean): SessionItemDto {
  const snap = item.snapshot;
  const allowed = feedbackAllowed(session, item);
  const grade = item.grade ?? gradeAnswer(snap, item.answer);
  return {
    id: item.id,
    position: item.position,
    state: item.state,
    markedForReview: item.markedForReview,
    answer: item.answer,
    timeSpentMs: item.timeSpentMs,
    question: toPublicQuestion(
      snap,
      includeHint && session.mode === 'practice' && session.status === 'active',
    ),
    feedback: allowed
      ? {
          isCorrect: item.isCorrect ?? false,
          grade,
          explanation: snap.explanation,
          correctOptionIds: snap.options.filter((o) => o.isCorrect).map((o) => o.id),
          correctBoolean: snap.correctBoolean,
          acceptedAnswers: snap.blanks,
          sourceLabel: snap.sourceLabel,
        }
      : null,
  };
}

function scoreFor(session: SessionRow, items: ItemRow[]) {
  return session.status === 'submitted' ? summarizeScore(items) : null;
}

function sessionHeader(session: SessionRow, items: ItemRow[]): Omit<SessionDto, 'items'> {
  return {
    id: session.id,
    mode: session.mode,
    status: session.status,
    title: session.title,
    allowSkip: session.allowSkip,
    questionCount: session.questionCount,
    currentPosition: session.currentPosition,
    startedAt: session.startedAt.toISOString(),
    endsAt: iso(session.endsAt),
    submittedAt: iso(session.submittedAt),
    submitReason: session.submitReason ?? null,
    timeLimitMinutes: session.timeLimitSeconds ? Math.round(session.timeLimitSeconds / 60) : null,
    serverNow: new Date().toISOString(),
    score: scoreFor(session, items),
  };
}

export async function getSession(db: Db, ownerId: string, id: string): Promise<SessionDto> {
  let session = await loadSession(db, ownerId, id);
  if (session.status === 'active' && isPastDeadline(session, new Date(), DEADLINE_GRACE_MS)) {
    await submitSession(db, ownerId, id, 'timeout');
    session = await loadSession(db, ownerId, id);
  }
  const items = await loadItems(db, id);
  const prefs = await getPreferences(db, ownerId);
  return {
    ...sessionHeader(session, items),
    items: items.map((i) => toItemDto(session, i, prefs.practiceHints)),
  };
}

/* ---------- Mutations ---------- */

async function lockActive(tx: Tx, ownerId: string, sessionId: string): Promise<SessionRow> {
  const session = await loadSession(tx, ownerId, sessionId, true);
  if (session.status !== 'active')
    throw conflict('This session is no longer active.', { status: session.status });
  if (isPastDeadline(session, new Date(), DEADLINE_GRACE_MS)) {
    throw new AppError(409, 'DEADLINE_PASSED', 'Time is up — answers can no longer be changed.');
  }
  return session;
}

async function lockItem(tx: Tx, sessionId: string, itemId: string): Promise<ItemRow> {
  const [item] = await tx
    .select()
    .from(sessionItems)
    .where(and(eq(sessionItems.id, itemId), eq(sessionItems.sessionId, sessionId)))
    .for('update');
  if (!item) throw notFound('Session item');
  return item;
}

/**
 * Save an answer. Practice: graded and locked immediately (idempotent for the same answer).
 * Exam: stored without grading; may be changed or cleared until submission/deadline.
 */
export async function saveAnswer(
  db: Db,
  ownerId: string,
  sessionId: string,
  itemId: string,
  body: { answer: unknown; elapsedMs: number },
): Promise<SessionItemDto> {
  const result = await db.transaction(async (tx) => {
    const session = await loadSession(tx, ownerId, sessionId, true);
    const item = await lockItem(tx, sessionId, itemId);

    let answer: Answer | null = null;
    if (body.answer !== null) {
      const parsed = answerSchema.safeParse(body.answer);
      if (!parsed.success)
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid answer.', zodDetails(parsed.error));
      answer = parsed.data;
      const problem = validateAnswerForQuestion(item.snapshot, answer);
      if (problem) throw new AppError(400, 'VALIDATION_ERROR', problem);
    }

    // Idempotent replay of an already-checked practice answer.
    if (session.mode === 'practice' && item.locked) {
      if (answersEqual(item.answer, answer)) return { session, item };
      throw conflict('This answer was already checked and cannot be changed.');
    }
    await lockActive(tx, ownerId, sessionId);

    const now = new Date();
    const timeSpentMs = Math.min(
      item.timeSpentMs + clampDurationMs(body.elapsedMs),
      24 * 3600 * 1000,
    );
    if (session.mode === 'practice') {
      if (!answer) throw new AppError(400, 'VALIDATION_ERROR', 'Choose or enter an answer first.');
      const grade = gradeAnswer(item.snapshot, answer);
      const [updated] = await tx
        .update(sessionItems)
        .set({
          answer,
          grade,
          isCorrect: grade.isCorrect,
          state: 'answered',
          locked: true,
          answeredAt: now,
          gradedAt: now,
          timeSpentMs,
        })
        .where(eq(sessionItems.id, itemId))
        .returning();
      const prefs = await getPreferences(tx, ownerId);
      if (prefs.spacedReview)
        await recordReviewOutcomes(
          tx,
          ownerId,
          [{ questionId: item.questionId, isCorrect: grade.isCorrect }],
          now,
        );
      return { session, item: updated ?? item };
    }
    const [updated] = await tx
      .update(sessionItems)
      .set({
        answer,
        state: answer ? 'answered' : 'unanswered',
        answeredAt: answer ? now : null,
        timeSpentMs,
      })
      .where(eq(sessionItems.id, itemId))
      .returning();
    return { session, item: updated ?? item };
  });
  const prefs = await getPreferences(db, ownerId);
  return toItemDto(result.session, result.item, prefs.practiceHints);
}

export async function updateItemFlags(
  db: Db,
  ownerId: string,
  sessionId: string,
  itemId: string,
  body: { markedForReview?: boolean | undefined; skipped?: boolean | undefined; elapsedMs: number },
): Promise<SessionItemDto> {
  const result = await db.transaction(async (tx) => {
    const session = await lockActive(tx, ownerId, sessionId);
    const item = await lockItem(tx, sessionId, itemId);
    const patch: Partial<ItemRow> = {
      timeSpentMs: Math.min(item.timeSpentMs + clampDurationMs(body.elapsedMs), 24 * 3600 * 1000),
    };
    if (body.markedForReview !== undefined) patch.markedForReview = body.markedForReview;
    if (body.skipped !== undefined) {
      if (item.locked) throw conflict('A checked answer cannot be skipped.');
      if (body.skipped) {
        if (!session.allowSkip) throw conflict('Skipping is disabled for this session.');
        Object.assign(patch, { state: 'skipped', answer: null, answeredAt: null });
      } else if (item.state === 'skipped') {
        patch.state = 'unanswered';
      }
    }
    const [updated] = await tx
      .update(sessionItems)
      .set(patch)
      .where(eq(sessionItems.id, itemId))
      .returning();
    return { session, item: updated ?? item };
  });
  const prefs = await getPreferences(db, ownerId);
  return toItemDto(result.session, result.item, prefs.practiceHints);
}

export async function updateProgress(
  db: Db,
  ownerId: string,
  sessionId: string,
  position: number,
): Promise<void> {
  const session = await loadSession(db, ownerId, sessionId);
  if (session.status !== 'active') return;
  await db
    .update(studySessions)
    .set({ currentPosition: Math.min(position, session.questionCount - 1), updatedAt: new Date() })
    .where(eq(studySessions.id, sessionId));
}

/**
 * Finalise a session. Idempotent: submitting an already-submitted session returns quietly.
 * Every item becomes graded; skipped/unanswered items are not correct.
 */
export async function submitSession(
  db: Db,
  ownerId: string,
  sessionId: string,
  reason: 'manual' | 'timeout',
): Promise<void> {
  await db.transaction(async (tx) => {
    const session = await loadSession(tx, ownerId, sessionId, true);
    if (session.status === 'submitted') return;
    if (session.status === 'abandoned') throw conflict('This session was abandoned.');
    const now = new Date();
    const timedOut = isPastDeadline(session, now);
    const items = await tx
      .select()
      .from(sessionItems)
      .where(eq(sessionItems.sessionId, sessionId))
      .orderBy(asc(sessionItems.position))
      .for('update');
    const outcomes: { questionId: string | null; isCorrect: boolean }[] = [];
    let correct = 0;
    for (const item of items) {
      if (item.gradedAt) {
        if (item.isCorrect) correct++;
        continue;
      }
      if (item.state === 'answered' && item.answer) {
        const grade = gradeAnswer(item.snapshot, item.answer);
        if (grade.isCorrect) correct++;
        outcomes.push({ questionId: item.questionId, isCorrect: grade.isCorrect });
        await tx
          .update(sessionItems)
          .set({ grade, isCorrect: grade.isCorrect, gradedAt: now, locked: true })
          .where(eq(sessionItems.id, item.id));
      } else {
        await tx
          .update(sessionItems)
          .set({
            isCorrect: false,
            gradedAt: now,
            locked: true,
            state: item.state === 'skipped' ? 'skipped' : 'unanswered',
            answer: null,
          })
          .where(eq(sessionItems.id, item.id));
      }
    }
    const prefs = await getPreferences(tx, ownerId);
    if (prefs.spacedReview) await recordReviewOutcomes(tx, ownerId, outcomes, now);
    const submittedAt = timedOut && session.endsAt ? session.endsAt : now;
    await tx
      .update(studySessions)
      .set({
        status: 'submitted',
        submittedAt,
        submitReason: timedOut ? 'timeout' : reason,
        scoreCorrect: correct,
        scoreTotal: items.length,
        updatedAt: now,
      })
      .where(eq(studySessions.id, sessionId));
  });
}

export async function abandonSession(db: Db, ownerId: string, sessionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const session = await loadSession(tx, ownerId, sessionId, true);
    if (session.status !== 'active') throw conflict('Only active sessions can be abandoned.');
    await tx
      .update(studySessions)
      .set({ status: 'abandoned', updatedAt: new Date() })
      .where(eq(studySessions.id, sessionId));
  });
}

/* ---------- Results & history ---------- */

function durationMs(session: SessionRow): number | null {
  if (!session.submittedAt) return null;
  return Math.max(0, session.submittedAt.getTime() - session.startedAt.getTime());
}

export async function getResult(
  db: Db,
  ownerId: string,
  sessionId: string,
): Promise<SessionResultDto> {
  // getSession finalises an expired exam first.
  await getSession(db, ownerId, sessionId);
  const session = await loadSession(db, ownerId, sessionId);
  if (session.status !== 'submitted')
    throw conflict('Results are available after the session is submitted.');
  const items = await loadItems(db, sessionId);
  const liveIds = items.map((i) => i.questionId).filter((id): id is string => id !== null);
  const live = liveIds.length
    ? await db
        .select({ id: questions.id, revision: questions.revision, status: questions.status })
        .from(questions)
        .where(inArray(questions.id, liveIds))
    : [];
  const liveMap = new Map(live.map((q) => [q.id, q]));
  const resultItems: ResultItemDto[] = items.map((item) => {
    const current = item.questionId ? liveMap.get(item.questionId) : undefined;
    const liveStatus: ResultItemDto['liveStatus'] = !current
      ? 'deleted'
      : current.status === 'archived'
        ? 'archived'
        : current.revision !== item.snapshot.revision
          ? 'edited'
          : 'same';
    return {
      id: item.id,
      position: item.position,
      state: item.state,
      isCorrect: item.isCorrect ?? false,
      markedForReview: item.markedForReview,
      timeSpentMs: item.timeSpentMs,
      answer: item.answer,
      grade: item.grade,
      snapshot: item.snapshot,
      liveStatus,
    };
  });
  const groups = new Map<
    string,
    { label: string; subjectName: string; total: number; correct: number }
  >();
  for (const item of items) {
    const label = item.snapshot.topic?.name ?? item.snapshot.subject.name;
    const key = `${item.snapshot.subject.id}:${item.snapshot.topic?.id ?? ''}`;
    const g = groups.get(key) ?? {
      label,
      subjectName: item.snapshot.subject.name,
      total: 0,
      correct: 0,
    };
    g.total++;
    if (item.isCorrect) g.correct++;
    groups.set(key, g);
  }
  return {
    session: sessionHeader(session, items),
    score: summarizeScore(items),
    durationMs: durationMs(session) ?? 0,
    byTopic: [...groups.values()]
      .map((g) => ({
        ...g,
        percent: g.total ? Math.round((g.correct / g.total) * 1000) / 10 : null,
      }))
      .sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0)),
    items: resultItems,
  };
}

export async function summarize(db: Tx, rows: SessionRow[]): Promise<SessionSummaryDto[]> {
  if (!rows.length) return [];
  const answered = await db
    .select({ sessionId: sessionItems.sessionId, value: count() })
    .from(sessionItems)
    .where(
      and(
        inArray(
          sessionItems.sessionId,
          rows.map((r) => r.id),
        ),
        eq(sessionItems.state, 'answered'),
      ),
    )
    .groupBy(sessionItems.sessionId);
  const answeredMap = new Map(answered.map((a) => [a.sessionId, a.value]));
  return rows.map((s) => ({
    id: s.id,
    mode: s.mode,
    status: s.status,
    title: s.title,
    questionCount: s.questionCount,
    startedAt: s.startedAt.toISOString(),
    submittedAt: iso(s.submittedAt),
    durationMs: durationMs(s),
    correct: s.scoreCorrect,
    percent: s.scoreTotal ? Math.round(((s.scoreCorrect ?? 0) / s.scoreTotal) * 1000) / 10 : null,
    answeredCount: answeredMap.get(s.id) ?? 0,
  }));
}

export async function listSessions(
  db: Db,
  ownerId: string,
  q: {
    mode?: 'practice' | 'exam' | undefined;
    status?: 'active' | 'submitted' | 'abandoned' | undefined;
    page: number;
    pageSize: number;
  },
): Promise<Paginated<SessionSummaryDto>> {
  const where = and(
    eq(studySessions.ownerId, ownerId),
    q.mode ? eq(studySessions.mode, q.mode) : undefined,
    q.status ? eq(studySessions.status, q.status) : undefined,
  );
  const [total] = await db.select({ value: count() }).from(studySessions).where(where);
  const rows = await db
    .select()
    .from(studySessions)
    .where(where)
    .orderBy(desc(studySessions.startedAt))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  return {
    items: await summarize(db, rows),
    page: q.page,
    pageSize: q.pageSize,
    total: total?.value ?? 0,
  };
}

export type { SessionCreateInput };
