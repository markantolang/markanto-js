import type { DownloadResourceAttributes, ImageResourceAttributes, Inline, InlineImage, Link, MetadataSpanAttributes, Text } from '../../ast.js';
import type { SourceAnnotationBuilder } from '../../parser-contract.js';
import { hasAttrs, parseMOpen, validateAttributeContext } from '../resources.js';
import { isEmailAutolink, isUrlAutolink, metadataClose, wrapperClose } from './atomic.js';
import { scanEntity } from './entities.js';
import { characterClass, codePointAt, codePointBefore, isUnicodeWhitespace } from './unicode.js';

type Kind = 'em' | 'strong' | 'deletion' | 'obsolete' | 'insert' | 'mark';

/**
 * ASCII bytes that can begin an inline construct or close an open frame. A byte
 * that is not flagged here (and every non-ASCII code unit) is ordinary text and
 * is consumed in bulk by the scanner's fast path. Keep in sync with the
 * per-character checks in `parseInline`.
 */
const INLINE_SIGNIFICANT = (() => {
  const table = new Uint8Array(128);
  for (const ch of '\\`$![<&*_~+-=^h') table[ch.charCodeAt(0)] = 1;
  return table;
})();
const DELIMITERS = ['**', '__', '~~', '--', '++', '==', '*', '_'] as const;
interface Frame { kind: Kind | 'root'; delimiter: string; start: number; nodes: Inline[] }
export interface SoftBreakBoundary { next: number; sourceStart: number; sourceEnd: number }
export interface InlineContext {
  insideLink?: boolean;
  ancestors?: ReadonlySet<Kind>;
  softBreaks?: ReadonlyMap<number, SoftBreakBoundary>;
}
export type InlineResult = { status: 'ok'; nodes: Inline[]; nodeCount: number } |
  { status: 'error'; message: string; category?: 'syntax' | 'semantic' };

export function parseInline(text: string, start: number, end: number,
  annotations: SourceAnnotationBuilder, context: InlineContext = {}): InlineResult {
  const frames: Frame[] = [{ kind: 'root', delimiter: '', start, nodes: [] }];
  const textStarts = new WeakMap<object, number>();
  const textEnds = new WeakMap<object, number>();
  let cursor = start;
  let nodeCount = 0;
  const append = (node: Inline, from: number, to: number): void => {
    const nodes = frames[frames.length - 1]!.nodes;
    const last = nodes[nodes.length - 1];
    if (node.type === 'text' && last?.type === 'text') {
      last.value += node.value;
      annotations.set(last, textStarts.get(last) ?? from, to);
      textEnds.set(last, to);
      return;
    }
    if (node.type === 'text') { textStarts.set(node, from); textEnds.set(node, to); }
    nodes.push(node); annotations.set(node, from, to); nodeCount += 1;
  };
  const recoverTopFrame = (): void => {
    const frame = frames.pop()!;
    const parent = frames[frames.length - 1]!;
    const opener: Text = { type: 'text', value: frame.delimiter };
    textStarts.set(opener, frame.start);
    textEnds.set(opener, frame.start + frame.delimiter.length);
    annotations.set(opener, frame.start, frame.start + frame.delimiter.length);
    nodeCount += 1;
    for (const node of [opener, ...frame.nodes]) {
      const last = parent.nodes[parent.nodes.length - 1];
      if (last?.type === 'text' && node.type === 'text') {
        last.value += node.value;
        const to = textEnds.get(node) ?? frame.start + frame.delimiter.length;
        annotations.set(last, textStarts.get(last) ?? frame.start, to);
        textEnds.set(last, to);
        nodeCount -= 1;
      } else {
        parent.nodes.push(node);
      }
    }
  };

  while (cursor < end) {
    const top = frames[frames.length - 1]!;
    const softBreak = context.softBreaks?.get(cursor);
    if (softBreak !== undefined) {
      while (frames.length > 1) {
        const active = frames[frames.length - 1]!;
        if (active.kind !== 'obsolete' && active.kind !== 'insert' && active.kind !== 'mark') break;
        recoverTopFrame();
      }
      append({ type: 'softBreak' }, softBreak.sourceStart, softBreak.sourceEnd);
      cursor = softBreak.next;
      continue;
    }
    if (top.kind !== 'root' && at(text, cursor, end, top.delimiter) && canClose(text, cursor, top.delimiter, start, end)) {
      const longer = delimiterAt(text, cursor, end);
      if (longer !== null && longer !== top.delimiter && frames.some((frame, index) =>
        index > 0 && index + 1 < frames.length && frame.delimiter === longer
      ) && (longer[0] !== top.delimiter[0] || run(text, cursor, end, text.charCodeAt(cursor)) < longer.length + top.delimiter.length)) {
        return error('overlapping inline tokens');
      }
      if (top.nodes.length === 0) return error('empty inline token');
      frames.pop();
      const closeEnd = cursor + top.delimiter.length;
      append(wrap(top.kind, top.nodes), top.start, closeEnd);
      cursor = closeEnd; continue;
    }
    const code = text.charCodeAt(cursor);

    // Fast path: consume a run of ordinary text in one slice. Only bytes flagged
    // in `INLINE_SIGNIFICANT` can start a construct or close `top`.
    if (code >= 0x80 || INLINE_SIGNIFICANT[code] === 0) {
      let run = cursor + 1;
      while (run < end) {
        const c = text.charCodeAt(run);
        if (context.softBreaks?.has(run) === true || c < 0x80 && INLINE_SIGNIFICANT[c] === 1) break;
        run += 1;
      }
      append({ type: 'text', value: text.slice(cursor, run) }, cursor, run);
      cursor = run;
      continue;
    }

    if (code === 0x5c) {
      if (cursor + 1 < end && escapable(text.charCodeAt(cursor + 1))) {
        append({ type: 'text', value: text[cursor + 1]! }, cursor, cursor + 2); cursor += 2;
      } else { append({ type: 'text', value: '\\' }, cursor, cursor + 1); cursor += 1; }
      continue;
    }
    if (code === 0x60) {
      const result = codeSpan(text, cursor, end, context.softBreaks);
      if (result.status === 'error') return result;
      append({ type: 'inlineCode', value: result.value }, cursor, result.end); cursor = result.end; continue;
    }
    if (at(text, cursor, end, '$`')) {
      const close = find(text, cursor + 2, end, '`$');
      if (close < 0) return error('unclosed inline math');
      if (hasSoftBreakBetween(context.softBreaks, cursor + 2, close)) return error('inline math cannot contain a soft break');
      if (close === cursor + 2) return error('empty inline math');
      append({ type: 'inlineMath', value: text.slice(cursor + 2, close) }, cursor, close + 2);
      cursor = close + 2; continue;
    }
    if (at(text, cursor, end, '![') || code === 0x5b) {
      const result = link(text, cursor, end, annotations, context);
      if (result?.status === 'error') return result;
      if (result?.status === 'ok') {
        append(result.node, cursor, result.end); nodeCount += result.nested; cursor = result.end; continue;
      }
    }
    if (code === 0x3c) {
      const result = mib(text, cursor, end, annotations, {
        ...context,
        ...(top.kind === 'root' ? {} : { ancestors: new Set<Kind>([top.kind]) }),
      });
      if (result?.status === 'error') return result;
      if (result?.status === 'ok') {
        append(result.node, cursor, result.end); nodeCount += result.nested; cursor = result.end; continue;
      }
      const metadata = metadataWrapper(text, cursor, end, annotations, context);
      if (metadata?.status === 'error') return metadata;
      if (metadata?.status === 'ok') {
        append(metadata.node, cursor, metadata.end); nodeCount += metadata.nested; cursor = metadata.end; continue;
      }
      const auto = bracketAutolink(text, cursor, end);
      if (auto !== null) {
        if (context.insideLink === true) return error('nested autolink');
        append(auto.node, cursor, auto.end); cursor = auto.end; continue;
      }
    }
    if ((at(text, cursor, end, 'http://') || at(text, cursor, end, 'https://')) &&
        characterClass(codePointBefore(text, cursor, start)) !== 'W') {
      const result = bareAutolink(text, cursor, end);
      if (result.status === 'error') return result;
      if (context.insideLink === true) return error('nested autolink');
      append({ type: 'autolink', kind: 'url', value: result.value }, cursor, result.end);
      cursor = result.end; continue;
    }
    if (at(text, cursor, end, '[^')) {
      const close = footnote(text, cursor, end);
      if (close > 0) {
        if (context.insideLink === true) return error('nested footnote reference');
        const nodes = frames[frames.length - 1]!.nodes;
        const previous = nodes[nodes.length - 1];
        if (previous?.type === 'text') {
          let triviaStart = cursor;
          while (triviaStart > start && blank(text.charCodeAt(triviaStart - 1))) triviaStart -= 1;
          const triviaLength = cursor - triviaStart;
          if (triviaLength > 0 && previous.value.length >= triviaLength) {
            previous.value = previous.value.slice(0, -triviaLength);
            if (previous.value.length === 0) { nodes.pop(); nodeCount -= 1; }
            else {
              annotations.set(previous, textStarts.get(previous) ?? triviaStart, triviaStart);
              // Keep the scanner's own end index in step with the trimmed range;
              // `recoverTopFrame` reads `textEnds` when an enclosing delimiter
              // frame turns literal, and a stale value would over-report the span.
              textEnds.set(previous, triviaStart);
            }
          }
        }
        append({ type: 'footnoteReference', identifier: text.slice(cursor + 2, close - 1) }, cursor, close);
        cursor = close; continue;
      }
    }
    if (code === 0x26) {
      const result = scanEntity(text, cursor, end);
      if (result.kind === 'error') return error(result.message);
      if (result.kind === 'decoded') { append({ type: 'text', value: result.value }, cursor, result.end); cursor = result.end; continue; }
    }
    if (code === 0x5e || (code === 0x7e && !at(text, cursor, end, '~~'))) {
      const result = atomic(text, cursor, end, code);
      if (result !== null) {
        append(code === 0x5e ? { type: 'sup', value: result.value } : { type: 'sub', value: result.value }, cursor, result.end);
        cursor = result.end; continue;
      }
      append({ type: 'text', value: text[cursor]! }, cursor, cursor + 1); cursor += 1; continue;
    }

    if (code === 0x5f) {
      const underscoreRun = literalUnderscoreRun(text, cursor, end);
      if (underscoreRun > 0) {
        // Spec §10.8: an escaped `_` inside a run of three or more underscores
        // makes the whole run literal text (`\___`, `_\__`, `__\_` -> `___`).
        // The closer check above already ran, so this cannot swallow a closer.
        let value = '';
        for (let index = cursor; index < cursor + underscoreRun; index += 1) {
          if (text.charCodeAt(index) !== 0x5c) value += '_';
        }
        append({ type: 'text', value }, cursor, cursor + underscoreRun);
        cursor += underscoreRun;
        continue;
      }
    }

    const delimiter = delimiterAt(text, cursor, end);
    if (delimiter !== null) {
      const lowerCloser = frames.some((frame, index) => index + 1 < frames.length &&
        frame.delimiter === delimiter && canClose(text, cursor, delimiter, start, end));
      if (lowerCloser) return error('overlapping inline tokens');
      if (canOpen(text, cursor, delimiter, start, end)) {
        const kind = delimiterKind(delimiter);
        if (top.kind === kind || top.kind === 'root' && context.ancestors?.has(kind) === true) return error('same-kind direct inline nesting');
        frames.push({ kind, delimiter, start: cursor, nodes: [] }); cursor += delimiter.length; continue;
      }
      if (delimiter.length > 1) {
        append({ type: 'text', value: delimiter }, cursor, cursor + delimiter.length);
        cursor += delimiter.length;
        continue;
      }
    }
    append({ type: 'text', value: text[cursor]! }, cursor, cursor + 1); cursor += 1;
  }
  while (frames.length > 1) recoverTopFrame();
  return { status: 'ok', nodes: frames[0]!.nodes, nodeCount };
}

function codeSpan(text: string, start: number, end: number,
  softBreaks?: ReadonlyMap<number, SoftBreakBoundary>): { status: 'ok'; value: string; end: number } | { status: 'error'; message: string } {
  const length = run(text, start, end, 0x60);
  let cursor = start + length;
  let value = '';
  let segmentStart = cursor;
  while (cursor < end) {
    const softBreak = softBreaks?.get(cursor);
    if (softBreak !== undefined) {
      value += `${text.slice(segmentStart, cursor)} `;
      cursor = softBreak.next;
      segmentStart = cursor;
      continue;
    }
    if (text.charCodeAt(cursor) !== 0x60) { cursor += 1; continue; }
    const candidate = run(text, cursor, end, 0x60);
    if (candidate === length) {
      value += text.slice(segmentStart, cursor);
      if (value.length === 0) return error('empty inline code');
      let from = 0; let to = value.length;
      let first = from; while (first < to && value.charCodeAt(first) === 0x20) first += 1;
      if (first > from && first < to && value.charCodeAt(first) === 0x60) from += 1;
      let last = to; while (last > from && value.charCodeAt(last - 1) === 0x20) last -= 1;
      if (last < to && last > from && value.charCodeAt(last - 1) === 0x60) to -= 1;
      if (from === to) return error('empty inline code');
      return { status: 'ok', value: value.slice(from, to), end: cursor + length };
    }
    cursor += candidate;
  }
  return error('unclosed inline code');
}

type Structured = { status: 'ok'; node: Inline; end: number; nested: number } |
  { status: 'error'; message: string; category?: 'syntax' | 'semantic' };
function link(text: string, start: number, end: number, annotations: SourceAnnotationBuilder, context: InlineContext, allowEmptyLabel = false): Structured | null {
  const image = at(text, start, end, '!['); const labelStart = start + (image ? 2 : 1);
  const labelEnd = findLabelEnd(text, labelStart, end);
  if (labelEnd < 0 || text.charCodeAt(labelEnd + 1) !== 0x28) return null;
  if (!image && context.insideLink === true) return error('nested link');
  const target = destination(text, labelEnd + 2, end);
  if (target === null) return error('invalid direct link');
  const nested = parseInline(text, labelStart, labelEnd, annotations, {
    ...(context.softBreaks === undefined ? {} : { softBreaks: context.softBreaks }),
    insideLink: true,
  });
  if (nested.status === 'error') return nested;
  if (!image && nested.nodes.length === 0 && !allowEmptyLabel) return error('empty inline token');
  const node: Inline = image ? { type: 'inlineImage', src: target.value, alt: nested.nodes, ...(target.title === undefined ? {} : { title: target.title }) } :
    { type: 'link', href: target.value, children: nested.nodes, ...(target.title === undefined ? {} : { title: target.title }) };
  return { status: 'ok', node, end: target.end, nested: nested.nodeCount };
}

export function parseDirectResource(
  text: string, start: number, end: number, annotations: SourceAnnotationBuilder,
  _image: boolean, allowEmptyLabel: boolean,
): { status: 'ok'; node: InlineImage | Link; end: number; nested: number } | { status: 'error'; message: string; category?: 'syntax' | 'semantic' } | null {
  const result = link(text, start, end, annotations, {}, allowEmptyLabel);
  if (result === null || result.status === 'error') return result;
  if (result.node.type !== 'inlineImage' && result.node.type !== 'link') return null;
  return { status: 'ok', node: result.node, end: result.end, nested: result.nested };
}

function metadataWrapper(
  text: string, start: number, end: number, annotations: SourceAnnotationBuilder, context: InlineContext,
): Structured | null {
  const open = parseMOpen(text, start, end);
  if (open === null) return null;
  if (open.status === 'error') return resourceError(open.message, open.category);
  const close = metadataClose(text, open.end, end);
  if (close < 0) return error('unclosed metadata wrapper');
  const after = close + 4;
  const image = parseDirectResource(text, open.end, close, annotations, true, true);
  if (image?.status === 'error') return image;
  if (image?.status === 'ok' && image.node.type === 'inlineImage' && image.end === close) {
    if (open.kind !== null) return resourceError('resource primary type conflict', 'semantic');
    if (!hasAttrs(open.attrs)) return resourceError('metadata wrapper adds no semantics', 'semantic');
    const invalid = validateAttributeContext('image', open.attrs);
    if (invalid !== null) return resourceError(invalid.message, invalid.category);
    if (image.node.type !== 'inlineImage') return resourceError('resource primary type conflict', 'semantic');
    const node: Inline = {
      ...image.node,
      ...(hasAttrs(open.attrs) ? { attrs: open.attrs as ImageResourceAttributes } : {}),
    };
    return { status: 'ok', node, end: after, nested: image.nested };
  }
  if (open.kind !== null) {
    const direct = parseDirectResource(text, open.end, close, annotations, false, true);
    if (direct?.status === 'error') return direct;
    if (direct === null || direct.end !== close) return resourceError('typed resource requires exactly one primary link', 'semantic');
    const invalid = validateAttributeContext(open.kind, open.attrs);
    if (invalid !== null) return resourceError(invalid.message, invalid.category);
    if (open.kind !== 'download') return resourceError('typed resource is block-only', 'semantic');
    if (context.insideLink === true) return error('nested link');
    if (direct.node.type !== 'link') return resourceError('resource primary type conflict', 'semantic');
    const node: Inline = {
      ...direct.node,
      download: true,
      ...(hasAttrs(open.attrs) ? { attrs: open.attrs as DownloadResourceAttributes } : {}),
    };
    return { status: 'ok', node, end: after, nested: direct.nested };
  }
  const invalid = validateAttributeContext('generic', open.attrs);
  if (invalid !== null) return resourceError(invalid.message, invalid.category);
  if (!hasAttrs(open.attrs)) return resourceError('metadata wrapper adds no semantics', 'semantic');
  const nested = parseInline(text, open.end, close, annotations, context);
  if (nested.status === 'error') return nested;
  if (nested.nodes.length === 0) return error('empty inline token');
  if (nested.nodes.some((node) => node.type === 'metadataSpan')) return error('same-kind direct inline nesting');
  const node: Inline = {
    type: 'metadataSpan',
    attrs: open.attrs as MetadataSpanAttributes,
    children: nested.nodes as [Inline, ...Inline[]],
  };
  return { status: 'ok', node, end: after, nested: nested.nodeCount };
}

/** Find this label's closing bracket while skipping complete nested structured tokens. */
function findLabelEnd(text: string, start: number, end: number): number {
  let cursor = start;
  while (cursor < end) {
    const code = text.charCodeAt(cursor);
    if (code === 0x5c && cursor + 1 < end) { cursor += 2; continue; }
    if (at(text, cursor, end, '[^')) {
      const footnoteEnd = footnote(text, cursor, end);
      if (footnoteEnd > 0) { cursor = footnoteEnd; continue; }
    }
    const nestedStart = at(text, cursor, end, '![') ? cursor + 2 : code === 0x5b ? cursor + 1 : -1;
    if (nestedStart >= 0) {
      const nestedLabelEnd = findLabelEnd(text, nestedStart, end);
      if (nestedLabelEnd >= 0 && text.charCodeAt(nestedLabelEnd + 1) === 0x28) {
        const target = destination(text, nestedLabelEnd + 2, end);
        if (target !== null) { cursor = target.end; continue; }
      }
    }
    if (code === 0x5d) return cursor;
    cursor += 1;
  }
  return -1;
}

function destination(text: string, start: number, end: number): { value: string; title?: string; end: number } | null {
  let cursor = start;
  let value: string;
  if (text.charCodeAt(cursor) === 0x3c) {
    const from = ++cursor;
    while (cursor < end) {
      const code = text.charCodeAt(cursor);
      if (code === 0x3e) break;
      if (code === 0x5c && cursor + 1 < end) { cursor += 2; continue; }
      if (isControl(code)) return null;
      cursor += 1;
    }
    if (cursor >= end) return null;
    value = decodeLinkValue(text.slice(from, cursor));
    cursor += 1;
  } else {
    const from = cursor;
    let depth = 0;
    while (cursor < end) {
      const code = text.charCodeAt(cursor);
      if (code === 0x5c && cursor + 1 < end) { cursor += 2; continue; }
      if (code === 0x28) depth += 1;
      else if (code === 0x29) { if (depth === 0) break; depth -= 1; }
      else if (isUnicodeWhitespace(code) || isControl(code)) break;
      cursor += 1;
    }
    if (depth !== 0) return null;
    value = decodeLinkValue(text.slice(from, cursor));
  }
  const emptyBare = value.length === 0 && text.charCodeAt(start) !== 0x3c;
  const beforeWhitespace = cursor;
  while (cursor < end && blank(text.charCodeAt(cursor))) cursor += 1;
  let title: string | undefined;
  const titleOpener = text.charCodeAt(cursor);
  if (titleOpener === 0x22 || titleOpener === 0x27 || titleOpener === 0x28) {
    const titleCloser = titleOpener === 0x28 ? 0x29 : titleOpener;
    const titleStart = ++cursor;
    while (cursor < end && text.charCodeAt(cursor) !== titleCloser) {
      if (text.charCodeAt(cursor) === 0x5c && cursor + 1 < end) cursor += 2;
      else cursor += 1;
    }
    if (cursor >= end) return null;
    title = decodeLinkValue(text.slice(titleStart, cursor++));
    if (!validLinkValue(title)) return null;
    while (cursor < end && blank(text.charCodeAt(cursor))) cursor += 1;
  }
  if (emptyBare && cursor > beforeWhitespace && title === undefined) return null;
  if (!validLinkValue(value)) return null;
  if (text.charCodeAt(cursor) !== 0x29) return null;
  return { value, ...(title === undefined ? {} : { title }), end: cursor + 1 };
}

function decodeLinkValue(value: string): string {
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 0x5c && index + 1 < value.length && escapable(value.charCodeAt(index + 1))) {
      output += value[++index]!;
      continue;
    }
    if (value.charCodeAt(index) === 0x26) {
      const entity = scanEntity(value, index, value.length);
      if (entity.kind === 'decoded') {
        output += entity.value;
        index = entity.end - 1;
        continue;
      }
    }
    output += value[index]!;
  }
  return output;
}

function validLinkValue(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (isControl(code)) return false;
  }
  return true;
}

function isControl(code: number): boolean {
  return (code >= 0 && code <= 0x1f && code !== 0x09) || (code >= 0x7f && code <= 0x9f);
}

function mib(text: string, start: number, end: number, annotations: SourceAnnotationBuilder, context: InlineContext): Structured | null {
  let kind: 'em' | 'strong'; let opener: string; let closer: string;
  if (at(text, start, end, '<i>')) { kind = 'em'; opener = '<i>'; closer = '</i>'; }
  else if (at(text, start, end, '<b>')) { kind = 'strong'; opener = '<b>'; closer = '</b>'; }
  else return null;
  if (context.ancestors?.has(kind) === true) return error('same-kind direct inline nesting');
  const close = wrapperClose(text, start + opener.length, end, opener, closer);
  if (close < 0) return error('unclosed inline wrapper');
  if (close === start + opener.length) return error('empty inline token');
  const ancestors = new Set<Kind>([kind]);
  const nested = parseInline(text, start + opener.length, close, annotations, {
    ...(context.insideLink === undefined ? {} : { insideLink: context.insideLink }),
    ...(context.softBreaks === undefined ? {} : { softBreaks: context.softBreaks }),
    ancestors,
  });
  if (nested.status === 'error') return nested;
  return { status: 'ok', node: wrap(kind, nested.nodes), end: close + closer.length, nested: nested.nodeCount };
}


function bracketAutolink(text: string, start: number, end: number): { node: Inline; end: number } | null {
  const close = findUnit(text, start + 1, end, 0x3e); if (close < 0) return null;
  const value = text.slice(start + 1, close);
  if (isUrlAutolink(value)) return { node: { type: 'autolink', kind: 'url', value }, end: close + 1 };
  if (isEmailAutolink(value)) return { node: { type: 'autolink', kind: 'email', value }, end: close + 1 };
  return null;
}

function bareAutolink(text: string, start: number, end: number): { status: 'ok'; value: string; end: number } | { status: 'error'; message: string } {
  let stop = start;
  while (stop < end) { const cp = codePointAt(text, stop, end); if (isUnicodeWhitespace(cp) || cp === 0x3c || cp === 0x3e) break; stop += cp > 0xffff ? 2 : 1; }
  let urlEnd = stop;
  while (urlEnd > start && trailing(text.charCodeAt(urlEnd - 1))) urlEnd -= 1;
  while (text.charCodeAt(urlEnd - 1) === 0x29 && excessParens(text, start, urlEnd)) urlEnd -= 1;
  if (text.charCodeAt(urlEnd - 1) === 0x3b) {
    let amp = urlEnd - 2; while (amp >= start && asciiAlnum(text.charCodeAt(amp))) amp -= 1;
    if (text.charCodeAt(amp) === 0x26 && amp + 1 < urlEnd - 1) urlEnd = amp;
  }
  const value = text.slice(start, urlEnd); return isUrlAutolink(value) ? { status: 'ok', value, end: urlEnd } : error('invalid bare autolink');
}

function atomic(text: string, start: number, end: number, code: number): { value: string; end: number } | null {
  if (characterClass(codePointAt(text, start + 1, end)) === 'S') return null;
  let cursor = start + 1;
  while (cursor < end && text.charCodeAt(cursor) !== code) {
    const cp = codePointAt(text, cursor, end); if (isUnicodeWhitespace(cp)) return null; cursor += cp > 0xffff ? 2 : 1;
  }
  return cursor > start + 1 && cursor < end ? { value: text.slice(start + 1, cursor), end: cursor + 1 } : null;
}

/**
 * The source length of a maximal underscore run starting at `start` that
 * contains at least one backslash-escaped `_` and totals three or more
 * underscores (spec §10.8); otherwise 0. Only `_` qualifies — `*`/`~` are
 * punctuation and an escaped-leftmost surface would not round-trip.
 */
function literalUnderscoreRun(text: string, start: number, end: number): number {
  let cursor = start;
  let count = 0;
  let escaped = false;
  while (cursor < end) {
    const code = text.charCodeAt(cursor);
    if (code === 0x5f) { count += 1; cursor += 1; continue; }
    if (code === 0x5c && cursor + 1 < end && text.charCodeAt(cursor + 1) === 0x5f) {
      count += 1; escaped = true; cursor += 2; continue;
    }
    break;
  }
  return count >= 3 && escaped ? cursor - start : 0;
}

function delimiterAt(text: string, start: number, end: number): string | null {
  for (const d of DELIMITERS) {
    if (!at(text, start, end, d)) continue;
    if (d === '--' && (text.charCodeAt(start - 1) === 0x2d || text.charCodeAt(start + 2) === 0x2d)) return null;
    return d;
  }
  return null;
}
function canOpen(text: string, start: number, d: string, sliceStart: number, end: number): boolean {
  return characterClass(codePointAt(text, start + d.length, end)) !== 'S' &&
    characterClass(codePointBefore(text, start, sliceStart)) !== 'W';
}
function canClose(text: string, start: number, d: string, sliceStart: number, end: number): boolean {
  return characterClass(codePointBefore(text, start, sliceStart)) !== 'S' &&
    characterClass(codePointAt(text, start + d.length, end)) !== 'W';
}
function hasSoftBreakBetween(softBreaks: ReadonlyMap<number, SoftBreakBoundary> | undefined,
  start: number, end: number): boolean {
  if (softBreaks === undefined) return false;
  for (let position = start; position < end; position += 1) if (softBreaks.has(position)) return true;
  return false;
}
function delimiterKind(d: string): Kind { return d === '*' || d === '_' ? 'em' : d === '**' || d === '__' ? 'strong' : d === '~~' ? 'deletion' : d === '--' ? 'obsolete' : d === '++' ? 'insert' : 'mark'; }
function wrap(kind: Kind, children: Inline[]): Inline {
  const c = children as [Inline, ...Inline[]];
  switch (kind) { case 'em': return { type: 'em', children: c }; case 'strong': return { type: 'strong', children: c }; case 'deletion': return { type: 'deletion', children: c }; case 'obsolete': return { type: 'obsolete', children: c }; case 'insert': return { type: 'insert', children: c }; case 'mark': return { type: 'mark', children: c }; }
}
function footnote(text: string, start: number, end: number): number { let c = start + 2; const s = c; while (c < end && identifier(text.charCodeAt(c))) c += 1; return c > s && text.charCodeAt(c) === 0x5d ? c + 1 : -1; }
function at(text: string, start: number, end: number, value: string): boolean { if (start < 0 || start + value.length > end) return false; for (let i = 0; i < value.length; i += 1) if (text.charCodeAt(start + i) !== value.charCodeAt(i)) return false; return true; }
function find(text: string, start: number, end: number, value: string): number { for (let c = start; c + value.length <= end; c += 1) if (at(text, c, end, value)) return c; return -1; }
function findUnit(text: string, start: number, end: number, code: number): number { for (let c = start; c < end; c += 1) { if (text.charCodeAt(c) === 0x5c) c += 1; else if (text.charCodeAt(c) === code) return c; } return -1; }
function run(text: string, start: number, end: number, code: number): number { let c = start; while (c < end && text.charCodeAt(c) === code) c += 1; return c - start; }
function escapable(c: number): boolean { return c >= 0x21 && c <= 0x7e && !asciiAlnum(c); }
function asciiAlnum(c: number): boolean { return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122); }
function identifier(c: number): boolean { return asciiAlnum(c) || c === 0x5f || c === 0x2d; }
function blank(c: number): boolean { return c === 0x20 || c === 0x09; }
function trailing(c: number): boolean { return c === 0x3f || c === 0x21 || c === 0x2e || c === 0x2c || c === 0x3a || c === 0x2a || c === 0x5f || c === 0x7e; }
function excessParens(text: string, start: number, end: number): boolean { let a = 0, b = 0; for (let c = start; c < end; c += 1) { if (text.charCodeAt(c) === 0x28) a += 1; else if (text.charCodeAt(c) === 0x29) b += 1; } return b > a; }
function error(message: string): { status: 'error'; message: string } { return { status: 'error', message }; }
function resourceError(message: string, category: 'syntax' | 'semantic'): { status: 'error'; message: string; category: 'syntax' | 'semantic' } { return { status: 'error', message, category }; }
