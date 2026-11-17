import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id (the library default algorithm) with OWASP-recommended minimum parameters:
 * 19 MiB memory, 2 iterations, parallelism 1.
 */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;
/** Verify against a throwaway hash so unknown usernames take similar time to wrong passwords. */
export async function burnVerification(password: string): Promise<void> {
  dummyHash ??= hashPassword('recall-studio-timing-equaliser');
  await verifyPassword(await dummyHash, password);
}

export function passwordProblems(password: string, username: string): string[] {
  const problems: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH)
    problems.push(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (password.length > 512) problems.push('Use at most 512 characters.');
  if (username && password.toLowerCase().includes(username.toLowerCase())) {
    problems.push('Password must not contain the username.');
  }
  return problems;
}
