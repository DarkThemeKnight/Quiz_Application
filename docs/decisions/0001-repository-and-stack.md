# ADR 0001 — Repository layout and stack

- **Status:** accepted · 2026-11-17
- **Context:** The working folder contained only the design/spec kit (no git repository, no code). The GitHub
  remote `DarkThemeKnight/Quiz_Application` had no refs (empty). Nothing existing needed migrating.

## Decision

Follow the brief's chosen stack exactly:

- pnpm workspace: `apps/api` (Fastify), `apps/web` (React + Vite), `packages/shared` (Zod schemas, types, pure
  grading/scheduling/metrics logic). No `packages/ui` — the component set is small enough to live in the web app.
- TypeScript strict everywhere, plus `noUncheckedIndexedAccess`. **TypeScript is pinned to 6.0** because
  typescript-eslint does not yet support TypeScript 7.
- `@recall/shared` is consumed as TypeScript source (Vite and tsx compile it; tsup bundles it into the API build),
  so there is no separate build step for it.
- Drizzle ORM with generated, versioned SQL migrations in `apps/api/drizzle/`. Migrations are **forward-only**
  (Drizzle has no down migrations); the safety net is `pg_dump` before upgrading (docs/BACKUP.md).
- Zod schemas are parsed explicitly in route handlers (`parse(schema, data)`) rather than through a Fastify type
  provider, avoiding a version-coupled plugin.
- Dialogs use the native `<dialog>` element (focus trap and Escape for free) instead of Radix.
- `@node-rs/argon2` (prebuilt binaries, no compiler needed) for Argon2id.
- pnpm 10+ blocks dependency build scripts; only `esbuild` is allow-listed in `pnpm-workspace.yaml`.

## Kit file moves

- `config/.env.example` → `.env.example`, `config/.gitignore` → `.gitignore` (the kit said to copy them to root).
- The brief references `CLAUDE_BUILD_PROMPT.md`; the file in this repository is `BUILD_PROMPT.md`.
- `README.md` was the kit's description; it now documents the real application.
