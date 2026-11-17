import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateCsvImport, validateJsonImport } from './importFormat.js';

const examples = fileURLToPath(new URL('../../../examples/', import.meta.url));

describe('JSON import', () => {
  it('accepts the bundled sample file', () => {
    const result = validateJsonImport(readFileSync(`${examples}question_bank.sample.json`, 'utf8'));
    expect(result.fatal).toBeNull();
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.every((r) => r.errors.length === 0 && r.question)).toBe(true);
  });
  it('reports a fatal error for non-bank JSON', () => {
    expect(validateJsonImport('{"questions": []}').fatal).toMatch(/Not a Recall Studio/);
    expect(validateJsonImport('not json').fatal).toMatch(/valid JSON/);
  });
  it('reports row-level errors without dropping other rows', () => {
    const file = {
      format: 'recall-studio-question-bank',
      version: 1,
      subject: 'S',
      questions: [
        { type: 'true_false', prompt: 'ok', correctBoolean: true },
        { type: 'true_false', prompt: 'missing boolean' },
        {
          type: 'single_choice',
          prompt: 'bad id',
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
          correctOptionIds: ['z'],
        },
        {
          type: 'fill_gap',
          prompt: 'X {{blank:1}}',
          blanks: [{ key: '2', acceptedAnswers: ['a'] }],
        },
        { type: 'essay', prompt: 'not allowed' },
      ],
    };
    const result = validateJsonImport(JSON.stringify(file));
    expect(result.rows.map((r) => r.errors.length > 0)).toEqual([false, true, true, true, true]);
  });
  it('flags repeated externalIds as errors and repeated prompts as warnings', () => {
    const q = { type: 'true_false', prompt: 'Same', correctBoolean: true, externalId: 'x' };
    const result = validateJsonImport(
      JSON.stringify({
        format: 'recall-studio-question-bank',
        version: 1,
        subject: 'S',
        questions: [q, q, { ...q, externalId: 'y' }],
      }),
    );
    expect(result.rows[1]?.errors[0]).toMatch(/repeats row 1/);
    expect(result.rows[2]?.warnings[0]).toMatch(/Same prompt/);
  });
});

describe('CSV import', () => {
  it('accepts the bundled sample file', () => {
    const result = validateCsvImport(readFileSync(`${examples}question_bank.sample.csv`, 'utf8'));
    expect(result.fatal).toBeNull();
    expect(result.rows.map((r) => r.errors)).toEqual([[], [], []]);
    const fill = result.rows[2]?.question;
    expect(fill?.blanks).toEqual([{ key: '1', acceptedAnswers: ['12', 'twelve'] }]);
    expect(result.rows[1]?.question?.correctBoolean).toBe(true);
  });
  it('rejects missing and unknown columns', () => {
    expect(validateCsvImport('prompt\nx').fatal).toMatch(/Missing/);
    expect(validateCsvImport('type,prompt,bogus\nx,y,z').fatal).toMatch(/Unknown/);
  });
  it('reports bad JSON cells and column count mismatches with line numbers', () => {
    const result = validateCsvImport(
      'type,prompt,subject,correct_answers_json\ntrue_false,P,S,notjson\ntrue_false,Q\n',
    );
    expect(result.rows[0]?.row).toBe(2);
    expect(result.rows[0]?.errors.join(' ')).toMatch(/not valid JSON/);
    expect(result.rows[1]?.errors.join(' ')).toMatch(/Expected 4 columns/);
  });
});

describe('import templates in examples/', () => {
  it('JSON template validates cleanly', () => {
    const r = validateJsonImport(readFileSync(`${examples}import_template.json`, 'utf8'));
    expect(r.fatal).toBeNull();
    expect(r.rows.flatMap((x) => x.errors)).toEqual([]);
  });
  it('CSV template validates cleanly', () => {
    const r = validateCsvImport(readFileSync(`${examples}import_template.csv`, 'utf8'));
    expect(r.fatal).toBeNull();
    expect(r.rows.flatMap((x) => x.errors)).toEqual([]);
  });
});
