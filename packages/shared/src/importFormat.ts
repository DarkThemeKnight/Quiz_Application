import { z } from 'zod';
import { DIFFICULTIES, QUESTION_KINDS, type Difficulty, type QuestionKind } from './domain.js';
import { parseCsv, CsvParseError } from './csv.js';
import { normalizationSchema, validateQuestionContent } from './question.js';
import {
  questionFingerprint,
  type NormalizationOptions,
  DEFAULT_NORMALIZATION,
} from './normalize.js';

/**
 * Import/export file formats. JSON is the canonical, lossless format (also used for export);
 * CSV is a convenience format with JSON-encoded answer columns. See docs/IMPORT_FORMAT.md.
 */
export const BANK_FORMAT_ID = 'recall-studio-question-bank';
export const MAX_IMPORT_QUESTIONS = 5000;

const str = (max: number) => z.string().trim().max(max);

export const importQuestionSchema = z
  .object({
    externalId: str(200).min(1).optional(),
    subject: str(120).min(1).optional(),
    topic: str(120).optional(),
    type: z.enum(QUESTION_KINDS),
    difficulty: z.enum(DIFFICULTIES).default('medium'),
    status: z.enum(['draft', 'published']).default('published'),
    prompt: str(5000).min(1, 'prompt is required'),
    options: z
      .array(z.object({ id: str(64).min(1), text: str(1000).min(1) }).strict())
      .max(10)
      .optional(),
    correctOptionIds: z.array(str(64).min(1)).optional(),
    correctBoolean: z.boolean().optional(),
    blanks: z
      .array(
        z
          .object({ key: str(32).min(1), acceptedAnswers: z.array(str(500).min(1)).min(1).max(30) })
          .strict(),
      )
      .max(20)
      .optional(),
    normalization: normalizationSchema.optional(),
    explanation: str(5000).default(''),
    hint: str(1000).default(''),
    source: str(500).default(''),
    tags: z.array(str(60).min(1)).max(30).default([]),
    collections: z.array(str(120).min(1)).max(30).default([]),
  })
  .strict();

export type ImportQuestionRaw = z.input<typeof importQuestionSchema>;

export const bankFileSchema = z
  .object({
    format: z.literal(BANK_FORMAT_ID),
    version: z.literal(1),
    subject: str(120).min(1).optional(),
    exportedAt: z.string().optional(),
    questions: z.array(z.unknown()).max(MAX_IMPORT_QUESTIONS),
  })
  .loose();

/** A fully validated question ready to be written by the API. */
export interface ImportedQuestion {
  externalId: string | null;
  subjectName: string;
  topicName: string | null;
  kind: QuestionKind;
  difficulty: Difficulty;
  status: 'draft' | 'published';
  body: string;
  options: { body: string; isCorrect: boolean }[];
  correctBoolean: boolean | null;
  blanks: { key: string; acceptedAnswers: string[] }[];
  normalization: NormalizationOptions;
  explanation: string;
  hint: string;
  sourceLabel: string;
  tags: string[];
  collections: string[];
  fingerprint: string;
}

export interface ImportRowResult {
  /** 1-based question number (JSON) or CSV line number of the record. */
  row: number;
  externalId: string | null;
  kind: string | null;
  prompt: string;
  subject: string | null;
  topic: string | null;
  errors: string[];
  warnings: string[];
  question: ImportedQuestion | null;
}

export interface ImportValidation {
  /** Error that prevents reading the file at all (bad JSON, missing columns...). */
  fatal: string | null;
  rows: ImportRowResult[];
}

function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message));
}

function convert(raw: unknown, defaultSubject: string | undefined, row: number): ImportRowResult {
  const base = (r: Record<string, unknown>): ImportRowResult => ({
    row,
    externalId: typeof r.externalId === 'string' ? r.externalId : null,
    kind: typeof r.type === 'string' ? r.type : null,
    prompt: typeof r.prompt === 'string' ? r.prompt.slice(0, 300) : '',
    subject: typeof r.subject === 'string' ? r.subject : (defaultSubject ?? null),
    topic: typeof r.topic === 'string' && r.topic ? r.topic : null,
    errors: [],
    warnings: [],
    question: null,
  });
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...base({}), errors: ['Each question must be an object.'] };
  }
  const result = base(raw as Record<string, unknown>);
  const parsed = importQuestionSchema.safeParse(raw);
  if (!parsed.success) {
    result.errors.push(...formatZodIssues(parsed.error));
    return result;
  }
  const q = parsed.data;
  const subjectName = q.subject ?? defaultSubject;
  if (!subjectName)
    result.errors.push('subject is required (per question or as a file-level default).');

  let options: { body: string; isCorrect: boolean }[] = [];
  if (q.type === 'single_choice' || q.type === 'multi_choice') {
    const opts = q.options ?? [];
    const ids = new Set(opts.map((o) => o.id));
    if (ids.size !== opts.length) result.errors.push('options: option ids must be unique.');
    const correct = q.correctOptionIds ?? [];
    for (const id of correct) {
      if (!ids.has(id))
        result.errors.push(`correctOptionIds: "${id}" does not match any option id.`);
    }
    const correctSet = new Set(correct);
    options = opts.map((o) => ({ body: o.text, isCorrect: correctSet.has(o.id) }));
  } else if (q.options?.length || q.correctOptionIds?.length) {
    result.errors.push(`options/correctOptionIds are only valid for choice questions.`);
  }
  if (q.type !== 'true_false' && q.correctBoolean !== undefined) {
    result.errors.push('correctBoolean is only valid for true_false questions.');
  }
  const normalization = q.normalization ?? DEFAULT_NORMALIZATION;
  const blanks = q.type === 'fill_gap' ? (q.blanks ?? []) : [];
  if (q.type !== 'fill_gap' && q.blanks?.length)
    result.errors.push('blanks are only valid for fill_gap questions.');

  const content = {
    kind: q.type,
    body: q.prompt,
    options,
    correctBoolean: q.type === 'true_false' ? (q.correctBoolean ?? null) : null,
    blanks,
    normalization,
  };
  for (const issue of validateQuestionContent(content)) {
    result.errors.push(
      issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    );
  }
  if (result.errors.length === 0 && subjectName) {
    result.question = {
      externalId: q.externalId ?? null,
      subjectName,
      topicName: q.topic ? q.topic : null,
      kind: q.type,
      difficulty: q.difficulty,
      status: q.status,
      body: q.prompt,
      options,
      correctBoolean: content.correctBoolean,
      blanks,
      normalization,
      explanation: q.explanation,
      hint: q.hint,
      sourceLabel: q.source,
      tags: [...new Set(q.tags)],
      collections: [...new Set(q.collections)],
      fingerprint: questionFingerprint(q.prompt),
    };
  }
  return result;
}

function markInFileDuplicates(rows: ImportRowResult[]): void {
  const byExternal = new Map<string, number>();
  const byPrint = new Map<string, number>();
  for (const r of rows) {
    if (r.externalId) {
      const first = byExternal.get(r.externalId);
      if (first !== undefined) r.errors.push(`externalId "${r.externalId}" repeats row ${first}.`);
      else byExternal.set(r.externalId, r.row);
    }
    if (r.question) {
      const first = byPrint.get(r.question.fingerprint);
      if (first !== undefined) r.warnings.push(`Same prompt as row ${first} in this file.`);
      else byPrint.set(r.question.fingerprint, r.row);
    }
    if (r.errors.length) r.question = null;
  }
}

export function validateJsonImport(content: string, defaultSubject?: string): ImportValidation {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return { fatal: 'File is not valid JSON.', rows: [] };
  }
  const file = bankFileSchema.safeParse(data);
  if (!file.success) {
    return {
      fatal: `Not a Recall Studio question bank file (expected "format": "${BANK_FORMAT_ID}", "version": 1, and a "questions" array of at most ${MAX_IMPORT_QUESTIONS}). ${formatZodIssues(file.error).join('; ')}`,
      rows: [],
    };
  }
  const subject = file.data.subject ?? defaultSubject;
  const rows = file.data.questions.map((q, i) => convert(q, subject, i + 1));
  markInFileDuplicates(rows);
  return { fatal: null, rows };
}

export const CSV_REQUIRED_COLUMNS = ['type', 'prompt'] as const;
export const CSV_COLUMNS = [
  'external_id',
  'subject',
  'topic',
  'type',
  'difficulty',
  'status',
  'prompt',
  'options_json',
  'correct_answers_json',
  'explanation',
  'hint',
  'source',
  'tags',
  'collections',
] as const;

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function validateCsvImport(content: string, defaultSubject?: string): ImportValidation {
  let table: string[][];
  try {
    table = parseCsv(content);
  } catch (e) {
    const msg =
      e instanceof CsvParseError
        ? `CSV error near line ${e.line}: ${e.message}`
        : 'Could not read CSV.';
    return { fatal: msg, rows: [] };
  }
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const missing = CSV_REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length)
    return { fatal: `Missing required column(s): ${missing.join(', ')}.`, rows: [] };
  const unknown = header.filter((h) => !(CSV_COLUMNS as readonly string[]).includes(h));
  if (unknown.length) return { fatal: `Unknown column(s): ${unknown.join(', ')}.`, rows: [] };
  const records = table.slice(1);
  if (records.length > MAX_IMPORT_QUESTIONS) {
    return { fatal: `At most ${MAX_IMPORT_QUESTIONS} questions per import.`, rows: [] };
  }

  const rows = records.map((cells, idx) => {
    const rowNumber = idx + 2;
    const get = (name: string): string | undefined => {
      const i = header.indexOf(name);
      return i >= 0 ? (cells[i] ?? '').trim() : undefined;
    };
    const errors: string[] = [];
    if (cells.length !== header.length) {
      errors.push(`Expected ${header.length} columns but found ${cells.length}.`);
    }
    const parseJsonCell = (name: string): unknown => {
      const raw = get(name);
      if (!raw) return undefined;
      try {
        return JSON.parse(raw);
      } catch {
        errors.push(`${name}: not valid JSON.`);
        return undefined;
      }
    };
    const type = get('type') ?? '';
    const answers = parseJsonCell('correct_answers_json');
    const raw: Record<string, unknown> = {
      type,
      prompt: get('prompt') ?? '',
      explanation: get('explanation') ?? '',
      hint: get('hint') ?? '',
      source: get('source') ?? '',
      tags: splitList(get('tags')),
      collections: splitList(get('collections')),
    };
    const set = (key: string, value: string | undefined) => {
      if (value) raw[key] = value;
    };
    set('externalId', get('external_id'));
    set('subject', get('subject'));
    set('topic', get('topic'));
    set('difficulty', get('difficulty'));
    set('status', get('status'));
    if (type === 'single_choice' || type === 'multi_choice') {
      raw.options = parseJsonCell('options_json');
      raw.correctOptionIds = answers;
    } else if (type === 'true_false') {
      raw.correctBoolean = answers;
    } else if (type === 'fill_gap') {
      if (answers && typeof answers === 'object' && !Array.isArray(answers)) {
        raw.blanks = Object.entries(answers as Record<string, unknown>).map(
          ([key, acceptedAnswers]) => ({
            key,
            acceptedAnswers,
          }),
        );
      } else if (answers !== undefined) {
        errors.push(
          'correct_answers_json: fill_gap expects an object like {"1": ["answer", "alias"]}.',
        );
      }
    }
    const result = convert(raw, defaultSubject, rowNumber);
    if (errors.length) {
      result.errors.unshift(...errors);
      result.question = null;
    }
    return result;
  });
  markInFileDuplicates(rows);
  return { fatal: null, rows };
}
