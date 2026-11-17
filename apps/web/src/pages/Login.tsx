import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Diamond, LogIn, Terminal } from 'lucide-react';
import type { Me } from '@recall/shared';
import { api } from '../api/client';
import { keys } from '../api/hooks';
import { errorMessage, useDocumentTitle } from '../components/ui';

export function LoginPage({ ownerConfigured }: { ownerConfigured: boolean }) {
  useDocumentTitle('Sign in');
  const client = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const login = useMutation({
    mutationFn: () => api.post<Me>('/auth/login', { username, password }),
    onSuccess: (me) => {
      client.setQueryData(keys.me, me);
      client.setQueryData(keys.status, { ownerConfigured: true, authenticated: true });
      const next = params.get('next');
      void navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', {
        replace: true,
      });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };

  return (
    <div className="center-screen">
      <main className="card login-card" aria-labelledby="login-title">
        <div className="brand">
          <div className="logo" aria-hidden="true">
            <Diamond size={20} />
          </div>
          <div>
            <div className="brand-name">
              recall<span>.</span>
            </div>
            <div className="brand-sub">Private study workspace</div>
          </div>
        </div>
        <h1 id="login-title" style={{ fontSize: 22 }}>
          Sign in
        </h1>
        {!ownerConfigured ? (
          <div className="callout callout-warn" style={{ marginTop: 16 }}>
            <strong className="row">
              <Terminal size={16} aria-hidden="true" /> No owner account yet
            </strong>
            <p style={{ marginTop: 6 }}>
              Create the single owner account from a terminal in the project folder, then reload
              this page:
            </p>
            <pre>pnpm owner:create</pre>
          </div>
        ) : (
          <form onSubmit={submit} className="stack" style={{ marginTop: 18 }} noValidate>
            <div className="field">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                className="input"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {login.isError && (
              <div className="callout callout-bad" role="alert">
                {errorMessage(login.error)}
              </div>
            )}
            <button
              className="btn btn-primary btn-block"
              type="submit"
              disabled={login.isPending || !username || !password}
            >
              <LogIn size={16} aria-hidden="true" /> {login.isPending ? 'Signing in…' : 'Sign in'}
            </button>
            <p className="small" style={{ margin: 0 }}>
              Forgot the password? Run <code>pnpm owner:password</code> on this machine.
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
