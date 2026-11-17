/** Load the neutral, clearly-labelled sample bank (examples/sample_bank.json). Safe to re-run. */
import { readFileSync } from 'node:fs';
import { SAMPLE_BANK_PATH } from '../routes/data.js';
import { commitImport } from '../services/importer.js';
import { AppError } from '../errors.js';
import { dbFail, fail, openDatabaseFromEnv } from './common.js';

const database = openDatabaseFromEnv();
try {
  const result = await commitImport(database.db, {
    format: 'json',
    content: readFileSync(SAMPLE_BANK_PATH, 'utf8'),
    duplicates: 'skip',
  });
  console.log(
    `✔ Sample bank: ${result.imported} imported, ${result.skippedDuplicates} already present, ${result.createdSubjects} subject(s) and ${result.createdTopics} topic(s) created.`,
  );
} catch (error) {
  if (error instanceof AppError) fail(error.message);
  dbFail(error);
} finally {
  await database.close();
}
