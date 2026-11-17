import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  Library,
  Plus,
  RotateCcw,
  Sparkles,
  Target,
  Timer,
  Upload,
} from 'lucide-react';
import type { ImportCommitDto, SessionCreateInput, TopicPerformanceDto } from '@recall/shared';
import { api } from '../api/client';
import { invalidateBank, useDashboard, useStartSession } from '../api/hooks';
import {
  EmptyState,
  ErrorState,
  KpiCard,
  LoadingBlock,
  PageHeader,
  RateBar,
  errorMessage,
  useDocumentTitle,
  useToast,
} from '../components/ui';
import { LazyTrendChart as TrendChart } from '../components/LazyTrendChart';
import { formatPercent, formatRelativeDay, plural } from '../lib/format';

export function weakSessionInput(topics: TopicPerformanceDto[], count = 10): SessionCreateInput {
  const topicIds = topics.map((t) => t.topicId).filter((id): id is string => !!id);
  const subjectIds = topics.filter((t) => !t.topicId).map((t) => t.subjectId);
  return { mode: 'practice', topicIds, subjectIds, count, shuffle: true, title: 'Weak areas' };
}

export function OverviewPage() {
  useDocumentTitle('Overview');
  const dashboard = useDashboard();
  const start = useStartSession();
  const toast = useToast();
  const client = useQueryClient();
  const loadSample = useMutation({
    mutationFn: () => api.post<ImportCommitDto>('/import/sample'),
    onSuccess: (r) => {
      toast(`Loaded ${plural(r.imported, 'sample question')}.`);
      void invalidateBank(client);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const quick = (input: SessionCreateInput) =>
    start.mutate(input, { onError: (e) => toast(errorMessage(e), 'error') });

  if (dashboard.isPending) {
    return (
      <div className="page">
        <PageHeader eyebrow="Your learning space" title="Overview" />
        <div className="card panel">
          <LoadingBlock rows={5} label="Loading overview" />
        </div>
      </div>
    );
  }
  if (dashboard.isError) {
    return (
      <div className="page card panel">
        <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      </div>
    );
  }
  const d = dashboard.data;
  const bankEmpty = d.bank.published === 0;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Your learning space"
        title="Small sessions. Real progress."
        description="What you know, what needs work, and what to practise next."
        actions={
          <Link to="/practice" className="btn btn-primary">
            <Plus size={16} aria-hidden="true" /> New session
          </Link>
        }
      />

      {bankEmpty ? (
        <div className="card">
          <EmptyState
            icon={<BookOpen size={22} />}
            title="Your question bank is empty"
            actions={
              <>
                <Link to="/bank/new" className="btn btn-primary">
                  <Plus size={16} aria-hidden="true" /> Write a question
                </Link>
                <Link to="/bank/import" className="btn btn-secondary">
                  <Upload size={16} aria-hidden="true" /> Import CSV / JSON
                </Link>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => loadSample.mutate()}
                  disabled={loadSample.isPending}
                >
                  <Sparkles size={16} aria-hidden="true" /> Load sample questions
                </button>
              </>
            }
          >
            Add questions for any subject — exams, interviews, certifications or general knowledge.
            Sample questions are clearly labelled and can be archived at any time.
          </EmptyState>
        </div>
      ) : d.activeSession ? (
        <section className="hero" aria-label="Continue your session">
          <div>
            <span className="tag">Pick up where you left off</span>
            <h2>{d.activeSession.title}</h2>
            <p>
              {d.activeSession.mode === 'exam' ? 'Mock exam' : 'Practice'} ·{' '}
              {d.activeSession.answeredCount} of {plural(d.activeSession.questionCount, 'question')}{' '}
              answered · started {formatRelativeDay(d.activeSession.startedAt).toLowerCase()}
            </p>
            <Link to={`/session/${d.activeSession.id}`} className="btn btn-light">
              Continue session <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <div className="hero-art" aria-hidden="true">
            <Timer size={48} />
          </div>
        </section>
      ) : (
        <section className="hero" aria-label="Quick start">
          <div>
            <span className="tag">Quick start</span>
            <h2>Ready for a focused session?</h2>
            <p>Ten questions takes about five minutes. Feedback after every answer.</p>
            <div className="row">
              <button
                type="button"
                className="btn btn-light"
                disabled={start.isPending}
                onClick={() => quick({ mode: 'practice', count: 10, shuffle: true })}
              >
                Practise 10 questions <ArrowRight size={16} aria-hidden="true" />
              </button>
              {d.totalAnswers > 0 && (
                <button
                  type="button"
                  className="btn btn-outline-light"
                  disabled={start.isPending}
                  onClick={() =>
                    quick({ mode: 'practice', count: 10, selection: 'incorrect', shuffle: true })
                  }
                >
                  <RotateCcw size={16} aria-hidden="true" /> Retry recent mistakes
                </button>
              )}
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <Sparkles size={48} />
          </div>
        </section>
      )}

      <div className="kpis">
        <KpiCard
          label="Questions in bank"
          icon={<Library size={17} />}
          value={d.bank.published.toLocaleString()}
          note={`${plural(d.bank.subjects, 'subject')}${d.bank.draft ? ` · ${d.bank.draft} draft` : ''}`}
        />
        <KpiCard
          label="Practice accuracy · 30 days"
          icon={<Target size={17} />}
          empty={d.practiceAccuracy30d.percent === null}
          value={
            d.practiceAccuracy30d.percent === null ? (
              'No data'
            ) : (
              <>
                {Math.round(d.practiceAccuracy30d.percent)}
                <span className="unit">%</span>
              </>
            )
          }
          note={
            d.practiceAccuracy30d.total
              ? `${d.practiceAccuracy30d.correct} of ${plural(d.practiceAccuracy30d.total, 'answer')} correct`
              : 'Not enough attempts to estimate accuracy'
          }
        />
        <KpiCard
          label="Average exam score · 30 days"
          icon={<Timer size={17} />}
          empty={d.averageExamScore30d.percent === null}
          value={
            d.averageExamScore30d.percent === null ? (
              'No exams'
            ) : (
              <>
                {Math.round(d.averageExamScore30d.percent)}
                <span className="unit">%</span>
              </>
            )
          }
          note={
            d.averageExamScore30d.exams
              ? `Mean of ${plural(d.averageExamScore30d.exams, 'completed exam')}`
              : 'Take a mock exam to see a score'
          }
        />
        {d.spacedReview && d.dueForReview !== null ? (
          <KpiCard
            label="Due for review"
            icon={<CalendarClock size={17} />}
            value={d.dueForReview.toLocaleString()}
            note={
              d.dueForReview > 0 ? (
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() =>
                    quick({
                      mode: 'practice',
                      count: Math.min(d.dueForReview ?? 10, 20),
                      selection: 'due',
                      shuffle: true,
                    })
                  }
                >
                  Review now <ArrowRight size={13} aria-hidden="true" />
                </button>
              ) : (
                'Nothing due right now'
              )
            }
          />
        ) : (
          <KpiCard
            label="Questions answered"
            icon={<CalendarClock size={17} />}
            value={d.uniqueQuestionsAnswered.toLocaleString()}
            note={`${plural(d.totalAnswers, 'answer')} in total`}
          />
        )}
      </div>
      <p className="small" style={{ marginTop: -12, marginBottom: 20 }}>
        {d.totalAnswers === 0
          ? 'No answers recorded yet.'
          : `${plural(d.uniqueQuestionsAnswered, 'unique question')} answered across ${plural(d.totalAnswers, 'answer attempt')} (all time).`}
      </p>

      <div className="columns">
        <section className="card panel" aria-labelledby="trend-title">
          <div className="section-title">
            <h2 id="trend-title">Accuracy over time</h2>
            <span className="small">Last 14 days</span>
          </div>
          <p className="small">
            Share of answered questions that were correct, per day. Skipped questions are excluded.
          </p>
          <TrendChart points={d.trend14d} />
        </section>

        <section className="card panel" aria-labelledby="attention-title">
          <div className="section-title">
            <h2 id="attention-title">Needs your attention</h2>
            <Link to="/insights" className="linkbtn">
              Full insights <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </div>
          <p className="small">Topics below 70% with at least 5 answers in the last 90 days.</p>
          {d.weakTopics.length === 0 ? (
            <p className="small" style={{ marginTop: 18 }}>
              {d.topicPerformance.some((t) => t.status !== 'limited_data')
                ? 'No weak topics right now — nice work.'
                : 'Not enough attempts yet to identify weak topics. Answer at least 5 questions in a topic.'}
            </p>
          ) : (
            <>
              {d.weakTopics.map((t) => (
                <div className="insight" key={`${t.subjectId}-${t.topicId}`}>
                  <div className="grow">
                    <div style={{ fontWeight: 650 }}>{t.label}</div>
                    <div className="small">
                      {t.subjectName} · {plural(t.attempts, 'answer')}
                    </div>
                    <RateBar percent={t.percent} weak />
                  </div>
                  <div className="score warn">{formatPercent(t.percent)}</div>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-secondary btn-block"
                style={{ marginTop: 14 }}
                disabled={start.isPending}
                onClick={() => quick(weakSessionInput(d.weakTopics))}
              >
                Practise weak topics <ArrowRight size={16} aria-hidden="true" />
              </button>
            </>
          )}
        </section>
      </div>

      <section className="card panel" aria-labelledby="recent-title">
        <div className="section-title">
          <h2 id="recent-title">Recent sessions</h2>
          <Link to="/history" className="linkbtn">
            View history <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </div>
        {d.recentSessions.length === 0 ? (
          <p className="small">Completed sessions will appear here.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Session</th>
                  <th scope="col">Mode</th>
                  <th scope="col">Date</th>
                  <th scope="col" className="hide-small num">
                    Questions
                  </th>
                  <th scope="col" className="num">
                    Score
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.recentSessions.map((s) => (
                  <tr key={s.id}>
                    <td className="title">
                      <Link to={`/session/${s.id}/results`}>{s.title}</Link>
                    </td>
                    <td>
                      <span className="badge">{s.mode === 'exam' ? 'Exam' : 'Practice'}</span>
                    </td>
                    <td className="muted">{formatRelativeDay(s.submittedAt)}</td>
                    <td className="hide-small num">{s.questionCount}</td>
                    <td className="num">
                      <strong>{formatPercent(s.percent)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
