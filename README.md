# Recall Studio

A private, single-owner, local-first quiz application for studying **any** subject — exams, interviews,
certifications, languages or general knowledge. Questions, sessions and progress live in **your own
PostgreSQL database**. There are no accounts to sign up for, no cloud services and no third-party network
requests at runtime.

- **Three question families:** multiple choice (single answer or select-all), true/false, and fill in the gap
  (one or more typed blanks with accepted aliases).
- **Practice** (feedback after each answer) and **mock exams** (optionally timed, results at the end; the
  deadline is enforced by the server).
- **Results that never change**: every answered question is snapshotted, so editing or deleting a question
  later does not alter past scores.
- **Overview, history and insights** built only from answers you actually gave — weak topics, trends, most-missed
  questions, spaced-review queue. Empty states instead of invented numbers.
- **Question bank** with subjects, nested topics, collections, tags, review status, duplicate warnings and
  CSV/JSON import (validated, all-or-nothing) and export.

> Stack: TypeScript · pnpm workspace · React + Vite + React Router + TanStack Query · Fastify + Zod ·
> PostgreSQL + Drizzle ORM · Argon2id auth · Vitest + Playwright. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Requirements

- Node.js 22.12+ (24 LTS recommended; see `.nvmrc`) and pnpm (`corepack enable pnpm`)
- PostgreSQL 14+ — either one you already run, or the optional Docker Compose service in this repo

## Setup

```bash
pnpm install
cp .env.example .env            # then edit .env — never commit it
openssl rand -hex 32            # paste the output into SESSION_SECRET
```

### Database setup

**Option A — your own PostgreSQL.** Create a database and user, then set `DATABASE_URL` in `.env`:

```bash
sudo -u postgres psql -c "CREATE USER quiz_app WITH PASSWORD 'YOUR_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE quiz_application OWNER quiz_app;"
# .env
DATABASE_URL=postgresql://quiz_app:YOUR_PASSWORD@127.0.0.1:5432/quiz_application
```

URL-encode special characters in the password (`@` → `%40`, `:` → `%3A`, `/` → `%2F`).

**Option B — Docker Compose (optional).** Set `POSTGRES_USER`, `POSTGRES_PASSWORD` (and optionally
`POSTGRES_PORT`, default 5433) in `.env`, then:

```bash
docker compose up -d            # binds to 127.0.0.1 only, data in a named volume
# .env
DATABASE_URL=postgresql://recall:YOUR_POSTGRES_PASSWORD@127.0.0.1:5433/recall_studio
```

The compose init script also creates `recall_studio_test` for the automated tests.

### Initialise and create your account

```bash
pnpm db:migrate                 # creates/updates tables (safe to re-run)
pnpm owner:create               # one-time: choose a username and a 12+ character password
pnpm db:seed-sample             # optional: 24 clearly labelled sample questions
```

There is no web sign-up. Forgot the password? Run `pnpm owner:password` (also signs out every session).

## Running

**Development** (hot reload; web on 5173 proxies `/api` to the API on 4000):

```bash
pnpm dev                        # open http://127.0.0.1:5173  (APP_ORIGIN=http://127.0.0.1:5173)
```

**Production build** (one process serves the API and the built web app):

```bash
pnpm build
# in .env set APP_ORIGIN=http://127.0.0.1:4000 and NODE_ENV=production
pnpm start                      # open http://127.0.0.1:4000
```

The server checks its configuration and database at start-up and exits with a clear message if, for example,
`DATABASE_URL` is missing, still has placeholder values, PostgreSQL is unreachable, or migrations are pending.
It only listens on `127.0.0.1` unless you explicitly opt in — see [docs/SECURITY.md](docs/SECURITY.md).

## Tests and checks

| Command                           | What it runs                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm typecheck`                  | `tsc` in every package (strict)                                                 |
| `pnpm lint` / `pnpm format:check` | ESLint (typescript-eslint, react-hooks) / Prettier                              |
| `pnpm test`                       | Vitest: shared domain logic, API integration tests (PostgreSQL), web components |
| `pnpm test:e2e`                   | Playwright against the production build (run `pnpm build` first)                |
| `pnpm check:secrets`              | Fails if `.env`, dumps, keys or credential-looking strings would be committed   |
| `pnpm check`                      | typecheck + lint + format + test + build                                        |

Integration tests need `TEST_DATABASE_URL` and Playwright needs `E2E_DATABASE_URL` in `.env`. **Both databases
are wiped on every run** — never point them at your real data; the test harness refuses if they equal
`DATABASE_URL`. Playwright uses your installed Google Chrome (`channel: chrome`); set `PW_CHANNEL=` and run
`pnpm exec playwright install chromium` to use the bundled browser instead.

## Data, backups and privacy

- Export from **Settings**: question bank (JSON/CSV) and full progress/history (JSON). JSON exports re-import
  cleanly. Format reference: [docs/IMPORT_FORMAT.md](docs/IMPORT_FORMAT.md).
- Complete backups use PostgreSQL tools (`pg_dump` / `pg_restore`): [docs/BACKUP.md](docs/BACKUP.md).
- Backup and export files contain your private study data. Keep them outside this repository; `.gitignore`
  excludes `*.dump`, `backups/` and `.env`, and `pnpm check:secrets` double-checks before you commit.

## Project docs

- [AGENTS.md](AGENTS.md) — rules and handoff for coding agents and maintainers
- [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) — current state, verified commands, next tasks
- [docs/decisions/](docs/decisions/) — architecture decision records
- [design/](design/) — design system, tokens and the original static concept (`preview.html`, mock data only)
- [BUILD_PROMPT.md](BUILD_PROMPT.md), [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md) — original brief
