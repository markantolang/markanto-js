import classes from '../../../data/unicode-classes-v0.1.0.json' with { type: 'json' };

export type CharacterClass = 'W' | 'P' | 'S';

export function isUnicodeWhitespace(code: number): boolean {
  if (code < 0x80) return (code >= 0x09 && code <= 0x0d) || code === 0x20;
  return inRanges(code, classes.whitespace);
}

export function characterClass(code: number): CharacterClass {
  if (code < 0) return 'S';
  if (code < 0x80) {
    if ((code >= 0x09 && code <= 0x0d) || code === 0x20) return 'S';
    if ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a) || code === 0x5f) return 'W';
    return 'P';
  }
  if (inRanges(code, classes.whitespace)) return 'S';
  return inRanges(code, classes.word) ? 'W' : 'P';
}

function inRanges(code: number, ranges: readonly (readonly number[])[]): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const range = ranges[middle]!;
    if (code < range[0]!) high = middle - 1;
    else if (code > range[1]!) low = middle + 1;
    else return true;
  }
  return false;
}

export function codePointAt(text: string, offset: number, end: number): number {
  if (offset >= end) return -1;
  const high = text.charCodeAt(offset);
  if (high >= 0xd800 && high <= 0xdbff && offset + 1 < end) {
    const low = text.charCodeAt(offset + 1);
    if (low >= 0xdc00 && low <= 0xdfff) return (high - 0xd800) * 0x400 + low - 0xdc00 + 0x10000;
  }
  return high;
}

export function codePointBefore(text: string, offset: number, start: number): number {
  if (offset <= start) return -1;
  const low = text.charCodeAt(offset - 1);
  if (low >= 0xdc00 && low <= 0xdfff && offset - 2 >= start) {
    const high = text.charCodeAt(offset - 2);
    if (high >= 0xd800 && high <= 0xdbff) return (high - 0xd800) * 0x400 + low - 0xdc00 + 0x10000;
  }
  return low;
}
