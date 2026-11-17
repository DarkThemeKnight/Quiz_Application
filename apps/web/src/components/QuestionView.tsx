import { Fragment } from 'react';
import { Check, X } from 'lucide-react';
import {
  parseGapBody,
  type Answer,
  type PublicQuestion,
  type QuestionSnapshot,
} from '@recall/shared';
import { optionLetter } from '../lib/format';

/** Draft answer while the learner is working; converted to an API Answer on save. */
export type Draft =
  | { kind: 'single_choice'; optionId: string | null }
  | { kind: 'multi_choice'; optionIds: string[] }
  | { kind: 'true_false'; value: boolean | null }
  | { kind: 'fill_gap'; blanks: Record<string, string> };

export function emptyDraft(q: Pick<PublicQuestion, 'kind' | 'blankKeys'>): Draft {
  switch (q.kind) {
    case 'single_choice':
      return { kind: 'single_choice', optionId: null };
    case 'multi_choice':
      return { kind: 'multi_choice', optionIds: [] };
    case 'true_false':
      return { kind: 'true_false', value: null };
    case 'fill_gap':
      return { kind: 'fill_gap', blanks: Object.fromEntries(q.blankKeys.map((k) => [k, ''])) };
  }
}

export function draftFromAnswer(
  q: Pick<PublicQuestion, 'kind' | 'blankKeys'>,
  answer: Answer | null,
): Draft {
  if (!answer || answer.kind !== q.kind) return emptyDraft(q);
  switch (answer.kind) {
    case 'single_choice':
      return { kind: 'single_choice', optionId: answer.optionId };
    case 'multi_choice':
      return { kind: 'multi_choice', optionIds: answer.optionIds };
    case 'true_false':
      return { kind: 'true_false', value: answer.value };
    case 'fill_gap':
      return {
        kind: 'fill_gap',
        blanks: { ...Object.fromEntries(q.blankKeys.map((k) => [k, ''])), ...answer.blanks },
      };
  }
}

/** Returns null when the draft is not a complete answer (e.g. nothing selected). */
export function draftToAnswer(draft: Draft): Answer | null {
  switch (draft.kind) {
    case 'single_choice':
      return draft.optionId ? { kind: 'single_choice', optionId: draft.optionId } : null;
    case 'multi_choice':
      return draft.optionIds.length ? { kind: 'multi_choice', optionIds: draft.optionIds } : null;
    case 'true_false':
      return draft.value === null ? null : { kind: 'true_false', value: draft.value };
    case 'fill_gap':
      return Object.values(draft.blanks).some((v) => v.trim())
        ? { kind: 'fill_gap', blanks: draft.blanks }
        : null;
  }
}

export interface RevealState {
  correctOptionIds: string[];
  correctBoolean: boolean | null;
  perBlank?: Record<string, boolean> | undefined;
}

export function AnswerArea(props: {
  question: Pick<PublicQuestion, 'kind' | 'body' | 'options' | 'blankKeys'>;
  draft: Draft;
  onChange: (draft: Draft) => void;
  disabled?: boolean;
  reveal?: RevealState | null;
  labelledBy?: string;
}) {
  const { question, draft, onChange, disabled, reveal } = props;

  if (question.kind === 'fill_gap' && draft.kind === 'fill_gap') {
    const parsed = parseGapBody(question.body);
    const blankCount = parsed.keys.length;
    let blankIndex = 0;
    return (
      <div className="gap-text" id={props.labelledBy}>
        {parsed.segments.map((seg, i) => {
          if (seg.type === 'text') return <Fragment key={i}>{seg.text}</Fragment>;
          blankIndex++;
          const ok = reveal?.perBlank?.[seg.key];
          return (
            <input
              key={i}
              className={`gap-input${ok === true ? ' correct' : ok === false ? ' incorrect' : ''}`}
              aria-label={`Blank ${blankIndex} of ${blankCount}${ok === true ? ', correct' : ok === false ? ', incorrect' : ''}`}
              value={draft.blanks[seg.key] ?? ''}
              disabled={disabled}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={500}
              data-blank={seg.key}
              onChange={(e) =>
                onChange({
                  kind: 'fill_gap',
                  blanks: { ...draft.blanks, [seg.key]: e.target.value },
                })
              }
            />
          );
        })}
      </div>
    );
  }

  if (question.kind === 'true_false' && draft.kind === 'true_false') {
    const choices: { value: boolean; label: string; key: string }[] = [
      { value: true, label: 'True', key: 'T' },
      { value: false, label: 'False', key: 'F' },
    ];
    return (
      <div role="radiogroup" aria-labelledby={props.labelledBy}>
        {choices.map((c) => {
          const selected = draft.value === c.value;
          const state = reveal
            ? reveal.correctBoolean === c.value
              ? 'correct'
              : selected
                ? 'incorrect'
                : ''
            : '';
          return (
            <button
              key={c.label}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`option ${state}`}
              disabled={disabled}
              onClick={() => onChange({ kind: 'true_false', value: c.value })}
            >
              <span className="option-letter" aria-hidden="true">
                {c.key}
              </span>
              <span className="option-text">{c.label}</span>
              <RevealMark state={state} selected={selected} />
            </button>
          );
        })}
      </div>
    );
  }

  const multi = question.kind === 'multi_choice';
  const selectedIds =
    draft.kind === 'multi_choice'
      ? draft.optionIds
      : draft.kind === 'single_choice' && draft.optionId
        ? [draft.optionId]
        : [];
  return (
    <div role={multi ? 'group' : 'radiogroup'} aria-labelledby={props.labelledBy}>
      {question.options.map((o, i) => {
        const selected = selectedIds.includes(o.id);
        const state = reveal
          ? reveal.correctOptionIds.includes(o.id)
            ? 'correct'
            : selected
              ? 'incorrect'
              : ''
          : '';
        const toggle = () => {
          if (multi) {
            onChange({
              kind: 'multi_choice',
              optionIds: selected
                ? selectedIds.filter((id) => id !== o.id)
                : [...selectedIds, o.id],
            });
          } else onChange({ kind: 'single_choice', optionId: o.id });
        };
        return (
          <button
            key={o.id}
            type="button"
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={selected}
            className={`option${multi ? ' multi' : ''} ${state}`}
            disabled={disabled}
            onClick={toggle}
          >
            <span className="option-letter" aria-hidden="true">
              {multi && selected ? <Check size={15} /> : optionLetter(i)}
            </span>
            <span className="option-text">{o.body}</span>
            <RevealMark state={state} selected={selected} />
          </button>
        );
      })}
    </div>
  );
}

function RevealMark({ state, selected }: { state: string; selected: boolean }) {
  if (state === 'correct')
    return (
      <span className="option-mark good">
        <Check size={15} aria-hidden="true" />{' '}
        {selected ? 'Your answer · correct' : 'Correct answer'}
      </span>
    );
  if (state === 'incorrect')
    return (
      <span className="option-mark bad">
        <X size={15} aria-hidden="true" /> Your answer
      </span>
    );
  return null;
}

/** Human-readable rendering of a learner's answer for review screens. */
export function describeAnswer(snapshot: QuestionSnapshot, answer: Answer | null): string {
  if (!answer) return 'No answer';
  switch (answer.kind) {
    case 'single_choice': {
      const i = snapshot.options.findIndex((o) => o.id === answer.optionId);
      return i >= 0 ? `${optionLetter(i)}. ${snapshot.options[i]?.body}` : 'Unknown option';
    }
    case 'multi_choice':
      return snapshot.options
        .map((o, i) => (answer.optionIds.includes(o.id) ? `${optionLetter(i)}. ${o.body}` : null))
        .filter(Boolean)
        .join('; ');
    case 'true_false':
      return answer.value ? 'True' : 'False';
    case 'fill_gap':
      return snapshot.blanks
        .map((b, i) => `Blank ${i + 1}: “${answer.blanks[b.key] ?? ''}”`)
        .join(' · ');
  }
}

export function describeCorrect(snapshot: QuestionSnapshot): string {
  switch (snapshot.kind) {
    case 'single_choice':
    case 'multi_choice':
      return snapshot.options
        .map((o, i) => (o.isCorrect ? `${optionLetter(i)}. ${o.body}` : null))
        .filter(Boolean)
        .join('; ');
    case 'true_false':
      return snapshot.correctBoolean === null ? '—' : snapshot.correctBoolean ? 'True' : 'False';
    case 'fill_gap':
      return snapshot.blanks
        .map((b, i) => `Blank ${i + 1}: ${b.acceptedAnswers.map((a) => `“${a}”`).join(' or ')}`)
        .join(' · ');
  }
}
