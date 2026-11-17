import { z } from 'zod';
import { MAX_OPTIONS } from './domain.js';
import { normalizeAnswer } from './normalize.js';
import type { QuestionSnapshot } from './question.js';

export const answerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('single_choice'), optionId: z.string().min(1).max(64) }).strict(),
  z
    .object({
      kind: z.literal('multi_choice'),
      optionIds: z
        .array(z.string().min(1).max(64))
        .min(1, 'Select at least one option')
        .max(MAX_OPTIONS),
    })
    .strict(),
  // A boolean is required: `null`/missing is never coerced into `false`.
  z.object({ kind: z.literal('true_false'), value: z.boolean() }).strict(),
  z
    .object({
      kind: z.literal('fill_gap'),
      blanks: z.record(z.string().max(32), z.string().max(500)),
    })
    .strict(),
]);

export type Answer = z.infer<typeof answerSchema>;

/**
 * Structural equality for idempotent answer saves.
 * Object key order must not matter: PostgreSQL jsonb reorders keys, and the client
 * rebuilds fill-gap maps in placeholder order.
 */
export function answersEqual(a: Answer | null, b: Answer | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'single_choice':
      return b.kind === 'single_choice' && a.optionId === b.optionId;
    case 'multi_choice': {
      if (b.kind !== 'multi_choice' || a.optionIds.length !== b.optionIds.length) return false;
      const left = [...a.optionIds].sort();
      const right = [...b.optionIds].sort();
      return left.every((id, i) => id === right[i]);
    }
    case 'true_false':
      return b.kind === 'true_false' && a.value === b.value;
    case 'fill_gap': {
      if (b.kind !== 'fill_gap') return false;
      const keys = Object.keys(a.blanks);
      if (keys.length !== Object.keys(b.blanks).length) return false;
      return keys.every((key) => Object.hasOwn(b.blanks, key) && a.blanks[key] === b.blanks[key]);
    }
  }
}

export interface Grade {
  isCorrect: boolean;
  /** Fill-gap only: correctness of each blank by key. */
  perBlank?: Record<string, boolean>;
}

/**
 * Check that an answer is structurally valid for this question (ids exist, keys match).
 * Returns an error message, or null when acceptable.
 */
export function validateAnswerForQuestion(
  snapshot: QuestionSnapshot,
  answer: Answer,
): string | null {
  if (answer.kind !== snapshot.kind)
    return `Answer type ${answer.kind} does not match question type ${snapshot.kind}.`;
  const optionIds = new Set(snapshot.options.map((o) => o.id));
  switch (answer.kind) {
    case 'single_choice':
      return optionIds.has(answer.optionId) ? null : 'Unknown option.';
    case 'multi_choice': {
      if (new Set(answer.optionIds).size !== answer.optionIds.length)
        return 'Duplicate options selected.';
      return answer.optionIds.every((id) => optionIds.has(id)) ? null : 'Unknown option.';
    }
    case 'true_false':
      return null;
    case 'fill_gap': {
      const expected = snapshot.blanks.map((b) => b.key).sort();
      const given = Object.keys(answer.blanks).sort();
      if (expected.length !== given.length || expected.some((k, i) => k !== given[i])) {
        return 'Answer must contain exactly one entry per blank.';
      }
      if (Object.values(answer.blanks).every((v) => v.trim() === ''))
        return 'Enter at least one blank.';
      return null;
    }
  }
}

/**
 * Deterministic grading. `null` (no answer) is never correct.
 * - single_choice: chosen id equals the single correct id.
 * - multi_choice: chosen SET equals correct SET exactly — no partial credit.
 * - true_false: boolean equality.
 * - fill_gap: every blank matches one of its aliases after normalisation.
 */
export function gradeAnswer(snapshot: QuestionSnapshot, answer: Answer | null): Grade {
  if (!answer || answer.kind !== snapshot.kind) return { isCorrect: false };
  switch (answer.kind) {
    case 'single_choice': {
      const correct = snapshot.options.filter((o) => o.isCorrect);
      return { isCorrect: correct.length === 1 && correct[0]?.id === answer.optionId };
    }
    case 'multi_choice': {
      const correct = new Set(snapshot.options.filter((o) => o.isCorrect).map((o) => o.id));
      const chosen = new Set(answer.optionIds);
      const isCorrect =
        correct.size > 0 &&
        chosen.size === correct.size &&
        [...chosen].every((id) => correct.has(id));
      return { isCorrect };
    }
    case 'true_false':
      return {
        isCorrect:
          typeof snapshot.correctBoolean === 'boolean' && answer.value === snapshot.correctBoolean,
      };
    case 'fill_gap': {
      const perBlank: Record<string, boolean> = {};
      for (const blank of snapshot.blanks) {
        const given = answer.blanks[blank.key];
        if (given === undefined) {
          perBlank[blank.key] = false;
          continue;
        }
        const normalizedGiven = normalizeAnswer(given, snapshot.normalization);
        perBlank[blank.key] =
          normalizedGiven !== '' &&
          blank.acceptedAnswers.some(
            (alias) => normalizeAnswer(alias, snapshot.normalization) === normalizedGiven,
          );
      }
      const values = Object.values(perBlank);
      return { isCorrect: values.length > 0 && values.every(Boolean), perBlank };
    }
  }
}
