import { QUESTION_KIND_LABELS, gapBodyToDisplayText, type QuestionKind } from '@recall/shared';

const dateFmt = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const relFmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export const formatDate = (iso: string | null | undefined) =>
  iso ? dateFmt.format(new Date(iso)) : '—';
export const formatDateTime = (iso: string | null | undefined) =>
  iso ? dateTimeFmt.format(new Date(iso)) : '—';

export function formatRelativeDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(date) - startOf(new Date())) / 86_400_000);
  if (days === 0 || days === -1)
    return relFmt.format(days, 'day').replace(/^./, (c) => c.toUpperCase());
  return formatDate(iso);
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(digits)}%`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export const kindLabel = (kind: QuestionKind) => QUESTION_KIND_LABELS[kind];

export const SHORT_KIND: Record<QuestionKind, string> = {
  single_choice: 'Single choice',
  multi_choice: 'Multi-select',
  true_false: 'True / false',
  fill_gap: 'Fill in the gap',
};

export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

export const displayPrompt = (body: string) => gapBodyToDisplayText(body);

export const optionLetter = (i: number) => String.fromCharCode(65 + i);
