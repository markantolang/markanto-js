/**
 * GFM-near pipe tables (spec §12). Column recognition delegates every
 * "is this `|` inside an atomic inline token" decision to the shared
 * `atomicTokenEnd` scanner, so the row tokenizer and the inline scanner cannot
 * disagree: an unescaped `|` is a column delimiter only outside a `\|` escape
 * and outside a complete inline-code span, direct link/image, autolink, MIB
 * wrapper, `<m>` wrapper, or inline math. Cells are positional inline-only
 * content; `^` / `<` carry no span meaning. Table confirmation uses exactly one
 * line of lookahead (the separator row).
 */
import type { CellAlignment, Table, TableCell, TableRow } from '../ast.js';
import type { SourceAnnotationBuilder } from '../parser-contract.js';
import type { LineReader, PhysicalLine } from '../source/index.js';
import type { BlockResult } from './blocks.js';
import { parseInline } from './inline/scanner.js';
import { atomicTokenEnd } from './inline/atomic.js';
import { characterClass, codePointBefore } from './inline/unicode.js';
import { trimAsciiBlankEnd } from './block-id.js';

interface CellSpan { readonly start: number; readonly end: number }
interface RowScan {
  /** Offsets of the `|` characters that act as column delimiters. */
  readonly delimiters: readonly number[];
  readonly leadingEdge: boolean;
  readonly trailingEdge: boolean;
}

const EMPTY_ROW_SCAN: RowScan = Object.freeze({ delimiters: Object.freeze([]) as readonly number[], leadingEdge: false, trailingEdge: false });

/** Walk a row left to right, skipping atomic tokens, collecting real delimiters. */
function scanRow(text: string, start: number, end: number): RowScan {
  // A line with no `|` carries no table syntax — skip the per-character
  // atomic-token walk entirely (the overwhelmingly common case for prose).
  const firstPipe = text.indexOf('|', start);
  if (firstPipe < 0 || firstPipe >= end) return EMPTY_ROW_SCAN;

  let scan = start;
  let leadingEdge = false;
  if (scan < end && text.charCodeAt(scan) === 0x7c) { leadingEdge = true; scan += 1; }
  const delimiters: number[] = [];
  let trailingEdge = false;
  while (scan < end) {
    const code = text.charCodeAt(scan);
    if (code === 0x5c) { scan += scan + 1 < end ? 2 : 1; continue; }
    if (code === 0x7c) {
      if (scan + 1 === end) { trailingEdge = true; scan += 1; break; }
      delimiters.push(scan);
      scan += 1;
      continue;
    }
    const precededByWord = scan > start && characterClass(codePointBefore(text, scan, start)) === 'W';
    const tokenEnd = atomicTokenEnd(text, scan, end, precededByWord);
    scan = tokenEnd > scan ? tokenEnd : scan + 1;
  }
  return { delimiters, leadingEdge, trailingEdge };
}

/** Column-delimiter offsets to trimmed cell text spans, honouring escapes and atomic tokens. */
export function tokenizeRow(text: string, start: number, end: number): CellSpan[] {
  const scan = scanRow(text, start, end);
  const contentStart = scan.leadingEdge ? start + 1 : start;
  const contentEnd = scan.trailingEdge ? end - 1 : end;
  const spans: CellSpan[] = [];
  let cellStart = contentStart;
  for (const delimiter of scan.delimiters) {
    spans.push({ start: cellStart, end: delimiter });
    cellStart = delimiter + 1;
  }
  spans.push({ start: cellStart, end: contentEnd });
  return spans.map((span) => trim(text, span));
}

/** True when the row carries table syntax: a real delimiter or an edge pipe. */
export function looksLikeTableRow(text: string, line: PhysicalLine): boolean {
  const end = trimAsciiBlankEnd(text, line.start, line.contentEnd);
  const scan = scanRow(text, line.start, end);
  return scan.delimiters.length > 0 || scan.leadingEdge || scan.trailingEdge;
}

function trim(text: string, span: CellSpan): CellSpan {
  let { start, end } = span;
  while (start < end && isBlank(text.charCodeAt(start))) start += 1;
  while (end > start && isBlank(text.charCodeAt(end - 1))) end -= 1;
  return { start, end };
}

/** A separator row: every cell is `:?-+:?`. Returns the alignments or null. */
export function separatorAlignments(text: string, cells: readonly CellSpan[]): CellAlignment[] | null {
  const alignments: CellAlignment[] = [];
  for (const cell of cells) {
    let cursor = cell.start;
    const left = text.charCodeAt(cursor) === 0x3a;
    if (left) cursor += 1;
    const dashStart = cursor;
    while (cursor < cell.end && text.charCodeAt(cursor) === 0x2d) cursor += 1;
    if (cursor === dashStart) return null;
    const right = cursor < cell.end && text.charCodeAt(cursor) === 0x3a;
    if (right) cursor += 1;
    if (cursor !== cell.end) return null;
    alignments.push(left && right ? 'center' : left ? 'left' : right ? 'right' : 'default');
  }
  return alignments;
}

export function recognizeTable(
  lines: LineReader, text: string, annotations: SourceAnnotationBuilder,
): BlockResult | null {
  const header = lines.current;
  if (header === null || !looksLikeTableRow(text, header)) return null;
  const separatorLine = lines.peek(1);
  if (separatorLine === null || !looksLikeTableRow(text, separatorLine)) return null;

  const headerEnd = trimAsciiBlankEnd(text, header.start, header.contentEnd);
  const headerCells = tokenizeRow(text, header.start, headerEnd);
  const separatorCells = tokenizeRow(text, separatorLine.start, trimAsciiBlankEnd(text, separatorLine.start, separatorLine.contentEnd));
  const alignments = separatorAlignments(text, separatorCells);
  if (alignments === null) return null;

  lines.advance();
  lines.advance();
  let nodeCount = 1;

  // The separator on line 2 confirms the block (§12.3); a cell-count mismatch
  // against the header is then a syntax error, not a paragraph fallback.
  if (alignments.length !== headerCells.length) {
    return { status: 'error', message: 'table separator cell count differs from the header', start: header.start, safeEnd: separatorLine.contentEnd, category: 'syntax' };
  }

  type RowResult =
    | { readonly status: 'ok'; readonly row: TableRow; readonly count: number }
    | { readonly status: 'error'; readonly message: string; readonly category: 'syntax' | 'semantic'; readonly safeEnd: number };

  const cellRow = (line: PhysicalLine, cells: readonly CellSpan[]): RowResult => {
    const parsedCells: TableCell[] = [];
    let count = 0;
    for (const span of cells) {
      const parsed = parseInline(text, span.start, span.end, annotations);
      if (parsed.status === 'error') {
        return { status: 'error', message: parsed.message, category: parsed.category ?? 'syntax', safeEnd: line.contentEnd };
      }
      const cell: TableCell = { type: 'tableCell', children: parsed.nodes as TableCell['children'] };
      annotations.set(cell, span.start, span.end);
      parsedCells.push(cell);
      count += 1 + parsed.nodeCount;
    }
    const row: TableRow = { type: 'tableRow', cells: parsedCells };
    annotations.set(row, line.start, line.contentEnd);
    return { status: 'ok', row, count: count + 1 };
  };

  const head = cellRow(header, headerCells);
  if (head.status === 'error') {
    return { status: 'error', message: head.message, start: header.start, safeEnd: head.safeEnd, category: head.category };
  }
  nodeCount += head.count;

  const body: TableRow[] = [];
  let tableEnd = separatorLine.contentEnd;
  while (lines.current !== null) {
    const line = lines.current;
    if (line.contentEnd === line.start || !looksLikeTableRow(text, line)) break;
    const cells = tokenizeRow(text, line.start, trimAsciiBlankEnd(text, line.start, line.contentEnd));
    if (cells.length !== alignments.length) {
      lines.advance();
      return { status: 'error', message: 'table row cell count differs from the header', start: header.start, safeEnd: line.contentEnd, category: 'syntax' };
    }
    const parsed = cellRow(line, cells);
    if (parsed.status === 'error') {
      lines.advance();
      return { status: 'error', message: parsed.message, start: header.start, safeEnd: parsed.safeEnd, category: parsed.category };
    }
    body.push(parsed.row);
    nodeCount += parsed.count;
    tableEnd = line.contentEnd;
    lines.advance();
  }

  const node: Table = {
    type: 'table',
    alignments: alignments as Table['alignments'],
    head: head.row,
    body,
  };
  annotations.set(node, header.start, tableEnd);
  return { status: 'ok', node, start: header.start, end: tableEnd, nodeCount };
}

function isBlank(code: number): boolean { return code === 0x20 || code === 0x09; }
