import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` only diffs the TypeScript schema against prior migration snapshots;
// it does not connect to a database. Migrations are applied with `pnpm db:migrate`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
