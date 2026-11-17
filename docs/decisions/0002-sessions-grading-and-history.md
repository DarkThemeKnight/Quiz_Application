# ADR 0002 — Sessions, grading and historical integrity

- **Status:** accepted · 2026-11-17

## Lifecycle

`active → submitted` or `active → abandoned`. Sessions are created directly as `active`: session setup (filters,
count, mode) happens in the browser and is sent in one request, so a persisted `draft` state added nothing. Both
terminal states are immutable.

## Snapshots

Creating a session copies each question (prompt, options with correctness, accepted answers, normalisation,
explanation, hint, subject/topic names, tags, `revision`) into `session_items.snapshot`. Grading, results, analytics
(subject/topic/kind/difficulty) and review all read the snapshot. Editing a question bumps its `revision` only when
gradeable content changes; results show “edited since”, “archived” or “deleted” notes but never re-grade.
`session_items.question_id` is `ON DELETE SET NULL`, so even permanently deleted questions keep their history.

## Answer keys

The runner receives `PublicQuestion` (no correctness, accepted answers or explanation). Feedback is attached only
when permitted: a practice item after “Check answer”, or any item after submission.

## Grading (server-side, `packages/shared/src/grading.ts`)

- Single choice: the one correct option id. Multi choice: exact set equality — no partial credit.
- True/false: a JSON boolean is required; missing/null is a validation error, never “false”.
- Fill in the gap: every blank must match one alias after normalisation (NFKC, trim, collapse whitespace,
  case-insensitive). Accent/punctuation stripping and case-sensitivity are explicit per-question options.

## Modes

- **Practice:** `PUT …/answer` grades and locks the item immediately. Re-sending the same answer is idempotent;
  a different answer returns 409.
- **Exam:** answers are saved (and may be changed or cleared) without grading; all items are graded at submit.
  `ends_at` is set from server time. Saves later than `ends_at + 2 s` grace return `409 DEADLINE_PASSED`; reading
  an expired session finalises it with `submit_reason = 'timeout'` and `submitted_at = ends_at`. The client
  countdown corrects for clock skew using `serverNow`.
- Submission locks the session row (`SELECT … FOR UPDATE`) and is idempotent.

## Scoring

Session score = correct ÷ all assigned questions. Skipped (explicit) and unanswered items are distinct states,
both not correct and both in the denominator. Practice accuracy in analytics excludes skipped items (labelled).
