/**
 * Spaced review — a simple five-box Leitner schedule.
 *
 * Rule (documented in the UI and docs/decisions/0003-spaced-review.md):
 * - Only *answered* items update the schedule; skipped/unanswered items do not.
 * - Incorrect answer → box 1, due immediately.
 * - Correct answer → move up one box (a never-seen question starts at box 1, so a first correct
 *   answer lands in box 2), max box 5. Due after the box interval below.
 */
export const LEITNER_BOX_INTERVAL_DAYS: Readonly<Record<number, number>> = Object.freeze({
  1: 0,
  2: 1,
  3: 3,
  4: 7,
  5: 21,
});

export const LEITNER_MAX_BOX = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReviewState {
  box: number;
  streak: number;
  nextDueAt: Date;
  lastReviewedAt: Date;
  latestOutcome: boolean;
}

export function nextReviewState(
  previous: Pick<ReviewState, 'box' | 'streak'> | null,
  isCorrect: boolean,
  now: Date,
): ReviewState {
  const prevBox = previous ? Math.min(Math.max(previous.box, 1), LEITNER_MAX_BOX) : 1;
  const box = isCorrect ? Math.min(prevBox + 1, LEITNER_MAX_BOX) : 1;
  const streak = isCorrect ? (previous?.streak ?? 0) + 1 : 0;
  const days = LEITNER_BOX_INTERVAL_DAYS[box] ?? 0;
  return {
    box,
    streak,
    nextDueAt: new Date(now.getTime() + days * DAY_MS),
    lastReviewedAt: now,
    latestOutcome: isCorrect,
  };
}
