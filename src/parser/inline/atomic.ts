/**
 * Read-only atomic inline-token boundary scanner (spec §10.4, §12.3).
 *
 * `atomicTokenEnd` returns the exclusive end offset of the complete atomic
 * inline token that begins at `start`, or `start` itself when no such token
 * begins there. It parses nothing and builds no AST — it only locates where a
 * token the inline scanner treats as one indivisible unit ends.
 *
 * The pipe-table row tokenizer (`src/parser/tables.ts`) and the inline scanner
 * share this so their notion of "inside an atomic token" cannot drift: an
 * unescaped `|` inside the returned span is never a table column delimiter.
 * `test/unit/atomic-boundary.test.ts` cross-checks it against the real scanner.
 */
import { parseMOpen } from '../resources.js';
import { scanEntity } from './entities.js';
import { isUnicodeWhitespace } from './unicode.js';

function at(text: string, start: number, end: number, value: string): boolean {
  if (start < 0 || start + value.length > end) return false;
  for (let i = 0; i < value.length; i += 1) if (text.charCodeAt(start + i) !== value.charCodeAt(i)) return false;
  return true;
}
function run(text: string, start: number, end: number, code: number): number {
  let cursor = start;
  while (cursor < end && text.charCodeAt(cursor) === code) cursor += 1;
  return cursor - start;
}
function find(text: string, start: number, end: number, value: string): number {
  for (let cursor = start; cursor + value.length <= end; cursor += 1) if (at(text, cursor, end, value)) return cursor;
  return -1;
}
function blank(code: number): boolean { return code === 0x20 || code === 0x09; }
function boundary(code: number): boolean { return blank(code) || code === 0x3e; }
function isControl(code: number): boolean {
  return (code >= 0 && code <= 0x1f && code !== 0x09) || (code >= 0x7f && code <= 0x9f);
}
function asciiAlnum(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}
function trailing(code: number): boolean {
  return code === 0x3f || code === 0x21 || code === 0x2e || code === 0x2c || code === 0x3a || code === 0x2a || code === 0x5f || code === 0x7e;
}

/**
 * URL / email autolink domains, shared verbatim with the inline scanner
 * (`bracketAutolink`, `bareAutolink`) so an atomic-token boundary decision can
 * never diverge from what the scanner would actually recognise.
 */
export function isUrlAutolink(value: string): boolean {
  const n = value.startsWith('https://') ? 8 : value.startsWith('http://') ? 7 : -1;
  if (n < 0 || value.length <= n) return false;
  for (let i = n; i < value.length; i += 1) {
    const cp = value.codePointAt(i)!;
    if (isUnicodeWhitespace(cp) || cp === 0x3c || cp === 0x3e) return false;
    if (cp > 0xffff) i += 1;
  }
  return true;
}

export function isEmailAutolink(value: string): boolean {
  const a = value.indexOf('@');
  const dot = value.lastIndexOf('.');
  if (a <= 0 || a !== value.lastIndexOf('@') || dot <= a + 1 || value.length - dot - 1 < 2) return false;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (c === 0x40 || c === 0x2e || c === 0x2d || (i < a && (c === 0x5f || c === 0x25 || c === 0x2b))) continue;
    if (!asciiAlnum(c)) return false;
  }
  return true;
}

/** Exclusive end of a `` `…` `` code span, or `start` when the run is not closed. */
export function codeSpanEnd(text: string, start: number, end: number): number {
  const length = run(text, start, end, 0x60);
  if (length === 0) return start;
  let cursor = start + length;
  while (cursor < end) {
    if (text.charCodeAt(cursor) !== 0x60) { cursor += 1; continue; }
    const candidate = run(text, cursor, end, 0x60);
    if (candidate === length) return cursor + length;
    cursor += candidate;
  }
  return start;
}

/** Exclusive end of a matching `opener…closer` wrapper pair (`<i>`/`<b>`), or `-1`. */
export function wrapperClose(text: string, start: number, end: number, opener: string, closer: string): number {
  let depth = 0;
  for (let cursor = start; cursor < end; cursor += 1) {
    if (at(text, cursor, end, opener)) { depth += 1; cursor += opener.length - 1; continue; }
    if (!at(text, cursor, end, closer)) continue;
    if (depth === 0) return cursor;
    depth -= 1;
    cursor += closer.length - 1;
  }
  return -1;
}

/** Offset of the `</m>` that closes the wrapper opened before `start`, or `-1`. */
export function metadataClose(text: string, start: number, end: number): number {
  let depth = 0;
  for (let cursor = start; cursor < end; cursor += 1) {
    if (at(text, cursor, end, '<m') && boundary(text.charCodeAt(cursor + 2))) {
      const nested = parseMOpen(text, cursor, end);
      if (nested?.status === 'ok') { depth += 1; cursor = nested.end - 1; continue; }
    }
    if (!at(text, cursor, end, '</m>')) continue;
    if (depth === 0) return cursor;
    depth -= 1; cursor += 3;
  }
  return -1;
}

/** Exclusive end of a `(destination "title")` group starting at the `(`, or `-1`. */
function destinationEnd(text: string, start: number, end: number): number {
  if (text.charCodeAt(start) !== 0x28) return -1;
  let cursor = start + 1;
  if (text.charCodeAt(cursor) === 0x3c) {
    cursor += 1;
    while (cursor < end) {
      const code = text.charCodeAt(cursor);
      if (code === 0x3e) break;
      if (code === 0x5c && cursor + 1 < end) { cursor += 2; continue; }
      if (isControl(code)) return -1;
      cursor += 1;
    }
    if (cursor >= end) return -1;
    cursor += 1;
  } else {
    let depth = 0;
    while (cursor < end) {
      const code = text.charCodeAt(cursor);
      if (code === 0x5c && cursor + 1 < end) { cursor += 2; continue; }
      if (code === 0x28) depth += 1;
      else if (code === 0x29) { if (depth === 0) break; depth -= 1; }
      else if (isUnicodeWhitespace(code) || isControl(code)) break; // scanner's `destination()` uses the same class
      cursor += 1;
    }
    if (depth !== 0) return -1;
  }
  while (cursor < end && blank(text.charCodeAt(cursor))) cursor += 1;
  const titleOpener = text.charCodeAt(cursor);
  if (titleOpener === 0x22 || titleOpener === 0x27 || titleOpener === 0x28) {
    const titleCloser = titleOpener === 0x28 ? 0x29 : titleOpener;
    const titleStart = ++cursor;
    while (cursor < end && text.charCodeAt(cursor) !== titleCloser) {
      if (text.charCodeAt(cursor) === 0x5c && cursor + 1 < end) cursor += 2;
      else cursor += 1;
    }
    if (cursor >= end || cursor === titleStart) return -1;
    cursor += 1;
    while (cursor < end && blank(text.charCodeAt(cursor))) cursor += 1;
  }
  return text.charCodeAt(cursor) === 0x29 ? cursor + 1 : -1;
}

/**
 * Offset of the `]` that closes the label/alt begun after `start`, skipping a
 * complete nested `[…](…)` / `![…](…)` and any `[^id]`, or `-1`. Mirrors the
 * inline scanner's `findLabelEnd`.
 */
function labelEnd(text: string, start: number, end: number): number {
  let cursor = start;
  while (cursor < end) {
    const code = text.charCodeAt(cursor);
    if (code === 0x5c && cursor + 1 < end) { cursor += 2; continue; }
    if (at(text, cursor, end, '[^')) {
      const footnote = footnoteEnd(text, cursor, end);
      if (footnote > 0) { cursor = footnote; continue; }
    }
    const nestedStart = at(text, cursor, end, '![') ? cursor + 2 : code === 0x5b ? cursor + 1 : -1;
    if (nestedStart >= 0) {
      const nestedLabel = labelEnd(text, nestedStart, end);
      if (nestedLabel >= 0 && text.charCodeAt(nestedLabel + 1) === 0x28) {
        const nestedDest = destinationEnd(text, nestedLabel + 1, end);
        if (nestedDest > 0) { cursor = nestedDest; continue; }
      }
    }
    if (code === 0x5d) return cursor;
    cursor += 1;
  }
  return -1;
}

/** Exclusive end of a `[label](dest)` / `![alt](dest)` direct link/image, or `start`. */
function directResourceEnd(text: string, start: number, end: number): number {
  const image = at(text, start, end, '![');
  const close = labelEnd(text, start + (image ? 2 : 1), end);
  if (close < 0 || text.charCodeAt(close + 1) !== 0x28) return start;
  const destEnd = destinationEnd(text, close + 1, end);
  return destEnd < 0 ? start : destEnd;
}

/** Exclusive end of `[^identifier]`, or `-1`. */
function footnoteEnd(text: string, start: number, end: number): number {
  let cursor = start + 2;
  const from = cursor;
  while (cursor < end) {
    const code = text.charCodeAt(cursor);
    if (asciiAlnum(code) || code === 0x5f || code === 0x2d) cursor += 1;
    else break;
  }
  return cursor > from && text.charCodeAt(cursor) === 0x5d ? cursor + 1 : -1;
}

/** Exclusive end of an angle autolink `<scheme:…>` / `<local@domain>`, or `start`. */
function angleAutolinkEnd(text: string, start: number, end: number): number {
  const close = find(text, start + 1, end, '>');
  if (close < 0) return start;
  const value = text.slice(start + 1, close);
  return isUrlAutolink(value) || isEmailAutolink(value) ? close + 1 : start;
}

/** Exclusive end of a bare `http(s)://…` autolink, or `start`. Caller enforces the left boundary. */
export function bareUrlEnd(text: string, start: number, end: number): number {
  const scheme = at(text, start, end, 'https://') ? 8 : at(text, start, end, 'http://') ? 7 : 0;
  if (scheme === 0) return start;
  let stop = start + scheme;
  while (stop < end) {
    const cp = text.codePointAt(stop)!;
    if (isUnicodeWhitespace(cp) || cp === 0x3c || cp === 0x3e) break; // scanner's `bareAutolink()` stop set
    stop += cp > 0xffff ? 2 : 1;
  }
  let urlEnd = stop;
  while (urlEnd > start + scheme && trailing(text.charCodeAt(urlEnd - 1))) urlEnd -= 1;
  while (text.charCodeAt(urlEnd - 1) === 0x29 && excessParens(text, start, urlEnd)) urlEnd -= 1;
  if (text.charCodeAt(urlEnd - 1) === 0x3b) {
    let amp = urlEnd - 2;
    while (amp >= start && asciiAlnum(text.charCodeAt(amp))) amp -= 1;
    if (text.charCodeAt(amp) === 0x26 && amp + 1 < urlEnd - 1) urlEnd = amp;
  }
  return urlEnd > start + scheme && isUrlAutolink(text.slice(start, urlEnd)) ? urlEnd : start;
}

function excessParens(text: string, start: number, end: number): boolean {
  let open = 0;
  let close = 0;
  for (let cursor = start; cursor < end; cursor += 1) {
    if (text.charCodeAt(cursor) === 0x28) open += 1;
    else if (text.charCodeAt(cursor) === 0x29) close += 1;
  }
  return close > open;
}

/**
 * Exclusive end of the atomic inline token beginning at `start`, or `start`
 * when none does. `precededByWord` is the character-class context the bare-URL
 * autolink rule needs (spec §10.4): a bare `http(s)://` run only autolinks
 * when it is not glued to a preceding word character.
 */
export function atomicTokenEnd(text: string, start: number, end: number, precededByWord: boolean): number {
  const code = text.charCodeAt(start);

  if (code === 0x60) return codeSpanEnd(text, start, end);

  if (at(text, start, end, '$`')) {
    const close = find(text, start + 2, end, '`$');
    return close > start + 2 ? close + 2 : start;
  }

  if (code === 0x5b && at(text, start, end, '[^')) {
    const footnote = footnoteEnd(text, start, end);
    if (footnote > 0) return footnote;
  }
  if (code === 0x5b || at(text, start, end, '![')) {
    return directResourceEnd(text, start, end);
  }

  if (code === 0x3c) {
    if (at(text, start, end, '<i>')) {
      const close = wrapperClose(text, start + 3, end, '<i>', '</i>');
      return close > start + 3 ? close + 4 : start;
    }
    if (at(text, start, end, '<b>')) {
      const close = wrapperClose(text, start + 3, end, '<b>', '</b>');
      return close > start + 3 ? close + 4 : start;
    }
    if (at(text, start, end, '<m') && boundary(text.charCodeAt(start + 2))) {
      const open = parseMOpen(text, start, end);
      if (open?.status === 'ok') {
        const close = metadataClose(text, open.end, end);
        if (close >= 0) return close + 4;
      }
      return start;
    }
    return angleAutolinkEnd(text, start, end);
  }

  if (!precededByWord && (code === 0x68) && (at(text, start, end, 'http://') || at(text, start, end, 'https://'))) {
    return bareUrlEnd(text, start, end);
  }

  if (code === 0x26) {
    const entity = scanEntity(text, start, end);
    if (entity.kind === 'decoded') return entity.end;
  }

  return start;
}
