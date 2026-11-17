import { useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, FileUp } from 'lucide-react';
import {
  BANK_FORMAT_ID,
  CSV_COLUMNS,
  toCsv,
  type ImportCommitDto,
  type ImportPreviewDto,
} from '@recall/shared';
import { api } from '../api/client';
import { invalidateBank, keys } from '../api/hooks';
import { PageHeader, errorMessage, useDocumentTitle } from '../components/ui';
import { plural } from '../lib/format';

const MAX_BYTES = 5_000_000;

const JSON_TEMPLATE = JSON.stringify(
  {
    format: BANK_FORMAT_ID,
    version: 1,
    subject: 'My subject',
    questions: [
      {
        externalId: 'q-1',
        topic: 'Topic name',
        type: 'single_choice',
        difficulty: 'easy',
        prompt: 'Which option is correct?',
        options: [
          { id: 'a', text: 'This one' },
          { id: 'b', text: 'Not this one' },
        ],
        correctOptionIds: ['a'],
        explanation: 'Why it is correct.',
        tags: ['example'],
      },
      { type: 'true_false', prompt: 'A statement to judge.', correctBoolean: false },
      {
        type: 'fill_gap',
        prompt: 'Two plus two is {{blank:1}}.',
        blanks: [{ key: '1', acceptedAnswers: ['4', 'four'] }],
      },
      {
        type: 'multi_choice',
        prompt: 'Select all even numbers.',
        options: [
          { id: 'a', text: '2' },
          { id: 'b', text: '3' },
          { id: 'c', text: '4' },
        ],
        correctOptionIds: ['a', 'c'],
      },
    ],
  },
  null,
  2,
);

const CSV_TEMPLATE = toCsv([
  [...CSV_COLUMNS],
  [
    'q-1',
    'My subject',
    'Topic name',
    'single_choice',
    'easy',
    'published',
    'Which option is correct?',
    '[{"id":"a","text":"This one"},{"id":"b","text":"Not this one"}]',
    '["a"]',
    'Why it is correct.',
    '',
    '',
    'example;fundamentals',
    '',
  ],
  [
    'q-2',
    'My subject',
    '',
    'true_false',
    'medium',
    'published',
    'A statement to judge.',
    '',
    'false',
    '',
    '',
    '',
    '',
    '',
  ],
  [
    'q-3',
    'My subject',
    '',
    'fill_gap',
    'easy',
    'published',
    'Two plus two is {{blank:1}}.',
    '',
    '{"1":["4","four"]}',
    '',
    '',
    '',
    '',
    '',
  ],
]);

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportPage() {
  useDocumentTitle('Import questions');
  const client = useQueryClient();
  const [format, setFormat] = useState<'json' | 'csv'>('json');
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [defaultSubject, setDefaultSubject] = useState('');
  const [duplicates, setDuplicates] = useState<'skip' | 'import'>('skip');
  const [fileError, setFileError] = useState('');

  const body = () => ({
    format,
    content,
    duplicates,
    ...(defaultSubject.trim() ? { defaultSubject: defaultSubject.trim() } : {}),
  });
  const preview = useMutation({
    mutationFn: () => api.post<ImportPreviewDto>('/import/questions/validate', body()),
  });
  const commit = useMutation({
    mutationFn: () => api.post<ImportCommitDto>('/import/questions/commit', body()),
    onSuccess: () => {
      void invalidateBank(client);
      void client.invalidateQueries({ queryKey: keys.stats });
    },
  });

  const reset = () => {
    preview.reset();
    commit.reset();
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setFileError('');
    reset();
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setFileError('File is larger than 5 MB. Split it into smaller batches.');
      return;
    }
    setFileName(file.name);
    if (file.name.toLowerCase().endsWith('.csv')) setFormat('csv');
    if (file.name.toLowerCase().endsWith('.json')) setFormat('json');
    setContent(await file.text());
  };

  const p = preview.data;
  const willImport = p ? Math.max(0, p.validRows - p.duplicateRows) : 0;
  const canCommit = p && !p.fatal && p.errorRows === 0 && willImport > 0 && !commit.isSuccess;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Question bank"
        title="Import questions"
        description="Validate a CSV or JSON file first. Nothing is written until you confirm, and a batch with any invalid row is rejected as a whole."
        actions={
          <Link to="/bank" className="btn btn-secondary">
            Back to bank
          </Link>
        }
      />
      <div className="columns">
        <section className="card panel stack" aria-labelledby="source-title">
          <h2 id="source-title">1. Choose a file</h2>
          <div className="field">
            <label htmlFor="file">CSV or JSON file (max 5 MB, 5,000 questions)</label>
            <input
              id="file"
              type="file"
              accept=".json,.csv,application/json,text/csv"
              onChange={(e) => void onFile(e)}
              className="input"
            />
            {fileName && <span className="hint">Loaded {fileName}</span>}
            {fileError && <span className="field-error">{fileError}</span>}
          </div>
          <div className="field">
            <label htmlFor="paste">…or paste the contents</label>
            <textarea
              id="paste"
              className="textarea"
              rows={8}
              value={content}
              onChange={(e) => (setContent(e.target.value), reset())}
              spellCheck={false}
              style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
            />
          </div>
          <div className="form-grid">
            <fieldset>
              <legend>Format</legend>
              <div className="segmented">
                {(['json', 'csv'] as const).map((f) => (
                  <label key={f}>
                    <input
                      type="radio"
                      name="format"
                      checked={format === f}
                      onChange={() => (setFormat(f), reset())}
                    />
                    <span>{f.toUpperCase()}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="field">
              <label htmlFor="default-subject">Default subject</label>
              <input
                id="default-subject"
                className="input"
                value={defaultSubject}
                onChange={(e) => (setDefaultSubject(e.target.value), reset())}
                placeholder="Used when a row has none"
              />
            </div>
            <fieldset>
              <legend>Duplicates</legend>
              <div className="segmented">
                <label>
                  <input
                    type="radio"
                    name="dups"
                    checked={duplicates === 'skip'}
                    onChange={() => (setDuplicates('skip'), reset())}
                  />
                  <span>Skip</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="dups"
                    checked={duplicates === 'import'}
                    onChange={() => (setDuplicates('import'), reset())}
                  />
                  <span>Import anyway</span>
                </label>
              </div>
            </fieldset>
          </div>
          <p className="small" style={{ margin: 0 }}>
            Rows whose <code>externalId</code> already exists are always skipped. “Duplicates”
            refers to identical prompt text.
          </p>
          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!content.trim() || preview.isPending}
              onClick={() => (commit.reset(), preview.mutate())}
            >
              {preview.isPending ? 'Validating…' : '2. Validate & preview'}
            </button>
          </div>
          {preview.isError && (
            <div className="callout callout-bad" role="alert">
              {errorMessage(preview.error)}
            </div>
          )}
        </section>

        <aside className="card panel stack" aria-labelledby="format-title">
          <h2 id="format-title">Formats</h2>
          <p className="small" style={{ margin: 0 }}>
            JSON is the complete format (also used by export). CSV columns:{' '}
            <code>{CSV_COLUMNS.join(', ')}</code>. Only <code>type</code> and <code>prompt</code>{' '}
            are required; answers go in <code>correct_answers_json</code>.
          </p>
          <div className="row">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => download('recall-template.json', JSON_TEMPLATE, 'application/json')}
            >
              <Download size={14} aria-hidden="true" /> JSON template
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => download('recall-template.csv', CSV_TEMPLATE, 'text/csv')}
            >
              <Download size={14} aria-hidden="true" /> CSV template
            </button>
          </div>
          <p className="small" style={{ margin: 0 }}>
            Types: <code>single_choice</code>, <code>multi_choice</code>, <code>true_false</code>,{' '}
            <code>fill_gap</code>. Fill-in blanks use <code>{'{{blank:KEY}}'}</code> placeholders.
            Full reference: <code>docs/IMPORT_FORMAT.md</code>.
          </p>
        </aside>
      </div>

      {p && (
        <section className="card panel stack" aria-labelledby="preview-title" aria-live="polite">
          <div className="section-title">
            <h2 id="preview-title">3. Review</h2>
            <span className="small">
              {plural(p.totalRows, 'row')} · {p.validRows} valid · {p.errorRows} with errors ·{' '}
              {plural(p.duplicateRows, 'duplicate')} skipped
            </span>
          </div>
          {p.fatal ? (
            <div className="callout callout-bad" role="alert">
              <strong className="row">
                <AlertTriangle size={16} aria-hidden="true" /> The file could not be read
              </strong>
              <p>{p.fatal}</p>
            </div>
          ) : p.errorRows > 0 ? (
            <div className="callout callout-bad" role="alert">
              <strong className="row">
                <AlertTriangle size={16} aria-hidden="true" /> Fix {plural(p.errorRows, 'row')}{' '}
                before importing
              </strong>
              <p>
                The batch is imported all-or-nothing, so nothing will be written while errors
                remain.
              </p>
            </div>
          ) : (
            <div className="callout callout-good">
              <strong className="row">
                <CheckCircle2 size={16} aria-hidden="true" /> Ready to import
              </strong>
              <p>
                {plural(willImport, 'question')} will be imported
                {p.newSubjects.length ? ` · new subjects: ${p.newSubjects.join(', ')}` : ''}
                {p.newTopics.length ? ` · ${plural(p.newTopics.length, 'new topic')}` : ''}.
              </p>
            </div>
          )}
          {p.rows.length > 0 && (
            <div className="table-wrap" style={{ maxHeight: 460, overflowY: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{format === 'csv' ? 'Line' : '#'}</th>
                    <th scope="col">Prompt</th>
                    <th scope="col">Type</th>
                    <th scope="col">Subject › Topic</th>
                    <th scope="col">Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((r) => (
                    <tr key={r.row}>
                      <td className="num">{r.row}</td>
                      <td className="title">{r.prompt || <span className="muted">—</span>}</td>
                      <td>{r.kind ?? '—'}</td>
                      <td className="muted">
                        {r.subject ?? '—'}
                        {r.topic ? ` › ${r.topic}` : ''}
                      </td>
                      <td>
                        {r.errors.length === 0 && r.warnings.length === 0 && (
                          <span className="badge badge-good">OK</span>
                        )}
                        {r.errors.map((e) => (
                          <div key={e} className="bad small">
                            {e}
                          </div>
                        ))}
                        {r.warnings.map((w) => (
                          <div key={w} className="warn small">
                            {w}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canCommit || commit.isPending}
              onClick={() => commit.mutate()}
            >
              <FileUp size={16} aria-hidden="true" />{' '}
              {commit.isPending ? 'Importing…' : '4. Import'}
            </button>
            {commit.isError && (
              <span className="field-error" role="alert">
                {errorMessage(commit.error)}
              </span>
            )}
          </div>
          {commit.data && (
            <div className="callout callout-good" role="status">
              <strong>Imported {plural(commit.data.imported, 'question')}.</strong>
              <p>
                {commit.data.skippedDuplicates} skipped as duplicates ·{' '}
                {commit.data.createdSubjects} subject(s) and {commit.data.createdTopics} topic(s)
                created. <Link to="/bank">Open the question bank</Link>
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
