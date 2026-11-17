import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, LogOut, ShieldCheck, Sparkles, Upload } from 'lucide-react';
import {
  LEITNER_BOX_INTERVAL_DAYS,
  type AuthSessionInfo,
  type ImportCommitDto,
  type Me,
  type Preferences,
} from '@recall/shared';
import { api } from '../api/client';
import { invalidateBank, invalidateStudyData, keys } from '../api/hooks';
import { PageHeader, errorMessage, useConfirm, useDocumentTitle, useToast } from '../components/ui';
import { applyTheme } from '../lib/theme';
import { formatDateTime, plural } from '../lib/format';

/** "Chrome on Linux" instead of the full user-agent string. */
function describeBrowser(ua: string): string {
  if (!ua) return 'Unknown browser';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'unknown OS';
  return `${browser} on ${os}`;
}

export function SettingsPage({ me }: { me: Me }) {
  useDocumentTitle('Settings');
  const client = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [displayName, setDisplayName] = useState(me.displayName);
  const [prefs, setPrefs] = useState<Preferences>(me.preferences);

  const saveProfile = useMutation({
    mutationFn: (body: { displayName?: string; preferences?: Partial<Preferences> }) =>
      api.patch<Me>('/auth/me', body),
    onSuccess: (updated) => {
      client.setQueryData(keys.me, updated);
      applyTheme(updated.preferences.theme);
      void invalidateStudyData(client);
      toast('Settings saved.');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const loadSample = useMutation({
    mutationFn: () => api.post<ImportCommitDto>('/import/sample'),
    onSuccess: (r) => {
      toast(
        r.imported
          ? `Loaded ${plural(r.imported, 'sample question')}.`
          : 'Sample questions are already loaded.',
      );
      void invalidateBank(client);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const setPref = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
    setPrefs((p) => ({ ...p, [key]: value }));
  const submitPrefs = (e: FormEvent) => {
    e.preventDefault();
    saveProfile.mutate({ displayName: displayName.trim() || me.username, preferences: prefs });
  };

  return (
    <div className="page-narrow stack">
      <PageHeader
        eyebrow="Your workspace"
        title="Settings"
        description="Preferences, data portability and security for your private study space."
      />

      <form className="card panel stack" onSubmit={submitPrefs} aria-labelledby="prefs-title">
        <h2 id="prefs-title">Profile & preferences</h2>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="display-name">Display name</label>
            <input
              id="display-name"
              className="input"
              value={displayName}
              maxLength={80}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <span className="hint">Signed in as {me.username}</span>
          </div>
          <div className="field">
            <label htmlFor="theme">Theme</label>
            <select
              id="theme"
              className="select"
              value={prefs.theme}
              onChange={(e) => setPref('theme', e.target.value as Preferences['theme'])}
            >
              <option value="system">Match system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="default-mode">Default mode</label>
            <select
              id="default-mode"
              className="select"
              value={prefs.defaultMode}
              onChange={(e) => setPref('defaultMode', e.target.value as Preferences['defaultMode'])}
            >
              <option value="practice">Practice</option>
              <option value="exam">Mock exam</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="default-count">Default question count</label>
            <input
              id="default-count"
              className="input"
              type="number"
              min={1}
              max={200}
              value={prefs.defaultQuestionCount}
              onChange={(e) => setPref('defaultQuestionCount', Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="default-minutes">Default exam time (minutes)</label>
            <input
              id="default-minutes"
              className="input"
              type="number"
              min={1}
              max={600}
              value={prefs.defaultExamMinutes}
              onChange={(e) => setPref('defaultExamMinutes', Number(e.target.value))}
            />
          </div>
        </div>
        <div className="stack-sm">
          <label className="check">
            <input
              type="checkbox"
              checked={prefs.practiceHints}
              onChange={(e) => setPref('practiceHints', e.target.checked)}
            />{' '}
            Offer hints in practice mode (never in exams)
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={prefs.allowSkip}
              onChange={(e) => setPref('allowSkip', e.target.checked)}
            />{' '}
            Allow skipping questions by default
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={prefs.spacedReview}
              onChange={(e) => setPref('spacedReview', e.target.checked)}
            />{' '}
            Spaced review (Leitner schedule)
          </label>
          <p className="small" style={{ margin: '0 0 0 25px' }}>
            Each answered question sits in one of five boxes. A wrong answer sends it to box 1 (due
            immediately); a correct answer moves it up one box, due after{' '}
            {[2, 3, 4, 5]
              .map(
                (b) =>
                  `${LEITNER_BOX_INTERVAL_DAYS[b]} day${LEITNER_BOX_INTERVAL_DAYS[b] === 1 ? '' : 's'}`,
              )
              .join(' / ')}{' '}
            for boxes 2–5. Skipped questions don’t change the schedule. Turning this off stops
            scheduling and hides “due” counts.
          </p>
        </div>
        <div>
          <button type="submit" className="btn btn-primary" disabled={saveProfile.isPending}>
            {saveProfile.isPending ? 'Saving…' : 'Save preferences'}
          </button>
        </div>
      </form>

      <section className="card panel stack" aria-labelledby="data-title">
        <h2 id="data-title">Data, export & import</h2>
        <p className="small" style={{ margin: 0 }}>
          Exports download to this computer. They can contain your private notes and answers — keep
          them out of Git and shared folders.
        </p>
        <div className="row">
          <a className="btn btn-secondary" href="/api/export/questions" download>
            <Download size={16} aria-hidden="true" /> Question bank (JSON)
          </a>
          <a className="btn btn-secondary" href="/api/export/questions?format=csv" download>
            <Download size={16} aria-hidden="true" /> Question bank (CSV)
          </a>
          <a
            className="btn btn-secondary"
            href="/api/export/questions?includeArchived=true"
            download
          >
            <Download size={16} aria-hidden="true" /> Bank incl. archived
          </a>
          <a className="btn btn-secondary" href="/api/export/progress" download>
            <Download size={16} aria-hidden="true" /> Progress & history (JSON)
          </a>
        </div>
        <div className="row">
          <Link to="/bank/import" className="btn btn-secondary">
            <Upload size={16} aria-hidden="true" /> Import questions
          </Link>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => loadSample.mutate()}
            disabled={loadSample.isPending}
          >
            <Sparkles size={16} aria-hidden="true" /> Load sample questions
          </button>
        </div>
        <p className="small" style={{ margin: 0 }}>
          Sample questions go into a subject called “Sample: General Knowledge” — archive or delete
          it whenever you like.
        </p>
      </section>

      <section className="card panel stack" aria-labelledby="backup-title">
        <h2 id="backup-title">Full database backup</h2>
        <p className="small" style={{ margin: 0 }}>
          The JSON exports are for portability. For a complete backup (including history and
          settings) use PostgreSQL’s own tools from a terminal. Run them from the project folder so{' '}
          <code>.env</code> is picked up, and store backup files outside the repository.
        </p>
        <pre>{`set -a; . ./.env; set +a
mkdir -p ~/recall-backups
pg_dump --format=custom --file ~/recall-backups/recall-$(date +%F).dump "$DATABASE_URL"

# Restore into an EMPTY database (see docs/BACKUP.md first):
pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" ~/recall-backups/recall-YYYY-MM-DD.dump`}</pre>
      </section>

      <SecuritySection confirm={confirm} />

      <section className="card panel stack" aria-labelledby="privacy-title">
        <h2 id="privacy-title">Privacy</h2>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            All data stays in your own PostgreSQL database. The app makes no requests to third-party
            services: no analytics, fonts, CDNs or AI.
          </li>
          <li>Server logs never include passwords, cookies, answers or imported content.</li>
          <li>
            Session cookies are HTTP-only and same-site; only a keyed hash of each session token is
            stored.
          </li>
          <li>
            The app listens on 127.0.0.1 by default. Exposing it to a network needs HTTPS and
            explicit configuration (docs/SECURITY.md).
          </li>
        </ul>
      </section>
    </div>
  );
}

function SecuritySection({ confirm }: { confirm: ReturnType<typeof useConfirm> }) {
  const toast = useToast();
  const client = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const sessions = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: () => api.get<AuthSessionInfo[]>('/auth/sessions'),
  });

  const change = useMutation({
    mutationFn: () => api.post('/auth/password', { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      toast('Password changed. Other sessions were signed out.');
      setCurrent('');
      setNext('');
      setRepeat('');
      void client.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string | null) =>
      id ? api.del(`/auth/sessions/${id}`) : api.post('/auth/sessions/revoke-others'),
    onSuccess: () => {
      toast('Signed out.');
      void client.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const mismatch = repeat.length > 0 && next !== repeat;
  const tooShort = next.length > 0 && next.length < 12;

  return (
    <section className="card panel stack" aria-labelledby="security-title">
      <h2 id="security-title" className="row">
        <ShieldCheck size={18} aria-hidden="true" /> Security
      </h2>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          if (!mismatch && !tooShort) change.mutate();
        }}
      >
        <div className="field">
          <label htmlFor="pw-current">Current password</label>
          <input
            id="pw-current"
            className="input"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="pw-new">New password</label>
          <input
            id="pw-new"
            className="input"
            type="password"
            autoComplete="new-password"
            value={next}
            aria-invalid={tooShort}
            onChange={(e) => setNext(e.target.value)}
          />
          <span className={tooShort ? 'field-error' : 'hint'}>At least 12 characters.</span>
        </div>
        <div className="field">
          <label htmlFor="pw-repeat">Repeat new password</label>
          <input
            id="pw-repeat"
            className="input"
            type="password"
            autoComplete="new-password"
            value={repeat}
            aria-invalid={mismatch}
            onChange={(e) => setRepeat(e.target.value)}
          />
          {mismatch && <span className="field-error">Passwords do not match.</span>}
        </div>
        <div className="wide row">
          <button
            type="submit"
            className="btn btn-secondary"
            disabled={!current || !next || mismatch || tooShort || change.isPending}
          >
            Change password
          </button>
          {change.isError && (
            <span className="field-error" role="alert">
              {errorMessage(change.error)}
            </span>
          )}
        </div>
      </form>

      <div>
        <div className="section-title">
          <h3>Signed-in sessions</h3>
          <button
            type="button"
            className="btn btn-danger-outline btn-sm"
            onClick={async () => {
              if (
                await confirm({
                  title: 'Sign out all other sessions?',
                  confirmLabel: 'Sign out others',
                  destructive: true,
                })
              )
                revoke.mutate(null);
            }}
          >
            <LogOut size={14} aria-hidden="true" /> Sign out others
          </button>
        </div>
        {sessions.data?.map((s) => (
          <div className="insight" key={s.id}>
            <div className="grow">
              <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                <span title={s.userAgent}>{describeBrowser(s.userAgent)}</span>{' '}
                {s.current && <span className="badge badge-accent">This browser</span>}
              </div>
              <div className="small">
                Signed in {formatDateTime(s.createdAt)} · last active {formatDateTime(s.lastUsedAt)}{' '}
                · expires {formatDateTime(s.expiresAt)}
              </div>
            </div>
            {!s.current && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => revoke.mutate(s.id)}
              >
                Sign out
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
