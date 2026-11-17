import { runMigrations } from '../db/client.js';
import { dbFail, openDatabaseFromEnv } from './common.js';

const database = openDatabaseFromEnv();
try {
  await runMigrations(database.db);
  console.log('✔ Database migrations are up to date.');
} catch (error) {
  dbFail(error);
} finally {
  await database.close();
}
