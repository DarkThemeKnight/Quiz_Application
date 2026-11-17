import { ratio } from './scoring.js';

/**
 * Weak-area ranking (documented in docs/decisions/0004-metrics.md).
 *
 * Input: per-topic counts of *answered* (graded) items within the lookback window.
 * - Topics with fewer than `minAttempts` answers are "limited data" and never ranked as weak.
 * - Eligible topics with accuracy below `threshold` are weak.
 * - Priority = (1 − accuracy) × confidence, where confidence = min(1, attempts / 10).
 *   Ties break on more attempts, then most recent activity.
 */
export interface TopicTally {
  topicId: string | null;
  topicName: string;
  subjectId: string;
  subjectName: string;
  attempts: number;
  correct: number;
  lastAttemptAt: string;
}

export interface RankedTopic extends TopicTally {
  accuracy: number | null;
  status: 'weak' | 'ok' | 'limited_data';
  priority: number;
}

export const WEAK_AREA_DEFAULTS = { minAttempts: 5, threshold: 0.7 } as const;

export function rankTopics(
  tallies: TopicTally[],
  options: { minAttempts?: number; threshold?: number } = {},
): RankedTopic[] {
  const minAttempts = options.minAttempts ?? WEAK_AREA_DEFAULTS.minAttempts;
  const threshold = options.threshold ?? WEAK_AREA_DEFAULTS.threshold;
  return tallies
    .map((t): RankedTopic => {
      const accuracy = ratio(t.correct, t.attempts);
      if (t.attempts < minAttempts || accuracy === null) {
        return { ...t, accuracy, status: 'limited_data', priority: 0 };
      }
      const confidence = Math.min(1, t.attempts / 10);
      return {
        ...t,
        accuracy,
        status: accuracy < threshold ? 'weak' : 'ok',
        priority: (1 - accuracy) * confidence,
      };
    })
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        b.attempts - a.attempts ||
        b.lastAttemptAt.localeCompare(a.lastAttemptAt),
    );
}

/** Default number of sessions in the rolling average on the session trend. */
export const SESSION_ROLLING_WINDOW = 5;

/**
 * Adds a rolling score to each session (input oldest first). The rolling value pools correct and
 * total over the current and previous sessions *of the same mode* — Σcorrect ÷ Σtotal, not an
 * average of percentages — so a 3-question session cannot swing it like a 40-question exam.
 */
export function withRollingScore<T extends { mode: string; correct: number; total: number }>(
  sessions: T[],
  window = SESSION_ROLLING_WINDOW,
): (T & { rollingPercent: number | null; rollingSessions: number })[] {
  const history = new Map<string, { correct: number; total: number }[]>();
  return sessions.map((s) => {
    const list = history.get(s.mode) ?? [];
    list.push({ correct: s.correct, total: s.total });
    if (list.length > window) list.shift();
    history.set(s.mode, list);
    const correct = list.reduce((n, x) => n + x.correct, 0);
    const total = list.reduce((n, x) => n + x.total, 0);
    const r = ratio(correct, total);
    return {
      ...s,
      rollingPercent: r === null ? null : Math.round(r * 1000) / 10,
      rollingSessions: list.length,
    };
  });
}
