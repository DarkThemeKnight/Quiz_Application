# Question import / export format

Imports are validated first (preview), then committed **all-or-nothing**: if any row has an error, nothing is
written. Limits: 5 MB, 5,000 questions per file. Subjects, top-level topics, tags and collections named in the
file are created when missing (matched case-insensitively).

**Duplicates:** a row whose `externalId` already exists is always skipped. A row whose prompt matches an existing
question (case/punctuation-insensitive) is skipped by default, or imported when you choose “Import anyway”.

## JSON (canonical; also produced by export)

```json
{
  "format": "recall-studio-question-bank",
  "version": 1,
  "subject": "Default subject for rows without one (optional)",
  "questions": [
    {
      "externalId": "optional-stable-id",
      "subject": "Overrides the default",
      "topic": "Optional topic",
      "type": "single_choice | multi_choice | true_false | fill_gap",
      "difficulty": "easy | medium | hard (default medium)",
      "status": "published | draft (default published)",
      "prompt": "Question text",
      "explanation": "",
      "hint": "",
      "source": "",
      "tags": ["tag"],
      "collections": ["Collection name"]
    }
  ]
}
```

Type-specific fields:

| Type            | Fields                                                                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `single_choice` | `options: [{ "id": "a", "text": "…" }, …]` (2–10), `correctOptionIds: ["a"]` (exactly one)                                                                                                                          |
| `multi_choice`  | same, `correctOptionIds` with one or more ids; graded as an exact set                                                                                                                                               |
| `true_false`    | `correctBoolean: true \| false` (a real JSON boolean)                                                                                                                                                               |
| `fill_gap`      | `prompt` with `{{blank:KEY}}` placeholders; `blanks: [{ "key": "1", "acceptedAnswers": ["…", "alias"] }]`; optional `normalization: { "caseSensitive": false, "ignoreAccents": false, "ignorePunctuation": false }` |

Placeholder keys use letters, digits, `_` or `-`. Every placeholder needs exactly one blank definition and vice
versa; malformed placeholders such as `{{ blank:1 }}` are rejected.

## CSV

UTF-8, RFC 4180 quoting, header row required. Columns (only `type` and `prompt` are required; order is free):

`external_id, subject, topic, type, difficulty, status, prompt, options_json, correct_answers_json, explanation, hint, source, tags, collections`

- `options_json`: `[{"id":"a","text":"…"}, …]`
- `correct_answers_json`: choice → `["a"]`; true/false → `true`/`false`; fill gap → `{"1":["answer","alias"]}`
- `tags`, `collections`: separated by `;`
- Per-question normalisation options are JSON-only (CSV export omits them).

See `examples/question_bank.sample.csv` / `.json` and the templates on the Import page.
