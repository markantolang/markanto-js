/**
 * Markanto v0.5.3 → 0.1.0 migration tool. Reference tooling, not Core.
 *
 * Pipeline: v0.5.3 source → previous parser (vendored, `./legacy/`) → v0.4.0
 * Document → transform → 0.1.0 Document → Core `format()` → canonical 0.1.0
 * source + an ordered migration-diagnostic list. Runs before the 0.1.0 parser,
 * never as a parser mode.
 */
import { parse as legacyParse } from './legacy/parser.js';

import { format, parse, type Document, type DocumentBlock } from '../../src/index.js';
import { DiagnosticCollector, type MigrationDiagnostic } from './diagnostics.js';
import { transformDocument } from './from-v053.js';

export type { MigrationDiagnostic, MigrationDiagnosticCategory } from './diagnostics.js';

export interface MigrationOptions {
  /** reserved for future switches; none defined yet */
  readonly reserved?: never;
}

export interface MigrationResult {
  /** canonical 0.1.0 source; empty only when the legacy parse itself failed */
  readonly text: string;
  readonly diagnostics: readonly MigrationDiagnostic[];
}

export function migrateV053(source: string, _options: MigrationOptions = {}): MigrationResult {
  const diagnostics = new DiagnosticCollector();

  let legacy;
  try {
    // errorRecovery:false → the previous parser throws instead of embedding an
    // ErrorBlock, so a failed migration is never a half-valid tree.
    legacy = legacyParse(source, { errorRecovery: false });
  } catch (error) {
    diagnostics.add('unrepresentable', `the v0.5.3 source did not parse: ${String(error)}`);
    return { text: '', diagnostics: diagnostics.ordered() };
  }

  const document = transformDocument(legacy, source, diagnostics);
  const formatted = format(document);

  if (formatted.status === 'ok' && roundTrips(formatted.source)) {
    return { text: formatted.source, diagnostics: diagnostics.ordered() };
  }

  // The transform produced something with no canonical 0.1.0 surface. Name the
  // actual obstruction instead of a generic fallback: `format`'s own diagnostic
  // when it failed, otherwise the 0.1.0 parser's rejection of the formatted
  // surface (e.g. "footnote reference [^x] has no definition", "invalid block
  // id suffix", "empty inline token") — a construct-level message the reviewer
  // and the evolution gate can act on.
  let reason: string;
  if (formatted.status !== 'ok') {
    reason = `no 0.1.0 canonical surface: ${localizeFormatFailure(document)}`;
  } else {
    const reparsed = parse(formatted.source);
    if (reparsed.status !== 'ok') {
      reason = `the migrated surface is invalid 0.1.0: ${reparsed.diagnostics[0]?.message ?? 'unknown'}`;
    } else {
      // Parses, but not back to the intended tree. Name the structural shift so
      // the diagnostic (and the evolution gate) can act on it.
      reason = `no stable 0.1.0 surface for that content: ${describeShift(document, reparsed.document)}`;
    }
  }
  diagnostics.add('unrepresentable', reason);
  return { text: formatted.status === 'ok' ? formatted.source : '', diagnostics: diagnostics.ordered() };
}

function roundTrips(text: string): boolean {
  const parsed = parse(text, { strict: true });
  if (parsed.status !== 'ok') return false;
  const again = format(parsed.document);
  return again.status === 'ok' && again.source === text;
}

/** AST properties that hold child nodes — never attribute bags like `attrs` / `dataAttrs`. */
export const CHILD_KEYS: ReadonlySet<string> = new Set([
  'children', 'items', 'alt', 'label', 'caption', 'attribution', 'head', 'body',
  'rows', 'cells', 'block', 'footnotes', 'columns', 'document', 'recovery',
]);

/**
 * `format` reports only "cannot format document". Walk the tree — following only
 * real child positions — to the smallest subtree that still fails in isolation
 * and name that node's `type` plus any obvious cause, so the diagnostic and the
 * evolution gate name a construct.
 */
function localizeFormatFailure(document: Document): string {
  const wrapBlock = (block: DocumentBlock): boolean =>
    format({ type: 'document', children: [block], footnotes: document.footnotes }).status === 'ok';
  const wrapInline = (node: Record<string, unknown>): boolean =>
    format({
      type: 'document',
      children: [{ type: 'paragraph', children: [node as never] } as DocumentBlock],
      footnotes: [],
    }).status === 'ok';

  const describe = (node: Record<string, unknown>): string => {
    const type = String(node['type'] ?? 'node');
    if (type === 'list' && node['kind'] === 'ordered' && typeof node['start'] === 'number' && node['start'] > 999_999_999) {
      return `an ordered list starting at ${node['start']} exceeds the 0.1.0 maximum (999999999)`;
    }
    if (type === 'link' && node['download'] === true) {
      return 'a download link that is the whole line must be a `downloadBlock` (§4.4); the migrator kept it inline';
    }
    return `a \`${type}\` has no 0.1.0 canonical surface`;
  };

  const culprit = document.children.find((block) => !wrapBlock(block)) as Record<string, unknown> | undefined;
  if (culprit === undefined) return 'the block composition has no 0.1.0 canonical surface';

  // If the culprit block has a specific known cause, name it directly.
  const blockReason = describe(culprit);
  if (!blockReason.endsWith('has no 0.1.0 canonical surface')) return blockReason;

  // Otherwise look for a failing inline node inside a paragraph / heading
  // (following real child positions only, so `attrs` / `dataAttrs` are skipped).
  const inlineCulprits: Record<string, unknown>[] = [];
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const record = value as Record<string, unknown>;
    const type = record['type'];
    if (typeof type === 'string' && type !== 'text' && !BLOCK_TYPES.has(type) && !wrapInline(record)) {
      inlineCulprits.push(record);
    }
    for (const [key, child] of Object.entries(record)) if (CHILD_KEYS.has(key)) visit(child);
  };
  visit(culprit);
  if (inlineCulprits.length === 0) return blockReason;
  // Prefer a node with a specific known cause; otherwise the outermost failing
  // construct (a lone `inlineImage` / `link` fails the probe only because of the
  // whole-line-resource rule, so its enclosing construct is the real cause).
  const specific = inlineCulprits.find((node) => !describe(node).endsWith('has no 0.1.0 canonical surface'));
  return describe(specific ?? inlineCulprits[0]!);
}

/** Recursive `type` histogram over real child positions. */
function typeHistogram(node: unknown, into = new Map<string, number>()): Map<string, number> {
  if (node === null || typeof node !== 'object') return into;
  if (Array.isArray(node)) { for (const item of node) typeHistogram(item, into); return into; }
  const record = node as Record<string, unknown>;
  if (typeof record['type'] === 'string') into.set(record['type'], (into.get(record['type']) ?? 0) + 1);
  for (const [key, value] of Object.entries(record)) if (CHILD_KEYS.has(key)) typeHistogram(value, into);
  return into;
}

/** Name how a reparsed tree differs in shape from the intended one. */
function describeShift(want: Document, got: Document): string {
  const a = typeHistogram(want);
  const b = typeHistogram(got);
  const deltas: string[] = [];
  for (const type of new Set([...a.keys(), ...b.keys()])) {
    const from = a.get(type) ?? 0;
    const to = b.get(type) ?? 0;
    if (from !== to) deltas.push(`\`${type}\` ${from}→${to}`);
  }
  deltas.sort();
  return deltas.length > 0
    ? `the migrated surface reparses with ${deltas.join(', ')}`
    : 'the migrated surface parses but is not byte-idempotent under the 0.1.0 formatter';
}

const BLOCK_TYPES: ReadonlySet<string> = new Set([
  'paragraph', 'heading', 'horizontalRule', 'codeBlock', 'mathBlock', 'commentBlock',
  'imageBlock', 'videoBlock', 'audioBlock', 'embedBlock', 'downloadBlock',
  'quoteRegion', 'container', 'directiveContainer', 'fencedContainer', 'list', 'listItem', 'table', 'tableRow',
]);
