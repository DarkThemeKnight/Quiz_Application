import { describe, expect, it } from 'vitest';
import { gapBodyToDisplayText, parseGapBody, validateGapMapping } from './fillGap.js';
import { questionInputSchema, toPublicQuestion, validateQuestionContent } from './question.js';
import { nextReviewState } from './leitner.js';
import { clampDurationMs, ratio, summarizeScore } from './scoring.js';
import { rankTopics } from './insights.js';
import { parseCsv, toCsv } from './csv.js';
import { DEFAULT_NORMALIZATION } from './normalize.js';

const SUBJECT = '7d1c8a50-2b9e-4f7e-9b3a-1f0c6c1d2e3f';

describe('fill-gap placeholder parsing', () => {
  it('splits text and blanks', () => {
    const parsed = parseGapBody('A {{blank:1}} B {{blank:x_2}}');
    expect(parsed.keys).toEqual(['1', 'x_2']);
    expect(parsed.segments.map((s) => s.type)).toEqual(['text', 'blank', 'text', 'blank']);
    expect(gapBodyToDisplayText('A {{blank:1}}.')).toBe('A _____.');
  });
  it('accepts a valid one-to-one mapping', () => {
    expect(validateGapMapping('{{blank:1}} and {{blank:2}}', ['1', '2'])).toEqual([]);
  });
  it('rejects missing, extra, duplicate and malformed placeholders', () => {
    expect(validateGapMapping('No blanks here', [])).not.toEqual([]);
    expect(
      validateGapMapping('{{blank:1}}', ['1', '2']).some((i) =>
        /no \{\{blank:2\}\}/.test(i.message),
      ),
    ).toBe(true);
    expect(
      validateGapMapping('{{blank:1}} {{blank:2}}', ['1']).some((i) =>
        /no accepted answers/.test(i.message),
      ),
    ).toBe(true);
    expect(
      validateGapMapping('{{blank:1}} {{blank:1}}', ['1']).some((i) =>
        /more than once/.test(i.message),
      ),
    ).toBe(true);
    expect(
      validateGapMapping('{{ blank:1 }}', ['1']).some((i) => /Malformed/.test(i.message)),
    ).toBe(true);
    expect(
      validateGapMapping('{{blank:}} {{blank:1}}', ['1']).some((i) => /Malformed/.test(i.message)),
    ).toBe(true);
    expect(
      validateGapMapping('{{blank:1}}', ['1', '1']).some((i) => /defined twice/.test(i.message)),
    ).toBe(true);
  });
  it('leaves ordinary braces alone', () => {
    expect(validateGapMapping('In JSON {"a": 1} the key is {{blank:1}}', ['1'])).toEqual([]);
  });
});

describe('question input validation', () => {
  const base = { subjectId: SUBJECT, body: 'Question?' };
  it('single choice needs exactly one correct option', () => {
    const r = questionInputSchema.safeParse({
      ...base,
      kind: 'single_choice',
      options: [
        { body: 'A', isCorrect: true },
        { body: 'B', isCorrect: true },
      ],
    });
    expect(r.success).toBe(false);
  });
  it('multi choice accepts several correct options', () => {
    const r = questionInputSchema.safeParse({
      ...base,
      kind: 'multi_choice',
      options: [
        { body: 'A', isCorrect: true },
        { body: 'B', isCorrect: true },
        { body: 'C', isCorrect: false },
      ],
    });
    expect(r.success).toBe(true);
  });
  it('rejects duplicate option text and too few options', () => {
    expect(
      validateQuestionContent({
        kind: 'single_choice',
        body: 'x',
        options: [
          { body: 'A', isCorrect: true },
          { body: ' a ', isCorrect: false },
        ],
      }),
    ).not.toEqual([]);
    expect(
      validateQuestionContent({
        kind: 'single_choice',
        body: 'x',
        options: [{ body: 'A', isCorrect: true }],
      }),
    ).not.toEqual([]);
  });
  it('true/false requires an explicit boolean', () => {
    expect(questionInputSchema.safeParse({ ...base, kind: 'true_false' }).success).toBe(false);
    expect(
      questionInputSchema.safeParse({ ...base, kind: 'true_false', correctBoolean: false }).success,
    ).toBe(true);
  });
  it('fill gap requires matching blanks', () => {
    expect(
      questionInputSchema.safeParse({
        ...base,
        kind: 'fill_gap',
        body: 'X {{blank:1}}',
        blanks: [{ key: '2', acceptedAnswers: ['a'] }],
      }).success,
    ).toBe(false);
    expect(
      questionInputSchema.safeParse({
        ...base,
        kind: 'fill_gap',
        body: 'X {{blank:1}}',
        blanks: [{ key: '1', acceptedAnswers: ['a'] }],
      }).success,
    ).toBe(true);
  });
  it('rejects unknown fields (strict)', () => {
    expect(
      questionInputSchema.safeParse({ ...base, kind: 'true_false', correctBoolean: true, extra: 1 })
        .success,
    ).toBe(false);
  });
});

describe('public question view', () => {
  it('never exposes correctness, accepted answers or explanation', () => {
    const pub = toPublicQuestion(
      {
        questionId: 'q',
        revision: 1,
        kind: 'fill_gap',
        difficulty: 'easy',
        body: '{{blank:1}}',
        explanation: 'secret explanation',
        hint: 'a hint',
        sourceLabel: '',
        subject: { id: 's', name: 'S' },
        topic: null,
        tags: [],
        options: [{ id: 'o', body: 'x', isCorrect: true }],
        correctBoolean: true,
        blanks: [{ key: '1', acceptedAnswers: ['secret'] }],
        normalization: DEFAULT_NORMALIZATION,
      },
      false,
    );
    const json = JSON.stringify(pub);
    expect(json).not.toMatch(/secret|isCorrect|correctBoolean|acceptedAnswers/);
    expect(pub.hint).toBeNull();
    expect(pub.blankKeys).toEqual(['1']);
  });
});

describe('Leitner schedule', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  it('first correct answer moves to box 2, due in 1 day', () => {
    const s = nextReviewState(null, true, now);
    expect(s.box).toBe(2);
    expect(s.nextDueAt.toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });
  it('incorrect resets to box 1, due now, streak 0', () => {
    const s = nextReviewState({ box: 4, streak: 3 }, false, now);
    expect(s).toMatchObject({ box: 1, streak: 0 });
    expect(s.nextDueAt.getTime()).toBe(now.getTime());
  });
  it('caps at box 5 (21 days)', () => {
    const s = nextReviewState({ box: 5, streak: 9 }, true, now);
    expect(s.box).toBe(5);
    expect(s.streak).toBe(10);
    expect(s.nextDueAt.toISOString()).toBe('2026-01-22T00:00:00.000Z');
  });
});

describe('scoring', () => {
  it('counts skipped and unanswered in the denominator', () => {
    const s = summarizeScore([
      { state: 'answered', isCorrect: true },
      { state: 'answered', isCorrect: false },
      { state: 'skipped', isCorrect: false },
      { state: 'unanswered', isCorrect: null },
    ]);
    expect(s).toEqual({
      total: 4,
      correct: 1,
      incorrect: 1,
      skipped: 1,
      unanswered: 1,
      percent: 25,
    });
  });
  it('never divides by zero', () => {
    expect(summarizeScore([]).percent).toBeNull();
    expect(ratio(3, 0)).toBeNull();
  });
  it('clamps durations to non-negative realistic values', () => {
    expect(clampDurationMs(-5)).toBe(0);
    expect(clampDurationMs(Number.NaN)).toBe(0);
    expect(clampDurationMs(10 ** 12)).toBe(30 * 60 * 1000);
  });
});

describe('weak-area ranking', () => {
  const t = (name: string, attempts: number, correct: number, last = '2026-01-01') => ({
    topicId: name,
    topicName: name,
    subjectId: 's',
    subjectName: 'S',
    attempts,
    correct,
    lastAttemptAt: last,
  });
  it('marks small samples as limited data and never weak', () => {
    const [r] = rankTopics([t('tiny', 3, 0)]);
    expect(r?.status).toBe('limited_data');
  });
  it('ranks low accuracy with more evidence first', () => {
    const ranked = rankTopics([t('ok', 10, 9), t('weak-small', 5, 2), t('weak-big', 20, 8)]);
    expect(ranked.map((r) => r.topicId)).toEqual(['weak-big', 'weak-small', 'ok']);
    expect(ranked[0]?.status).toBe('weak');
    expect(ranked[2]?.status).toBe('ok');
  });
});

describe('CSV', () => {
  it('parses quotes, escaped quotes, embedded newlines and CRLF', () => {
    const rows = parseCsv('﻿a,b,c\r\n"x, y","he said ""hi""","line1\nline2"\r\n\r\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'he said "hi"', 'line1\nline2'],
    ]);
  });
  it('rejects unterminated quotes', () => {
    expect(() => parseCsv('a,"b\n')).toThrow(/Unterminated/);
  });
  it('round-trips through toCsv', () => {
    const data = [
      ['id', 'text'],
      ['1', 'comma, "quote"\nnewline'],
    ];
    expect(parseCsv(toCsv(data))).toEqual(data);
  });
});
