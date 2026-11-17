import { asc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import {
  BANK_FORMAT_ID,
  CSV_COLUMNS,
  DEFAULT_NORMALIZATION,
  toCsv,
  validateCsvImport,
  validateJsonImport,
  type ImportCommitDto,
  type ImportPreviewDto,
  type ImportValidation,
  type NormalizationOptions,
  type QuestionKind,
  type importRequestSchema,
} from '@recall/shared';
import type { z } from 'zod';
import type { Db, Tx } from '../db/client.js';
import {
  collectionQuestions,
  collections,
  questionBlanks,
  questionOptions,
  questions,
  questionTags,
  reviewSchedule,
  sessionItems,
  studySessions,
  subjects,
  topics,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { slugify } from '../lib/text.js';
import { buildSnapshots, ensureTags } from './questions.js';

type ImportRequest = z.output<typeof importRequestSchema>;

function runValidation(req: ImportRequest): ImportValidation {
  return req.format === 'json'
    ? validateJsonImport(req.content, req.defaultSubject)
    : validateCsvImport(req.content, req.defaultSubject);
}

const lower = (s: string) => s.trim().toLowerCase();

/** Existing questions that a row duplicates: by externalId (always) or prompt fingerprint. */
async function findExisting(db: Tx, validation: ImportValidation) {
  const externalIds = validation.rows
    .map((r) => r.question?.externalId)
    .filter((x): x is string => !!x);
  const prints = validation.rows
    .map((r) => r.question?.fingerprint)
    .filter((x): x is string => !!x);
  const byExternal = new Map<string, string>();
  const byPrint = new Map<string, string>();
  if (externalIds.length) {
    const found = await db
      .select({ id: questions.id, externalId: questions.externalId })
      .from(questions)
      .where(inArray(questions.externalId, externalIds));
    for (const f of found) if (f.externalId) byExternal.set(f.externalId, f.id);
  }
  if (prints.length) {
    const found = await db
      .select({ id: questions.id, fingerprint: questions.fingerprint })
      .from(questions)
      .where(inArray(questions.fingerprint, [...new Set(prints)]));
    for (const f of found) byPrint.set(f.fingerprint, f.id);
  }
  return { byExternal, byPrint };
}

export async function previewImport(db: Db, req: ImportRequest): Promise<ImportPreviewDto> {
  const validation = runValidation(req);
  const existing = await findExisting(db, validation);
  const subjectRows = await db.select({ id: subjects.id, name: subjects.name }).from(subjects);
  const subjectByName = new Map(subjectRows.map((s) => [lower(s.name), s.id]));
  const topicRows = await db
    .select({ subjectId: topics.subjectId, name: topics.name })
    .from(topics)
    .where(sql`${topics.parentTopicId} is null`);
  const topicKeys = new Set(topicRows.map((t) => `${t.subjectId}:${lower(t.name)}`));

  const newSubjects = new Map<string, string>();
  const newTopics = new Map<string, string>();
  const seenPrint = new Map<string, number>();
  let duplicateRows = 0;
  const rows = validation.rows.map((r) => {
    let duplicateOf: string | null = null;
    let willSkip = false;
    const warnings = [...r.warnings];
    if (r.question) {
      const q = r.question;
      const inFileRow = seenPrint.get(q.fingerprint);
      if (q.externalId && existing.byExternal.has(q.externalId)) {
        duplicateOf = existing.byExternal.get(q.externalId) ?? null;
        willSkip = true;
        warnings.push(
          `externalId "${q.externalId}" is already in the bank — this row will be skipped.`,
        );
      } else if (existing.byPrint.has(q.fingerprint) || inFileRow !== undefined) {
        const inBank = existing.byPrint.has(q.fingerprint);
        duplicateOf = existing.byPrint.get(q.fingerprint) ?? `row:${inFileRow ?? r.row}`;
        if (req.duplicates === 'skip') willSkip = true;
        if (inFileRow !== undefined && !inBank) {
          const msg =
            req.duplicates === 'skip'
              ? `Same prompt as row ${inFileRow} in this file — this row will be skipped.`
              : `Same prompt as row ${inFileRow} in this file — it will be imported anyway.`;
          const generic = warnings.findIndex((w) => w.startsWith('Same prompt as row'));
          if (generic >= 0) warnings[generic] = msg;
          else warnings.push(msg);
        } else {
          warnings.push(
            req.duplicates === 'skip'
              ? 'A question with the same prompt already exists — this row will be skipped.'
              : 'A question with the same prompt already exists — it will be imported anyway.',
          );
        }
      }
      if (willSkip) duplicateRows++;
      // Only prompts that will be written can make a later row a duplicate.
      if (!willSkip) seenPrint.set(q.fingerprint, r.row);
      const subjectId = subjectByName.get(lower(q.subjectName));
      if (!subjectId) newSubjects.set(lower(q.subjectName), q.subjectName);
      if (q.topicName && (!subjectId || !topicKeys.has(`${subjectId}:${lower(q.topicName)}`))) {
        newTopics.set(
          `${lower(q.subjectName)}:${lower(q.topicName)}`,
          `${q.subjectName} › ${q.topicName}`,
        );
      }
    }
    return {
      row: r.row,
      externalId: r.externalId,
      kind: r.kind,
      prompt: r.prompt,
      subject: r.subject,
      topic: r.topic,
      errors: r.errors,
      warnings,
      duplicateOf,
    };
  });
  const errorRows = rows.filter((r) => r.errors.length).length;
  return {
    fatal: validation.fatal ?? (rows.length === 0 ? 'The file contains no questions.' : null),
    totalRows: rows.length,
    validRows: rows.length - errorRows,
    errorRows,
    duplicateRows,
    newSubjects: [...newSubjects.values()],
    newTopics: [...newTopics.values()],
    rows,
  };
}

/**
 * All-or-nothing import: any invalid row aborts before writing; the write itself runs in a
 * single transaction so a database error rolls everything back.
 */
export async function commitImport(db: Db, req: ImportRequest): Promise<ImportCommitDto> {
  const preview = await previewImport(db, req);
  if (preview.fatal || preview.errorRows > 0) {
    throw new AppError(
      422,
      'IMPORT_INVALID',
      preview.fatal ?? `${preview.errorRows} row(s) have errors. Nothing was imported.`,
      {
        errorRows: preview.errorRows,
      },
    );
  }
  const validation = runValidation(req);
  return db.transaction(async (tx) => {
    const existing = await findExisting(tx, validation);
    const subjectCache = new Map<string, string>();
    const topicCache = new Map<string, string>();
    const collectionCache = new Map<string, string>();
    let createdSubjects = 0;
    let createdTopics = 0;
    let imported = 0;
    let skippedDuplicates = 0;

    const subjectId = async (name: string) => {
      const key = lower(name);
      const cached = subjectCache.get(key);
      if (cached) return cached;
      const [found] = await tx
        .select({ id: subjects.id })
        .from(subjects)
        .where(sql`lower(${subjects.name}) = ${key}`);
      let id = found?.id;
      if (!id) {
        const [created] = await tx
          .insert(subjects)
          .values({ name: name.trim(), slug: slugify(name) })
          .returning({ id: subjects.id });
        id = created?.id;
        createdSubjects++;
      }
      if (!id) throw new Error('subject insert failed');
      subjectCache.set(key, id);
      return id;
    };
    const topicId = async (sid: string, name: string) => {
      const key = `${sid}:${lower(name)}`;
      const cached = topicCache.get(key);
      if (cached) return cached;
      const [found] = await tx
        .select({ id: topics.id })
        .from(topics)
        .where(
          sql`${topics.subjectId} = ${sid} and ${topics.parentTopicId} is null and lower(${topics.name}) = ${lower(name)}`,
        );
      let id = found?.id;
      if (!id) {
        const [created] = await tx
          .insert(topics)
          .values({ subjectId: sid, name: name.trim(), slug: slugify(name) })
          .returning({ id: topics.id });
        id = created?.id;
        createdTopics++;
      }
      if (!id) throw new Error('topic insert failed');
      topicCache.set(key, id);
      return id;
    };
    const collectionId = async (name: string) => {
      const key = lower(name);
      const cached = collectionCache.get(key);
      if (cached) return cached;
      const [found] = await tx
        .select({ id: collections.id })
        .from(collections)
        .where(sql`lower(${collections.name}) = ${key}`);
      let id = found?.id;
      if (!id) {
        const [created] = await tx
          .insert(collections)
          .values({ name: name.trim() })
          .returning({ id: collections.id });
        id = created?.id;
      }
      if (!id) throw new Error('collection insert failed');
      collectionCache.set(key, id);
      return id;
    };

    for (const row of validation.rows) {
      const q = row.question;
      if (!q) continue;
      const isExternalDup = !!q.externalId && existing.byExternal.has(q.externalId);
      const isPrintDup = existing.byPrint.has(q.fingerprint);
      if (isExternalDup || (isPrintDup && req.duplicates === 'skip')) {
        skippedDuplicates++;
        continue;
      }
      const sid = await subjectId(q.subjectName);
      const tid = q.topicName ? await topicId(sid, q.topicName) : null;
      const [created] = await tx
        .insert(questions)
        .values({
          subjectId: sid,
          topicId: tid,
          kind: q.kind,
          difficulty: q.difficulty,
          status: q.status,
          reviewStatus: q.reviewStatus,
          body: q.body,
          fingerprint: q.fingerprint,
          explanation: q.explanation,
          hint: q.hint,
          sourceLabel: q.sourceLabel,
          verifiedAt: q.verifiedAt,
          externalId: q.externalId,
          archivedAt: q.status === 'archived' ? new Date() : null,
          config:
            q.kind === 'true_false'
              ? { correctBoolean: q.correctBoolean ?? undefined }
              : q.kind === 'fill_gap'
                ? { normalization: q.normalization }
                : {},
        })
        .returning({ id: questions.id });
      if (!created) throw new Error('question insert failed');
      if (q.options.length) {
        await tx
          .insert(questionOptions)
          .values(q.options.map((o, position) => ({ questionId: created.id, position, ...o })));
      }
      if (q.blanks.length) {
        await tx.insert(questionBlanks).values(
          q.blanks.map((b, position) => ({
            questionId: created.id,
            key: b.key,
            position,
            acceptedAnswers: b.acceptedAnswers,
          })),
        );
      }
      const tagIds = await ensureTags(tx, q.tags);
      if (tagIds.length)
        await tx
          .insert(questionTags)
          .values(tagIds.map((tagId) => ({ questionId: created.id, tagId })));
      for (const c of q.collections) {
        await tx
          .insert(collectionQuestions)
          .values({ collectionId: await collectionId(c), questionId: created.id })
          .onConflictDoNothing();
      }
      existing.byPrint.set(q.fingerprint, created.id);
      if (q.externalId) existing.byExternal.set(q.externalId, created.id);
      imported++;
    }
    return { imported, skippedDuplicates, createdSubjects, createdTopics };
  });
}

/* ---------- Export ---------- */

export interface ExportedQuestion {
  externalId: string;
  subject: string;
  topic?: string;
  type: QuestionKind;
  difficulty: string;
  status: 'draft' | 'published' | 'archived';
  reviewStatus: string;
  verifiedAt?: string | null;
  prompt: string;
  explanation: string;
  hint: string;
  source: string;
  tags: string[];
  collections: string[];
  options?: { id: string; text: string }[];
  correctOptionIds?: string[];
  correctBoolean?: boolean;
  blanks?: { key: string; acceptedAnswers: string[] }[];
  normalization?: NormalizationOptions;
}

export async function exportBank(db: Db, includeArchived: boolean) {
  const rows = await db
    .select({
      id: questions.id,
      externalId: questions.externalId,
      status: questions.status,
      reviewStatus: questions.reviewStatus,
      verifiedAt: questions.verifiedAt,
    })
    .from(questions)
    .where(includeArchived ? undefined : ne(questions.status, 'archived'))
    .orderBy(asc(questions.createdAt), asc(questions.id));
  const ids = rows.map((r) => r.id);
  const snapshots = await buildSnapshots(db, ids);
  const memberships = ids.length
    ? await db
        .select({ questionId: collectionQuestions.questionId, name: collections.name })
        .from(collectionQuestions)
        .innerJoin(collections, eq(collections.id, collectionQuestions.collectionId))
        .where(inArray(collectionQuestions.questionId, ids))
    : [];
  const collectionsOf = new Map<string, string[]>();
  for (const m of memberships)
    collectionsOf.set(m.questionId, [...(collectionsOf.get(m.questionId) ?? []), m.name]);

  const out = rows.flatMap((r): ExportedQuestion[] => {
    const s = snapshots.get(r.id);
    if (!s) return [];
    const optionIds = s.options.map((_, i) => String.fromCharCode(97 + i));
    const base: ExportedQuestion = {
      externalId: r.externalId ?? r.id,
      subject: s.subject.name,
      ...(s.topic ? { topic: s.topic.name } : {}),
      type: s.kind,
      difficulty: s.difficulty,
      status: r.status,
      reviewStatus: r.reviewStatus,
      ...(r.verifiedAt ? { verifiedAt: r.verifiedAt } : {}),
      prompt: s.body,
      explanation: s.explanation,
      hint: s.hint,
      source: s.sourceLabel,
      tags: s.tags,
      collections: collectionsOf.get(r.id) ?? [],
    };
    if (s.kind === 'single_choice' || s.kind === 'multi_choice') {
      return [
        {
          ...base,
          options: s.options.map((o, i) => ({ id: optionIds[i] as string, text: o.body })),
          correctOptionIds: s.options.flatMap((o, i) =>
            o.isCorrect ? [optionIds[i] as string] : [],
          ),
        },
      ];
    }
    if (s.kind === 'true_false') {
      return [
        {
          ...base,
          ...(typeof s.correctBoolean === 'boolean' ? { correctBoolean: s.correctBoolean } : {}),
        },
      ];
    }
    const norm = s.normalization;
    const custom =
      norm.caseSensitive !== DEFAULT_NORMALIZATION.caseSensitive ||
      norm.ignoreAccents ||
      norm.ignorePunctuation;
    return [{ ...base, blanks: s.blanks, ...(custom ? { normalization: norm } : {}) }];
  });
  return {
    format: BANK_FORMAT_ID,
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    questions: out,
  };
}

export async function exportBankCsv(db: Db, includeArchived: boolean): Promise<string> {
  const bank = await exportBank(db, includeArchived);
  const lines: string[][] = [[...CSV_COLUMNS]];
  for (const q of bank.questions) {
    const answers =
      q.correctOptionIds ??
      q.correctBoolean ??
      (q.blanks ? Object.fromEntries(q.blanks.map((b) => [b.key, b.acceptedAnswers])) : null);
    lines.push([
      q.externalId,
      q.subject,
      q.topic ?? '',
      q.type,
      q.difficulty,
      q.status,
      q.prompt,
      q.options ? JSON.stringify(q.options) : '',
      JSON.stringify(answers),
      q.explanation,
      q.hint,
      q.source,
      q.tags.join(';'),
      q.collections.join(';'),
    ]);
  }
  return toCsv(lines);
}

export async function exportProgress(db: Db, ownerId: string) {
  const sessionRows = await db
    .select()
    .from(studySessions)
    .where(eq(studySessions.ownerId, ownerId))
    .orderBy(asc(studySessions.startedAt));
  const itemRows = sessionRows.length
    ? await db
        .select()
        .from(sessionItems)
        .where(
          inArray(
            sessionItems.sessionId,
            sessionRows.map((s) => s.id),
          ),
        )
        .orderBy(asc(sessionItems.sessionId), asc(sessionItems.position))
    : [];
  const review = await db.select().from(reviewSchedule).where(isNotNull(reviewSchedule.questionId));
  return {
    format: 'recall-studio-progress',
    version: 1,
    exportedAt: new Date().toISOString(),
    note: 'Personal study history. Contains your answers — store privately and never commit to Git.',
    sessions: sessionRows.map((s) => ({
      id: s.id,
      mode: s.mode,
      status: s.status,
      title: s.title,
      startedAt: s.startedAt,
      endsAt: s.endsAt,
      submittedAt: s.submittedAt,
      submitReason: s.submitReason,
      questionCount: s.questionCount,
      scoreCorrect: s.scoreCorrect,
      scoreTotal: s.scoreTotal,
      selectionConfig: s.selectionConfig,
      items: itemRows
        .filter((i) => i.sessionId === s.id)
        .map((i) => ({
          position: i.position,
          questionId: i.questionId,
          state: i.state,
          answer: i.answer,
          isCorrect: i.isCorrect,
          timeSpentMs: i.timeSpentMs,
          gradedAt: i.gradedAt,
          snapshot: i.snapshot,
        })),
    })),
    reviewSchedule: review,
  };
}
