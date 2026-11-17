# AGENTS.md — Recall Studio / all coding agents

Applies to Claude, Codex, Grok, and human maintainers. This file belongs in the **repository root**. Follow it before editing code. If existing repo instructions conflict, preserve them and seek an explicit architectural decision rather than silently replacing requirements.

## Product invariants

- **General-purpose**, personal, single-owner quiz app; not tied to NRS, government, one exam, or one country.
- Question types are **only** `single_choice`, `multi_choice`, `true_false`, and `fill_gap` (the first two are UI variants of the multiple-choice family). No AI grading or other quiz types.
- PostgreSQL is the authoritative store. No SQLite, remote persistence, cloud providers, object storage, analytics collectors, or runtime API dependencies.
- Frontend and API TypeScript. Prefer the defined pnpm/Vite/React/Fastify/Drizzle stack; record any justified divergence in ADRs.
- Authentication is single-owner, secure by default. No open registration or permission sprawl.
- Public repository: never commit secrets, local `.env`, database backups, logs, personal study data, or access tokens. Use the root `.env.example` as the template and keep `.env` gitignored.

## Agent startup checklist

1. Inspect `git status`, current branch, README, package manifests, migrations, and existing tests.
2. Read `BUILD_PROMPT.md` (the brief), `ARCHITECTURE.md`, `design/DESIGN_SYSTEM.md`, `IMPLEMENTATION_ROADMAP.md`, `docs/PROJECT_STATUS.md` if present.
3. Identify the smallest independently testable next vertical slice. Preserve the owner's uncommitted changes.
4. State assumptions about environment, stack, and database before risky edits. Do not silently migrate or wipe data.
5. Implement, then run relevant validation (typecheck, lint, tests, production build, migration checks).
6. Update the progress and handoff files with **truthful** run results, changed files and outstanding work.

## Shared coding standards

- Central Zod schemas and typed API contracts. No `any` escape hatches without explanation.
- Type-safe data access; parameterized SQL only. DB constraints, proper transactions, unique indexes and migrations.
- Validate and escape user-provided text; no dangerous HTML injection. Encrypt in transit if exposed beyond localhost.
- Keep UI state, server state and persistence responsibilities separate. Don't calculate graded truth only in the browser.
- Use test fixtures and deterministic clocks for scoring, timer and spaced-review logic.
- Treat old submitted attempts as immutable snapshots. New questions can be edited; historic grading cannot.
- No hard-coded user data, credentials, institution names or example values in production core code.
- Implement accessible labels, visible focus, meaningful keyboard navigation, responsive layout, light/dark/reduced-motion modes.
- Preserve privacy: structured logs redact answer contents, credentials, cookies, tokens, sensitive imports and user notes.
- Code contributions should have readable names and small units; leave comments for invariants, not trivia.

## Division of responsibilities (not exclusive)

- **Claude:** architecture, shared types, backend and end-to-end integration, app foundation.
- **Codex:** tests, edge cases, auth/integrity validation, database migrations, production-hardening.
- **Grok:** UI component implementation, styling, responsive design, interaction polish against static preview.

Do not assign ownership permanently: agents may overlap, but read current status first and avoid parallel conflicting edits. Handoffs should be task- and file-specific.

## Check-in protocol

After each work session, maintain `docs/PROJECT_STATUS.md` with:

- Date and agent, branch/commit (if any)
- Completed behavior (not just filenames)
- Paths changed and migrations added
- Commands executed with pass/fail results
- Known bugs, incomplete features, data/schema caveats
- Precise next 1–3 tasks and test commands

For changes involving schema or API, update `ARCHITECTURE.md` and document breaking changes. Do not claim "done" because mock UI looks right.

## Forbidden actions without owner's permission

- Push to GitHub, force-push, delete branches, reset/rebase someone else's work, destructive migrations.
- Connect to a production database or external service. Upload dumps, source data, prompts, study notes, or keys elsewhere.
- Introduce AWS/Firebase/Supabase/telemetry/external AI APIs or switch off authentication to fix a UI issue.
- Edit tracked secrets into files, circumvent `.gitignore`, or make public interfaces listen on `0.0.0.0` by default.

## Finish criteria

A vertical slice is finished only when it works with PostgreSQL, is wired end-to-end, has error/empty/loading states as applicable, has relevant tests, and is documented in the shared handoff.

## Repository map and commands (as implemented)

- `packages/shared` — Zod request schemas, DTO types, and **all pure domain logic**: grading (`grading.ts`),
  fill-gap parsing (`fillGap.ts`), normalisation, scoring, Leitner schedule, weak-topic ranking, CSV, import format.
  Change grading rules here and only here; the API is the only caller that decides correctness.
- `apps/api` — Fastify app (`src/app.ts`), routes in `src/routes/`, business logic in `src/services/`, Drizzle schema
  `src/db/schema.ts`, generated SQL migrations in `drizzle/`, CLIs in `src/cli/`, integration tests in `test/`.
- `apps/web` — React app; pages in `src/pages/`, shared UI in `src/components/`, API hooks in `src/api/hooks.ts`,
  styles in `src/styles/` (tokens copied from `design/tokens.css`).
- `e2e/` — Playwright specs; `start-server.mjs` resets `E2E_DATABASE_URL` and serves the production build.

Schema change workflow: edit `apps/api/src/db/schema.ts` → `pnpm db:generate` (review the SQL) → `pnpm db:migrate`
→ update `ARCHITECTURE.md`. Never edit an applied migration.

Before handing off run: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build && pnpm test:e2e && pnpm check:secrets`.
Tests wipe `TEST_DATABASE_URL` and `E2E_DATABASE_URL`; never point them at real data.

## Latest handoff

See `docs/PROJECT_STATUS.md` for the dated status, verified command results and the next tasks.
