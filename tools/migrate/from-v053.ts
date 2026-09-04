/**
 * Legacy Markanto v0.4.0 AST → Markanto 0.1.0 AST.
 *
 * The delta set is `docs/MIGRATION.md` §2 + §5. Everything the previous parser
 * already resolves (typed block resources from `<f>`/`<v>`/`<au>`/`<e>`,
 * `<em>`/`<strong>` → `em`/`strong`, captions as parsed inline) is a
 * passthrough; this file renames the handful of nodes/fields that actually
 * changed shape and flags every meaning-changing rewrite.
 */
import type {
  AudioBlock, Container, DataAttributes, DocumentBlock, DownloadResourceAttributes, EmbedBlock, Grid,
  ImageBlock, ImageResourceAttributes, Inline, InlineWithoutBreak, List, ListItem,
  MediaResourceAttributes, MetadataSpanAttributes, Paragraph, QuoteBlock, Table, TableRow,
  VideoBlock, Document as NewDocument,
} from '../../src/index.js';
import { parse } from '../../src/index.js';

import type { DiagnosticCollector, LegacyRange } from './diagnostics.js';

/** Loose view of a legacy node — the previous package ships full types but we only touch a few fields. */
interface LegacyNode {
  readonly type: string;
  readonly [key: string]: unknown;
  readonly range?: LegacyRange;
}
interface LegacyDoc {
  readonly type: 'document';
  readonly children: readonly LegacyNode[];
  readonly footnotes?: readonly LegacyNode[];
  readonly meta?: { readonly lang?: string };
}

interface Ctx {
  readonly source: string;
  readonly diag: DiagnosticCollector;
}

export function transformDocument(root: unknown, source: string, diag: DiagnosticCollector): NewDocument {
  const legacy = root as LegacyDoc;
  const ctx: Ctx = { source, diag };
  if (legacy.meta?.lang !== undefined) {
    diag.add('dropped', `document language "${legacy.meta.lang}" is not a 0.1.0 Core field — set it renderer-side`);
  }
  const children = transformSequence(legacy.children, ctx);
  const footnotes = (legacy.footnotes ?? []).map((definition) => ({
    type: 'footnoteDefinition' as const,
    identifier: String(definition['identifier'] ?? ''),
    ...(explicitId(definition) === undefined ? {} : { id: explicitId(definition)! }),
    children: footnoteInline(childList(definition), ctx),
  }));
  return { type: 'document', children, footnotes };
}

function blocksOf(value: DocumentBlock | DocumentBlock[] | null): DocumentBlock[] {
  return value === null ? [] : Array.isArray(value) ? value : [value];
}

const CAPTIONABLE = new Set(['imageBlock', 'videoBlock', 'audioBlock', 'embedBlock', 'downloadBlock']);

/**
 * Transform a block sequence, folding a v0.5.3 `: Caption` — parsed by the
 * previous parser as a term-only definition list directly after a resource —
 * onto that resource's 0.1.0 `caption`. Every other block is independent.
 */
function transformSequence(nodes: readonly LegacyNode[], ctx: Ctx): DocumentBlock[] {
  const out: DocumentBlock[] = [];
  for (const node of nodes) {
    const prev = out.at(-1) as { type?: string; caption?: unknown } | undefined;
    if (prev !== undefined && CAPTIONABLE.has(prev.type ?? '') && prev.caption === undefined && isTermOnlyDefinitionList(node)) {
      const inline = withoutBreaks(inlineList(childList(childList(node)[0]!)[0]!, ctx), node.range, ctx, 'caption');
      if (inline.length > 0) {
        (prev as { caption?: unknown }).caption = inline as [InlineWithoutBreak, ...InlineWithoutBreak[]];
        ctx.diag.add('review', 'a definition list directly after a resource was migrated as its caption (v0.5.3 `: Caption`)', node.range);
        continue;
      }
    }
    out.push(...blocksOf(transformBlock(node, ctx)));

    // v0.5.3 splits a blank-line-separated run of same-marker items into
    // separate `list` nodes; 0.1.0 has one uniform list model (spec §9.9) —
    // a blank line does not split, and two adjacent same-kind lists have no
    // canonical surface. Fold a freshly appended list onto an immediately
    // preceding same-kind one. For ordered lists a discontinuous ordinal is
    // still representable as a visible `value` on the item, so the merge
    // always applies; only an explicit ID on either list blocks it.
    const last = out.at(-1) as List | undefined;
    const beforeLast = out.at(-2) as List | undefined;
    if (
      last?.type === 'list' && beforeLast?.type === 'list' &&
      last.kind === beforeLast.kind &&
      last.id === undefined && beforeLast.id === undefined
    ) {
      let expected = expectedNext(beforeLast);
      let keptOrdinal = false;
      for (const item of last.items) {
        const actual = ordinalOf(last, item);
        if (last.kind === 'ordered') {
          if (actual !== expected) { (item as { value?: number }).value = actual; keptOrdinal = true; }
          else delete (item as { value?: number }).value;
        }
        beforeLast.items = [...beforeLast.items, item] as List['items'];
        expected = (last.kind === 'ordered' ? actual : 0) + 1;
      }
      out.pop();
      ctx.diag.add(
        'mapped',
        keptOrdinal
          ? 'adjacent same-kind lists (v0.5.3 blank-line split) merged into one; a discontinuous ordinal is kept as the item’s visible value'
          : 'adjacent same-kind lists (v0.5.3 blank-line split) merged into one',
        node.range,
      );
    }
  }
  return out;
}

/** The ordinal the next item after this list would carry (0 for non-ordered). */
function expectedNext(list: List): number {
  if (list.kind !== 'ordered') return 0;
  let number = list.start ?? 1;
  for (let index = 0; index < list.items.length; index += 1) {
    if (index > 0) number += 1;
    const value = list.items[index]!.value;
    if (value !== undefined) number = value;
  }
  return number + 1;
}

/** The ordinal `item` carries within `list` (1-based; 0 for a non-ordered list). */
function ordinalOf(list: List, item: ListItem): number {
  if (list.kind !== 'ordered') return 0;
  let number = list.start ?? 1;
  for (const current of list.items) {
    if (current === list.items[0]) number = current.value ?? list.start ?? 1;
    else number = current.value ?? number + 1;
    if (current === item) return number;
  }
  return number;
}

/** A single-item definition list whose only item is a bare term paragraph. */
function isTermOnlyDefinitionList(node: LegacyNode): boolean {
  if (node.type !== 'list' || node['kind'] !== 'definition') return false;
  const items = childList(node);
  if (items.length !== 1) return false;
  const itemBlocks = childList(items[0]!);
  return itemBlocks.length === 1 && itemBlocks[0]!.type === 'paragraph';
}

// --- blocks ----------------------------------------------------------------

function transformBlock(node: LegacyNode, ctx: Ctx): DocumentBlock | DocumentBlock[] | null {
  switch (node.type) {
    case 'heading': {
      const children = withoutBreaks(inlineList(node, ctx), node.range, ctx, 'heading');
      if (children.length === 0) return null;
      return {
        type: 'heading',
        level: clampLevel(node['level']),
        ...(explicitId(node) === undefined ? {} : { id: explicitId(node)! }),
        children: children as [InlineWithoutBreak, ...InlineWithoutBreak[]],
      };
    }
    case 'paragraph': {
      const children = inlineList(node, ctx);
      if (children.length === 0) return null;
      // A line that is nothing but a download link is a block resource in
      // 0.1.0 (§4.4) — v0.5.3 could keep it inline (e.g. `<m data-type=download>`).
      const only = children.length === 1 ? children[0]! : undefined;
      if (only?.type === 'link' && only.download === true) {
        ctx.diag.add('mapped', 'a whole-line download link → 0.1.0 downloadBlock (§4.4)', node.range);
        return {
          type: 'downloadBlock',
          href: only.href,
          label: only.children as [InlineWithoutBreak, ...InlineWithoutBreak[]],
          ...(only.title === undefined ? {} : { title: only.title }),
          ...(only.attrs === undefined ? {} : { attrs: only.attrs }),
          ...(explicitId(node) === undefined ? {} : { id: explicitId(node)! }),
        } as DocumentBlock;
      }
      return { type: 'paragraph', ...(explicitId(node) === undefined ? {} : { id: explicitId(node)! }), children: children as Paragraph['children'] };
    }
    case 'horizontalRule':
      return { type: 'horizontalRule', ...(explicitId(node) === undefined ? {} : { id: explicitId(node)! }) };
    case 'codeBlock':
      return { type: 'codeBlock', value: String(node['value'] ?? ''), ...(langOf(node) === undefined ? {} : { lang: langOf(node)! }), ...(explicitId(node) === undefined ? {} : { id: explicitId(node)! }) };
    case 'mathBlock':
      return { type: 'mathBlock', value: String(node['value'] ?? ''), ...(explicitId(node) === undefined ? {} : { id: explicitId(node)! }) };
    case 'commentBlock':
      return { type: 'commentBlock', value: String(node['value'] ?? '') };
    case 'imageBlock': return imageBlock(node, ctx);
    case 'videoBlock': return mediaBlock('videoBlock', node, ctx);
    case 'audioBlock': return mediaBlock('audioBlock', node, ctx);
    case 'embedBlock': return mediaBlock('embedBlock', node, ctx);
    case 'downloadBlock': return downloadBlock(node, ctx);
    case 'list': return transformList(node, ctx);
    case 'table': return transformTable(node, ctx);
    case 'quoteRegion': return transformQuote(node, ctx);
    case 'directiveContainer': return transformContainer(node, 'lined', ctx);
    case 'fencedContainer': return transformContainer(node, 'fenced', ctx);
    case 'errorBlock':
      ctx.diag.add('unrepresentable', `legacy parse recovery block: ${String(node['reason'] ?? 'invalid source')}`, node.range);
      return null;
    default:
      ctx.diag.add('unrepresentable', `unknown legacy block "${node.type}" was dropped`, node.range);
      return null;
  }
}

function transformList(node: LegacyNode, ctx: Ctx): List {
  const kind = (node['kind'] === 'ordered' || node['kind'] === 'definition') ? node['kind'] : 'unordered';
  const items = childList(node).map((item): ListItem => {
    const blocks = transformSequence(childList(item), ctx);
    const first = blocks[0]?.type === 'paragraph' ? blocks[0] : { type: 'paragraph' as const, children: [{ type: 'text' as const, value: ' ' }] as Paragraph['children'] };
    const rest = (blocks[0]?.type === 'paragraph' ? blocks.slice(1) : blocks).filter(isListItemBlock);
    return {
      type: 'listItem',
      ...(typeof item['value'] === 'number' ? { value: item['value'] as number } : {}),
      ...(item['task'] === 'open' || item['task'] === 'done' ? { task: item['task'] } : {}),
      children: [first, ...rest] as ListItem['children'],
    };
  });
  return {
    type: 'list',
    kind,
    ...(kind === 'ordered' && typeof node['start'] === 'number' && node['start'] !== 1 ? { start: node['start'] as number } : {}),
    ...(explicitId(node) === undefined ? {} : { id: explicitId(node)! }),
    items: (items.length > 0 ? items : [{ type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: ' ' }] }] as ListItem['children'] }]) as List['items'],
  };
}

function isListItemBlock(block: DocumentBlock): boolean {
  return block.type !== 'heading' && block.type !== 'horizontalRule' && block.type !== 'container';
}

function transformTable(node: LegacyNode, ctx: Ctx): Table {
  const row = (r: LegacyNode): TableRow => ({
    type: 'tableRow',
    cells: ((r['cells'] as LegacyNode[] | undefined) ?? []).map((cell) => ({
      type: 'tableCell' as const,
      children: withoutBreaks(inlineList(cell, ctx), cell.range, ctx, 'table cell'),
    })),
  });
  const head = node['head'] as LegacyNode | undefined;
  const body = (node['body'] as LegacyNode[] | undefined) ?? [];
  const alignments = (node['alignments'] as string[] | undefined) ?? ['default'];
  return {
    type: 'table',
    ...(explicitId(node) === undefined ? {} : { id: explicitId(node)! }),
    alignments: alignments.map(toAlignment) as Table['alignments'],
    head: head === undefined ? { type: 'tableRow', cells: [] } : row(head),
    body: body.map(row),
  };
}

function transformQuote(node: LegacyNode, ctx: Ctx): DocumentBlock {
  const blocks: QuoteBlock[] = [];
  for (const qb of childList(node)) {
    const level = typeof qb['level'] === 'number' ? qb['level'] : 1;
    const inner = qb['block'] as LegacyNode | undefined;
    if (inner === undefined) continue;

    const last = blocks.at(-1);
    if (
      last !== undefined && last.level === level && CAPTIONABLE.has(last.block.type) &&
      (last.block as { caption?: unknown }).caption === undefined && isTermOnlyDefinitionList(inner)
    ) {
      const captionInline = withoutBreaks(inlineList(childList(childList(inner)[0]!)[0]!, ctx), inner.range, ctx, 'caption');
      if (captionInline.length > 0) {
        (last.block as { caption?: unknown }).caption = captionInline as [InlineWithoutBreak, ...InlineWithoutBreak[]];
        ctx.diag.add('review', 'a definition list directly after a quoted resource was migrated as its caption (v0.5.3 `: Caption`)', inner.range);
        continue;
      }
    }

    for (const converted of blocksOf(transformBlock(inner, ctx))) {
      if (converted.type === 'container' || converted.type === 'quoteRegion') {
        ctx.diag.add('unrepresentable', `${converted.type} inside a quote region is not permitted in 0.1.0`, inner.range);
        continue;
      }
      blocks.push({ level, block: converted });
    }
  }
  const attribution = node['attribution'] !== undefined
    ? withoutBreaks(transformInlineArray(node['attribution'] as LegacyNode[], ctx), node.range, ctx, 'quote attribution')
    : [];
  if (blocks.length === 0) {
    ctx.diag.add('unrepresentable', 'quote region lost all content during migration', node.range);
    blocks.push({ level: 1, block: { type: 'paragraph', children: [{ type: 'text', value: ' ' }] } });
  }
  return {
    type: 'quoteRegion',
    ...(explicitId(node) === undefined ? {} : { id: explicitId(node)! }),
    ...(attribution.length > 0 ? { attribution: attribution as [InlineWithoutBreak, ...InlineWithoutBreak[]] } : {}),
    children: blocks as [QuoteBlock, ...QuoteBlock[]],
  };
}

function transformContainer(node: LegacyNode, form: 'lined' | 'fenced', ctx: Ctx): DocumentBlock {
  const name = typeof node['name'] === 'string' ? node['name'] : null;
  if (name === 'grid') {
    const grid = reparseGrid(node, ctx);
    if (grid !== null) return grid;
    // Falling through to an ordinary `grid`-named container would silently
    // assign different semantics (MIGRATION.md §5 forbids it) — keep the raw
    // block as a literal code block instead.
    const raw = node.range === undefined ? '' : ctx.source.slice(node.range.start.offset, (node.range as { end?: { offset?: number } }).end?.offset ?? ctx.source.length);
    return { type: 'codeBlock', value: raw.replace(/\n+$/u, '') };
  }
  if (typeof node['fenceLength'] === 'number' && node['fenceLength'] > 3) {
    ctx.diag.add('dropped', `container fence length ${node['fenceLength']} is not retained; 0.1.0 normalises to the minimum`, node.range);
  }
  const children = transformSequence(childList(node), ctx);
  ctx.diag.add('mapped', `legacy ${node.type} → 0.1.0 ${form} container${name === null ? '' : ` "${name}"`}`, node.range);
  const base = {
    type: 'container' as const,
    containerType: name,
    title: typeof node['title'] === 'string' ? node['title'] : null,
    ...(explicitId(node) === undefined ? {} : { id: explicitId(node)! }),
  };
  if (children.length === 0) {
    ctx.diag.add('unrepresentable', 'container lost all content during migration', node.range);
    return { ...base, form, children: [{ type: 'paragraph', children: [{ type: 'text', value: ' ' }] }] } as Container;
  }
  return { ...base, form, children: children as never } as Container;
}

/**
 * Legacy `::: grid` reaches the old parser as an unstructured `fencedContainer`
 * named `grid` whose only difference from a 0.1.0 grid is the `:` prefix on the
 * `:--` / `:==` separators. Slice the block out of the original source, drop the
 * prefix, and let Core parse the geometry.
 */
function reparseGrid(node: LegacyNode, ctx: Ctx): DocumentBlock | null {
  const range = node.range;
  if (range === undefined) { ctx.diag.add('unrepresentable', 'grid container has no source range to re-read', undefined); return null; }
  const start = range.start.offset;
  const end = (node.range as { end?: { offset?: number } }).end?.offset ?? ctx.source.length;
  const slice = ctx.source.slice(start, end);
  const rewritten = slice.replace(/^:(--|==|\^|<)([ \t]*)$/gmu, '$1$2');
  const parsed = parse(rewritten, {});
  if (parsed.status === 'ok' && parsed.document.children.length === 1) {
    const only = parsed.document.children[0]!;
    if (only.type === 'container' && only.children[0]?.type === 'grid') {
      ctx.diag.add('mapped', 'legacy `::: grid` (`:--` / `:==`) → 0.1.0 Fenced Grid geometry', node.range);
      return only;
    }
  }
  ctx.diag.add('unrepresentable', 'grid geometry could not be recovered — review the source manually', node.range);
  return null;
}

// --- resources -----------------------------------------------------------

function imageBlock(node: LegacyNode, ctx: Ctx): ImageBlock {
  return {
    type: 'imageBlock',
    src: String(node['src'] ?? ''),
    alt: altInline(node['alt'], ctx),
    ...(typeof node['title'] === 'string' ? { title: node['title'] } : {}),
    ...captionField(node, ctx),
    ...attrField(node, 'image', ctx),
    ...(explicitId(node) === undefined ? {} : { id: explicitId(node)! }),
  } as ImageBlock;
}

function mediaBlock(type: 'videoBlock' | 'audioBlock' | 'embedBlock', node: LegacyNode, ctx: Ctx): VideoBlock | AudioBlock | EmbedBlock {
  const destination = String(node['src'] ?? node['url'] ?? '');
  const common = {
    label: altInline(node['alt'], ctx),
    ...(typeof node['title'] === 'string' ? { title: node['title'] } : {}),
    ...captionField(node, ctx),
    ...attrField(node, 'media', ctx),
    ...(explicitId(node) === undefined ? {} : { id: explicitId(node)! }),
  };
  return type === 'embedBlock'
    ? { type: 'embedBlock', target: destination, ...common } as EmbedBlock
    : { type, src: destination, ...common } as VideoBlock | AudioBlock;
}

function downloadBlock(node: LegacyNode, ctx: Ctx): DocumentBlock {
  ctx.diag.add('mapped', 'legacy downloadBlock → 0.1.0 downloadBlock', node.range);
  return {
    type: 'downloadBlock',
    href: String(node['href'] ?? ''),
    label: altInline(node['alt'], ctx),
    ...(typeof node['title'] === 'string' ? { title: node['title'] } : {}),
    ...captionField(node, ctx),
    ...attrField(node, 'download', ctx),
    ...(explicitId(node) === undefined ? {} : { id: explicitId(node)! }),
  } as DocumentBlock;
}

function captionField(node: LegacyNode, ctx: Ctx): { caption?: [InlineWithoutBreak, ...InlineWithoutBreak[]] } {
  if (node['caption'] === undefined) return {};
  const caption = withoutBreaks(transformInlineArray(node['caption'] as LegacyNode[], ctx), node.range, ctx, 'caption');
  return caption.length > 0 ? { caption: caption as [InlineWithoutBreak, ...InlineWithoutBreak[]] } : {};
}

function attrField(node: LegacyNode, context: 'image' | 'media' | 'download', ctx: Ctx):
  { attrs?: ImageResourceAttributes | MediaResourceAttributes | DownloadResourceAttributes } {
  const legacy = node['attrs'] as { group?: string; lang?: string; preview?: string; dataAttrs?: Record<string, string> } | undefined;
  if (legacy === undefined) return {};
  const dataAttrs = legacyDataAttrs(legacy.dataAttrs, node, ctx);
  if (context === 'image') {
    if (legacy.lang !== undefined) ctx.diag.add('mapped', 'image `lang` attribute is retained in 0.1.0', node.range);
    if (legacy.preview !== undefined) ctx.diag.add('dropped', 'image `preview` attribute is not valid on a 0.1.0 image resource', node.range);
    const attrs: ImageResourceAttributes = {
      ...(legacy.group !== undefined ? { group: legacy.group } : {}),
      ...(legacy.lang !== undefined ? { lang: legacy.lang } : {}),
      ...dataAttrs,
    };
    return Object.keys(attrs).length > 0 ? { attrs } : {};
  }
  if (context === 'download') {
    if (legacy.group !== undefined) ctx.diag.add('dropped', 'download `group` attribute is not valid on a 0.1.0 download resource', node.range);
    if (legacy.preview !== undefined) ctx.diag.add('dropped', 'download `preview` attribute is not valid on a 0.1.0 download resource', node.range);
    const attrs: DownloadResourceAttributes = { ...(legacy.lang !== undefined ? { lang: legacy.lang } : {}), ...dataAttrs };
    return Object.keys(attrs).length > 0 ? { attrs } : {};
  }
  const attrs: MediaResourceAttributes = {
    ...(legacy.group !== undefined ? { group: legacy.group } : {}),
    ...(legacy.lang !== undefined ? { lang: legacy.lang } : {}),
    ...(legacy.preview !== undefined ? { preview: legacy.preview } : {}),
    ...dataAttrs,
  };
  return Object.keys(attrs).length > 0 ? { attrs } : {};
}

// --- inline --------------------------------------------------------------

function transformInline(node: LegacyNode, ctx: Ctx): Inline[] {
  switch (node.type) {
    case 'text': return [{ type: 'text', value: String(node['value'] ?? '') }];
    case 'softBreak': return [{ type: 'softBreak' }];
    case 'hardBreak': return [{ type: 'hardBreak' }];
    case 'inlineCode': return [{ type: 'inlineCode', value: String(node['value'] ?? '') }];
    case 'inlineMath': return [{ type: 'inlineMath', value: String(node['value'] ?? '') }];
    case 'em': case 'strong': case 'insert': case 'mark': case 'obsolete': {
      const children = inlineList(node, ctx);
      return children.length === 0 ? [] : [{ type: node.type, children: children as [Inline, ...Inline[]] } as Inline];
    }
    case 'strike': {
      const children = inlineList(node, ctx);
      return children.length === 0 ? [] : [{ type: 'deletion', children: children as [Inline, ...Inline[]] }];
    }
    case 'sup': case 'sub': return [atomicScript(node, ctx)].filter((n): n is Inline => n !== null);
    case 'autolink':
      return [{ type: 'autolink', kind: node['kind'] === 'email' ? 'email' : 'url', value: String(node['value'] ?? '') }];
    case 'footnoteReference':
      return [{ type: 'footnoteReference', identifier: String(node['identifier'] ?? '') }];
    case 'link': return [link(node, ctx)];
    case 'inlineImage': return [inlineImage(node, ctx)];
    case 'span': return [metadataSpan(node, ctx)].filter((n): n is Inline => n !== null);
    default:
      ctx.diag.add('unrepresentable', `unknown legacy inline "${node.type}" was dropped`, node.range);
      return [];
  }
}

function link(node: LegacyNode, ctx: Ctx): Inline {
  const download = node['download'] === true;
  const legacy = node['attrs'] as { lang?: string; group?: string; preview?: string; dataAttrs?: Record<string, string> } | undefined;
  let attrs: DownloadResourceAttributes | undefined;
  if (download && legacy !== undefined) {
    if (legacy.group !== undefined || legacy.preview !== undefined) ctx.diag.add('dropped', 'download link keeps only `lang` + `data-*` attributes in 0.1.0', node.range);
    const dataAttrs = legacyDataAttrs(legacy.dataAttrs, node, ctx);
    const built = { ...(legacy.lang !== undefined ? { lang: legacy.lang } : {}), ...dataAttrs };
    if (Object.keys(built).length > 0) attrs = built;
  }
  const href = String(node['href'] ?? '');
  let children = inlineList(node, ctx);
  if (children.length === 0) {
    // A v0.5.3 link may have an empty label and display its destination;
    // 0.1.0 requires a non-empty label, so surface the destination as text.
    ctx.diag.add('review', 'a link with no label now shows its destination as the label text', node.range);
    children = [{ type: 'text', value: href.length > 0 ? href : ' ' }];
  }
  if (/^\/[^/.#?\s]+$/u.test(href)) {
    ctx.diag.add('review', `root-relative link "${href}" may have been an intended durable \`#${href.slice(1)}\` or external \`$${href.slice(1)}\` reference (spec §8)`, node.range);
  }
  return {
    type: 'link',
    href,
    ...(typeof node['title'] === 'string' ? { title: node['title'] } : {}),
    children,
    ...(download ? { download: true as const } : {}),
    ...(attrs === undefined ? {} : { attrs }),
  };
}

function inlineImage(node: LegacyNode, ctx: Ctx): Inline {
  const legacy = node['attrs'] as { lang?: string; group?: string; preview?: string; dataAttrs?: Record<string, string> } | undefined;
  let attrs: ImageResourceAttributes | undefined;
  if (legacy !== undefined) {
    if (legacy.lang !== undefined) ctx.diag.add('mapped', 'inline image `lang` attribute is retained in 0.1.0', node.range);
    if (legacy.preview !== undefined) ctx.diag.add('dropped', 'inline image `preview` attribute is not a 0.1.0 image attribute', node.range);
    const dataAttrs = legacyDataAttrs(legacy.dataAttrs, node, ctx);
    const built = {
      ...(legacy.group !== undefined ? { group: legacy.group } : {}),
      ...(legacy.lang !== undefined ? { lang: legacy.lang } : {}),
      ...dataAttrs,
    };
    if (Object.keys(built).length > 0) attrs = built;
  }
  return {
    type: 'inlineImage',
    src: String(node['src'] ?? ''),
    alt: altInline(node['alt'], ctx),
    ...(typeof node['title'] === 'string' ? { title: node['title'] } : {}),
    ...(attrs === undefined ? {} : { attrs }),
  };
}

function metadataSpan(node: LegacyNode, ctx: Ctx): Inline | null {
  const legacy = node['attrs'] as { lang?: string; dataAttrs?: Record<string, string> } | undefined;
  const dataAttrs = legacyDataAttrs(legacy?.dataAttrs, node, ctx);
  const attrs: MetadataSpanAttributes = { ...(legacy?.lang !== undefined ? { lang: legacy.lang } : {}), ...dataAttrs };
  const children = inlineList(node, ctx);
  if (Object.keys(attrs).length === 0) {
    ctx.diag.add('dropped', 'attribute-free `<m>` span is invalid in 0.1.0 — kept its text only', node.range);
    return children.length > 0 ? { type: 'text', value: plain(children) } : null;
  }
  if (children.length === 0) return null;
  const only = children.length === 1 ? children[0] : undefined;
  if (only?.type === 'inlineImage') {
    if (attrs.lang !== undefined) ctx.diag.add('mapped', 'inline image `lang` attribute is retained in 0.1.0', node.range);
    else ctx.diag.add('mapped', 'legacy image metadata span → 0.1.0 inline-image attributes', node.range);
    return {
      ...only,
      attrs: {
        ...only.attrs,
        ...attrs,
        ...(only.attrs?.dataAttrs === undefined && attrs.dataAttrs === undefined
          ? {}
          : { dataAttrs: { ...only.attrs?.dataAttrs, ...attrs.dataAttrs } }),
      },
    };
  }
  ctx.diag.add('mapped', 'legacy `span` → 0.1.0 `metadataSpan`', node.range);
  return { type: 'metadataSpan', attrs, children: children as [Inline, ...Inline[]] };
}

function atomicScript(node: LegacyNode, ctx: Ctx): Inline | null {
  const text = plain(inlineList(node, ctx));
  const forbidden = node.type === 'sup' ? '^' : '~';
  if (text.length === 0 || /\s/u.test(text) || text.includes(forbidden)) {
    ctx.diag.add('unrepresentable', `${node.type} content "${text}" is not atomic/whitespace-free in 0.1.0 — kept as text`, node.range);
    return text.length > 0 ? { type: 'text', value: `${forbidden}${text}${forbidden}` } : null;
  }
  return { type: node.type as 'sup' | 'sub', value: text };
}

// --- helpers ------------------------------------------------------------

function inlineList(node: LegacyNode, ctx: Ctx): Inline[] {
  return coalesce(transformInlineArray(childList(node) as LegacyNode[], ctx));
}
function transformInlineArray(nodes: readonly LegacyNode[], ctx: Ctx): Inline[] {
  return normalizeInlineWhitespace(foldBracketSpans(coalesce(nodes.flatMap((n) => transformInline(n, ctx))), ctx, nodes[0]?.range));
}

/**
 * v0.5.3 kept the raw line whitespace of a wrapped paragraph. 0.1.0 strips
 * Unicode whitespace from the edges of an inline sequence and from either side
 * of a line break (spec §7.7, §10.7); an AST that carries it has no canonical
 * surface, so `format()` rejects it. Match the parser here.
 */
function normalizeInlineWhitespace(nodes: Inline[]): Inline[] {
  const trimmedStart = (value: string): string => value.replace(/^\p{White_Space}+/u, '');
  const trimmedEnd = (value: string): string => value.replace(/\p{White_Space}+$/u, '');
  const out: Inline[] = nodes.map((node) => (node.type === 'text' ? { type: 'text', value: node.value } : node));
  for (let index = 0; index < out.length; index += 1) {
    const node = out[index]!;
    if (node.type !== 'text') continue;
    const atStart = index === 0 || out[index - 1]!.type === 'softBreak' || out[index - 1]!.type === 'hardBreak';
    const atEnd = index === out.length - 1 || out[index + 1]!.type === 'softBreak' || out[index + 1]!.type === 'hardBreak';
    let value = node.value;
    if (atStart) value = trimmedStart(value);
    if (atEnd) value = trimmedEnd(value);
    out[index] = { type: 'text', value };
  }
  return out.filter((node) => node.type !== 'text' || node.value.length > 0);
}

/**
 * v0.5.3 kept the `[Text]{key: value}` bracket-attribute span; the previous
 * parser (v0.5.0+) already replaced it with `<m>` and leaves the old surface as
 * ordinary `Text` — so this runs on the transformed inline sequence, never on
 * inline-code / code-block / comment `value`s. Only plain-text content is
 * folded (`[*em*]{…}` is flagged for manual review, not guessed).
 */
function foldBracketSpans(nodes: Inline[], ctx: Ctx, range?: LegacyRange): Inline[] {
  const out: Inline[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.type !== 'text' || !node.value.includes('[')) { out.push(node); continue; }

    // Case A — `[content]{attrs}` fully inside this text node.
    const inside = /^([\s\S]*?)\[([^[\]]*)\]\{([^{}]*)\}([\s\S]*)$/u.exec(node.value);
    if (inside !== null) {
      const attrs = parseSpanAttrs(inside[3]!);
      if (attrs !== null) {
        if (inside[1]!.length > 0) out.push({ type: 'text', value: inside[1]! });
        ctx.diag.add('mapped', 'legacy `[…]{…}` bracket span → `metadataSpan`', range);
        out.push({ type: 'metadataSpan', attrs, children: [{ type: 'text', value: inside[2]! }] });
        if (inside[4]!.length > 0) out.push(...foldBracketSpans([{ type: 'text', value: inside[4]! }], ctx, range));
        continue;
      }
      // that first `]{…}` was not an attribute list (`arr[0]{x}` in prose) —
      // keep it literal and retry the fold on what follows.
      if (inside[4]!.includes('[')) {
        out.push({ type: 'text', value: `${inside[1]!}[${inside[2]!}]{${inside[3]!}}` });
        out.push(...foldBracketSpans([{ type: 'text', value: inside[4]! }], ctx, range));
        continue;
      }
    }

    // Case B — the span straddles a soft/hard break: `…[open` · break · `close]{attrs}…`.
    const openAt = node.value.lastIndexOf('[');
    const opening = openAt >= 0 ? node.value.slice(openAt + 1) : '';
    const brk = nodes[index + 1];
    const cont = nodes[index + 2];
    if (
      openAt >= 0 && !opening.includes(']') && !opening.includes('[') &&
      (brk?.type === 'softBreak' || brk?.type === 'hardBreak') && cont?.type === 'text'
    ) {
      const close = /^([^[\]]*)\]\{([^{}]*)\}([\s\S]*)$/u.exec(cont.value);
      const attrs = close !== null ? parseSpanAttrs(close[2]!) : null;
      if (close !== null && attrs !== null) {
        if (openAt > 0) out.push({ type: 'text', value: node.value.slice(0, openAt) });
        ctx.diag.add('review', 'legacy `[…]{…}` bracket span crossed a line break; `<m>` is single-line so the break was collapsed to a space', range);
        out.push({ type: 'metadataSpan', attrs, children: [{ type: 'text', value: `${opening} ${close[1]!}`.replace(/\s+/gu, ' ').trim() }] });
        if (close[3]!.length > 0) out.push(...foldBracketSpans([{ type: 'text', value: close[3]! }], ctx, range));
        index += 2;
        continue;
      }
    }

    if (/\][ \t]*\{[ \t]*(?:lang|data-)/u.test(node.value)) {
      ctx.diag.add('review', 'a `[…]{…}` bracket span with inline markup or an unrecognised attribute list was left as literal text — migrate it by hand', range);
    }
    out.push(node);
  }
  return coalesce(out);
}

/** v0.5.3 span attributes: `lang` / `data-*`, `key: value` or `key=value`, quoted or bare. */
function parseSpanAttrs(raw: string): MetadataSpanAttributes | null {
  const pair = /(lang|data-[a-z][a-z0-9-]*)[ \t]*[:=][ \t]*("[^"\n]*"|[^\s,}]+)/gu;
  const result: MetadataSpanAttributes = {};
  const dataAttrs: DataAttributes = {};
  let matches = 0;
  for (const match of raw.matchAll(pair)) {
    matches += 1;
    const value = match[2]!.startsWith('"') ? match[2]!.slice(1, -1) : match[2]!;
    if (match[1] === 'lang') result.lang = value;
    else dataAttrs[match[1]!.slice(5)] = value;
  }
  if (matches === 0) return null;
  if (raw.replace(pair, '').replace(/[\s,]/gu, '').length > 0) return null; // leftover ⇒ not an attr list
  if (Object.keys(dataAttrs).length > 0) result.dataAttrs = dataAttrs;
  return Object.keys(result).length > 0 ? result : null;
}

function legacyDataAttrs(
  dataAttrs: Record<string, string> | undefined,
  node: LegacyNode,
  ctx: Ctx,
): { dataAttrs?: Record<string, string> } {
  if (dataAttrs === undefined || Object.keys(dataAttrs).length === 0) return {};
  for (const key of Object.keys(dataAttrs)) {
    if (!/^[a-z][a-z0-9_-]*$/u.test(key)) {
      ctx.diag.add(
        'review',
        `data-* key "data-${key}" is not a valid 0.1.0 key (lowercase only); left as-is for author review`,
        node.range,
      );
    }
  }
  return { dataAttrs };
}
function childList(node: LegacyNode): readonly LegacyNode[] {
  const c = node['children'] ?? node['items'];
  return Array.isArray(c) ? c as LegacyNode[] : [];
}
function coalesce(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    const prev = out.at(-1);
    if (node.type === 'text' && prev?.type === 'text') prev.value += node.value;
    else out.push(node);
  }
  while (out[0]?.type === 'softBreak' || out[0]?.type === 'hardBreak') out.shift();
  while (out.at(-1)?.type === 'softBreak' || out.at(-1)?.type === 'hardBreak') out.pop();
  return out;
}
function withoutBreaks(nodes: Inline[], range: LegacyRange | undefined, ctx: Ctx, where: string): InlineWithoutBreak[] {
  let flagged = false;
  const out: InlineWithoutBreak[] = [];
  for (const node of nodes) {
    if (node.type === 'softBreak' || node.type === 'hardBreak') {
      if (!flagged) { ctx.diag.add('review', `a line break inside a ${where} became a space in 0.1.0`, range); flagged = true; }
      const prev = out.at(-1);
      if (prev?.type === 'text') prev.value += ' ';
      else out.push({ type: 'text', value: ' ' });
      continue;
    }
    out.push(node);
  }
  return coalesce(out as Inline[]) as InlineWithoutBreak[];
}
function footnoteInline(nodes: readonly LegacyNode[], ctx: Ctx): [Exclude<InlineWithoutBreak, { readonly type: 'footnoteReference' }>, ...Exclude<InlineWithoutBreak, { readonly type: 'footnoteReference' }>[]] {
  const flat = withoutBreaks(transformInlineArray(nodes as LegacyNode[], ctx), undefined, ctx, 'footnote definition')
    .filter((n): n is Exclude<InlineWithoutBreak, { readonly type: 'footnoteReference' }> => n.type !== 'footnoteReference');
  return (flat.length > 0 ? flat : [{ type: 'text', value: ' ' }]) as never;
}
function plain(nodes: readonly Inline[]): string {
  return nodes.map((n) => (n.type === 'text' ? n.value : n.type === 'softBreak' || n.type === 'hardBreak' ? ' ' : 'children' in n ? plain(n.children) : '')).join('');
}
function altInline(value: unknown, ctx: Ctx): Inline[] {
  if (Array.isArray(value)) return coalesce(transformInlineArray(value as LegacyNode[], ctx));
  const text = typeof value === 'string' ? value : '';
  return text.length > 0 ? [{ type: 'text', value: text }] : [];
}
function explicitId(node: LegacyNode): string | undefined {
  return typeof node['id'] === 'string' && node['id'].length > 0 ? node['id'] : undefined;
}
function langOf(node: LegacyNode): string | undefined {
  return typeof node['lang'] === 'string' && node['lang'] !== 'math' ? node['lang'] : undefined;
}
function clampLevel(value: unknown): 1 | 2 | 3 | 4 | 5 | 6 {
  const n = typeof value === 'number' ? value : 1;
  return (n >= 1 && n <= 6 ? n : n < 1 ? 1 : 6) as 1 | 2 | 3 | 4 | 5 | 6;
}
function toAlignment(value: string): 'default' | 'left' | 'center' | 'right' {
  return value === 'left' || value === 'center' || value === 'right' ? value : 'default';
}
