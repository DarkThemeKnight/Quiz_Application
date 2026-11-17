import { z } from 'zod';
import {
  DIFFICULTIES,
  MAX_ALIASES,
  MAX_BLANKS,
  MAX_OPTIONS,
  MIN_OPTIONS,
  QUESTION_KINDS,
  REVIEW_STATUSES,
  type QuestionKind,
} from './domain.js';
import { validateGapMapping, type GapIssue } from './fillGap.js';
import { DEFAULT_NORMALIZATION, normalizeAnswer, type NormalizationOptions } from './normalize.js';

export const normalizationSchema = z
  .object({
    caseSensitive: z.boolean().default(false),
    ignoreAccents: z.boolean().default(false),
    ignorePunctuation: z.boolean().default(false),
  })
  .strict();

const text = (max: number) => z.string().trim().max(max);

export const optionInputSchema = z
  .object({
    /** Existing option id when editing; omitted for new options. */
    id: z.uuid().optional(),
    body: text(1000).min(1, 'Option text is required'),
    isCorrect: z.boolean(),
  })
  .strict();

export const blankInputSchema = z
  .object({
    key: z.string().trim().min(1).max(32),
    acceptedAnswers: z
      .array(text(500).min(1, 'Accepted answers cannot be empty'))
      .min(1, 'Each blank needs at least one accepted answer')
      .max(MAX_ALIASES),
  })
  .strict();

/** Type-specific content of a question, shared by authoring and import. */
export interface QuestionContent {
  kind: QuestionKind;
  body: string;
  options?: { body: string; isCorrect: boolean }[] | undefined;
  correctBoolean?: boolean | null | undefined;
  blanks?: { key: string; acceptedAnswers: string[] }[] | undefined;
  normalization?: NormalizationOptions | undefined;
}

/** Semantic validation beyond shape: option counts, correct-answer rules, gap mappings. */
export function validateQuestionContent(content: QuestionContent): GapIssue[] {
  const issues: GapIssue[] = [];
  switch (content.kind) {
    case 'single_choice':
    case 'multi_choice': {
      const options = content.options ?? [];
      if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
        issues.push({
          path: ['options'],
          message: `Provide between ${MIN_OPTIONS} and ${MAX_OPTIONS} options.`,
        });
      }
      const correct = options.filter((o) => o.isCorrect).length;
      if (content.kind === 'single_choice' && correct !== 1) {
        issues.push({
          path: ['options'],
          message: 'Single-answer questions need exactly one correct option.',
        });
      }
      if (content.kind === 'multi_choice' && correct < 1) {
        issues.push({ path: ['options'], message: 'Mark at least one correct option.' });
      }
      const seen = new Set<string>();
      options.forEach((o, i) => {
        const key = normalizeAnswer(o.body);
        if (seen.has(key))
          issues.push({ path: ['options', i, 'body'], message: 'Duplicate option text.' });
        seen.add(key);
      });
      if (content.blanks?.length)
        issues.push({ path: ['blanks'], message: 'Choice questions cannot have blanks.' });
      break;
    }
    case 'true_false': {
      if (typeof content.correctBoolean !== 'boolean') {
        issues.push({
          path: ['correctBoolean'],
          message: 'Choose whether the statement is true or false.',
        });
      }
      if (content.options?.length)
        issues.push({ path: ['options'], message: 'True/false questions do not use options.' });
      break;
    }
    case 'fill_gap': {
      const blanks = content.blanks ?? [];
      if (blanks.length > MAX_BLANKS)
        issues.push({ path: ['blanks'], message: `At most ${MAX_BLANKS} blanks.` });
      issues.push(
        ...validateGapMapping(
          content.body,
          blanks.map((b) => b.key),
        ),
      );
      const norm = content.normalization ?? DEFAULT_NORMALIZATION;
      blanks.forEach((b, i) => {
        if (b.acceptedAnswers.length === 0) {
          issues.push({
            path: ['blanks', i, 'acceptedAnswers'],
            message: 'Add at least one accepted answer.',
          });
        }
        b.acceptedAnswers.forEach((a, j) => {
          if (normalizeAnswer(a, norm) === '') {
            issues.push({
              path: ['blanks', i, 'acceptedAnswers', j],
              message: 'Accepted answer is empty after normalisation.',
            });
          }
        });
      });
      if (content.options?.length)
        issues.push({ path: ['options'], message: 'Fill-in questions do not use options.' });
      break;
    }
  }
  return issues;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const questionInputSchema = z
  .object({
    kind: z.enum(QUESTION_KINDS),
    subjectId: z.uuid('Choose a subject'),
    topicId: z.uuid().nullable().default(null),
    difficulty: z.enum(DIFFICULTIES).default('medium'),
    status: z.enum(['draft', 'published']).default('published'),
    body: text(5000).min(1, 'Question text is required'),
    explanation: text(5000).default(''),
    hint: text(1000).default(''),
    sourceLabel: text(500).default(''),
    verifiedAt: isoDate.nullable().default(null),
    reviewStatus: z.enum(REVIEW_STATUSES).default('unreviewed'),
    tagNames: z.array(text(60).min(1)).max(30).default([]),
    collectionIds: z.array(z.uuid()).max(100).default([]),
    options: z.array(optionInputSchema).max(MAX_OPTIONS).default([]),
    correctBoolean: z.boolean().nullable().default(null),
    blanks: z.array(blankInputSchema).max(MAX_BLANKS).default([]),
    normalization: normalizationSchema.default(DEFAULT_NORMALIZATION),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const issue of validateQuestionContent(value)) {
      ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
  });

export type QuestionInput = z.input<typeof questionInputSchema>;
export type QuestionInputParsed = z.output<typeof questionInputSchema>;

/**
 * Immutable copy of a question stored with every session item. It contains the answer key,
 * so the API strips it (see `toPublicQuestion`) until feedback is permitted.
 */
export interface QuestionSnapshot {
  questionId: string;
  revision: number;
  kind: QuestionKind;
  difficulty: (typeof DIFFICULTIES)[number];
  body: string;
  explanation: string;
  hint: string;
  sourceLabel: string;
  subject: { id: string; name: string };
  topic: { id: string; name: string } | null;
  tags: string[];
  options: { id: string; body: string; isCorrect: boolean }[];
  correctBoolean: boolean | null;
  blanks: { key: string; acceptedAnswers: string[] }[];
  normalization: NormalizationOptions;
}

/** What the runner may see before feedback is allowed: no correctness, no explanation. */
export interface PublicQuestion {
  kind: QuestionKind;
  difficulty: (typeof DIFFICULTIES)[number];
  body: string;
  subjectName: string;
  topicName: string | null;
  options: { id: string; body: string }[];
  blankKeys: string[];
  /**
   * Fill-in comparison rules. Null for other kinds. This is not an answer key —
   * the runner uses it so the on-screen instructions match how the answer is graded.
   */
  normalization: NormalizationOptions | null;
  /** Present only in practice mode when the question has a hint. */
  hint: string | null;
}

export function toPublicQuestion(snapshot: QuestionSnapshot, includeHint: boolean): PublicQuestion {
  return {
    kind: snapshot.kind,
    difficulty: snapshot.difficulty,
    body: snapshot.body,
    subjectName: snapshot.subject.name,
    topicName: snapshot.topic?.name ?? null,
    options: snapshot.options.map(({ id, body }) => ({ id, body })),
    blankKeys: snapshot.blanks.map((b) => b.key),
    normalization: snapshot.kind === 'fill_gap' ? snapshot.normalization : null,
    hint: includeHint && snapshot.hint ? snapshot.hint : null,
  };
}
