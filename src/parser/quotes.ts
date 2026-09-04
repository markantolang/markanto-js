import type { DocumentBlock, InlineWithoutBreak, QuoteBlock, QuoteRegion } from '../ast.js';
import { SourceAnnotationBuilder } from '../parser-contract.js';
import { LineMap, LineReader, type PhysicalLine } from '../source/index.js';
import type { BlockResult, ContainerContext } from './blocks.js';
import { parseBlockSequence } from './blocks.js';
import { parseInline } from './inline/scanner.js';
import { transferAnnotations } from './annotation-transfer.js';

export interface QuotePrefix { readonly depth: number; readonly contentStart: number; readonly empty: boolean }
type PrefixResult = QuotePrefix | { readonly error: string } | null;

/** A `>` at column 0 — an unambiguous quote-region start (spec §2.5, §3.2). */
export function startsQuote(text: string, line: PhysicalLine): boolean {
  return text.charCodeAt(line.start) === 0x3e;
}

export function scanQuotePrefix(text: string, line: PhysicalLine): PrefixResult {
  let cursor = line.start;
  if (text.charCodeAt(cursor) !== 0x3e) return null;
  let depth = 0;
  while (cursor < line.contentEnd && text.charCodeAt(cursor) === 0x3e) {
    depth += 1; cursor += 1;
    if (text.charCodeAt(cursor) === 0x09) return { error: 'tab in quote prefix' };
    if (text.charCodeAt(cursor) === 0x20) cursor += 1;
  }
  return { depth, contentStart: cursor, empty: cursor === line.contentEnd };
}

export function recognizeQuote(lines: LineReader, text: string, annotations: SourceAnnotationBuilder, _context: ContainerContext): BlockResult | null {
  const opener = lines.current;
  if (opener === null) return null;
  const first = scanQuotePrefix(text, opener);
  if (first === null) return null;
  if ('error' in first) { lines.advance(); return error(first.error, opener.start, opener.contentEnd); }
  if (first.depth !== 1) { lines.advance(); return error('quote must start at depth 1', opener.start, opener.contentEnd); }

  const scanned: Array<{ line: PhysicalLine; prefix: QuotePrefix }> = [];
  let currentDepth = 1;
  while (lines.current !== null) {
    const line = lines.current;
    const prefix = scanQuotePrefix(text, line);
    if (prefix === null) break;
    if ('error' in prefix) { lines.advance(); return error(prefix.error, opener.start, line.contentEnd); }
    if (prefix.empty) {
      if (prefix.depth > currentDepth) { lines.advance(); return error('empty quote line opens a deeper level', opener.start, line.contentEnd); }
    } else {
      if (prefix.depth > currentDepth + 1) { lines.advance(); return error('quote depth rises by more than one', opener.start, line.contentEnd); }
      currentDepth = prefix.depth;
    }
    scanned.push({ line, prefix }); lines.advance();
  }

  const children: QuoteBlock[] = [];
  let nodeCount = 1;
  for (let index = 0; index < scanned.length;) {
    const depth = scanned[index]!.prefix.depth;
    let end = index + 1;
    while (end < scanned.length && scanned[end]!.prefix.depth === depth) end += 1;
    const run = buildVirtual(scanned.slice(index, end), text);
    const virtualLines = new LineReader(run.text);
    const virtualBuilder = new SourceAnnotationBuilder('utf16-code-unit', {
      text: run.text, sourceMap: new LineMap(run.text), toSourceOffset: (offset) => offset,
    });
    const parsed = parseBlockSequence(virtualLines, run.text, virtualBuilder, () => false, 'quote');
    if (parsed.status === 'error') return { ...parsed, status: 'error', start: opener.start, safeEnd: scanned[end - 1]!.line.contentEnd };
    nodeCount += parsed.nodeCount;
    for (const block of parsed.blocks) {
      transferAnnotations(block, virtualBuilder, annotations, run.project);
      const blockAnnotation = virtualBuilder.forNode(block);
      const quoteBlock: QuoteBlock = { level: depth, block: block as QuoteBlock['block'] };
      if (blockAnnotation !== undefined) annotations.set(quoteBlock, run.project(blockAnnotation.range.start.offset), run.project(blockAnnotation.range.end.offset));
      children.push(quoteBlock); nodeCount += 1;
    }
    index = end;
  }
  if (children.length === 0) return error('empty quote region', opener.start, scanned.at(-1)!.line.contentEnd, 'semantic');

  let attribution: InlineWithoutBreak[] | undefined;
  let regionEnd = scanned.at(-1)!.line.contentEnd;
  const postfix = lines.current;
  if (postfix !== null && text.startsWith('-- ', postfix.start) && postfix.start + 3 < postfix.contentEnd) {
    const parsed = parseInline(text, postfix.start + 3, postfix.contentEnd, annotations);
    if (parsed.status === 'error' || parsed.nodes.length === 0 || parsed.nodes.some((node) => node.type === 'softBreak' || node.type === 'hardBreak')) {
      lines.advance(); return error(parsed.status === 'error' ? parsed.message : 'invalid quote attribution', opener.start, postfix.contentEnd, parsed.status === 'error' ? parsed.category ?? 'syntax' : 'semantic');
    }
    attribution = parsed.nodes as InlineWithoutBreak[]; nodeCount += parsed.nodeCount; regionEnd = postfix.contentEnd; lines.advance();
  }
  const node: QuoteRegion = attribution === undefined
    ? { type: 'quoteRegion', children: children as QuoteRegion['children'] }
    : { type: 'quoteRegion', children: children as QuoteRegion['children'], attribution: attribution as NonNullable<QuoteRegion['attribution']> };
  annotations.set(node, opener.start, regionEnd);
  return { status: 'ok', node, start: opener.start, end: regionEnd, nodeCount };
}

function buildVirtual(rows: readonly { line: PhysicalLine; prefix: QuotePrefix }[], source: string): { text: string; project(offset: number): number } {
  let text = '';
  const offsets: number[] = [];
  for (const { line, prefix } of rows) {
    for (let original = prefix.contentStart; original < line.contentEnd; original += 1) { offsets[text.length] = original; text += source[original]!; }
    offsets[text.length] = line.contentEnd;
    if (line.terminated) { text += '\n'; offsets[text.length] = line.end; }
  }
  return { text, project: (offset) => offsets[offset] ?? rows.at(-1)!.line.contentEnd };
}

function error(message: string, start: number, safeEnd: number, category: 'syntax' | 'semantic' = 'syntax'): BlockResult {
  return { status: 'error', message, start, safeEnd, category };
}
