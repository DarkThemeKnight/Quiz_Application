import { z } from 'zod';
import {
  DIFFICULTIES,
  MAX_EXAM_MINUTES,
  MAX_SESSION_QUESTIONS,
  QUESTION_KINDS,
  QUESTION_STATUSES,
  REVIEW_STATUSES,
  THEMES,
  type Difficulty,
  type ItemState,
  type QuestionKind,
  type QuestionStatus,
  type ReviewStatus,
  type SessionMode,
  type SessionStatus,
  type Theme,
} from './domain.js';
import type { Answer, Grade } from './grading.js';
import type { NormalizationOptions } from './normalize.js';
import type { PublicQuestion, QuestionSnapshot } from './question.js';
import type { ScoreSummary } from './scoring.js';

/* ---------- Errors ---------- */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
  requestId: string;
}

/* ---------- Auth ---------- */

export const loginSchema = z
  .object({
    username: z.string().trim().min(1, 'Username is required').max(64),
    password: z.string().min(1, 'Password is required').max(512),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(512),
    newPassword: z.string().min(12, 'Use at least 12 characters').max(512),
  })
  .strict();

export interface Preferences {
  theme: Theme;
  defaultQuestionCount: number;
  defaultMode: SessionMode;
  defaultExamMinutes: number;
  practiceHints: boolean;
  allowSkip: boolean;
  spacedReview: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  defaultQuestionCount: 10,
  defaultMode: 'practice',
  defaultExamMinutes: 20,
  practiceHints: true,
  allowSkip: true,
  spacedReview: true,
};

export const preferencesSchema = z
  .object({
    theme: z.enum(THEMES),
    defaultQuestionCount: z.number().int().min(1).max(MAX_SESSION_QUESTIONS),
    defaultMode: z.enum(['practice', 'exam']),
    defaultExamMinutes: z.number().int().min(1).max(MAX_EXAM_MINUTES),
    practiceHints: z.boolean(),
    allowSkip: z.boolean(),
    spacedReview: z.boolean(),
  })
  .strict();

export const profileUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    preferences: preferencesSchema.partial().optional(),
  })
  .strict();

export interface Me {
  id: string;
  username: string;
  displayName: string;
  preferences: Preferences;
}

export interface AuthSessionInfo {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  userAgent: string;
  current: boolean;
}

/* ---------- Taxonomy ---------- */

const name = z.string().trim().min(1, 'Name is required').max(120);
const description = z.string().trim().max(1000).default('');

export const subjectInputSchema = z.object({ name, description }).strict();
export const topicInputSchema = z
  .object({
    subjectId: z.uuid(),
    parentTopicId: z.uuid().nullable().default(null),
    name,
    description,
  })
  .strict();
export const topicUpdateSchema = z
  .object({
    name: name.optional(),
    description: z.string().trim().max(1000).optional(),
    parentTopicId: z.uuid().nullable().optional(),
  })
  .strict();
export const collectionInputSchema = z.object({ name, description }).strict();
export const collectionMembershipSchema = z
  .object({ questionIds: z.array(z.uuid()).min(1).max(1000), action: z.enum(['add', 'remove']) })
  .strict();
export const tagRenameSchema = z.object({ name: z.string().trim().min(1).max(60) }).strict();

export interface SubjectDto {
  id: string;
  name: string;
  slug: string;
  description: string;
  archivedAt: string | null;
  questionCount: number;
  topicCount: number;
}

export interface TopicDto {
  id: string;
  subjectId: string;
  parentTopicId: string | null;
  name: string;
  slug: string;
  description: string;
  questionCount: number;
}

export interface CollectionDto {
  id: string;
  name: string;
  description: string;
  archivedAt: string | null;
  questionCount: number;
}

export interface TagDto {
  id: string;
  name: string;
  questionCount: number;
}

/* ---------- Questions ---------- */

const csvList = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? (v === '' ? [] : v.split(',')) : v),
    z.array(item).max(100),
  );

export const questionListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  subjectId: z.uuid().optional(),
  topicId: z.uuid().optional(),
  collectionId: z.uuid().optional(),
  tag: z.string().trim().max(60).optional(),
  kind: z.enum(QUESTION_KINDS).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  status: z.enum([...QUESTION_STATUSES, 'all']).default('all'),
  reviewStatus: z.enum(REVIEW_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  ids: csvList(z.uuid()).optional(),
});

export interface QuestionSummaryDto {
  id: string;
  kind: QuestionKind;
  difficulty: Difficulty;
  status: QuestionStatus;
  reviewStatus: ReviewStatus;
  body: string;
  subject: { id: string; name: string };
  topic: { id: string; name: string } | null;
  tags: string[];
  revision: number;
  updatedAt: string;
  hasExplanation: boolean;
}

export interface QuestionDetailDto extends QuestionSummaryDto {
  explanation: string;
  hint: string;
  sourceLabel: string;
  verifiedAt: string | null;
  createdAt: string;
  archivedAt: string | null;
  collectionIds: string[];
  options: { id: string; body: string; isCorrect: boolean; position: number }[];
  correctBoolean: boolean | null;
  blanks: { key: string; acceptedAnswers: string[] }[];
  normalization: NormalizationOptions;
  attemptCount: number;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface QuestionStatsDto {
  published: number;
  draft: number;
  archived: number;
  withExplanation: number;
  subjects: number;
}

export interface DuplicateCandidate {
  id: string;
  body: string;
  status: QuestionStatus;
}

/* ---------- Study sessions ---------- */

export const sessionCreateSchema = z
  .object({
    mode: z.enum(['practice', 'exam']),
    subjectIds: z.array(z.uuid()).max(100).default([]),
    topicIds: z.array(z.uuid()).max(200).default([]),
    collectionIds: z.array(z.uuid()).max(100).default([]),
    tags: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
    difficulties: z.array(z.enum(DIFFICULTIES)).max(3).default([]),
    kinds: z.array(z.enum(QUESTION_KINDS)).max(4).default([]),
    questionIds: z.array(z.uuid()).max(MAX_SESSION_QUESTIONS).default([]),
    /** Which questions are eligible beyond the filters above. */
    selection: z.enum(['any', 'new', 'incorrect', 'due']).default('any'),
    count: z.number().int().min(1).max(MAX_SESSION_QUESTIONS),
    shuffle: z.boolean().default(true),
    allowSkip: z.boolean().default(true),
    /** Exam only; null = untimed. */
    timeLimitMinutes: z.number().int().min(1).max(MAX_EXAM_MINUTES).nullable().default(null),
    title: z.string().trim().max(120).optional(),
  })
  .strict();

export type SessionCreateInput = z.input<typeof sessionCreateSchema>;

export const answerPutSchema = z
  .object({
    /** null clears the answer (exam only). */
    answer: z.unknown().nullable(),
    /** Time spent on the item since the previous save, as measured by the client. */
    elapsedMs: z
      .number()
      .int()
      .min(0)
      .max(24 * 3600 * 1000)
      .default(0),
  })
  .strict();

export const itemFlagsSchema = z
  .object({
    markedForReview: z.boolean().optional(),
    skipped: z.boolean().optional(),
    elapsedMs: z
      .number()
      .int()
      .min(0)
      .max(24 * 3600 * 1000)
      .default(0),
  })
  .strict();

export const sessionProgressSchema = z
  .object({ currentPosition: z.number().int().min(0).max(MAX_SESSION_QUESTIONS) })
  .strict();

export interface SessionItemFeedback {
  isCorrect: boolean;
  grade: Grade;
  explanation: string;
  correctOptionIds: string[];
  correctBoolean: boolean | null;
  acceptedAnswers: { key: string; acceptedAnswers: string[] }[];
  sourceLabel: string;
}

export interface SessionItemDto {
  id: string;
  position: number;
  state: ItemState;
  markedForReview: boolean;
  answer: Answer | null;
  timeSpentMs: number;
  question: PublicQuestion;
  /** Present only once feedback is permitted (practice item checked, or session submitted). */
  feedback: SessionItemFeedback | null;
}

export interface SessionDto {
  id: string;
  mode: SessionMode;
  status: SessionStatus;
  title: string;
  allowSkip: boolean;
  questionCount: number;
  currentPosition: number;
  startedAt: string;
  endsAt: string | null;
  submittedAt: string | null;
  submitReason: 'manual' | 'timeout' | null;
  timeLimitMinutes: number | null;
  serverNow: string;
  score: ScoreSummary | null;
  items: SessionItemDto[];
}

export interface SessionSummaryDto {
  id: string;
  mode: SessionMode;
  status: SessionStatus;
  title: string;
  questionCount: number;
  startedAt: string;
  submittedAt: string | null;
  durationMs: number | null;
  correct: number | null;
  percent: number | null;
  answeredCount: number;
}

export interface ResultItemDto {
  id: string;
  position: number;
  state: ItemState;
  isCorrect: boolean;
  markedForReview: boolean;
  timeSpentMs: number;
  answer: Answer | null;
  grade: Grade | null;
  snapshot: QuestionSnapshot;
  /** Whether the live question still exists, has changed, or was archived since this session. */
  liveStatus: 'same' | 'edited' | 'archived' | 'deleted';
}

export interface SessionResultDto {
  session: Omit<SessionDto, 'items'>;
  score: ScoreSummary;
  durationMs: number;
  byTopic: {
    label: string;
    subjectName: string;
    total: number;
    correct: number;
    percent: number | null;
  }[];
  items: ResultItemDto[];
}

export const historyQuerySchema = z.object({
  mode: z.enum(['practice', 'exam']).optional(),
  status: z.enum(['active', 'submitted', 'abandoned']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/* ---------- Analytics ---------- */

export const ANALYTICS_RANGES = ['7d', '30d', '90d', '365d', 'all'] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export const analyticsQuerySchema = z.object({
  range: z.enum(ANALYTICS_RANGES).default('30d'),
  subjectId: z.uuid().optional(),
  mode: z.enum(['practice', 'exam', 'all']).default('all'),
});

export interface RateStat {
  correct: number;
  total: number;
  /** Percentage 0–100 or null when total is 0. */
  percent: number | null;
}

export interface TopicPerformanceDto {
  topicId: string | null;
  label: string;
  subjectId: string;
  subjectName: string;
  attempts: number;
  correct: number;
  percent: number | null;
  status: 'weak' | 'ok' | 'limited_data';
  lastAttemptAt: string;
}

export interface TrendPointDto {
  date: string;
  practice: RateStat;
  exam: RateStat;
}

export interface DashboardDto {
  bank: { published: number; draft: number; archived: number; subjects: number };
  uniqueQuestionsAnswered: number;
  totalAnswers: number;
  practiceAccuracy30d: RateStat;
  averageExamScore30d: { percent: number | null; exams: number };
  dueForReview: number | null;
  spacedReview: boolean;
  activeSession: SessionSummaryDto | null;
  recentSessions: SessionSummaryDto[];
  weakTopics: TopicPerformanceDto[];
  topicPerformance: TopicPerformanceDto[];
  trend14d: TrendPointDto[];
}

export interface AnalyticsDto {
  range: AnalyticsRange;
  from: string | null;
  to: string;
  totals: {
    answers: number;
    uniqueQuestions: number;
    skipped: number;
    sessionsSubmitted: number;
    practice: RateStat;
    examPooled: RateStat;
    averageExamScore: number | null;
    examsCompleted: number;
  };
  trend: TrendPointDto[];
  byKind: (RateStat & { kind: QuestionKind; avgTimeMs: number | null; timedAnswers: number })[];
  byDifficulty: (RateStat & { difficulty: Difficulty })[];
  bySubject: (RateStat & { subjectId: string; subjectName: string })[];
  topics: TopicPerformanceDto[];
  mostMissed: {
    questionId: string;
    body: string;
    kind: QuestionKind;
    attempts: number;
    incorrect: number;
    lastAttemptAt: string;
  }[];
  exams: {
    id: string;
    title: string;
    submittedAt: string;
    percent: number | null;
    questionCount: number;
  }[];
  review: { enabled: boolean; dueNow: number; byBox: { box: number; count: number }[] };
}

/* ---------- Import / export ---------- */

export const importRequestSchema = z
  .object({
    format: z.enum(['json', 'csv']),
    content: z.string().min(1, 'File is empty').max(5_000_000),
    defaultSubject: z.string().trim().min(1).max(120).optional(),
    duplicates: z.enum(['skip', 'import']).default('skip'),
  })
  .strict();

export interface ImportPreviewDto {
  fatal: string | null;
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;
  newSubjects: string[];
  newTopics: string[];
  rows: {
    row: number;
    externalId: string | null;
    kind: string | null;
    prompt: string;
    subject: string | null;
    topic: string | null;
    errors: string[];
    warnings: string[];
    duplicateOf: string | null;
  }[];
}

export interface ImportCommitDto {
  imported: number;
  skippedDuplicates: number;
  createdSubjects: number;
  createdTopics: number;
}
