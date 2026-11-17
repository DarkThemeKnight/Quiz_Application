import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArchiveRestore, ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import {
  DEFAULT_NORMALIZATION,
  DIFFICULTIES,
  MAX_OPTIONS,
  QUESTION_KINDS,
  QUESTION_KIND_LABELS,
  parseGapBody,
  questionInputSchema,
  type DuplicateCandidate,
  type NormalizationOptions,
  type QuestionDetailDto,
  type QuestionKind,
} from '@recall/shared';
import { ApiError, api } from '../api/client';
import {
  invalidateBank,
  keys,
  useCollections,
  useQuestion,
  useSubjects,
  useTopics,
} from '../api/hooks';
import { AnswerArea, emptyDraft, type Draft } from '../components/QuestionView';
import {
  ErrorState,
  LoadingBlock,
  PageHeader,
  errorMessage,
  useDocumentTitle,
  useToast,
} from '../components/ui';
import { formatDate, plural } from '../lib/format';

interface OptionRow {
  key: string;
  id?: string | undefined;
  body: string;
  isCorrect: boolean;
}

interface FormState {
  kind: QuestionKind;
  subjectId: string;
  topicId: string;
  difficulty: (typeof DIFFICULTIES)[number];
  status: 'draft' | 'published';
  body: string;
  explanation: string;
  hint: string;
  sourceLabel: string;
  verifiedAt: string;
  reviewStatus: 'unreviewed' | 'verified' | 'needs_update';
  tagsText: string;
  collectionIds: string[];
  options: OptionRow[];
  correctBoolean: boolean | null;
  aliases: Record<string, string>;
  normalization: NormalizationOptions;
}

let rowSeq = 0;
const newRow = (body = '', isCorrect = false, id?: string): OptionRow => ({
  key: `r${++rowSeq}`,
  id,
  body,
  isCorrect,
});

function blankForm(subjectId = ''): FormState {
  return {
    kind: 'single_choice',
    subjectId,
    topicId: '',
    difficulty: 'medium',
    status: 'published',
    body: '',
    explanation: '',
    hint: '',
    sourceLabel: '',
    verifiedAt: '',
    reviewStatus: 'unreviewed',
    tagsText: '',
    collectionIds: [],
    options: [newRow(), newRow(), newRow(), newRow()],
    correctBoolean: null,
    aliases: {},
    normalization: { ...DEFAULT_NORMALIZATION },
  };
}

function fromDetail(q: QuestionDetailDto): FormState {
  return {
    kind: q.kind,
    subjectId: q.subject.id,
    topicId: q.topic?.id ?? '',
    difficulty: q.difficulty,
    status: q.status === 'draft' ? 'draft' : 'published',
    body: q.body,
    explanation: q.explanation,
    hint: q.hint,
    sourceLabel: q.sourceLabel,
    verifiedAt: q.verifiedAt ?? '',
    reviewStatus: q.reviewStatus,
    tagsText: q.tags.join(', '),
    collectionIds: q.collectionIds,
    options: q.options.length
      ? q.options.map((o) => newRow(o.body, o.isCorrect, o.id))
      : [newRow(), newRow(), newRow(), newRow()],
    correctBoolean: q.correctBoolean,
    aliases: Object.fromEntries(q.blanks.map((b) => [b.key, b.acceptedAnswers.join('\n')])),
    normalization: q.normalization,
  };
}

function toPayload(f: FormState) {
  const choice = f.kind === 'single_choice' || f.kind === 'multi_choice';
  const keysInBody = [...new Set(parseGapBody(f.body).keys)];
  return {
    kind: f.kind,
    subjectId: f.subjectId,
    topicId: f.topicId || null,
    difficulty: f.difficulty,
    status: f.status,
    body: f.body,
    explanation: f.explanation,
    hint: f.hint,
    sourceLabel: f.sourceLabel,
    verifiedAt: f.verifiedAt || null,
    reviewStatus: f.reviewStatus,
    tagNames: f.tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    collectionIds: f.collectionIds,
    options: choice
      ? f.options.map((o) => ({
          ...(o.id ? { id: o.id } : {}),
          body: o.body,
          isCorrect: o.isCorrect,
        }))
      : [],
    correctBoolean: f.kind === 'true_false' ? f.correctBoolean : null,
    blanks:
      f.kind === 'fill_gap'
        ? keysInBody.map((key) => ({
            key,
            acceptedAnswers: (f.aliases[key] ?? '')
              .split('\n')
              .map((a) => a.trim())
              .filter(Boolean),
          }))
        : [],
    normalization: f.normalization,
  };
}

function validate(f: FormState): Record<string, string> {
  const result = questionInputSchema.safeParse(toPayload(f));
  const errors: Record<string, string> = {};
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      if (!(path in errors)) errors[path] = issue.message;
    }
  }
  return errors;
}

export function QuestionEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  useDocumentTitle(isNew ? 'New question' : 'Edit question');
  const existing = useQuestion(id);
  const subjects = useSubjects();

  if (!isNew && existing.isPending) {
    return (
      <div className="page-narrow card panel">
        <LoadingBlock rows={8} label="Loading question" />
      </div>
    );
  }
  if (!isNew && existing.isError) {
    return (
      <div className="page-narrow card panel">
        <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />
      </div>
    );
  }
  if (subjects.isPending) {
    return (
      <div className="page-narrow card panel">
        <LoadingBlock rows={8} />
      </div>
    );
  }
  return (
    <Editor
      key={id ?? 'new'}
      existing={existing.data ?? null}
      defaultSubjectId={subjects.data?.[0]?.id ?? ''}
    />
  );
}

function Editor({
  existing,
  defaultSubjectId,
}: {
  existing: QuestionDetailDto | null;
  defaultSubjectId: string;
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const toast = useToast();
  const subjects = useSubjects();
  const topics = useTopics();
  const collections = useCollections();
  const [form, setForm] = useState<FormState>(() =>
    existing ? fromDetail(existing) : blankForm(defaultSubjectId),
  );
  const [touched, setTouched] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [previewDraft, setPreviewDraft] = useState<Draft>(() =>
    emptyDraft({ kind: form.kind, blankKeys: [] }),
  );
  const [newSubject, setNewSubject] = useState('');
  const [newTopic, setNewTopic] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const archived = existing?.status === 'archived';

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const clientErrors = useMemo(() => validate(form), [form]);
  const errors = touched ? { ...clientErrors, ...serverErrors } : serverErrors;
  const err = (path: string) => errors[path];
  const gapKeys = useMemo(() => [...new Set(parseGapBody(form.body).keys)], [form.body]);

  // Keep the preview's draft compatible with the question shape.
  useEffect(() => {
    setPreviewDraft(emptyDraft({ kind: form.kind, blankKeys: gapKeys }));
  }, [form.kind, gapKeys.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Duplicate warning (debounced).
  useEffect(() => {
    if (form.body.trim().length < 8) {
      setDuplicates([]);
      return;
    }
    const t = window.setTimeout(() => {
      api
        .post<DuplicateCandidate[]>('/questions/duplicates', {
          body: form.body,
          ...(existing ? { excludeId: existing.id } : {}),
        })
        .then(setDuplicates)
        .catch(() => setDuplicates([]));
    }, 600);
    return () => window.clearTimeout(t);
  }, [form.body, existing]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const save = useMutation({
    mutationFn: (payload: ReturnType<typeof toPayload>) =>
      existing
        ? api.put<QuestionDetailDto>(`/questions/${existing.id}`, payload)
        : api.post<QuestionDetailDto>('/questions', payload),
    onSuccess: (saved) => {
      client.setQueryData(keys.question(saved.id), saved);
      void invalidateBank(client);
      void client.invalidateQueries({ queryKey: keys.stats });
      setDirty(false);
    },
    onError: (e) => {
      if (e instanceof ApiError) setServerErrors(e.fieldErrors());
    },
  });

  const restore = useMutation({
    mutationFn: () => api.post<QuestionDetailDto>(`/questions/${existing?.id}/restore`),
    onSuccess: (q) => {
      client.setQueryData(keys.question(q.id), q);
      void invalidateBank(client);
      toast('Question restored.');
    },
  });

  const quickSubject = useMutation({
    mutationFn: () => api.post<{ id: string }>('/subjects', { name: newSubject }),
    onSuccess: async (s) => {
      await client.invalidateQueries({ queryKey: keys.subjects });
      update('subjectId', s.id);
      update('topicId', '');
      setNewSubject('');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const quickTopic = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/topics', { subjectId: form.subjectId, name: newTopic }),
    onSuccess: async (t) => {
      await client.invalidateQueries({ queryKey: keys.topics });
      update('topicId', t.id);
      setNewTopic('');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const submit = (e: FormEvent, another = false) => {
    e.preventDefault();
    setTouched(true);
    setServerErrors({});
    if (Object.keys(clientErrors).length) {
      window.setTimeout(() => summaryRef.current?.focus(), 0);
      return;
    }
    save.mutate(toPayload(form), {
      onSuccess: (saved) => {
        toast(existing ? 'Question saved.' : 'Question created.');
        if (another) {
          setForm((f) => ({
            ...blankForm(f.subjectId),
            kind: f.kind,
            topicId: f.topicId,
            difficulty: f.difficulty,
            collectionIds: f.collectionIds,
            tagsText: f.tagsText,
          }));
          setTouched(false);
          bodyRef.current?.focus();
        } else void navigate(existing ? '/bank' : `/bank/${saved.id}`, { replace: !existing });
      },
    });
  };

  const insertBlank = () => {
    const used = new Set(gapKeys);
    let n = 1;
    while (used.has(String(n))) n++;
    const token = `{{blank:${n}}}`;
    const el = bodyRef.current;
    const start = el?.selectionStart ?? form.body.length;
    const end = el?.selectionEnd ?? form.body.length;
    const next = form.body.slice(0, start) + token + form.body.slice(end);
    update('body', next);
    window.setTimeout(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    }, 0);
  };

  const setOption = (key: string, patch: Partial<OptionRow>) =>
    update(
      'options',
      form.options.map((o) => {
        if (o.key === key) return { ...o, ...patch };
        // Single choice: marking one correct unmarks the others.
        if (patch.isCorrect && form.kind === 'single_choice') return { ...o, isCorrect: false };
        return o;
      }),
    );
  const moveOption = (index: number, delta: number) => {
    const next = [...form.options];
    const [row] = next.splice(index, 1);
    if (row) next.splice(index + delta, 0, row);
    update('options', next);
  };

  const subjectTopics = (topics.data ?? []).filter((t) => t.subjectId === form.subjectId);
  const errorList = Object.entries(errors);
  const previewQuestion = {
    kind: form.kind,
    body: form.body || 'Your question text appears here.',
    options: form.options.map((o, i) => ({ id: o.key, body: o.body || `Option ${i + 1}` })),
    blankKeys: gapKeys,
  };
  const noSubjects = (subjects.data ?? []).length === 0;

  return (
    <div className="page-narrow">
      <PageHeader
        eyebrow={existing ? `Revision ${existing.revision}` : 'Question bank'}
        title={existing ? 'Edit question' : 'New question'}
        description={
          existing
            ? `Answered ${plural(existing.attemptCount, 'time')}. Editing creates a new revision; past results keep the version that was answered.`
            : 'Choose a type, write the prompt and mark the correct answer.'
        }
        actions={
          <Link to="/bank" className="btn btn-secondary">
            Back to bank
          </Link>
        }
      />
      {archived && (
        <div className="callout callout-warn row-between" style={{ marginBottom: 16 }}>
          <span>
            This question is archived (since {formatDate(existing?.archivedAt)}). Restore it to edit
            or practise it.
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => restore.mutate()}
            disabled={restore.isPending}
          >
            <ArchiveRestore size={14} aria-hidden="true" /> Restore
          </button>
        </div>
      )}

      <form onSubmit={(e) => submit(e)} noValidate>
        <fieldset disabled={archived || save.isPending} className="stack">
          {errorList.length > 0 && (
            <div className="callout callout-bad" role="alert" tabIndex={-1} ref={summaryRef}>
              <strong>Please fix {plural(errorList.length, 'problem')}:</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {errorList.slice(0, 8).map(([path, message]) => (
                  <li key={path}>{message}</li>
                ))}
              </ul>
            </div>
          )}
          {save.isError &&
            !(save.error instanceof ApiError && save.error.code === 'VALIDATION_ERROR') && (
              <div className="callout callout-bad" role="alert">
                {errorMessage(save.error)}
              </div>
            )}

          <section className="card panel stack">
            <fieldset>
              <legend>Question type</legend>
              <div className="segmented">
                {QUESTION_KINDS.map((k) => (
                  <label key={k}>
                    <input
                      type="radio"
                      name="kind"
                      value={k}
                      checked={form.kind === k}
                      onChange={() => update('kind', k)}
                    />
                    <span>{QUESTION_KIND_LABELS[k]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="form-grid">
              <div className="field">
                <label htmlFor="subject">Subject</label>
                {noSubjects ? (
                  <span className="small">Create your first subject:</span>
                ) : (
                  <select
                    id="subject"
                    className="select"
                    value={form.subjectId}
                    aria-invalid={!!err('subjectId')}
                    onChange={(e) => (update('subjectId', e.target.value), update('topicId', ''))}
                  >
                    <option value="">Choose…</option>
                    {(subjects.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
                <div className="row">
                  <input
                    className="input grow"
                    aria-label="New subject name"
                    placeholder="New subject…"
                    value={newSubject}
                    onChange={(e) => setNewSubject(e.target.value)}
                    style={{ minHeight: 34 }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!newSubject.trim() || quickSubject.isPending}
                    onClick={() => quickSubject.mutate()}
                  >
                    Add
                  </button>
                </div>
                {err('subjectId') && <span className="field-error">{err('subjectId')}</span>}
              </div>
              <div className="field">
                <label htmlFor="topic">Topic (optional)</label>
                <select
                  id="topic"
                  className="select"
                  value={form.topicId}
                  onChange={(e) => update('topicId', e.target.value)}
                  disabled={!form.subjectId}
                >
                  <option value="">No topic</option>
                  {subjectTopics.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {form.subjectId && (
                  <div className="row">
                    <input
                      className="input grow"
                      aria-label="New topic name"
                      placeholder="New topic…"
                      value={newTopic}
                      onChange={(e) => setNewTopic(e.target.value)}
                      style={{ minHeight: 34 }}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={!newTopic.trim() || quickTopic.isPending}
                      onClick={() => quickTopic.mutate()}
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>
              <div className="field">
                <label htmlFor="difficulty">Difficulty</label>
                <select
                  id="difficulty"
                  className="select"
                  value={form.difficulty}
                  onChange={(e) => update('difficulty', e.target.value as FormState['difficulty'])}
                >
                  {DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>
                      {d[0]?.toUpperCase() + d.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label htmlFor="body">{form.kind === 'true_false' ? 'Statement' : 'Question'}</label>
              {form.kind === 'fill_gap' && (
                <div className="row">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={insertBlank}>
                    <Plus size={14} aria-hidden="true" /> Insert blank at cursor
                  </button>
                  <span className="small">
                    Blanks are written as <code>{'{{blank:1}}'}</code>, <code>{'{{blank:2}}'}</code>
                    …
                  </span>
                </div>
              )}
              <textarea
                id="body"
                ref={bodyRef}
                className="textarea"
                rows={form.kind === 'fill_gap' ? 4 : 3}
                value={form.body}
                aria-invalid={!!err('body')}
                aria-describedby={err('body') ? 'body-error' : undefined}
                onChange={(e) => update('body', e.target.value)}
                maxLength={5000}
              />
              {err('body') && (
                <span className="field-error" id="body-error">
                  {err('body')}
                </span>
              )}
              {duplicates.length > 0 && (
                <div className="callout callout-warn" role="status">
                  <strong>Possible duplicate.</strong> A question with the same wording exists:{' '}
                  {duplicates.map((d, i) => (
                    <span key={d.id}>
                      {i > 0 && ', '}
                      <Link to={`/bank/${d.id}`} target="_blank" rel="noreferrer">
                        {d.body.slice(0, 60)}
                        {d.body.length > 60 ? '…' : ''}
                      </Link>{' '}
                      ({d.status})
                    </span>
                  ))}
                  . You can still save.
                </div>
              )}
            </div>

            {(form.kind === 'single_choice' || form.kind === 'multi_choice') && (
              <fieldset>
                <legend>
                  Options —{' '}
                  {form.kind === 'single_choice'
                    ? 'select the one correct answer'
                    : 'tick every correct answer'}
                </legend>
                <div className="stack-sm">
                  {form.options.map((o, i) => (
                    <div className="option-editor" key={o.key}>
                      <label className="check" title="Correct answer">
                        <input
                          type={form.kind === 'single_choice' ? 'radio' : 'checkbox'}
                          name="correct-option"
                          checked={o.isCorrect}
                          onChange={(e) => setOption(o.key, { isCorrect: e.target.checked })}
                          aria-label={`Option ${String.fromCharCode(65 + i)} is correct`}
                        />
                        <strong aria-hidden="true">{String.fromCharCode(65 + i)}</strong>
                      </label>
                      <input
                        className="input"
                        value={o.body}
                        maxLength={1000}
                        aria-label={`Option ${String.fromCharCode(65 + i)} text`}
                        aria-invalid={!!err(`options.${i}.body`)}
                        onChange={(e) => setOption(o.key, { body: e.target.value })}
                      />
                      <div className="row" style={{ gap: 2 }}>
                        <button
                          type="button"
                          className="icon-btn ghost"
                          aria-label={`Move option ${String.fromCharCode(65 + i)} up`}
                          disabled={i === 0}
                          onClick={() => moveOption(i, -1)}
                        >
                          <ArrowUp size={15} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="icon-btn ghost"
                          aria-label={`Move option ${String.fromCharCode(65 + i)} down`}
                          disabled={i === form.options.length - 1}
                          onClick={() => moveOption(i, 1)}
                        >
                          <ArrowDown size={15} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="icon-btn ghost"
                          aria-label={`Remove option ${String.fromCharCode(65 + i)}`}
                          disabled={form.options.length <= 2}
                          onClick={() =>
                            update(
                              'options',
                              form.options.filter((x) => x.key !== o.key),
                            )
                          }
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </div>
                      {err(`options.${i}.body`) && (
                        <span className="field-error" style={{ gridColumn: '2 / 4' }}>
                          {err(`options.${i}.body`)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="row" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={form.options.length >= MAX_OPTIONS}
                    onClick={() => update('options', [...form.options, newRow()])}
                  >
                    <Plus size={14} aria-hidden="true" /> Add option
                  </button>
                  {err('options') && <span className="field-error">{err('options')}</span>}
                </div>
              </fieldset>
            )}

            {form.kind === 'true_false' && (
              <fieldset>
                <legend>The statement is…</legend>
                <div className="segmented">
                  {[true, false].map((v) => (
                    <label key={String(v)}>
                      <input
                        type="radio"
                        name="correct-bool"
                        checked={form.correctBoolean === v}
                        onChange={() => update('correctBoolean', v)}
                      />
                      <span>{v ? 'True' : 'False'}</span>
                    </label>
                  ))}
                </div>
                {err('correctBoolean') && (
                  <div className="field-error">{err('correctBoolean')}</div>
                )}
              </fieldset>
            )}

            {form.kind === 'fill_gap' && (
              <fieldset>
                <legend>Accepted answers for each blank</legend>
                {gapKeys.length === 0 ? (
                  <p className="small">
                    Insert at least one blank into the question to define its answers.
                  </p>
                ) : (
                  <div className="two-col">
                    {gapKeys.map((key, i) => (
                      <div className="field" key={key}>
                        <label htmlFor={`alias-${key}`}>
                          Blank {i + 1} <code>{`{{blank:${key}}}`}</code>
                        </label>
                        <textarea
                          id={`alias-${key}`}
                          className="textarea"
                          rows={3}
                          placeholder={'One accepted answer per line'}
                          value={form.aliases[key] ?? ''}
                          aria-invalid={!!err(`blanks.${i}.acceptedAnswers`)}
                          onChange={(e) =>
                            update('aliases', { ...form.aliases, [key]: e.target.value })
                          }
                        />
                        <span className="hint">
                          One per line. All variants are shown to you after answering.
                        </span>
                        {err(`blanks.${i}.acceptedAnswers`) && (
                          <span className="field-error">{err(`blanks.${i}.acceptedAnswers`)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="stack-sm" style={{ marginTop: 12 }}>
                  <span className="small">
                    Always ignored: letter case (unless enabled below), leading/trailing spaces and
                    repeated spaces. Unicode is NFKC-normalised.
                  </span>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={form.normalization.caseSensitive}
                      onChange={(e) =>
                        update('normalization', {
                          ...form.normalization,
                          caseSensitive: e.target.checked,
                        })
                      }
                    />
                    Case-sensitive (e.g. chemical symbols, “pH”)
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={form.normalization.ignoreAccents}
                      onChange={(e) =>
                        update('normalization', {
                          ...form.normalization,
                          ignoreAccents: e.target.checked,
                        })
                      }
                    />
                    Ignore accents (“café” = “cafe”)
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={form.normalization.ignorePunctuation}
                      onChange={(e) =>
                        update('normalization', {
                          ...form.normalization,
                          ignorePunctuation: e.target.checked,
                        })
                      }
                    />
                    Ignore punctuation and symbols
                  </label>
                </div>
              </fieldset>
            )}
          </section>

          <section className="card panel" aria-labelledby="preview-title">
            <div className="section-title">
              <h2 id="preview-title">Preview</h2>
              <span className="small">
                How it appears in a session (try answering — nothing is saved)
              </span>
            </div>
            <div className="preview-box">
              {form.kind !== 'fill_gap' && (
                <div className="question-text" style={{ marginTop: 0 }}>
                  {previewQuestion.body}
                </div>
              )}
              <AnswerArea
                question={previewQuestion}
                draft={previewDraft}
                onChange={setPreviewDraft}
              />
            </div>
          </section>

          <section className="card panel stack">
            <h2>Explanation & details</h2>
            <div className="field">
              <label htmlFor="explanation">Explanation (shown after answering)</label>
              <textarea
                id="explanation"
                className="textarea"
                value={form.explanation}
                onChange={(e) => update('explanation', e.target.value)}
                maxLength={5000}
              />
            </div>
            <div className="field">
              <label htmlFor="hint">Hint (practice mode only, optional)</label>
              <input
                id="hint"
                className="input"
                value={form.hint}
                onChange={(e) => update('hint', e.target.value)}
                maxLength={1000}
              />
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="source">Source / reference</label>
                <input
                  id="source"
                  className="input"
                  value={form.sourceLabel}
                  onChange={(e) => update('sourceLabel', e.target.value)}
                  maxLength={500}
                  placeholder="Book, page, URL…"
                />
              </div>
              <div className="field">
                <label htmlFor="verified">Last verified</label>
                <input
                  id="verified"
                  className="input"
                  type="date"
                  value={form.verifiedAt}
                  onChange={(e) => update('verifiedAt', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="review-status">Review status</label>
                <select
                  id="review-status"
                  className="select"
                  value={form.reviewStatus}
                  onChange={(e) =>
                    update('reviewStatus', e.target.value as FormState['reviewStatus'])
                  }
                >
                  <option value="unreviewed">Unreviewed</option>
                  <option value="verified">Verified</option>
                  <option value="needs_update">Needs update</option>
                </select>
              </div>
              <div className="field wide">
                <label htmlFor="tags">Tags</label>
                <input
                  id="tags"
                  className="input"
                  value={form.tagsText}
                  onChange={(e) => update('tagsText', e.target.value)}
                  placeholder="Comma-separated, e.g. fundamentals, revision"
                />
                {err('tagNames') && <span className="field-error">{err('tagNames')}</span>}
              </div>
            </div>
            {(collections.data ?? []).length > 0 && (
              <fieldset>
                <legend>Collections</legend>
                <div className="chip-group">
                  {(collections.data ?? []).map((c) => (
                    <label className="chip" key={c.id}>
                      <input
                        type="checkbox"
                        checked={form.collectionIds.includes(c.id)}
                        onChange={(e) =>
                          update(
                            'collectionIds',
                            e.target.checked
                              ? [...form.collectionIds, c.id]
                              : form.collectionIds.filter((x) => x !== c.id),
                          )
                        }
                      />
                      <span>{c.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <fieldset>
              <legend>Status</legend>
              <div className="segmented">
                <label>
                  <input
                    type="radio"
                    name="status"
                    checked={form.status === 'published'}
                    onChange={() => update('status', 'published')}
                  />
                  <span>Published</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="status"
                    checked={form.status === 'draft'}
                    onChange={() => update('status', 'draft')}
                  />
                  <span>Draft (excluded from sessions)</span>
                </label>
              </div>
            </fieldset>
          </section>

          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : existing ? 'Save changes' : 'Save question'}
            </button>
            {!existing && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={(e) => submit(e, true)}
                disabled={save.isPending}
              >
                Save & add another
              </button>
            )}
            <Link to="/bank" className="btn btn-quiet">
              Cancel
            </Link>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
