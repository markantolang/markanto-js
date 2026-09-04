/**
 * Document-level footnote definitions (spec §11).
 *
 * A `[^id]: <inline>` line is not a `DocumentBlock` — it is hoisted into
 * `Document.footnotes`. `parse()` recognises the line before block dispatch,
 * collects the definitions, and calls `resolveFootnotes` once the document
 * tree exists to validate the reference relation and produce the canonical
 * order (spec §11.7).
 */
import type { DocumentBlock, FootnoteDefinition } from '../ast.js';
import type { DiagnosticSink } from '../diagnostics.js';
import type { SourceAnnotationBuilder } from '../parser-contract.js';
import type { PhysicalLine } from '../source/index.js';
import { parseInline } from './inline/scanner.js';

export interface FootnoteDefinitionResult {
  readonly node: FootnoteDefinition;
  readonly end: number;
  readonly nodeCount: number;
}
export type FootnoteScanResult =
  | FootnoteDefinitionResult
  | { readonly error: string; readonly category: 'syntax' | 'semantic'; readonly start: number; readonly end: number }
  | null;

/** `[^<id>]: ` at the very start of the line, with non-empty content. */
export function footnoteDefinitionContentStart(text: string, line: PhysicalLine): { identifier: string; contentStart: number } | null {
  if (!text.startsWith('[^', line.start)) return null;
  let cursor = line.start + 2;
  const identifierStart = cursor;
  while (cursor < line.contentEnd && isIdentifierCode(text.charCodeAt(cursor))) cursor += 1;
  if (cursor === identifierStart || text.charCodeAt(cursor) !== 0x5d) return null;
  const identifier = text.slice(identifierStart, cursor);
  cursor += 1;
  if (text.charCodeAt(cursor) !== 0x3a || text.charCodeAt(cursor + 1) !== 0x20) return null;
  const contentStart = cursor + 2;
  if (contentStart >= line.contentEnd) return null;
  return { identifier, contentStart };
}

export function recognizeFootnoteDefinition(
  line: PhysicalLine, text: string, annotations: SourceAnnotationBuilder,
): FootnoteScanResult {
  const scan = footnoteDefinitionContentStart(text, line);
  if (scan === null) return null;
  const parsed = parseInline(text, scan.contentStart, line.contentEnd, annotations);
  if (parsed.status === 'error') {
    return { error: parsed.message, category: parsed.category ?? 'syntax', start: line.start, end: line.contentEnd };
  }
  if (parsed.nodes.length === 0) {
    return { error: 'empty footnote definition', category: 'syntax', start: line.start, end: line.contentEnd };
  }
  if (parsed.nodes.some((node) => node.type === 'softBreak' || node.type === 'hardBreak')) {
    return { error: 'footnote definition content is single-line', category: 'semantic', start: line.start, end: line.contentEnd };
  }
  if (containsFootnoteReference(parsed.nodes)) {
    return { error: 'footnote definition contains a nested footnote reference', category: 'semantic', start: line.start, end: line.contentEnd };
  }
  const node: FootnoteDefinition = {
    type: 'footnoteDefinition',
    identifier: scan.identifier,
    children: parsed.nodes as FootnoteDefinition['children'],
  };
  annotations.set(node, line.start, line.contentEnd);
  return { node, end: line.contentEnd, nodeCount: 1 + parsed.nodeCount };
}

/**
 * Validate the document-level footnote relation and return the canonical
 * `Document.footnotes` order (§11.7): referenced definitions in first-reference
 * order, then unreferenced ones in ascending identifier byte order. Reports
 * semantic errors for a missing reference target or a duplicate definition,
 * and an advisory warning per unused definition.
 */
export function resolveFootnotes(
  children: readonly DocumentBlock[], definitions: readonly FootnoteDefinition[], diagnostics: DiagnosticSink,
): { footnotes: FootnoteDefinition[]; ok: boolean } {
  const byIdentifier = new Map<string, FootnoteDefinition[]>();
  for (const definition of definitions) {
    const existing = byIdentifier.get(definition.identifier);
    if (existing === undefined) byIdentifier.set(definition.identifier, [definition]);
    else existing.push(definition);
  }

  let ok = true;
  for (const [identifier, group] of byIdentifier) {
    if (group.length > 1) {
      diagnostics.semanticError({ message: `duplicate footnote definition [^${identifier}]` });
      ok = false;
    }
  }

  const referenceOrder: string[] = [];
  const referenced = new Set<string>();
  for (const identifier of collectFootnoteReferences(children)) {
    if (!referenced.has(identifier)) {
      referenced.add(identifier);
      referenceOrder.push(identifier);
    }
  }

  for (const identifier of referenceOrder) {
    if (!byIdentifier.has(identifier)) {
      diagnostics.semanticError({ message: `footnote reference [^${identifier}] has no definition` });
      ok = false;
    }
  }

  const unusedIdentifiers = [...byIdentifier.keys()].filter((identifier) => !referenced.has(identifier)).sort(compareAscii);
  for (const identifier of unusedIdentifiers) {
    diagnostics.advisory({ message: `unused footnote definition [^${identifier}]` });
  }

  const orderedReferenced = referenceOrder
    .filter((identifier) => byIdentifier.has(identifier))
    .map((identifier) => byIdentifier.get(identifier)![0]!);
  const orderedUnused = unusedIdentifiers.map((identifier) => byIdentifier.get(identifier)![0]!);
  return { footnotes: [...orderedReferenced, ...orderedUnused], ok };
}

/** Canonical footnote identifier order for a valid document, or null when the relation is broken. */
export function canonicalFootnoteOrder(
  children: readonly unknown[], footnotes: readonly FootnoteDefinition[],
): string[] | null {
  const identifiers = new Set<string>();
  for (const definition of footnotes) {
    if (identifiers.has(definition.identifier)) return null;
    identifiers.add(definition.identifier);
  }
  const referenceOrder: string[] = [];
  const referenced = new Set<string>();
  for (const identifier of collectFootnoteReferences(children)) {
    if (!referenced.has(identifier)) {
      referenced.add(identifier);
      referenceOrder.push(identifier);
    }
  }
  for (const identifier of referenceOrder) if (!identifiers.has(identifier)) return null;
  const orderedReferenced = referenceOrder.filter((identifier) => identifiers.has(identifier));
  const orderedUnused = [...identifiers].filter((identifier) => !referenced.has(identifier)).sort(compareAscii);
  return [...orderedReferenced, ...orderedUnused];
}

/**
 * Footnote-reference identifiers in normative document order (spec §11.5,
 * §11.7). The walk is typed and explicitly ordered — it never relies on
 * JavaScript object-property order, so the "first reference" verdict is
 * identical in JS and a Rust port. It uses an explicit work stack, so a deep
 * AST cannot overflow the host call stack.
 */
export function collectFootnoteReferences(root: unknown): string[] {
  const out: string[] = [];
  const stack: unknown[] = [];
  pushReversed(stack, Array.isArray(root) ? root : [root]);
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    const record = node as Record<string, unknown>;
    if (record['type'] === 'footnoteReference') {
      if (typeof record['identifier'] === 'string') out.push(record['identifier']);
      continue;
    }
    pushReversed(stack, orderedChildren(record));
  }
  return out;
}

function pushReversed(stack: unknown[], items: readonly unknown[]): void {
  for (let index = items.length - 1; index >= 0; index -= 1) stack.push(items[index]);
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Child nodes that may carry inline content, in source/document order. */
function orderedChildren(node: Record<string, unknown>): readonly unknown[] {
  switch (node['type']) {
    case 'document':
    case 'paragraph':
    case 'heading':
    case 'em': case 'strong': case 'deletion': case 'obsolete': case 'insert': case 'mark':
    case 'metadataSpan':
    case 'link':
    case 'container':
    case 'footnoteDefinition':
      return asArray(node['children']);
    case 'inlineImage':
      return asArray(node['alt']);
    case 'imageBlock':
      return [...asArray(node['alt']), ...asArray(node['caption'])];
    case 'videoBlock': case 'audioBlock': case 'embedBlock': case 'downloadBlock':
      return [...asArray(node['label']), ...asArray(node['caption'])];
    case 'quoteRegion': {
      const blocks = asArray(node['children']).map((entry) => (entry as Record<string, unknown> | null)?.['block']);
      return [...blocks, ...asArray(node['attribution'])];
    }
    case 'list': {
      const out: unknown[] = [];
      for (const item of asArray(node['items'])) out.push(...asArray((item as Record<string, unknown>)['children']));
      return out;
    }
    case 'table':
      return cellChildren([node['head'], ...asArray(node['body'])]);
    case 'grid':
      return cellChildren([...asArray(node['header']), ...asArray(node['rows'])]);
    default:
      return [];
  }
}

/** Flatten every cell's inline/block children across the given rows, in order. */
function cellChildren(rows: readonly unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const row of rows) {
    for (const cell of asArray((row as Record<string, unknown> | null)?.['cells'])) {
      out.push(...asArray((cell as Record<string, unknown>)['children']));
    }
  }
  return out;
}

function containsFootnoteReference(nodes: readonly unknown[]): boolean {
  return collectFootnoteReferences(nodes).length > 0;
}

function isIdentifierCode(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) || code === 0x5f || code === 0x2d;
}

function compareAscii(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
