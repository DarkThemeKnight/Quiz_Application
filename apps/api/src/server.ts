import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { checkDatabase, createDatabase } from './db/client.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(
        `\n✖ Recall Studio cannot start.\n${error.message}\n\nCopy .env.example to .env and fill in your own values (see README).\n`,
      );
      process.exit(1);
    }
    throw error;
  }
  const database = createDatabase(config);
  const status = await checkDatabase(database);
  if (!status.ok) {
    console.error(`\n✖ Recall Studio cannot start: ${status.message}\n`);
    await database.close();
    process.exit(1);
  }
  const app = await buildApp({ config, database });
  const shutdown = async () => {
    await app.close();
    await database.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  console.error('✖ Fatal startup error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
