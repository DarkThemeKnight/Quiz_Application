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
