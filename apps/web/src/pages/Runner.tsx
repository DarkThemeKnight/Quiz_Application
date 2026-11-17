import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  Flag,
  Lightbulb,
  LogOut,
  SkipForward,
  X,
} from 'lucide-react';
import {
  DEFAULT_NORMALIZATION,
  type Answer,
  type NormalizationOptions,
  type SessionDto,
  type SessionItemDto,
  type SessionResultDto,
} from '@recall/shared';
import { ApiError, api } from '../api/client';
import { invalidateStudyData, keys, useSession } from '../api/hooks';
import { AnswerArea, draftFromAnswer, draftToAnswer, type Draft } from '../components/QuestionView';
import {
  ErrorState,
  LoadingBlock,
  errorMessage,
  useConfirm,
  useDocumentTitle,
  useToast,
} from '../components/ui';
import { SHORT_KIND, formatClock, plural } from '../lib/format';

export function RunnerPage() {
  const { id = '' } = useParams();
  useDocumentTitle('Study session');
  const session = useSession(id);
  if (session.isPending) {
    return (
      <div className="runner card panel">
        <LoadingBlock rows={6} label="Loading session" />
      </div>
    );
  }
  if (session.isError) {
    return (
      <div className="runner card panel">
        <ErrorState error={session.error} onRetry={() => void session.refetch()} />
      </div>
    );
  }
  if (session.data.status === 'submitted')
    return <Navigate to={`/session/${id}/results`} replace />;
  if (session.data.status === 'abandoned') {
    return (
      <div className="runner card panel">
        <ErrorState
          title="This session was discarded"
          error={new Error('Discarded sessions cannot be resumed.')}
        />
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link to="/practice" className="btn btn-primary">
            Start a new session
          </Link>
        </div>
      </div>
    );
  }
  return <Runner session={session.data} />;
}

function fillGapHint(blankCount: number, normalization: NormalizationOptions | null): string {
  const rules = normalization ?? DEFAULT_NORMALIZATION;
  const where = blankCount > 1 ? ` in each of the ${blankCount} blanks` : '';
  const notes = [
    rules.caseSensitive ? 'Match capitalisation' : 'Capitalisation does not matter',
    'extra spaces are ignored',
  ];
  if (rules.ignoreAccents) notes.push('accents are ignored');
  if (rules.ignorePunctuation) notes.push('punctuation is ignored');
  return `Type your answer${where}. ${notes.join(', ')}.`;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT' ||
      el.isContentEditable)
  );
}

function Runner({ session }: { session: SessionDto }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const isExam = session.mode === 'exam';
  const items = session.items;
  const total = items.length;

  const [index, setIndex] = useState(() =>
    Math.min(Math.max(session.currentPosition, 0), total - 1),
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(items.map((i) => [i.id, draftFromAnswer(i.question, i.answer)])),
  );
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const [saveState, setSaveState] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});
  const [savesInFlight, setSavesInFlight] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const viewStart = useRef(Date.now());
  const pendingTimers = useRef<Record<string, number>>({});
  const saveChains = useRef<Record<string, Promise<void>>>({});
  const saveGen = useRef<Record<string, number>>({});
  const failedSaves = useRef(new Set<string>());
  const submitting = useRef(false);
  const finishRef = useRef<(force?: boolean) => Promise<void>>(async () => {});
  const headingRef = useRef<HTMLHeadingElement>(null);

  const item = items[index] as SessionItemDto;
  const draft = drafts[item.id] ?? draftFromAnswer(item.question, item.answer);
  const locked = !isExam && item.feedback !== null;

  /* ---- Server clock offset & countdown ---- */
  const clockOffset = useMemo(
    () => Date.parse(session.serverNow) - Date.now(),
    [session.serverNow],
  );
  const deadline = session.endsAt ? Date.parse(session.endsAt) : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [deadline]);
  const remaining = deadline ? deadline - (now + clockOffset) : null;

  const updateItem = useCallback(
    (updated: SessionItemDto) => {
      client.setQueryData<SessionDto>(keys.session(session.id), (old) =>
        old ? { ...old, items: old.items.map((i) => (i.id === updated.id ? updated : i)) } : old,
      );
    },
    [client, session.id],
  );

  const takeElapsed = useCallback(() => {
    const elapsed = Date.now() - viewStart.current;
    viewStart.current = Date.now();
    return Math.max(0, Math.min(elapsed, 30 * 60 * 1000));
  }, []);

  /* ---- Submission ---- */
  const submit = useMutation({
    mutationFn: () => api.post<SessionResultDto>(`/sessions/${session.id}/submit`),
    onSuccess: (result) => {
      client.setQueryData(keys.result(session.id), result);
      void client.invalidateQueries({ queryKey: keys.session(session.id) });
      void invalidateStudyData(client);
      void navigate(`/session/${session.id}/results`, { replace: true });
    },
    onError: (e) => {
      submitting.current = false;
      toast(errorMessage(e), 'error');
    },
  });

  /**
   * Saves for one item run in order, so a slower earlier request cannot overwrite a later one.
   * A newer save ignores the response of an older one.
   */
  const runSave = useCallback(
    (itemId: string, answer: Answer | null) => {
      const myGen = (saveGen.current[itemId] ?? 0) + 1;
      saveGen.current[itemId] = myGen;
      failedSaves.current.delete(itemId);
      setSavesInFlight((n) => n + 1);
      setSaveState((s) => ({ ...s, [itemId]: 'saving' }));
      const elapsedMs = takeElapsed();
      const task = (saveChains.current[itemId] ?? Promise.resolve()).then(() =>
        api.put<SessionItemDto>(`/sessions/${session.id}/items/${itemId}/answer`, {
          answer,
          elapsedMs,
        }),
      );
      const settled = task.then(
        (updated) => {
          if (saveGen.current[itemId] !== myGen) return;
          updateItem(updated);
          setSaveState((s) => ({ ...s, [itemId]: 'saved' }));
        },
        (e: unknown) => {
          if (saveGen.current[itemId] !== myGen) return;
          failedSaves.current.add(itemId);
          setSaveState((s) => ({ ...s, [itemId]: 'error' }));
          if (e instanceof ApiError && e.code === 'DEADLINE_PASSED') {
            if (!submitting.current) {
              toast('Time is up — your exam was submitted.');
              void finishRef.current(true);
            }
          } else toast(errorMessage(e), 'error');
        },
      );
      saveChains.current[itemId] = settled.finally(() => setSavesInFlight((n) => n - 1));
      return settled;
    },
    [session.id, takeElapsed, toast, updateItem],
  );

  /** Send every debounced draft, then wait until those saves (and any already in flight) settle. */
  const flushAll = useCallback(async () => {
    const flushed = new Set<string>();
    for (const itemId of Object.keys(pendingTimers.current)) {
      const timer = pendingTimers.current[itemId];
      if (timer !== undefined) window.clearTimeout(timer);
      delete pendingTimers.current[itemId];
      const pending = draftsRef.current[itemId];
      if (pending) {
        flushed.add(itemId);
        void runSave(itemId, draftToAnswer(pending));
      }
    }
    for (const itemId of [...failedSaves.current]) {
      if (flushed.has(itemId)) continue;
      const pending = draftsRef.current[itemId];
      if (pending) void runSave(itemId, draftToAnswer(pending));
    }
    await Promise.all(
      Object.values(saveChains.current).map((p) =>
        p.then(
          () => undefined,
          () => undefined,
        ),
      ),
    );
    return failedSaves.current.size > 0;
  }, [runSave]);

  const finish = useCallback(
    async (force = false) => {
      if (submitting.current) return;
      submitting.current = true;
      const failed = await flushAll();
      if (failed && !force) {
        submitting.current = false;
        toast('An answer could not be saved, so the session was not submitted.', 'error');
        return;
      }
      submit.mutate();
    },
    [flushAll, submit, toast],
  );
  finishRef.current = finish;

  useEffect(() => {
    if (remaining !== null && remaining <= 0 && !submitting.current) {
      toast('Time is up — your exam was submitted.');
      void finish(true);
    }
  }, [remaining, finish, toast]);

  const flags = useMutation({
    mutationFn: (vars: {
      itemId: string;
      markedForReview?: boolean;
      skipped?: boolean;
      elapsedMs: number;
    }) =>
      api.patch<SessionItemDto>(`/sessions/${session.id}/items/${vars.itemId}`, {
        markedForReview: vars.markedForReview,
        skipped: vars.skipped,
        elapsedMs: vars.elapsedMs,
      }),
    onSuccess: (updated) => {
      updateItem(updated);
      if (updated.state === 'skipped') {
        const cleared = draftFromAnswer(updated.question, null);
        draftsRef.current = { ...draftsRef.current, [updated.id]: cleared };
        setDrafts(draftsRef.current);
      }
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  /** Exam: persist the current draft (immediately, or after a short pause while typing). */
  const persistExamDraft = (itemId: string, next: Draft, delayMs: number) => {
    window.clearTimeout(pendingTimers.current[itemId]);
    const run = () => {
      delete pendingTimers.current[itemId];
      void runSave(itemId, draftToAnswer(next));
    };
    if (delayMs === 0) run();
    else pendingTimers.current[itemId] = window.setTimeout(run, delayMs);
  };

  const onDraftChange = (next: Draft) => {
    if (locked) return;
    setNotice(null);
    draftsRef.current = { ...draftsRef.current, [item.id]: next };
    setDrafts(draftsRef.current);
    if (isExam) persistExamDraft(item.id, next, next.kind === 'fill_gap' ? 700 : 0);
  };

  /* ---- Navigation ---- */
  const goTo = (next: number, flush = true) => {
    if (next < 0 || next >= total || next === index) return;
    if (flush) void flushAll();
    const elapsed = takeElapsed();
    if (elapsed > 1500 && !locked && item.state !== 'answered' && item.state !== 'skipped') {
      flags.mutate({ itemId: item.id, elapsedMs: elapsed });
    }
    setIndex(next);
    setShowHint(false);
    setNotice(null);
    void api
      .put(`/sessions/${session.id}/progress`, { currentPosition: next })
      .catch(() => undefined);
  };

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: false });
  }, [index]);

  const check = () => {
    const answer = draftToAnswer(draft);
    if (!answer) {
      setNotice(
        draft.kind === 'fill_gap'
          ? 'Type an answer in at least one blank first.'
          : 'Choose an answer first.',
      );
      return;
    }
    void runSave(item.id, answer);
  };

  const skip = () => {
    const itemId = item.id;
    const timer = pendingTimers.current[itemId];
    if (timer !== undefined) window.clearTimeout(timer);
    delete pendingTimers.current[itemId];
    const myGen = (saveGen.current[itemId] ?? 0) + 1;
    saveGen.current[itemId] = myGen;
    failedSaves.current.delete(itemId);
    const elapsedMs = takeElapsed();
    const task = (saveChains.current[itemId] ?? Promise.resolve()).then(() =>
      api.patch<SessionItemDto>(`/sessions/${session.id}/items/${itemId}`, {
        skipped: true,
        elapsedMs,
      }),
    );
    saveChains.current[itemId] = task.then(
      (updated) => {
        if (saveGen.current[itemId] !== myGen) return;
        updateItem(updated);
        const cleared = draftFromAnswer(updated.question, null);
        draftsRef.current = { ...draftsRef.current, [updated.id]: cleared };
        setDrafts(draftsRef.current);
      },
      (e: unknown) => {
        if (saveGen.current[itemId] !== myGen) return;
        failedSaves.current.add(itemId);
        toast(errorMessage(e), 'error');
      },
    );
    if (index < total - 1) goTo(index + 1, false);
  };

  const toggleMark = () =>
    flags.mutate({ itemId: item.id, markedForReview: !item.markedForReview, elapsedMs: 0 });

  const counts = useMemo(() => {
    let answered = 0;
    let skipped = 0;
    let marked = 0;
    for (const i of items) {
      if (i.state === 'answered') answered++;
      if (i.state === 'skipped') skipped++;
      if (i.markedForReview) marked++;
    }
    return { answered, skipped, marked, unanswered: total - answered - skipped };
  }, [items, total]);

  const askSubmit = async () => {
    const failed = await flushAll();
    if (failed) {
      toast('An answer could not be saved. Check the connection and try again.', 'error');
      return;
    }
    const current = client.getQueryData<SessionDto>(keys.session(session.id));
    const itemsNow = current?.items ?? items;
    let unanswered = 0;
    let skipped = 0;
    let marked = 0;
    for (const i of itemsNow) {
      if (i.state === 'skipped') skipped++;
      else if (i.state !== 'answered') unanswered++;
      if (i.markedForReview) marked++;
    }
    const parts = [
      unanswered ? `${plural(unanswered, 'question')} unanswered` : null,
      skipped ? `${skipped} skipped` : null,
      marked ? `${marked} marked for review` : null,
    ].filter(Boolean);
    const ok = await confirm({
      title: isExam ? 'Submit exam?' : 'Finish session?',
      body: (
        <>
          <p style={{ margin: 0 }}>
            {parts.length ? `You have ${parts.join(', ')}.` : 'All questions are answered.'}
          </p>
          <p style={{ margin: '8px 0 0' }}>
            Unanswered and skipped questions count as incorrect. Answers cannot be changed
            afterwards.
          </p>
        </>
      ),
      confirmLabel: isExam ? 'Submit exam' : 'Finish and see results',
    });
    if (ok) void finish(false);
  };

  const discard = async () => {
    const ok = await confirm({
      title: 'Discard this session?',
      body: 'It will not be scored. Answers you already checked in practice still count towards your history.',
      confirmLabel: 'Discard session',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.post(`/sessions/${session.id}/abandon`);
      void invalidateStudyData(client);
      void navigate('/practice');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  /* ---- Keyboard shortcuts: 1–9 choose options, T/F for true/false. Never while typing. ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        isTyping(e.target) ||
        document.querySelector('dialog[open]')
      )
        return;
      if (locked) return;
      const q = item.question;
      if (q.kind === 'true_false') {
        const key = e.key.toLowerCase();
        const value = key === 't' || key === '1' ? true : key === 'f' || key === '2' ? false : null;
        if (value !== null) {
          e.preventDefault();
          onDraftChange({ kind: 'true_false', value });
        }
        return;
      }
      if (q.kind === 'single_choice' || q.kind === 'multi_choice') {
        const n = Number(e.key);
        if (!Number.isInteger(n) || n < 1 || n > q.options.length) return;
        e.preventDefault();
        const optionId = q.options[n - 1]?.id as string;
        if (q.kind === 'single_choice') onDraftChange({ kind: 'single_choice', optionId });
        else if (draft.kind === 'multi_choice') {
          const has = draft.optionIds.includes(optionId);
          onDraftChange({
            kind: 'multi_choice',
            optionIds: has
              ? draft.optionIds.filter((x) => x !== optionId)
              : [...draft.optionIds, optionId],
          });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Flush pending exam saves if the tab is closed or hidden.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushAll();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [flushAll]);

  const feedback = item.feedback;
  const kindHint =
    item.question.kind === 'multi_choice'
      ? 'Select all that apply — every correct option and no incorrect ones.'
      : item.question.kind === 'single_choice'
        ? 'Choose one answer.'
        : item.question.kind === 'true_false'
          ? 'Is the statement true or false?'
          : fillGapHint(item.question.blankKeys.length, item.question.normalization);
  const status = saveState[item.id];
  const lowTime = remaining !== null && remaining <= 60_000;
  const isLast = index === total - 1;

  return (
    <div className="runner">
      <div className="runner-top">
        <Link to="/" className="btn btn-secondary btn-sm" onClick={() => void flushAll()}>
          <LogOut size={15} aria-hidden="true" /> Leave
        </Link>
        <span className="small tabular" aria-live="polite">
          Question {index + 1} of {total}
        </span>
        {remaining !== null ? (
          <span
            className={`timer${lowTime ? ' low' : ''}`}
            role="timer"
            aria-label={`Time remaining ${formatClock(remaining)}`}
          >
            <Clock size={15} aria-hidden="true" /> {formatClock(remaining)}
          </span>
        ) : (
          <span className="small">{isExam ? 'Mock exam · untimed' : 'Practice'}</span>
        )}
      </div>
      {remaining !== null && (
        <span className="sr-only" aria-live="assertive">
          {remaining <= 60_000 && remaining > 55_000
            ? 'One minute remaining.'
            : remaining <= 300_000 && remaining > 295_000
              ? 'Five minutes remaining.'
              : ''}
        </span>
      )}
      <div
        className="progressbar"
        role="progressbar"
        aria-label="Answered questions"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={counts.answered}
      >
        <div style={{ width: `${(counts.answered / total) * 100}%` }} />
      </div>

      <article className="card question-card" aria-labelledby="question-heading">
        <div className="question-meta">
          <span className="pill">{SHORT_KIND[item.question.kind]}</span>
          <span className="badge">{item.question.difficulty}</span>
          {item.markedForReview && (
            <span className="badge badge-warn">
              <Flag size={12} aria-hidden="true" /> Marked
            </span>
          )}
          {item.state === 'skipped' && <span className="badge">Skipped</span>}
        </div>
        <h2 id="question-heading" ref={headingRef} tabIndex={-1} className="sr-only">
          Question {index + 1}
        </h2>
        {item.question.kind !== 'fill_gap' && (
          <div className="question-text">{item.question.body}</div>
        )}
        <p
          className="small"
          id="answer-instructions"
          style={{ marginTop: item.question.kind === 'fill_gap' ? 16 : 0 }}
        >
          {kindHint}
        </p>
        <AnswerArea
          question={item.question}
          draft={draft}
          onChange={onDraftChange}
          disabled={locked || submit.isPending}
          labelledBy="answer-instructions"
          reveal={
            feedback
              ? {
                  correctOptionIds: feedback.correctOptionIds,
                  correctBoolean: feedback.correctBoolean,
                  perBlank: feedback.grade.perBlank,
                }
              : null
          }
        />

        {!isExam && item.question.hint && !feedback && (
          <div style={{ marginTop: 6 }}>
            {showHint ? (
              <div className="callout">
                <strong className="row">
                  <Lightbulb size={15} aria-hidden="true" /> Hint
                </strong>
                <p className="pre-wrap" style={{ margin: '4px 0 0', color: 'var(--ink)' }}>
                  {item.question.hint}
                </p>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() => setShowHint(true)}
              >
                <Lightbulb size={15} aria-hidden="true" /> Show hint
              </button>
            )}
          </div>
        )}

        {notice && (
          <div className="callout callout-warn" role="alert" style={{ marginTop: 12 }}>
            {notice}
          </div>
        )}

        <div aria-live="polite">
          {feedback && (
            <div className={`feedback ${feedback.isCorrect ? 'is-correct' : 'is-incorrect'}`}>
              <strong className={feedback.isCorrect ? 'good' : 'bad'}>
                {feedback.isCorrect ? (
                  <Check size={17} aria-hidden="true" />
                ) : (
                  <X size={17} aria-hidden="true" />
                )}
                {feedback.isCorrect ? 'Correct' : 'Not quite'}
              </strong>
              {item.question.kind === 'fill_gap' && (
                <p>
                  Accepted:{' '}
                  {feedback.acceptedAnswers.map((b, i) => (
                    <span key={b.key}>
                      {i > 0 && ' · '}
                      blank {i + 1}: {b.acceptedAnswers.map((a) => `“${a}”`).join(' or ')}
                    </span>
                  ))}
                </p>
              )}
              {item.question.kind === 'true_false' && !feedback.isCorrect && (
                <p>The statement is {feedback.correctBoolean ? 'true' : 'false'}.</p>
              )}
              {feedback.explanation && <p className="pre-wrap">{feedback.explanation}</p>}
              {feedback.sourceLabel && <p className="small">Source: {feedback.sourceLabel}</p>}
            </div>
          )}
        </div>

        <div className="question-actions">
          <div className="row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => goTo(index - 1)}
              disabled={index === 0}
            >
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={toggleMark}
              aria-pressed={item.markedForReview}
            >
              <Flag size={15} aria-hidden="true" />{' '}
              {item.markedForReview ? 'Unmark' : 'Mark for review'}
            </button>
            {session.allowSkip && !locked && item.state !== 'skipped' && (
              <button type="button" className="btn btn-quiet" onClick={skip}>
                <SkipForward size={15} aria-hidden="true" /> Skip
              </button>
            )}
          </div>
          <div className="row">
            {isExam && (
              <span className="small" aria-live="polite">
                {status === 'saving'
                  ? 'Saving…'
                  : status === 'saved'
                    ? 'Saved'
                    : status === 'error'
                      ? 'Not saved'
                      : ''}
              </span>
            )}
            {!isExam && !feedback ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={check}
                disabled={savesInFlight > 0}
              >
                Check answer <ArrowRight size={16} aria-hidden="true" />
              </button>
            ) : isLast ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void askSubmit()}
                disabled={submit.isPending}
              >
                {isExam ? 'Review & submit' : 'See results'}{' '}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => goTo(index + 1)}>
                {isExam ? 'Save & next' : 'Next question'}{' '}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </article>

      <section className="card panel" style={{ marginTop: 16 }} aria-labelledby="nav-title">
        <div className="section-title">
          <h3 id="nav-title">Questions</h3>
          <span className="small">
            {counts.answered} answered · {counts.skipped} skipped · {counts.marked} marked
          </span>
        </div>
        <div className="navigator">
          {items.map((it, i) => {
            const result =
              !isExam && it.feedback ? (it.feedback.isCorrect ? 'correct' : 'incorrect') : '';
            const cls = [
              'nav-dot',
              it.state === 'answered' ? 'answered' : '',
              it.state === 'skipped' ? 'skipped' : '',
              result,
              i === index ? 'current' : '',
            ]
              .filter(Boolean)
              .join(' ');
            const label = `Question ${i + 1}, ${result || it.state}${it.markedForReview ? ', marked for review' : ''}`;
            return (
              <button
                key={it.id}
                type="button"
                className={cls}
                onClick={() => goTo(i)}
                aria-label={label}
                aria-current={i === index ? 'step' : undefined}
              >
                {i + 1}
                {it.markedForReview && <Flag size={11} className="flag" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
        <div className="row-between" style={{ marginTop: 16 }}>
          <span className="small">
            Shortcuts: <span className="kbd">1</span>–<span className="kbd">9</span> choose an
            option
            {item.question.kind === 'true_false' && (
              <>
                , <span className="kbd">T</span>/<span className="kbd">F</span>
              </>
            )}
            . Progress is saved on the server — you can leave and resume.
          </span>
          <div className="row">
            <button
              type="button"
              className="btn btn-danger-outline btn-sm"
              onClick={() => void discard()}
            >
              Discard
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void askSubmit()}
              disabled={submit.isPending}
            >
              {isExam ? 'Submit exam' : 'Finish now'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
