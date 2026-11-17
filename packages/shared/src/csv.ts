/**
 * Minimal RFC 4180 CSV reader/writer (no dependency). Supports quoted fields, escaped quotes
 * (""), embedded newlines, CRLF/LF line endings and a leading UTF-8 BOM.
 */
export class CsvParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = 'CsvParseError';
  }
}

export function parseCsv(input: string): string[][] {
  const text = input.startsWith('﻿') ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let quoteStartLine = 1;
  let fieldStarted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (fieldStarted && field.length > 0) {
        throw new CsvParseError('Unexpected quote inside an unquoted field.', line);
      }
      inQuotes = true;
      fieldStarted = true;
      quoteStartLine = line;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      fieldStarted = false;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      fieldStarted = false;
      line++;
    } else {
      field += ch;
      fieldStarted = true;
    }
  }
  if (inQuotes) throw new CsvParseError('Unterminated quoted field.', quoteStartLine);
  if (field.length > 0 || fieldStarted || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully empty lines (e.g. trailing blank lines).
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function escapeField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(escapeField).join(',')).join('\r\n') + '\r\n';
}
