/** URL-friendly slug for display/links; uniqueness is enforced on lower(name), not on slug. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'item';
}

/** Escape LIKE wildcards in user search input. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
