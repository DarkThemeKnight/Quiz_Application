import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  Download,
  Library,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  DIFFICULTIES,
  QUESTION_KINDS,
  gapBodyToDisplayText,
  type ImportCommitDto,
  type QuestionSummaryDto,
} from '@recall/shared';
import { api } from '../api/client';
import {
  invalidateBank,
  keys,
  useCollections,
  useQuestionStats,
  useQuestions,
  useSubjects,
  useTags,
  useTopics,
} from '../api/hooks';
import {
  EmptyState,
  ErrorState,
  KpiCard,
  LoadingBlock,
  PageHeader,
  Pagination,
  errorMessage,
  useConfirm,
  useDocumentTitle,
  useToast,
} from '../components/ui';
import { SHORT_KIND, formatDate, plural } from '../lib/format';

const FILTER_KEYS = [
  'q',
  'subjectId',
  'topicId',
  'collectionId',
  'tag',
  'kind',
  'difficulty',
  'status',
  'reviewStatus',
] as const;

export function BankPage() {
  useDocumentTitle('Question bank');
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as Record<
    (typeof FILTER_KEYS)[number],
    string
  >;
  const page = Number(params.get('page')) || 1;
  const [search, setSearch] = useState(filters.q);

  const subjects = useSubjects();
  const topics = useTopics();
  const collections = useCollections();
  const tags = useTags();
  const stats = useQuestionStats();
  const questions = useQuestions({
    ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
    status: filters.status || 'all',
    page,
    pageSize: 25,
  });
  const client = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === 'subjectId') next.delete('topicId');
    next.delete('page');
    setParams(next, { replace: true });
  };

  // Debounce the search box into the URL.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (search !== filters.q) setFilter('q', search.trim());
    }, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const refresh = () => {
    void invalidateBank(client);
    void client.invalidateQueries({ queryKey: keys.stats });
  };

  const archive = useMutation({
    mutationFn: ({ id, restore }: { id: string; restore: boolean }) =>
      api.post(`/questions/${id}/${restore ? 'restore' : 'archive'}`),
    onSuccess: (_d, v) => {
      toast(
        v.restore
          ? 'Question restored.'
          : 'Question archived. It is hidden from practice but kept in history.',
      );
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/questions/${id}`),
    onSuccess: () => {
      toast('Question deleted permanently.');
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const loadSample = useMutation({
    mutationFn: () => api.post<ImportCommitDto>('/import/sample'),
    onSuccess: (r) => {
      toast(`Loaded ${plural(r.imported, 'sample question')}.`);
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const askDelete = async (q: QuestionSummaryDto) => {
    const ok = await confirm({
      title: 'Delete this question permanently?',
      body: 'This cannot be undone. Past session results keep their own copy of the question, so history is not affected.',
      confirmLabel: 'Delete permanently',
      destructive: true,
    });
    if (ok) remove.mutate(q.id);
  };

  const visibleTopics = (topics.data ?? []).filter(
    (t) => !filters.subjectId || t.subjectId === filters.subjectId,
  );
  const hasFilters = FILTER_KEYS.some((k) => filters[k]);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Your knowledge library"
        title="Question bank"
        description="Write, organise and maintain questions for any subject."
        actions={
          <>
            <a className="btn btn-secondary" href="/api/export/questions" download>
              <Download size={16} aria-hidden="true" /> Export
            </a>
            <Link to="/bank/import" className="btn btn-secondary">
              <Upload size={16} aria-hidden="true" /> Import
            </Link>
            <Link to="/bank/new" className="btn btn-primary">
              <Plus size={16} aria-hidden="true" /> New question
            </Link>
          </>
        }
      />
      {stats.data && (
        <div className="kpis" style={{ marginTop: 0 }}>
          <KpiCard
            label="Published"
            value={stats.data.published.toLocaleString()}
            note="Available for practice"
          />
          <KpiCard
            label="Drafts"
            value={stats.data.draft.toLocaleString()}
            note="Not used in sessions"
          />
          <KpiCard
            label="With explanations"
            value={stats.data.withExplanation.toLocaleString()}
            note="Published and drafts"
          />
          <KpiCard
            label="Archived"
            value={stats.data.archived.toLocaleString()}
            note="Hidden, history kept"
          />
        </div>
      )}

      <div className="filter-bar" role="search">
        <div className="field search-field">
          <label htmlFor="bank-search">Search</label>
          <input
            id="bank-search"
            className="input"
            type="search"
            placeholder="Search prompts, explanations, sources…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <SelectFilter
          id="f-subject"
          label="Subject"
          value={filters.subjectId}
          onChange={(v) => setFilter('subjectId', v)}
          options={(subjects.data ?? []).map((s) => [s.id, s.name])}
          all="All subjects"
        />
        <SelectFilter
          id="f-topic"
          label="Topic"
          value={filters.topicId}
          onChange={(v) => setFilter('topicId', v)}
          options={visibleTopics.map((t) => [t.id, t.name])}
          all="All topics"
        />
        <SelectFilter
          id="f-kind"
          label="Type"
          value={filters.kind}
          onChange={(v) => setFilter('kind', v)}
          options={QUESTION_KINDS.map((k) => [k, SHORT_KIND[k]])}
          all="All types"
        />
        <SelectFilter
          id="f-status"
          label="Status"
          value={filters.status}
          onChange={(v) => setFilter('status', v)}
          options={[
            ['published', 'Published'],
            ['draft', 'Draft'],
            ['archived', 'Archived'],
          ]}
          all="Active (not archived)"
        />
        <SelectFilter
          id="f-diff"
          label="Difficulty"
          value={filters.difficulty}
          onChange={(v) => setFilter('difficulty', v)}
          options={DIFFICULTIES.map((d) => [d, d])}
          all="Any difficulty"
        />
        <SelectFilter
          id="f-coll"
          label="Collection"
          value={filters.collectionId}
          onChange={(v) => setFilter('collectionId', v)}
          options={(collections.data ?? []).map((c) => [c.id, c.name])}
          all="Any collection"
        />
        <SelectFilter
          id="f-tag"
          label="Tag"
          value={filters.tag}
          onChange={(v) => setFilter('tag', v)}
          options={(tags.data ?? []).map((t) => [t.name, t.name])}
          all="Any tag"
        />
        <SelectFilter
          id="f-review"
          label="Review status"
          value={filters.reviewStatus}
          onChange={(v) => setFilter('reviewStatus', v)}
          options={[
            ['unreviewed', 'Unreviewed'],
            ['verified', 'Verified'],
            ['needs_update', 'Needs update'],
          ]}
          all="Any"
        />
        {hasFilters && (
          <div className="field" style={{ alignSelf: 'end' }}>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => (setSearch(''), setParams(new URLSearchParams(), { replace: true }))}
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {questions.isPending ? (
        <div className="card panel">
          <LoadingBlock rows={6} />
        </div>
      ) : questions.isError ? (
        <div className="card panel">
          <ErrorState error={questions.error} onRetry={() => void questions.refetch()} />
        </div>
      ) : questions.data.items.length === 0 ? (
        <div className="card">
          {hasFilters ? (
            <EmptyState title="No questions match these filters">
              Try clearing a filter or searching for different words.
            </EmptyState>
          ) : (
            <EmptyState
              icon={<Library size={22} />}
              title="No questions yet"
              actions={
                <>
                  <Link to="/bank/new" className="btn btn-primary">
                    Write a question
                  </Link>
                  <Link to="/bank/import" className="btn btn-secondary">
                    Import
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
              Supports single- and multi-answer multiple choice, true/false and fill-in-the-gap.
            </EmptyState>
          )}
        </div>
      ) : (
        <>
          <p className="small" aria-live="polite">
            {plural(questions.data.total, 'question')}
          </p>
          <ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {questions.data.items.map((q) => (
              <li key={q.id} className="bank-row">
                <Link to={`/bank/${q.id}`} className="body-link grow">
                  <div className="body">{gapBodyToDisplayText(q.body)}</div>
                  <div className="meta">
                    <span className="badge badge-accent">{SHORT_KIND[q.kind]}</span>
                    <span className="badge">
                      {q.subject.name}
                      {q.topic ? ` › ${q.topic.name}` : ''}
                    </span>
                    <span className="badge">{q.difficulty}</span>
                    {q.status !== 'published' && (
                      <span className={`badge ${q.status === 'draft' ? 'badge-warn' : ''}`}>
                        {q.status}
                      </span>
                    )}
                    {q.reviewStatus === 'needs_update' && (
                      <span className="badge badge-bad">needs update</span>
                    )}
                    {q.reviewStatus === 'verified' && (
                      <span className="badge badge-good">verified</span>
                    )}
                    {q.subject.name.toLowerCase().startsWith('sample') && (
                      <span className="sample-pill">Sample</span>
                    )}
                    {q.tags.slice(0, 4).map((t) => (
                      <span key={t} className="badge">
                        #{t}
                      </span>
                    ))}
                    <span className="small">Updated {formatDate(q.updatedAt)}</span>
                  </div>
                </Link>
                <div className="row">
                  {q.status === 'archived' ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => archive.mutate({ id: q.id, restore: true })}
                      >
                        <ArchiveRestore size={14} aria-hidden="true" /> Restore
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger-outline btn-sm"
                        onClick={() => void askDelete(q)}
                      >
                        <Trash2 size={14} aria-hidden="true" /> Delete
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => archive.mutate({ id: q.id, restore: false })}
                      aria-label={`Archive question: ${q.body.slice(0, 60)}`}
                    >
                      <Archive size={14} aria-hidden="true" /> Archive
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Pagination
            page={questions.data.page}
            pageSize={questions.data.pageSize}
            total={questions.data.total}
            onPage={(p) => {
              const next = new URLSearchParams(params);
              next.set('page', String(p));
              setParams(next);
            }}
          />
        </>
      )}
    </div>
  );
}

function SelectFilter(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  all: string;
}) {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <select
        id={props.id}
        className="select"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      >
        <option value="">{props.all}</option>
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
