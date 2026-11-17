import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  DEFAULT_NORMALIZATION,
  questionFingerprint,
  type DuplicateCandidate,
  type QuestionDetailDto,
  type QuestionInputParsed,
  type QuestionSnapshot,
  type QuestionSummaryDto,
  type Paginated,
  type QuestionStatsDto,
  type questionListQuerySchema,
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
  sessionItems,
  subjects,
  tags,
  topics,
  type QuestionConfig,
} from '../db/schema.js';
import { AppError, conflict, notFound } from '../errors.js';
import { escapeLike, iso } from '../lib/text.js';

type ListQuery = z.output<typeof questionListQuerySchema>;

/* ---------- Tags ---------- */

/** Resolve tag names to ids, creating missing tags (case-insensitive reuse). */
export async function ensureTags(tx: Tx, names: string[]): Promise<string[]> {
  // Keep the first spelling of each case-insensitive name.
  const byKey = new Map<string, string>();
  for (const raw of names) {
    const name = raw.trim();
    if (name && !byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), name);
  }
  const unique = [...byKey.values()];
  if (unique.length === 0) return [];
  const ids: string[] = [];
  for (const name of unique) {
    const inserted = await tx
      .insert(tags)
      .values({ name })
      .onConflictDoNothing()
      .returning({ id: tags.id });
    if (inserted[0]) {
      ids.push(inserted[0].id);
      continue;
    }
    const existing = await tx
      .select({ id: tags.id })
      .from(tags)
      .where(sql`lower(${tags.name}) = lower(${name})`)
      .limit(1);
    if (existing[0]) ids.push(existing[0].id);
  }
  return ids;
}

/* ---------- Validation helpers ---------- */

async function assertSubjectAndTopic(
  tx: Tx,
  subjectId: string,
  topicId: string | null,
): Promise<void> {
  const subject = await tx
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.id, subjectId))
    .limit(1);
  if (!subject[0])
    throw new AppError(400, 'VALIDATION_ERROR', 'Subject does not exist.', [
      { path: 'subjectId', message: 'Unknown subject' },
    ]);
  if (topicId) {
    const topic = await tx
      .select({ subjectId: topics.subjectId })
      .from(topics)
      .where(eq(topics.id, topicId))
      .limit(1);
    if (!topic[0] || topic[0].subjectId !== subjectId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Topic does not belong to the chosen subject.', [
        { path: 'topicId', message: 'Topic must belong to the subject' },
      ]);
    }
  }
}

async function assertCollections(tx: Tx, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const found = await tx
    .select({ id: collections.id })
    .from(collections)
    .where(inArray(collections.id, ids));
  if (found.length !== new Set(ids).size)
    throw new AppError(400, 'VALIDATION_ERROR', 'Unknown collection.');
}

function configFor(input: QuestionInputParsed): QuestionConfig {
  if (input.kind === 'true_false') return { correctBoolean: input.correctBoolean ?? undefined };
  if (input.kind === 'fill_gap') return { normalization: input.normalization };
  return {};
}

/** Fields whose change makes a new content revision. */
function contentSignature(q: {
  kind: string;
  body: string;
  explanation: string;
  hint: string;
  difficulty: string;
  subjectId: string;
  topicId: string | null;
  options: { body: string; isCorrect: boolean }[];
  blanks: { key: string; acceptedAnswers: string[] }[];
  config: QuestionConfig;
}): string {
  return JSON.stringify([
    q.kind,
    q.body,
    q.explanation,
    q.hint,
    q.difficulty,
    q.subjectId,
    q.topicId,
    q.options.map((o) => [o.body, o.isCorrect]),
    q.blanks.map((b) => [b.key, b.acceptedAnswers]),
    q.config.correctBoolean ?? null,
    q.config.normalization ?? null,
  ]);
}

async function writeParts(tx: Tx, questionId: string, input: QuestionInputParsed): Promise<void> {
  await tx.delete(questionOptions).where(eq(questionOptions.questionId, questionId));
  await tx.delete(questionBlanks).where(eq(questionBlanks.questionId, questionId));
  await tx.delete(questionTags).where(eq(questionTags.questionId, questionId));
  if (input.kind === 'single_choice' || input.kind === 'multi_choice') {
    await tx.insert(questionOptions).values(
      input.options.map((o, position) => ({
        ...(o.id ? { id: o.id } : {}),
        questionId,
        position,
        body: o.body,
        isCorrect: o.isCorrect,
      })),
    );
  }
  if (input.kind === 'fill_gap') {
    await tx.insert(questionBlanks).values(
      input.blanks.map((b, position) => ({
        questionId,
        key: b.key,
        position,
        acceptedAnswers: [...new Set(b.acceptedAnswers)],
      })),
    );
  }
  const tagIds = await ensureTags(tx, input.tagNames);
  if (tagIds.length)
    await tx.insert(questionTags).values(tagIds.map((tagId) => ({ questionId, tagId })));
}

async function setCollections(tx: Tx, questionId: string, collectionIds: string[]): Promise<void> {
  await tx.delete(collectionQuestions).where(eq(collectionQuestions.questionId, questionId));
  const unique = [...new Set(collectionIds)];
  if (unique.length) {
    await tx
      .insert(collectionQuestions)
      .values(unique.map((collectionId) => ({ collectionId, questionId })));
  }
}

/* ---------- Create / update ---------- */

export async function createQuestion(
  db: Db,
  input: QuestionInputParsed,
  extra: { externalId?: string | null } = {},
): Promise<string> {
  return db.transaction(async (tx) => {
    await assertSubjectAndTopic(tx, input.subjectId, input.topicId);
    await assertCollections(tx, input.collectionIds);
    const [row] = await tx
      .insert(questions)
      .values({
        subjectId: input.subjectId,
        topicId: input.topicId,
        kind: input.kind,
        difficulty: input.difficulty,
        status: input.status,
        reviewStatus: input.reviewStatus,
        body: input.body,
        fingerprint: questionFingerprint(input.body),
        explanation: input.explanation,
        hint: input.hint,
        sourceLabel: input.sourceLabel,
        verifiedAt: input.verifiedAt,
        externalId: extra.externalId ?? null,
        config: configFor(input),
      })
      .returning({ id: questions.id });
    if (!row) throw new Error('insert failed');
    // Option ids from a client are ignored on create; new ids are generated.
    await writeParts(tx, row.id, {
      ...input,
      options: input.options.map(({ body, isCorrect }) => ({ body, isCorrect })),
    });
    await setCollections(tx, row.id, input.collectionIds);
    return row.id;
  });
}

export async function updateQuestion(
  db: Db,
  id: string,
  input: QuestionInputParsed,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(questions).where(eq(questions.id, id)).for('update');
    if (!current) throw notFound('Question');
    if (current.status === 'archived') throw conflict('Restore the question before editing it.');
    await assertSubjectAndTopic(tx, input.subjectId, input.topicId);
    await assertCollections(tx, input.collectionIds);

    const before = await loadParts(tx, [id]);
    const oldSig = contentSignature({
      ...current,
      options: before.options.get(id) ?? [],
      blanks: before.blanks.get(id) ?? [],
    });
    const config = configFor(input);
    const newSig = contentSignature({
      ...input,
      options: input.kind === 'single_choice' || input.kind === 'multi_choice' ? input.options : [],
      blanks: input.kind === 'fill_gap' ? input.blanks : [],
      config,
    });
    // Option ids are only reused when they belonged to this question.
    const ownIds = new Set((before.options.get(id) ?? []).map((o) => o.id));
    const options = input.options.map((o) =>
      o.id && ownIds.has(o.id) ? o : { body: o.body, isCorrect: o.isCorrect },
    );

    await tx
      .update(questions)
      .set({
        subjectId: input.subjectId,
        topicId: input.topicId,
        kind: input.kind,
        difficulty: input.difficulty,
        status: input.status,
        reviewStatus: input.reviewStatus,
        body: input.body,
        fingerprint: questionFingerprint(input.body),
        explanation: input.explanation,
        hint: input.hint,
        sourceLabel: input.sourceLabel,
        verifiedAt: input.verifiedAt,
        config,
        revision: oldSig === newSig ? current.revision : current.revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(questions.id, id));
    await writeParts(tx, id, { ...input, options });
    await setCollections(tx, id, input.collectionIds);
  });
}

export async function setArchived(db: Db, id: string, archived: boolean): Promise<void> {
  const [row] = await db.select().from(questions).where(eq(questions.id, id));
  if (!row) throw notFound('Question');
  const now = new Date();
  if (archived) {
    if (row.status === 'archived') return;
    const config: QuestionConfig = {
      ...row.config,
      statusBeforeArchive: row.status === 'draft' ? 'draft' : 'published',
    };
    await db
      .update(questions)
      .set({ status: 'archived', archivedAt: now, updatedAt: now, config })
      .where(eq(questions.id, id));
    return;
  }
  if (row.status !== 'archived') return;
  const restore = row.config.statusBeforeArchive === 'draft' ? 'draft' : 'published';
  const config: QuestionConfig = { ...row.config };
  delete config.statusBeforeArchive;
  await db
    .update(questions)
    .set({ status: restore, archivedAt: null, updatedAt: now, config })
    .where(eq(questions.id, id));
}

/** Permanent deletion is only allowed for archived questions. History keeps its snapshots. */
export async function deleteQuestion(db: Db, id: string): Promise<void> {
  const [row] = await db
    .select({ status: questions.status })
    .from(questions)
    .where(eq(questions.id, id));
  if (!row) throw notFound('Question');
  if (row.status !== 'archived')
    throw conflict('Archive the question before deleting it permanently.');
  await db.delete(questions).where(eq(questions.id, id));
}

/* ---------- Reads ---------- */

async function loadParts(tx: Tx, ids: string[]) {
  const options = new Map<
    string,
    { id: string; body: string; isCorrect: boolean; position: number }[]
  >();
  const blanks = new Map<string, { key: string; acceptedAnswers: string[] }[]>();
  const tagNames = new Map<string, string[]>();
  if (!ids.length) return { options, blanks, tagNames };
  // Sequential on purpose: `tx` may be a single transaction connection, which cannot run
  // concurrent queries (pg warns now and will reject it in pg@9).
  const optRows = await tx
    .select()
    .from(questionOptions)
    .where(inArray(questionOptions.questionId, ids))
    .orderBy(asc(questionOptions.position));
  const blankRows = await tx
    .select()
    .from(questionBlanks)
    .where(inArray(questionBlanks.questionId, ids))
    .orderBy(asc(questionBlanks.position));
  const tagRows = await tx
    .select({ questionId: questionTags.questionId, name: tags.name })
    .from(questionTags)
    .innerJoin(tags, eq(tags.id, questionTags.tagId))
    .where(inArray(questionTags.questionId, ids))
    .orderBy(asc(tags.name));
  for (const o of optRows) {
    const list = options.get(o.questionId) ?? [];
    list.push({ id: o.id, body: o.body, isCorrect: o.isCorrect, position: o.position });
    options.set(o.questionId, list);
  }
  for (const b of blankRows) {
    const list = blanks.get(b.questionId) ?? [];
    list.push({ key: b.key, acceptedAnswers: b.acceptedAnswers });
    blanks.set(b.questionId, list);
  }
  for (const t of tagRows) {
    const list = tagNames.get(t.questionId) ?? [];
    list.push(t.name);
    tagNames.set(t.questionId, list);
  }
  return { options, blanks, tagNames };
}

const summaryColumns = {
  id: questions.id,
  kind: questions.kind,
  difficulty: questions.difficulty,
  status: questions.status,
  reviewStatus: questions.reviewStatus,
  body: questions.body,
  explanation: questions.explanation,
  revision: questions.revision,
  updatedAt: questions.updatedAt,
  subjectId: subjects.id,
  subjectName: subjects.name,
  topicId: topics.id,
  topicName: topics.name,
};

type SummaryRow = {
  id: string;
  kind: QuestionSummaryDto['kind'];
  difficulty: QuestionSummaryDto['difficulty'];
  status: QuestionSummaryDto['status'];
  reviewStatus: QuestionSummaryDto['reviewStatus'];
  body: string;
  explanation: string;
  revision: number;
  updatedAt: Date;
  subjectId: string;
  subjectName: string;
  topicId: string | null;
  topicName: string | null;
};

function toSummary(row: SummaryRow, tagNames: string[]): QuestionSummaryDto {
  return {
    id: row.id,
    kind: row.kind,
    difficulty: row.difficulty,
    status: row.status,
    reviewStatus: row.reviewStatus,
    body: row.body,
    subject: { id: row.subjectId, name: row.subjectName },
    topic: row.topicId && row.topicName ? { id: row.topicId, name: row.topicName } : null,
    tags: tagNames,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
    hasExplanation: row.explanation.trim().length > 0,
  };
}

/** SQL fragment: topic ids equal to `topicId` or descending from it. */
export function topicSubtree(topicIds: string[]): SQL {
  return sql`(
    with recursive subtree(id) as (
      select id from ${topics} where id in (${sql.join(
        topicIds.map((t) => sql`${t}::uuid`),
        sql`, `,
      )})
      union
      select t.id from ${topics} t join subtree s on t.parent_topic_id = s.id
    ) select id from subtree
  )`;
}

export async function listQuestions(db: Db, q: ListQuery): Promise<Paginated<QuestionSummaryDto>> {
  const where: SQL[] = [];
  if (q.status !== 'all') where.push(eq(questions.status, q.status));
  else where.push(ne(questions.status, 'archived'));
  if (q.q) {
    const term = `%${escapeLike(q.q)}%`;
    const cond = or(
      ilike(questions.body, term),
      ilike(questions.explanation, term),
      ilike(questions.sourceLabel, term),
    );
    if (cond) where.push(cond);
  }
  if (q.subjectId) where.push(eq(questions.subjectId, q.subjectId));
  if (q.topicId) where.push(sql`${questions.topicId} in ${topicSubtree([q.topicId])}`);
  if (q.kind) where.push(eq(questions.kind, q.kind));
  if (q.difficulty) where.push(eq(questions.difficulty, q.difficulty));
  if (q.reviewStatus) where.push(eq(questions.reviewStatus, q.reviewStatus));
  if (q.ids?.length) where.push(inArray(questions.id, q.ids));
  if (q.collectionId) {
    where.push(
      sql`exists (select 1 from ${collectionQuestions} cq where cq.question_id = questions.id and cq.collection_id = ${q.collectionId})`,
    );
  }
  if (q.tag) {
    where.push(
      sql`exists (select 1 from ${questionTags} qt join ${tags} t on t.id = qt.tag_id where qt.question_id = questions.id and lower(t.name) = lower(${q.tag}))`,
    );
  }
  const condition = and(...where);
  const [totalRow] = await db.select({ value: count() }).from(questions).where(condition);
  const rows = await db
    .select(summaryColumns)
    .from(questions)
    .innerJoin(subjects, eq(subjects.id, questions.subjectId))
    .leftJoin(topics, eq(topics.id, questions.topicId))
    .where(condition)
    .orderBy(desc(questions.updatedAt), asc(questions.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const parts = await loadParts(
    db,
    rows.map((r) => r.id),
  );
  return {
    items: rows.map((r) => toSummary(r, parts.tagNames.get(r.id) ?? [])),
    page: q.page,
    pageSize: q.pageSize,
    total: totalRow?.value ?? 0,
  };
}

export async function getQuestion(db: Db, id: string): Promise<QuestionDetailDto> {
  const rows = await db
    .select({
      ...summaryColumns,
      hint: questions.hint,
      sourceLabel: questions.sourceLabel,
      verifiedAt: questions.verifiedAt,
      createdAt: questions.createdAt,
      archivedAt: questions.archivedAt,
      config: questions.config,
    })
    .from(questions)
    .innerJoin(subjects, eq(subjects.id, questions.subjectId))
    .leftJoin(topics, eq(topics.id, questions.topicId))
    .where(eq(questions.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound('Question');
  const [parts, collectionRows, attempts] = await Promise.all([
    loadParts(db, [id]),
    db
      .select({ id: collectionQuestions.collectionId })
      .from(collectionQuestions)
      .where(eq(collectionQuestions.questionId, id)),
    db
      .select({ value: count() })
      .from(sessionItems)
      .where(
        and(
          eq(sessionItems.questionId, id),
          isNotNull(sessionItems.gradedAt),
          eq(sessionItems.state, 'answered'),
        ),
      ),
  ]);
  return {
    ...toSummary(row, parts.tagNames.get(id) ?? []),
    explanation: row.explanation,
    hint: row.hint,
    sourceLabel: row.sourceLabel,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt.toISOString(),
    archivedAt: iso(row.archivedAt),
    collectionIds: collectionRows.map((c) => c.id),
    options: parts.options.get(id) ?? [],
    correctBoolean: row.config.correctBoolean ?? null,
    blanks: parts.blanks.get(id) ?? [],
    normalization: row.config.normalization ?? DEFAULT_NORMALIZATION,
    attemptCount: attempts[0]?.value ?? 0,
  };
}

export async function questionStats(db: Db): Promise<QuestionStatsDto> {
  const rows = await db
    .select({
      status: questions.status,
      value: count(),
      withExplanation: sql<number>`count(*) filter (where length(trim(${questions.explanation})) > 0)::int`,
    })
    .from(questions)
    .groupBy(questions.status);
  const [subjectCount] = await db
    .select({ value: count() })
    .from(subjects)
    .where(sql`${subjects.archivedAt} is null`);
  const by = (s: string) => rows.find((r) => r.status === s)?.value ?? 0;
  return {
    published: by('published'),
    draft: by('draft'),
    archived: by('archived'),
    withExplanation: rows
      .filter((r) => r.status !== 'archived')
      .reduce((n, r) => n + r.withExplanation, 0),
    subjects: subjectCount?.value ?? 0,
  };
}

export async function findDuplicates(
  db: Db,
  body: string,
  excludeId?: string,
): Promise<DuplicateCandidate[]> {
  const fingerprint = questionFingerprint(body);
  if (!fingerprint) return [];
  const rows = await db
    .select({ id: questions.id, body: questions.body, status: questions.status })
    .from(questions)
    .where(
      and(
        eq(questions.fingerprint, fingerprint),
        excludeId ? ne(questions.id, excludeId) : undefined,
      ),
    )
    .limit(5);
  return rows;
}

/* ---------- Snapshots ---------- */

/** Build immutable snapshots (including answer keys) for the given question ids. */
export async function buildSnapshots(
  tx: Tx,
  ids: string[],
): Promise<Map<string, QuestionSnapshot>> {
  const result = new Map<string, QuestionSnapshot>();
  if (!ids.length) return result;
  const rows = await tx
    .select({
      id: questions.id,
      revision: questions.revision,
      kind: questions.kind,
      difficulty: questions.difficulty,
      body: questions.body,
      explanation: questions.explanation,
      hint: questions.hint,
      sourceLabel: questions.sourceLabel,
      config: questions.config,
      subjectId: subjects.id,
      subjectName: subjects.name,
      topicId: topics.id,
      topicName: topics.name,
    })
    .from(questions)
    .innerJoin(subjects, eq(subjects.id, questions.subjectId))
    .leftJoin(topics, eq(topics.id, questions.topicId))
    .where(inArray(questions.id, ids));
  const parts = await loadParts(tx, ids);
  for (const r of rows) {
    result.set(r.id, {
      questionId: r.id,
      revision: r.revision,
      kind: r.kind,
      difficulty: r.difficulty,
      body: r.body,
      explanation: r.explanation,
      hint: r.hint,
      sourceLabel: r.sourceLabel,
      subject: { id: r.subjectId, name: r.subjectName },
      topic: r.topicId && r.topicName ? { id: r.topicId, name: r.topicName } : null,
      tags: parts.tagNames.get(r.id) ?? [],
      options: (parts.options.get(r.id) ?? []).map(({ id, body, isCorrect }) => ({
        id,
        body,
        isCorrect,
      })),
      correctBoolean: r.config.correctBoolean ?? null,
      blanks: parts.blanks.get(r.id) ?? [],
      normalization: r.config.normalization ?? DEFAULT_NORMALIZATION,
    });
  }
  return result;
}
