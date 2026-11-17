# ADR 0003 — Spaced review (Leitner)

- **Status:** accepted · 2026-11-17

A five-box Leitner schedule in `review_schedule` (one row per question), implemented in
`packages/shared/src/leitner.ts`:

| Box | Due after   |
| --- | ----------- |
| 1   | immediately |
| 2   | 1 day       |
| 3   | 3 days      |
| 4   | 7 days      |
| 5   | 21 days     |

- Only **answered** items update the schedule (practice: when checked; exam: when submitted). Skipped and
  unanswered items do not — an abandoned 50-question exam should not flood the queue.
- Incorrect → box 1, due now, streak reset. Correct → one box up (a new question starts in box 1, so a first correct
  answer lands in box 2), capped at 5.
- “Schedule missed for review” on the results page puts the chosen questions in box 1, due now.
- “Due for review” = published questions with `next_due_at <= now()`.
- The owner can turn spaced review off in Settings: the schedule stops updating and due counts are hidden.
  Existing rows are kept, so turning it back on resumes from where it was.

No mastery percentages or streak gamification are derived from this.
