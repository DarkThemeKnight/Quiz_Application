import { existsSync } from 'node:fs';

export default function globalSetup(): void {
  if (!existsSync('apps/web/dist/index.html')) {
    throw new Error('Build the web app first: pnpm --filter @recall/web build');
  }
}
