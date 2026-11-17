# Project status — shared handoff

## Snapshot — 2026-11-17 · Grok (review fixes)

Reviewed the M0–M5 implementation against `BUILD_PROMPT.md` and fixed correctness bugs. No schema migration.

### Corrected behaviour

- Practice “check answer” is idempotent for fill-in answers even when blank-key order differs from the jsonb copy PostgreSQL stores.
- Exam submit, including the timer, waits until debounced and in-flight answer saves finish. Skip no longer races with a pending save. A failed save blocks a manual submit and is retried on the next attempt.
- Fill-in instructions follow the question’s normalisation (case, accents, punctuation) instead of always saying capitalisation is ignored.
- Restoring an archived draft returns it to draft. Published questions still restore as published. Questions archived before this change restore as published.
- JSON/CSV import preview counts only rows that will be skipped. A repeated prompt in the same file is skipped only in “skip duplicates” mode, and the preview says so. `externalId` duplicates are always skipped, including when “import anyway” is selected.
- Export keeps archived questions archived (it no longer rewrites them as published). JSON export includes `reviewStatus` and `verifiedAt`. A true/false question with no stored boolean is not exported as “false”.

### Commands (Node 24.13.0; the default `node` on this machine is 18 and cannot run Vitest 5)

| Command                           | Result                               |
| --------------------------------- | ------------------------------------ |
| `pnpm typecheck`                  | pass                                 |
| `pnpm lint`                       | pass                                 |
| `pnpm format:check`               | pass                                 |
| `pnpm test`                       | pass — shared 53, api 46, web 7      |
| `pnpm --filter @recall/web build` | pass                                 |
| `pnpm --filter @recall/api build` | pass                                 |
| `pnpm test:e2e`                   | pass — 7 tests (6 desktop, 1 mobile) |

### Still open

- No owner account in `quiz_application` until `pnpm owner:create`.
- No automated axe scan. Bulk bank actions and a timed-exam E2E for auto-submit are still undone.
- Nested topics are not created by import. CSV still does not carry per-question normalisation (JSON does).

## Snapshot — 2026-11-17 · Claude (Opus 5.5)

| Item           | Value                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Branch         | `main` (local git repo created this session; remote `origin` = GitHub repo, **not pushed**)                                                      |
| Roadmap        | M0–M5 implemented as working vertical slices (see below)                                                                                         |
| Database       | Owner's local PostgreSQL 16 `quiz_application` on 127.0.0.1:5432 via `.env`, migrated (14 tables). No owner account yet.                         |
| Test databases | Docker Compose PostgreSQL 17 on 127.0.0.1:5433: `recall_studio` (unused dev DB), `recall_studio_test` (Vitest), `recall_studio_e2e` (Playwright) |

## Working behaviour (verified)

- **Config & startup:** zod-validated env; refuses missing/placeholder `DATABASE_URL`/`SESSION_SECRET`, short
  secrets, non-loopback hosts; checks DB reachability and pending migrations with actionable messages.
- **Auth:** `pnpm owner:create` / `owner:password` CLIs; Argon2id; HMAC-hashed revocable sessions in HttpOnly
  SameSite=Strict cookies; Origin check on writes; login rate limit + per-user lockout; session list/revoke UI.
- **Authoring:** subjects, nested topics (cycle-safe), collections, tags; editor for all four kinds with live
  preview, blank insertion, aliases, normalisation options, duplicate warnings, client + server validation;
  revisions; archive → delete safeguard; filtered/paginated bank.
- **Sessions:** practice (grade on check, idempotent) and exam (save/change, server deadline + auto-submit on
  timeout), skip vs unanswered, mark for review, navigator, keyboard 1–9/T/F, resume after reload, discard.
- **Results:** score (correct ÷ assigned), per-topic breakdown, answer review with accepted variants and
  explanations, retry missed, schedule for review, immutable snapshots with "edited/archived/deleted" notes.
- **Analytics:** dashboard and insights with pooled practice accuracy, mean exam score, trend gaps (not zeros),
  weak topics with sample-size gating, by kind/difficulty/subject, avg time, most missed, Leitner boxes.
- **Data:** CSV/JSON validate-then-commit (all-or-nothing), JSON/CSV/progress export, labelled sample bank,
  backup docs; light/dark/system theme; responsive with mobile bottom nav.

## Commands run this session (final results)

| Command              | Result                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm typecheck`     | pass (shared, api, web)                                                                      |
| `pnpm lint`          | pass                                                                                         |
| `pnpm format:check`  | pass                                                                                         |
| `pnpm test`          | pass — shared 52, api 43 (against PostgreSQL), web 7                                         |
| `pnpm build`         | pass (web Vite build + API tsup bundle)                                                      |
| `pnpm test:e2e`      | pass — 7 tests (6 desktop, 1 mobile/Pixel 7) using system Chrome                             |
| `pnpm check:secrets` | pass (and verified it flags a planted DB URL)                                                |
| `pnpm db:migrate`    | applied to owner DB `quiz_application`                                                       |
| Manual               | Signed in, loaded sample bank and completed a practice question in Chrome against the e2e DB |

## Known gaps / caveats

- No owner account exists in `quiz_application` yet — the owner must run `pnpm owner:create`.
- The owner-supplied DB password is weak (`quiz_app`); fine on loopback-only, change it before any exposure.
- No automated axe accessibility scan yet; keyboard/screen-reader semantics were built in but only partly verified
  (Playwright role-based selectors, manual check).
- `pnpm build` bundle: main chunk ~520 kB (React + Zod + Query); charts are lazy-loaded.
- Rate-limit/lockout state is in memory. Migrations are forward-only (back up first).
- Importing nested topics is not supported (imports create top-level topics only).
- Collections can be assigned from the question editor; there is no bulk "add selected questions to collection"
  UI yet (the API endpoint exists).
- Playwright exam timeout path is covered by an API integration test, not an E2E test.

## Next tasks

1. Add `@axe-core/playwright` checks to the E2E suite and fix any findings (contrast in dark mode, landmark use).
2. Bulk selection in the question bank (add to collection, archive, change status) using
   `POST /api/collections/:id/questions`.
3. E2E for timed-exam auto-submit and session resume across browser restart; CI workflow (GitHub Actions with a
   Postgres service) once the owner approves pushing.

Verify with: `pnpm check && pnpm test:e2e && pnpm check:secrets`.
