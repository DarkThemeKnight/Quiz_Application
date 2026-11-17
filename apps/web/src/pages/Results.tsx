import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { CalendarPlus, Check, Flag, RotateCcw, SkipForward, X } from 'lucide-react';
import type { ResultItemDto } from '@recall/shared';
import { gapBodyToDisplayText } from '@recall/shared';
import { api } from '../api/client';
import { useResult, useStartSession } from '../api/hooks';
import { describeAnswer, describeCorrect } from '../components/QuestionView';
import {
  ErrorState,
  LoadingBlock,
  RateBar,
  errorMessage,
  useDocumentTitle,
  useToast,
} from '../components/ui';
import { SHORT_KIND, formatDateTime, formatDuration, formatPercent, plural } from '../lib/format';

type Filter = 'all' | 'incorrect' | 'skipped' | 'marked';

export function ResultsPage() {
  const { id = '' } = useParams();
  useDocumentTitle('Results');
  const result = useResult(id);
  const start = useStartSession();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');

  const schedule = useMutation({
    mutationFn: (questionIds: string[]) =>
      api.post<{ scheduled: number }>('/review/schedule', { questionIds }),
    onSuccess: (r) =>
      toast(`${plural(r.scheduled, 'question')} added to your review queue (due now).`),
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const missed = useMemo(
    () =>
      (result.data?.items ?? []).filter(
        (i) => !i.isCorrect && i.liveStatus !== 'deleted' && i.liveStatus !== 'archived',
      ),
    [result.data],
  );
  const missedIds = missed.map((i) => i.snapshot.questionId);

  if (result.isPending) {
    return (
      <div className="page-narrow card panel">
        <LoadingBlock rows={6} label="Loading results" />
      </div>
    );
  }
  if (result.isError) {
    return (
      <div className="page-narrow card panel">
        <ErrorState error={result.error} onRetry={() => void result.refetch()} />
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link to={`/session/${id}`} className="btn btn-secondary">
            Back to session
          </Link>
        </div>
      </div>
    );
  }
  const r = result.data;
  const s = r.score;
  const visible = r.items.filter((i) =>
    filter === 'all'
      ? true
      : filter === 'incorrect'
        ? i.state === 'answered' && !i.isCorrect
        : filter === 'skipped'
          ? i.state !== 'answered'
          : i.markedForReview,
  );

  return (
    <div className="page-narrow stack">
      <section className="card results-hero" aria-labelledby="result-title">
        <div className="eyebrow">
          {r.session.mode === 'exam' ? 'Exam submitted' : 'Session completed'}
        </div>
        <h1 id="result-title">{r.session.title}</h1>
        <div className="results-score" aria-label={`Score ${formatPercent(s.percent)}`}>
          {formatPercent(s.percent)}
        </div>
        <p style={{ margin: 0 }}>
          {s.correct} of {plural(s.total, 'question')} correct. Score = correct ÷ all assigned
          questions; skipped and unanswered count as not correct.
        </p>
        <div className="stat-strip">
          <div>
            <span className="small">Correct</span>
            <strong className="good">{s.correct}</strong>
          </div>
          <div>
            <span className="small">Incorrect</span>
            <strong className="bad">{s.incorrect}</strong>
          </div>
          <div>
            <span className="small">Skipped</span>
            <strong>{s.skipped}</strong>
          </div>
          <div>
            <span className="small">Unanswered</span>
            <strong>{s.unanswered}</strong>
          </div>
          <div>
            <span className="small">Duration</span>
            <strong>{formatDuration(r.durationMs)}</strong>
          </div>
        </div>
        {r.session.submitReason === 'timeout' && (
          <p className="small warn" style={{ marginTop: 12 }}>
            Submitted automatically when time ran out.
          </p>
        )}
        <p className="small" style={{ marginTop: 10 }}>
          Submitted {formatDateTime(r.session.submittedAt)}
        </p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          {missedIds.length > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={start.isPending}
              onClick={() =>
                start.mutate(
                  {
                    mode: 'practice',
                    questionIds: missedIds,
                    count: missedIds.length,
                    shuffle: true,
                    title: `Retry · ${r.session.title}`.slice(0, 120),
                  },
                  { onError: (e) => toast(errorMessage(e), 'error') },
                )
              }
            >
              <RotateCcw size={16} aria-hidden="true" /> Retry{' '}
              {plural(missedIds.length, 'missed question')}
            </button>
          )}
          {missedIds.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={schedule.isPending}
              onClick={() => schedule.mutate(missedIds)}
            >
              <CalendarPlus size={16} aria-hidden="true" /> Schedule missed for review
            </button>
          )}
          <Link to="/practice" className="btn btn-secondary">
            New session
          </Link>
        </div>
      </section>

      {r.byTopic.length > 0 && (
        <section className="card panel" aria-labelledby="topic-title">
          <h2 id="topic-title" style={{ marginBottom: 8 }}>
            By topic
          </h2>
          {r.byTopic.map((t) => (
            <div className="insight" key={`${t.subjectName}-${t.label}`}>
              <div className="grow">
                <div style={{ fontWeight: 650 }}>{t.label}</div>
                <div className="small">
                  {t.subjectName} · {t.correct}/{t.total}
                </div>
                <RateBar percent={t.percent} weak={(t.percent ?? 0) < 70} />
              </div>
              <div className="score">{formatPercent(t.percent)}</div>
            </div>
          ))}
        </section>
      )}

      <section className="card panel" aria-labelledby="review-title">
        <div className="section-title">
          <h2 id="review-title">Answer review</h2>
          <div className="segmented" role="radiogroup" aria-label="Filter answers">
            {(['all', 'incorrect', 'skipped', 'marked'] as Filter[]).map((f) => (
              <label key={f}>
                <input
                  type="radio"
                  name="review-filter"
                  checked={filter === f}
                  onChange={() => setFilter(f)}
                />
                <span>
                  {f === 'all'
                    ? 'All'
                    : f === 'incorrect'
                      ? 'Incorrect'
                      : f === 'skipped'
                        ? 'Skipped / blank'
                        : 'Marked'}
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="stack-sm">
          {visible.length === 0 && <p className="small">No questions match this filter.</p>}
          {visible.map((item) => (
            <ReviewItem key={item.id} item={item} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ReviewItem({ item }: { item: ResultItemDto }) {
  const snap = item.snapshot;
  const status = item.state !== 'answered' ? 'skipped' : item.isCorrect ? 'correct' : 'incorrect';
  return (
    <article
      className={`review-item is-${status}`}
      aria-label={`Question ${item.position + 1}: ${status}`}
    >
      <div className="row-between">
        <div className="row">
          <strong>Q{item.position + 1}</strong>
          {status === 'correct' ? (
            <span className="badge badge-good">
              <Check size={12} aria-hidden="true" /> Correct
            </span>
          ) : status === 'incorrect' ? (
            <span className="badge badge-bad">
              <X size={12} aria-hidden="true" /> Incorrect
            </span>
          ) : (
            <span className="badge">
              <SkipForward size={12} aria-hidden="true" />{' '}
              {item.state === 'skipped' ? 'Skipped' : 'Unanswered'}
            </span>
          )}
          {item.markedForReview && (
            <span className="badge badge-warn">
              <Flag size={12} aria-hidden="true" /> Marked
            </span>
          )}
        </div>
        <span className="small">
          {SHORT_KIND[snap.kind]} · {snap.topic?.name ?? snap.subject.name}
          {item.timeSpentMs > 0 && ` · ${formatDuration(item.timeSpentMs)}`}
        </span>
      </div>
      <p className="pre-wrap" style={{ color: 'var(--ink)', fontWeight: 600, margin: '10px 0' }}>
        {gapBodyToDisplayText(snap.body)}
      </p>
      <dl style={{ margin: 0 }}>
        <div className="answer-line">
          <dt>Your answer</dt>
          <dd className={status === 'correct' ? 'good' : status === 'incorrect' ? 'bad' : 'muted'}>
            {describeAnswer(snap, item.answer)}
          </dd>
        </div>
        <div className="answer-line">
          <dt>{snap.kind === 'fill_gap' ? 'Accepted answers' : 'Correct answer'}</dt>
          <dd>{describeCorrect(snap)}</dd>
        </div>
      </dl>
      {snap.explanation && (
        <p className="pre-wrap" style={{ margin: '10px 0 0' }}>
          {snap.explanation}
        </p>
      )}
      {snap.sourceLabel && (
        <p className="small" style={{ margin: '6px 0 0' }}>
          Source: {snap.sourceLabel}
        </p>
      )}
      {item.liveStatus !== 'same' && (
        <p className="small" style={{ margin: '8px 0 0' }}>
          {item.liveStatus === 'edited'
            ? 'This question has been edited since — shown as it was when you answered it.'
            : item.liveStatus === 'archived'
              ? 'This question has since been archived.'
              : 'This question has since been deleted; your answer history is preserved.'}
        </p>
      )}
    </article>
  );
}
