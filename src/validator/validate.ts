/**
 * Pure semantic-AST validator (spec §5, §6, §7.5, §11, `docs/INVARIANTS.md`).
 *
 * `validate()` runs three passes, all with explicit work stacks so a
 * source-controlled AST depth yields `resource`, never a host stack overflow:
 *
 *  1. `checkShape` — a total, closed structural check: known `type`, exact key
 *     set, correct field types, no `null` where a node belongs.
 *  2. the document-wide relations — block-ID grammar / uniqueness / scope, the
 *     footnote reference relation, `identity: 'required'`, the `#anchor`
 *     advisory.
 *  3. the canonical formatter as the representability gate for the deep value
 *     invariants (only reached when 1 and 2 hold, and only after `checkShape`
 *     has bounded the tree depth, so the formatter's own recursion is safe).
 */
import type {
  Block, Container, Document, DocumentBlock, Grid, GridRow, IdScope, List, QuoteRegion,
} from '../ast.js';
import { diagnostic, type Diagnostic } from '../diagnostics.js';
import { format } from '../formatter/format.js';
import { isIdentifier } from '../parser/block-id.js';
import { collectFootnoteReferences } from '../parser/footnotes.js';
import { exceedsGridMatrixBudget } from '../parser/grid.js';
import { parse } from '../parser/parse.js';
import { semanticDocumentEquals } from '../semantic-equality.js';
import { checkInlineWhitespace } from './inline-whitespace.js';
import type { ValidationOptions, ValidationResult } from '../parser-contract.js';
import { checkShape } from './shape.js';

export function validate(document: Document, options: ValidationOptions = {}): ValidationResult {
  const shape = checkShape(document, options.resourceBudget);
  if (shape.status === 'resource') return { status: 'resource', diagnostics: shape.diagnostics };
  if (shape.status === 'invalid') return { status: 'invalid', diagnostics: shape.diagnostics };

  if (exceedsGridMatrixBudget(document, options.resourceBudget)) {
    return { status: 'resource', diagnostics: [diagnostic('resource', 'error', { message: 'grid matrix slot budget exceeded' })] };
  }

  const diagnostics: Diagnostic[] = [];

  // --- block-ID grammar + document-wide uniqueness + scope (spec §5, §6) --
  const ids = new Set<string>();
  const register = (id: string): void => {
    if (!isIdentifier(id)) {
      diagnostics.push(diagnostic('semantic', 'error', { message: `invalid block id {#${id}}` }));
    } else if (ids.has(id)) {
      diagnostics.push(diagnostic('semantic', 'error', { message: `duplicate block id {#${id}}` }));
    } else {
      ids.add(id);
    }
  };
  walkBlockScopes(document, (block, scope) => {
    const id = (block as { id?: string }).id;
    if (id === undefined) return;
    if (scope.owner !== 'document' && scope.owner !== 'container') {
      diagnostics.push(diagnostic('semantic', 'error', { message: `block id {#${id}} not permitted at ${scope.owner} scope` }));
      return;
    }
    register(id);
  });

  // --- footnote reference relation (spec §11) ----------------------------
  const definedCounts = new Map<string, number>();
  for (const definition of document.footnotes) {
    definedCounts.set(definition.identifier, (definedCounts.get(definition.identifier) ?? 0) + 1);
  }
  for (const [identifier, count] of definedCounts) {
    if (count > 1) {
      diagnostics.push(diagnostic('semantic', 'error', { message: `duplicate footnote definition [^${identifier}]` }));
    }
  }
  const referenced = new Set(collectFootnoteReferences(document.children));
  for (const identifier of referenced) {
    if (!definedCounts.has(identifier)) {
      diagnostics.push(diagnostic('semantic', 'error', { message: `footnote reference [^${identifier}] has no definition` }));
    }
  }
  for (const identifier of definedCounts.keys()) {
    if (!referenced.has(identifier)) {
      diagnostics.push(diagnostic('advisory', 'warning', { message: `footnote definition [^${identifier}] is never referenced` }));
    }
  }

  // --- `identity: 'required'` profile (spec §6) --------------------------
  if (options.identity === 'required') {
    walkBlockScopes(document, (block, scope) => {
      if (isIdRequired(block, scope) && (block as { id?: string }).id === undefined) {
        diagnostics.push(diagnostic('semantic', 'error', { message: `block id required at ${scope.owner} scope for ${block.type}` }));
      }
    });
  }

  // --- document-anchor advisory (spec §5, §13) --------------------------
  for (const anchor of collectAnchorReferences(document)) {
    if (!ids.has(anchor)) {
      diagnostics.push(diagnostic('advisory', 'warning', { message: `link to unresolved document anchor #${anchor}` }));
    }
  }

  // --- inline whitespace domain (spec §7.7, INVARIANTS) ----------------
  // A precise diagnostic for the one edge-whitespace mistake the closure gate
  // below would otherwise only report as a generic "no canonical surface".
  for (const message of checkInlineWhitespace(document)) {
    diagnostics.push(diagnostic('semantic', 'error', { message }));
  }

  // --- representability gate: the canonical formatter + its closure ----
  // Only consulted when the relations hold, so its generic message never
  // masks a precise diagnostic; `checkShape` has already bounded the depth.
  if (!diagnostics.some((entry) => entry.severity === 'error')) {
    const structural = format(document, options.resourceBudget);
    if (structural.status === 'resource') {
      return { status: 'resource', diagnostics: [...diagnostics, ...structural.diagnostics] };
    }
    if (structural.status === 'invalid') {
      return { status: 'invalid', diagnostics: [...diagnostics, ...structural.diagnostics] };
    }
    if (structural.status === 'ok') {
      // §7.2 law 2: the canonical surface must strict-parse back to a document
      // semantically equal to this AST. A formatter that emits a valid-looking
      // surface which reparses differently (or not at all) means this AST has
      // no canonical representation — it is not a valid semantic document.
      const reparsed = parse(structural.source, options.resourceBudget === undefined ? {} : { resourceBudget: options.resourceBudget });
      if (reparsed.status === 'resource') {
        return { status: 'resource', diagnostics: [...diagnostics, ...reparsed.diagnostics] };
      }
      if (reparsed.status !== 'ok') {
        diagnostics.push(diagnostic('semantic', 'error', { message: 'AST has no canonical surface: its formatted form does not parse (§7.2 law 2)' }));
      } else {
        const equality = semanticDocumentEquals(document, reparsed.document, options.resourceBudget);
        if (equality.status === 'resource') {
          return { status: 'resource', diagnostics: [...diagnostics, ...equality.diagnostics] };
        }
        if (!equality.equal) {
          diagnostics.push(diagnostic('semantic', 'error', { message: 'AST has no canonical surface: its formatted form reparses to a different document (§7.2 law 2)' }));
        }
      }
    }
  }

  if (diagnostics.some((entry) => entry.severity === 'error')) {
    return { status: 'invalid', diagnostics };
  }
  return { status: 'ok', diagnostics };
}

/**
 * True when an explicit block ID is permitted at this position — document-level
 * and direct container children, every block type except `commentBlock` (no
 * identity slot). Footnote definitions are ID-eligible (spec §5.1). Under
 * `identity: 'required'` every such position must carry an `id`;
 * `adoptDocument` fills exactly these positions.
 */
export function isIdRequired(block: Block, scope: IdScope): boolean {
  if (block.type === 'commentBlock') return false;
  return scope.owner === 'document' || scope.owner === 'container';
}

/**
 * Every block position and the ID scope it sits in (spec §5.3, INVARIANTS),
 * via an explicit stack. Assumes a shape-valid document.
 */
export function walkBlockScopes(document: Document, visit: (block: Block, scope: IdScope) => void): void {
  const stack: Array<{ block: Block; scope: IdScope }> = [];
  for (const definition of document.footnotes) visit(definition, { owner: 'document' });
  for (let index = document.children.length - 1; index >= 0; index -= 1) {
    stack.push({ block: document.children[index]!, scope: { owner: 'document' } });
  }
  while (stack.length > 0) {
    const { block, scope } = stack.pop()!;
    visit(block, scope);
    switch (block.type) {
      case 'container':
        for (const child of (block as Container).children) {
          if (child.type === 'grid') pushGrid(child, stack);
          else stack.push({ block: child, scope: { owner: 'container' } });
        }
        break;
      case 'quoteRegion':
        for (const entry of (block as QuoteRegion).children) {
          stack.push({ block: entry.block, scope: { owner: 'quoteRegion', idsAllowed: false } });
        }
        break;
      case 'list':
        for (const item of (block as List).items) {
          for (const child of item.children) stack.push({ block: child, scope: { owner: 'listItem', idsAllowed: false } });
        }
        break;
      default:
        break;
    }
  }
}

function pushGrid(grid: Grid, stack: Array<{ block: Block; scope: IdScope }>): void {
  const rows: readonly GridRow[] = [...(grid.header ?? []), ...grid.rows];
  for (const row of rows) {
    for (const cell of row.cells) {
      for (const child of cell.children) stack.push({ block: child, scope: { owner: 'gridCell', idsAllowed: false } });
    }
  }
}

/** Every `[text](#identifier)` anchor reference, via an explicit stack. */
function collectAnchorReferences(root: unknown): string[] {
  const out: string[] = [];
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      for (const child of node) stack.push(child);
      continue;
    }
    if (node === null || typeof node !== 'object') continue;
    const record = node as Record<string, unknown>;
    if (record['type'] === 'link' && typeof record['href'] === 'string') {
      const href = record['href'];
      if (href.length > 1 && href.charCodeAt(0) === 0x23) {
        const identifier = href.slice(1);
        if (isIdentifier(identifier)) out.push(identifier);
      }
    }
    for (const value of Object.values(record)) {
      if (value !== null && typeof value === 'object') stack.push(value);
    }
  }
  return out;
}
