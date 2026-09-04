/**
 * Operational parser / formatter / validator contract.
 *
 * This is **not** language semantics. Nothing here participates in
 * `semanticDocumentEquals`, canonical output, or spec conformance. It is the
 * stable surface a consumer (the Hadley SSG, a CLI, an editor) codes against.
 *
 * The semantic AST (`src/ast.ts`) deliberately carries no source locations
 * (docs/PORTABILITY.md "Source-location policy"). Consumers that need
 * source-addressable blocks — editor block ranges, source ordering, stable
 * per-block ids — get them from the **source-annotation sidecar** returned
 * alongside the document, never from a `range` field on a semantic node.
 *
 * Full prose: `docs/PARSER_CONTRACT.md`.
 */

import type {
  Document,
  DocumentBlock,
  ErrorBlock,
  FootnoteDefinition,
  Grid,
  GridCell,
  GridRow,
  Inline,
  ListItem,
  QuoteBlock,
  RecoveryDocument,
  ResourceBudget,
  TableCell,
  TableRow,
} from './ast.js';
import type { Diagnostic } from './diagnostics.js';
import type { Point, Span } from './source/position.js';
import type { Source } from './source/index.js';

// ---------------------------------------------------------------------------
// Coordinate space
// ---------------------------------------------------------------------------

/**
 * The indexing convention for every offset in a single parser result. Declared
 * once per result on `SourceAnnotations.offsetUnit` and never mixed, and never
 * repeated on individual points. The TypeScript reference implementation uses
 * `utf16-code-unit`; a Rust port may declare `utf8-byte`.
 */
export type OffsetUnit = 'utf16-code-unit' | 'utf8-byte';

/**
 * Every offset the sidecar reports is in the **public source coordinate
 * space**: the raw input with a leading BOM removed and CRLF/CR preserved. The
 * parser works internally on normalised text and projects offsets back into
 * this space before recording an annotation, so a consumer's editor positions
 * line up with the source the user actually edits.
 */
export type AnnotatedPoint = Point;
export type AnnotatedRange = Span;

// ---------------------------------------------------------------------------
// Source-annotation sidecar
// ---------------------------------------------------------------------------

/**
 * Every object in a parsed tree that represents a recognised source construct
 * and may carry a source annotation. Primitive leaves (`Text.value`, numbers)
 * are not annotatable; their owning node is.
 */
export type AnnotatableNode =
  | Document
  | RecoveryDocument
  | DocumentBlock
  | Grid
  | ListItem
  | TableRow
  | TableCell
  | FootnoteDefinition
  | Inline
  | QuoteBlock
  | GridRow
  | GridCell
  | ErrorBlock;

/**
 * What a consumer learns about one node's origin in source.
 *
 * `range` is the node's source extent in the public coordinate space,
 * half-open, following the boundary rule in `docs/PARSER_CONTRACT.md`: it
 * covers the node's own syntactic carriers and postfixes but not separating
 * blank lines and not the terminating LF after the node's last own token.
 *
 * The field set is intentionally small and additive — a later phase may add
 * e.g. an opener/label sub-range without breaking consumers.
 */
export interface NodeAnnotation {
  readonly range: AnnotatedRange;
}

/**
 * The public, read-only sidecar. Associates annotatable nodes of **one** parser
 * result with their source annotation, entirely separately from the semantic
 * values. Consumers receive a `SourceAnnotations`; only the parser holds a
 * `SourceAnnotationBuilder`.
 *
 * ## Association mechanism vs. contract
 *
 * The contract is behavioural: *for every traversable object of this result's
 * `document` (or `recovery`), its annotation is deterministically retrievable
 * via `forNode`.* The storage mechanism is an implementation detail. The
 * TypeScript reference implementation uses a `WeakMap` keyed by object
 * identity. A Rust port has no cheap identity map and owns the tree, so it
 * builds a parallel annotation structure during the AST-building traversal (an
 * arena-index table, or a shape-parallel tree). A port satisfies the contract
 * by making annotations retrievable per result object; it need not offer a
 * `forNode(node)` method with this exact signature.
 *
 * ## Semantic-equality guarantee
 *
 * `SourceAnnotations` is never read by `semanticDocumentEquals`. Two results
 * with structurally equal documents and different (or absent) annotations are
 * semantically equal.
 */
export interface SourceAnnotations {
  readonly offsetUnit: OffsetUnit;
  forNode(node: object): NodeAnnotation | undefined;
  has(node: object): boolean;
}

function freezeAnnotation(range: Span): NodeAnnotation {
  Object.freeze(range.start);
  Object.freeze(range.end);
  Object.freeze(range);
  return Object.freeze({ range });
}

/**
 * Deferred annotation storage. `set()` records only the validated normalised
 * `[start, end]` pair; the line/column point objects and their `Object.freeze`
 * are built by `forNode()` on first query and memoised. A parser annotates
 * every node but a consumer reads a handful, so this moves `O(nodes)` line-map
 * + freeze work to `O(nodes queried)`.
 *
 * The pair is packed into one number (no per-node allocation) while
 * `(text.length + 1)² <= MAX_SAFE_INTEGER` — i.e. for every source below
 * ~95 M UTF-16 code units. Larger sources fall back to a two-element tuple so
 * the decoded pair is always exact.
 */
type PendingAnnotation = number | readonly [number, number];
function isPending(entry: PendingAnnotation | NodeAnnotation): entry is PendingAnnotation {
  return typeof entry === 'number' || Array.isArray(entry);
}

/** The coherent slice of a `Source` the builder needs. */
export type SourceAnnotationContext = Pick<Source, 'sourceMap' | 'toSourceOffset' | 'text'>;

/**
 * Parser-internal builder. **Not part of the stable consumer contract** —
 * consumers get the `SourceAnnotations` view returned by `seal()`. Prefer the
 * `createSourceAnnotationBuilder(source)` factory so map, projector and length
 * always come from one `Source`.
 *
 * `set` takes normalised parser offsets and projects them into the public
 * coordinate space via that `Source`. After `seal()` the sidecar is immutable:
 * `set` throws, and every stored `NodeAnnotation` (and its points) is frozen.
 */
export class SourceAnnotationBuilder implements SourceAnnotations {
  private readonly byNode = new WeakMap<object, PendingAnnotation | NodeAnnotation>();
  private sealed = false;
  /** Packing radix for the `[start, end]` pair, or 0 when packing is unsafe. */
  private readonly stride: number;

  constructor(
    readonly offsetUnit: OffsetUnit,
    /** One coherent source context — never assemble the parts by hand. */
    private readonly source: SourceAnnotationContext,
  ) {
    const stride = source.text.length + 1;
    this.stride = stride * stride <= Number.MAX_SAFE_INTEGER ? stride : 0;
  }

  /**
   * Record a node's extent, given normalised parser offsets `[start, end)`.
   * Rejects a non-integer / negative / out-of-range offset or `start > end` —
   * a bad offset is a parser bug, not a silently-clamped annotation. Only the
   * validated pair is stored; `forNode()` builds the point objects on demand.
   */
  set(node: AnnotatableNode, normalizedStart: number, normalizedEnd: number): void {
    if (this.sealed) {
      throw new Error('SourceAnnotationBuilder: cannot set after seal()');
    }
    const max = this.source.text.length;
    assertOffset(normalizedStart, 'start', max);
    assertOffset(normalizedEnd, 'end', max);
    if (normalizedStart > normalizedEnd) {
      throw new RangeError(
        `SourceAnnotationBuilder: start ${normalizedStart} > end ${normalizedEnd}`,
      );
    }
    this.byNode.set(
      node,
      this.stride === 0 ? [normalizedStart, normalizedEnd] : normalizedStart * this.stride + normalizedEnd,
    );
  }

  private materialize(entry: PendingAnnotation): NodeAnnotation {
    const [normalizedStart, normalizedEnd] = typeof entry === 'number'
      ? [Math.floor(entry / this.stride), entry - Math.floor(entry / this.stride) * this.stride]
      : entry;
    return freezeAnnotation(this.source.sourceMap.spanAt(
      this.source.toSourceOffset(normalizedStart),
      this.source.toSourceOffset(normalizedEnd),
    ));
  }

  /** Return the read-only view. Call once, when parsing is done. */
  seal(): SourceAnnotations {
    this.sealed = true;
    return Object.freeze({
      offsetUnit: this.offsetUnit,
      forNode: (node: object) => this.forNode(node),
      has: (node: object) => this.byNode.has(node),
    });
  }

  forNode(node: object): NodeAnnotation | undefined {
    const entry = this.byNode.get(node);
    if (entry === undefined) return undefined;
    if (!isPending(entry)) return entry;
    const annotation = this.materialize(entry);
    this.byNode.set(node, annotation);
    return annotation;
  }

  has(node: object): boolean {
    return this.byNode.has(node);
  }
}

/**
 * The blessed way to make a builder: every part comes from one `Source`, so
 * map, projector and length can never be mismatched.
 */
export function createSourceAnnotationBuilder(
  source: Source,
  offsetUnit: OffsetUnit = 'utf16-code-unit',
): SourceAnnotationBuilder {
  return new SourceAnnotationBuilder(offsetUnit, source);
}

function assertOffset(value: number, label: string, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(
      `SourceAnnotationBuilder: ${label} must be an integer in [0, ${max}], got ${value}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ParserOptions {
  /** `false`/default = documented tolerant input; `true` = canonical input only. */
  strict?: boolean;
  /**
   * `true` = on invalid input, also produce a `RecoveryDocument` (which may
   * contain `ErrorBlock`s) instead of only diagnostics. Never changes the AST
   * of valid input.
   */
  errorRecovery?: boolean;
  resourceBudget?: ResourceBudget;
}

export type IdentityValidationMode = 'optional' | 'required';

export interface ValidationOptions {
  /**
   * `'required'` — every ID-eligible position (document-level and direct
   * container children, plus footnote definitions; not `commentBlock`) must
   * carry an explicit `id`. This is the durable-identity tooling profile that
   * pairs with `adoptDocument`; it is a tooling policy, not Core semantics
   * (see `docs/PARSER_CONTRACT.md`).
   */
  identity?: IdentityValidationMode;
  /**
   * Reserved. A pure semantic-AST validator has no source to judge surface
   * canonicality against — every valid AST is already canonically
   * representable. Surface-canonicality checking belongs to a future
   * source-level `checkCanonical(source)` API. Currently ignored.
   */
  canonical?: boolean;
  resourceBudget?: ResourceBudget;
}

// ---------------------------------------------------------------------------
// Tagged results
// ---------------------------------------------------------------------------

/**
 * Every variant carries `offsetUnit` (the unit for any `Diagnostic.range` and,
 * where present, the sidecar) and `diagnostics` (the single list for the
 * operation). Optional payload fields are pinned to `never` on the variants
 * that must not carry them, so an over-shaped object cannot be assigned even
 * from a pre-bound variable.
 *
 * `ok` — a fully valid semantic `Document`. `diagnostics` may carry
 *   `warning`-severity advisories; never an `error`.
 * `invalid` — no valid semantic document. Two shapes: **both** `recovery` and
 *   its `annotations` (`ParserOptions.errorRecovery` was set), or **neither**.
 * `resource` — a declared budget was exhausted before a verdict. No tree.
 *   Operational, not "the source is invalid".
 */
interface ParseResultBase {
  readonly offsetUnit: OffsetUnit;
  readonly diagnostics: readonly Diagnostic[];
}

export type ParseResult =
  | (ParseResultBase & {
      status: 'ok';
      document: Document;
      annotations: SourceAnnotations;
      recovery?: never;
    })
  | (ParseResultBase & {
      status: 'invalid';
      recovery: RecoveryDocument;
      annotations: SourceAnnotations;
      document?: never;
    })
  | (ParseResultBase & {
      status: 'invalid';
      recovery?: never;
      annotations?: never;
      document?: never;
    })
  | (ParseResultBase & {
      status: 'resource';
      document?: never;
      recovery?: never;
      annotations?: never;
    });

/**
 * The formatter and pure-AST validator operate on a semantic AST, which has no
 * source. Their diagnostics point at an AST node/path, not a source span, and
 * therefore never carry `Diagnostic.range`. No `offsetUnit`.
 */
export type CanonicalFormatResult =
  | { status: 'ok'; source: string; diagnostics: readonly Diagnostic[] }
  | { status: 'invalid'; diagnostics: readonly Diagnostic[] }
  | { status: 'resource'; diagnostics: readonly Diagnostic[] };

/** Result of checking source-level canonicality without changing its semantics. */
export type CanonicalCheckResult =
  | { status: 'canonical'; diagnostics: readonly Diagnostic[] }
  | { status: 'noncanonical'; canonical: string; diagnostics: readonly Diagnostic[] }
  | { status: 'invalid'; diagnostics: readonly Diagnostic[] }
  | { status: 'resource'; diagnostics: readonly Diagnostic[] };

export type CheckCanonical = (source: string) => CanonicalCheckResult;

export type ValidationResult =
  | { status: 'ok'; diagnostics: readonly Diagnostic[] }
  | { status: 'invalid'; diagnostics: readonly Diagnostic[] }
  | { status: 'resource'; diagnostics: readonly Diagnostic[] };

export type ValidateDocument = (
  doc: Document,
  options?: ValidationOptions,
) => ValidationResult;
