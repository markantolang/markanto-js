import type { List, ListItem, ListKind } from '../ast.ts';
import { SourceAnnotationBuilder } from '../parser-contract.ts';
import { LineMap, LineReader, type PhysicalLine } from '../source/index.ts';
import type { BlockResult, ContainerContext, Advisory } from './blocks.ts';
import { isAsciiBlankCode, parseBlockSequence } from './blocks.ts';
import { codeFenceCloser, codeFenceOpener, commentClosesOnLine, commentContentStart } from './grid.ts';
import { transferAnnotations } from './annotation-transfer.ts';

const TASK_PREFIX_LENGTH = 4;

export interface ListMarker {
  readonly indent: number; readonly kind: ListKind; readonly contentStart: number;
  readonly number?: number; readonly task?: 'open' | 'done';
}
type MarkerResult = ListMarker | { readonly error: string } | null;

export function scanListMarker(text: string, line: PhysicalLine): MarkerResult {
  let cursor = line.start;
  while (cursor < line.contentEnd && text.charCodeAt(cursor) === 0x20) cursor += 1;
  if (text.charCodeAt(cursor) !== 0x09) return scanMarkerAt(text, line, cursor);
  // A tab in the indentation is error 9.5 only when a list marker follows it, an item's or one of the marker errors
  // of §9.13 (`\t- item`, `\t-x`): the structural error comes first (§7.4). Any other line is ordinary content whose
  // block reads the tab: `\t2026 report` and `\t*em*` are paragraphs, which drop it with the advisory of §1.2.
  let probe = cursor;
  while (probe < line.contentEnd && isAsciiBlankCode(text.charCodeAt(probe))) probe += 1;
  return scanMarkerAt(text, line, probe) === null ? null : { error: 'tab in list indentation' };
}

/** The list marker at `markerStart`, the first character after the line's indentation. */
function scanMarkerAt(text: string, line: PhysicalLine, markerStart: number): MarkerResult {
  let cursor = markerStart;
  const indent = cursor - line.start;
  let kind: ListKind; let number: number | undefined;
  const code = text.charCodeAt(cursor);
  if (code === 0x2d || code === 0x2a || code === 0x2b || code === 0x3a) {
    if (code === 0x2d && text.charCodeAt(cursor + 1) === 0x2d) return null;
    if ((code === 0x2a || code === 0x2b) && cursor + 1 < line.contentEnd && text.charCodeAt(cursor + 1) !== 0x20) return null;
    // `:::tldr`: a fence the container recogniser declined, since its name follows without a space (§2.7.5); the
    // line stays an error, said as what it most likely meant
    if (code === 0x3a && indent === 0) {
      let run = cursor;
      while (run < line.contentEnd && text.charCodeAt(run) === 0x3a) run += 1;
      if (run - cursor >= 3 && run < line.contentEnd && !isAsciiBlankCode(text.charCodeAt(run))) {
        return { error: "a fenced container's name follows its fence after a space" };
      }
    }
    kind = code === 0x3a ? 'definition' : 'unordered'; cursor += 1;
  } else if (code >= 0x30 && code <= 0x39) {
    const numberStart = cursor;
    while (cursor < line.contentEnd) { const digit = text.charCodeAt(cursor); if (digit < 0x30 || digit > 0x39) break; cursor += 1; }
    const delimiter = text.charCodeAt(cursor);
    if (delimiter !== 0x2e && delimiter !== 0x29) return null;
    // a digit after the delimiter makes a number, never a marker: `3.14`, `2.0` (§9.3.1)
    const next = text.charCodeAt(cursor + 1);
    if (cursor + 1 < line.contentEnd && next >= 0x30 && next <= 0x39) return null;
    const digits = text.slice(numberStart, cursor); cursor += 1;
    const normalized = stripZeros(digits);
    if (normalized.length > 9 || Number(normalized) > 999_999_999) return { error: 'ordered list number exceeds range' };
    number = Number(normalized); kind = 'ordered';
  } else return null;
  if (text.charCodeAt(cursor) !== 0x20) return { error: 'list marker requires a space after it' };
  // more than one space is read as one (§9.3); the content column lies after all of them (§9.4)
  while (cursor < line.contentEnd && text.charCodeAt(cursor) === 0x20) cursor += 1;
  if (cursor >= line.contentEnd) return { error: kind === 'definition' ? 'invalid definition marker spacing' : 'empty list item' };
  let task: 'open' | 'done' | undefined;
  if (kind !== 'definition' && text.charCodeAt(cursor) === 0x5b && cursor + 2 < line.contentEnd && text.charCodeAt(cursor + 2) === 0x5d) {
    const state = text.charCodeAt(cursor + 1);
    if (state === 0x20 || state === 0x78 || state === 0x58) {
      if (text.charCodeAt(cursor + 3) !== 0x20 || cursor + TASK_PREFIX_LENGTH >= line.contentEnd) return { error: 'task marker requires one space and content' };
      task = state === 0x20 ? 'open' : 'done'; cursor += TASK_PREFIX_LENGTH;
    }
  }
  return { indent, kind, contentStart: cursor, ...(number === undefined ? {} : { number }), ...(task === undefined ? {} : { task }) };
}

export function startsList(text: string, line: PhysicalLine): boolean { return scanListMarker(text, line) !== null; }

export function recognizeList(lines: LineReader, text: string, annotations: SourceAnnotationBuilder, context: ContainerContext, onAdvisory?: Advisory): BlockResult | null {
  const opener = lines.current; if (opener === null) return null;
  const first = scanListMarker(text, opener); if (first === null) return null;
  if ('error' in first) { lines.advance(); return fail(first.error, opener.start, opener.contentEnd); }
  if (first.indent !== 0) {
    lines.advance();
    return fail(`list marker indented ${spaces(first.indent)}: a list that is not nested in a list item starts without indentation`, opener.start, opener.contentEnd);
  }
  const kind = first.kind; const items: ListItem[] = [];
  // Item parsing is synchronous: one callback can use the current item's
  // projection instead of allocating another closure for every sibling.
  let itemSource: ReturnType<typeof buildVirtual>;
  const onItemAdvisory: Advisory | undefined = onAdvisory === undefined ? undefined
    : (message, start, end) => onAdvisory(message, itemSource.project(start), itemSource.project(end));
  let visiblePrevious = first.number ?? 1; let listEnd = opener.contentEnd; let nodeCount = 1;
  while (lines.current !== null) {
    const itemLine = lines.current; const marker = items.length === 0 ? first : scanListMarker(text, itemLine);
    if (marker === null || 'error' in marker || marker.indent !== 0 || marker.kind !== kind) break;
    if (marker.kind === 'ordered' && marker.number === undefined) break;
    lines.advance();
    const rows: Array<{ line: PhysicalLine; start: number }> = [{ line: itemLine, start: marker.contentStart }];
    // The item's base (§9.8): two spaces, or the column of its first nested marker when that stands on the content
    // column or four spaces in; a nested marker at two sets it back to two. A line below it ends the item.
    let base = 2;
    // The column of the open nested item, whose lines lose that column, so that it stands at 0 in the item's text.
    // It is the base unless a later nested marker stands on another column §9.4 reads (`1. A`, `   - B`, `    - C`).
    // Null before the first nested marker, and again after a line of this item has ended the nested list.
    let nested: number | null = null;
    let sawNested = false;
    let inComment = false;
    let literal: { char: number; length: number; strip: number } | null = null;
    let afterBlank = false; let itemEnd = itemLine.contentEnd;
    while (lines.current !== null) {
      const line = lines.current;
      if (line.contentEnd === line.start) { afterBlank = true; rows.push({ line, start: line.start }); itemEnd = line.contentEnd; lines.advance(); continue; }
      const leading = leadingSpaces(text, line);
      // Literal content loses only the structural prefix its opener lost. Its
      // indentation, tabs, and marker-looking text are not list syntax.
      if (literal !== null) {
        if (leading < literal.strip) break;
        const start = line.start + literal.strip;
        if (
          leading - literal.strip <= 3 &&
          text.charCodeAt(line.start + leading) === literal.char &&
          codeFenceCloser(text, { ...line, start }, literal.char, literal.length)
        ) literal = null;
        rows.push({ line, start }); itemEnd = line.contentEnd; lines.advance();
        continue;
      }
      const nextMarker = scanListMarker(text, line);
      const isMarker = nextMarker !== null && !('error' in nextMarker);
      if (isMarker && nextMarker.indent === 0) break;
      const indent = leading;
      let strip: number;
      if (isMarker && !inComment && indent >= 2) {
        if (nested !== null && indent >= nested + 2) strip = nested; // within the nested item, which reads it
        else {
          // a nested marker of this item, on a column §9.4 reads: two, the content column, or four spaces in;
          // the task prefix is not part of the content column
          const contentColumn = marker.contentStart - itemLine.start - (marker.task === undefined ? 0 : TASK_PREFIX_LENGTH);
          if (indent !== 2 && indent !== contentColumn && indent !== 4) {
            lines.advance();
            return fail(nestedIndentationMessage(indent, contentColumn), opener.start, line.contentEnd);
          }
          if (indent === 2) base = 2;
          else if (!sawNested) base = indent;
          sawNested = true; nested = indent; strip = indent;
        }
      } else {
        if (indent < base) break;
        // A line two or more spaces past the open nested marker goes to that item, with or without a blank line
        // before it, and the item reads it by the same rules with its own base (§9.8): a continuation line thus
        // continues the deepest open item it reaches (§9.6), and a block after a blank line is that item's.
        if (nested !== null && indent >= nested + 2) strip = nested;
        else if (!afterBlank && !isMarker && indent <= base + 3) {
          // A line of this item without a blank line before it: it loses all of its indentation, as a continuation
          // line does (§9.6). With a nested list open it stands below that item's base and ends the list (§9.9).
          strip = indent;
          if (!inComment) nested = null;
        } else {
          // A line of this item itself, below the nested item's base: it ends
          // the nested list. It keeps its surplus over the base, except that
          // with a nested list open two or three spaces become one, which the
          // nested item does not take and no block reads differently.
          strip = nested !== null && indent - base >= 2 ? indent - 1 : base;
          if (!inComment) nested = null;
        }
      }
      const start = line.start + strip;
      // A fence-looking line inside a comment is not a code/math opener.
      if (inComment) {
        if (commentClosesOnLine(text, line, start)) inComment = false;
      } else if (leading - strip <= 3) {
        // Only possible openers need a logical-line view. Ordinary prose and
        // deeply indented literal text need neither a copy nor a fence scan.
        const firstCode = text.charCodeAt(line.start + leading);
        if (firstCode === 0x60 || firstCode === 0x7e) {
          const fence = codeFenceOpener(text, { ...line, start });
          // its content loses what this line's owner strips: the nested item's column, or the base
          literal = fence === null ? null : { ...fence, strip: nested ?? base };
        } else if (firstCode === 0x3c) {
          const commentStart = commentContentStart(text, { ...line, start });
          if (commentStart >= 0) inComment = !commentClosesOnLine(text, line, commentStart);
        }
      }
      rows.push({ line, start: line.start + strip }); itemEnd = line.contentEnd; lines.advance();
    }
    while (rows.length > 1 && rows.at(-1)!.line.contentEnd === rows.at(-1)!.line.start) rows.pop();
    itemEnd = rows.at(-1)!.line.contentEnd;
    const virtual = buildVirtual(rows, text);
    itemSource = virtual;
    const builder = new SourceAnnotationBuilder('utf16-code-unit', { text: virtual.text, sourceMap: new LineMap(virtual.text), toSourceOffset: (offset) => offset });
    const parsed = parseBlockSequence(new LineReader(virtual.text), virtual.text, builder, () => false, 'list-item',
      onItemAdvisory);
    if (parsed.status === 'error') return { ...parsed, status: 'error', start: opener.start, safeEnd: itemEnd };
    if (parsed.blocks.length === 0 || parsed.blocks[0]!.type !== 'paragraph') return fail('list item must begin with inline paragraph', opener.start, itemEnd);
    for (const block of parsed.blocks) transferAnnotations(block, builder, annotations, virtual.project);
    const item: ListItem = {
      type: 'listItem',
      ...(kind === 'ordered' && items.length > 0 && marker.number !== visiblePrevious + 1 ? { value: marker.number } : {}),
      ...(marker.task === undefined ? {} : { task: marker.task }),
      children: parsed.blocks as ListItem['children'],
    };
    annotations.set(item, itemLine.start, itemEnd); items.push(item); nodeCount += parsed.nodeCount + 1;
    if (kind === 'ordered') visiblePrevious = marker.number!;
    listEnd = itemEnd;
  }
  if (items.length === 0) { const malformed = scanListMarker(text, lines.current ?? opener); if (malformed !== null && 'error' in malformed) { lines.advance(); return fail(malformed.error, opener.start, (lines.current ?? opener).contentEnd); } return null; }
  const node: List = { type: 'list', kind, ...(kind === 'ordered' && first.number !== 1 ? { start: first.number } : {}), items: items as List['items'] };
  annotations.set(node, opener.start, listEnd);
  return { status: 'ok', node, start: opener.start, end: listEnd, nodeCount };
}

function buildVirtual(rows: readonly { line: PhysicalLine; start: number }[], source: string): { text: string; project(offset: number): number } {
  let text = ''; const offsets: number[] = [];
  for (const row of rows) { for (let original = row.start; original < row.line.contentEnd; original += 1) { offsets[text.length] = original; text += source[original]!; } offsets[text.length] = row.line.contentEnd; if (row.line.terminated) { text += '\n'; offsets[text.length] = row.line.end; } }
  return { text, project: (offset) => offsets[offset] ?? rows.at(-1)!.line.contentEnd };
}
/** §7.8: how far the marker stands from its parent's, and the columns §9.4 reads there. */
function nestedIndentationMessage(indent: number, contentColumn: number): string {
  const columns = contentColumn === 2 || contentColumn === 4 ? 'two or four spaces in'
    : `two spaces in, on its content column ${contentColumn} spaces in, or four spaces in`;
  return `nested list marker indented ${spaces(indent)} from its parent's marker: a nested list is read ${columns}`;
}
function spaces(count: number): string { return count === 1 ? '1 space' : `${count} spaces`; }
function leadingSpaces(text: string, line: PhysicalLine): number { let cursor = line.start; while (cursor < line.contentEnd && text.charCodeAt(cursor) === 0x20) cursor += 1; return cursor - line.start; }
function stripZeros(value: string): string { let index = 0; while (index + 1 < value.length && value.charCodeAt(index) === 0x30) index += 1; return value.slice(index); }
function fail(message: string, start: number, safeEnd: number, category: 'syntax' | 'semantic' = 'syntax'): BlockResult { return { status: 'error', message, start, safeEnd, category }; }
