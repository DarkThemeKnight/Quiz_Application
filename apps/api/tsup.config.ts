import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { server: 'src/server.ts', migrate: 'src/cli/migrate.ts', owner: 'src/cli/owner.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle the workspace package (TypeScript source); keep npm deps external.
  noExternal: ['@recall/shared'],
});
