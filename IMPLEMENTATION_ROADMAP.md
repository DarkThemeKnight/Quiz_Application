# Implementation roadmap and definition of done

The system is more useful when it works end-to-end than when every page is visually polished. Build vertical slices and keep the app runnable at each milestone.

## M0 — inventory and safety

- Inspect repo and current source; decide integrate vs adopt folder structure. Preserve all existing user work.
- Install/toolchain docs, pnpm workspace, TypeScript strict, automated format/lint.
- Root `.env.example`, `.gitignore`, config validation, safe secret scanning instructions.
- Baseline README and `docs/PROJECT_STATUS.md`.

**Check:** fresh clone can install; source has no committed `.env`, password or local data.

## M1 — app skeleton + local PostgreSQL + owner auth

- React app shell with responsive nav, accessible design tokens and light/dark mode.
- Fastify API and error envelope; health route; request/response validation.
- Drizzle PostgreSQL schema and reversible migrations; optional local Compose.
- One-time create-owner CLI, Argon2id hashing, login/logout, sessions, origin validation, brute-force throttling.
- Auth guard and honest empty states.

**Check:** owner can configure `DATABASE_URL`, migrate, log in, log out and see an empty overview; anonymous API requests fail.

## M2 — author and organize questions

- Subject/topic management, collections, tags and question CRUD.
- Single-choice, multi-choice, true/false and multi-blank fill-in editors with strict validation and preview.
- Search/filter question bank, archive and restore, duplicate warnings.
- Neutral optional example content (never auto-import private data).

**Check:** create, edit, archive and retrieve each type with validation; malformed fill placeholders rejected.

## M3 — core quiz loop

- Session creation with filters, question count, randomized order and modes.
- Practice interactions and explanations, answer persistence and progress after reload.
- Grader runs on API; results and detailed answer review.
- Explicit handling of empty/partial/unanswered/skipped responses and item snapshots.

**Check:** complete 10-question practice session, refresh mid-session, submit, review and retry incorrect answers; unit tests cover all formats.

## M4 — exam + analytics

- Timed exam mode, server-authoritative deadline, answer locking, marks/skip behavior.
- Dashboard with totals, average exam score, practice accuracy, recent sessions, weak topics and quick actions.
- Analytics page: history trends, performance by subject/type/difficulty and sample-size handling.
- Review due dates from documented Leitner-like algorithm.

**Check:** timer survives refresh, expired sessions cannot be edited, all dashboard data derives from stored attempts.

## M5 — portability and quality

- CSV/JSON import preview and atomic transactional commit; explicit error reporting.
- Export question bank and progress; database backup/restore documentation.
- Automated accessibility checks and manual keyboard test.
- Integration/E2E tests, production build, migration upgrade test, privacy/security review.

**Check:** import valid+invalid data, preview errors, reject batch correctly, export and restore. Confirm no cloud dependencies and no secrets tracked.

## Critical edge-case tests

1. `false` answer vs no answer.
2. Multi-select exact set vs partial set.
3. One blank, multiple blanks, aliases, whitespace/case, Unicode, empty and duplicate placeholders.
4. Zero questions/zero sessions/zero attempts in analytics.
5. Editing/archiving questions after past submissions.
6. Repeated answer-submission requests and race with exam timeout.
7. Authentication session expiry, refresh, logout, invalid token and csrf/origin restriction.
8. Duplicate imports and rollback on error.
9. Very long prompt/explanation, mobile overflow, keyboard operation, reduced motion.
10. No `DATABASE_URL` or unavailable PostgreSQL: clear startup error, never silently switch DB engines.
