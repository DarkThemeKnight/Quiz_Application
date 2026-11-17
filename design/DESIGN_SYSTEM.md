# Recall Studio — visual and interaction design system

## Brand-neutral design goal

**Feel:** a focused study workspace with the polish of a modern productivity tool. Calm, sharp, legible, useful. Not a school portal, not an NRS app, not a game, not a generic marketing dashboard. The content and progress are the product.

**Visual concept:** warm off-white canvas, elevated white/near-white work surfaces, deep slate typography, one restrained cobalt-indigo interactive color, teal successes, amber caution, red errors. The main question card must feel like reading a good textbook, not filling an insurance form. Dark mode uses deep navy-slate and preserves contrast.

## Design tokens

The canonical CSS token file is `design/tokens.css`. Agents must implement those semantic tokens and map them consistently across components. The starter `preview.html` is a deliberately interactive mockup for visual review, not a source of app data.

| Token           | Light     | Role                            |
| --------------- | --------- | ------------------------------- |
| `--bg`          | `#f6f7fb` | App canvas                      |
| `--surface`     | `#ffffff` | Main panels/cards               |
| `--surface-alt` | `#f0f3f9` | Filter surfaces, quiet elements |
| `--ink`         | `#18233c` | Main typography                 |
| `--muted`       | `#657187` | Secondary text                  |
| `--line`        | `#e2e7ef` | Borders                         |
| `--accent`      | `#4f46e5` | Active action and selection     |
| `--accent-soft` | `#eeedff` | Selected backgrounds            |
| `--positive`    | `#047857` | Accurate/correct                |
| `--warning`     | `#a16207` | Needs review                    |
| `--negative`    | `#c24142` | Incorrect/destructive           |

**Typography:** system UI sans (`Inter` if locally provided, not externally fetched; otherwise system fonts). Headings 26–32 desktop, 22–26 mobile. Body 14–16, quiz question 19–23, metadata 12–13. Main line-height 1.45–1.6. Tabular numerals for stats/timer.

**Spacing:** 4px base; typical 8/12/16/24/32. Sidebar width ~236px, main content max 1240px, dashboard card padding 20–24, quiz card padding 28–36, touch targets >= 44px. Radii 10 inputs/chips, 16 cards, 22 hero panels. Shadows subtle.

## Responsive layout

- **>=1100px:** persistent sidebar, page header and content columns; dashboard has 4 compact KPI cards, two-column insights, full-width recent sessions.
- **720–1099px:** narrower nav and compact two-column metrics; analytics charts resize without clipping.
- **<720px:** horizontal top title/action bar, bottom nav for four key destinations, 1-column cards, 44px tap targets, condensed question runner. Question body remains full width; option buttons stack.
- No horizontal page scrolling at 320px. Long question bodies and labels wrap safely.

## Navigation and page architecture

- **Home:** welcome and quick actions, summary metrics, 'Continue learning', weekly accuracy trend, priority topics, recent sessions.
- **Practice:** choose subject/collection, question count, difficulty, mode, selection logic and begin. Avoid a wall of forms; use progressive disclosure.
- **Question runner:** quiet centered reading column; sticky compact top progress; one question at a time; answer options with clear selected state and keyboard focus; practice `Check answer` then `Next`, exam `Save & next` and only show result at final submission.
- **History:** filterable table/cards (date, type, subject, count, duration, score); drill into immutable results.
- **Question bank:** search, filters, table/cards, authoring drawer or dedicated editor, import/export, draft/published/archived statuses.
- **Insights:** meaningful trends with sample sizes, topic weaknesses, study history and an action button per recommendation.
- **Settings:** preferences, security, data import/export, PostgreSQL backup guidance.

## Components and state conventions

1. **Button:** primary solid accent; secondary outlined; quiet text action; destructive red. Every icon button has an accessible name.
2. **Card:** clear title/subtitle, supporting meta, obvious CTA, consistent padding; don't wrap every number in a colorful badge.
3. **Option row:** entire 44px+ row clickable, leading circle/check indicator, optional key letter, selected border/background; correct state teal and incorrect red only _after_ permitted feedback.
4. **Progress:** slim step bar with numerical fraction, timer uses tabular numerals. Never rely on color alone.
5. **Question author:** all choices editable; correct choice(s) unambiguous; gap markers and aliases shown in WYSIWYG-ish preview; validation appears beside fields.
6. **Trend charts:** accessible title, axes/labels, hover details and accompanying textual summary; missing data described rather than rendered as 0.
7. **Empty state:** useful next action and neutral illustration/icon, no fabricated score.
8. **Form errors:** clear copy and focus, no hidden errors, labels always visible.
9. **Loading:** subtle skeleton, avoid layout shift; retry buttons for failures.
10. **Feedback:** practise mode shows explanation after check, results review shows both chosen and accepted answers; exam mode doesn't leak keys during session.

## Accessibility and motion

- WCAG AA contrast target; focus-visible 2px outline and 3px offset.
- Labels/legends for all inputs; `aria-live` for grading feedback with no early leaking in exam mode.
- Keyboard: 1–4 to select single-choice options if focus conditions allow; arrows where appropriate; Enter/Space to submit on focused button; Escape to close dialogs. Never hijack typing in fill-gaps.
- Respect `prefers-reduced-motion`; no distracting celebrations or bouncy transitions. Use 100–180ms restrained state changes.
- Dark mode optional but should use semantic tokens, not filter inversion.

## UX microcopy

- Prefer 'Practice 15 questions' over 'Engage with your learning journey'.
- '3 topics need attention' should lead to a filtered session, not a dead card.
- 'Not enough attempts to estimate accuracy' instead of a fake 0%.
- Separate 'Practice accuracy', 'Average exam score', and 'Questions attempted'.
- Strong learning loop: **Choose → Answer → Understand → Review → Improve**.

## User story for design critique

A user opens the app ten minutes before an interview. Within two clicks, they start a 10-question practice session restricted to recently missed questions; immediately see why answers were wrong, finish, and check whether their weak topic improved. It should be fast, quiet, and credible.
