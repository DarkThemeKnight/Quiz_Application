import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  Answer,
  Grade,
  NormalizationOptions,
  Preferences,
  QuestionSnapshot,
} from '@recall/shared';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const questionKind = pgEnum('question_kind', [
  'single_choice',
  'multi_choice',
  'true_false',
  'fill_gap',
]);
export const difficulty = pgEnum('difficulty', ['easy', 'medium', 'hard']);
export const questionStatus = pgEnum('question_status', ['draft', 'published', 'archived']);
export const reviewStatus = pgEnum('review_status', ['unreviewed', 'verified', 'needs_update']);
export const sessionMode = pgEnum('session_mode', ['practice', 'exam']);
export const sessionStatus = pgEnum('session_status', ['active', 'submitted', 'abandoned']);
export const itemState = pgEnum('item_state', ['unanswered', 'answered', 'skipped']);

/** Exactly one owner row may exist (enforced by the singleton unique index). */
export const owners = pgTable(
  'owners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull().default(''),
    passwordHash: text('password_hash').notNull(),
    preferences: jsonb('preferences').$type<Partial<Preferences>>().notNull().default({}),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('owners_username_key').on(sql`lower(${t.username})`),
    uniqueIndex('owners_singleton').on(sql`(true)`),
  ],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => owners.id, { onDelete: 'cascade' }),
    /** HMAC-SHA256(SESSION_SECRET, token) — the raw token is never stored. */
    tokenHash: text('token_hash').notNull(),
    userAgent: text('user_agent').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('auth_sessions_token_hash_key').on(t.tokenHash),
    index('auth_sessions_owner_idx').on(t.ownerId),
  ],
);

export const subjects = pgTable(
  'subjects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description').notNull().default(''),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('subjects_name_key').on(sql`lower(${t.name})`)],
);

export const topics = pgTable(
  'topics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'restrict' }),
    parentTopicId: uuid('parent_topic_id').references((): AnyPgColumn => topics.id, {
      onDelete: 'restrict',
    }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description').notNull().default(''),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('topics_sibling_name_key').on(
      t.subjectId,
      sql`coalesce(${t.parentTopicId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`lower(${t.name})`,
    ),
    index('topics_subject_idx').on(t.subjectId),
    index('topics_parent_idx').on(t.parentTopicId),
    check(
      'topics_not_own_parent',
      sql`${t.parentTopicId} is null or ${t.parentTopicId} <> ${t.id}`,
    ),
  ],
);

export const collections = pgTable(
  'collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('collections_name_key').on(sql`lower(${t.name})`)],
);

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tags_name_key').on(sql`lower(${t.name})`)],
);

export interface QuestionConfig {
  correctBoolean?: boolean;
  normalization?: NormalizationOptions;
}

export const questions = pgTable(
  'questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'restrict' }),
    topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    kind: questionKind('kind').notNull(),
    difficulty: difficulty('difficulty').notNull().default('medium'),
    status: questionStatus('status').notNull().default('published'),
    reviewStatus: reviewStatus('review_status').notNull().default('unreviewed'),
    body: text('body').notNull(),
    /** Normalised prompt used for duplicate warnings (not unique — duplicates are allowed after warning). */
    fingerprint: text('fingerprint').notNull(),
    explanation: text('explanation').notNull().default(''),
    hint: text('hint').notNull().default(''),
    sourceLabel: text('source_label').notNull().default(''),
    verifiedAt: date('verified_at'),
    externalId: text('external_id'),
    /** Incremented on every content edit; snapshotted into session items. */
    revision: integer('revision').notNull().default(1),
    config: jsonb('config').$type<QuestionConfig>().notNull().default({}),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('questions_subject_idx').on(t.subjectId),
    index('questions_topic_idx').on(t.topicId),
    index('questions_status_idx').on(t.status),
    index('questions_fingerprint_idx').on(t.fingerprint),
    uniqueIndex('questions_external_id_key')
      .on(t.externalId)
      .where(sql`${t.externalId} is not null`),
    check('questions_revision_positive', sql`${t.revision} >= 1`),
  ],
);

export const questionOptions = pgTable(
  'question_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    body: text('body').notNull(),
    isCorrect: boolean('is_correct').notNull(),
  },
  (t) => [uniqueIndex('question_options_position_key').on(t.questionId, t.position)],
);

export const questionBlanks = pgTable(
  'question_blanks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    position: integer('position').notNull(),
    acceptedAnswers: jsonb('accepted_answers').$type<string[]>().notNull(),
  },
  (t) => [uniqueIndex('question_blanks_key').on(t.questionId, t.key)],
);

export const questionTags = pgTable(
  'question_tags',
  {
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.questionId, t.tagId] }),
    index('question_tags_tag_idx').on(t.tagId),
  ],
);

export const collectionQuestions = pgTable(
  'collection_questions',
  {
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.questionId] }),
    index('collection_questions_question_idx').on(t.questionId),
  ],
);

export interface SelectionConfig {
  subjectIds: string[];
  topicIds: string[];
  collectionIds: string[];
  tags: string[];
  difficulties: string[];
  kinds: string[];
  questionIds: string[];
  selection: 'any' | 'new' | 'incorrect' | 'due';
  shuffle: boolean;
  requestedCount: number;
}

export const studySessions = pgTable(
  'study_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => owners.id, { onDelete: 'cascade' }),
    mode: sessionMode('mode').notNull(),
    status: sessionStatus('status').notNull().default('active'),
    title: text('title').notNull(),
    selectionConfig: jsonb('selection_config').$type<SelectionConfig>().notNull(),
    questionCount: integer('question_count').notNull(),
    allowSkip: boolean('allow_skip').notNull().default(true),
    timeLimitSeconds: integer('time_limit_seconds'),
    currentPosition: integer('current_position').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    /** Server-authoritative exam deadline (UTC). */
    endsAt: timestamp('ends_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    submitReason: text('submit_reason').$type<'manual' | 'timeout'>(),
    scoreCorrect: integer('score_correct'),
    scoreTotal: integer('score_total'),
    ...timestamps,
  },
  (t) => [
    index('study_sessions_owner_status_idx').on(t.ownerId, t.status),
    index('study_sessions_submitted_idx').on(t.submittedAt),
    check('study_sessions_count_positive', sql`${t.questionCount} > 0`),
    check(
      'study_sessions_time_limit_positive',
      sql`${t.timeLimitSeconds} is null or ${t.timeLimitSeconds} > 0`,
    ),
  ],
);

export const sessionItems = pgTable(
  'session_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => studySessions.id, { onDelete: 'cascade' }),
    /** Nullable: the live question may later be deleted; the snapshot keeps history intact. */
    questionId: uuid('question_id').references(() => questions.id, { onDelete: 'set null' }),
    position: integer('position').notNull(),
    snapshot: jsonb('snapshot').$type<QuestionSnapshot>().notNull(),
    state: itemState('state').notNull().default('unanswered'),
    answer: jsonb('answer').$type<Answer>(),
    grade: jsonb('grade').$type<Grade>(),
    isCorrect: boolean('is_correct'),
    markedForReview: boolean('marked_for_review').notNull().default(false),
    timeSpentMs: integer('time_spent_ms').notNull().default(0),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    /** Set when the item's correctness is final (practice check, or session submission). */
    gradedAt: timestamp('graded_at', { withTimezone: true }),
    /** Practice: answer locked after "Check answer". */
    locked: boolean('locked').notNull().default(false),
  },
  (t) => [
    uniqueIndex('session_items_position_key').on(t.sessionId, t.position),
    index('session_items_question_idx').on(t.questionId),
    index('session_items_graded_idx').on(t.gradedAt),
    check('session_items_time_nonnegative', sql`${t.timeSpentMs} >= 0`),
  ],
);

export const reviewSchedule = pgTable(
  'review_schedule',
  {
    questionId: uuid('question_id')
      .primaryKey()
      .references(() => questions.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => owners.id, { onDelete: 'cascade' }),
    box: integer('box').notNull().default(1),
    streak: integer('streak').notNull().default(0),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }).notNull(),
    nextDueAt: timestamp('next_due_at', { withTimezone: true }).notNull(),
    latestOutcome: boolean('latest_outcome').notNull(),
    attempts: integer('attempts').notNull().default(0),
    correct: integer('correct').notNull().default(0),
  },
  (t) => [
    index('review_schedule_due_idx').on(t.nextDueAt),
    check('review_schedule_box_range', sql`${t.box} between 1 and 5`),
  ],
);
