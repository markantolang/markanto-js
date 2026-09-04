import type { AudioBlock, Container, Document, DocumentBlock, DownloadBlock, EmbedBlock, Grid, GridCell, GridRow, ImageBlock, Inline, List, QuoteRegion, ResourceBudget, Table, TableRow, VideoBlock } from '../ast.js';
import { isIdentifier, splitSameLineId } from '../parser/block-id.js';
import { isLinedHeaderIntroducer, isValidTypeString, normalizeType } from '../parser/containers.js';
import { diagnostic, type Diagnostic } from '../diagnostics.js';
import type { CanonicalFormatResult } from '../parser-contract.js';
import { atomicTokenEnd } from '../parser/inline/atomic.js';
import { characterClass, isUnicodeWhitespace } from '../parser/inline/unicode.js';
import { scanEntity } from '../parser/inline/entities.js';
import { hasAttrs, isWellFormedBcp47, normalizeGroup, validateAttributeContext, type AttributeContext, type MKind, type ParsedAttributes } from '../parser/resources.js';
import { canonicalFootnoteOrder } from '../parser/footnotes.js';
import { exceedsGridMatrixBudget } from '../parser/grid.js';
import { DEFAULT_VALIDATION_BUDGET } from '../validator/shape.js';

/** Thrown deep in the recursive `formatInline` when inline nesting exceeds the
 * frame budget; caught in `format()` and turned into a `resource` result. */
class InlineFrameBudgetError extends Error {}
/**
 * `formatInline` is recursive, so its depth is capped below the host stack
 * limit regardless of `maxFrames`: real documents never nest inline markup
 * this far, and anything deeper must return `resource`, not a `RangeError`.
 */
const INLINE_FRAME_CAP = 1000;
let inlineFrameBudget = INLINE_FRAME_CAP;
let inlineFrameDepth = 0;

export function format(document: Document, budget?: ResourceBudget): CanonicalFormatResult {
  const diagnostics: Diagnostic[] = [];
  if (document.type !== 'document') {
    return invalid('not a document');
  }
  for (const block of document.children) {
    if ('id' in block && block.id !== undefined && !isIdentifier(block.id)) return invalid('invalid block id');
  }
  if (exceedsGridMatrixBudget(document, budget)) {
    return { status: 'resource', diagnostics: [diagnostic('resource', 'error', { message: 'grid matrix slot budget exceeded' })] };
  }
  const maxFrames = budget?.maxFrames ?? DEFAULT_VALIDATION_BUDGET.maxFrames;
  inlineFrameBudget = Math.min(maxFrames, INLINE_FRAME_CAP);
  inlineFrameDepth = 0;
  try {
    const body = formatBlockLines(document.children, maxFrames);
    if (body.status === 'resource') return body;
    if (body.status === 'invalid') return invalid('cannot format document');
    const footnotes = formatFootnotes(document);
    if (footnotes === null) return invalid('footnotes are not in canonical form');
    const bodySource = body.lines.join('\n');
    let source = bodySource.length === 0 && footnotes.length > 0 ? footnotes : bodySource + footnotes;
    if (!source.endsWith('\n')) source += '\n';
    return { status: 'ok', source, diagnostics };
  } catch (error) {
    if (error instanceof InlineFrameBudgetError) {
      return { status: 'resource', diagnostics: [diagnostic('resource', 'error', { message: 'formatter inline frame budget exceeded' })] };
    }
    throw error;
  }
}

function formatFootnotes(document: Document): string | null {
  if (document.footnotes.length === 0) return '';
  const order = canonicalFootnoteOrder(document.children, document.footnotes);
  if (order === null) return null;
  if (order.length !== document.footnotes.length) return null;
  for (let index = 0; index < order.length; index += 1) {
    if (document.footnotes[index]!.identifier !== order[index]) return null;
  }
  const lines: string[] = [];
  for (const definition of document.footnotes) {
    if (!isIdentifier(definition.identifier)) return null;
    if (definition.id !== undefined && !isIdentifier(definition.id)) return null;
    const content = formatInline(definition.children, false);
    if (content === null || content.length === 0) return null;
    lines.push(`[^${definition.identifier}]: ${content}${definition.id === undefined ? '' : `\n{#${definition.id}}`}`);
  }
  return `\n\n${lines.join('\n')}`;
}

interface PrefixSpec { readonly text: string; readonly blank: string }
const NO_PREFIX: PrefixSpec = { text: '', blank: '' };
type FormatLinesResult =
  | { readonly status: 'ok'; readonly lines: string[] }
  | { readonly status: 'invalid' }
  | { readonly status: 'resource'; readonly diagnostics: readonly Diagnostic[] };
type BlockTask = { readonly kind: 'block'; readonly block: DocumentBlock; readonly first: PrefixSpec; readonly rest: PrefixSpec; readonly depth: number; readonly gridCell?: boolean };
type SequenceTask = { readonly kind: 'sequence'; readonly blocks: readonly DocumentBlock[]; readonly first: PrefixSpec; readonly rest: PrefixSpec; readonly depth: number; readonly gridCell?: boolean };
type LineTask = { readonly kind: 'line'; readonly value: string; readonly prefix: PrefixSpec };
type Task = BlockTask | SequenceTask | LineTask;

/** Explicit-stack block writer. Every final line is prefixed and emitted once. */
function formatBlockLines(blocks: readonly DocumentBlock[], maxFrames: number): FormatLinesResult {
  const lines: string[] = [];
  const tasks: Task[] = [{ kind: 'sequence', blocks, first: NO_PREFIX, rest: NO_PREFIX, depth: 1 }];
  const pushForward = (forward: readonly Task[]): void => {
    for (let index = forward.length - 1; index >= 0; index -= 1) tasks.push(forward[index]!);
  };
  while (tasks.length > 0) {
    const task = tasks.pop()!;
    if (task.kind === 'line') {
      lines.push(task.value.length === 0 ? task.prefix.blank : `${task.prefix.text}${task.value}`);
      continue;
    }
    const structural = task.kind === 'sequence' || task.block.type === 'list' || task.block.type === 'quoteRegion' || task.block.type === 'container';
    if (structural && task.depth > maxFrames) {
      return { status: 'resource', diagnostics: [diagnostic('resource', 'error', { message: 'formatter frame budget exceeded' })] };
    }
    if (task.kind === 'sequence') {
      const forward: Task[] = [];
      for (let index = 0; index < task.blocks.length; index += 1) {
        if (index > 0) forward.push({ kind: 'line', value: '', prefix: task.rest });
        forward.push({
          kind: 'block', block: task.blocks[index]!,
          first: index === 0 ? task.first : task.rest, rest: task.rest, depth: task.depth,
          ...(task.gridCell === true ? { gridCell: true } : {}),
        });
      }
      pushForward(forward);
      continue;
    }
    const expanded = expandBlock(task);
    if (expanded === null) return { status: 'invalid' };
    pushForward(expanded);
  }
  return { status: 'ok', lines };
}

function constantPrefix(value: string): PrefixSpec { return { text: value, blank: value }; }
/** List-item indentation: a blank line inside the item carries no trailing whitespace. */
const INDENT_PREFIX: PrefixSpec = { text: '  ', blank: '' };
function quotePrefix(level: number): PrefixSpec {
  return { text: '> '.repeat(level), blank: `${'> '.repeat(level - 1)}>` };
}
/** Apply `inner` first, then `outer`. */
function composePrefix(outer: PrefixSpec, inner: PrefixSpec): PrefixSpec {
  return {
    text: outer.text + inner.text,
    blank: inner.blank.length === 0 ? outer.blank : outer.text + inner.blank,
  };
}
function lineTasks(source: string, first: PrefixSpec, rest: PrefixSpec): Task[] {
  const values = source.split('\n');
  return values.map((value, index) => ({ kind: 'line', value, prefix: index === 0 ? first : rest }));
}

function expandBlock(task: BlockTask): Task[] | null {
  const { block, first, rest, depth } = task;
  if (block.type === 'list') return expandList(block, first, rest, depth);
  if (block.type === 'quoteRegion') return expandQuote(block, first, rest, depth);
  if (block.type === 'container') return expandContainer(block, first, rest, depth);
  const source = formatLeafBlock(block, task.gridCell === true);
  return source === null ? null : lineTasks(source, first, rest);
}

function formatLeafBlock(block: DocumentBlock, gridCell = false): string | null {
  switch (block.type) {
    case 'heading': {
      if (!Number.isInteger(block.level) || block.level < 1 || block.level > 6) return null;
      const rendered = formatInline(block.children, false, false, false, true);
      if (rendered === null) return null;
      const text = guardHeadingText(rendered);
      if (text === null || text.length === 0) return null;
      return `${'#'.repeat(block.level)} ${text}${block.id === undefined ? '' : ` {#${block.id}}`}`;
    }
    case 'paragraph': {
      if (block.children.length === 1 && (block.children[0]?.type === 'inlineImage' || block.children[0]?.type === 'link' && block.children[0].download === true)) return null;
      if (block.children.length === 1 && block.children[0]?.type === 'text' && equalsOnly(block.children[0].value)) {
        // `===`+ stays a literal paragraph (no Setext); exactly `==` collides
        // with the Grid row separator inside a cell and must be escaped there.
        const value = block.children[0].value;
        const rendered = gridCell && value === '==' ? '\\==' : value;
        return `${rendered}${block.id === undefined ? '' : `\n{#${block.id}}`}`;
      }
      const text = formatInline(block.children, true, false, false, true);
      if (text === null || text.length === 0) return null;
      const guarded = guardParagraphLines(text.split('\n'), gridCell).join('\n');
      return `${guarded}${block.id === undefined ? '' : `\n{#${block.id}}`}`;
    }
    case 'horizontalRule':
      return `---${block.id === undefined ? '' : ` {#${block.id}}`}`;
    case 'codeBlock': {
      if (
        block.lang === 'math' ||
        (block.lang !== undefined && !isValidLanguageToken(block.lang))
      ) return null;
      return formatFence(block.value, block.lang, block.id);
    }
    case 'mathBlock':
      return formatFence(block.value, 'math', block.id);
    case 'commentBlock':
      if (block.value.includes('-->')) return null;
      return `<!--${block.value}-->`;
    case 'imageBlock': return formatResourceBlock('image', block);
    case 'videoBlock': return formatResourceBlock('video', block);
    case 'audioBlock': return formatResourceBlock('audio', block);
    case 'embedBlock': return formatResourceBlock('embed', block);
    case 'downloadBlock': return formatResourceBlock('download', block);
    case 'quoteRegion':
    case 'list': return null;
    case 'table': return formatTable(block);
    case 'container': return null;
    default:
      return null;
  }
}

function formatTable(block: Table): string | null {
  if (block.alignments.length === 0) return null;
  const width = block.alignments.length;
  const cells = (row: TableRow): string[] | null => {
    if (row.cells.length !== width) return null;
    const out: string[] = [];
    for (const cell of row.cells) {
      const content = cell.children.length === 0 ? '' : formatInline(cell.children, false, false, true, true);
      if (content === null || content.includes('\n')) return null;
      out.push(content);
    }
    return out;
  };
  const renderRow = (values: readonly string[]): string => `| ${values.join(' | ')} |`;
  const head = cells(block.head);
  if (head === null) return null;
  const separator = block.alignments.map((alignment) =>
    alignment === 'center' ? ':---:' : alignment === 'left' ? ':---' : alignment === 'right' ? '---:' : '---');
  const rows = [renderRow(head), renderRow(separator)];
  for (const bodyRow of block.body) {
    const values = cells(bodyRow);
    if (values === null) return null;
    rows.push(renderRow(values));
  }
  return `${rows.join('\n')}${block.id === undefined ? '' : `\n{#${block.id}}`}`;
}

function expandList(block: List, first: PrefixSpec, rest: PrefixSpec, depth: number): Task[] | null {
  if (block.items.length === 0) return null;
  if (block.kind !== 'ordered' && block.start !== undefined || block.start === 1 || block.start !== undefined && !validListNumber(block.start)) return null;
  let visible = block.kind === 'ordered' ? block.start ?? 1 : 0;
  const tasks: Task[] = [];
  for (let index = 0; index < block.items.length; index += 1) {
    const item = block.items[index]!;
    if (item.children.length === 0 || item.children[0].type !== 'paragraph') return null;
    if (block.kind === 'definition' && (item.task !== undefined || item.value !== undefined) || block.kind !== 'ordered' && item.value !== undefined) return null;
    if (index === 0 && item.value !== undefined) return null;
    if (block.kind === 'ordered' && index > 0) {
      const expected = visible + 1;
      if (item.value !== undefined) { if (!validListNumber(item.value) || item.value === expected) return null; visible = item.value; }
      else visible = expected;
    }
    if (item.children[0].id !== undefined) return null;
    const marker = block.kind === 'unordered' ? '- ' : block.kind === 'definition' ? ': ' : `${visible}. `;
    const task = item.task === undefined ? '' : item.task === 'open' ? '[ ] ' : item.task === 'done' ? '[x] ' : null;
    if (task === null) return null;
    const itemFirst = index === 0 ? first : rest;
    tasks.push({
      kind: 'block', block: item.children[0],
      first: composePrefix(itemFirst, constantPrefix(`${marker}${task}`)),
      rest: composePrefix(rest, INDENT_PREFIX), depth: depth + 1,
    });
    for (let childIndex = 1; childIndex < item.children.length; childIndex += 1) {
      const child = item.children[childIndex]!;
      if ('id' in child && child.id !== undefined) return null;
      const simpleSubList = item.children.length === 2 && childIndex === 1 && child.type === 'list';
      if (!simpleSubList) tasks.push({ kind: 'line', value: '', prefix: rest });
      tasks.push({
        kind: 'block', block: child,
        first: composePrefix(rest, INDENT_PREFIX),
        rest: composePrefix(rest, INDENT_PREFIX), depth: depth + 1,
      });
    }
  }
  if (block.id !== undefined) tasks.push({ kind: 'line', value: `{#${block.id}}`, prefix: rest });
  return tasks;
}

function validListNumber(value: number): boolean { return Number.isInteger(value) && value >= 0 && value <= 999_999_999; }

function expandQuote(block: QuoteRegion, first: PrefixSpec, rest: PrefixSpec, depth: number): Task[] | null {
  if (block.children.length === 0 || block.children[0]!.level !== 1) return null;
  const tasks: Task[] = [];
  let previous = 1;
  for (const entry of block.children) {
    if (!Number.isInteger(entry.level) || entry.level < 1 || entry.level > previous + 1) return null;
    if ('id' in entry.block && entry.block.id !== undefined) return null;
    if (tasks.length > 0 && entry.level === previous) {
      tasks.push({ kind: 'line', value: '', prefix: composePrefix(rest, quotePrefix(entry.level)) });
    }
    const outerFirst = tasks.length === 0 ? first : rest;
    tasks.push({
      kind: 'block', block: entry.block,
      first: composePrefix(outerFirst, quotePrefix(entry.level)),
      rest: composePrefix(rest, quotePrefix(entry.level)), depth: depth + 1,
    });
    previous = entry.level;
  }
  if (block.attribution !== undefined) {
    const attribution = formatInline(block.attribution, false);
    if (attribution === null || attribution.length === 0 || attribution.includes('\n')) return null;
    tasks.push({ kind: 'line', value: `-- ${attribution}`, prefix: rest });
  }
  if (block.id !== undefined) tasks.push({ kind: 'line', value: `{#${block.id}}`, prefix: rest });
  return tasks;
}

type ResourceBlock = ImageBlock | VideoBlock | AudioBlock | EmbedBlock | DownloadBlock;

function formatResourceBlock(context: AttributeContext, block: ResourceBlock): string | null {
  if (block.attrs !== undefined && !hasAttrs(block.attrs)) return null;
  const isImage = block.type === 'imageBlock';
  const labelNodes = isImage ? block.alt : block.label;
  if (containsLinkLike(labelNodes)) return null;
  const label = labelNodes.length === 0 ? '' : formatInline(labelNodes, false, true);
  if (label === null || !validOptionalTitle(block.title)) return null;
  const target = block.type === 'embedBlock' ? block.target : block.type === 'downloadBlock' ? block.href : block.src;
  const destination = formatDestination(target);
  if (destination === null) return null;
  const primary = `${isImage ? '!' : ''}[${label}](${destination}${formatTitle(block.title)})`;
  const attrs = block.attrs ?? {};
  const kind: MKind | null = isImage ? null : block.type === 'videoBlock' ? 'video' : block.type === 'audioBlock' ? 'audio' : block.type === 'embedBlock' ? 'embed' : 'download';
  const caption = block.caption === undefined ? null : formatInline(block.caption, false);
  if (block.caption !== undefined && (caption === null || caption.length === 0)) return null;
  let source: string;
  if (isImage && !hasAttrs(attrs)) {
    source = caption === null ? primary : `${primary}\\\n*${caption}*`;
  } else {
    const opener = formatMOpen(kind, attrs, context);
    if (opener === null) return null;
    source = caption === null ? `${opener}${primary}</m>` : `${opener}${primary}\\\n*${caption}*</m>`;
  }
  return `${source}${block.id === undefined ? '' : `\n{#${block.id}}`}`;
}

function formatMOpen(kind: MKind | null, attrs: ParsedAttributes, context: AttributeContext): string | null {
  for (const key of Object.keys(attrs)) if (key !== 'group' && key !== 'lang' && key !== 'preview' && key !== 'dataAttrs') return null;
  if (validateAttributeContext(context, attrs) !== null) return null;
  if (attrs.group !== undefined && normalizeGroup(attrs.group) !== attrs.group) return null;
  if (attrs.lang !== undefined && (attrs.lang !== asciiLower(attrs.lang) || !isWellFormedBcp47(attrs.lang))) return null;
  if (attrs.dataAttrs !== undefined && Object.keys(attrs.dataAttrs).length === 0) return null;
  const tokens: Array<{ key: string; value: string }> = [];
  if (attrs.group !== undefined) tokens.push({ key: 'group', value: attrs.group });
  if (attrs.lang !== undefined) tokens.push({ key: 'lang', value: attrs.lang });
  if (attrs.preview !== undefined) tokens.push({ key: 'preview', value: attrs.preview });
  tokens.sort((a, b) => asciiCompare(a.key, b.key));
  if (attrs.dataAttrs !== undefined) {
    const keys = Object.keys(attrs.dataAttrs).sort(asciiCompare);
    for (const key of keys) {
      if (!validDataName(key)) return null;
      tokens.push({ key: `data-${key}`, value: attrs.dataAttrs[key]! });
    }
  }
  if (kind === null && tokens.length === 0 && context === 'generic') return null;
  const rendered: string[] = [];
  for (const { key, value } of tokens) { const formatted = formatAttributeValue(value); if (formatted === null) return null; rendered.push(`${key}=${formatted}`); }
  const suffix = rendered.join(' ');
  return `<m${kind === null ? '' : ` ${kind}`}${suffix.length === 0 ? '' : ` ${suffix}`}>`;
}

function formatAttributeValue(value: string): string | null {
  if (value.length > 0 && bareAttributeValue(value)) return value;
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === '\n' || character === '\r') return null;
    output += character === '"' || character === '\\' ? `\\${character}` : character;
  }
  return `"${output}"`;
}

function bareAttributeValue(value: string): boolean {
  for (let index = 0; index < value.length; ) {
    const cp = value.codePointAt(index)!;
    if (isUnicodeWhitespace(cp) || cp === 0x22 || cp === 0x27 || cp === 0x5c || cp === 0x3c || cp === 0x3e) return false;
    index += cp > 0xffff ? 2 : 1;
  }
  return true;
}
function validDataName(value: string): boolean { if (value.length === 0 || value.charCodeAt(0) < 0x61 || value.charCodeAt(0) > 0x7a) return false; for (let i = 1; i < value.length; i += 1) { const c = value.charCodeAt(i); if (!((c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c === 0x5f || c === 0x2d)) return false; } return true; }
function asciiCompare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function asciiLower(value: string): string { let output = ''; for (let i = 0; i < value.length; i += 1) { const c = value.charCodeAt(i); output += String.fromCharCode(c >= 0x41 && c <= 0x5a ? c + 0x20 : c); } return output; }

function expandContainer(block: Container, first: PrefixSpec, rest: PrefixSpec, depth: number): Task[] | null {
  const type = block.containerType;
  const title = block.title;
  if (type === null && title !== null) return null;
  if (title !== null && title.length === 0) return null;
  if (type !== null) {
    if (type.length === 0 || !isValidTypeString(type) || normalizeType(type) !== type) return null;
  }
  if (block.children.length === 0) return null;
  if (block.id !== undefined && !isIdentifier(block.id)) return null;
  const idTask = block.id === undefined ? [] : [{ kind: 'line', value: `{#${block.id}}`, prefix: rest } as const];

  if (block.form === 'fenced') {
    if (block.children.some((child) => child.type === 'grid')) {
      if (block.children.length !== 1) return null; // Grid must be the sole child
      const grid = expandGrid(block.children[0] as Grid, type, title, first, rest, depth);
      return grid === null ? null : [...grid, ...idTask];
    }
    return [
      { kind: 'line', value: `:::${headerOf(type, title)}`, prefix: first },
      { kind: 'sequence', blocks: block.children as readonly DocumentBlock[], first: rest, rest, depth: depth + 1 },
      { kind: 'line', value: ':::', prefix: rest },
      ...idTask,
    ];
  }
  if (type !== null && isLinedHeaderIntroducer(type + (title === null ? '' : ` ${title}`))) return null;
  const tasks: Task[] = [];
  if (type !== null) tasks.push({ kind: 'line', value: `${type}${title === null ? '' : ` ${title}`}`, prefix: first });
  tasks.push({ kind: 'line', value: '___', prefix: type === null ? first : rest });
  tasks.push({ kind: 'line', value: '', prefix: rest });
  tasks.push({ kind: 'sequence', blocks: block.children as readonly DocumentBlock[], first: rest, rest, depth: depth + 1 });
  tasks.push({ kind: 'line', value: '___', prefix: rest });
  tasks.push(...idTask);
  return tasks;
}

function headerOf(type: string | null, title: string | null): string {
  if (type === null) return '';
  return title === null ? ` ${type}` : ` ${type} ${title}`;
}

function expandGrid(grid: Grid, type: string | null, title: string | null, first: PrefixSpec, rest: PrefixSpec, depth: number): Task[] | null {
  const columns = grid.columns;
  if (!Number.isInteger(columns) || columns < 1) return null;
  if (grid.rows.length === 0) return null;
  const headerRows: readonly GridRow[] = grid.header === undefined ? [] : grid.header;
  const hasHeader = grid.header !== undefined;
  if (hasHeader && headerRows.length === 0) return null;
  if (!hasHeader && columns === 1 && grid.rows.length === 1) return null;
  const bodyRows = grid.rows;

  const buildRegion = (rows: readonly GridRow[]): RegionModel | null => {
    const occupancy: Array<Array<number | null>> = rows.map(() =>
      Array.from({ length: columns }, () => null),
    );
    const cells: GridCell[] = [];
    const anchorRow: number[] = [];
    const anchorCol: number[] = [];
    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r]!;
      let previous = 0;
      for (const cell of row.cells) {
        if (!Number.isInteger(cell.column) || cell.column < 1 || cell.column > columns) return null;
        if (cell.column <= previous) return null;
        previous = cell.column;
        if (cell.rowSpan !== undefined && (!Number.isInteger(cell.rowSpan) || cell.rowSpan < 2)) return null;
        if (cell.colSpan !== undefined && (!Number.isInteger(cell.colSpan) || cell.colSpan < 2)) return null;
        const rowSpan = cell.rowSpan ?? 1;
        const colSpan = cell.colSpan ?? 1;
        const base = cell.column - 1;
        if (r + rowSpan > rows.length || base + colSpan > columns) return null;
        const cellIndex = cells.length;
        cells.push(cell);
        anchorRow.push(r);
        anchorCol.push(base);
        for (let rr = r; rr < r + rowSpan; rr += 1) {
          for (let cc = base; cc < base + colSpan; cc += 1) {
            if (occupancy[rr]![cc] !== null) return null;
            occupancy[rr]![cc] = cellIndex;
          }
        }
      }
    }
    for (let r = 0; r < rows.length; r += 1) {
      for (let c = 0; c < columns; c += 1) {
        if (occupancy[r]![c] === null) return null;
      }
    }
    return { occupancy, cells, anchorRow, anchorCol };
  };

  const headerModel = hasHeader ? buildRegion(headerRows) : null;
  if (hasHeader && headerModel === null) return null;
  const bodyModel = buildRegion(bodyRows);
  if (bodyModel === null) return null;

  const emitRegion = (model: RegionModel, rows: readonly GridRow[]): Task[] | null => {
    const tasks: Task[] = [];
    for (let r = 0; r < rows.length; r += 1) {
      if (r > 0) tasks.push({ kind: 'line', value: '==', prefix: rest });
      for (let c = 0; c < columns; c += 1) {
        if (c > 0) tasks.push({ kind: 'line', value: '--', prefix: rest });
        const owner = model.occupancy[r]![c]!;
        const cell = model.cells[owner]!;
        if (model.anchorRow[owner] === r && model.anchorCol[owner] === c) {
          // A cell paragraph whose text is exactly a Grid marker (`--`, `==`,
          // `::`, `^`, `<`) would be re-read as cell structure on reparse;
          // `gridCell` makes guardParagraphLine escape it (spec §7.2 law 2).
          tasks.push({ kind: 'sequence', blocks: cell.children as readonly DocumentBlock[], first: rest, rest, depth: depth + 1, gridCell: true });
        } else {
          const above = r > 0 ? model.occupancy[r - 1]![c] : -1;
          const left = c > 0 ? model.occupancy[r]![c - 1] : -1;
          if (above === owner) tasks.push({ kind: 'line', value: '^', prefix: rest });
          else if (left === owner) tasks.push({ kind: 'line', value: '<', prefix: rest });
          else return null;
        }
      }
    }
    return tasks;
  };

  const headerTasks = hasHeader && headerModel !== null ? emitRegion(headerModel, headerRows) : [];
  if (headerTasks === null) return null;
  const bodyTasks = emitRegion(bodyModel, bodyRows);
  if (bodyTasks === null) return null;
  return [
    { kind: 'line', value: `:::${headerOf(type, title)}`, prefix: first },
    ...headerTasks,
    ...(hasHeader ? [{ kind: 'line', value: '::', prefix: rest } as const] : []),
    ...bodyTasks,
    { kind: 'line', value: ':::', prefix: rest },
  ];
}

interface RegionModel {
  readonly occupancy: Array<Array<number | null>>;
  readonly cells: readonly GridCell[];
  readonly anchorRow: readonly number[];
  readonly anchorCol: readonly number[];
}

function formatFence(value: string, language: string | undefined, id: string | undefined): string {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(value) + 1));
  return `${fence}${language ?? ''}\n${value}${value.length === 0 ? '' : '\n'}${fence}${id === undefined ? '' : `\n{#${id}}`}`;
}

function longestBacktickRun(value: string): number {
  let longest = 0;
  let current = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 0x60) {
      current += 1;
      if (current > longest) longest = current;
    } else current = 0;
  }
  return longest;
}

function isValidLanguageToken(value: string): boolean {
  if (value.length === 0) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x60 || isUnicodeWhitespace(code)) return false;
  }
  return true;
}

/** Unicode White_Space, fixed independently of the host's RegExp tables. */
function formatInline(children: readonly Inline[], allowBreaks: boolean, inLabel = false, inTableCell = false, checkOuterEdges = false): string | null {
  // One native frame per inline level; the budget check bounds it below the
  // host stack limit so a source-controlled `Em`/`Strong`/… nest yields
  // `resource` (spec §7.5) instead of a `RangeError`.
  inlineFrameDepth += 1;
  if (inlineFrameDepth > inlineFrameBudget) { inlineFrameDepth -= 1; throw new InlineFrameBudgetError(); }
  try {
    return formatInlineBody(children, allowBreaks, inLabel, inTableCell, checkOuterEdges);
  } finally {
    inlineFrameDepth -= 1;
  }
}

function formatInlineBody(children: readonly Inline[], allowBreaks: boolean, inLabel: boolean, inTableCell: boolean, checkOuterEdges: boolean): string | null {
  if (children.length === 0) return null;
  // Edge Unicode whitespace on a `Text` at the top-level sequence of a
  // `Paragraph` / `Heading` / `TableCell` has no canonical surface (the parser
  // strips it there); trimming it here would drop semantic content, so refuse
  // — `validate()` reports the precise diagnostic. `checkOuterEdges` is set
  // only by those three call sites and never propagates into a nested sequence
  // (a `Link` label, `Em` content, an image alt … may legally carry edge
  // whitespace: `[ x](y)` round-trips).
  if (checkOuterEdges) {
    const boundaryFirst = children[0]!;
    const boundaryLast = children[children.length - 1]!;
    if (boundaryFirst.type === 'text' && boundaryFirst.value.length > 0 && isUnicodeWhitespace(boundaryFirst.value.charCodeAt(0))) return null;
    if (boundaryLast.type === 'text' && boundaryLast.value.length > 0 && isUnicodeWhitespace(boundaryLast.value.charCodeAt(boundaryLast.value.length - 1))) return null;
  }
  let output = '';
  let previousText = false;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    if (child.type === 'text') {
      if (child.value.length === 0 || previousText || child.value.includes('\n') || child.value.includes('\r')) return null;
      const escaped = escapeText(
        child.value, backslashIsLiteralAtBoundary(children, index, child.value), inLabel,
        boundaryGuardChars(children[index - 1]), boundaryGuardChars(children[index + 1]),
      );
      output += inTableCell ? escapeCellPipes(escaped) : escaped;
      previousText = true;
      continue;
    }
    previousText = false;
    if (child.type === 'softBreak' || child.type === 'hardBreak') {
      const before = children[index - 1];
      const after = children[index + 1];
      if (!allowBreaks || index === 0 || index + 1 >= children.length ||
          before?.type === 'softBreak' || before?.type === 'hardBreak' ||
          after?.type === 'softBreak' || after?.type === 'hardBreak') return null;
      // No canonical surface for whitespace hugging a line break (§7.7).
      if (before?.type === 'text' && before.value.length > 0 && isUnicodeWhitespace(before.value.charCodeAt(before.value.length - 1))) return null;
      if (after?.type === 'text' && after.value.length > 0 && isUnicodeWhitespace(after.value.charCodeAt(0))) return null;
      output += child.type === 'softBreak' ? '\n' : '\\\n';
      continue;
    }
    switch (child.type) {
      case 'inlineCode': {
        if (child.value.length === 0 || child.value.includes('\n') || child.value.includes('\r')) return null;
        const delimiter = '`'.repeat(Math.max(1, longestBacktickRun(child.value) + 1));
        const leading = boundaryBacktickLeft(child.value) ? ' ' : '';
        const trailing = boundaryBacktickRight(child.value) ? ' ' : '';
        output += `${delimiter}${leading}${child.value}${trailing}${delimiter}`;
        break;
      }
      case 'inlineMath':
        if (child.value.length === 0 || child.value.includes('\n') || child.value.includes('\r') || child.value.includes('`$')) return null;
        output += `$\`${child.value}\`$`; break;
      case 'em': {
        const inner = formatInline(child.children, allowBreaks, inLabel, inTableCell); if (inner === null || child.children.some((node) => node.type === 'em')) return null;
        if (child.children.length === 1 && child.children[0]?.type === 'strong') {
          if (child.children[0].children.some((node) => node.type === 'em')) output += `<i>${inner}</i>`;
          else {
            const strongInner = formatInline(child.children[0].children, allowBreaks, inLabel, inTableCell);
            if (strongInner === null) return null;
            output += `*__${strongInner}__*`;
          }
        } else output += emphasisFusesDelimiter(child.children) || !starsFlank(inner, output, children[index + 1]) ? `<i>${inner}</i>` : `*${inner}*`;
        break;
      }
      case 'strong': {
        const inner = formatInline(child.children, allowBreaks, inLabel, inTableCell); if (inner === null || child.children.some((node) => node.type === 'strong')) return null;
        output += emphasisFusesDelimiter(child.children) || !starsFlank(inner, output, children[index + 1]) ? `<b>${inner}</b>` : `**${inner}**`;
        break;
      }
      case 'deletion': case 'obsolete': case 'insert': case 'mark': {
        const inner = formatInline(child.children, child.type === 'deletion' && allowBreaks, inLabel, inTableCell); if (inner === null || child.children.some((node) => node.type === child.type)) return null;
        const delimiter = child.type === 'deletion' ? '~~' : child.type === 'obsolete' ? '--' : child.type === 'insert' ? '++' : '==';
        // The `--`/`++`/`==`/`~~` opener and closer are only recognised next to
        // whitespace or non-word punctuation (GFM strikethrough flanking; the
        // `---` three-run rule for `--`). A word character immediately before
        // the opener or after the closer — or a `-` before a `--` opener —
        // leaves no canonical surface, and the parser never emits that
        // adjacency, so `validate()` rejects it here. The facing character is
        // read from the sibling nodes, never from the accumulated `output`
        // string (that would flatten a cons-string on every span).
        const before = children[index - 1];
        const prevCp = before === undefined ? -1
          : before.type === 'text' ? lastCodePoint(before.value)
          : before.type === 'obsolete' ? 0x2d // a `--…--` surface ends in `-`
          : -1; // every other inline surface ends in punctuation or a break
        const after = children[index + 1];
        const nextCp = after?.type === 'text' ? after.value.codePointAt(0) ?? -1 : -1;
        if (prevCp >= 0 && (characterClass(prevCp) === 'W' || (child.type === 'obsolete' && prevCp === 0x2d))) return null;
        if (nextCp >= 0 && characterClass(nextCp) === 'W') return null;
        output += `${delimiter}${inner}${delimiter}`; break;
      }
      case 'sup': case 'sub':
        if (!atomicValue(child.value, child.type === 'sup' ? 0x5e : 0x7e)) return null;
        output += `${child.type === 'sup' ? '^' : '~'}${child.value}${child.type === 'sup' ? '^' : '~'}`; break;
      case 'link': {
        if (child.download === true) {
          if (child.attrs !== undefined && !hasAttrs(child.attrs)) return null;
          if (containsLinkLike(child.children)) return null;
          const label = child.children.length === 0 ? '' : formatInline(child.children, allowBreaks, true); if (label === null) return null;
          const destination = formatDestination(child.href); if (destination === null || !validOptionalTitle(child.title)) return null;
          const attrs = child.attrs ?? {};
          const opener = formatMOpen('download', attrs, 'download'); if (opener === null) return null;
          output += `${opener}[${label}](${destination}${formatTitle(child.title)})</m>`; break;
        }
        if (child.attrs !== undefined) return null;
        if (containsLinkLike(child.children)) return null;
        const label = formatInline(child.children, allowBreaks, true); if (label === null) return null;
        const destination = formatDestination(child.href); if (destination === null || !validOptionalTitle(child.title)) return null;
        output += `[${label}](${destination}${formatTitle(child.title)})`; break;
      }
      case 'inlineImage': {
        if (child.attrs !== undefined && !hasAttrs(child.attrs)) return null;
        if (containsLinkLike(child.alt)) return null;
        const alt = child.alt.length === 0 ? '' : formatInline(child.alt, allowBreaks, true); if (alt === null) return null;
        const destination = formatDestination(child.src); if (destination === null || !validOptionalTitle(child.title)) return null;
        const image = `![${alt}](${destination}${formatTitle(child.title)})`;
        if (child.attrs === undefined) output += image;
        else { const opener = formatMOpen(null, child.attrs, 'image'); if (opener === null) return null; output += `${opener}${image}</m>`; }
        break;
      }
      case 'autolink':
        if (!autolinkValue(child.kind, child.value)) return null;
        output += `<${child.value}>`; break;
      case 'footnoteReference':
        if (!isIdentifier(child.identifier)) return null;
        const previous = children[index - 1];
        if (previous?.type === 'text') {
          const value = previous.value;
          const final = value.charCodeAt(value.length - 1);
          if (final === 0x20 || final === 0x09) return null;
        }
        output += `[^${child.identifier}]`; break;
      case 'metadataSpan': {
        if (child.children.some((node) => node.type === 'metadataSpan')) return null;
        const opener = formatMOpen(null, child.attrs, 'generic'); if (opener === null) return null;
        const inner = formatInline(child.children, allowBreaks, inLabel); if (inner === null) return null;
        output += `${opener}${inner}</m>`; break;
      }
      default: return null;
    }
  }
  return output;
}

/**
 * Escape the leftmost effective character of each formatted paragraph line that
 * a block recogniser would otherwise claim on reparse (spec §7.2 law 1, §10.8).
 * The first line is scanned as a fresh block; every line is also a paragraph
 * continuation, and the constructs that interrupt a paragraph must be guarded
 * on all of them.
 */
function guardParagraphLines(lines: readonly string[], gridCell = false): string[] {
  // `prevLine` is the already-guarded predecessor: the separator-row guard needs
  // to see whether the escape a previous line received has removed its table-row
  // syntax, so lines are guarded left to right and each sees the guarded prior.
  const guarded: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const next = lines[index + 1];
    guarded.push(guardParagraphLine(
      lines[index]!, index === 0, next === undefined ? '' : next, guarded[index - 1] ?? '', gridCell,
    ));
  }
  return guarded;
}

function guardParagraphLine(rawLine: string, firstLine: boolean, nextLine: string, prevLine = '', gridCell = false): string {
  // Trailing ASCII blanks are never canonical and ≥2 of them before the next
  // line would reparse as a hard break (§10.7); a hard break is emitted as a
  // trailing `\`, which this does not touch.
  const line = rawLine.replace(/[ \t]+$/u, '');
  if (line.length === 0) return line;
  const c = line.charCodeAt(0);
  if (c === 0x5c) return line; // already escaped at the start

  // Inside a fenced-container Grid cell, a paragraph line that is exactly a
  // Grid marker (`::`, `==`, `--`, `^`, `<`) is re-read as cell structure when
  // the formatted Grid is reparsed. Escape the leftmost character (§10.8).
  if (gridCell) {
    if ((c === 0x5e || c === 0x3c) && line.length === 1) return `\\${line}`;
    if ((c === 0x3a || c === 0x3d || c === 0x2d) && line.length === 2 && line.charCodeAt(1) === c) return `\\${line}`;
  }

  // --- constructs that interrupt a paragraph (guarded on every line) ------

  // ATX heading: 1–6 `#` then space / tab / end of line.
  if (c === 0x23) {
    let run = 0;
    while (run < line.length && line.charCodeAt(run) === 0x23) run += 1;
    if (run <= 6 && (run === line.length || line.charCodeAt(run) === 0x20 || line.charCodeAt(run) === 0x09)) return `\\${line}`;
  }
  // thematic break: three or more `-` or `*`, only those plus ASCII blanks.
  if ((c === 0x2d || c === 0x2a) && isThematicBreakSurface(line)) return `\\${line}`;
  // Bullet / definition markers, plus the malformed variants the list
  // recogniser rejects outright — it never falls back to a paragraph, so these
  // must be guarded too (spec §9.3 "Still invalid: -Item"):
  //   `-` not followed by another `-` — `- x`, `-x`, `-  x`, a bare `-`
  //     (a `--…` run stays ordinary paragraph text)
  //   any leading `:` — `: ` marker, `:::` fence, `:x` / bare `:` recogniser error
  //   `* ` / `+ ` — the space form only; `*x` / `+x` stay ordinary text
  if (c === 0x2d && line.charCodeAt(1) !== 0x2d) return `\\${line}`;
  if (c === 0x3a) return `\\${line}`;
  // `* `/`+ ` is the bullet marker; a bare `*`/`+` (the whole line) is a
  // recogniser error ("list marker requires exactly one space"), never a
  // paragraph fallback, so it needs the same guard. `*x` / `**…` already
  // arrive escaped from the inline layer when they would open emphasis.
  if ((c === 0x2a || c === 0x2b) && (line.length === 1 || line.charCodeAt(1) === 0x20 || line.charCodeAt(1) === 0x09)) return `\\${line}`;
  // Ordered list marker and its malformed variants: any digit run then `.` / `)`.
  // `1. x` is a list; `1.x`, `1.`, and a 10+-digit run are recogniser errors.
  if (c >= 0x30 && c <= 0x39) {
    let run = 0;
    while (run < line.length && line.charCodeAt(run) >= 0x30 && line.charCodeAt(run) <= 0x39) run += 1;
    if (run < line.length && (line.charCodeAt(run) === 0x2e || line.charCodeAt(run) === 0x29)) {
      return `${line.slice(0, run)}\\${line.slice(run)}`;
    }
  }
  // fenced code / math: three or more backticks / tildes. A `~~~+` run always
  // opens a fence (its info string is unconstrained here — a malformed one is a
  // recogniser error, still not a paragraph). A `` ```+ `` run opens one only
  // when the rest of the line holds no backtick (spec §2.4): with a backtick it
  // is an inline code span the leading run opened, not a fence, and must stay
  // unescaped. This mirrors the three parser fence recognisers exactly.
  if (c === 0x60 || c === 0x7e) {
    let run = 0;
    while (run < line.length && line.charCodeAt(run) === c) run += 1;
    if (run >= 3 && (c === 0x7e || line.indexOf('`', run) === -1)) return `\\${line}`;
  }
  // lined-container fence: three or more underscores, nothing else.
  if (c === 0x5f && allOf(line, 0x5f) && line.length >= 3) return `\\${line}`;
  // (a `:::` fenced-container opener is already covered by the leading-`:` rule)
  // HTML comment as a whole line (a `<m …>` line here is always an inline
  // metadata span — the block `<m video/…>` form cannot occur inside a paragraph).
  if (line.startsWith('<!--')) return `\\${line}`;
  // setext underline on a continuation line is a hard error.
  if (!firstLine && c === 0x3d && allOf(line, 0x3d)) return `\\${line}`;
  // block image: the whole line is one `![…](…)` atomic token.
  if (line.startsWith('![') && atomicTokenEnd(line, 0, line.length, false) === line.length) return `\\${line}`;
  // pipe table: this `|`-leading line is the header and the next is its
  // separator row (`| a |` then `| --- |`).
  if (c === 0x7c && isSeparatorRowThatConfirmsTable(nextLine)) return `\\${line}`;
  // …and this line *is* a separator row that confirms a table with the line
  // above it. GFM tables exist with or without outer pipes, so the separator is
  // caught whether it leads with `|` (`| --- |`) or `-` (`--- | ---`); escaping
  // its leftmost char makes the first cell fail `:?-+:?`, so no table forms and
  // the pair stays one paragraph. The predecessor must itself carry a live `|`
  // (a header row) — plain prose before a dash/pipe line (`Cost` then `| --- |`)
  // stays a paragraph untouched. `prevLine` is the already-guarded previous
  // line, so a `|` its own guard escaped no longer counts (§7.2).
  if (!firstLine && looksLikeTableRowSurface(prevLine) && isSeparatorRowThatConfirmsTable(line)) return `\\${line}`;
  // block quote: a leading `>` at column 0 starts a quote on *any* line — it
  // interrupts an in-progress paragraph (§2.5), so guard it on continuation
  // lines too, not only the first. `\>` reparses as literal `>`.
  if (c === 0x3e) return `\\${line}`;
  // a line that is exactly `{…}` is taken as a standalone / trailing block-id
  // suffix (§5.3) — `{#id}` line, valid or not. Escape the leading brace so it
  // stays paragraph text; `\{` reparses as a literal `{`.
  if (c === 0x7b && line.charCodeAt(line.length - 1) === 0x7d) return `\\${line}`;

  return line;
}

/**
 * Guard a heading's rendered inline text so it round-trips inside `# …`
 * (spec §5, §7.2 law 1). Trailing ASCII blanks are not canonical, and a
 * trailing `#` run that sits at the content start or right after a space is
 * consumed as closing hashes on reparse — escape its first `#`.
 */
function guardHeadingText(text: string): string | null {
  const trimmed = text.replace(/[ \t]+$/u, '');
  if (trimmed.length === 0) return null;
  // A trailing ` {#…}` — valid identifier or not — is peeled off as a same-line
  // block id (§5.3). When the heading text ends in that shape, escape the brace
  // so the text stays literal (the appended real id, if any, is added after).
  const split = splitSameLineId(trimmed, 0, trimmed.length);
  if (split.bodyEnd < trimmed.length) {
    return `${trimmed.slice(0, split.bodyEnd)} \\${trimmed.slice(split.bodyEnd + 1)}`;
  }
  // A heading text that is wholly `{…}` reads as an id-only heading (→ "empty
  // heading"); escape the leading brace so it is literal text instead.
  if (trimmed.charCodeAt(0) === 0x7b && trimmed.charCodeAt(trimmed.length - 1) === 0x7d) {
    return `\\${trimmed}`;
  }
  if (!trimmed.endsWith('#')) return trimmed;
  let run = trimmed.length;
  while (run > 0 && trimmed.charCodeAt(run - 1) === 0x23) run -= 1;
  if (run === 0 || trimmed.charCodeAt(run - 1) === 0x20) {
    return `${trimmed.slice(0, run)}\\${trimmed.slice(run)}`;
  }
  return trimmed;
}

function isThematicBreakSurface(line: string): boolean {
  const marker = line.charCodeAt(0);
  let count = 0;
  for (let index = 0; index < line.length; index += 1) {
    const code = line.charCodeAt(index);
    if (code === marker) count += 1;
    else if (code !== 0x20 && code !== 0x09) return false;
  }
  return count >= 3;
}

/**
 * A GFM table separator row (spec §12): after optional edge pipes, every
 * `|`-delimited cell is `:?-+:?` once trimmed. This mirrors `separatorAlignments`
 * in the parser, so the guard escapes exactly the surfaces that would confirm a
 * table and no ordinary pipe/dash prose beyond them.
 */
function looksLikeSeparatorRow(line: string): boolean {
  let start = 0;
  let end = line.length;
  while (start < end && (line.charCodeAt(start) === 0x20 || line.charCodeAt(start) === 0x09)) start += 1;
  while (end > start && (line.charCodeAt(end - 1) === 0x20 || line.charCodeAt(end - 1) === 0x09)) end -= 1;
  if (start === end) return false;
  if (line.charCodeAt(start) === 0x7c) start += 1;
  if (end > start && line.charCodeAt(end - 1) === 0x7c) end -= 1;
  if (start >= end) return false;
  let cellStart = start;
  for (let index = start; index <= end; index += 1) {
    if (index === end || line.charCodeAt(index) === 0x7c) {
      if (!/^[ \t]*:?-+:?[ \t]*$/u.test(line.slice(cellStart, index))) return false;
      cellStart = index + 1;
    }
  }
  return true;
}

/**
 * A separator-row surface (`:?-+:?` cells) that *also* carries a live `|`, so
 * the parser reads it as a table row and `startsTable` confirms a table from a
 * header line above it. A dash-only line (`---`) is a thematic break, handled
 * earlier, and never confirms a table.
 */
function isSeparatorRowThatConfirmsTable(line: string): boolean {
  return looksLikeSeparatorRow(line) && looksLikeTableRowSurface(line);
}

/**
 * The line carries pipe-table row syntax: a live, unescaped `|` (an interior
 * delimiter or an edge pipe). A line with no such `|` can never be read as a
 * table header or a table separator row.
 */
function looksLikeTableRowSurface(line: string): boolean {
  for (let index = 0; index < line.length; index += 1) {
    const code = line.charCodeAt(index);
    if (code === 0x5c) { index += 1; continue; }
    if (code === 0x7c) return true;
  }
  return false;
}

function allOf(value: string, code: number): boolean {
  for (let index = 0; index < value.length; index += 1) if (value.charCodeAt(index) !== code) return false;
  return value.length > 0;
}

function formatTitle(title: string | undefined): string {
  if (title === undefined) return '';
  let output = '';
  for (let index = 0; index < title.length; index += 1) {
    const character = title[index]!;
    const escape = character === '\\' || character === '"' ||
      character === '&' && scanEntity(title, index, title.length).kind === 'decoded';
    output += escape ? `\\${character}` : character;
  }
  return ` "${output}"`;
}
/**
 * The delimiter character(s) an inline sibling contributes at the boundary,
 * which a bare identical character in the adjacent `Text` node would merge with
 * on reparse. Such a `Text` boundary character is force-escaped (§10.8).
 */
function boundaryGuardChars(sibling: Inline | undefined): string {
  switch (sibling?.type) {
    case 'em': case 'strong': return '*';
    case 'deletion': case 'sub': return '~';
    case 'obsolete': return '-';
    case 'insert': return '+';
    case 'mark': return '=';
    case 'sup': return '^';
    case 'inlineCode': case 'inlineMath': return '$';
    case 'link': case 'inlineImage': return '!';
    default: return '';
  }
}

/** Whether `output` ends with `<lone resource>\` + hard-break newline. */
function endsWithResourceHardBreak(output: string): boolean {
  if (!output.endsWith('\\\n')) return false;
  const lineStart = output.lastIndexOf('\n', output.length - 3) + 1;
  const line = output.slice(lineStart, output.length - 2); // drop the trailing `\` and `\n`
  if (!line.startsWith('![') && !line.startsWith('<m')) return false;
  return atomicTokenEnd(line, 0, line.length, false) === line.length;
}

/** The last Unicode scalar value of `value`, or -1 when empty. */
function lastCodePoint(value: string): number {
  if (value.length === 0) return -1;
  const low = value.charCodeAt(value.length - 1);
  if (low >= 0xdc00 && low <= 0xdfff && value.length >= 2) {
    const high = value.charCodeAt(value.length - 2);
    if (high >= 0xd800 && high <= 0xdbff) return (high - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
  }
  return low;
}

/**
 * Whether `*` / `**` can carry this emphasis in context: the opener must not
 * follow a word character and the closer must not precede one (spec §10.3).
 * When it cannot, the formatter falls back to `<i>` / `<b>`. Adjacent bare
 * delimiter characters in `Text` siblings are already escaped by
 * `boundaryGuardChars`, so only the word-flanking rule remains here.
 */
/**
 * `Em` / `Strong` whose sole child is a `Text` of only `*` / `_` characters has
 * no `*…*` / `**…**` surface — the escaped content (`\*`) still abuts the
 * delimiter into a longer run that reparses differently. The `<i>` / `<b>` form
 * is unambiguous. (Nested `Em`/`Strong` whose rendered form starts/ends with a
 * `*` is fine — `***x***` is stack-aware.)
 */
function emphasisFusesDelimiter(children: readonly Inline[]): boolean {
  return children.length === 1 && children[0]!.type === 'text' && /^[*_]+$/u.test(children[0]!.value);
}

function starsFlank(inner: string, before: string, next: Inline | undefined): boolean {
  if (inner.length === 0) return false;
  if (isUnicodeWhitespace(inner.codePointAt(0)!) || isUnicodeWhitespace(inner.codePointAt(inner.length - 1)!)) return false;
  if (characterClass(lastCodePoint(before)) === 'W') return false;
  if (next?.type === 'em' || next?.type === 'strong') return false;
  // Caption-carrier position (§4.5): `*…*` as the whole line right after a
  // hard break that follows a lone block resource would be read as a caption.
  if ((next === undefined || next.type === 'softBreak') && endsWithResourceHardBreak(before)) return false;
  const nextCp = next === undefined ? -1
    : next.type === 'text' ? next.value.codePointAt(0)!
    : 0x3c; // any other structured sibling renders starting with a punctuation character
  return characterClass(nextCp) !== 'W';
}

function boundaryBacktickLeft(value: string): boolean { let i = 0; while (value.charCodeAt(i) === 0x20) i += 1; return value.charCodeAt(i) === 0x60; }
function boundaryBacktickRight(value: string): boolean { let i = value.length; while (value.charCodeAt(i - 1) === 0x20) i -= 1; return value.charCodeAt(i - 1) === 0x60; }
function starSafe(value: string): boolean { return value.length > 0 && !isUnicodeWhitespace(value.codePointAt(0)!) && !isUnicodeWhitespace(value.codePointAt(value.length - 1)!); }
function atomicValue(value: string, delimiter: number): boolean { if (value.length === 0) return false; for (let i = 0; i < value.length; i += 1) { const cp = value.codePointAt(i)!; if (cp === delimiter || isUnicodeWhitespace(cp)) return false; if (cp > 0xffff) i += 1; } return true; }
function autolinkValue(kind: 'url' | 'email', value: string): boolean { return kind === 'url' ? (value.startsWith('http://') || value.startsWith('https://')) && value.length > (value[4] === 's' ? 8 : 7) && !value.includes('<') && !value.includes('>') : value.includes('@') && value.includes('.'); }
/**
 * ASCII bytes `escapeText` may need to act on. A byte not flagged here (and
 * every non-ASCII code unit) is copied verbatim, so an unescaped run is emitted
 * in one slice. Keep in sync with the per-character checks in `escapeText`.
 */
const TEXT_ESCAPE_SIGNIFICANT = (() => {
  const table = new Uint8Array(128);
  for (const ch of '\\`&$![]<^~*_+-=h') table[ch.charCodeAt(0)] = 1;
  return table;
})();

function escapeText(
  value: string, terminalBackslashIsCanonical: boolean, inLabel: boolean,
  guardLead = '', guardTail = '',
): string {
  let out = '';
  const lastIndex = value.length - 1;
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i]!; const next = value[i + 1] ?? '';
    // Fast path: copy a run of never-escaped characters (interior positions
    // only — the first/last char may hit a positional guard).
    if (i > 0 && i < lastIndex) {
      const code = value.charCodeAt(i);
      if (code >= 0x80 || TEXT_ESCAPE_SIGNIFICANT[code] === 0) {
        let run = i + 1;
        while (run < lastIndex) {
          const rc = value.charCodeAt(run);
          if (rc < 0x80 && TEXT_ESCAPE_SIGNIFICANT[rc] === 1) break;
          run += 1;
        }
        out += value.slice(i, run);
        i = run - 1;
        continue;
      }
    }
    if ((i === 0 && guardLead.includes(c)) || (i === value.length - 1 && guardTail.includes(c))) { out += `\\${c}`; continue; }
    if (inLabel && (c === '[' || c === ']')) { out += `\\${c}`; continue; }
    if (c === '\\') {
      out += next !== '' && isEscapablePunctuation(next.charCodeAt(0)) || next === '' && !terminalBackslashIsCanonical ? '\\\\' : '\\';
      continue;
    }
    if (c === '`') { out += '\\`'; continue; }
    if (c === '&' && scanEntity(value, i, value.length).kind === 'decoded') { out += '\\&'; continue; }
    if (c === '$' && next === '`') { out += '\\$'; continue; }
    if (c === '!' && next === '[' && directLinkEnd(value, i + 1) >= 0) { out += '!\\['; i += 1; continue; }
    if (c === '[' && (directLinkEnd(value, i) >= 0 || footnoteEnd(value, i) >= 0)) { out += '\\['; continue; }
    if (c === '<' && structuredAngleEnd(value, i) >= 0) { out += '\\<'; continue; }
    const bareLength = bareUrlPrefixLength(value, i);
    if (bareLength > 0 && characterClass(i === 0 ? -1 : value.codePointAt(i - 1)!) !== 'W') {
      out += `${value.slice(i, i + bareLength - 3)}\\://`;
      i += bareLength - 1;
      continue;
    }
    if ((c === '^' || c === '~') && atomicTextEnd(value, i, c) >= 0) { out += `\\${c}`; continue; }
    const delimiter = textDelimiterAt(value, i);
    if (delimiter !== null && delimiter.length > 1 && !textDelimiterCanOpen(value, i, delimiter)) {
      // A run that cannot open in isolation is normally literal. But when it
      // touches a guarded edge — a sibling `Em`/`Strong`/`~~`/`--`/`++`/`==`
      // whose own delimiter abuts this one — string concatenation would fuse
      // the two into a longer run that reparses differently (`Text("**")` +
      // `Em` → `***a*`). Neutralise every character of the run in that case so
      // the boundary survives, and strict mode rejects the unescaped surface.
      const runEnd = i + delimiter.length - 1;
      const guardedEdge = (i === 0 && guardLead.includes(c)) ||
        (runEnd === value.length - 1 && guardTail.includes(c));
      if (guardedEdge) out += `\\${c}`.repeat(delimiter.length);
      else out += delimiter;
      i = runEnd;
      continue;
    }
    if (delimiter !== null && textDelimiterCanOpen(value, i, delimiter)) {
      // Leftmost-effective escape (§10.8). For `_`/`__` escaping the leftmost
      // underscore is sufficient: `_` is a word character so the trailing `_`
      // cannot re-open. `*` is punctuation, so `**` needs both characters
      // neutralised; `~~` likewise — a single exposed `~` can still pair, not
      // only with a later `~` in this value but with the opener of an adjacent
      // `Sub` / `Deletion` sibling, so leftmost-only is not always effective.
      if (delimiter === '**' || delimiter === '~~') out += `\\${c}\\${c}`;
      else out += `\\${c}${delimiter.slice(1)}`;
      i += delimiter.length - 1;
      continue;
    }
    out += c;
  }
  return out;
}

function directLinkEnd(value: string, start: number): number {
  const label = value.indexOf('](', start + 1);
  if (label < 0) return -1;
  let depth = 0;
  for (let index = label + 2; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x5c) index += 1;
    else if (code === 0x28) depth += 1;
    else if (code === 0x29) { if (depth === 0) return index + 1; depth -= 1; }
  }
  return -1;
}

function footnoteEnd(value: string, start: number): number {
  if (!value.startsWith('[^', start)) return -1;
  let index = start + 2;
  const identifierStart = index;
  while (index < value.length && isIdentifierCode(value.charCodeAt(index))) index += 1;
  return index > identifierStart && value.charCodeAt(index) === 0x5d ? index + 1 : -1;
}

function structuredAngleEnd(value: string, start: number): number {
  if (value.startsWith('<i>', start) || value.startsWith('<b>', start) || value.startsWith('<m ', start) || value.startsWith('<m>', start)) return start + 3;
  const end = value.indexOf('>', start + 1);
  if (end < 0) return -1;
  const body = value.slice(start + 1, end);
  if (body.startsWith('http://') || body.startsWith('https://')) return end + 1;
  const at = body.indexOf('@');
  return at > 0 && body.indexOf('.', at + 2) > at + 1 ? end + 1 : -1;
}

function bareUrlPrefixLength(value: string, start: number): number {
  return value.startsWith('https://', start) ? 8 : value.startsWith('http://', start) ? 7 : 0;
}

function atomicTextEnd(value: string, start: number, delimiter: string): number {
  if (characterClass(value.codePointAt(start + 1) ?? -1) === 'S') return -1;
  for (let index = start + 1; index < value.length; index += 1) {
    if (value[index] === delimiter) return index > start + 1 ? index + 1 : -1;
    if (isUnicodeWhitespace(value.codePointAt(index)!)) return -1;
  }
  return -1;
}

function isIdentifierCode(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) || code === 0x5f || code === 0x2d;
}

function backslashIsLiteralAtBoundary(children: readonly Inline[], index: number, value: string): boolean {
  if (!value.endsWith('\\')) return false;
  if (value.length > 1 && index + 1 === children.length) return true;
  const next = children[index + 1];
  return value === '\\' && (next?.type === 'softBreak' || next?.type === 'hardBreak');
}

function textDelimiterAt(value: string, offset: number): string | null {
  for (const delimiter of ['**', '__', '~~', '--', '++', '==', '*', '_']) {
    if (value.startsWith(delimiter, offset)) {
      if (delimiter === '--' && (value.charCodeAt(offset - 1) === 0x2d || value.charCodeAt(offset + 2) === 0x2d)) return null;
      return delimiter;
    }
  }
  return null;
}

function textDelimiterCanOpen(value: string, offset: number, delimiter: string): boolean {
  const before = offset === 0 ? -1 : value.codePointAt(offset - 1)!;
  const after = offset + delimiter.length >= value.length ? -1 : value.codePointAt(offset + delimiter.length)!;
  return characterClass(after) !== 'S' && characterClass(before) !== 'W';
}

function formatDestination(value: string): string | null {
  if (value.length === 0) return '<>';
  if (!validLinkValue(value)) return null;
  let balance = 0;
  let balanced = true;
  let needsAngle = false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    // `<` and any Unicode whitespace (ASCII space, tab, NBSP, …) force the
    // angle form: the bare-destination scanner stops at every whitespace
    // character, so a bare surface would not round-trip (spec §10.5.1).
    if (code === 0x3c || isUnicodeWhitespace(code)) needsAngle = true;
    if (code === 0x28) balance += 1;
    else if (code === 0x29) { balance -= 1; if (balance < 0) balanced = false; }
  }
  if (balance !== 0) balanced = false;
  needsAngle ||= !balanced;
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    const escape = character === '\\' ||
      character === '&' && scanEntity(value, index, value.length).kind === 'decoded' ||
      (needsAngle ? character === '<' || character === '>' : false);
    output += escape ? `\\${character}` : character;
  }
  return needsAngle ? `<${output}>` : output;
}

function validOptionalTitle(value: string | undefined): boolean {
  return value === undefined || validLinkValue(value);
}

function validLinkValue(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code <= 0x1f && code !== 0x09) || (code >= 0x7f && code <= 0x9f) || code === 0x0a || code === 0x0d) return false;
  }
  return true;
}

function containsLinkLike(children: readonly Inline[]): boolean {
  const stack = [...children];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === 'link' || node.type === 'autolink') return true;
    if ('children' in node && Array.isArray(node.children)) stack.push(...node.children);
  }
  return false;
}

function equalsOnly(value: string): boolean {
  if (value.length === 0) return false;
  for (let index = 0; index < value.length; index += 1) if (value.charCodeAt(index) !== 0x3d) return false;
  return true;
}
function isEscapablePunctuation(code: number): boolean { return code >= 0x21 && code <= 0x7e && !((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)); }

/** Escape every literal `|` in already-escaped text so a table row tokenizer keeps the cell whole. */
function escapeCellPipes(value: string): string {
  let out = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char === '\\' && index + 1 < value.length) { out += char + value[index + 1]!; index += 1; continue; }
    out += char === '|' ? '\\|' : char;
  }
  return out;
}

function invalid(message: string): CanonicalFormatResult {
  return { status: 'invalid', diagnostics: [diagnostic('semantic', 'error', { message })] };
}
