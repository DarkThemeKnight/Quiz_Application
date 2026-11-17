/**
 * Fill-in-the-gap answer normalisation.
 *
 * Default (always applied): Unicode NFKC, trim, collapse runs of whitespace to one space,
 * and case-insensitive comparison (`toLowerCase`, locale independent).
 * Digits, accents and symbols are NOT removed unless the question explicitly opts in.
 */
export interface NormalizationOptions {
  /** When true, "Paris" and "paris" are different answers. Default false. */
  caseSensitive: boolean;
  /** When true, combining marks are stripped so "café" matches "cafe". Default false. */
  ignoreAccents: boolean;
  /** When true, Unicode punctuation and symbols are removed before comparison. Default false. */
  ignorePunctuation: boolean;
}

export const DEFAULT_NORMALIZATION: NormalizationOptions = Object.freeze({
  caseSensitive: false,
  ignoreAccents: false,
  ignorePunctuation: false,
});

export function normalizeAnswer(
  raw: string,
  options: NormalizationOptions = DEFAULT_NORMALIZATION,
): string {
  let value = raw.normalize('NFKC');
  if (options.ignoreAccents) {
    value = value
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .normalize('NFC');
  }
  if (options.ignorePunctuation) {
    value = value.replace(/[\p{P}\p{S}]+/gu, ' ');
  }
  value = value.replace(/\s+/gu, ' ').trim();
  if (!options.caseSensitive) {
    value = value.toLowerCase();
  }
  return value;
}

/** Fingerprint used for duplicate-question warnings (not for grading). */
export function questionFingerprint(body: string): string {
  return normalizeAnswer(body, {
    caseSensitive: false,
    ignoreAccents: false,
    ignorePunctuation: true,
  });
}
