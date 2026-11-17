import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, FolderPlus, Pencil, Play, Plus, Tag, Trash2 } from 'lucide-react';
import type { CollectionDto, SubjectDto, TopicDto } from '@recall/shared';
import { api } from '../api/client';
import {
  invalidateBank,
  useCollections,
  useStartSession,
  useSubjects,
  useTags,
  useTopics,
} from '../api/hooks';
import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  errorMessage,
  useConfirm,
  useDocumentTitle,
  usePromptText,
  useToast,
} from '../components/ui';
import { plural } from '../lib/format';

function useAction<T>(fn: (v: T) => Promise<unknown>, success?: string) {
  const client = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      if (success) toast(success);
      void invalidateBank(client);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
}

function InlineCreate(props: {
  label: string;
  placeholder: string;
  onCreate: (name: string) => Promise<unknown>;
  extra?: ReactNode;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await props.onCreate(name.trim());
      setName('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="row" onSubmit={(e) => void submit(e)}>
      <label className="sr-only" htmlFor={`create-${props.label}`}>
        {props.label}
      </label>
      {props.extra}
      <input
        id={`create-${props.label}`}
        className="input grow"
        placeholder={props.placeholder}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={120}
      />
      <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !name.trim()}>
        <Plus size={14} aria-hidden="true" /> Add
      </button>
    </form>
  );
}

export function LibraryPage() {
  useDocumentTitle('Subjects & collections');
  const subjects = useSubjects();
  const topics = useTopics();
  const collections = useCollections();
  const tags = useTags();
  const confirm = useConfirm();
  const promptText = usePromptText();
  const toast = useToast();
  const start = useStartSession();
  const [selected, setSelected] = useState<string | null>(null);
  const [parentId, setParentId] = useState('');

  const createSubject = useAction(
    (name: string) => api.post('/subjects', { name }),
    'Subject created.',
  );
  const renameSubject = useAction((v: { id: string; name: string }) =>
    api.patch(`/subjects/${v.id}`, { name: v.name }),
  );
  const archiveSubject = useAction((v: { id: string; archived: boolean }) =>
    api.patch(`/subjects/${v.id}`, { archived: v.archived }),
  );
  const deleteSubject = useAction((id: string) => api.del(`/subjects/${id}`), 'Subject deleted.');
  const createTopic = useAction(
    (v: { subjectId: string; name: string; parentTopicId: string | null }) =>
      api.post('/topics', v),
    'Topic created.',
  );
  const renameTopic = useAction((v: { id: string; name: string }) =>
    api.patch(`/topics/${v.id}`, { name: v.name }),
  );
  const deleteTopic = useAction((id: string) => api.del(`/topics/${id}`), 'Topic deleted.');
  const createCollection = useAction(
    (name: string) => api.post('/collections', { name }),
    'Collection created.',
  );
  const renameCollection = useAction((v: { id: string; name: string }) =>
    api.patch(`/collections/${v.id}`, { name: v.name }),
  );
  const archiveCollection = useAction((v: { id: string; archived: boolean }) =>
    api.patch(`/collections/${v.id}`, { archived: v.archived }),
  );
  const deleteCollection = useAction(
    (id: string) => api.del(`/collections/${id}`),
    'Collection deleted. Its questions were kept.',
  );
  const renameTag = useAction((v: { id: string; name: string }) =>
    api.patch(`/tags/${v.id}`, { name: v.name }),
  );
  const deleteTag = useAction(
    (id: string) => api.del(`/tags/${id}`),
    'Tag removed from all questions.',
  );

  const rename = async (current: string, apply: (name: string) => void) => {
    const next = await promptText({
      title: `Rename “${current}”`,
      input: { label: 'New name', initial: current },
      confirmLabel: 'Rename',
    });
    if (next && next !== current) apply(next);
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

  const subjectList = subjects.data ?? [];
  const current = subjectList.find((s) => s.id === selected) ?? subjectList[0] ?? null;
  const subjectTopics = (topics.data ?? []).filter((t) => t.subjectId === current?.id);

  const askDeleteSubject = async (s: SubjectDto) => {
    if (s.questionCount > 0) {
      toast(
        'This subject still has questions. Move or delete them first, or archive the subject.',
        'error',
      );
      return;
    }
    if (
      await confirm({
        title: `Delete “${s.name}”?`,
        body: 'Its topics are deleted too. This cannot be undone.',
        confirmLabel: 'Delete subject',
        destructive: true,
      })
    ) {
      deleteSubject.mutate(s.id);
    }
  };
  const askDeleteCollection = async (c: CollectionDto) => {
    if (
      await confirm({
        title: `Delete collection “${c.name}”?`,
        body: 'Questions in it are not deleted — only the grouping.',
        confirmLabel: 'Delete collection',
        destructive: true,
      })
    ) {
      deleteCollection.mutate(c.id);
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Organise anything"
        title="Subjects & collections"
        description="Every question has one subject (and optionally a topic). Collections are reusable study sets that can mix subjects."
      />
      <div className="columns">
        <section className="card panel stack" aria-labelledby="subjects-title">
          <div className="section-title">
            <h2 id="subjects-title">Subjects & topics</h2>
            <span className="small">{plural(subjectList.length, 'subject')}</span>
          </div>
          <InlineCreate
            label="New subject"
            placeholder="New subject, e.g. World History"
            onCreate={(name) => createSubject.mutateAsync(name)}
          />
          {subjectList.length === 0 ? (
            <EmptyState title="No subjects yet">
              Create a subject to start adding questions.
            </EmptyState>
          ) : (
            <div className="two-col">
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Subjects">
                {subjectList.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`list-item${current?.id === s.id ? ' selected' : ''}`}
                      onClick={() => setSelected(s.id)}
                      aria-pressed={current?.id === s.id}
                    >
                      <span>
                        <strong>{s.name}</strong>
                        <div className="small">
                          {plural(s.questionCount, 'question')} · {plural(s.topicCount, 'topic')}
                        </div>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {current && (
                <div className="stack-sm">
                  <div className="row-between">
                    <h3>{current.name}</h3>
                    <div className="row" style={{ gap: 2 }}>
                      <button
                        type="button"
                        className="icon-btn ghost"
                        aria-label={`Practise ${current.name}`}
                        title="Practise"
                        onClick={() =>
                          start.mutate(
                            {
                              mode: 'practice',
                              subjectIds: [current.id],
                              count: 10,
                              shuffle: true,
                            },
                            { onError: (e) => toast(errorMessage(e), 'error') },
                          )
                        }
                      >
                        <Play size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="icon-btn ghost"
                        aria-label={`Rename ${current.name}`}
                        onClick={() =>
                          void rename(current.name, (name) =>
                            renameSubject.mutate({ id: current.id, name }),
                          )
                        }
                      >
                        <Pencil size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="icon-btn ghost"
                        aria-label={`Archive ${current.name}`}
                        title="Archive (hide from lists)"
                        onClick={() => archiveSubject.mutate({ id: current.id, archived: true })}
                      >
                        <Archive size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="icon-btn ghost"
                        aria-label={`Delete ${current.name}`}
                        onClick={() => void askDeleteSubject(current)}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <Link to={`/bank?subjectId=${current.id}`} className="linkbtn">
                    View {plural(current.questionCount, 'question')}
                  </Link>
                  <TopicTree
                    topics={subjectTopics}
                    parentId={null}
                    onRename={(t) =>
                      void rename(t.name, (name) => renameTopic.mutate({ id: t.id, name }))
                    }
                    onDelete={async (t) => {
                      if (
                        await confirm({
                          title: `Delete topic “${t.name}”?`,
                          confirmLabel: 'Delete topic',
                          destructive: true,
                        })
                      )
                        deleteTopic.mutate(t.id);
                    }}
                  />
                  {subjectTopics.length === 0 && <p className="small">No topics yet.</p>}
                  <InlineCreate
                    label="New topic"
                    placeholder="New topic"
                    onCreate={(name) =>
                      createTopic.mutateAsync({
                        subjectId: current.id,
                        name,
                        parentTopicId: parentId || null,
                      })
                    }
                    extra={
                      subjectTopics.length > 0 ? (
                        <select
                          className="select"
                          aria-label="Parent topic"
                          value={parentId}
                          onChange={(e) => setParentId(e.target.value)}
                          style={{ maxWidth: 150 }}
                        >
                          <option value="">Top level</option>
                          {subjectTopics.map((t) => (
                            <option key={t.id} value={t.id}>
                              under {t.name}
                            </option>
                          ))}
                        </select>
                      ) : undefined
                    }
                  />
                </div>
              )}
            </div>
          )}
          <ArchivedSubjects onRestore={(id) => archiveSubject.mutate({ id, archived: false })} />
        </section>

        <div className="stack">
          <section className="card panel stack" aria-labelledby="collections-title">
            <div className="section-title">
              <h2 id="collections-title">Collections</h2>
              <FolderPlus size={18} aria-hidden="true" className="muted" />
            </div>
            <InlineCreate
              label="New collection"
              placeholder="e.g. Interview Prep"
              onCreate={(name) => createCollection.mutateAsync(name)}
            />
            {(collections.data ?? []).length === 0 ? (
              <p className="small">
                Group questions from any subjects into a reusable set. Add questions from the
                question editor.
              </p>
            ) : (
              (collections.data ?? []).map((c) => (
                <div className="insight" key={c.id}>
                  <div className="grow">
                    <Link
                      to={`/bank?collectionId=${c.id}`}
                      style={{ fontWeight: 650, color: 'var(--ink)' }}
                    >
                      {c.name}
                    </Link>
                    <div className="small">
                      {plural(c.questionCount, 'question')}
                      {c.archivedAt ? ' · archived' : ''}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 2 }}>
                    <button
                      type="button"
                      className="icon-btn ghost"
                      aria-label={`Practise ${c.name}`}
                      disabled={c.questionCount === 0}
                      onClick={() =>
                        start.mutate(
                          { mode: 'practice', collectionIds: [c.id], count: 10, shuffle: true },
                          { onError: (e) => toast(errorMessage(e), 'error') },
                        )
                      }
                    >
                      <Play size={15} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="icon-btn ghost"
                      aria-label={`Rename ${c.name}`}
                      onClick={() =>
                        void rename(c.name, (name) => renameCollection.mutate({ id: c.id, name }))
                      }
                    >
                      <Pencil size={15} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="icon-btn ghost"
                      aria-label={`${c.archivedAt ? 'Restore' : 'Archive'} ${c.name}`}
                      onClick={() =>
                        archiveCollection.mutate({ id: c.id, archived: !c.archivedAt })
                      }
                    >
                      {c.archivedAt ? (
                        <ArchiveRestore size={15} aria-hidden="true" />
                      ) : (
                        <Archive size={15} aria-hidden="true" />
                      )}
                    </button>
                    <button
                      type="button"
                      className="icon-btn ghost"
                      aria-label={`Delete ${c.name}`}
                      onClick={() => void askDeleteCollection(c)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </section>

          <section className="card panel stack" aria-labelledby="tags-title">
            <div className="section-title">
              <h2 id="tags-title">Tags</h2>
              <Tag size={18} aria-hidden="true" className="muted" />
            </div>
            {(tags.data ?? []).length === 0 ? (
              <p className="small">Tags are created when you add them to a question.</p>
            ) : (
              <div className="chip-group">
                {(tags.data ?? []).map((t) => (
                  <span key={t.id} className="badge" style={{ padding: '4px 4px 4px 9px' }}>
                    <Link
                      to={`/bank?tag=${encodeURIComponent(t.name)}`}
                      style={{ color: 'inherit' }}
                    >
                      #{t.name} · {t.questionCount}
                    </Link>
                    <button
                      type="button"
                      className="icon-btn ghost"
                      style={{ width: 24, height: 24 }}
                      aria-label={`Rename tag ${t.name}`}
                      onClick={() =>
                        void rename(t.name, (name) => renameTag.mutate({ id: t.id, name }))
                      }
                    >
                      <Pencil size={12} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="icon-btn ghost"
                      style={{ width: 24, height: 24 }}
                      aria-label={`Delete tag ${t.name}`}
                      onClick={async () => {
                        if (
                          await confirm({
                            title: `Delete tag “${t.name}”?`,
                            body: 'It is removed from all questions; the questions remain.',
                            confirmLabel: 'Delete tag',
                            destructive: true,
                          })
                        )
                          deleteTag.mutate(t.id);
                      }}
                    >
                      <Trash2 size={12} aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function TopicTree(props: {
  topics: TopicDto[];
  parentId: string | null;
  onRename: (t: TopicDto) => void;
  onDelete: (t: TopicDto) => void;
}) {
  const children = props.topics.filter((t) => t.parentTopicId === props.parentId);
  if (!children.length) return null;
  return (
    <ul className="tree">
      {children.map((t) => (
        <li key={t.id}>
          <div className="tree-row">
            <Link
              to={`/bank?subjectId=${t.subjectId}&topicId=${t.id}`}
              style={{ color: 'var(--ink)' }}
            >
              {t.name} <span className="small">({t.questionCount})</span>
            </Link>
            <span className="row" style={{ gap: 2 }}>
              <button
                type="button"
                className="icon-btn ghost"
                style={{ width: 30, height: 30 }}
                aria-label={`Rename topic ${t.name}`}
                onClick={() => props.onRename(t)}
              >
                <Pencil size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-btn ghost"
                style={{ width: 30, height: 30 }}
                aria-label={`Delete topic ${t.name}`}
                onClick={() => props.onDelete(t)}
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </span>
          </div>
          <TopicTree {...props} parentId={t.id} />
        </li>
      ))}
    </ul>
  );
}

function ArchivedSubjects({ onRestore }: { onRestore: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SubjectDto[] | null>(null);
  const load = async () => {
    setOpen((o) => !o);
    const all = await api.get<SubjectDto[]>('/subjects?includeArchived=true');
    setItems(all.filter((s) => s.archivedAt));
  };
  return (
    <div>
      <button type="button" className="linkbtn" onClick={() => void load()} aria-expanded={open}>
        {open ? 'Hide archived subjects' : 'Show archived subjects'}
      </button>
      {open && items && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
          {items.length === 0 && <li className="small">None.</li>}
          {items.map((s) => (
            <li key={s.id} className="row-between" style={{ padding: '4px 0' }}>
              <span>{s.name}</span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => (onRestore(s.id), setItems(items.filter((x) => x.id !== s.id)))}
              >
                <ArchiveRestore size={14} aria-hidden="true" /> Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
