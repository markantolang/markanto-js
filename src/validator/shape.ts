/**
 * Total, closed shape check for a semantic AST (spec §7.5, `docs/INVARIANTS.md`).
 *
 * `checkShape` walks the entire tree with an explicit work stack — a deep or
 * wide AST yields `resource`, never a host stack overflow — and rejects, as
 * `invalid`, any node whose `type` is unknown, whose key set is not exactly the
 * one its type declares, or whose field has the wrong primitive type or a
 * `null` / non-object where a child node belongs. Deeper value invariants
 * (e.g. `Sup.value` contains no `^`) stay with the canonical formatter, which
 * `validate()` still runs as the representability gate once the shape holds.
 *
 * It never throws for an arbitrary untrusted input.
 */
import { diagnostic, type Diagnostic } from '../diagnostics.js';
import type { ResourceBudget } from '../ast.js';

export const DEFAULT_VALIDATION_BUDGET = { maxNodes: 100_000, maxFrames: 5_000 } as const;

export type ShapeResult =
  | { readonly status: 'ok'; readonly nodes: number }
  | { readonly status: 'invalid'; readonly diagnostics: readonly Diagnostic[] }
  | { readonly status: 'resource'; readonly diagnostics: readonly Diagnostic[] };

type FieldKind =
  | 'string' | 'number' | 'boolean' | 'stringOrNull' | 'true' | 'attrs'
  | { readonly enum: readonly string[] }
  | { readonly items: readonly string[] } // array whose entries are all in the set
  | 'nodeArray' | 'node' | 'quoteBlockArray';

interface Field { readonly kind: FieldKind; readonly optional?: true }

function req(kind: FieldKind): Field { return { kind }; }
function opt(kind: FieldKind): Field { return { kind, optional: true }; }

const ALIGN = ['default', 'left', 'center', 'right'] as const;

/** `type` -> its exact field set. `id` is the optional block-ID slot. */
const SCHEMA: Record<string, Record<string, Field>> = {
  document: { children: req('nodeArray'), footnotes: req('nodeArray') },

  heading: { level: req('number'), children: req('nodeArray'), id: opt('string') },
  paragraph: { children: req('nodeArray'), id: opt('string') },
  horizontalRule: { id: opt('string') },
  codeBlock: { value: req('string'), lang: opt('string'), id: opt('string') },
  mathBlock: { value: req('string'), id: opt('string') },
  commentBlock: { value: req('string') },

  imageBlock: { src: req('string'), alt: req('nodeArray'), title: opt('string'), caption: opt('nodeArray'), attrs: opt('attrs'), id: opt('string') },
  videoBlock: { src: req('string'), label: req('nodeArray'), title: opt('string'), caption: opt('nodeArray'), attrs: opt('attrs'), id: opt('string') },
  audioBlock: { src: req('string'), label: req('nodeArray'), title: opt('string'), caption: opt('nodeArray'), attrs: opt('attrs'), id: opt('string') },
  embedBlock: { target: req('string'), label: req('nodeArray'), title: opt('string'), caption: opt('nodeArray'), attrs: opt('attrs'), id: opt('string') },
  downloadBlock: { href: req('string'), label: req('nodeArray'), title: opt('string'), caption: opt('nodeArray'), attrs: opt('attrs'), id: opt('string') },

  quoteRegion: { children: req('quoteBlockArray'), attribution: opt('nodeArray'), id: opt('string') },

  list: { kind: req({ enum: ['unordered', 'ordered', 'definition'] }), items: req('nodeArray'), start: opt('number'), id: opt('string') },
  listItem: { children: req('nodeArray'), value: opt('number'), task: opt({ enum: ['open', 'done'] }) },

  table: { alignments: req({ items: ALIGN }), head: req('node'), body: req('nodeArray'), id: opt('string') },
  tableRow: { cells: req('nodeArray') },
  tableCell: { children: req('nodeArray') },

  container: { form: req({ enum: ['lined', 'fenced'] }), containerType: req('stringOrNull'), title: req('stringOrNull'), children: req('nodeArray'), id: opt('string') },
  grid: { columns: req('number'), header: opt('nodeArray'), rows: req('nodeArray') },
  gridRow: { cells: req('nodeArray') },
  gridCell: { column: req('number'), rowSpan: opt('number'), colSpan: opt('number'), children: req('nodeArray') },

  footnoteDefinition: { identifier: req('string'), children: req('nodeArray'), id: opt('string') },

  text: { value: req('string') },
  softBreak: {},
  hardBreak: {},
  inlineCode: { value: req('string') },
  inlineMath: { value: req('string') },
  em: { children: req('nodeArray') },
  strong: { children: req('nodeArray') },
  deletion: { children: req('nodeArray') },
  obsolete: { children: req('nodeArray') },
  insert: { children: req('nodeArray') },
  mark: { children: req('nodeArray') },
  sup: { value: req('string') },
  sub: { value: req('string') },
  link: { href: req('string'), children: req('nodeArray'), title: opt('string'), download: opt('true'), attrs: opt('attrs') },
  inlineImage: { src: req('string'), alt: req('nodeArray'), title: opt('string'), attrs: opt('attrs') },
  autolink: { kind: req({ enum: ['url', 'email'] }), value: req('string') },
  footnoteReference: { identifier: req('string') },
  metadataSpan: { attrs: req('attrs'), children: req('nodeArray') },
};

type Expect = 'node' | 'quoteBlock';
interface Work { readonly value: unknown; readonly expect: Expect; readonly depth: number }

export function checkShape(root: unknown, budget?: ResourceBudget): ShapeResult {
  const maxNodes = budget?.maxNodes ?? DEFAULT_VALIDATION_BUDGET.maxNodes;
  const maxFrames = budget?.maxFrames ?? DEFAULT_VALIDATION_BUDGET.maxFrames;

  const stack: Work[] = [{ value: root, expect: 'node', depth: 1 }];
  let nodes = 0;
  const resource = (what: string): ShapeResult => ({ status: 'resource', diagnostics: [diagnostic('resource', 'error', { message: `validation ${what} budget exceeded` })] });
  const fail = (message: string): ShapeResult => ({ status: 'invalid', diagnostics: [diagnostic('semantic', 'error', { message })] });

  while (stack.length > 0) {
    const { value, expect, depth } = stack.pop()!;
    nodes += 1;
    if (nodes > maxNodes) return resource('node');
    // `depth` is nesting depth, not stack size — a wide flat document is fine.
    if (depth > maxFrames) return resource('frame');
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return fail(`${expect === 'quoteBlock' ? 'quote block' : 'AST node'} must be an object`);
    }
    const record = value as Record<string, unknown>;

    if (expect === 'quoteBlock') {
      const keys = Object.keys(record);
      if (keys.length !== 2 || !('level' in record) || !('block' in record)) return fail('quote block must have exactly {level, block}');
      if (typeof record['level'] !== 'number' || !Number.isFinite(record['level'])) return fail('quote block level must be a number');
      stack.push({ value: record['block'], expect: 'node', depth: depth + 1 });
      continue;
    }

    const type = record['type'];
    if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(SCHEMA, type)) {
      return fail(`unknown AST node type ${JSON.stringify(type)}`);
    }
    const schema = SCHEMA[type]!;

    for (const key of Object.keys(record)) {
      if (key === 'type') continue;
      if (!Object.prototype.hasOwnProperty.call(schema, key)) return fail(`${type} has an unexpected property ${JSON.stringify(key)}`);
    }
    for (const [name, field] of Object.entries(schema)) {
      const present = Object.prototype.hasOwnProperty.call(record, name);
      if (!present) {
        if (field.optional) continue;
        return fail(`${type} is missing required property ${JSON.stringify(name)}`);
      }
      const error = checkField(type, name, field.kind, record[name], stack, depth);
      if (error !== null) return fail(error);
    }
  }

  return { status: 'ok', nodes };
}

function checkField(type: string, name: string, kind: FieldKind, value: unknown, stack: Work[], depth: number): string | null {
  const where = `${type}.${name}`;
  if (typeof kind === 'object') {
    if ('enum' in kind) {
      return typeof value === 'string' && kind.enum.includes(value) ? null : `${where} must be one of ${kind.enum.join(' | ')}`;
    }
    if (!Array.isArray(value)) return `${where} must be an array`;
    for (const entry of value) if (typeof entry !== 'string' || !kind.items.includes(entry)) return `${where} entries must be one of ${kind.items.join(' | ')}`;
    return null;
  }
  switch (kind) {
    case 'string': return typeof value === 'string' ? null : `${where} must be a string`;
    case 'stringOrNull': return value === null || typeof value === 'string' ? null : `${where} must be a string or null`;
    case 'number': return typeof value === 'number' && Number.isFinite(value) ? null : `${where} must be a number`;
    case 'boolean': return typeof value === 'boolean' ? null : `${where} must be a boolean`;
    case 'true': return value === true ? null : `${where} must be true when present`;
    case 'attrs':
      // Closed resource / metadata attribute record. The formatter still runs
      // the per-context attribute matrix and value semantics (§4.6/§4.7).
      return checkAttrs(where, value);
    case 'node':
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return `${where} must be an object`;
      stack.push({ value, expect: 'node', depth: depth + 1 });
      return null;
    case 'nodeArray':
      if (!Array.isArray(value)) return `${where} must be an array`;
      for (const entry of value) stack.push({ value: entry, expect: 'node', depth: depth + 1 });
      return null;
    case 'quoteBlockArray':
      if (!Array.isArray(value)) return `${where} must be an array`;
      for (const entry of value) stack.push({ value: entry, expect: 'quoteBlock', depth: depth + 1 });
      return null;
    default:
      return `${where}: unhandled field kind`;
  }
}

const ATTR_KEYS = new Set(['group', 'lang', 'preview', 'dataAttrs']);

/**
 * The union of the resource / metadata attribute record shapes
 * (`ImageResourceAttributes`, `MediaResourceAttributes`,
 * `DownloadResourceAttributes`, `MetadataSpanAttributes`): only `group` /
 * `lang` / `preview` (strings) and `dataAttrs` (a non-null record of strings).
 * The formatter rejects a key not allowed in the node's context.
 */
function checkAttrs(where: string, value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return `${where} must be an object`;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ATTR_KEYS.has(key)) return `${where} has an unexpected attribute ${JSON.stringify(key)}`;
    if (key === 'dataAttrs') {
      const data = record[key];
      if (data === null || typeof data !== 'object' || Array.isArray(data)) return `${where}.dataAttrs must be an object`;
      for (const [dataKey, dataValue] of Object.entries(data as Record<string, unknown>)) {
        if (typeof dataValue !== 'string') return `${where}.dataAttrs[${JSON.stringify(dataKey)}] must be a string`;
      }
    } else if (typeof record[key] !== 'string') {
      return `${where}.${key} must be a string`;
    }
  }
  return null;
}
