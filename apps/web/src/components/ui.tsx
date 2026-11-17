import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertTriangle, Inbox, RefreshCw, X } from 'lucide-react';
import { ApiError } from '../api/client';

/* ---------- Page structure ---------- */

export function PageHeader(props: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="pagehead">
      <div>
        {props.eyebrow && <div className="eyebrow">{props.eyebrow}</div>}
        <h1>{props.title}</h1>
        {props.description && <p>{props.description}</p>}
      </div>
      {props.actions && <div className="row">{props.actions}</div>}
    </div>
  );
}

export function EmptyState(props: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">
        {props.icon ?? <Inbox size={22} />}
      </div>
      <h3>{props.title}</h3>
      {props.children && <p>{props.children}</p>}
      {props.actions && <div className="row">{props.actions}</div>}
    </div>
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

export function ErrorState(props: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div className="empty" role="alert">
      <div
        className="empty-icon"
        aria-hidden="true"
        style={{ background: 'var(--negative-soft)', color: 'var(--negative)' }}
      >
        <AlertTriangle size={22} />
      </div>
      <h3>{props.title ?? 'Could not load this'}</h3>
      <p>{errorMessage(props.error)}</p>
      {props.onRetry && (
        <div className="row">
          <button type="button" className="btn btn-secondary" onClick={props.onRetry}>
            <RefreshCw size={16} aria-hidden="true" /> Try again
          </button>
        </div>
      )}
    </div>
  );
}

export function Skeleton({
  height = 16,
  width = '100%',
}: {
  height?: number;
  width?: number | string;
}) {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />;
}

export function LoadingBlock({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="stack-sm" role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={i === 0 ? 22 : 16} width={i === 0 ? '40%' : `${90 - i * 8}%`} />
      ))}
    </div>
  );
}

export function KpiCard(props: {
  label: string;
  icon?: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  empty?: boolean;
}) {
  return (
    <div className="card kpi">
      <div className="kpi-top">
        <span>{props.label}</span>
        {props.icon && (
          <span className="kpi-icon" aria-hidden="true">
            {props.icon}
          </span>
        )}
      </div>
      <div className={`kpi-number${props.empty ? ' empty' : ''}`}>{props.value}</div>
      {props.note && <div className="kpi-note">{props.note}</div>}
    </div>
  );
}

export function RateBar({ percent, weak }: { percent: number | null; weak?: boolean }) {
  return (
    <div className={`track${weak ? ' weak' : ''}`} aria-hidden="true">
      <div style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }} />
    </div>
  );
}

export function Pagination(props: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(props.total / props.pageSize));
  if (props.total <= props.pageSize) return null;
  const from = (props.page - 1) * props.pageSize + 1;
  const to = Math.min(props.total, props.page * props.pageSize);
  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="small">
        {from}–{to} of {props.total.toLocaleString()}
      </span>
      <div className="row">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={props.page <= 1}
          onClick={() => props.onPage(props.page - 1)}
        >
          Previous
        </button>
        <span className="small">
          Page {props.page} of {pages}
        </span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={props.page >= pages}
          onClick={() => props.onPage(props.page + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}

/* ---------- Form field ---------- */

export function Field(props: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = props.hint ? `${id}-hint` : undefined;
  const errorId = props.error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${props.className ?? ''}`}>
      <label htmlFor={id}>{props.label}</label>
      {props.children({ id, describedBy, invalid: !!props.error })}
      {props.hint && (
        <span className="hint" id={hintId}>
          {props.hint}
        </span>
      )}
      {props.error && (
        <span className="field-error" id={errorId}>
          {props.error}
        </span>
      )}
    </div>
  );
}

/* ---------- Toasts ---------- */

interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
}
const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const push = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message, tone }]);
    window.setTimeout(
      () => setToasts((t) => t.filter((x) => x.id !== id)),
      tone === 'error' ? 8000 : 4500,
    );
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.tone === 'error' ? ' error' : ''}`}>
            <span>{t.message}</span>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/* ---------- Confirmation dialog ---------- */

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  /** When set, the dialog shows a text field and resolves with its value. */
  input?: { label: string; initial: string; maxLength?: number };
}
type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;
type PromptFn = (
  options: ConfirmOptions & { input: NonNullable<ConfirmOptions['input']> },
) => Promise<string | null>;
const ConfirmContext = createContext<ConfirmFn>(async () => false);
const PromptContext = createContext<PromptFn>(async () => null);

/** Accessible confirmation built on the native <dialog> (focus trap + Escape handled by the browser). */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const resolver = useRef<((value: string | null) => void) | null>(null);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [text, setText] = useState('');
  const titleId = useId();
  const inputId = useId();

  const open = useCallback((opts: ConfirmOptions) => {
    setOptions(opts);
    setText(opts.input?.initial ?? '');
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);
  const confirm = useCallback<ConfirmFn>((opts) => open(opts).then((v) => v !== null), [open]);
  const promptText = useCallback<PromptFn>((opts) => open(opts), [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (options && dialog && !dialog.open) dialog.showModal();
  }, [options]);

  const close = (ok: boolean) => {
    dialogRef.current?.close();
    resolver.current?.(ok ? (options?.input ? text.trim() || null : '') : null);
    resolver.current = null;
    setOptions(null);
  };

  const value = useMemo(() => confirm, [confirm]);
  return (
    <ConfirmContext.Provider value={value}>
      <PromptContext.Provider value={promptText}>
        {children}
        <dialog
          ref={dialogRef}
          className="modal"
          aria-labelledby={titleId}
          onCancel={(e) => {
            e.preventDefault();
            close(false);
          }}
        >
          {options && (
            <>
              <form
                method="dialog"
                onSubmit={(e) => {
                  e.preventDefault();
                  close(true);
                }}
              >
                <div className="modal-body">
                  <h2 id={titleId}>{options.title}</h2>
                  {options.body && (
                    <div style={{ marginTop: 10, color: 'var(--muted)' }}>{options.body}</div>
                  )}
                  {options.input && (
                    <div className="field" style={{ marginTop: 14 }}>
                      <label htmlFor={inputId}>{options.input.label}</label>
                      <input
                        id={inputId}
                        className="input"
                        value={text}
                        maxLength={options.input.maxLength ?? 120}
                        onChange={(e) => setText(e.target.value)}
                        autoFocus
                      />
                    </div>
                  )}
                </div>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => close(false)}
                    autoFocus={!options.input}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`btn ${options.destructive ? 'btn-danger' : 'btn-primary'}`}
                    disabled={!!options.input && !text.trim()}
                  >
                    {options.confirmLabel ?? 'Confirm'}
                  </button>
                </div>
              </form>
            </>
          )}
        </dialog>
      </PromptContext.Provider>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
export const usePromptText = () => useContext(PromptContext);

/** Sets document.title for the current page. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · Recall Studio` : 'Recall Studio';
  }, [title]);
}
