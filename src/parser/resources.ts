import type {
  AudioBlock, DataAttributes, DocumentBlock, DownloadBlock, DownloadResourceAttributes,
  EmbedBlock, ImageBlock, ImageResourceAttributes, Inline, InlineWithoutBreak,
  Link, MediaResourceAttributes, MetadataSpanAttributes, VideoBlock,
} from '../ast.js';
import type { SourceAnnotationBuilder } from '../parser-contract.js';
import type { LineReader, PhysicalLine } from '../source/index.js';
import type { BlockResult, ContainerContext } from './blocks.js';
import { trimAsciiBlankEnd } from './block-id.js';
import { parseDirectResource, parseInline } from './inline/scanner.js';
import { codePointAt, isUnicodeWhitespace } from './inline/unicode.js';

export type MKind = 'video' | 'audio' | 'embed' | 'download';
export type AttributeContext = MKind | 'image' | 'generic';
export interface ParsedAttributes {
  readonly group?: string;
  readonly lang?: string;
  readonly preview?: string;
  readonly dataAttrs?: DataAttributes;
}
export type ResourceError = { readonly status: 'error'; readonly message: string; readonly category: 'syntax' | 'semantic' };
export type MOpenResult =
  | { readonly status: 'ok'; readonly kind: MKind | null; readonly attrs: ParsedAttributes; readonly end: number }
  | ResourceError;

export function normalizeGroup(value: string): string { return value.normalize('NFC'); }

export function parseMOpen(text: string, start: number, end: number): MOpenResult | null {
  if (!text.startsWith('<m', start) || start + 2 >= end) return null;
  let cursor = start + 2;
  if (text.charCodeAt(cursor) === 0x3e) return { status: 'ok', kind: null, attrs: {}, end: cursor + 1 };
  if (text.charCodeAt(cursor) !== 0x20) return null;
  cursor += 1;
  let kind: MKind | null = null;
  const values = new Map<string, string>();
  let first = true;
  while (cursor < end) {
    if (text.charCodeAt(cursor) === 0x3e) {
      const attrs = storedAttributes(values);
      return { status: 'ok', kind, attrs, end: cursor + 1 };
    }
    const tokenStart = cursor;
    while (cursor < end) {
      const code = text.charCodeAt(cursor);
      if (code === 0x3d || code === 0x20 || code === 0x3e) break;
      cursor += 1;
    }
    const key = text.slice(tokenStart, cursor);
    if (key.length === 0) return syntax('invalid resource opener spacing');
    if (first && text.charCodeAt(cursor) !== 0x3d) {
      if (isKind(key)) kind = key;
      else if (isKind(key.toLowerCase())) return syntax('resource kind must be lowercase');
      else return syntax('unknown resource attribute');
      first = false;
      if (text.charCodeAt(cursor) === 0x3e) return { status: 'ok', kind, attrs: {}, end: cursor + 1 };
      if (text.charCodeAt(cursor) !== 0x20) return syntax('invalid resource opener');
      cursor += 1;
      if (text.charCodeAt(cursor) === 0x3e) return syntax('trailing space in resource opener');
      continue;
    }
    first = false;
    if (!validAttributeKey(key)) return syntax('unknown resource attribute');
    if (values.has(key)) return syntax('duplicate resource attribute');
    if (text.charCodeAt(cursor) !== 0x3d) return syntax('resource attribute requires a value');
    cursor += 1;
    const valueResult = parseAttributeValue(text, cursor, end);
    if (valueResult.status === 'error') return valueResult;
    values.set(key, valueResult.value);
    cursor = valueResult.end;
    if (text.charCodeAt(cursor) === 0x3e) continue;
    if (text.charCodeAt(cursor) !== 0x20) return syntax('invalid resource attribute separator');
    cursor += 1;
    if (text.charCodeAt(cursor) === 0x3e) return syntax('trailing space in resource opener');
  }
  return syntax('unclosed resource opener');
}

function parseAttributeValue(text: string, start: number, end: number):
  { status: 'ok'; value: string; end: number } | ResourceError {
  if (start >= end) return syntax('empty bare resource attribute');
  if (text.charCodeAt(start) === 0x27) return syntax('single-quoted resource attributes are not supported');
  if (text.charCodeAt(start) === 0x22) {
    let cursor = start + 1;
    let value = '';
    while (cursor < end) {
      const code = text.charCodeAt(cursor);
      if (code === 0x22) return { status: 'ok', value, end: cursor + 1 };
      if (code === 0x0a || code === 0x0d) return syntax('resource attribute crosses physical line');
      if (code === 0x5c) {
        const next = text.charCodeAt(cursor + 1);
        if (next !== 0x22 && next !== 0x5c) return syntax('invalid quoted resource escape');
        value += text[cursor + 1]!; cursor += 2; continue;
      }
      const cp = codePointAt(text, cursor, end);
      value += String.fromCodePoint(cp); cursor += cp > 0xffff ? 2 : 1;
    }
    return syntax('unclosed quoted resource attribute');
  }
  let cursor = start;
  while (cursor < end) {
    const cp = codePointAt(text, cursor, end);
    if (cp === 0x20 || cp === 0x3e) break;
    if (isUnicodeWhitespace(cp) || cp === 0x22 || cp === 0x27 || cp === 0x5c || cp === 0x3c) {
      return syntax('invalid bare resource attribute');
    }
    cursor += cp > 0xffff ? 2 : 1;
  }
  if (cursor === start) return syntax('empty bare resource attribute');
  return { status: 'ok', value: text.slice(start, cursor), end: cursor };
}

function validAttributeKey(key: string): boolean {
  if (key === 'group' || key === 'lang' || key === 'preview') return true;
  if (!key.startsWith('data-') || key.length === 5) return false;
  const first = key.charCodeAt(5);
  if (first < 0x61 || first > 0x7a) return false;
  for (let index = 6; index < key.length; index += 1) {
    const code = key.charCodeAt(index);
    if (!((code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39) || code === 0x5f || code === 0x2d)) return false;
  }
  return true;
}

function storedAttributes(values: ReadonlyMap<string, string>): ParsedAttributes {
  const dataAttrs: DataAttributes = {};
  let group: string | undefined;
  let lang: string | undefined;
  let preview: string | undefined;
  for (const [key, value] of values) {
    if (key === 'group') group = normalizeGroup(value);
    else if (key === 'lang') lang = asciiLower(value);
    else if (key === 'preview') preview = value;
    else dataAttrs[key.slice(5)] = value;
  }
  return {
    ...(group === undefined ? {} : { group }),
    ...(lang === undefined ? {} : { lang }),
    ...(preview === undefined ? {} : { preview }),
    ...(Object.keys(dataAttrs).length === 0 ? {} : { dataAttrs }),
  };
}

export function validateAttributeContext(context: AttributeContext, attrs: ParsedAttributes): ResourceError | null {
  if (attrs.group !== undefined && attrs.group.length === 0) return semantic('resource group must be non-empty');
  if (attrs.lang !== undefined && !isWellFormedBcp47(attrs.lang)) return semantic('invalid BCP 47 language tag');
  if (attrs.preview !== undefined && !validDestinationValue(attrs.preview)) return semantic('invalid resource preview destination');
  if (context === 'generic' && (attrs.group !== undefined || attrs.preview !== undefined)) return semantic('attribute is not allowed on generic metadata');
  if (context === 'image' && attrs.preview !== undefined) return semantic('attribute is not allowed on image');
  if (context === 'download' && (attrs.group !== undefined || attrs.preview !== undefined)) return semantic('attribute is not allowed on download');
  return null;
}

export function isWellFormedBcp47(value: string): boolean {
  if (value.length === 0 || value.endsWith('-')) return false;
  const parts: string[] = [];
  let start = 0;
  for (let index = 0; index <= value.length; index += 1) {
    if (index !== value.length && value.charCodeAt(index) !== 0x2d) continue;
    const part = value.slice(start, index);
    if (part.length < 1 || part.length > 8 || !asciiAlnumString(part)) return false;
    parts.push(part); start = index + 1;
  }
  const first = parts[0]!;
  if (first === 'x' || first === 'i') return parts.length > 1;
  if (first.length < 2 || first.length > 8 || !asciiAlphaString(first)) return false;
  let index = 1;
  if (first.length <= 3) {
    let extlangs = 0;
    while (index < parts.length && parts[index]!.length === 3 && asciiAlphaString(parts[index]!) && extlangs < 3) { index += 1; extlangs += 1; }
  }
  if (index < parts.length && parts[index]!.length === 4 && asciiAlphaString(parts[index]!)) index += 1;
  if (index < parts.length && (parts[index]!.length === 2 && asciiAlphaString(parts[index]!) || parts[index]!.length === 3 && asciiDigitString(parts[index]!))) index += 1;
  while (index < parts.length && isVariant(parts[index]!)) index += 1;
  const singletons = new Set<string>();
  while (index < parts.length && parts[index]!.length === 1 && parts[index] !== 'x') {
    const singleton = parts[index]!;
    if (singletons.has(singleton)) return false;
    singletons.add(singleton); index += 1;
    const extensionStart = index;
    while (index < parts.length && parts[index]!.length >= 2) index += 1;
    if (index === extensionStart) return false;
  }
  if (index < parts.length && parts[index] === 'x') {
    index += 1;
    if (index >= parts.length) return false;
    while (index < parts.length) index += 1;
  }
  return index === parts.length;
}

export function recognizeBlockResource(
  lines: LineReader, text: string, annotations: SourceAnnotationBuilder, _context: ContainerContext,
): BlockResult | null {
  const line = lines.current;
  if (line === null) return null;
  // TODO Phase 5/6: strip leading logical-line indentation before whole-line
  // classification (§4.4).
  const firstEnd = trimAsciiBlankEnd(text, line.start, line.contentEnd);
  const bare = text.startsWith('![', line.start);
  const opened = bare ? null : parseMOpen(text, line.start, firstEnd);
  if (!bare && opened === null) return null;
  if (opened?.status === 'error') { lines.advance(); return blockError(opened, line.start, line.contentEnd); }

  const primaryStart = bare ? line.start : opened!.end;
  let primaryEnd = firstEnd;
  let wrapperCloseStart = -1;
  let captionLine: PhysicalLine | null = null;
  let captionStart = -1;
  let captionEnd = -1;
  if (!bare) {
    wrapperCloseStart = text.lastIndexOf('</m>', firstEnd);
    if (wrapperCloseStart < primaryStart || wrapperCloseStart + 4 !== firstEnd) {
      if (firstEnd > primaryStart && text.charCodeAt(firstEnd - 1) === 0x5c) {
        const next = lines.peek(1);
        const nextEnd = next === null ? -1 : trimAsciiBlankEnd(text, next.start, next.contentEnd);
        if (next !== null && text.charCodeAt(next.start) === 0x2a && text.endsWith('</m>', nextEnd)) {
          const close = nextEnd - 4;
          if (close > next.start + 1 && text.charCodeAt(close - 1) === 0x2a) {
            primaryEnd = firstEnd - 1; captionLine = next; captionStart = next.start + 1; captionEnd = close - 1;
          }
        }
      }
      if (captionLine === null) {
        // Kindless ordinary metadata is inline; typed wrappers are block-only errors.
        if (opened!.kind === null) return null;
        lines.advance(); return { status: 'error', message: 'unclosed <m> wrapper', start: line.start, safeEnd: line.contentEnd, category: 'syntax' };
      }
    } else primaryEnd = wrapperCloseStart;
  } else if (firstEnd > line.start && text.charCodeAt(firstEnd - 1) === 0x5c) {
    const next = lines.peek(1);
    const nextEnd = next === null ? -1 : trimAsciiBlankEnd(text, next.start, next.contentEnd);
    if (next !== null && nextEnd > next.start + 1 && text.charCodeAt(next.start) === 0x2a && text.charCodeAt(nextEnd - 1) === 0x2a) {
      primaryEnd = firstEnd - 1; captionLine = next; captionStart = next.start + 1; captionEnd = nextEnd - 1;
    } else if (next !== null && text.charCodeAt(next.start) === 0x2a) {
      lines.advance(); lines.advance();
      return { status: 'error', message: 'resource caption is single-line', start: line.start, safeEnd: next.contentEnd, category: 'syntax' };
    }
  }

  const expectedImage = bare || opened!.kind === null;
  const primary = parseDirectResource(text, primaryStart, primaryEnd, annotations, expectedImage, true);
  if (primary?.status === 'error') {
    consumeClaimedLines(lines, captionLine);
    return { status: 'error', message: primary.message, start: line.start, safeEnd: captionLine?.contentEnd ?? line.contentEnd, category: primary.category ?? 'syntax' };
  }
  if (primary === null || primary.end !== primaryEnd) {
    if (bare || opened!.kind === null) return null;
    consumeClaimedLines(lines, captionLine);
    return { status: 'error', message: primary === null ? 'typed resource requires one primary link' : 'extra text in typed resource', start: line.start, safeEnd: captionLine?.contentEnd ?? line.contentEnd, category: 'semantic' };
  }
  if (expectedImage !== (primary.node.type === 'inlineImage')) {
    consumeClaimedLines(lines, captionLine); return { status: 'error', message: 'resource primary type conflict', start: line.start, safeEnd: captionLine?.contentEnd ?? line.contentEnd, category: 'semantic' };
  }
  if (!bare && opened!.kind === null && !hasAttrs(opened!.attrs)) {
    // A kindless `<m>` around an image must carry image metadata (§4.2, §4.3);
    // an attribute-free wrapper adds no semantics.
    consumeClaimedLines(lines, captionLine);
    return { status: 'error', message: 'metadata wrapper adds no semantics', start: line.start, safeEnd: captionLine?.contentEnd ?? line.contentEnd, category: 'semantic' };
  }
  const context: AttributeContext = bare ? 'image' : opened!.kind ?? 'image';
  const attrs = bare ? {} : opened!.attrs;
  const attrError = validateAttributeContext(context, attrs);
  if (attrError !== null) { consumeClaimedLines(lines, captionLine); return blockError(attrError, line.start, captionLine?.contentEnd ?? line.contentEnd); }

  let caption: InlineWithoutBreak[] | undefined;
  let captionNodes = 0;
  if (captionLine !== null) {
    const parsed = parseInline(text, captionStart, captionEnd, annotations);
    if (parsed.status === 'error' || parsed.nodes.length === 0 || parsed.nodes.some((node) => node.type === 'softBreak' || node.type === 'hardBreak')) {
      lines.advance(); lines.advance();
      return { status: 'error', message: parsed.status === 'error' ? parsed.message : 'invalid resource caption', start: line.start, safeEnd: captionLine.contentEnd, category: parsed.status === 'error' ? parsed.category ?? 'syntax' : 'semantic' };
    }
    caption = parsed.nodes as InlineWithoutBreak[]; captionNodes = parsed.nodeCount;
  }
  const node = makeBlock(opened?.kind ?? null, primary.node, attrs, caption) as DocumentBlock;
  lines.advance();
  if (captionLine !== null) lines.advance();
  annotations.set(node, line.start, captionLine?.contentEnd ?? line.contentEnd);
  return { status: 'ok', node, start: line.start, end: captionLine?.contentEnd ?? line.contentEnd, nodeCount: 1 + primary.nested + captionNodes };
}

/**
 * Reader-wise probe used to terminate a preceding paragraph. Parsing the
 * candidate may annotate throwaway nodes in the builder's WeakMap.
 */
export function startsBlockResource(text: string, line: PhysicalLine, annotations: SourceAnnotationBuilder): boolean {
  const lineEnd = trimAsciiBlankEnd(text, line.start, line.contentEnd);
  const bare = text.startsWith('![', line.start);
  const open = bare ? null : parseMOpen(text, line.start, lineEnd);
  if (!bare && open === null) return false;
  if (open?.status === 'error') return true;
  let primaryEnd = lineEnd;
  if (text.charCodeAt(primaryEnd - 1) === 0x5c) primaryEnd -= 1;
  if (!bare) {
    const close = text.lastIndexOf('</m>', lineEnd);
    if (close >= open!.end && close + 4 === lineEnd) primaryEnd = close;
    else if (primaryEnd === lineEnd) return false;
  }
  const image = bare || open!.kind === null;
  const primary = parseDirectResource(text, bare ? line.start : open!.end, primaryEnd, annotations, image, true);
  if (primary?.status === 'error') return true;
  if (primary === null || primary.end !== primaryEnd) return !bare && open!.kind !== null;
  return true;
}

function makeBlock(kind: MKind | null, primary: import('../ast.js').InlineImage | Link, attrs: ParsedAttributes, caption?: InlineWithoutBreak[]): ImageBlock | VideoBlock | AudioBlock | EmbedBlock | DownloadBlock {
  const cap = caption === undefined ? {} : { caption: caption as [InlineWithoutBreak, ...InlineWithoutBreak[]] };
  if (primary.type === 'inlineImage') return { type: 'imageBlock', src: primary.src, alt: primary.alt, ...(primary.title === undefined ? {} : { title: primary.title }), ...cap, ...(hasAttrs(attrs) ? { attrs: attrs as ImageResourceAttributes } : {}) };
  const base = { ...(primary.title === undefined ? {} : { title: primary.title }), ...cap };
  if (kind === 'video') return { type: 'videoBlock', src: primary.href, label: primary.children, ...base, ...(hasAttrs(attrs) ? { attrs: attrs as MediaResourceAttributes } : {}) };
  if (kind === 'audio') return { type: 'audioBlock', src: primary.href, label: primary.children, ...base, ...(hasAttrs(attrs) ? { attrs: attrs as MediaResourceAttributes } : {}) };
  if (kind === 'embed') return { type: 'embedBlock', target: primary.href, label: primary.children, ...base, ...(hasAttrs(attrs) ? { attrs: attrs as MediaResourceAttributes } : {}) };
  return { type: 'downloadBlock', href: primary.href, label: primary.children, ...base, ...(hasAttrs(attrs) ? { attrs: attrs as DownloadResourceAttributes } : {}) };
}

function consumeClaimedLines(lines: LineReader, captionLine: PhysicalLine | null): void { lines.advance(); if (captionLine !== null) lines.advance(); }

export function hasAttrs(attrs: ParsedAttributes): boolean {
  return attrs.group !== undefined || attrs.lang !== undefined || attrs.preview !== undefined || attrs.dataAttrs !== undefined;
}
function isKind(value: string): value is MKind { return value === 'video' || value === 'audio' || value === 'embed' || value === 'download'; }
function asciiLower(value: string): string { let out = ''; for (let i = 0; i < value.length; i += 1) { const c = value.charCodeAt(i); out += String.fromCharCode(c >= 0x41 && c <= 0x5a ? c + 0x20 : c); } return out; }
function asciiAlphaString(value: string): boolean { for (let i = 0; i < value.length; i += 1) { const c = value.charCodeAt(i); if (!((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a))) return false; } return true; }
function asciiDigitString(value: string): boolean { for (let i = 0; i < value.length; i += 1) { const c = value.charCodeAt(i); if (c < 0x30 || c > 0x39) return false; } return true; }
function asciiAlnumString(value: string): boolean { for (let i = 0; i < value.length; i += 1) { const c = value.charCodeAt(i); if (!((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a))) return false; } return true; }
function isVariant(value: string): boolean { return value.length >= 5 && value.length <= 8 || value.length === 4 && value.charCodeAt(0) >= 0x30 && value.charCodeAt(0) <= 0x39; }
function validDestinationValue(value: string): boolean { for (let i = 0; i < value.length; i += 1) { const c = value.charCodeAt(i); if ((c <= 0x1f && c !== 0x09) || (c >= 0x7f && c <= 0x9f)) return false; } return true; }
function syntax(message: string): ResourceError { return { status: 'error', message, category: 'syntax' }; }
function semantic(message: string): ResourceError { return { status: 'error', message, category: 'semantic' }; }
function blockError(error: ResourceError, start: number, safeEnd: number): BlockResult { return { status: 'error', message: error.message, category: error.category, start, safeEnd }; }
