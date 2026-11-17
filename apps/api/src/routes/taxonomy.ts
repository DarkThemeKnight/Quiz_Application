import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  collectionInputSchema,
  collectionMembershipSchema,
  subjectInputSchema,
  tagRenameSchema,
  topicInputSchema,
  topicUpdateSchema,
  type CollectionDto,
  type SubjectDto,
  type TagDto,
  type TopicDto,
} from '@recall/shared';
import type { AppDeps } from '../app.js';
import {
  collectionQuestions,
  collections,
  questions,
  questionTags,
  subjects,
  tags,
  topics,
} from '../db/schema.js';
import { AppError, conflict, notFound, parse } from '../errors.js';
import { iso, slugify } from '../lib/text.js';

const idParam = z.object({ id: z.uuid() });

export async function taxonomyRoutes(app: FastifyInstance, { database }: AppDeps): Promise<void> {
  const { db } = database;

  /* ---------- Subjects ---------- */

  app.get('/subjects', async (request): Promise<SubjectDto[]> => {
    const { includeArchived } = parse(
      z.object({ includeArchived: z.enum(['true', 'false']).default('false') }),
      request.query,
    );
    const rows = await db
      .select({
        id: subjects.id,
        name: subjects.name,
        slug: subjects.slug,
        description: subjects.description,
        archivedAt: subjects.archivedAt,
        questionCount: sql<number>`(select count(*)::int from ${questions} q where q.subject_id = subjects.id and q.status <> 'archived')`,
        topicCount: sql<number>`(select count(*)::int from ${topics} t where t.subject_id = subjects.id)`,
      })
      .from(subjects)
      .where(includeArchived === 'true' ? undefined : isNull(subjects.archivedAt))
      .orderBy(asc(sql`lower(${subjects.name})`));
    return rows.map((r) => ({ ...r, archivedAt: iso(r.archivedAt) }));
  });

  app.post('/subjects', async (request, reply) => {
    const body = parse(subjectInputSchema, request.body);
    const [row] = await db
      .insert(subjects)
      .values({ name: body.name, description: body.description, slug: slugify(body.name) })
      .returning({ id: subjects.id });
    return reply.status(201).send(row);
  });

  app.patch('/subjects/:id', async (request) => {
    const { id } = parse(idParam, request.params);
    const body = parse(
      subjectInputSchema.partial().extend({ archived: z.boolean().optional() }),
      request.body,
    );
    const result = await db
      .update(subjects)
      .set({
        ...(body.name ? { name: body.name, slug: slugify(body.name) } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.archived !== undefined ? { archivedAt: body.archived ? new Date() : null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(subjects.id, id))
      .returning({ id: subjects.id });
    if (!result[0]) throw notFound('Subject');
    return { ok: true };
  });

  app.delete('/subjects/:id', async (request) => {
    const { id } = parse(idParam, request.params);
    const [usage] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(questions)
      .where(eq(questions.subjectId, id));
    if ((usage?.n ?? 0) > 0)
      throw conflict(
        'This subject still has questions. Move or delete them first, or archive the subject.',
      );
    await db.transaction(async (tx) => {
      // Delete leaf topics first (topics reference their parent with ON DELETE RESTRICT).
      for (;;) {
        const deleted = await tx
          .delete(topics)
          .where(
            and(
              eq(topics.subjectId, id),
              sql`not exists (select 1 from ${topics} c where c.parent_topic_id = topics.id)`,
            ),
          )
          .returning({ id: topics.id });
        if (deleted.length === 0) break;
      }
      const result = await tx
        .delete(subjects)
        .where(eq(subjects.id, id))
        .returning({ id: subjects.id });
      if (!result[0]) throw notFound('Subject');
    });
    return { ok: true };
  });

  /* ---------- Topics ---------- */

  app.get('/topics', async (request): Promise<TopicDto[]> => {
    const { subjectId } = parse(z.object({ subjectId: z.uuid().optional() }), request.query);
    return db
      .select({
        id: topics.id,
        subjectId: topics.subjectId,
        parentTopicId: topics.parentTopicId,
        name: topics.name,
        slug: topics.slug,
        description: topics.description,
        questionCount: sql<number>`(select count(*)::int from ${questions} q where q.topic_id = topics.id and q.status <> 'archived')`,
      })
      .from(topics)
      .where(subjectId ? eq(topics.subjectId, subjectId) : undefined)
      .orderBy(asc(sql`lower(${topics.name})`));
  });

  async function assertParent(subjectId: string, parentId: string | null, selfId?: string) {
    if (!parentId) return;
    const [parent] = await db.select().from(topics).where(eq(topics.id, parentId));
    if (!parent || parent.subjectId !== subjectId)
      throw new AppError(400, 'VALIDATION_ERROR', 'Parent topic must belong to the same subject.');
    if (!selfId) return;
    // Walk up from the proposed parent; reaching selfId would create a cycle.
    let cursor: string | null = parentId;
    for (let depth = 0; cursor && depth < 100; depth++) {
      if (cursor === selfId)
        throw new AppError(400, 'VALIDATION_ERROR', 'A topic cannot be nested inside itself.');
      const [row] = await db
        .select({ parent: topics.parentTopicId })
        .from(topics)
        .where(eq(topics.id, cursor));
      cursor = row?.parent ?? null;
    }
  }

  app.post('/topics', async (request, reply) => {
    const body = parse(topicInputSchema, request.body);
    const [subject] = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(eq(subjects.id, body.subjectId));
    if (!subject) throw new AppError(400, 'VALIDATION_ERROR', 'Subject does not exist.');
    await assertParent(body.subjectId, body.parentTopicId);
    const [row] = await db
      .insert(topics)
      .values({ ...body, slug: slugify(body.name) })
      .returning({ id: topics.id });
    return reply.status(201).send(row);
  });

  app.patch('/topics/:id', async (request) => {
    const { id } = parse(idParam, request.params);
    const body = parse(topicUpdateSchema, request.body);
    const [current] = await db.select().from(topics).where(eq(topics.id, id));
    if (!current) throw notFound('Topic');
    if (body.parentTopicId !== undefined)
      await assertParent(current.subjectId, body.parentTopicId, id);
    await db
      .update(topics)
      .set({
        ...(body.name ? { name: body.name, slug: slugify(body.name) } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.parentTopicId !== undefined ? { parentTopicId: body.parentTopicId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(topics.id, id));
    return { ok: true };
  });

  app.delete('/topics/:id', async (request) => {
    const { id } = parse(idParam, request.params);
    const [children] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(topics)
      .where(eq(topics.parentTopicId, id));
    if ((children?.n ?? 0) > 0) throw conflict('Delete or move the sub-topics first.');
    const [usage] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(questions)
      .where(eq(questions.topicId, id));
    if ((usage?.n ?? 0) > 0)
      throw conflict('This topic still has questions. Reassign them before deleting it.');
    const result = await db.delete(topics).where(eq(topics.id, id)).returning({ id: topics.id });
    if (!result[0]) throw notFound('Topic');
    return { ok: true };
  });

  /* ---------- Collections ---------- */

  app.get('/collections', async (): Promise<CollectionDto[]> => {
    const rows = await db
      .select({
        id: collections.id,
        name: collections.name,
        description: collections.description,
        archivedAt: collections.archivedAt,
        questionCount: sql<number>`(select count(*)::int from ${collectionQuestions} cq join ${questions} q on q.id = cq.question_id where cq.collection_id = collections.id and q.status <> 'archived')`,
      })
      .from(collections)
      .orderBy(asc(sql`lower(${collections.name})`));
    return rows.map((r) => ({ ...r, archivedAt: iso(r.archivedAt) }));
  });

  app.post('/collections', async (request, reply) => {
    const body = parse(collectionInputSchema, request.body);
    const [row] = await db.insert(collections).values(body).returning({ id: collections.id });
    return reply.status(201).send(row);
  });

  app.patch('/collections/:id', async (request) => {
    const { id } = parse(idParam, request.params);
    const body = parse(
      collectionInputSchema.partial().extend({ archived: z.boolean().optional() }),
      request.body,
    );
    const result = await db
      .update(collections)
      .set({
        ...(body.name ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.archived !== undefined ? { archivedAt: body.archived ? new Date() : null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(collections.id, id))
      .returning({ id: collections.id });
    if (!result[0]) throw notFound('Collection');
    return { ok: true };
  });

  /** Deleting a collection never deletes its questions. */
  app.delete('/collections/:id', async (request) => {
    const { id } = parse(idParam, request.params);
    const result = await db
      .delete(collections)
      .where(eq(collections.id, id))
      .returning({ id: collections.id });
    if (!result[0]) throw notFound('Collection');
    return { ok: true };
  });

  app.post('/collections/:id/questions', async (request) => {
    const { id } = parse(idParam, request.params);
    const body = parse(collectionMembershipSchema, request.body);
    const [collection] = await db
      .select({ id: collections.id })
      .from(collections)
      .where(eq(collections.id, id));
    if (!collection) throw notFound('Collection');
    if (body.action === 'add') {
      const existing = await db
        .select({ id: questions.id })
        .from(questions)
        .where(inArray(questions.id, body.questionIds));
      if (existing.length) {
        await db
          .insert(collectionQuestions)
          .values(existing.map((q) => ({ collectionId: id, questionId: q.id })))
          .onConflictDoNothing();
      }
      return { changed: existing.length };
    }
    const removed = await db
      .delete(collectionQuestions)
      .where(
        and(
          eq(collectionQuestions.collectionId, id),
          inArray(collectionQuestions.questionId, body.questionIds),
        ),
      )
      .returning({ q: collectionQuestions.questionId });
    return { changed: removed.length };
  });

  /* ---------- Tags ---------- */

  app.get('/tags', async (): Promise<TagDto[]> =>
    db
      .select({
        id: tags.id,
        name: tags.name,
        questionCount: sql<number>`(select count(*)::int from ${questionTags} qt where qt.tag_id = tags.id)`,
      })
      .from(tags)
      .orderBy(asc(sql`lower(${tags.name})`)),
  );

  app.patch('/tags/:id', async (request) => {
    const { id } = parse(idParam, request.params);
    const body = parse(tagRenameSchema, request.body);
    const result = await db
      .update(tags)
      .set({ name: body.name })
      .where(eq(tags.id, id))
      .returning({ id: tags.id });
    if (!result[0]) throw notFound('Tag');
    return { ok: true };
  });

  app.delete('/tags/:id', async (request) => {
    const { id } = parse(idParam, request.params);
    await db.delete(tags).where(eq(tags.id, id));
    return { ok: true };
  });
}
