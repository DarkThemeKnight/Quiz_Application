/** Core domain enumerations shared by API, web and tests. */

export const QUESTION_KINDS = ['single_choice', 'multi_choice', 'true_false', 'fill_gap'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
  single_choice: 'Multiple choice (one answer)',
  multi_choice: 'Multiple choice (select all)',
  true_false: 'True / false',
  fill_gap: 'Fill in the gap',
};

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Draft questions are excluded from sessions; archived questions are hidden but kept for history. */
export const QUESTION_STATUSES = ['draft', 'published', 'archived'] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const REVIEW_STATUSES = ['unreviewed', 'verified', 'needs_update'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const SESSION_MODES = ['practice', 'exam'] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

/**
 * Session lifecycle. Sessions are created directly as `active` (setup happens client-side);
 * `submitted` is terminal and immutable; `abandoned` is terminal without scoring.
 */
export const SESSION_STATUSES = ['active', 'submitted', 'abandoned'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/**
 * Per-item state.
 * - `unanswered`: never answered (and not skipped) — counts as not correct at submission.
 * - `answered`: has an answer (graded immediately in practice, at submission in exam).
 * - `skipped`: the user explicitly skipped it — counts as not correct at submission.
 */
export const ITEM_STATES = ['unanswered', 'answered', 'skipped'] as const;
export type ItemState = (typeof ITEM_STATES)[number];

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const MAX_OPTIONS = 10;
export const MIN_OPTIONS = 2;
export const MAX_BLANKS = 20;
export const MAX_ALIASES = 30;
export const MAX_SESSION_QUESTIONS = 200;
export const MAX_EXAM_MINUTES = 600;
