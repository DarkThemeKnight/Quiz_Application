import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowRight, RotateCcw, Target, Timer } from 'lucide-react';
import {
  DIFFICULTIES,
  MAX_SESSION_QUESTIONS,
  QUESTION_KINDS,
  type Preferences,
  type SessionCreateInput,
} from '@recall/shared';
import { useCollections, useStartSession, useSubjects, useTags, useTopics } from '../api/hooks';
import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  errorMessage,
  useDocumentTitle,
} from '../components/ui';
import { SHORT_KIND } from '../lib/format';

type Mode = 'practice' | 'exam' | 'review';
type Selection = NonNullable<SessionCreateInput['selection']>;

const SELECTIONS: { value: Selection; label: string; hint: string }[] = [
  { value: 'any', label: 'Any question', hint: 'Everything matching the filters' },
  { value: 'new', label: 'New only', hint: 'Never answered before' },
  { value: 'incorrect', label: 'Previously incorrect', hint: 'Your latest answer was wrong' },
  { value: 'due', label: 'Due for review', hint: 'Spaced-review schedule says it is time' },
];

const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);

export function PracticePage({ preferences }: { preferences: Preferences }) {
  useDocumentTitle('Practice');
  const [params] = useSearchParams();
  const subjects = useSubjects();
  const topics = useTopics();
  const collections = useCollections();
  const tags = useTags();
  const start = useStartSession();

  const initialSelection = (params.get('selection') as Selection | null) ?? 'any';
  const [mode, setMode] = useState<Mode>(
    initialSelection === 'incorrect'
      ? 'review'
      : ((params.get('mode') as Mode | null) ?? preferences.defaultMode),
  );
  const [subjectIds, setSubjectIds] = useState<string[]>(list(params.get('subjectIds')));
  const [topicIds, setTopicIds] = useState<string[]>(list(params.get('topicIds')));
  const [collectionIds, setCollectionIds] = useState<string[]>(list(params.get('collectionIds')));
  const [tagNames, setTagNames] = useState<string[]>(list(params.get('tags')));
  const [difficulties, setDifficulties] = useState<string[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [selection, setSelection] = useState<Selection>(initialSelection);
  const [count, setCount] = useState<number>(
    Number(params.get('count')) || preferences.defaultQuestionCount,
  );
  const [shuffle, setShuffle] = useState(true);
  const [allowSkip, setAllowSkip] = useState(preferences.allowSkip);
  const [timed, setTimed] = useState(true);
  const [minutes, setMinutes] = useState(preferences.defaultExamMinutes);

  const visibleTopics = useMemo(
    () =>
      (topics.data ?? []).filter(
        (t) => subjectIds.length === 0 || subjectIds.includes(t.subjectId),
      ),
    [topics.data, subjectIds],
  );

  const toggle = (setter: (fn: (prev: string[]) => string[]) => void, value: string) =>
    setter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));

  const chooseMode = (next: Mode) => {
    setMode(next);
    if (next === 'review') setSelection('incorrect');
    else if (selection === 'incorrect' && mode === 'review') setSelection('any');
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const effectiveMode = mode === 'review' ? 'practice' : mode;
    start.mutate({
      mode: effectiveMode,
      subjectIds,
      topicIds: topicIds.filter((id) => visibleTopics.some((t) => t.id === id)),
      collectionIds,
      tags: tagNames,
      difficulties: difficulties as SessionCreateInput['difficulties'],
      kinds: kinds as SessionCreateInput['kinds'],
      selection,
      count: Math.max(1, Math.min(MAX_SESSION_QUESTIONS, count || 1)),
      shuffle,
      allowSkip,
      timeLimitMinutes: effectiveMode === 'exam' && timed ? minutes : null,
    });
  };

  if (subjects.isPending || topics.isPending || collections.isPending || tags.isPending) {
    return (
      <div className="page card panel">
        <LoadingBlock rows={6} />
      </div>
    );
  }
  if (subjects.isError)
    return <ErrorState error={subjects.error} onRetry={() => void subjects.refetch()} />;
  if ((subjects.data ?? []).every((s) => s.questionCount === 0)) {
    return (
      <div className="page">
        <PageHeader eyebrow="Focused recall" title="Practice" />
        <div className="card">
          <EmptyState
            title="No questions to practise yet"
            actions={
              <>
                <Link to="/bank/new" className="btn btn-primary">
                  Write a question
                </Link>
                <Link to="/bank/import" className="btn btn-secondary">
                  Import questions
                </Link>
              </>
            }
          >
            Sessions draw from published questions in your bank.
          </EmptyState>
        </div>
      </div>
    );
  }

  const modeCards: { value: Mode; icon: typeof Target; title: string; text: string }[] = [
    {
      value: 'practice',
      icon: Target,
      title: 'Practice',
      text: 'Check each answer as you go, with explanations.',
    },
    {
      value: 'exam',
      icon: Timer,
      title: 'Mock exam',
      text: 'Optionally timed. Answers and score revealed at the end.',
    },
    {
      value: 'review',
      icon: RotateCcw,
      title: 'Review mistakes',
      text: 'Practice questions you most recently got wrong.',
    },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Focused recall"
        title="Choose how to practise"
        description="Short practice sessions or a timed mock exam — from any subject, topic or collection."
      />
      <form onSubmit={submit}>
        <fieldset className="mode-grid">
          <legend className="sr-only">Session mode</legend>
          {modeCards.map(({ value, icon: Icon, title, text }) => (
            <label className="mode-card" key={value}>
              <input
                type="radio"
                name="mode"
                value={value}
                checked={mode === value}
                onChange={() => chooseMode(value)}
              />
              <span className="mode-body">
                <span className="mode-icon" aria-hidden="true">
                  <Icon size={20} />
                </span>
                <strong>{title}</strong>
                <span>{text}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="card panel stack">
          <div className="section-title">
            <h2>Session settings</h2>
            <span className="small">Leave filters empty to include everything.</span>
          </div>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="count">Number of questions</label>
              <input
                id="count"
                className="input"
                type="number"
                min={1}
                max={MAX_SESSION_QUESTIONS}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </div>
            {mode === 'exam' && (
              <div className="field">
                <label htmlFor="minutes">Time limit (minutes)</label>
                <div className="row">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={timed}
                      onChange={(e) => setTimed(e.target.checked)}
                    />{' '}
                    Timed
                  </label>
                  <input
                    id="minutes"
                    className="input grow"
                    type="number"
                    min={1}
                    max={600}
                    value={minutes}
                    disabled={!timed}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                    style={{ maxWidth: 120 }}
                  />
                </div>
              </div>
            )}
            <div className="field">
              <span className="label">Options</span>
              <label className="check">
                <input
                  type="checkbox"
                  checked={shuffle}
                  onChange={(e) => setShuffle(e.target.checked)}
                />{' '}
                Shuffle question order
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={allowSkip}
                  onChange={(e) => setAllowSkip(e.target.checked)}
                />{' '}
                Allow skipping
              </label>
            </div>
          </div>

          <fieldset>
            <legend>Which questions</legend>
            <div className="segmented" role="presentation">
              {SELECTIONS.map((s) => (
                <label key={s.value} title={s.hint}>
                  <input
                    type="radio"
                    name="selection"
                    value={s.value}
                    checked={selection === s.value}
                    onChange={() => setSelection(s.value)}
                  />
                  <span>{s.label}</span>
                </label>
              ))}
            </div>
            <p className="small" style={{ margin: '6px 0 0' }}>
              {SELECTIONS.find((s) => s.value === selection)?.hint}
              {selection === 'due' &&
                !preferences.spacedReview &&
                ' — spaced review is turned off in Settings, so nothing new becomes due.'}
            </p>
          </fieldset>

          <ChipGroup
            legend="Subjects"
            items={(subjects.data ?? [])
              .filter((s) => s.questionCount > 0)
              .map((s) => ({ id: s.id, label: s.name, count: s.questionCount }))}
            selected={subjectIds}
            onToggle={(id) => toggle(setSubjectIds, id)}
          />
          {visibleTopics.length > 0 && (
            <ChipGroup
              legend="Topics"
              items={visibleTopics
                .filter((t) => t.questionCount > 0)
                .map((t) => ({ id: t.id, label: t.name, count: t.questionCount }))}
              selected={topicIds}
              onToggle={(id) => toggle(setTopicIds, id)}
              hint="Includes sub-topics."
            />
          )}
          {(collections.data ?? []).some((c) => c.questionCount > 0) && (
            <ChipGroup
              legend="Collections"
              items={(collections.data ?? [])
                .filter((c) => !c.archivedAt && c.questionCount > 0)
                .map((c) => ({ id: c.id, label: c.name, count: c.questionCount }))}
              selected={collectionIds}
              onToggle={(id) => toggle(setCollectionIds, id)}
            />
          )}
          {(tags.data ?? []).length > 0 && (
            <ChipGroup
              legend="Tags"
              items={(tags.data ?? [])
                .filter((t) => t.questionCount > 0)
                .map((t) => ({ id: t.name, label: t.name, count: t.questionCount }))}
              selected={tagNames}
              onToggle={(id) => toggle(setTagNames, id)}
              hint="Questions with any selected tag."
            />
          )}
          <div className="two-col">
            <ChipGroup
              legend="Difficulty"
              items={DIFFICULTIES.map((d) => ({ id: d, label: d[0]?.toUpperCase() + d.slice(1) }))}
              selected={difficulties}
              onToggle={(id) => toggle(setDifficulties, id)}
            />
            <ChipGroup
              legend="Question types"
              items={QUESTION_KINDS.map((k) => ({ id: k, label: SHORT_KIND[k] }))}
              selected={kinds}
              onToggle={(id) => toggle(setKinds, id)}
            />
          </div>

          {start.isError && (
            <div className="callout callout-warn" role="alert">
              {errorMessage(start.error)}
            </div>
          )}
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={start.isPending}>
              {start.isPending
                ? 'Preparing…'
                : mode === 'exam'
                  ? 'Start mock exam'
                  : 'Start practice'}{' '}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
            <span className="small">
              {mode === 'exam'
                ? 'Exam mode: no feedback or hints until you submit.'
                : 'Practice mode: check each answer and see the explanation immediately.'}
            </span>
          </div>
        </div>
      </form>
    </div>
  );
}

function ChipGroup(props: {
  legend: string;
  items: { id: string; label: string; count?: number }[];
  selected: string[];
  onToggle: (id: string) => void;
  hint?: string;
}) {
  if (!props.items.length) return null;
  return (
    <fieldset>
      <legend>
        {props.legend}
        {props.selected.length > 0 && (
          <span className="small"> · {props.selected.length} selected</span>
        )}
      </legend>
      <div className="chip-group">
        {props.items.map((item) => (
          <label className="chip" key={item.id}>
            <input
              type="checkbox"
              checked={props.selected.includes(item.id)}
              onChange={() => props.onToggle(item.id)}
            />
            <span>
              {item.label}
              {item.count !== undefined && <span className="small">{item.count}</span>}
            </span>
          </label>
        ))}
      </div>
      {props.hint && (
        <p className="small" style={{ margin: '6px 0 0' }}>
          {props.hint}
        </p>
      )}
    </fieldset>
  );
}
