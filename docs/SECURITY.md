# Security model

Recall Studio is designed for **one owner on one machine**. Defaults are chosen for that.

## What is in place

- **Authentication:** a single owner row (enforced by a unique index on a constant). Created only by
  `pnpm owner:create` on the machine; no HTTP registration, no password-reset emails, no OAuth.
- **Passwords:** Argon2id (19 MiB, t=2, p=1). Minimum 12 characters; must not contain the username. Unknown
  usernames are verified against a dummy hash to equalise timing.
- **Sessions:** 32 random bytes in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` automatically when
  `APP_ORIGIN` is https). Only `HMAC-SHA256(SESSION_SECRET, token)` is stored, with expiry (default 14 days),
  revocation, last-used time and a list/revoke UI in Settings. Logout and password changes revoke server-side.
- **Cross-site requests:** every non-GET `/api` request must carry an `Origin` header exactly matching
  `APP_ORIGIN` (or `EXTRA_ORIGINS`); bodies are JSON only.
- **Rate limits:** 600 requests/min per IP overall; login 10/min per IP plus a 15-minute lock after 10 consecutive
  failures for a username; password change 5/min; import commit 20/min.
- **Input:** Zod validation on every body/query/param, strict objects (unknown fields rejected), size limits
  (1 MB bodies, 6 MB imports, field lengths), parameterised SQL only, LIKE wildcards escaped. User text is
  rendered as text — no HTML rendering anywhere.
- **Headers:** CSP `default-src 'self'` (no inline scripts), `frame-ancestors 'none'`, `nosniff`,
  `Referrer-Policy: no-referrer`, `Cache-Control: no-store` for API responses.
- **Logging:** request bodies, cookies, authorization headers and `Set-Cookie` are redacted; query strings are
  dropped from logged URLs; stack traces are never returned to clients.
- **Configuration:** the server refuses to start with missing or placeholder `DATABASE_URL`/`SESSION_SECRET`, a
  short secret, or a non-loopback `APP_HOST` without `ALLOW_PUBLIC_LISTEN=true`.
- **Repository hygiene:** `.env`, dumps, keys and logs are gitignored; `pnpm check:secrets` scans files before
  commit.

## Exposing it beyond localhost (not the default)

Only do this deliberately:

1. Put it behind a reverse proxy (Caddy/nginx) that terminates **TLS**; set `APP_ORIGIN=https://your-host`.
   Cookies then become `Secure` automatically.
2. Keep the app bound to `127.0.0.1` and let the proxy connect locally. If it must listen elsewhere, set
   `APP_HOST` and `ALLOW_PUBLIC_LISTEN=true`, and firewall the port.
3. Set `TRUST_PROXY=true` only when a trusted proxy sets `X-Forwarded-For` (rate limiting uses client IPs).
4. Use a strong owner password and a fresh `SESSION_SECRET`; keep PostgreSQL unreachable from the network.
5. Never expose the Vite dev server.

## Known limitations

- Rate-limit and lockout counters are in memory (reset on restart) — appropriate for a single local process.
- Exam deadlines trust the server clock; the 2-second grace window allows for request latency.
