import type { ReactNode } from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  FolderTree,
  History,
  LayoutDashboard,
  Library,
  LogOut,
  Moon,
  Settings,
  Sun,
  Target,
  Diamond,
} from 'lucide-react';
import type { Me, Theme } from '@recall/shared';
import { api } from '../api/client';
import { keys } from '../api/hooks';
import { applyTheme, resolveTheme } from '../lib/theme';

const NAV = [
  { to: '/', label: 'Overview', short: 'Home', icon: LayoutDashboard, end: true, mobile: true },
  { to: '/practice', label: 'Practice', short: 'Practice', icon: Target, mobile: true },
  { to: '/bank', label: 'Question bank', short: 'Bank', icon: Library, mobile: true },
  {
    to: '/library',
    label: 'Subjects & collections',
    short: 'Library',
    icon: FolderTree,
    mobile: false,
  },
  { to: '/history', label: 'History', short: 'History', icon: History, mobile: true },
  { to: '/insights', label: 'Insights', short: 'Insights', icon: BarChart3, mobile: true },
  { to: '/settings', label: 'Settings', short: 'Settings', icon: Settings, mobile: false },
];

function titleFor(pathname: string): string {
  if (pathname.startsWith('/session/') && pathname.endsWith('/results')) return 'Results';
  if (pathname.startsWith('/session/')) return 'Study session';
  if (pathname.startsWith('/bank/import')) return 'Import questions';
  if (pathname.startsWith('/bank/new')) return 'New question';
  if (pathname.startsWith('/bank/')) return 'Edit question';
  const match = NAV.filter((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)))[0];
  return match?.label ?? 'Recall Studio';
}

export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const theme = me.preferences.theme;
  const resolved = resolveTheme(theme);

  const themeMutation = useMutation({
    mutationFn: (next: Theme) => api.patch<Me>('/auth/me', { preferences: { theme: next } }),
    onMutate: (next) => applyTheme(next),
    onSuccess: (updated) => client.setQueryData(keys.me, updated),
  });
  const logout = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      client.clear();
      void navigate('/login', { replace: true });
    },
  });

  const toggleTheme = () => themeMutation.mutate(resolved === 'dark' ? 'light' : 'dark');
  const initials = (me.displayName || me.username).slice(0, 2);

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="side" aria-label="Sidebar">
        <Link to="/" className="brand" aria-label="Recall Studio home">
          <div className="logo" aria-hidden="true">
            <Diamond size={20} />
          </div>
          <div>
            <div className="brand-name">
              recall<span>.</span>
            </div>
            <div className="brand-sub">A quieter way to learn</div>
          </div>
        </Link>
        <div>
          <div className="nav-label">Workspace</div>
          <nav className="nav" aria-label="Main navigation">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end}>
                <Icon size={18} aria-hidden="true" /> {label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="side-bottom">
          <div className="identity">
            <div className="avatar" aria-hidden="true">
              {initials}
            </div>
            <div style={{ minWidth: 0 }}>
              <strong>{me.displayName}</strong>
              <div className="small">Private · local-first</div>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            <LogOut size={15} aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <Link to="/" className="mobile-brand" aria-label="Recall Studio home">
            <span className="logo" aria-hidden="true">
              <Diamond size={16} />
            </span>
            recall.
          </Link>
          <div className="crumb">
            Study workspace <span aria-hidden="true">/</span>{' '}
            <strong>{titleFor(location.pathname)}</strong>
          </div>
          <div className="top-actions">
            <NavLink
              to="/library"
              className="icon-btn ghost hide-desktop"
              aria-label="Subjects and collections"
            >
              <FolderTree size={18} aria-hidden="true" />
            </NavLink>
            <NavLink to="/settings" className="icon-btn ghost" aria-label="Settings">
              <Settings size={18} aria-hidden="true" />
            </NavLink>
            <button
              type="button"
              className="icon-btn"
              onClick={toggleTheme}
              aria-label={resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={resolved === 'dark' ? 'Light theme' : 'Dark theme'}
            >
              {resolved === 'dark' ? (
                <Sun size={18} aria-hidden="true" />
              ) : (
                <Moon size={18} aria-hidden="true" />
              )}
            </button>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
      </div>
      <nav className="mobilebar" aria-label="Mobile navigation">
        {NAV.filter((n) => n.mobile).map(({ to, short, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}>
            <Icon size={20} aria-hidden="true" />
            {short}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
