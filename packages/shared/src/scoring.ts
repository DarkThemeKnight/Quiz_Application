import type { ItemState } from './domain.js';

/** Safe ratio: returns null instead of dividing by zero. */
export function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

export function toPercent(value: number | null, digits = 0): number | null {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * 100 * factor) / factor;
}

export interface ScoreSummary {
  total: number;
  correct: number;
  incorrect: number;
  skipped: number;
  unanswered: number;
  /** correct / total assigned questions (skipped and unanswered stay in the denominator). */
  percent: number | null;
}

/**
 * Session score rule (both modes): correct ÷ assigned questions. Skipped and unanswered
 * items are not correct and remain in the denominator.
 */
export function summarizeScore(
  items: { state: ItemState; isCorrect: boolean | null }[],
): ScoreSummary {
  let correct = 0;
  let incorrect = 0;
  let skipped = 0;
  let unanswered = 0;
  for (const item of items) {
    if (item.state === 'skipped') skipped++;
    else if (item.state === 'unanswered') unanswered++;
    else if (item.isCorrect) correct++;
    else incorrect++;
  }
  const total = items.length;
  return {
    total,
    correct,
    incorrect,
    skipped,
    unanswered,
    percent: toPercent(ratio(correct, total), 1),
  };
}

/** Clamp a measured duration into a realistic, non-negative range (default cap: 30 min). */
export function clampDurationMs(ms: number, maxMs = 30 * 60 * 1000): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.min(Math.round(ms), maxMs);
}
