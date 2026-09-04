import names from '../../../data/html-named-character-references-v0.1.0.json' with { type: 'json' };

export type EntityResult = { kind: 'none' } | { kind: 'decoded'; value: string; end: number } |
  { kind: 'error'; message: string };
const table: Readonly<Record<string, string>> = names;

export function scanEntity(text: string, start: number, end: number): EntityResult {
  if (text.charCodeAt(start) !== 0x26 || start + 2 >= end) return { kind: 'none' };
  let cursor = start + 1;
  if (text.charCodeAt(cursor) === 0x23) {
    cursor += 1;
    let radix = 10;
    if (text.charCodeAt(cursor) === 0x78 || text.charCodeAt(cursor) === 0x58) { radix = 16; cursor += 1; }
    const digits = cursor;
    const maxDigits = radix === 10 ? 7 : 6;
    let value = 0;
    while (cursor < end && cursor - digits < maxDigits) {
      const digit = digitValue(text.charCodeAt(cursor), radix);
      if (digit < 0) break;
      value = value * radix + digit; cursor += 1;
    }
    if (cursor === digits || text.charCodeAt(cursor) !== 0x3b) return { kind: 'none' };
    if (!allowedScalar(value)) return { kind: 'none' };
    return { kind: 'decoded', value: String.fromCodePoint(value), end: cursor + 1 };
  }
  const nameStart = cursor;
  while (cursor < end && asciiAlnum(text.charCodeAt(cursor))) cursor += 1;
  if (cursor === nameStart || text.charCodeAt(cursor) !== 0x3b) return { kind: 'none' };
  const value = table[text.slice(nameStart, cursor)];
  if (value === undefined || !allowedString(value)) return { kind: 'none' };
  return { kind: 'decoded', value, end: cursor + 1 };
}

function allowedString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const scalar = value.codePointAt(index)!;
    if (!allowedScalar(scalar)) return false;
    if (scalar > 0xffff) index += 1;
  }
  return true;
}

function allowedScalar(value: number): boolean {
  if (value <= 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return false;
  return value === 0x09 || !((value >= 0x01 && value <= 0x1f) || (value >= 0x7f && value <= 0x9f));
}

function digitValue(code: number, radix: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (radix === 16 && code >= 65 && code <= 70) return code - 55;
  if (radix === 16 && code >= 97 && code <= 102) return code - 87;
  return -1;
}
function asciiAlnum(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}
