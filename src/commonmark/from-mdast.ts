import type {
  CellAlignment, Document, DocumentBlock, FootnoteDefinition, Inline, InlineWithoutBreak,
  List, ListItem, ListItemBlock, NonEmptyArray, Paragraph, QuoteBlock, TableCell,
} from '../index.js';
import { format, parse } from '../index.js';

import { DiagnosticCollector, type MdastPosition } from './diagnostics.js';

interface MdNode {
  readonly type: string;
  readonly value?: string;
  readonly depth?: number;
  readonly lang?: string | null;
  readonly url?: string;
  readonly title?: string | null;
  readonly alt?: string;
  readonly ordered?: boolean;
  readonly start?: number | null;
  readonly checked?: boolean | null;
  readonly identifier?: string;
  readonly label?: string;
  readonly referenceType?: 'shortcut' | 'collapsed' | 'full';
  readonly align?: readonly (string | null)[];
  readonly children?: readonly MdNode[];
  readonly position?: MdastPosition & { readonly end: { readonly offset?: number } };
}

interface Definition { readonly url: string; readonly title?: string; readonly position?: MdastPosition }

export interface MdastImportOptions { readonly rawHtml: 'drop' | 'escape' }

interface Context {
  readonly source: string;
  readonly options: MdastImportOptions;
  readonly diagnostics: DiagnosticCollector;
  readonly definitions: ReadonlyMap<string, Definition>;
  readonly usedDefinitions: Set<string>;
  readonly footnoteDefinitions: ReadonlyMap<string, MdNode>;
  readonly referencedFootnotes: string[];
}

export function documentFromMdast(root: unknown, source: string, options: MdastImportOptions, diagnostics: DiagnosticCollector): Document {
  const node = root as MdNode;
  const definitions = new Map<string, Definition>();
  const footnoteDefinitions = new Map<string, MdNode>();
  for (const child of node.children ?? []) {
    if (child.type === 'definition' && child.identifier !== undefined && child.url !== undefined) {
      definitions.set(normalizeReference(child.identifier), optionalTitle(child.url, child.title, child.position));
    } else if (child.type === 'footnoteDefinition' && child.identifier !== undefined) {
      footnoteDefinitions.set(child.identifier, child);
    }
  }
  const context: Context = {
    source, options, diagnostics, definitions, usedDefinitions: new Set(), footnoteDefinitions, referencedFootnotes: [],
  };
  const children = mergeAdjacentLists(convertBlocks((node.children ?? []).filter((child) => child.type !== 'footnoteDefinition'), context, 'document'));
  for (const child of node.children ?? []) {
    if (child.type !== 'definition' || child.identifier === undefined) continue;
    const identifier = normalizeReference(child.identifier);
    if (!context.usedDefinitions.has(identifier)) diagnostics.add('source-structure-loss', `unused link definition [${child.label ?? child.identifier}] was removed`, child.position);
  }
  return { type: 'document', children, footnotes: convertFootnotes(context) };
}

function mergeAdjacentLists(blocks: DocumentBlock[]): DocumentBlock[] {
  const output: DocumentBlock[] = [];
  for (const block of blocks) {
    const previous = output.at(-1);
    if (block.type === 'list' && previous?.type === 'list' && block.kind === previous.kind) {
      if (block.kind === 'ordered') {
        const expected = finalVisibleNumber(previous) + 1;
        const actual = block.start ?? 1;
        if (actual !== expected) block.items[0]!.value = actual;
      }
      previous.items.push(...block.items);
    } else output.push(block);
  }
  return output;
}

function optionalTitle(url: string, title: string | null | undefined, position: MdastPosition | undefined): Definition {
  return {
    url,
    ...(title === null || title === undefined ? {} : { title }),
    ...(position === undefined ? {} : { position }),
  };
}

function convertBlocks(nodes: readonly MdNode[], context: Context, owner: 'document' | 'list'): DocumentBlock[] {
  const blocks: DocumentBlock[] = [];
  for (const node of nodes) {
    const firstAdded = blocks.length;
    switch (node.type) {
      case 'definition': break;
      case 'heading': {
        if (!/^#{1,6} /u.test(sourceSlice(node, context.source))) context.diagnostics.add('normalised', 'Setext heading was normalised to ATX form', node.position);
        const children = inlineChildren(node, context, false);
        if (children.length === 0) unrepresentableBlock(node, context, blocks, 'empty heading');
        else blocks.push({ type: 'heading', level: headingLevel(node.depth), children: asNonEmpty(withoutBreaks(children)) });
        break;
      }
      case 'paragraph': {
        const children = inlineChildren(node, context, true);
        if (children.length === 0) break;
        if (owner === 'document' && children.length === 1 && children[0]!.type === 'inlineImage') {
          const image = children[0];
          blocks.push({ type: 'imageBlock', src: image.src, alt: image.alt, ...(image.title === undefined ? {} : { title: image.title }) });
        } else blocks.push({ type: 'paragraph', children: asNonEmpty(children) });
        break;
      }
      case 'thematicBreak': {
        if (sourceSlice(node, context.source).trim() !== '---') context.diagnostics.add('normalised', 'thematic break was normalised to `---`', node.position);
        blocks.push({ type: 'horizontalRule' });
        break;
      }
      case 'code': {
        const lang = node.lang ?? undefined;
        if (lang === 'math' && validMathBlock(node.value ?? '')) blocks.push({ type: 'mathBlock', value: node.value ?? '' });
        else blocks.push({ type: 'codeBlock', value: node.value ?? '', ...(lang === undefined || lang === 'math' ? {} : { lang }) });
        break;
      }
      case 'blockquote': {
        const quoteChildren: QuoteBlock[] = [];
        appendQuote(node.children ?? [], 1, quoteChildren, context);
        if (quoteChildren.length > 0) blocks.push({ type: 'quoteRegion', children: asNonEmpty(quoteChildren) });
        break;
      }
      case 'list': blocks.push(convertList(node, context)); break;
      case 'table': blocks.push(convertTable(node, context)); break;
      case 'html':
        if (context.options.rawHtml === 'drop') context.diagnostics.add('content-dropped', 'raw HTML content was dropped', node.position);
        else {
          context.diagnostics.add('semantic-degradation', 'raw HTML was emitted as literal text', node.position);
          const escaped = textValueToInlines(node.value ?? '');
          if (escaped.length > 0) blocks.push({ type: 'paragraph', children: asNonEmpty(escaped) });
        }
        break;
      default: unrepresentableBlock(node, context, blocks, `unsupported CommonMark block ${node.type}`);
    }
    for (let index = firstAdded; index < blocks.length; index += 1) {
      const block = blocks[index]!;
      if (blockIsStable(block) || containsFootnoteReference(block)) continue;
      context.diagnostics.add('unrepresentable', `${node.type} has no direct byte-stable Markanto surface and was preserved as literal code`, node.position);
      const literal = sourceSlice(node, context.source).replace(/\n+$/u, '');
      blocks[index] = owner === 'list' && node.type === 'paragraph'
        ? { type: 'paragraph', children: [{ type: 'inlineCode', value: singleLineLiteral(literal) }] }
        : { type: 'codeBlock', value: literal };
    }
  }
  return mergeAdjacentLists(blocks);
}

function finalVisibleNumber(list: List): number {
  let visible = list.start ?? 1;
  for (let index = 1; index < list.items.length; index += 1) visible = list.items[index]!.value ?? visible + 1;
  return visible;
}

function appendQuote(nodes: readonly MdNode[], level: number, output: QuoteBlock[], context: Context): void {
  for (const node of nodes) {
    if (node.type === 'blockquote') appendQuote(node.children ?? [], level + 1, output, context);
    else {
      const converted = convertBlocks([node], context, 'list');
      for (const block of converted) {
        if (block.type === 'quoteRegion' || block.type === 'container') {
          context.diagnostics.add('unrepresentable', `${block.type} cannot be nested at this quote position`, node.position);
        } else output.push({ level, block });
      }
    }
  }
}

function convertList(node: MdNode, context: Context): List {
  const kind = node.ordered === true ? 'ordered' : 'unordered';
  const items: ListItem[] = [];
  let visible = node.start ?? 1;
  for (let index = 0; index < (node.children ?? []).length; index += 1) {
    const itemNode = node.children![index]!;
    const converted = convertBlocks(itemNode.children ?? [], context, 'list');
    let first = converted.shift();
    if (first?.type !== 'paragraph') {
      const replacement: Paragraph = { type: 'paragraph', children: [{ type: 'text', value: sourceSlice(itemNode, context.source) || ' ' }] };
      if (first !== undefined) converted.unshift(first);
      first = replacement;
      context.diagnostics.add('unrepresentable', 'list item without an introductory paragraph was preserved as literal text', itemNode.position);
    }
    const children: [Paragraph, ...ListItemBlock[]] = [first, ...converted.filter(isListItemBlock)];
    const task = itemNode.checked === true ? 'done' : itemNode.checked === false ? 'open' : undefined;
    const actual = kind === 'ordered' ? orderedMarker(itemNode, context.source) ?? visible : visible;
    const expected = index === 0 ? visible : visible + 1;
    const value = kind === 'ordered' && index > 0 && actual !== expected ? actual : undefined;
    items.push({ type: 'listItem', children, ...(task === undefined ? {} : { task }), ...(value === undefined ? {} : { value }) });
    visible = actual;
  }
  if (items.length === 0) {
    items.push({ type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: ' ' }] }] });
    context.diagnostics.add('unrepresentable', 'empty list was replaced with literal content', node.position);
  }
  return { type: 'list', kind, items: asNonEmpty(items), ...(kind === 'ordered' && node.start !== null && node.start !== undefined && node.start !== 1 ? { start: node.start } : {}) };
}

function isListItemBlock(block: DocumentBlock): block is ListItemBlock {
  return block.type !== 'heading' && block.type !== 'horizontalRule' && block.type !== 'container';
}

function convertTable(node: MdNode, context: Context): DocumentBlock {
  const rows = node.children ?? [];
  const width = node.align?.length ?? rows[0]?.children?.length ?? 0;
  if (width === 0 || rows.length === 0) return literalParagraph(node, context, 'empty GFM table is not representable');
  const alignments = (node.align ?? Array.from({ length: width }, () => null)).map(toAlignment);
  const convertedRows = rows.map((row) => ({
    type: 'tableRow' as const,
    cells: Array.from({ length: width }, (_, index): TableCell => ({
      type: 'tableCell', children: inlineChildren(row.children?.[index] ?? { type: 'tableCell', children: [] }, context, false) as InlineWithoutBreak[],
    })),
  }));
  return { type: 'table', alignments: asNonEmpty(alignments), head: convertedRows[0]!, body: convertedRows.slice(1) };
}

function toAlignment(value: string | null): CellAlignment {
  return value === 'left' || value === 'center' || value === 'right' ? value : 'default';
}

function inlineChildren(node: MdNode, context: Context, allowBreaks: boolean): Inline[] {
  const output: Inline[] = [];
  for (const child of node.children ?? []) appendInline(child, output, context, allowBreaks);
  while (output[0]?.type === 'softBreak' || output[0]?.type === 'hardBreak') output.shift();
  while (output.at(-1)?.type === 'softBreak' || output.at(-1)?.type === 'hardBreak') output.pop();
  return coalesceText(output);
}

function appendInline(node: MdNode, output: Inline[], context: Context, allowBreaks: boolean): void {
  switch (node.type) {
    case 'text': appendTextAndBreaks(node.value ?? '', output, allowBreaks, node, context); break;
    case 'break': output.push({ type: 'hardBreak' }); break;
    case 'inlineCode': output.push({ type: 'inlineCode', value: node.value ?? '' }); break;
    case 'emphasis': appendWrapper('em', node, output, context, allowBreaks); break;
    case 'strong': appendWrapper('strong', node, output, context, allowBreaks); break;
    case 'delete': appendWrapper('deletion', node, output, context, allowBreaks); break;
    case 'link': appendLink(node, output, context); break;
    case 'image': output.push({ type: 'inlineImage', src: node.url ?? '', alt: [{ type: 'text', value: node.alt ?? '' }], ...(node.title === null || node.title === undefined ? {} : { title: node.title }) }); break;
    case 'linkReference': appendReference(node, output, context, false); break;
    case 'imageReference': appendReference(node, output, context, true); break;
    case 'footnoteReference': {
      const identifier = node.identifier ?? '';
      if (validIdentifier(identifier) && context.footnoteDefinitions.has(identifier)) {
        output.push({ type: 'footnoteReference', identifier });
        if (!context.referencedFootnotes.includes(identifier)) context.referencedFootnotes.push(identifier);
      } else literalInline(node, output, context, 'unresolved or invalid footnote reference was kept as literal text', 'semantic-degradation');
      break;
    }
    case 'html':
      context.diagnostics.add('semantic-degradation', context.options.rawHtml === 'drop' ? 'raw inline HTML markup was removed while surrounding text was preserved' : 'raw inline HTML was emitted as literal text', node.position);
      if (context.options.rawHtml === 'escape') output.push({ type: 'text', value: node.value ?? '' });
      break;
    default: literalInline(node, output, context, `unsupported CommonMark inline ${node.type}`, 'unrepresentable');
  }
}

function appendWrapper(type: 'em' | 'strong' | 'deletion', node: MdNode, output: Inline[], context: Context, allowBreaks: boolean): void {
  const children = inlineChildren(node, context, allowBreaks);
  if (children.length === 0) {
    context.diagnostics.add('source-structure-loss', `empty ${type} wrapper was removed`, node.position);
    return;
  }
  if (children.some((child) => child.type === 'softBreak' || child.type === 'hardBreak' || child.type === type)) {
    context.diagnostics.add('semantic-degradation', `multiline or directly nested ${type} wrapper was removed while preserving its content`, node.position);
    output.push(...children);
    return;
  }
  output.push({ type, children: asNonEmpty(children) });
}

function appendLink(node: MdNode, output: Inline[], context: Context): void {
  const children = inlineChildren(node, context, false);
  const url = node.url ?? '';
  const plain = plainText(children);
  if (children.length === 0 || containsAnchor(children)) {
    context.diagnostics.add('semantic-degradation', 'empty or nested-anchor link semantics were removed while preserving literal content', node.position);
    const literal = sourceSlice(node, context.source);
    if (literal.length > 0) output.push({ type: 'text', value: literal });
    return;
  }
  if (plain !== null && ((plain === url && /^https?:\/\//u.test(url)) || (url === `mailto:${plain}` && plain.includes('@')) || (plain.startsWith('www.') && url.endsWith(plain)))) {
    output.push({ type: 'autolink', kind: plain.includes('@') && url.startsWith('mailto:') ? 'email' : 'url', value: url.startsWith('mailto:') ? plain : url });
  } else output.push({ type: 'link', href: url, children, ...(node.title === null || node.title === undefined ? {} : { title: node.title }) });
}

function appendReference(node: MdNode, output: Inline[], context: Context, image: boolean): void {
  const identifier = normalizeReference(node.identifier ?? '');
  const definition = context.definitions.get(identifier);
  if (definition === undefined) {
    literalInline(node, output, context, `unresolved ${image ? 'image' : 'link'} reference was kept as literal text`, 'semantic-degradation');
    return;
  }
  const referenceChildren = image
    ? (node.alt === undefined || node.alt.length === 0 ? [] : [{ type: 'text' as const, value: node.alt }])
    : inlineChildren(node, context, false);
  if (!image && plainText(referenceChildren)?.endsWith('\\') === true) {
    literalInline(node, output, context, 'reference label cannot be represented safely in a canonical direct link', 'unrepresentable');
    return;
  }
  context.usedDefinitions.add(identifier);
  context.diagnostics.add('resolved', `${image ? 'image' : 'link'} reference [${node.label ?? node.identifier ?? ''}] was resolved to direct form`, node.position);
  if (image) {
    output.push({ type: 'inlineImage', src: definition.url, alt: referenceChildren, ...safeTitle(definition, node, context) });
  } else {
    output.push({ type: 'link', href: definition.url, children: referenceChildren, ...safeTitle(definition, node, context) });
  }
}

function safeTitle(definition: Definition, node: MdNode, context: Context): { readonly title?: string } {
  if (definition.title === undefined) return {};
  if (!definition.title.includes('\n') && !definition.title.includes('\r')) return { title: definition.title };
  context.diagnostics.add('content-dropped', 'a multiline reference title was dropped because Markanto links are line-local', node.position);
  return {};
}

function convertFootnotes(context: Context): FootnoteDefinition[] {
  const referenced = context.referencedFootnotes;
  const remaining = [...context.footnoteDefinitions.keys()].filter((identifier) => !referenced.includes(identifier)).sort();
  const output: FootnoteDefinition[] = [];
  for (const identifier of [...referenced, ...remaining]) {
    const node = context.footnoteDefinitions.get(identifier)!;
    if (!validIdentifier(identifier)) {
      context.diagnostics.add('unrepresentable', `footnote identifier ${JSON.stringify(identifier)} is not valid in Markanto`, node.position);
      continue;
    }
    const blockChildren = node.children ?? [];
    const flattened: Inline[] = [];
    for (let index = 0; index < blockChildren.length; index += 1) {
      if (index > 0) flattened.push({ type: 'text', value: ' ' });
      const block = blockChildren[index]!;
      if (block.type === 'paragraph' || block.type === 'heading') flattened.push(...inlineChildren(block, context, false));
      else flattened.push({ type: 'text', value: sourceSlice(block, context.source).replace(/\s+/gu, ' ').trim() });
    }
    if (blockChildren.length !== 1 || blockChildren[0]?.type !== 'paragraph') context.diagnostics.add('source-structure-loss', `block content in footnote [^${identifier}] was flattened to inline content`, node.position);
    const children = coalesceText(flattened).filter((child): child is Exclude<InlineWithoutBreak, { readonly type: 'footnoteReference' }> => child.type !== 'softBreak' && child.type !== 'hardBreak' && child.type !== 'footnoteReference');
    if (children.length === 0) children.push({ type: 'text', value: ' ' });
    output.push({ type: 'footnoteDefinition', identifier, children: asNonEmpty(children) });
  }
  return output;
}

function appendTextAndBreaks(value: string, output: Inline[], allowBreaks: boolean, node: MdNode, context: Context): void {
  const pieces = value.split('\n');
  for (let index = 0; index < pieces.length; index += 1) {
    if (index > 0) {
      if (allowBreaks) output.push({ type: 'softBreak' });
      else {
        context.diagnostics.add('source-structure-loss', 'line break in a line-local inline context was replaced with a space', node.position);
        output.push({ type: 'text', value: ' ' });
      }
    }
    if (pieces[index]!.length > 0) output.push({ type: 'text', value: pieces[index]! });
  }
}

function literalInline(node: MdNode, output: Inline[], context: Context, message: string, category: 'semantic-degradation' | 'unrepresentable'): void {
  context.diagnostics.add(category, message, node.position);
  const value = sourceSlice(node, context.source);
  if (value.length > 0) output.push({ type: 'text', value });
}

function literalParagraph(node: MdNode, context: Context, message: string): Paragraph {
  context.diagnostics.add('unrepresentable', message, node.position);
  return { type: 'paragraph', children: [{ type: 'text', value: sourceSlice(node, context.source) || ' ' }] };
}

function unrepresentableBlock(node: MdNode, context: Context, output: DocumentBlock[], message: string): void {
  const paragraph = literalParagraph(node, context, message);
  const first = paragraph.children[0]!;
  if (first.type !== 'text' || first.value.trim().length > 0) output.push(paragraph);
}

function sourceSlice(node: MdNode, source: string): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? node.value ?? '' : source.slice(start, end);
}

function orderedMarker(node: MdNode, source: string): number | undefined {
  const start = node.position?.start.offset;
  if (start === undefined) return undefined;
  const end = source.indexOf('\n', start);
  const firstLine = source.slice(start, end < 0 ? source.length : end);
  const match = /^ {0,3}([0-9]{1,9})[.)][ \t]/u.exec(firstLine);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function textValueToInlines(value: string): Inline[] {
  const output: Inline[] = [];
  const lines = value.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0) output.push({ type: 'softBreak' });
    if (lines[index]!.length > 0) output.push({ type: 'text', value: lines[index]! });
  }
  return output;
}

function coalesceText(nodes: Inline[]): Inline[] {
  const output: Inline[] = [];
  for (const node of nodes) {
    const previous = output.at(-1);
    if (node.type === 'text' && previous?.type === 'text') previous.value += node.value;
    else output.push(node);
  }
  return output;
}

function plainText(nodes: readonly Inline[]): string | null {
  let value = '';
  for (const node of nodes) {
    if (node.type !== 'text') return null;
    value += node.value;
  }
  return value;
}

function withoutBreaks(nodes: readonly Inline[]): InlineWithoutBreak[] {
  return nodes.filter((node): node is InlineWithoutBreak => node.type !== 'softBreak' && node.type !== 'hardBreak');
}

function blockIsStable(block: DocumentBlock): boolean {
  const result = format({ type: 'document', children: [block], footnotes: [] });
  if (result.status !== 'ok') return false;
  const parsed = parse(result.source, { strict: true });
  if (parsed.status !== 'ok') return false;
  const again = format(parsed.document);
  return again.status === 'ok' && again.source === result.source;
}

function containsFootnoteReference(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current !== 'object' || current === null) continue;
    const record = current as Record<string, unknown>;
    if (record['type'] === 'footnoteReference') return true;
    for (const child of Object.values(record)) {
      if (Array.isArray(child)) stack.push(...child);
      else if (typeof child === 'object' && child !== null) stack.push(child);
    }
  }
  return false;
}

function containsAnchor(children: readonly Inline[]): boolean {
  const stack: Inline[] = [...children];
  while (stack.length > 0) {
    const child = stack.pop()!;
    if (child.type === 'link' || child.type === 'autolink' || child.type === 'footnoteReference') return true;
    if ('children' in child && Array.isArray(child.children)) stack.push(...child.children);
  }
  return false;
}

function singleLineLiteral(value: string): string {
  const flattened = value.replace(/\n/gu, ' ');
  return flattened.length === 0 ? ' ' : flattened;
}

function normalizeReference(value: string): string { return value.trim().replace(/\s+/gu, ' ').toLowerCase(); }
function validIdentifier(value: string): boolean { return /^[A-Za-z0-9_-]+$/u.test(value); }
// A ```` ```math ```` fence is an explicit author signal; Core does not
// validate TeX in a `MathBlock` either, so a non-empty body is enough here.
function validMathBlock(value: string): boolean { return value.length > 0; }
function headingLevel(value: number | undefined): 1 | 2 | 3 | 4 | 5 | 6 { return value !== undefined && value >= 1 && value <= 6 ? value as 1 | 2 | 3 | 4 | 5 | 6 : 1; }
function asNonEmpty<T>(values: T[]): NonEmptyArray<T> { return values as NonEmptyArray<T>; }
