# Claude terminal build brief — Recall Studio

You are a senior full-stack engineer, product designer, and security-conscious maintainer. Build **Recall Studio**, a polished, reusable, **single-user, local-first** quiz application for studying any subject: examinations, job interviews, professional certifications, academic revision, languages, technology, or long-term knowledge retention. This is NOT an NRS product and must contain no NRS-specific assumptions, branding, categories, or workflows. It is for private personal use even though the source repository is public.

**Repository:** https://github.com/DarkThemeKnight/Quiz_Application.git

**First actions:** inspect the existing repository and working tree; read `AGENTS.md`, `ARCHITECTURE.md`, `design/DESIGN_SYSTEM.md`, `design/tokens.css`, `design/preview.html`, and `IMPLEMENTATION_ROADMAP.md` from this package. Preserve any useful existing work; never force-push, erase existing uncommitted changes, or assume the repository is empty. If files in the repo conflict with the plan, record a brief rationale in `docs/decisions/` and align with these product requirements. Build and test working features, not just a mockup. The design preview is a **visual reference**, not the app itself.

## Non-negotiable product and infrastructure constraints

- Personal, single-owner use. No organisations, classrooms, subscriptions, leaderboards, advertisements, social sharing, or multi-tenant architecture.
- **Three question families only:** (1) multiple choice (single-correct or multiple-correct), (2) fill in the gap (one or more typed blanks), and (3) true/false. Do not introduce essays, matching, flashcards as a fourth question type, or AI grading.
- **PostgreSQL** is the only application database. No SQLite, hosted Postgres, Firebase, Supabase, AWS, S3, object storage, cloud auth, telemetry SaaS, remote fonts, CDNs, or paid APIs. All data lives in a locally configured PostgreSQL server; database credentials are supplied later by the owner through environment variables.
- The code will be on a **public GitHub repository**. Never commit passwords, tokens, private notes, database dumps containing personal data, `.env`, signing keys, or logs with secrets. Include `.env.example`, a real `.gitignore`, and a startup check that fails clearly on missing/invalid config. Do not fill the owner's secrets with guesses.
- Offline-capable in the sense of **no third-party network dependencies at runtime**. It is acceptable for frontend and backend to require the owner's local network/PostgreSQL connection; do not claim full offline access if the database is unavailable.
- Local development binds to `127.0.0.1` by default. Never expose a public listener without explicit owner configuration and secure deployment instructions.
- The app must be reusable for arbitrary subjects. No hard-coded domain vocabulary in the architecture, nav structure, schema, analytics, or examples.

## Chosen implementation stack — follow this unless preexisting repo content decisively warrants migration

- **Language:** TypeScript in frontend and backend (strict mode; no `any` without justification).
- **Workspace:** pnpm monorepo (locked versions), Node.js current active LTS, `apps/web`, `apps/api`, `packages/shared`, `packages/ui` where justified.
- **Frontend:** React + Vite + React Router + TanStack Query; CSS variables/tokens and plain CSS modules or scoped styles; Radix primitives for hard-to-implement accessible widgets if useful; Lucide icons installed locally; Recharts for analytics (no remote CDN). Prefer lightweight dependencies.
- **Backend:** Fastify + TypeScript, Zod request/response schemas, structured logging with redaction.
- **Database:** PostgreSQL + Drizzle ORM and versioned SQL migrations; `pg` connection pool; `DATABASE_URL` supplied via `.env` and validated at boot.
- **Authentication:** single local owner account, Argon2id password hashing, HTTP-only session cookie, stored revocable session tokens (hashed at rest), rate-limited login, safe logout; password bootstrap from a one-time local command, not a hard-coded account. Require authentication for all data routes. For local HTTP dev use secure=false cookie only under explicit dev conditions; for HTTPS use secure=true; protect state-changing requests against cross-site requests by validating Origin and SameSite cookies. No account registration, no password reset emails, no OAuth.
- **Validation:** shared Zod schemas for forms and API, server remains authoritative. Use reasonable rate limits, payload size limits and parameterized queries. No raw user HTML rendering.
- **Testing:** Vitest for pure logic, Fastify route/database integration tests with isolated PostgreSQL test DB, Playwright smoke/E2E tests. Add lint, format, typecheck, build and test scripts.
- **Developer environment:** `.env.example` for local DB and app settings; optional Docker Compose for a LOCAL PostgreSQL instance and persistent local volume, but the app must ALSO support an externally installed local Postgres via `DATABASE_URL`. No Docker requirement for the user.

## Product information architecture

1. **Overview dashboard** — actionable learning home: question-bank size, questions attempted (unique vs total attempts distinguished), average exam score, practice accuracy, recent trend, due review count, session history, topic performance, weakest topics with clear next action, continue a saved session, and rapid start buttons. Never fabricate progress if there are no sessions; show useful empty states.
2. **Practice** — pick collections / topics / tags / difficulty, question count, shuffle, new-only, incorrect-only, due-for-review; choose `Practice` (feedback after submit) or `Exam` (feedback after end, optionally timed). Maintain progress without losing the session on accidental refresh.
3. **Question runner** — one focused question per screen, keyboard accessible controls; options A–D or any configured count; multi-select explicitly labeled; true/false straightforward; typed blanks with one/many input boxes; show score only when appropriate. Mark for review, skip if enabled, next/back navigation, remaining time in exam mode, confirmation on submit. No hints in exam mode; practice hints optional.
4. **Results & answer review** — correct/incorrect/skipped, score, duration, review of answers with explanations and accepted variants, by-topic breakdown, retry missed questions, schedule weak items for future practice. Historic results never change when question content is edited.
5. **Question bank** — create/edit/archive/delete with safeguards, bulk-import CSV and JSON with preview and validation; filter/search by subject, topic, tags, difficulty, type and status; duplicate warning; explanation, source/reference, last verified date and review status. Support collection folders and reusable tags. An item can belong to multiple collections, but has one primary subject/topic.
6. **Subjects & collections** — create arbitrary subjects and hierarchical topics; reusable named collections (e.g. 'Interview Prep', 'Algorithms', 'World History', 'Math'). No predefined govt-tax assumptions. A collection may mix subjects.
7. **Analytics** — accuracy and average scores over selectable time ranges, topic trends, performance by type/difficulty, answer speed (where meaningful), most-missed questions, mastery/review due, recent attempts and drill-down filters. Clearly label definitions and sample sizes. Trend charts show empty states rather than deceptive zero lines.
8. **Settings & data** — local profile, theme (light/dark/system), sensible question defaults, backup/export/import, confirmation dialogs for destructive operations, admin security controls, privacy notes. Support export of full question bank and progress as JSON; document restoring the DB via `pg_dump` / `pg_restore` or `psql`. Never place backups in Git.

## Quiz engine rules (write tests for every case)

- **Single-choice:** exactly one accepted option id; submitted choice matches it.
- **Multiple-choice with multiple answers:** the selected SET must exactly equal the accepted SET; no accidental partial credit unless a future explicit scoring setting is introduced. UI makes this clear.
- **True/false:** boolean, not ad-hoc strings; never allow an unset answer to count as false.
- **Fill-in-the-gap:** store question body with explicit placeholder markers (for example `{{blank:1}}`), a separate array of blanks with accepted answer aliases for each blank, and one answer per blank. Default normalisation: Unicode NFKC, trim, collapse repeated whitespace, case-insensitive. Do NOT remove arbitrary digits, accents, or symbols unless a per-question setting expressly does so. All blanks must match an accepted alias to count as correct. Store/display every accepted variant and optional explanation. Provide author preview and reject malformed placeholder/index mappings. Never rely on AI/fuzzy grading.
- **Skipped:** distinguish skipped from wrong and unanswered; define how skipped affects score in the UI and tests. Recommendation: on submitted exams, score correct / assigned questions, skipped included in denominator.
- **Historical integrity:** snapshot question prompt, options, accepted answers, explanation, tags, subject and content revision into each submitted session response, so editing/removing a question does not alter old results.
- **Session lifecycle:** draft/active/submitted/abandoned; persist server-side; ensure idempotent answer submission; timeout based on server UTC times; time-zone-aware display. In exam mode, server validates deadline and blocks post-deadline changes.
- **Weak areas:** identify using recent attempts and sufficient sample sizes; show 'not enough data' otherwise. Use a documented straightforward prioritization (e.g. low accuracy weighted by count and recency) and include a quick action 'Practice weaknesses'.
- **Spaced review:** simple documented Leitner-like scheduling is fine; state the rule and allow users to turn it off. The primary experience is practice questions, not gamification.
- **Analytics:** distinguish practice accuracy from exam scores; report total attempts separately from unique questions encountered. Avoid averages of averages; aggregate underlying numerators/denominators. Avoid dividing by zero. Time durations must be realistic and nonnegative.

## Visual and UX direction

Follow `design/DESIGN_SYSTEM.md`, `design/tokens.css` and the interactive static concept `design/preview.html`: restrained editorial/utility styling, clear study workspace, readable typography, modest indigo action accent, teal positive indicators, warm amber warning. Neutral, premium, welcoming and highly scannable; **not** an NRS portal, not playful school gamification. Use a consistent sidebar on desktop and compact navigation on mobile. Good charts and actionable insight cards. Accessible keyboard focus, contrast, reduced motion, proper form labels, correct error and loading states, light/dark themes. No external images required. Demo data must be labeled as sample.

## Deliverables — implement in progressive working slices

1. Working monorepo, installation docs, config validation, local DB setup, Drizzle migrations, auth and accessible app shell.
2. Real authoring and browsing for the three question types, validation, subjects/topics/collections, initial optional **neutral** sample bank.
3. Practice runner and grading, persistent sessions, results and answer review; then exam timer and resume behavior.
4. Metrics, dashboard, analytics, weak-area review, history and spaced practice.
5. CSV/JSON import/export, backups guidance, settings, test suite, accessibility/edge-case audit.

Commit in logical increments only when asked or when appropriate for the repo workflow; do not push without explicit permission. At the end of each coding session, update `AGENTS.md` handoff and `docs/PROJECT_STATUS.md` with actual state, commands executed, tests, open questions, next tasks; don't claim tests you didn't run. Prioritise real functionality over decorative filler. Never replace the user's code wholesale without review.

## Acceptance scenarios

- Owner can configure local PostgreSQL credentials using only `.env` and run migrations, without source edits.
- From a fresh database, owner can create a subject, topic, collection, and three question types through UI; then take a session and receive correct grading.
- A fill-in with aliases accepts valid variants and rejects near misses; multi-select checks the exact set; false is distinguishable from unanswered.
- A 15-question exam completes with a reliable timer and persists score/review after page reload.
- Dashboard shows real attempts/scores/weak areas (and appropriate zero-data states), with clickable paths to practice.
- Edited questions leave completed exam history unchanged.
- CSV/JSON import reports bad rows before writing and never partially imports a batch unexpectedly.
- Public repo can be cloned safely: no embedded database credentials, `.env` is gitignored, sample config works, no external paid services are mandatory.
- On desktop and mobile, keyboard and screen-reader workflows are usable; essential pages have loading, empty, error and success states.
- Typecheck, lint, unit/integration/E2E smoke tests and production build pass; record actual commands/results.

**Do the work, not merely describe it.** Start by inspecting the repo. Implement the foundational slice, execute the application, and continue through the roadmap as context allows. When context is running low, leave a precise `AGENTS.md` handoff for Claude, Codex, or Grok.
