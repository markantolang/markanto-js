/**
 * Semantic AST equality.
 *
 * Compares two semantic ASTs by their semantic fields only. It:
 *
 *  - ignores a `range` key only on an AST node (an object with a string `type`
 *    discriminator), where it is tooling source-location metadata; a `range`
 *    key inside a plain map such as `dataAttrs` (i.e. a `data-range` attribute)
 *    stays a compared semantic value;
 *  - ignores keys whose value is `undefined`, so an omitted optional and an
 *    explicit `undefined` compare equal (relevant under exactOptionalPropertyTypes);
 *  - is order-sensitive for arrays — `Document.footnotes` and every `children`
 *    list are already in canonical order in a valid AST (docs/INVARIANTS.md);
 *  - uses an explicit work stack, never call-stack recursion, so deeply nested
 *    list/quote structures cannot overflow (docs/INVARIANTS.md, "Lists");
 *  - returns an operational `resource` result if the traversal exceeds its
 *    budget, never `equal: false` on that basis.
 *
 * It assumes both inputs are already valid, normalised semantic ASTs. It does
 * not coalesce Text nodes, reorder footnotes, or otherwise repair input — that
 * is the validator's and formatter's job.
 *
 * Structural only: no per-node-type logic, so it ports directly and stays
 * correct as the AST grows.
 */

import type { Document, ResourceBudget, SemanticEqualityResult } from './ast.js';
import { diagnostic, type Diagnostic } from './diagnostics.js';

const DEFAULT_MAX_FRAMES = 200_000;
const DEFAULT_MAX_NODES = 20_000_000;

interface Frame {
  readonly a: unknown;
  readonly b: unknown;
}

export function semanticDocumentEquals(
  left: Document,
  right: Document,
  budget?: ResourceBudget,
): SemanticEqualityResult {
  const maxFrames = budget?.maxFrames ?? DEFAULT_MAX_FRAMES;
  const maxNodes = budget?.maxNodes ?? DEFAULT_MAX_NODES;

  const stack: Frame[] = [{ a: left, b: right }];
  let visited = 0;

  while (stack.length > 0) {
    if (stack.length > maxFrames) {
      return { status: 'resource', diagnostics: [resourceDiagnostic('frame budget')] };
    }

    const { a, b } = stack.pop()!;
    visited += 1;
    if (visited > maxNodes) {
      return { status: 'resource', diagnostics: [resourceDiagnostic('node budget')] };
    }

    if (a === b) continue;

    const ta = typeof a;
    const tb = typeof b;
    if (ta !== tb) return notEqual();

    if (a === null || b === null || ta !== 'object') {
      // primitive: string | number | boolean | undefined | bigint | symbol
      if (!Object.is(a, b)) return notEqual();
      continue;
    }

    const aArray = Array.isArray(a);
    const bArray = Array.isArray(b);
    if (aArray !== bArray) return notEqual();

    if (aArray) {
      const arrA = a as readonly unknown[];
      const arrB = b as readonly unknown[];
      if (arrA.length !== arrB.length) return notEqual();
      if (stack.length + arrA.length > maxFrames) {
        return { status: 'resource', diagnostics: [resourceDiagnostic('frame budget')] };
      }
      for (let i = 0; i < arrA.length; i += 1) {
        stack.push({ a: arrA[i], b: arrB[i] });
      }
      continue;
    }

    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    const keysA = semanticKeys(objA);
    const keysB = semanticKeys(objB);
    if (keysA.length !== keysB.length) return notEqual();
    if (stack.length + keysA.length > maxFrames) {
      return { status: 'resource', diagnostics: [resourceDiagnostic('frame budget')] };
    }

    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(objB, key)) return notEqual();
      stack.push({ a: objA[key], b: objB[key] });
    }
  }

  return { status: 'ok', equal: true };
}

function semanticKeys(obj: Record<string, unknown>): string[] {
  // A `range` sibling of a string `type` is node-level source-location metadata
  // (docs/INVARIANTS.md), never semantic. In a plain map — e.g. `dataAttrs`
  // carrying `data-range` — `range` is an ordinary compared value.
  const isNode = typeof obj['type'] === 'string';
  const keys: string[] = [];
  for (const key of Object.keys(obj)) {
    if (isNode && key === 'range') continue;
    if (obj[key] === undefined) continue;
    keys.push(key);
  }
  return keys;
}

function notEqual(): SemanticEqualityResult {
  return { status: 'ok', equal: false };
}

function resourceDiagnostic(which: string): Diagnostic {
  return diagnostic('resource', 'error', {
    message: `semantic equality traversal exceeded its ${which}`,
  });
}
