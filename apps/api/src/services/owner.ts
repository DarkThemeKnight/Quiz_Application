import { eq, inArray, sql } from 'drizzle-orm';
import { DEFAULT_PREFERENCES, nextReviewState, type Preferences } from '@recall/shared';
import type { Db, Tx } from '../db/client.js';
import { owners, questions, reviewSchedule } from '../db/schema.js';

export async function getPreferences(tx: Tx, ownerId: string): Promise<Preferences> {
  const [row] = await tx
    .select({ preferences: owners.preferences })
    .from(owners)
    .where(eq(owners.id, ownerId));
  return { ...DEFAULT_PREFERENCES, ...(row?.preferences ?? {}) };
}

/**
 * Apply the Leitner rule for answered items. Skipped/unanswered items never reach here.
 * Questions that were deleted since the session started are ignored.
 */
export async function recordReviewOutcomes(
  tx: Tx,
  ownerId: string,
  outcomes: { questionId: string | null; isCorrect: boolean }[],
  now: Date,
): Promise<void> {
  const relevant = outcomes.filter(
    (o): o is { questionId: string; isCorrect: boolean } => o.questionId !== null,
  );
  if (!relevant.length) return;
  const existingQuestions = await tx
    .select({ id: questions.id })
    .from(questions)
    .where(inArray(questions.id, [...new Set(relevant.map((o) => o.questionId))]));
  const alive = new Set(existingQuestions.map((q) => q.id));
  for (const outcome of relevant) {
    if (!alive.has(outcome.questionId)) continue;
    const [prev] = await tx
      .select()
      .from(reviewSchedule)
      .where(eq(reviewSchedule.questionId, outcome.questionId))
      .for('update');
    const next = nextReviewState(prev ?? null, outcome.isCorrect, now);
    await tx
      .insert(reviewSchedule)
      .values({
        questionId: outcome.questionId,
        ownerId,
        ...next,
        attempts: 1,
        correct: outcome.isCorrect ? 1 : 0,
      })
      .onConflictDoUpdate({
        target: reviewSchedule.questionId,
        set: {
          ...next,
          attempts: sql`${reviewSchedule.attempts} + 1`,
          correct: sql`${reviewSchedule.correct} + ${outcome.isCorrect ? 1 : 0}`,
        },
      });
  }
}

/** Put questions in box 1, due now — the "schedule for review" action on results. */
export async function scheduleForReview(
  db: Db,
  ownerId: string,
  questionIds: string[],
): Promise<number> {
  const ids = [...new Set(questionIds)];
  if (!ids.length) return 0;
  const alive = await db
    .select({ id: questions.id })
    .from(questions)
    .where(inArray(questions.id, ids));
  const now = new Date();
  for (const { id } of alive) {
    await db
      .insert(reviewSchedule)
      .values({
        questionId: id,
        ownerId,
        box: 1,
        streak: 0,
        lastReviewedAt: now,
        nextDueAt: now,
        latestOutcome: false,
      })
      .onConflictDoUpdate({
        target: reviewSchedule.questionId,
        set: { box: 1, streak: 0, nextDueAt: now },
      });
  }
  return alive.length;
}
