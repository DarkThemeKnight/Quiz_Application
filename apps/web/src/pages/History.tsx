import { useState } from 'react';
import { Link } from 'react-router';
import { History as HistoryIcon, Plus } from 'lucide-react';
import { useHistory } from '../api/hooks';
import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Pagination,
  useDocumentTitle,
} from '../components/ui';
import { formatDateTime, formatDuration, formatPercent } from '../lib/format';

export function HistoryPage() {
  useDocumentTitle('History');
  const [mode, setMode] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const history = useHistory({ mode: mode || undefined, status: status || undefined, page } as {
    mode?: string;
    status?: string;
    page: number;
  });

  return (
    <div className="page">
      <PageHeader
        eyebrow="Every session counts"
        title="History"
        description="Completed results never change, even if you later edit or delete questions."
        actions={
          <Link to="/practice" className="btn btn-primary">
            <Plus size={16} aria-hidden="true" /> New session
          </Link>
        }
      />
      <div className="card panel">
        <div className="row" style={{ marginBottom: 14 }}>
          <div className="field">
            <label htmlFor="h-mode">Mode</label>
            <select
              id="h-mode"
              className="select"
              value={mode}
              onChange={(e) => (setMode(e.target.value), setPage(1))}
            >
              <option value="">All modes</option>
              <option value="practice">Practice</option>
              <option value="exam">Exam</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="h-status">Status</label>
            <select
              id="h-status"
              className="select"
              value={status}
              onChange={(e) => (setStatus(e.target.value), setPage(1))}
            >
              <option value="">All</option>
              <option value="submitted">Completed</option>
              <option value="active">In progress</option>
              <option value="abandoned">Discarded</option>
            </select>
          </div>
        </div>
        {history.isPending ? (
          <LoadingBlock rows={5} />
        ) : history.isError ? (
          <ErrorState error={history.error} onRetry={() => void history.refetch()} />
        ) : history.data.items.length === 0 ? (
          <EmptyState
            icon={<HistoryIcon size={22} />}
            title="No sessions yet"
            actions={
              <Link to="/practice" className="btn btn-primary">
                Start practising
              </Link>
            }
          >
            Your practice sessions and exams will be listed here.
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Session</th>
                    <th scope="col">Mode</th>
                    <th scope="col">Started</th>
                    <th scope="col" className="hide-small">
                      Duration
                    </th>
                    <th scope="col" className="num">
                      Correct
                    </th>
                    <th scope="col" className="num">
                      Score
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.items.map((s) => (
                    <tr key={s.id}>
                      <td className="title">
                        <Link
                          to={
                            s.status === 'submitted'
                              ? `/session/${s.id}/results`
                              : `/session/${s.id}`
                          }
                        >
                          {s.title}
                        </Link>
                        {s.status !== 'submitted' && (
                          <div>
                            <span
                              className={`badge ${s.status === 'active' ? 'badge-accent' : ''}`}
                            >
                              {s.status === 'active' ? 'In progress' : 'Discarded'}
                            </span>
                          </div>
                        )}
                      </td>
                      <td>
                        <span className="badge">{s.mode === 'exam' ? 'Exam' : 'Practice'}</span>
                      </td>
                      <td className="muted">{formatDateTime(s.startedAt)}</td>
                      <td className="hide-small muted">{formatDuration(s.durationMs)}</td>
                      <td className="num">
                        {s.correct !== null
                          ? `${s.correct}/${s.questionCount}`
                          : `${s.answeredCount}/${s.questionCount} answered`}
                      </td>
                      <td className="num">
                        <strong>{formatPercent(s.percent)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={history.data.page}
              pageSize={history.data.pageSize}
              total={history.data.total}
              onPage={setPage}
            />
          </>
        )}
      </div>
    </div>
  );
}
