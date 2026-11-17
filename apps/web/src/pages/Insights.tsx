import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import {
  ANALYTICS_RANGES,
  LEITNER_BOX_INTERVAL_DAYS,
  gapBodyToDisplayText,
  type AnalyticsRange,
  type RateStat,
} from '@recall/shared';
import { useAnalytics, useStartSession, useSubjects } from '../api/hooks';
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
import { SHORT_KIND, formatDate, formatDuration, formatPercent, plural } from '../lib/format';
import { weakSessionInput } from './Overview';

const RANGE_LABEL: Record<AnalyticsRange, string> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  '365d': '12 months',
  all: 'All time',
};

function RateRow({ label, stat, extra }: { label: string; stat: RateStat; extra?: string }) {
  return (
    <div className="insight">
      <div className="grow">
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div className="small">
          {stat.total ? `${stat.correct}/${plural(stat.total, 'answer')}` : 'No answers'}
          {extra ? ` · ${extra}` : ''}
        </div>
        {stat.total > 0 && <RateBar percent={stat.percent} weak={(stat.percent ?? 0) < 70} />}
      </div>
      <div className={`score${stat.total && (stat.percent ?? 0) < 70 ? ' warn' : ''}`}>
        {formatPercent(stat.percent)}
      </div>
    </div>
  );
}

export function InsightsPage() {
  useDocumentTitle('Insights');
  const [range, setRange] = useState<AnalyticsRange>('30d');
  const [subjectId, setSubjectId] = useState('');
  const [mode, setMode] = useState('all');
  const subjects = useSubjects();
  const analytics = useAnalytics(range, subjectId, mode);
  const start = useStartSession();
  const toast = useToast();
  const startWith = (input: Parameters<typeof start.mutate>[0]) =>
    start.mutate(input, { onError: (e) => toast(errorMessage(e), 'error') });

  const a = analytics.data;
  const weak = (a?.topics ?? []).filter((t) => t.status === 'weak');

  return (
    <div className="page">
      <PageHeader
        eyebrow="From data to better practice"
        title="Learning insights"
        description="Every figure shows its sample size. Accuracy counts answered questions only; exam scores count skipped questions as wrong."
        actions={
          weak.length > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={start.isPending}
              onClick={() => startWith(weakSessionInput(weak.slice(0, 3)))}
            >
              Practise weaknesses <ArrowRight size={16} aria-hidden="true" />
            </button>
          )
        }
      />
      <div className="card panel row" style={{ marginBottom: 18 }}>
        <div className="field">
          <label htmlFor="range">Time range</label>
          <select
            id="range"
            className="select"
            value={range}
            onChange={(e) => setRange(e.target.value as AnalyticsRange)}
          >
            {ANALYTICS_RANGES.map((r) => (
              <option key={r} value={r}>
                {RANGE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="subject">Subject</label>
          <select
            id="subject"
            className="select"
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
          >
            <option value="">All subjects</option>
            {(subjects.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="mode">Mode</label>
          <select
            id="mode"
            className="select"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="all">Practice and exams</option>
            <option value="practice">Practice only</option>
            <option value="exam">Exams only</option>
          </select>
        </div>
        {analytics.isFetching && (
          <span className="small" role="status">
            Updating…
          </span>
        )}
      </div>

      {analytics.isPending ? (
        <div className="card panel">
          <LoadingBlock rows={8} label="Loading insights" />
        </div>
      ) : analytics.isError || !a ? (
        <div className="card panel">
          <ErrorState error={analytics.error} onRetry={() => void analytics.refetch()} />
        </div>
      ) : a.totals.answers === 0 && a.totals.examsCompleted === 0 ? (
        <div className="card">
          <EmptyState
            title={`No answers in ${RANGE_LABEL[range].toLowerCase()}`}
            actions={
              <Link to="/practice" className="btn btn-primary">
                Start a session
              </Link>
            }
          >
            Insights are calculated only from questions you actually answer. Nothing is estimated or
            invented.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="kpis" style={{ marginTop: 0 }}>
            <KpiCard
              label="Practice accuracy"
              value={formatPercent(a.totals.practice.percent)}
              empty={a.totals.practice.percent === null}
              note={
                a.totals.practice.total
                  ? `${a.totals.practice.correct} of ${plural(a.totals.practice.total, 'practice answer')}`
                  : 'No practice answers'
              }
            />
            <KpiCard
              label="Average exam score"
              value={formatPercent(a.totals.averageExamScore)}
              empty={a.totals.averageExamScore === null}
              note={
                a.totals.examsCompleted
                  ? `Mean of ${plural(a.totals.examsCompleted, 'exam')} · pooled ${formatPercent(a.totals.examPooled.percent)} (${a.totals.examPooled.correct}/${a.totals.examPooled.total})`
                  : 'No completed exams'
              }
            />
            <KpiCard
              label="Answers"
              value={a.totals.answers.toLocaleString()}
              note={`${plural(a.totals.uniqueQuestions, 'unique question')} · ${a.totals.skipped} skipped`}
            />
            <KpiCard
              label="Sessions completed"
              value={a.totals.sessionsSubmitted.toLocaleString()}
              note={RANGE_LABEL[range]}
            />
          </div>

          <details className="definition card panel" style={{ marginBottom: 18 }}>
            <summary>How these numbers are calculated</summary>
            <ul>
              <li>
                <strong>Answer</strong>: a question you answered whose result is final — practice
                answers once checked, exam answers once the exam is submitted.
              </li>
              <li>
                <strong>Practice accuracy</strong>: correct practice answers ÷ all practice answers
                in the range (pooled, not an average of sessions). Skipped questions are excluded.
              </li>
              <li>
                <strong>Average exam score</strong>: the mean of each submitted exam’s score
                (correct ÷ assigned, so skipped/unanswered count as wrong). “Pooled” adds up all
                exam questions instead.
              </li>
              <li>
                <strong>Weak topic</strong>: at least 5 answers in the range and accuracy below 70%,
                ranked by (1 − accuracy) × min(1, answers ÷ 10). Fewer than 5 answers shows “limited
                data”.
              </li>
              <li>
                <strong>Average time</strong>: only answers with between 1 second and 30 minutes
                recorded.
              </li>
              <li>
                Topic, type and difficulty are taken from the question as it was when you answered
                it.
              </li>
            </ul>
          </details>

          <section
            className="card panel"
            style={{ marginBottom: 18 }}
            aria-labelledby="trend-title"
          >
            <div className="section-title">
              <h2 id="trend-title">Accuracy trend</h2>
              <span className="small">{RANGE_LABEL[range]}</span>
            </div>
            <TrendChart points={a.trend} showExam={mode !== 'practice'} />
          </section>

          <div className="columns">
            <section className="card panel" aria-labelledby="topics-title">
              <div className="section-title">
                <h2 id="topics-title">Topic performance</h2>
                <span className="small">Weakest first</span>
              </div>
              {a.topics.length === 0 ? (
                <p className="small">No topic data.</p>
              ) : (
                a.topics.map((t) => (
                  <div className="insight" key={`${t.subjectId}-${t.topicId}`}>
                    <div className="grow">
                      <div className="row-between">
                        <strong>{t.label}</strong>
                        {t.status === 'limited_data' ? (
                          <span className="badge">Limited data</span>
                        ) : t.status === 'weak' ? (
                          <span className="badge badge-warn">Needs attention</span>
                        ) : (
                          <span className="badge badge-good">On track</span>
                        )}
                      </div>
                      <div className="small">
                        {t.subjectName} · {t.correct}/{plural(t.attempts, 'answer')} · last{' '}
                        {formatDate(t.lastAttemptAt)}
                      </div>
                      <RateBar percent={t.percent} weak={t.status === 'weak'} />
                    </div>
                    <div className="stack-sm" style={{ justifyItems: 'end' }}>
                      <span className={`score${t.status === 'weak' ? ' warn' : ''}`}>
                        {formatPercent(t.percent)}
                      </span>
                      <button
                        type="button"
                        className="linkbtn"
                        disabled={start.isPending}
                        onClick={() =>
                          startWith({
                            mode: 'practice',
                            count: 10,
                            shuffle: true,
                            ...(t.topicId
                              ? { topicIds: [t.topicId] }
                              : { subjectIds: [t.subjectId] }),
                          })
                        }
                      >
                        Practise
                      </button>
                    </div>
                  </div>
                ))
              )}
            </section>

            <section className="card panel" aria-labelledby="reco-title">
              <div className="section-title">
                <h2 id="reco-title">Recommended next</h2>
              </div>
              {weak.length === 0 ? (
                <p className="small">
                  {a.topics.every((t) => t.status === 'limited_data')
                    ? 'Not enough answers per topic yet to recommend anything. Keep practising — at least 5 answers per topic.'
                    : 'No weak topics in this range.'}
                </p>
              ) : (
                weak.slice(0, 3).map((t, i) => (
                  <div
                    className="callout"
                    key={`${t.subjectId}-${t.topicId}`}
                    style={{ marginBottom: 10 }}
                  >
                    <strong>
                      {String(i + 1).padStart(2, '0')} · {t.label}
                    </strong>
                    <p className="small" style={{ margin: '4px 0 6px' }}>
                      {formatPercent(t.percent)} across {plural(t.attempts, 'answer')}.
                    </p>
                    <button
                      type="button"
                      className="linkbtn"
                      onClick={() =>
                        startWith({
                          mode: 'practice',
                          count: 10,
                          shuffle: true,
                          ...(t.topicId
                            ? { topicIds: [t.topicId] }
                            : { subjectIds: [t.subjectId] }),
                        })
                      }
                    >
                      Practise 10 questions <ArrowRight size={13} aria-hidden="true" />
                    </button>
                  </div>
                ))
              )}
              {a.review.enabled && (
                <div className="callout" style={{ marginTop: 6 }}>
                  <strong>Spaced review</strong>
                  <p className="small" style={{ margin: '4px 0 6px' }}>
                    {plural(a.review.dueNow, 'question')} due now. Boxes:{' '}
                    {a.review.byBox
                      .map((b) => `${b.box} (${LEITNER_BOX_INTERVAL_DAYS[b.box]}d): ${b.count}`)
                      .join(' · ')}
                  </p>
                  {a.review.dueNow > 0 && (
                    <button
                      type="button"
                      className="linkbtn"
                      onClick={() =>
                        startWith({
                          mode: 'practice',
                          selection: 'due',
                          count: Math.min(20, a.review.dueNow),
                          shuffle: true,
                        })
                      }
                    >
                      Review due questions <ArrowRight size={13} aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}
            </section>
          </div>

          <div className="two-col" style={{ marginBottom: 18 }}>
            <section className="card panel" aria-labelledby="kind-title">
              <h2 id="kind-title" style={{ marginBottom: 6 }}>
                By question type
              </h2>
              {a.byKind.length === 0 ? (
                <p className="small">No answers.</p>
              ) : (
                a.byKind.map((k) => (
                  <RateRow
                    key={k.kind}
                    label={SHORT_KIND[k.kind]}
                    stat={k}
                    extra={
                      k.avgTimeMs !== null
                        ? `avg ${formatDuration(k.avgTimeMs)} (${k.timedAnswers} timed)`
                        : 'time not recorded'
                    }
                  />
                ))
              )}
            </section>
            <section className="card panel" aria-labelledby="diff-title">
              <h2 id="diff-title" style={{ marginBottom: 6 }}>
                By difficulty
              </h2>
              {a.byDifficulty.map((d) => (
                <RateRow
                  key={d.difficulty}
                  label={d.difficulty[0]?.toUpperCase() + d.difficulty.slice(1)}
                  stat={d}
                />
              ))}
            </section>
          </div>

          <div className="two-col">
            <section className="card panel" aria-labelledby="missed-title">
              <div className="section-title">
                <h2 id="missed-title">Most missed questions</h2>
                {a.mostMissed.length > 0 && (
                  <button
                    type="button"
                    className="linkbtn"
                    onClick={() =>
                      startWith({
                        mode: 'practice',
                        questionIds: a.mostMissed.map((m) => m.questionId),
                        count: a.mostMissed.length,
                        shuffle: true,
                        title: 'Most missed',
                      })
                    }
                  >
                    Practise these <ArrowRight size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
              {a.mostMissed.length === 0 ? (
                <p className="small">No missed questions in this range.</p>
              ) : (
                a.mostMissed.map((m) => (
                  <div className="insight" key={m.questionId}>
                    <Link
                      to={`/bank/${m.questionId}`}
                      className="grow"
                      style={{ color: 'var(--ink)', overflowWrap: 'anywhere' }}
                    >
                      {gapBodyToDisplayText(m.body).slice(0, 140)}
                    </Link>
                    <span className="small" style={{ whiteSpace: 'nowrap' }}>
                      {m.incorrect}/{m.attempts} wrong
                    </span>
                  </div>
                ))
              )}
            </section>
            <section className="card panel" aria-labelledby="exams-title">
              <h2 id="exams-title" style={{ marginBottom: 6 }}>
                Exam scores
              </h2>
              {a.exams.length === 0 ? (
                <p className="small">No exams submitted in this range.</p>
              ) : (
                a.exams.slice(0, 10).map((e) => (
                  <div className="insight" key={e.id}>
                    <div className="grow">
                      <Link
                        to={`/session/${e.id}/results`}
                        style={{ color: 'var(--ink)', fontWeight: 600 }}
                      >
                        {e.title}
                      </Link>
                      <div className="small">
                        {formatDate(e.submittedAt)} · {plural(e.questionCount, 'question')}
                      </div>
                    </div>
                    <div className="score">{formatPercent(e.percent)}</div>
                  </div>
                ))
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
