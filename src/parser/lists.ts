import type { List, ListItem, ListKind } from '../ast.js';
import { SourceAnnotationBuilder } from '../parser-contract.js';
import { LineMap, LineReader, type PhysicalLine } from '../source/index.js';
import type { BlockResult, ContainerContext } from './blocks.js';
import { parseBlockSequence } from './blocks.js';
import { transferAnnotations } from './annotation-transfer.js';

export interface ListMarker {
  readonly indent: number; readonly kind: ListKind; readonly contentStart: number;
  readonly number?: number; readonly task?: 'open' | 'done';
}
type MarkerResult = ListMarker | { readonly error: string } | null;

export function scanListMarker(text: string, line: PhysicalLine): MarkerResult {
  let cursor = line.start;
  while (cursor < line.contentEnd && text.charCodeAt(cursor) === 0x20) cursor += 1;
  if (text.charCodeAt(cursor) === 0x09) {
    // A tab in the indentation is a structural error only when a list marker
    // actually follows it. A bare `\t…` line is ordinary content — the tab is
    // literal running text (spec §7.4), not list indentation.
    let probe = cursor;
    while (probe < line.contentEnd && (text.charCodeAt(probe) === 0x09 || text.charCodeAt(probe) === 0x20)) probe += 1;
    const marker = text.charCodeAt(probe);
    const startsMarker = marker === 0x2d || marker === 0x2a || marker === 0x2b || marker === 0x3a || (marker >= 0x30 && marker <= 0x39);
    return startsMarker ? { error: 'tab in list indentation' } : null;
  }
  const indent = cursor - line.start;
  let kind: ListKind; let number: number | undefined;
  const code = text.charCodeAt(cursor);
  if (code === 0x2d || code === 0x2a || code === 0x2b || code === 0x3a) {
    if (code === 0x2d && text.charCodeAt(cursor + 1) === 0x2d) return null;
    if ((code === 0x2a || code === 0x2b) && cursor + 1 < line.contentEnd && text.charCodeAt(cursor + 1) !== 0x20) return null;
    kind = code === 0x3a ? 'definition' : 'unordered'; cursor += 1;
  } else if (code >= 0x30 && code <= 0x39) {
    const numberStart = cursor;
    while (cursor < line.contentEnd) { const digit = text.charCodeAt(cursor); if (digit < 0x30 || digit > 0x39) break; cursor += 1; }
    const delimiter = text.charCodeAt(cursor);
    if (delimiter !== 0x2e && delimiter !== 0x29) return null;
    const digits = text.slice(numberStart, cursor); cursor += 1;
    const normalized = stripZeros(digits);
    if (normalized.length > 9 || Number(normalized) > 999_999_999) return { error: 'ordered list number exceeds range' };
    number = Number(normalized); kind = 'ordered';
  } else return null;
  if (text.charCodeAt(cursor) !== 0x20) return { error: 'list marker requires exactly one space' };
  cursor += 1;
  if (cursor >= line.contentEnd || text.charCodeAt(cursor) === 0x20) return { error: kind === 'definition' ? 'invalid definition marker spacing' : 'empty list item' };
  let task: 'open' | 'done' | undefined;
  if (kind !== 'definition' && text.charCodeAt(cursor) === 0x5b && cursor + 2 < line.contentEnd && text.charCodeAt(cursor + 2) === 0x5d) {
    const state = text.charCodeAt(cursor + 1);
    if (state === 0x20 || state === 0x78 || state === 0x58) {
      if (text.charCodeAt(cursor + 3) !== 0x20 || cursor + 4 >= line.contentEnd) return { error: 'task marker requires one space and content' };
      task = state === 0x20 ? 'open' : 'done'; cursor += 4;
    }
  }
  return { indent, kind, contentStart: cursor, ...(number === undefined ? {} : { number }), ...(task === undefined ? {} : { task }) };
}

export function startsList(text: string, line: PhysicalLine): boolean { return scanListMarker(text, line) !== null; }

export function recognizeList(lines: LineReader, text: string, annotations: SourceAnnotationBuilder, context: ContainerContext): BlockResult | null {
  const opener = lines.current; if (opener === null) return null;
  const first = scanListMarker(text, opener); if (first === null) return null;
  if ('error' in first) { lines.advance(); return fail(first.error, opener.start, opener.contentEnd); }
  if (first.indent !== 0) {
    lines.advance();
    return fail(context === 'list-item' && first.indent === 2 ? 'list level rises by more than one' : 'list must start at level 1', opener.start, opener.contentEnd);
  }
  const kind = first.kind; const items: ListItem[] = [];
  let visiblePrevious = first.number ?? 1; let listEnd = opener.contentEnd; let nodeCount = 1;
  while (lines.current !== null) {
    const itemLine = lines.current; const marker = scanListMarker(text, itemLine);
    if (marker === null || 'error' in marker || marker.indent !== 0 || marker.kind !== kind) break;
    if (marker.kind === 'ordered' && marker.number === undefined) break;
    lines.advance();
    const rows: Array<{ line: PhysicalLine; start: number }> = [{ line: itemLine, start: marker.contentStart }];
    let afterBlank = false; let itemEnd = itemLine.contentEnd;
    while (lines.current !== null) {
      const line = lines.current;
      if (line.contentEnd === line.start) { afterBlank = true; rows.push({ line, start: line.start }); itemEnd = line.contentEnd; lines.advance(); continue; }
      const leading = leadingSpaces(text, line);
      if (text.charCodeAt(line.start + leading) === 0x09) { lines.advance(); return fail('tab in list indentation', opener.start, line.contentEnd); }
      const nextMarker = scanListMarker(text, line);
      if (nextMarker !== null && !('error' in nextMarker)) {
        if (nextMarker.indent === 0) break;
      }
      const indent = leadingSpaces(text, line);
      if (indent < 2) break;
      // After a blank line a further block joins the item only up to three
      // spaces past the content baseline; four or more would be an indented
      // code block in CommonMark, which Markanto does not represent, so the
      // item ends here and the line becomes an outer block (spec §9.6).
      if (afterBlank && indent >= 6) break;
      const strip = !afterBlank && (nextMarker === null || 'error' in nextMarker) && indent <= 5 ? indent : 2;
      rows.push({ line, start: line.start + strip }); itemEnd = line.contentEnd; lines.advance();
    }
    while (rows.length > 1 && rows.at(-1)!.line.contentEnd === rows.at(-1)!.line.start) rows.pop();
    itemEnd = rows.at(-1)!.line.contentEnd;
    const virtual = buildVirtual(rows, text);
    const builder = new SourceAnnotationBuilder('utf16-code-unit', { text: virtual.text, sourceMap: new LineMap(virtual.text), toSourceOffset: (offset) => offset });
    const parsed = parseBlockSequence(new LineReader(virtual.text), virtual.text, builder, () => false, 'list-item');
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
function leadingSpaces(text: string, line: PhysicalLine): number { let cursor = line.start; while (cursor < line.contentEnd && text.charCodeAt(cursor) === 0x20) cursor += 1; return cursor - line.start; }
function stripZeros(value: string): string { let index = 0; while (index + 1 < value.length && value.charCodeAt(index) === 0x30) index += 1; return value.slice(index); }
function fail(message: string, start: number, safeEnd: number, category: 'syntax' | 'semantic' = 'syntax'): BlockResult { return { status: 'error', message, start, safeEnd, category }; }
