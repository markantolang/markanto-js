import type { Inline, Paragraph } from '../ast.js';
import type { SourceAnnotationBuilder } from '../parser-contract.js';
import type { PhysicalLine } from '../source/index.js';
import { parseInline, type SoftBreakBoundary } from './inline/scanner.js';
import { isUnicodeWhitespace } from './inline/unicode.js';

export type ParagraphInlineResult = { status: 'ok'; children: Paragraph['children']; nodeCount: number } |
  { status: 'error'; message: string; category?: 'syntax' | 'semantic' };

/** Parse one paragraph's physical slices; Phase 3+ reuses this entry point. */
export function parseParagraphInline(text: string, lines: readonly PhysicalLine[],
  annotations: SourceAnnotationBuilder): ParagraphInlineResult {
  const children: Inline[] = [];
  let nodeCount = 0;
  let chunkStart = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    // CommonMark 0.31.2 skips leading spaces of a paragraph line, and the
    // line-ending rule (§10.7) removes leading whitespace of a continuation
    // line. Markanto has no indented code, so a line indented four or more
    // spaces is still ordinary paragraph content with those spaces skipped —
    // never a `Text` value that begins with whitespace (spec §7.7 / §9.6).
    const lineStart = skipLeadingWs(text, line.start, line.contentEnd);
    const hasNext = index + 1 < lines.length;
    // `spaces` counts trailing ASCII 0x20 for the two-space hard-break rule
    // only; `effectiveEnd` removes *every* Unicode whitespace at the edge
    // (spec §7.7 — a break-adjacent / sequence-edge `Text` never carries it).
    const spaces = countTrailing(text, lineStart, line.contentEnd, 0x20);
    const effectiveEnd = trimTrailingWs(text, lineStart, line.contentEnd);
    let inlineEnd = effectiveEnd;
    let hard = false;
    if (hasNext) {
      if (spaces >= 2 && hasNonWhitespace(text, lineStart, effectiveEnd)) hard = true;
      else {
        const slashes = countTrailing(text, lineStart, effectiveEnd, 0x5c);
        if (slashes % 2 === 1 && hasNonWhitespace(text, lineStart, effectiveEnd - slashes)) {
          inlineEnd = trimTrailingWs(text, lineStart, effectiveEnd - 1);
          hard = true;
        }
      }
    }
    if (lines.length === 1 && equalsOnly(text, lineStart, inlineEnd)) {
      const node: Inline = { type: 'text', value: text.slice(lineStart, inlineEnd) };
      children.push(node); nodeCount += 1; annotations.set(node, lineStart, inlineEnd);
      continue;
    }
    if (!hard && hasNext) continue;

    const softBreaks = new Map<number, SoftBreakBoundary>();
    for (let inner = chunkStart; inner < index; inner += 1) {
      const current = lines[inner]!;
      const next = lines[inner + 1]!;
      const currentStart = skipLeadingWs(text, current.start, current.contentEnd);
      const currentEnd = trimTrailingWs(text, currentStart, current.contentEnd);
      const nextStart = skipLeadingWs(text, next.start, next.contentEnd);
      softBreaks.set(currentEnd, { next: nextStart, sourceStart: current.contentEnd, sourceEnd: current.end });
    }
    const firstStart = skipLeadingWs(text, lines[chunkStart]!.start, lines[chunkStart]!.contentEnd);
    const parsed = parseInline(text, firstStart, inlineEnd, annotations, { softBreaks });
    if (parsed.status === 'error') return parsed;
    children.push(...parsed.nodes); nodeCount += parsed.nodeCount;
    if (hard) {
      const node: Inline = { type: 'hardBreak' };
      children.push(node); nodeCount += 1;
      annotations.set(node, inlineEnd, effectiveEnd);
      chunkStart = index + 1;
    }
  }
  if (children.length === 0) return { status: 'error', message: 'empty paragraph' };
  return { status: 'ok', children: children as Paragraph['children'], nodeCount };
}

function equalsOnly(text: string, start: number, end: number): boolean {
  if (start === end) return false;
  for (let index = start; index < end; index += 1) if (text.charCodeAt(index) !== 0x3d) return false;
  return true;
}

function countTrailing(text: string, start: number, end: number, code: number): number {
  let count = 0;
  while (end - count > start && text.charCodeAt(end - count - 1) === code) count += 1;
  return count;
}

function skipLeadingWs(text: string, start: number, end: number): number {
  let cursor = start;
  while (cursor < end && isUnicodeWhitespace(text.charCodeAt(cursor))) cursor += 1;
  return cursor;
}

function trimTrailingWs(text: string, start: number, end: number): number {
  let cursor = end;
  while (cursor > start && isUnicodeWhitespace(text.charCodeAt(cursor - 1))) cursor -= 1;
  return cursor;
}

function hasNonWhitespace(text: string, start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    const code = text.charCodeAt(index);
    if (code !== 0x20 && code !== 0x09) return true;
  }
  return false;
}
