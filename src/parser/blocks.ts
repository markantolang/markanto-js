import type { CodeBlock, CommentBlock, DocumentBlock, Heading, HorizontalRule, MathBlock, Paragraph } from '../ast.js';
import type { SourceAnnotationBuilder } from '../parser-contract.js';
import type { LineReader, PhysicalLine } from '../source/index.js';
import { parseStandaloneSuffix, splitSameLineId, trimAsciiBlankEnd } from './block-id.js';
import { parseParagraphInline } from './paragraph.js';
import { parseInline } from './inline/scanner.js';
import { isLinedHeaderIntroducer, recognizeFencedContainer, recognizeLinedContainer } from './containers.js';
import { recognizeBlockResource, startsBlockResource } from './resources.js';
import { recognizeQuote, startsQuote } from './quotes.js';
import { recognizeList, startsList } from './lists.js';
import { looksLikeTableRow, recognizeTable, separatorAlignments, tokenizeRow } from './tables.js';
import { footnoteDefinitionContentStart } from './footnotes.js';

export type BlockResult =
  | { readonly status: 'ok'; readonly node: DocumentBlock; readonly start: number; readonly end: number; readonly nodeCount: number }
  | { readonly status: 'error'; readonly message: string; readonly start: number; readonly safeEnd: number; readonly category?: 'syntax' | 'semantic' };

/**
 * The structural context a block is recognised in. Containers are only
 * legal at document level or as direct `lined -> fenced` children; a nested
 * container anywhere else is a semantic error.
 */
export type ContainerContext = 'document' | 'lined-body' | 'fenced-body' | 'grid-cell' | 'quote' | 'list-item';

export function recognizeBlock(
  lines: LineReader,
  text: string,
  annotations: SourceAnnotationBuilder,
  context: ContainerContext = 'document',
  stopAt?: (line: PhysicalLine) => boolean,
): BlockResult {
  const lined = recognizeLinedContainer(lines, text, annotations, context);
  if (lined !== null) return lined;
  const fenced = recognizeFencedContainer(lines, text, annotations, context);
  if (fenced !== null) return fenced;
  const comment = recognizeComment(lines, text);
  if (comment !== null) return comment;
  const fence = recognizeFence(lines, text);
  if (fence !== null) return fence;
  const heading = recognizeHeading(lines, text, annotations);
  if (heading !== null) {
    return context === 'list-item' && heading.status === 'ok'
      ? { status: 'error', message: 'heading not permitted in list item', start: heading.start, safeEnd: heading.end, category: 'semantic' }
      : heading;
  }
  const horizontalRule = recognizeHorizontalRule(lines, text);
  if (horizontalRule !== null) {
    return context === 'list-item' && horizontalRule.status === 'ok'
      ? { status: 'error', message: 'thematic break not permitted in list item', start: horizontalRule.start, safeEnd: horizontalRule.end, category: 'semantic' }
      : horizontalRule;
  }
  const list = recognizeList(lines, text, annotations, context);
  if (list !== null) return list;
  const quote = recognizeQuote(lines, text, annotations, context);
  if (quote !== null) return quote;
  const table = recognizeTable(lines, text, annotations);
  if (table !== null) return table;
  const resource = recognizeBlockResource(lines, text, annotations, context);
  if (resource !== null) return resource;
  return recognizeParagraph(lines, text, annotations, stopAt, context);
}

/**
 * True when `header` + `separator` confirm a table (used as a paragraph
 * boundary). A recognisable separator on line 2 confirms the block per §12.3
 * even when its cell count differs from the header — that mismatch is then a
 * syntax error inside `recognizeTable`, not a silent paragraph fallback.
 */
export function startsTable(text: string, header: PhysicalLine, separator: PhysicalLine): boolean {
  if (!looksLikeTableRow(text, header) || !looksLikeTableRow(text, separator)) return false;
  const separatorCells = tokenizeRow(text, separator.start, trimAsciiBlankEnd(text, separator.start, separator.contentEnd));
  return separatorAlignments(text, separatorCells) !== null;
}

export type BlockSequenceResult =
  | { readonly status: 'ok'; readonly blocks: DocumentBlock[]; readonly nodeCount: number }
  | { readonly status: 'error'; readonly message: string; readonly start: number; readonly safeEnd: number; readonly category: 'syntax' | 'semantic' };

/**
 * Consume blocks from `lines` until `boundary(lines.current)` is true or the
 * reader is at end, without consuming the boundary line. Handles blank-line
 * skipping, standalone `{#id}` suffix lines, and the same-line/next-line
 * `{#id}` attachment exactly as `parse()` does. On the first block error,
 * stops and returns it (no recovery document; the caller turns it into a
 * block-level error).
 *
 * `context` governs which nested containers are legal for the range being
 * parsed.
 */
export function parseBlockSequence(
  lines: LineReader,
  text: string,
  annotations: SourceAnnotationBuilder,
  boundary: (line: PhysicalLine) => boolean,
  context: ContainerContext,
): BlockSequenceResult {
  const blocks: DocumentBlock[] = [];
  let nodeCount = 0;
  let separatedByBlank = true;
  // Positions that carry no identity slot (spec §5.3): a `{#id}` here — standalone
  // line, trailing suffix, or same-line on a heading/paragraph — is a semantic
  // scope error, not a value the AST may hold and `validate()` has to catch.
  const idForbiddenScope = context === 'list-item' || context === 'quote' || context === 'grid-cell';
  while (!lines.atEnd) {
    const current = lines.current!;
    if (lines.isWhitespaceOnly(current)) {
      lines.advance();
      separatedByBlank = true;
      continue;
    }
    if (boundary(current)) break;
    const standalone = parseStandaloneSuffix(text.slice(current.start, current.contentEnd));
    if (standalone.kind !== 'not-suffix') {
      lines.advance();
      const message = standalone.kind === 'valid' && separatedByBlank
        ? 'block id after blank line'
        : 'invalid block id suffix';
      return { status: 'error', message, start: current.start, safeEnd: current.contentEnd, category: idForbiddenScope ? 'semantic' : 'syntax' };
    }
    const result = recognizeBlock(lines, text, annotations, context, boundary);
    if (result.status === 'error') {
      return { status: 'error', message: result.message, start: result.start, safeEnd: result.safeEnd, category: result.category ?? 'syntax' };
    }
    if (idForbiddenScope && (result.node as { id?: string }).id !== undefined) {
      return { status: 'error', message: `block id {#${(result.node as { id?: string }).id}} not permitted at ${context} scope`, start: result.start, safeEnd: result.end, category: 'semantic' };
    }
    let blockEnd = result.end;
    const suffixLine = lines.current;
    if (suffixLine !== null) {
      const suffix = parseStandaloneSuffix(text.slice(suffixLine.start, suffixLine.contentEnd));
      if (suffix.kind !== 'not-suffix') {
        lines.advance();
        const eligible = !idForbiddenScope && (result.node.type === 'paragraph' || result.node.type === 'codeBlock' || result.node.type === 'mathBlock' ||
          result.node.type === 'imageBlock' || result.node.type === 'videoBlock' || result.node.type === 'audioBlock' ||
          result.node.type === 'embedBlock' || result.node.type === 'downloadBlock' || result.node.type === 'quoteRegion' || result.node.type === 'list' || result.node.type === 'table' ||
          result.node.type === 'container');
        if (eligible && suffix.kind === 'valid') {
          result.node.id = suffix.id;
          blockEnd = suffixLine.contentEnd;
        } else {
          return { status: 'error', message: 'invalid block id suffix', start: suffixLine.start, safeEnd: suffixLine.contentEnd, category: idForbiddenScope ? 'semantic' : 'syntax' };
        }
      }
    }
    annotations.set(result.node, result.start, blockEnd);
    blocks.push(result.node);
    nodeCount += result.nodeCount;
    separatedByBlank = false;
  }
  return { status: 'ok', blocks, nodeCount };
}

function recognizeComment(lines: LineReader, text: string): BlockResult | null {
  const opener = lines.current!;
  const indent = leadingSpaces(text, opener);
  if (indent > 3 || !text.startsWith('<!--', opener.start + indent)) return null;
  const valueStart = opener.start + indent + 4;
  lines.advance();
  let current = opener;
  while (true) {
    const searchStart = current === opener ? valueStart : current.start;
    const closer = text.indexOf('-->', searchStart);
    if (closer >= 0 && closer + 3 <= current.contentEnd) {
      // The per-iteration `lines.advance()` below already left the reader on the
      // line after `current`; no extra sync is needed here.
      if (!onlyAsciiBlank(text, closer + 3, current.contentEnd)) {
        return { status: 'error', message: 'content after comment closer', start: opener.start, safeEnd: current.contentEnd };
      }
      const node: CommentBlock = { type: 'commentBlock', value: text.slice(valueStart, closer) };
      return { status: 'ok', node, start: opener.start, end: current.contentEnd, nodeCount: 1 };
    }
    const next = lines.current;
    if (next === null) {
      return { status: 'error', message: 'unclosed comment', start: opener.start, safeEnd: current.contentEnd };
    }
    current = next;
    lines.advance();
  }
}

function recognizeFence(lines: LineReader, text: string): BlockResult | null {
  const opener = lines.current!;
  const indent = leadingSpaces(text, opener);
  if (indent > 3) return null;
  const markerStart = opener.start + indent;
  const markerCode = text.charCodeAt(markerStart);
  if (markerCode !== 0x60 && markerCode !== 0x7e) return null;
  const openerLength = runLength(text, markerStart, markerCode, opener.contentEnd);
  if (openerLength < 3) return null;

  // A backtick fence's info string may not contain a backtick (spec §2.4).
  // When the rest of the opener line does, this is not a fence at all — it is a
  // paragraph line whose leading `` ```+ `` opens an inline code span (closed by
  // a matching run later on the same line). Let it fall through to a paragraph.
  if (markerCode === 0x60) {
    for (let index = markerStart + openerLength; index < opener.contentEnd; index += 1) {
      if (text.charCodeAt(index) === 0x60) return null;
    }
  }

  let infoStart = markerStart + openerLength;
  while (infoStart < opener.contentEnd && isAsciiBlankCode(text.charCodeAt(infoStart))) infoStart += 1;
  let infoEnd = trimAsciiBlankEnd(text, infoStart, opener.contentEnd);
  const info = text.slice(infoStart, infoEnd);
  let infoValid = true;
  for (let index = infoStart; index < infoEnd; index += 1) {
    const code = text.charCodeAt(index);
    if (isAsciiBlankCode(code) || (markerCode === 0x60 && code === 0x60)) infoValid = false;
  }

  lines.advance();
  const contentStart = lines.current?.start ?? opener.end;
  let closer: PhysicalLine | null = null;
  let lastConsumed: PhysicalLine = opener;
  while (!lines.atEnd) {
    const candidate = lines.current!;
    const candidateIndent = leadingSpaces(text, candidate);
    if (candidateIndent <= 3) {
      const runStart = candidate.start + candidateIndent;
      const run = runLength(text, runStart, markerCode, candidate.contentEnd);
      if (
        run >= openerLength &&
        runStart + run <= candidate.contentEnd &&
        onlyAsciiBlank(text, runStart + run, candidate.contentEnd)
      ) {
        closer = candidate;
        lines.advance();
        break;
      }
    }
    lastConsumed = candidate;
    lines.advance();
  }
  const safeEnd = (closer ?? lastConsumed).contentEnd;
  if (!infoValid) {
    return { status: 'error', message: 'code fence info string must be one token', start: opener.start, safeEnd };
  }
  if (closer === null) {
    return { status: 'error', message: 'unclosed code fence', start: opener.start, safeEnd };
  }
  let valueEnd = closer.start;
  if (valueEnd > contentStart && text.charCodeAt(valueEnd - 1) === 0x0a) valueEnd -= 1;
  const value = text.slice(contentStart, valueEnd);
  const node: CodeBlock | MathBlock = info === 'math'
    ? { type: 'mathBlock', value }
    : { type: 'codeBlock', value, ...(info.length === 0 ? {} : { lang: info }) };
  return { status: 'ok', node, start: opener.start, end: closer.contentEnd, nodeCount: 1 };
}

function recognizeHorizontalRule(lines: LineReader, text: string): BlockResult | null {
  const line = lines.current!;
  const indent = leadingSpaces(text, line);
  if (indent > 3) return null;
  const suffix = splitSameLineId(text, line.start, line.contentEnd);
  const bodyEnd = suffix.bodyEnd;
  let marker = 0;
  let markerCount = 0;
  let mixed = false;
  for (let index = line.start + indent; index < bodyEnd; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0x20 || code === 0x09) continue;
    if (code !== 0x2d && code !== 0x2a) return null;
    markerCount += 1;
    if (marker === 0) marker = code;
    else if (marker !== code) mixed = true;
  }
  if (markerCount < 3) return null;
  lines.advance();
  if (suffix.error !== undefined) {
    return { status: 'error', message: suffix.error, start: line.start, safeEnd: line.contentEnd };
  }
  if (mixed) {
    return { status: 'error', message: 'mixed thematic-break characters', start: line.start, safeEnd: line.contentEnd };
  }
  const node: HorizontalRule = {
    type: 'horizontalRule',
    ...(suffix.id === undefined ? {} : { id: suffix.id }),
  };
  return { status: 'ok', node, start: line.start, end: line.contentEnd, nodeCount: 1 };
}

function recognizeHeading(
  lines: LineReader,
  text: string,
  annotations: SourceAnnotationBuilder,
): BlockResult | null {
  const line = lines.current!;
  const indent = leadingSpaces(text, line);
  if (indent > 3) return null;
  const markerStart = line.start + indent;
  let level = 0;
  while (markerStart + level < line.contentEnd && text.charCodeAt(markerStart + level) === 0x23) level += 1;
  if (level < 1 || level > 6) return null;
  const afterMarker = markerStart + level;
  if (afterMarker < line.contentEnd && text.charCodeAt(afterMarker) !== 0x20) return null;

  const suffix = splitSameLineId(text, line.start, line.contentEnd);
  lines.advance();
  if (suffix.error !== undefined) {
    return { status: 'error', message: suffix.error, start: line.start, safeEnd: line.contentEnd };
  }

  let contentEnd = trimAsciiBlankEnd(text, afterMarker, suffix.bodyEnd);
  let hashesStart = contentEnd;
  while (hashesStart > afterMarker && text.charCodeAt(hashesStart - 1) === 0x23) hashesStart -= 1;
  if (hashesStart < contentEnd && hashesStart > afterMarker && text.charCodeAt(hashesStart - 1) === 0x20) {
    contentEnd = trimAsciiBlankEnd(text, afterMarker, hashesStart - 1);
  }
  let contentStart = afterMarker;
  while (contentStart < contentEnd && text.charCodeAt(contentStart) === 0x20) contentStart += 1;
  if (contentEnd <= contentStart) {
    return { status: 'error', message: 'empty heading', start: line.start, safeEnd: line.contentEnd };
  }
  const inline = parseInline(text, contentStart, contentEnd, annotations);
  if (inline.status === 'error') return { status: 'error', message: inline.message, start: line.start, safeEnd: line.contentEnd, ...(inline.category === undefined ? {} : { category: inline.category }) };
  if (inline.nodes.length === 0) return { status: 'error', message: 'empty heading', start: line.start, safeEnd: line.contentEnd };
  const node: Heading = {
    type: 'heading',
    level: level as Heading['level'],
    children: inline.nodes as Heading['children'],
    ...(suffix.id === undefined ? {} : { id: suffix.id }),
  };
  return { status: 'ok', node, start: line.start, end: line.contentEnd, nodeCount: 1 + inline.nodeCount };
}

function recognizeParagraph(
  lines: LineReader,
  text: string,
  annotations: SourceAnnotationBuilder,
  stopAt?: (line: PhysicalLine) => boolean,
  context: ContainerContext = 'document',
): BlockResult {
  const consumed: PhysicalLine[] = [];
  while (!lines.atEnd) {
    const line = lines.current!;
    if (lines.isWhitespaceOnly(line)) break;
    if (stopAt !== undefined && stopAt(line)) break;
    if (parseStandaloneSuffix(text.slice(line.start, line.contentEnd)).kind !== 'not-suffix') break;
    if (consumed.length > 0 && context === 'document' && footnoteDefinitionContentStart(text, line) !== null) break;
    if (consumed.length > 0 && startsBlockResource(text, line, annotations)) break;
    const nextLine = lines.peek(1);
    if (consumed.length > 0 && nextLine !== null && startsTable(text, line, nextLine)) break;
    // Don't break the paragraph right before a line the boundary predicate
    // will stop at anyway — e.g. the enclosing lined container's own `___`
    // closer, where the current line is just the final body content line
    // (`A\nB\nC\n___` → one paragraph, not `A\nB` + `C`).
    const nextStops = nextLine !== null && stopAt !== undefined && stopAt(nextLine);
    if (
      consumed.length > 0 &&
      isLinedFenceLine(text, line) &&
      isLinedHeaderIntroducer(text.slice(consumed[0]!.start, consumed[0]!.contentEnd))
    ) break;
    // A typed lined-container header candidate followed by a `___` fence is an
    // unambiguous block start (spec §2.5); it interrupts the paragraph in
    // normal mode rather than being absorbed as a further text line.
    if (
      consumed.length > 0 &&
      nextLine !== null &&
      !nextStops &&
      isLinedFenceLine(text, nextLine) &&
      leadingSpaces(text, line) === 0 &&
      !isLinedFenceLine(text, line) &&
      !lines.isWhitespaceOnly(line) &&
      !isLinedHeaderIntroducer(text.slice(line.start, line.contentEnd))
    ) break;
    if (consumed.length > 0 && (startsQuote(text, line) || startsList(text, line) || startsComment(text, line) || startsFence(text, line) || startsHeading(text, line) || startsHorizontalRule(text, line))) break;
    if (consumed.length > 0 && isEqualsOnly(text, line)) {
      lines.advance();
      return { status: 'error', message: 'setext heading not permitted', start: consumed[0]!.start, safeEnd: line.contentEnd };
    }
    consumed.push(line);
    lines.advance();
  }
  const inline = parseParagraphInline(text, consumed, annotations);
  if (inline.status === 'error') return { status: 'error', message: inline.message, start: consumed[0]!.start, safeEnd: consumed[consumed.length - 1]!.contentEnd, ...(inline.category === undefined ? {} : { category: inline.category }) };
  const node: Paragraph = { type: 'paragraph', children: inline.children };
  return {
    status: 'ok',
    node,
    start: consumed[0]!.start,
    end: consumed[consumed.length - 1]!.contentEnd,
    nodeCount: 1 + inline.nodeCount,
  };
}

function isLinedFenceLine(text: string, line: PhysicalLine): boolean {
  if (leadingSpaces(text, line) !== 0) return false;
  const run = runLength(text, line.start, 0x5f, line.contentEnd);
  return run >= 3 && onlyAsciiBlank(text, line.start + run, line.contentEnd);
}

function isEqualsOnly(text: string, line: PhysicalLine): boolean {
  const indent = leadingSpaces(text, line);
  if (indent > 3) return false;
  let index = line.start + indent;
  let count = 0;
  while (index < line.contentEnd && text.charCodeAt(index) === 0x3d) {
    index += 1;
    count += 1;
  }
  if (count === 0) return false;
  return onlyAsciiBlank(text, index, line.contentEnd);
}

export function startsComment(text: string, line: PhysicalLine): boolean {
  const indent = leadingSpaces(text, line);
  return indent <= 3 && text.startsWith('<!--', line.start + indent);
}

export function startsFence(text: string, line: PhysicalLine): boolean {
  const indent = leadingSpaces(text, line);
  if (indent > 3) return false;
  const start = line.start + indent;
  const code = text.charCodeAt(start);
  if (code !== 0x60 && code !== 0x7e) return false;
  const run = runLength(text, start, code, line.contentEnd);
  if (run < 3) return false;
  // A backtick fence's info string may not contain a backtick (spec §2.4); with
  // one, the line is a paragraph whose leading `` ```+ `` opens an inline code
  // span, not a fence — so it does not interrupt an in-progress paragraph.
  if (code === 0x60) {
    for (let index = start + run; index < line.contentEnd; index += 1) {
      if (text.charCodeAt(index) === 0x60) return false;
    }
  }
  return true;
}

export function startsHorizontalRule(text: string, line: PhysicalLine): boolean {
  const indent = leadingSpaces(text, line);
  if (indent > 3) return false;
  const suffix = splitSameLineId(text, line.start, line.contentEnd);
  let count = 0;
  for (let index = line.start + indent; index < suffix.bodyEnd; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0x2d || code === 0x2a) count += 1;
    else if (code !== 0x20 && code !== 0x09) return false;
  }
  return count >= 3;
}

export function startsHeading(text: string, line: PhysicalLine): boolean {
  const indent = leadingSpaces(text, line);
  if (indent > 3) return false;
  let index = line.start + indent;
  let count = 0;
  while (index < line.contentEnd && text.charCodeAt(index) === 0x23) {
    index += 1;
    count += 1;
  }
  return count >= 1 && count <= 6 && (index === line.contentEnd || text.charCodeAt(index) === 0x20);
}

export function leadingSpaces(text: string, line: PhysicalLine): number {
  let count = 0;
  while (line.start + count < line.contentEnd && text.charCodeAt(line.start + count) === 0x20) count += 1;
  return count;
}

export function runLength(text: string, start: number, code: number, end: number): number {
  let count = 0;
  while (start + count < end && text.charCodeAt(start + count) === code) count += 1;
  return count;
}

export function isAsciiBlankCode(code: number): boolean {
  return code === 0x20 || code === 0x09;
}

export function onlyAsciiBlank(text: string, start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    if (!isAsciiBlankCode(text.charCodeAt(index))) return false;
  }
  return true;
}
