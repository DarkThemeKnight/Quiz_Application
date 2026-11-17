import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { parseConfig, ConfigError } from '../src/config.js';
import { authSessions, owners } from '../src/db/schema.js';
import { hashToken } from '../src/auth/sessions.js';
import {
  api,
  cookieFrom,
  ORIGIN,
  PASSWORD,
  setupTestApp,
  teardown,
  USERNAME,
  type TestContext,
} from './helpers.js';

describe('configuration validation', () => {
  const valid = {
    APP_ORIGIN: 'http://127.0.0.1:5173',
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db',
    SESSION_SECRET: 'x'.repeat(64),
  };
  it('accepts a minimal valid config and defaults to loopback', () => {
    const c = parseConfig(valid);
    expect(c.host).toBe('127.0.0.1');
    expect(c.cookieSecure).toBe(false);
  });
  it('rejects missing DATABASE_URL without echoing secrets', () => {
    expect(() => parseConfig({ ...valid, DATABASE_URL: undefined })).toThrow(ConfigError);
    try {
      parseConfig({ ...valid, DATABASE_URL: undefined });
    } catch (e) {
      expect(String(e)).not.toContain('x'.repeat(64));
    }
  });
  it('rejects the .env.example placeholders', () => {
    expect(() =>
      parseConfig({
        ...valid,
        DATABASE_URL: 'postgresql://YOUR_DB_USER:YOUR_PASSWORD@127.0.0.1:5432/YOUR_DB_NAME',
      }),
    ).toThrow(/placeholder/);
    expect(() =>
      parseConfig({ ...valid, SESSION_SECRET: 'REPLACE_WITH_SECURE_RANDOM_64_HEX_CHARS' }),
    ).toThrow(/placeholder/);
    expect(() => parseConfig({ ...valid, SESSION_SECRET: 'short' })).toThrow(/32/);
  });
  it('refuses a public listener unless explicitly allowed', () => {
    expect(() => parseConfig({ ...valid, APP_HOST: '0.0.0.0' })).toThrow(/loopback/);
    expect(parseConfig({ ...valid, APP_HOST: '0.0.0.0', ALLOW_PUBLIC_LISTEN: 'true' }).host).toBe(
      '0.0.0.0',
    );
  });
  it('uses secure cookies for https origins', () => {
    expect(parseConfig({ ...valid, APP_ORIGIN: 'https://quiz.example.test' }).cookieSecure).toBe(
      true,
    );
  });
});

describe('authentication', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await setupTestApp();
  });
  afterAll(async () => teardown(ctx));

  const anon = (
    method: 'GET' | 'POST',
    url: string,
    payload?: object,
    origin: string | null = ORIGIN,
  ) =>
    ctx.app.inject({
      method,
      url,
      headers: origin ? { origin } : {},
      ...(payload ? { payload } : {}),
    });

  it('requires a session for every data route', async () => {
    for (const url of [
      '/api/questions',
      '/api/subjects',
      '/api/dashboard',
      '/api/sessions',
      '/api/export/questions',
      '/api/auth/me',
    ]) {
      expect((await anon('GET', url)).statusCode, url).toBe(401);
    }
    expect((await anon('POST', '/api/subjects', { name: 'x' })).statusCode).toBe(401);
  });

  it('exposes only health and status publicly', async () => {
    expect((await anon('GET', '/api/health')).statusCode).toBe(200);
    const status = await anon('GET', '/api/auth/status');
    expect(status.json()).toEqual({ ownerConfigured: true, authenticated: false });
  });

  it('rejects state-changing requests from other origins or with no origin', async () => {
    const payload = { username: USERNAME, password: PASSWORD };
    expect(
      (await anon('POST', '/api/auth/login', payload, 'https://evil.example')).statusCode,
    ).toBe(403);
    expect((await anon('POST', '/api/auth/login', payload, null)).statusCode).toBe(403);
    const call = api(ctx);
    const cross = await ctx.app.inject({
      method: 'POST',
      url: '/api/subjects',
      headers: { origin: 'https://evil.example', cookie: ctx.cookie },
      payload: { name: 'x' },
    });
    expect(cross.statusCode).toBe(403);
    expect((await call('GET', '/api/subjects')).json).toEqual([]);
  });

  it('rejects wrong passwords and unknown users with the same message', async () => {
    const a = await anon('POST', '/api/auth/login', {
      username: USERNAME,
      password: 'wrong password!!',
    });
    const b = await anon('POST', '/api/auth/login', {
      username: 'nobody',
      password: 'wrong password!!',
    });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json().error.message).toBe(b.json().error.message);
  });

  it('issues an HttpOnly SameSite=Strict cookie and stores only a hash of the token', async () => {
    const res = await anon('POST', '/api/auth/login', {
      username: USERNAME.toUpperCase(),
      password: PASSWORD,
    });
    expect(res.statusCode).toBe(200);
    const header = String(res.headers['set-cookie']);
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/SameSite=Strict/);
    expect(header).not.toMatch(/Secure/); // http dev origin
    const token = cookieFrom(res).split('=')[1] ?? '';
    const rows = await ctx.database.db.select().from(authSessions);
    expect(rows.some((r) => r.tokenHash === token)).toBe(false);
    expect(rows.some((r) => r.tokenHash === hashToken(ctx.config.sessionSecret, token))).toBe(true);
    expect(res.json().username).toBe(USERNAME);
  });

  it('logout revokes the session server-side', async () => {
    const login = await anon('POST', '/api/auth/login', { username: USERNAME, password: PASSWORD });
    const cookie = cookieFrom(login);
    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    const out = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie, origin: ORIGIN },
    });
    expect(out.statusCode).toBe(200);
    const after = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it('rejects expired and forged tokens', async () => {
    const login = await anon('POST', '/api/auth/login', { username: USERNAME, password: PASSWORD });
    const cookie = cookieFrom(login);
    const token = cookie.split('=')[1] ?? '';
    await ctx.database.db
      .update(authSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(authSessions.tokenHash, hashToken(ctx.config.sessionSecret, token)));
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: { cookie: 'rs_session=forged' },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('allows only one owner row', async () => {
    await expect(
      ctx.database.db.insert(owners).values({ username: 'second', passwordHash: 'x' }),
    ).rejects.toThrow();
  });

  it('updates preferences and validates them', async () => {
    const call = api(ctx);
    const ok = await call<{ preferences: { theme: string; spacedReview: boolean } }>(
      'PATCH',
      '/api/auth/me',
      {
        preferences: { theme: 'dark' },
      },
    );
    expect(ok.status).toBe(200);
    expect(ok.json.preferences.theme).toBe('dark');
    expect(ok.json.preferences.spacedReview).toBe(true);
    expect((await call('PATCH', '/api/auth/me', { preferences: { theme: 'neon' } })).status).toBe(
      400,
    );
  });

  it('changes the password and signs out other sessions', async () => {
    const other = cookieFrom(
      await anon('POST', '/api/auth/login', { username: USERNAME, password: PASSWORD }),
    );
    const call = api(ctx);
    expect(
      (
        await call('POST', '/api/auth/password', {
          currentPassword: 'nope',
          newPassword: 'another long password',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('POST', '/api/auth/password', {
          currentPassword: PASSWORD,
          newPassword: 'another long password',
        })
      ).status,
    ).toBe(200);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: other } }))
        .statusCode,
    ).toBe(401);
    expect((await call('GET', '/api/auth/me')).status).toBe(200);
  });

  it('locks a username after repeated failures', async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: ORIGIN },
        payload: { username: 'locked-user', password: 'bad password value' },
        remoteAddress: `10.0.0.${i}`,
      });
      last = res.statusCode;
    }
    expect(last).toBe(429);
  });
});
