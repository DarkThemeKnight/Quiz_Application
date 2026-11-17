import { createHmac, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { authSessions, owners } from '../db/schema.js';

export const SESSION_COOKIE = 'rs_session';

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only this keyed hash is stored, so a database leak does not reveal usable tokens. */
export function hashToken(secret: string, token: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

export async function createAuthSession(
  db: Db,
  opts: { ownerId: string; secret: string; ttlMs: number; userAgent: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + opts.ttlMs);
  await db.insert(authSessions).values({
    ownerId: opts.ownerId,
    tokenHash: hashToken(opts.secret, token),
    expiresAt,
    userAgent: opts.userAgent.slice(0, 200),
  });
  // Opportunistic cleanup of long-dead sessions.
  await db
    .delete(authSessions)
    .where(
      or(
        lt(authSessions.expiresAt, sql`now() - interval '30 days'`),
        lt(authSessions.revokedAt, sql`now() - interval '30 days'`),
      ),
    );
  return { token, expiresAt };
}

export interface AuthContext {
  sessionId: string;
  ownerId: string;
  username: string;
}

export async function resolveAuthSession(
  db: Db,
  secret: string,
  token: string,
): Promise<AuthContext | null> {
  if (!token || token.length > 200) return null;
  const rows = await db
    .select({
      sessionId: authSessions.id,
      ownerId: owners.id,
      username: owners.username,
      lastUsedAt: authSessions.lastUsedAt,
    })
    .from(authSessions)
    .innerJoin(owners, eq(owners.id, authSessions.ownerId))
    .where(
      and(
        eq(authSessions.tokenHash, hashToken(secret, token)),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await db
      .update(authSessions)
      .set({ lastUsedAt: new Date() })
      .where(eq(authSessions.id, row.sessionId));
  }
  return { sessionId: row.sessionId, ownerId: row.ownerId, username: row.username };
}

export async function revokeAuthSession(db: Db, sessionId: string): Promise<void> {
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(eq(authSessions.id, sessionId));
}

export async function revokeAllAuthSessions(
  db: Db,
  ownerId: string,
  exceptSessionId?: string,
): Promise<void> {
  const base = and(eq(authSessions.ownerId, ownerId), isNull(authSessions.revokedAt));
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(exceptSessionId ? and(base, sql`${authSessions.id} <> ${exceptSessionId}`) : base);
}
