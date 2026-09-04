/**
 * Reference ID tooling (spec §6). `adoptDocument` returns a deep clone of the
 * document with a generated `id` on every ID-eligible position that lacks one:
 * document-level blocks, direct container children (recursing through
 * `lined -> fenced` nesting), and footnote definitions — every block type
 * except `commentBlock`.
 *
 * Explicit IDs are never overwritten, so the operation is idempotent. Blocks
 * inside quotes, lists, and Grid cells are never assigned an ID — that is a
 * validator invariant, not a tooling choice. Collision checking stays with the
 * validator; `adoptDocument` only avoids re-emitting an ID that is already
 * present in the input.
 */
import type { AdoptResult, Container, Document, DocumentBlock, IdGenerator } from '../ast.js';
import { isIdentifier } from '../parser/block-id.js';

/**
 * Attempts allowed per position before `createId` is judged non-conforming.
 * `createId` must return values matching the block-ID grammar and must
 * eventually yield one not already present; a generator that violates this is a
 * caller bug and raises a descriptive `Error` (never a silent bad ID).
 */
const MAX_ID_ATTEMPTS = 1_000;

export function adoptDocument(doc: Document, createId: IdGenerator): AdoptResult {
  const document = cloneNode(doc);
  const used = new Set<string>();
  collectExistingIds(document, used);

  let addedIds = 0;
  const assign = (block: { id?: string }): void => {
    if (block.id !== undefined) return;
    let candidate: string | undefined;
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
      const next = createId();
      if (!isIdentifier(next)) {
        throw new Error(`adoptDocument: createId returned ${JSON.stringify(next)}, which is not a valid block identifier`);
      }
      if (!used.has(next)) { candidate = next; break; }
    }
    if (candidate === undefined) {
      throw new Error(`adoptDocument: createId did not produce a fresh identifier within ${MAX_ID_ATTEMPTS} attempts`);
    }
    used.add(candidate);
    block.id = candidate;
    addedIds += 1;
  };

  for (const block of document.children) adoptBlock(block, assign);
  for (const definition of document.footnotes) assign(definition);

  return { document, addedIds };
}

function adoptBlock(block: DocumentBlock, assign: (block: { id?: string }) => void): void {
  if (block.type !== 'commentBlock') assign(block);
  if (block.type === 'container') {
    for (const child of (block as Container).children) {
      if (child.type === 'grid') continue; // Grid-cell blocks carry no IDs.
      adoptBlock(child, assign);
    }
  }
}

/**
 * Structural deep clone for the semantic AST, which is plain data: strings,
 * numbers, booleans, arrays, and object literals. No `structuredClone`
 * dependency (not in the configured lib), no prototype or reference sharing.
 */
function cloneNode<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneNode(entry)) as unknown as T;
  }
  if (value === null || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source)) out[key] = cloneNode(source[key]);
  return out as T;
}

function collectExistingIds(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const child of node) collectExistingIds(child, out);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  if (typeof record['id'] === 'string') out.add(record['id']);
  for (const value of Object.values(record)) {
    if (value !== null && typeof value === 'object') collectExistingIds(value, out);
  }
}
