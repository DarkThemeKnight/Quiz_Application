# Recall Studio — architecture reference

Sections 1–7 are the original proposal. **Section 8 describes what is actually implemented** (2026-11-17); where they differ, section 8 and `docs/decisions/` win.

## 1. Structure

```text
Quiz_Application/
├── apps/
│   ├── web/                 # Vite React/TypeScript, design system, routing
│   └── api/                 # Fastify routes, auth, services, Drizzle migrations
├── packages/
│   ├── shared/              # Zod API schemas, domain types, pure grading functions
│   └── ui/                  # Optional reusable components only if necessary
├── design/                  # DESIGN_SYSTEM.md, tokens.css, preview.html
├── docs/
│   ├── decisions/           # Architectural decision records
│   └── PROJECT_STATUS.md    # Cross-agent handoff (updated every session)
├── examples/                # Synthetic import samples; never real private bank
├── scripts/                 # Owner bootstrap and safe maintenance tools
├── .env.example             # Template only, no actual secrets
├── .gitignore
├── AGENTS.md
├── CLAUDE_BUILD_PROMPT.md
└── README.md
```

Frontend is NOT authoritative for grades or access control. API owns session lifecycle, timer, validation, grading and analytics queries. PostgreSQL is the durable source of truth. Frontend TanStack Query handles server state with optimistic updates only where safe.

## 2. Suggested PostgreSQL entities

Use UUID primary keys, `created_at`, `updated_at` timestamptz, appropriate unique constraints, FK indexes and archival flags. Use JSONB only for bounded question-type-specific parts rather than all relational relationships. Migrations must be versioned.

| Entity                   | Essential attributes and invariants                                                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `owners`                 | Single active owner; username unique; Argon2id password hash; no public signup                                                                                                         |
| `sessions_auth`          | Opaque session token hash, owner_id, expires_at, revoked_at, last_used_at                                                                                                              |
| `subjects`               | id, name, slug, optional description, archived_at                                                                                                                                      |
| `topics`                 | id, subject_id, optional parent_topic_id, name, slug; avoid cycles                                                                                                                     |
| `collections`            | id, name, description, archived_at; user-created study sets                                                                                                                            |
| `questions`              | id, subject_id, topic_id, kind, difficulty, body, explanation, source_label, verified_at, status, revision, config_jsonb; no hard-coded specific subject                               |
| `question_options`       | id, question_id, position, body, is_correct (only choice questions)                                                                                                                    |
| `question_blanks`        | id, question_id, key/order, accepted_answers jsonb array, optional normalization overrides                                                                                             |
| `question_tags` / `tags` | many-to-many; indexed tag names                                                                                                                                                        |
| `collection_questions`   | many-to-many with optional manual order                                                                                                                                                |
| `study_sessions`         | owner_id, mode, status, created_at, started_at, submitted_at, ends_at, question_count, selection_config snapshot                                                                       |
| `session_items`          | study_session_id, question_id nullable for archived/deleted questions, position, question_snapshot jsonb, answer_jsonb, is_correct nullable, skipped boolean, answered_at, duration_ms |
| `review_schedule`        | owner_id/question_id, box, last_reviewed_at, next_due_at, streak, latest_outcome; no fabricated mastery                                                                                |
| `import_jobs` (optional) | source metadata, count, validation errors and outcome; do not persist file secrets                                                                                                     |

For fill-gaps store text such as `The capital of France is {{blank:1}}.` and structured `[{"key":"1","answers":["Paris"]}]`. Validate exactly matching placeholders and blank keys, no extra or missing blanks. Consider escaped literal braces if author needs them.

For boolean true/false store typed `correct_bool` in `config_jsonb`, and choice questions in `question_options`. Never conflate false with null; JSON parsing distinguishes booleans and missing values. For submitted sessions, `question_snapshot` contains the prompt and answer key _for durable review_ but the API must not send answer keys to the browser before exam submission.

## 3. Pure grading contracts

Recommended conceptual shared types:

```ts
type QuestionKind = 'single_choice' | 'multi_choice' | 'true_false' | 'fill_gap';
type Answer =
  | { kind: 'single_choice'; optionId: string }
  | { kind: 'multi_choice'; optionIds: string[] }
  | { kind: 'true_false'; value: boolean }
  | { kind: 'fill_gap'; blanks: Record<string, string> };

type Grade = { isCorrect: boolean; feedback: string; perBlank?: Record<string, boolean> };
```

Inputs must be schema validated before grading. Grading must remain deterministic and testable. Normalize fill blanks by Unicode NFKC, trimming, collapsing whitespace and case folding as specified; configurable extras must be explicit per question. Exact-match chosen option sets. Store the submitted answer and a completed _snapshot_, not just an aggregate score.

## 4. API resource shape (suggested)

```
POST   /api/auth/bootstrap            # local CLI preferred over HTTP
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
GET    /api/subjects
POST   /api/subjects
GET    /api/topics?subjectId=...
GET    /api/collections
POST   /api/collections
GET    /api/questions?...filters
POST   /api/questions
PATCH  /api/questions/:id
POST   /api/questions/:id/archive
POST   /api/study-sessions
GET    /api/study-sessions/:id
PUT    /api/study-sessions/:id/items/:itemId/answer
POST   /api/study-sessions/:id/submit
GET    /api/study-sessions/:id/result
GET    /api/dashboard?range=30d
GET    /api/analytics?range=90d&subjectId=...
POST   /api/import/questions/validate
POST   /api/import/questions/commit
GET    /api/export/questions
GET    /api/export/progress
```

A robust error response is `{ error: { code, message, details? }, requestId }`. Do not leak stack traces or auth info. Route authorization for all personal data, request size limits, structured redacted logs. Paginate searches and history.

## 5. Local configuration contract

- `DATABASE_URL=postgresql://...` supplied by owner; SSL behavior controlled by separate explicit config if needed. Never include a real database URL in tracked files.
- `APP_HOST=127.0.0.1`, `APP_PORT=4000`, `WEB_PORT=5173`, `APP_ORIGIN=http://127.0.0.1:5173`, `NODE_ENV=development`.
- `SESSION_SECRET` must be supplied from secure local generation; production boot rejects default / too-short keys. For robust auth, store only _hashed_ session tokens in DB; secret may be used for CSRF/signing if applicable.
- `LOG_LEVEL=info`. Do not print `DATABASE_URL`, request Authorization/Cookie headers or answer banks.
- `.env.example` placeholders must be visibly fake. App displays an actionable error if env is absent; don't silently create an insecure password.

Optional local Docker Compose may expose Postgres on `127.0.0.1:5432`, using a named volume. External DB mode must remain supported. Neither mode needs AWS or an external account.

## 6. Metrics definitions

- **Questions in bank:** count active questions; archived separately.
- **Questions seen:** count distinct question IDs assigned and viewed/answered, define one consistent policy in UI.
- **Answer attempts:** count submitted per-question answers across sessions (excluding drafts if stated).
- **Practice accuracy:** total correct practice responses / total graded practice responses; exclude skipped from grade-only accuracy only if clearly labeled; otherwise include in denominator consistently.
- **Exam score:** correct / assigned exam questions * 100; omitted/skipped count as not correct.
- **Average exam score:** arithmetic mean of per-exam percentages across completed exams (unweighted by exam size); explicitly label as such. If showing pooled exam accuracy, use total correct / total assigned instead and label separately.
- **Topic weakness:** last N scored answers within lookback; include sample count and recency; below 5 attempts show 'limited data' rather than definitive ranking.
- **Review due:** `next_due_at <= now`, active question only.

Don't write a dashboard metric with no defined numerator, denominator and date bounds.

## 7. Backup/privacy/security

Data stays in local PostgreSQL; sample data stays synthetic. Do not auto-upload crash reports. Provide concrete local backup commands with environment substitutions in README, e.g. `pg_dump --format=custom --file=private-backup.dump "$DATABASE_URL"` and `pg_restore` guidance (commands need to match deployment environment). Warn that backup files contain private data and must be excluded from git. Avoid dumping DB files into `public/` or served frontend assets.

Deploy to an internet-reachable host only as a separately approved project: reverse proxy + TLS, secure cookies, strong auth, rate limiting and firewall; do not expose dev server.

## 8. As implemented (2026-11-17)

### Tables (`apps/api/src/db/schema.ts`, migration `drizzle/0000_initial.sql`)

`owners` (singleton unique index, Argon2id hash, `preferences` jsonb) · `auth_sessions` (HMAC token hash, expiry,
revocation) · `subjects` · `topics` (self-referencing `parent_topic_id`, no-self-parent check, cycle check in API) ·
`collections` · `tags` · `questions` (`kind`, `difficulty`, `status` draft/published/archived, `review_status`,
`fingerprint` for duplicate warnings, `external_id` unique when set, `revision`, `config` jsonb holding
`correctBoolean`/`normalization`) · `question_options` · `question_blanks` · `question_tags` ·
`collection_questions` · `study_sessions` (`mode`, `status` active/submitted/abandoned, `ends_at`, `submit_reason`,
denormalised `score_correct/score_total`) · `session_items` (`snapshot` jsonb, `state` unanswered/answered/skipped,
`answer`, `grade`, `is_correct`, `graded_at`, `locked`, `time_spent_ms`) · `review_schedule`.

Case-insensitive uniqueness uses `lower(name)` unique indexes. Deleting a subject/topic with questions is refused
(FK `restrict`); deleting a question sets `session_items.question_id` to null and keeps the snapshot.

### HTTP API (all JSON, all require the session cookie except where noted)

```
GET  /api/health                         (public)
GET  /api/auth/status                    (public) owner configured? signed in?
POST /api/auth/login | /api/auth/logout  (public)
GET|PATCH /api/auth/me                   profile + preferences
POST /api/auth/password                  change password (revokes other sessions)
GET  /api/auth/sessions · DELETE /api/auth/sessions/:id · POST /api/auth/sessions/revoke-others
GET|POST /api/subjects · PATCH|DELETE /api/subjects/:id          (?includeArchived=true)
GET|POST /api/topics   · PATCH|DELETE /api/topics/:id            (?subjectId=)
GET|POST /api/collections · PATCH|DELETE /api/collections/:id · POST /api/collections/:id/questions {action,questionIds}
GET  /api/tags · PATCH|DELETE /api/tags/:id
GET  /api/questions?q&subjectId&topicId&collectionId&tag&kind&difficulty&status&reviewStatus&page&pageSize
GET  /api/questions/stats · POST /api/questions/duplicates {body,excludeId?}
GET|PUT|DELETE /api/questions/:id · POST /api/questions · POST /api/questions/:id/archive|restore
GET  /api/sessions?mode&status&page · POST /api/sessions
GET  /api/sessions/:id · PUT /api/sessions/:id/items/:itemId/answer · PATCH /api/sessions/:id/items/:itemId
PUT  /api/sessions/:id/progress · POST /api/sessions/:id/submit|abandon · GET /api/sessions/:id/result
POST /api/review/schedule {questionIds}
GET  /api/dashboard?tz · GET /api/analytics?range=7d|30d|90d|365d|all&subjectId&mode&tz
POST /api/import/questions/validate|commit {format,content,defaultSubject?,duplicates} · POST /api/import/sample
GET  /api/export/questions?format=json|csv&includeArchived · GET /api/export/progress
```

Errors: `{ error: { code, message, details? }, requestId }`. Codes include `VALIDATION_ERROR` (details = field
paths), `UNAUTHENTICATED`, `BAD_ORIGIN`, `NOT_FOUND`, `CONFLICT`, `IN_USE`, `DEADLINE_PASSED`, `NO_QUESTIONS`,
`IMPORT_INVALID`, `RATE_LIMITED`.

### Decisions

`docs/decisions/0001`–`0004`: stack/repo layout, sessions/grading/history, spaced review, metric definitions.
Security model: `docs/SECURITY.md`. Backups: `docs/BACKUP.md`. Import format: `docs/IMPORT_FORMAT.md`.
