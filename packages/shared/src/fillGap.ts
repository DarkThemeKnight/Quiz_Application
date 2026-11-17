/**
 * Fill-in-the-gap placeholder parsing.
 *
 * A placeholder is exactly `{{blank:KEY}}` where KEY matches [A-Za-z0-9_-]{1,32}.
 * Anything that *looks like* a placeholder but is not well-formed (e.g. `{{ blank:1 }}`,
 * `{{blank:}}`, `{{Blank:1}}`) is rejected so authors never get a silently-literal gap.
 * Other braces in text are left alone.
 */

export const BLANK_KEY_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const PLACEHOLDER = /\{\{blank:([A-Za-z0-9_-]{1,32})\}\}/g;
const SUSPICIOUS = /\{\{\s*blank\b[^}]*\}\}|\{\{\s*blank\s*:/gi;

export type GapSegment = { type: 'text'; text: string } | { type: 'blank'; key: string };

export interface ParsedGapBody {
  segments: GapSegment[];
  /** Keys in order of appearance (duplicates preserved so validation can report them). */
  keys: string[];
  /** Malformed placeholder-like fragments found in the body. */
  malformed: string[];
}

export function parseGapBody(body: string): ParsedGapBody {
  const segments: GapSegment[] = [];
  const keys: string[] = [];
  let last = 0;
  for (const match of body.matchAll(PLACEHOLDER)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ type: 'text', text: body.slice(last, index) });
    const key = match[1] as string;
    segments.push({ type: 'blank', key });
    keys.push(key);
    last = index + match[0].length;
  }
  if (last < body.length) segments.push({ type: 'text', text: body.slice(last) });

  // Remove valid placeholders, then look for leftovers that resemble placeholders.
  const stripped = body.replace(PLACEHOLDER, '');
  const malformed = [...stripped.matchAll(SUSPICIOUS)].map((m) => m[0]);
  return { segments, keys, malformed };
}

export interface GapIssue {
  path: (string | number)[];
  message: string;
}

/**
 * Validate that body placeholders and blank definitions correspond one-to-one.
 * Returns an empty list when valid.
 */
export function validateGapMapping(body: string, blankKeys: string[]): GapIssue[] {
  const issues: GapIssue[] = [];
  const parsed = parseGapBody(body);
  for (const fragment of parsed.malformed) {
    issues.push({
      path: ['body'],
      message: `Malformed placeholder "${fragment}". Use exactly {{blank:KEY}}, e.g. {{blank:1}}.`,
    });
  }
  if (parsed.keys.length === 0) {
    issues.push({ path: ['body'], message: 'Add at least one {{blank:KEY}} placeholder.' });
  }
  const seen = new Set<string>();
  for (const key of parsed.keys) {
    if (seen.has(key)) {
      issues.push({
        path: ['body'],
        message: `Placeholder {{blank:${key}}} appears more than once.`,
      });
    }
    seen.add(key);
  }
  const defined = new Set<string>();
  blankKeys.forEach((key, i) => {
    if (!BLANK_KEY_PATTERN.test(key)) {
      issues.push({
        path: ['blanks', i, 'key'],
        message: `Blank key "${key}" may only use letters, digits, "_" or "-".`,
      });
    }
    if (defined.has(key)) {
      issues.push({ path: ['blanks', i, 'key'], message: `Blank key "${key}" is defined twice.` });
    }
    defined.add(key);
    if (!seen.has(key)) {
      issues.push({
        path: ['blanks', i, 'key'],
        message: `Blank "${key}" has no {{blank:${key}}} placeholder in the question.`,
      });
    }
  });
  for (const key of seen) {
    if (!defined.has(key)) {
      issues.push({
        path: ['body'],
        message: `Placeholder {{blank:${key}}} has no accepted answers defined.`,
      });
    }
  }
  return issues;
}

/** Render a gap body for plain-text display, e.g. in lists: "The capital is ____." */
export function gapBodyToDisplayText(body: string, blank = '_____'): string {
  return body.replace(PLACEHOLDER, blank);
}
