/**
 * Lined and fenced container recognition (Phase 3).
 *
 * The recognizers follow the same contract as the leaf recognizers in
 * `blocks.ts`: return `null` when the construct does not start at the current
 * line (reader untouched), a block node (reader advanced past all consumed
 * lines), or an error (reader advanced to the safe boundary).
 */
import type { FencedContainer, GridCell, LinedContainer } from '../ast.js';
import type { SourceAnnotationBuilder } from '../parser-contract.js';
import type { LineReader, PhysicalLine } from '../source/index.js';
import { codePointAt, isUnicodeWhitespace } from './inline/unicode.js';
import { isAsciiBlankCode, leadingSpaces, onlyAsciiBlank, runLength, parseBlockSequence, type BlockResult, type ContainerContext } from './blocks.js';
import { trimAsciiBlankEnd } from './block-id.js';
import { codeFenceOpener, commentContentStart, commentClosesOnLine, codeFenceCloser, gridMarkerKind, parseGridBody } from './grid.js';

/** The single permitted NFC normalisation in the codebase (spec §2.7.4). */
export function normalizeType(value: string): string {
  return value.normalize('NFC');
}

/** TYPE character grammar (spec §2.7.4): exclude whitespace, controls, and the listed punctuation. */
function isValidTypeCodePoint(code: number): boolean {
  if (isUnicodeWhitespace(code)) return false;
  if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false;
  return (
    code !== 0x3c && code !== 0x3e && code !== 0x5b && code !== 0x5d &&
    code !== 0x7b && code !== 0x7d && code !== 0x7c && code !== 0x5c && code !== 0x60
  );
}

export function isValidTypeString(value: string): boolean {
  for (let index = 0; index < value.length; ) {
    const code = codePointAt(value, index, value.length);
    if (!isValidTypeCodePoint(code)) return false;
    index += code > 0xffff ? 2 : 1;
  }
  return true;
}

type HeaderParse =
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'typed'; readonly type: string; readonly title: string | null }
  | { readonly kind: 'error'; readonly message: string };

/** Parse `TYPE [TITLE]` from a header region; `start..end` may carry leading blanks. */
function parseTypeTitle(text: string, start: number, end: number): HeaderParse {
  let index = start;
  while (index < end && isAsciiBlankCode(text.charCodeAt(index))) index += 1;
  if (index >= end) return { kind: 'anonymous' };
  const typeStart = index;
  while (index < end && !isAsciiBlankCode(text.charCodeAt(index))) index += 1;
  const typeEnd = index;
  for (let cursor = typeStart; cursor < typeEnd; ) {
    const code = codePointAt(text, cursor, typeEnd);
    if (!isValidTypeCodePoint(code)) return { kind: 'error', message: 'invalid TYPE character' };
    cursor += code > 0xffff ? 2 : 1;
  }
  const type = normalizeType(text.slice(typeStart, typeEnd));
  while (index < end && isAsciiBlankCode(text.charCodeAt(index))) index += 1;
  const titleStart = index;
  const titleEnd = trimAsciiBlankEnd(text, titleStart, end);
  const title = titleEnd > titleStart ? text.slice(titleStart, titleEnd) : null;
  return { kind: 'typed', type, title };
}

/** A code/math fence opener on the line (0–3 leading spaces, run ≥ 3), or null. */
function containerFenceRun(text: string, line: PhysicalLine, char: number): number {
  if (leadingSpaces(text, line) !== 0) return 0;
  const run = runLength(text, line.start, char, line.contentEnd);
  return onlyAsciiBlank(text, line.start + run, line.contentEnd) ? run : 0;
}

/**
 * Scan the (already-delimited) container body forward for the matching closer,
 * honouring code/math fence and comment literal regions so a `:::`/`___` inside
 * a literal region is content, not a closer.
 */
function scanContainerBody(
  lines: LineReader,
  text: string,
  fenceChar: number,
  openerLength: number,
): { readonly bodyLines: PhysicalLine[]; readonly closer: PhysicalLine | null } {
  const bodyLines: PhysicalLine[] = [];
  let literal: { kind: 'fence'; char: number; length: number } | { kind: 'comment' } | null = null;
  let ahead = 0;
  for (;;) {
    const line = lines.peek(ahead);
    if (line === null) return { bodyLines, closer: null };
    if (literal === null) {
      const fence = codeFenceOpener(text, line);
      if (fence !== null) {
        literal = { kind: 'fence', char: fence.char, length: fence.length };
        bodyLines.push(line);
        ahead += 1;
        continue;
      }
      const commentStart = commentContentStart(text, line);
      if (commentStart >= 0) {
        literal = { kind: 'comment' };
        if (commentClosesOnLine(text, line, commentStart)) literal = null;
        bodyLines.push(line);
        ahead += 1;
        continue;
      }
      const run = containerFenceRun(text, line, fenceChar);
      if (run >= openerLength) return { bodyLines, closer: line };
      bodyLines.push(line);
      ahead += 1;
      continue;
    }
    if (literal.kind === 'fence') {
      if (codeFenceCloser(text, line, literal.char, literal.length)) literal = null;
    } else if (commentClosesOnLine(text, line, line.start)) {
      literal = null;
    }
    bodyLines.push(line);
    ahead += 1;
  }
}

export function recognizeFencedContainer(
  lines: LineReader,
  text: string,
  annotations: SourceAnnotationBuilder,
  context: ContainerContext,
): BlockResult | null {
  const opener = lines.current;
  if (opener === null) return null;
  if (leadingSpaces(text, opener) !== 0) return null;
  const run = runLength(text, opener.start, 0x3a, opener.contentEnd);
  if (run < 3) return null;
  if (context === 'fenced-body' || context === 'grid-cell' || context === 'quote' || context === 'list-item') {
    return { status: 'error', message: 'forbidden container nesting', start: opener.start, safeEnd: opener.contentEnd, category: 'semantic' };
  }
  const afterRun = opener.start + run;
  if (afterRun < opener.contentEnd && !isAsciiBlankCode(text.charCodeAt(afterRun))) return null;
  let headerStart = afterRun;
  if (afterRun < opener.contentEnd) {
    while (headerStart < opener.contentEnd && isAsciiBlankCode(text.charCodeAt(headerStart))) headerStart += 1;
  }
  let containerType: string | null = null;
  let title: string | null = null;
  if (headerStart < opener.contentEnd) {
    const header = parseTypeTitle(text, headerStart, opener.contentEnd);
    if (header.kind === 'error') {
      return { status: 'error', message: header.message, start: opener.start, safeEnd: opener.contentEnd, category: 'syntax' };
    }
    if (header.kind === 'typed') {
      containerType = header.type;
      title = header.title;
    }
  }
  lines.advance();
  const { bodyLines, closer } = scanContainerBody(lines, text, 0x3a, run);
  if (closer === null) {
    const last = bodyLines.length > 0 ? bodyLines[bodyLines.length - 1]! : opener;
    return { status: 'error', message: 'unclosed fenced container', start: opener.start, safeEnd: last.contentEnd, category: 'syntax' };
  }

  const gridResult = parseGridBody(bodyLines, text, annotations);
  if (gridResult.kind === 'error') {
    return { status: 'error', message: gridResult.message, start: opener.start, safeEnd: closer.contentEnd, category: gridResult.category };
  }
  if (gridResult.kind === 'grid') {
    let nodeCount = 1 + gridResult.nodeCount;
    const cellBoundary = (line: PhysicalLine): boolean => {
      if (line.number === closer.number) return true;
      const marker = gridMarkerKind(text, line);
      return marker === '::' || marker === '==' || marker === '--';
    };
    for (const step of gridResult.steps) {
      if (step.type === 'skip') {
        lines.advance();
        continue;
      }
      const cellParse = parseBlockSequence(lines, text, annotations, cellBoundary, 'grid-cell');
      if (cellParse.status === 'error') {
        return { status: 'error', message: cellParse.message, start: cellParse.start, safeEnd: cellParse.safeEnd, category: cellParse.category };
      }
      step.cell.children = cellParse.blocks as GridCell['children'];
      nodeCount += cellParse.nodeCount;
    }
    lines.advance(); // closer
    const node: FencedContainer = {
      type: 'container',
      form: 'fenced',
      containerType,
      title,
      children: [gridResult.grid] as FencedContainer['children'],
    };
    annotations.set(node, opener.start, closer.contentEnd);
    return { status: 'ok', node, start: opener.start, end: closer.contentEnd, nodeCount };
  }

  const body = parseBlockSequence(lines, text, annotations, (line) => line.number === closer.number, 'fenced-body');
  if (body.status === 'error') {
    return { status: 'error', message: body.message, start: body.start, safeEnd: body.safeEnd, category: body.category };
  }
  if (body.blocks.length === 0) {
    return { status: 'error', message: 'empty container', start: opener.start, safeEnd: closer.contentEnd, category: 'semantic' };
  }
  lines.advance();
  const node: FencedContainer = {
    type: 'container',
    form: 'fenced',
    containerType,
    title,
    children: body.blocks as FencedContainer['children'],
  };
  annotations.set(node, opener.start, closer.contentEnd);
  return { status: 'ok', node, start: opener.start, end: closer.contentEnd, nodeCount: 1 + body.nodeCount };
}

export function recognizeLinedContainer(
  lines: LineReader,
  text: string,
  annotations: SourceAnnotationBuilder,
  context: ContainerContext,
): BlockResult | null {
  const line = lines.current;
  if (line === null) return null;
  const fenceRun = linedFenceRun(text, line);
  const isAnonymous = fenceRun >= 3;
  const next = lines.peek(1);
  const nextFenceRun = next === null ? 0 : linedFenceRun(text, next);
  const isTyped =
    !isAnonymous &&
    nextFenceRun >= 3 &&
    leadingSpaces(text, line) === 0 &&
    !isLinedHeaderIntroducer(text.slice(line.start, line.contentEnd));
  if (!isAnonymous && !isTyped) return null;

  if (context === 'lined-body') {
    // An anonymous fence is the enclosing lined container's closer and is
    // handled by the caller's boundary predicate. A typed candidate is only
    // distinguishable from ordinary final content when the following region
    // contains the inner closer immediately followed by the outer closer.
    if (isTyped && hasNestedLinedClosure(lines, text)) {
      return { status: 'error', message: 'forbidden container nesting', start: line.start, safeEnd: next!.contentEnd, category: 'semantic' };
    }
    return null;
  }
  if (context === 'fenced-body' || context === 'grid-cell' || context === 'quote' || context === 'list-item') {
    return { status: 'error', message: 'forbidden container nesting', start: line.start, safeEnd: (isAnonymous ? line : next!).contentEnd, category: 'semantic' };
  }

  const fenceLength = isTyped ? nextFenceRun : fenceRun;
  let containerType: string | null = null;
  let title: string | null = null;
  if (isTyped) {
    const header = parseTypeTitle(text, line.start, line.contentEnd);
    if (header.kind === 'error') {
      return { status: 'error', message: header.message, start: line.start, safeEnd: line.contentEnd, category: 'syntax' };
    }
    if (header.kind === 'typed') {
      containerType = header.type;
      title = header.title;
    }
    lines.advance(); // header line
  }
  lines.advance(); // opener fence
  const { bodyLines, closer } = scanContainerBody(lines, text, 0x5f, fenceLength);
  if (closer === null) {
    const last = bodyLines.length > 0 ? bodyLines[bodyLines.length - 1]! : (isTyped ? next! : line);
    return { status: 'error', message: 'unclosed lined container', start: line.start, safeEnd: last.contentEnd, category: 'syntax' };
  }
  const body = parseBlockSequence(lines, text, annotations, (candidate) => candidate.number === closer.number, 'lined-body');
  if (body.status === 'error') {
    return { status: 'error', message: body.message, start: body.start, safeEnd: body.safeEnd, category: body.category };
  }
  if (body.blocks.length === 0) {
    return { status: 'error', message: 'empty container', start: line.start, safeEnd: closer.contentEnd, category: 'semantic' };
  }
  lines.advance(); // closer
  const node: LinedContainer = {
    type: 'container',
    form: 'lined',
    containerType,
    title,
    children: body.blocks as LinedContainer['children'],
  };
  annotations.set(node, line.start, closer.contentEnd);
  return { status: 'ok', node, start: line.start, end: closer.contentEnd, nodeCount: 1 + body.nodeCount };
}

/**
 * From a candidate typed lined header inside a lined body, decide whether the
 * following region actually contains a nested lined container — an inner `___`
 * closer sitting immediately (blank lines only) before the enclosing `___`
 * closer.
 *
 * A `___` fence that is followed (blank lines only) by ordinary content is a
 * *sibling* container's opener, not part of an inner/outer closer pair; it must
 * not arm the "two adjacent fences" signal. Without this guard three or more
 * valid sibling lined containers were rejected as `forbidden container nesting`
 * because the scan ran past this container's own closer into the next sibling.
 */
function hasNestedLinedClosure(lines: LineReader, text: string): boolean {
  let previousWasFence = false;
  for (let ahead = 2; ; ahead += 1) {
    const candidate = lines.peek(ahead);
    if (candidate === null) return false;
    if (linedFenceRun(text, candidate) >= 3) {
      if (fenceFollowedByContent(lines, text, ahead)) {
        previousWasFence = false;
        continue;
      }
      if (previousWasFence) return true;
      previousWasFence = true;
    } else if (!onlyAsciiBlank(text, candidate.start, candidate.contentEnd)) {
      previousWasFence = false;
    }
  }
}

/** True when the first non-blank line after the `_` fence at `fenceAhead` is ordinary content (not another baseline `_` fence, not end of input). */
function fenceFollowedByContent(lines: LineReader, text: string, fenceAhead: number): boolean {
  for (let ahead = fenceAhead + 1; ; ahead += 1) {
    const line = lines.peek(ahead);
    if (line === null) return false;
    if (onlyAsciiBlank(text, line.start, line.contentEnd)) continue;
    return linedFenceRun(text, line) < 3;
  }
}

/** An unescaped `___`+ lined fence at column 0, or 0. */
function linedFenceRun(text: string, line: PhysicalLine): number {
  if (leadingSpaces(text, line) !== 0) return 0;
  let run = 0;
  let index = line.start;
  while (index < line.contentEnd) {
    const code = text.charCodeAt(index);
    if (code === 0x5c) return 0;
    if (code !== 0x5f) break;
    run += 1;
    index += 1;
  }
  if (run < 3) return 0;
  return onlyAsciiBlank(text, index, line.contentEnd) ? run : 0;
}

/** True when a candidate lined header itself begins a recognised block construct. */
export function isLinedHeaderIntroducer(header: string): boolean {
  let index = 0;
  let hashes = 0;
  while (index < header.length && header.charCodeAt(index) === 0x23) { index += 1; hashes += 1; }
  if (hashes >= 1 && hashes <= 6 && (index === header.length || header.charCodeAt(index) === 0x20)) return true;

  const first = header.charCodeAt(0);
  const secondIsSpaceOrEnd = header.length === 1 || header.charCodeAt(1) === 0x20;
  // A block quote marker is `>` with an *optional* following space (CommonMark
  // 5.1), so any leading `>` makes the line a quote, never a lined header.
  if (first === 0x3e) return true;
  if ((first === 0x2d || first === 0x2b || first === 0x2a) && secondIsSpaceOrEnd) return true;
  // A block-resource opener also interrupts a paragraph and is recognised before
  // it (§4.4): a bare block image `![…` and any `<…`-led line (`<m …>` block
  // resource / MIB wrapper, `<!--` comment). None of these lead characters can
  // begin a valid container TYPE, so `line\n___` is a block resource / comment
  // followed by an anonymous lined container, never a typed one.
  if (first === 0x21 && header.charCodeAt(1) === 0x5b) return true;
  if (first === 0x3c) return true;

  let ordered = 0;
  while (ordered < header.length) {
    const code = header.charCodeAt(ordered);
    if (code < 0x30 || code > 0x39) break;
    ordered += 1;
  }
  if (ordered > 0 && ordered < header.length) {
    const marker = header.charCodeAt(ordered);
    const afterMarker = ordered + 1;
    if (
      (marker === 0x2e || marker === 0x29) &&
      (afterMarker === header.length || header.charCodeAt(afterMarker) === 0x20)
    ) return true;
  }

  // TODO: include table and footnote introducers when the complete
  // lined-header precedence guard needs them (block resources, quotes, lists,
  // fences, comments, and the two container fences are covered above/below).
  //
  // The backtick refinement of spec §2.4 (a `` ```+ `` line with a backtick in
  // the remainder is a paragraph, not a fence) is deliberately NOT mirrored
  // here: a backtick can never be a valid lined-container TYPE code point
  // anyway (isValidTypeCodePoint), so treating every `` ```+ ``/`~~~+` line as a
  // fence introducer only changes an already-doomed header into an anonymous
  // container preceded by a paragraph — the friendlier of the two outcomes.
  if (first === 0x60 || first === 0x7e) {
    let run = 0;
    while (run < header.length && header.charCodeAt(run) === first) run += 1;
    if (run >= 3) return true;
  }
  let colon = 0;
  while (colon < header.length && header.charCodeAt(colon) === 0x3a) colon += 1;
  if (colon >= 3) return true;
  let underscore = 0;
  while (underscore < header.length && header.charCodeAt(underscore) === 0x5f) underscore += 1;
  if (underscore >= 3 && underscore === header.length) return true;

  let nonBlank = 0;
  let hrLike = true;
  for (let cursor = 0; cursor < header.length; cursor += 1) {
    const code = header.charCodeAt(cursor);
    if (code === 0x2d || code === 0x2a) nonBlank += 1;
    else if (code === 0x20 || code === 0x09) continue;
    else { hrLike = false; break; }
  }
  return hrLike && nonBlank >= 3;
}
