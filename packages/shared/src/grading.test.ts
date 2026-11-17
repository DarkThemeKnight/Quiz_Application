import { describe, expect, it } from 'vitest';
import { answerSchema, answersEqual, gradeAnswer, validateAnswerForQuestion } from './grading.js';
import { DEFAULT_NORMALIZATION, normalizeAnswer } from './normalize.js';
import type { QuestionSnapshot } from './question.js';

function snap(
  partial: Partial<QuestionSnapshot> & Pick<QuestionSnapshot, 'kind'>,
): QuestionSnapshot {
  return {
    questionId: 'q1',
    revision: 1,
    difficulty: 'easy',
    body: 'Body',
    explanation: '',
    hint: '',
    sourceLabel: '',
    subject: { id: 's', name: 'Subject' },
    topic: null,
    tags: [],
    options: [],
    correctBoolean: null,
    blanks: [],
    normalization: DEFAULT_NORMALIZATION,
    ...partial,
  };
}

const single = snap({
  kind: 'single_choice',
  options: [
    { id: 'a', body: 'RAM', isCorrect: true },
    { id: 'b', body: 'SSD', isCorrect: false },
    { id: 'c', body: 'GPU', isCorrect: false },
  ],
});

const multi = snap({
  kind: 'multi_choice',
  options: [
    { id: 'a', body: '2', isCorrect: true },
    { id: 'b', body: '9', isCorrect: false },
    { id: 'c', body: '11', isCorrect: true },
    { id: 'd', body: '15', isCorrect: false },
  ],
});

describe('single choice', () => {
  it('accepts the single correct option', () => {
    expect(gradeAnswer(single, { kind: 'single_choice', optionId: 'a' }).isCorrect).toBe(true);
  });
  it('rejects a wrong option', () => {
    expect(gradeAnswer(single, { kind: 'single_choice', optionId: 'b' }).isCorrect).toBe(false);
  });
  it('rejects unknown options at validation', () => {
    expect(validateAnswerForQuestion(single, { kind: 'single_choice', optionId: 'zz' })).toMatch(
      /Unknown/,
    );
  });
  it('treats no answer as incorrect', () => {
    expect(gradeAnswer(single, null).isCorrect).toBe(false);
  });
});

describe('multiple choice (exact set)', () => {
  it('accepts exactly the correct set in any order', () => {
    expect(gradeAnswer(multi, { kind: 'multi_choice', optionIds: ['c', 'a'] }).isCorrect).toBe(
      true,
    );
  });
  it('gives no partial credit for a subset', () => {
    expect(gradeAnswer(multi, { kind: 'multi_choice', optionIds: ['a'] }).isCorrect).toBe(false);
  });
  it('rejects a superset', () => {
    expect(gradeAnswer(multi, { kind: 'multi_choice', optionIds: ['a', 'b', 'c'] }).isCorrect).toBe(
      false,
    );
  });
  it('rejects duplicate ids at validation', () => {
    expect(
      validateAnswerForQuestion(multi, { kind: 'multi_choice', optionIds: ['a', 'a'] }),
    ).toMatch(/Duplicate/);
  });
  it('schema rejects empty selection', () => {
    expect(answerSchema.safeParse({ kind: 'multi_choice', optionIds: [] }).success).toBe(false);
  });
});

describe('true / false', () => {
  const tfFalse = snap({ kind: 'true_false', correctBoolean: false });
  it('false answer is correct when the statement is false', () => {
    expect(gradeAnswer(tfFalse, { kind: 'true_false', value: false }).isCorrect).toBe(true);
  });
  it('unanswered never counts as false', () => {
    expect(gradeAnswer(tfFalse, null).isCorrect).toBe(false);
  });
  it('schema rejects null, strings and missing values', () => {
    expect(answerSchema.safeParse({ kind: 'true_false', value: null }).success).toBe(false);
    expect(answerSchema.safeParse({ kind: 'true_false', value: 'false' }).success).toBe(false);
    expect(answerSchema.safeParse({ kind: 'true_false' }).success).toBe(false);
  });
  it('a question with no stored boolean can never be answered correctly', () => {
    const broken = snap({ kind: 'true_false', correctBoolean: null });
    expect(gradeAnswer(broken, { kind: 'true_false', value: false }).isCorrect).toBe(false);
  });
});

describe('fill in the gap', () => {
  const one = snap({
    kind: 'fill_gap',
    body: 'The capital of France is {{blank:1}}.',
    blanks: [{ key: '1', acceptedAnswers: ['Paris'] }],
  });
  const two = snap({
    kind: 'fill_gap',
    body: '{{blank:1}} and {{blank:2}}',
    blanks: [
      { key: '1', acceptedAnswers: ['Na', 'sodium'] },
      { key: '2', acceptedAnswers: ['K'] },
    ],
  });

  it('accepts case and whitespace variants', () => {
    expect(gradeAnswer(one, { kind: 'fill_gap', blanks: { '1': '  pARis  ' } }).isCorrect).toBe(
      true,
    );
  });
  it('rejects near misses (no fuzzy matching)', () => {
    expect(gradeAnswer(one, { kind: 'fill_gap', blanks: { '1': 'Pari' } }).isCorrect).toBe(false);
    expect(gradeAnswer(one, { kind: 'fill_gap', blanks: { '1': 'Paris.' } }).isCorrect).toBe(false);
  });
  it('accepts any configured alias', () => {
    expect(
      gradeAnswer(two, { kind: 'fill_gap', blanks: { '1': 'Sodium', '2': 'k' } }).isCorrect,
    ).toBe(true);
  });
  it('treats the same blanks as equal regardless of key order', () => {
    const answer = { kind: 'fill_gap' as const, blanks: { o: 'OXYGEN', h: ' h ' } };
    const stored = { kind: 'fill_gap' as const, blanks: { h: ' h ', o: 'OXYGEN' } };
    expect(answersEqual(answer, stored)).toBe(true);
    expect(answersEqual(answer, { kind: 'fill_gap', blanks: { h: 'h', o: 'OXYGEN' } })).toBe(false);
  });
  it('requires every blank to be correct and reports per blank', () => {
    const grade = gradeAnswer(two, { kind: 'fill_gap', blanks: { '1': 'Na', '2': 'Ca' } });
    expect(grade.isCorrect).toBe(false);
    expect(grade.perBlank).toEqual({ '1': true, '2': false });
  });
  it('empty blank is never correct', () => {
    const blankAlias = snap({
      kind: 'fill_gap',
      body: '{{blank:1}}',
      blanks: [{ key: '1', acceptedAnswers: [' '] }],
    });
    expect(gradeAnswer(blankAlias, { kind: 'fill_gap', blanks: { '1': '' } }).isCorrect).toBe(
      false,
    );
  });
  it('validation requires exactly the blank keys', () => {
    expect(validateAnswerForQuestion(two, { kind: 'fill_gap', blanks: { '1': 'Na' } })).toMatch(
      /exactly/,
    );
    expect(
      validateAnswerForQuestion(two, {
        kind: 'fill_gap',
        blanks: { '1': 'Na', '2': 'K', '3': 'x' },
      }),
    ).toMatch(/exactly/);
    expect(
      validateAnswerForQuestion(two, { kind: 'fill_gap', blanks: { '1': ' ', '2': '' } }),
    ).toMatch(/at least one/);
    expect(
      validateAnswerForQuestion(two, { kind: 'fill_gap', blanks: { '1': 'Na', '2': '' } }),
    ).toBeNull();
  });
  it('keeps accents, digits and symbols significant by default', () => {
    const accent = snap({
      kind: 'fill_gap',
      body: '{{blank:a}}',
      blanks: [{ key: 'a', acceptedAnswers: ['café'] }],
    });
    expect(gradeAnswer(accent, { kind: 'fill_gap', blanks: { a: 'cafe' } }).isCorrect).toBe(false);
    expect(gradeAnswer(accent, { kind: 'fill_gap', blanks: { a: 'CAFÉ' } }).isCorrect).toBe(true);
    const digits = snap({
      kind: 'fill_gap',
      body: '{{blank:a}}',
      blanks: [{ key: 'a', acceptedAnswers: ['C3PO'] }],
    });
    expect(gradeAnswer(digits, { kind: 'fill_gap', blanks: { a: 'CPO' } }).isCorrect).toBe(false);
  });
  it('honours per-question opt-in normalisation', () => {
    const relaxed = snap({
      kind: 'fill_gap',
      body: '{{blank:a}}',
      blanks: [{ key: 'a', acceptedAnswers: ['café au lait'] }],
      normalization: { caseSensitive: false, ignoreAccents: true, ignorePunctuation: true },
    });
    expect(
      gradeAnswer(relaxed, { kind: 'fill_gap', blanks: { a: 'Cafe, au-lait!' } }).isCorrect,
    ).toBe(true);
    const strictCase = snap({
      kind: 'fill_gap',
      body: '{{blank:a}}',
      blanks: [{ key: 'a', acceptedAnswers: ['pH'] }],
      normalization: { caseSensitive: true, ignoreAccents: false, ignorePunctuation: false },
    });
    expect(gradeAnswer(strictCase, { kind: 'fill_gap', blanks: { a: 'PH' } }).isCorrect).toBe(
      false,
    );
    expect(gradeAnswer(strictCase, { kind: 'fill_gap', blanks: { a: 'pH' } }).isCorrect).toBe(true);
  });
  it('normalises Unicode compatibility forms (NFKC)', () => {
    // Full-width letters and the "ﬁ" ligature are NFKC-equivalent to ASCII.
    expect(normalizeAnswer('ＰＡＲＩＳ')).toBe('paris');
    expect(normalizeAnswer('ﬁle')).toBe('file');
    expect(normalizeAnswer('a \t\n b')).toBe('a b');
  });
});

describe('kind mismatch', () => {
  it('is incorrect and invalid', () => {
    expect(gradeAnswer(single, { kind: 'true_false', value: true }).isCorrect).toBe(false);
    expect(validateAnswerForQuestion(single, { kind: 'true_false', value: true })).toMatch(
      /does not match/,
    );
  });
});
