import { isIdentifierChar } from '../source/index.js';

export interface SameLineIdResult {
  readonly bodyEnd: number;
  readonly id?: string;
  readonly error?: string;
}

export function isIdentifier(value: string): boolean {
  if (value.length === 0) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!isIdentifierChar(value.charCodeAt(index))) return false;
  }
  return true;
}

/** Split the committed trailing ` {#...}` envelope from a single-line block. */
export function splitSameLineId(text: string, start: number, end: number): SameLineIdResult {
  const trimmedEnd = trimAsciiBlankEnd(text, start, end);
  if (trimmedEnd <= start || text.charCodeAt(trimmedEnd - 1) !== 0x7d) {
    return { bodyEnd: trimmedEnd };
  }
  let suffixStart = -1;
  for (let index = start; index + 2 < trimmedEnd; index += 1) {
    if (
      text.charCodeAt(index) === 0x20 &&
      text.charCodeAt(index + 1) === 0x7b &&
      text.charCodeAt(index + 2) === 0x23
    ) {
      suffixStart = index;
    }
  }
  if (suffixStart < 0) return { bodyEnd: trimmedEnd };
  const suffix = text.slice(suffixStart + 1, trimmedEnd);
  const id = suffix.slice(2, -1);
  if (!isIdentifier(id)) {
    return { bodyEnd: suffixStart, error: 'invalid block id suffix' };
  }
  return { bodyEnd: suffixStart, id };
}

export function parseStandaloneSuffix(text: string):
  | { readonly kind: 'not-suffix' }
  | { readonly kind: 'valid'; readonly id: string }
  | { readonly kind: 'invalid' } {
  const end = trimAsciiBlankEnd(text, 0, text.length);
  const candidate = text.slice(0, end);
  if (!candidate.startsWith('{') || !candidate.endsWith('}')) return { kind: 'not-suffix' };
  if (candidate.startsWith('{#')) {
    const id = candidate.slice(2, -1);
    return isIdentifier(id) ? { kind: 'valid', id } : { kind: 'invalid' };
  }
  return { kind: 'invalid' };
}

export function trimAsciiBlankEnd(text: string, start: number, end: number): number {
  let index = end;
  while (index > start) {
    const code = text.charCodeAt(index - 1);
    if (code !== 0x20 && code !== 0x09) break;
    index -= 1;
  }
  return index;
}
