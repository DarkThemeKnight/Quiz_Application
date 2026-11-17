import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnswerArea, draftFromAnswer, draftToAnswer, emptyDraft, type Draft } from './QuestionView';
import { formatClock, formatPercent } from '../lib/format';

describe('answer drafts', () => {
  it('never turns an unset true/false into false', () => {
    expect(draftToAnswer(emptyDraft({ kind: 'true_false', blankKeys: [] }))).toBeNull();
    expect(draftToAnswer({ kind: 'true_false', value: false })).toEqual({
      kind: 'true_false',
      value: false,
    });
  });
  it('treats an empty multi-select or all-empty blanks as no answer', () => {
    expect(draftToAnswer({ kind: 'multi_choice', optionIds: [] })).toBeNull();
    expect(draftToAnswer({ kind: 'fill_gap', blanks: { a: ' ', b: '' } })).toBeNull();
  });
  it('restores saved fill answers while keeping every blank key', () => {
    const draft = draftFromAnswer(
      { kind: 'fill_gap', blankKeys: ['a', 'b'] },
      { kind: 'fill_gap', blanks: { a: 'x' } },
    );
    expect(draft).toEqual({ kind: 'fill_gap', blanks: { a: 'x', b: '' } });
  });
});

describe('AnswerArea', () => {
  it('renders one labelled input per blank inside the sentence', () => {
    render(
      <AnswerArea
        question={{
          kind: 'fill_gap',
          body: 'A {{blank:1}} and {{blank:2}}.',
          options: [],
          blankKeys: ['1', '2'],
        }}
        draft={{ kind: 'fill_gap', blanks: { '1': '', '2': '' } }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText('Blank 1 of 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Blank 2 of 2')).toBeInTheDocument();
  });

  it('multi-select toggles options as checkboxes', async () => {
    const onChange = vi.fn<(d: Draft) => void>();
    render(
      <AnswerArea
        question={{
          kind: 'multi_choice',
          body: 'Pick',
          options: [
            { id: 'a', body: 'Alpha' },
            { id: 'b', body: 'Beta' },
          ],
          blankKeys: [],
        }}
        draft={{ kind: 'multi_choice', optionIds: ['a'] }}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('checkbox', { name: /Alpha/ })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('checkbox', { name: /Beta/ }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'multi_choice', optionIds: ['a', 'b'] });
  });
});

describe('formatting', () => {
  it('shows missing percentages as a dash, never 0%', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(0)).toBe('0%');
  });
  it('formats countdowns and never goes negative', () => {
    expect(formatClock(65_000)).toBe('01:05');
    expect(formatClock(-10)).toBe('00:00');
    expect(formatClock(3_600_000)).toBe('1:00:00');
  });
});
