/**
 * Markanto — Semantic AST Schema v0.1.0
 *
 * Migrated from markanto-ast-v0.4.0.ts and aligned with the Markanto 0.1.0
 * specification. This file is the machine-readable reference shape for the
 * normative semantic AST. Parser internals may differ. The TypeScript shape is
 * a structural reference; validity additionally requires all invariants in
 * docs/INVARIANTS.md (including context and serializability constraints).
 *
 * Semantic equality ignores parser/tooling source locations, diagnostics, recovery
 * nodes, and other implementation metadata. Valid Markanto never contains ErrorBlock in
 * its semantic AST.
 */

// ---------------------------------------------------------------------------
// Generic helpers and optional parser/tooling source annotations
// ---------------------------------------------------------------------------

export type NonEmptyArray<T> = [T, ...T[]];
export type NodeId = string;

// ---------------------------------------------------------------------------
// Operational parser / validator interfaces — not document semantics
// ---------------------------------------------------------------------------
//
// The parser/formatter/validator result shapes, `ParserOptions`,
// `ValidationOptions`, and the source-annotation sidecar live in
// `src/parser-contract.ts`; `Diagnostic` and its unit-safe `range` live in
// `src/diagnostics.ts`. Source locations are never fields of a semantic node —
// consumers get them from the parser result's source-annotation sidecar. Only
// the pieces the semantic layer itself needs (`ResourceBudget`,
// `SemanticEqualityResult`) stay here.

import type { Diagnostic } from './diagnostics.js';

export interface ResourceBudget {
  /** Tool-defined work/node budget; absence means use the implementation default. */
  maxNodes?: number;
  /** Tool-defined nesting/frame budget; not a language-validity rule. */
  maxFrames?: number;
  /** Tool-defined source-size budget in bytes, where applicable. */
  maxSourceBytes?: number;
  /** Tool-defined temporary occupancy/matrix budget, e.g. Grid geometry validation. */
  maxMatrixSlots?: number;
}

/**
 * Reference-tooling default for {@link ResourceBudget.maxMatrixSlots} (spec 7.5
 * names "matrix size" a required safe limit). A Grid's transient occupancy
 * matrix is `columns x (header + body rows)`; a compact AST can name a huge one
 * through a large `columns`/`colSpan` without any matching source size, so
 * `parse`, `validate`, and `format` bound it even when no budget is passed.
 * Any real hand-authored Grid is a few thousand slots at most.
 */
export const DEFAULT_MAX_MATRIX_SLOTS = 100_000;

/**
 * Absolute implementation ceiling for a Grid occupancy matrix. Unlike
 * {@link DEFAULT_MAX_MATRIX_SLOTS} this is *not* a caller-tunable policy: a
 * `ResourceBudget.maxMatrixSlots` may raise or lower the default, but no Grid
 * whose matrix would exceed this bound is ever allowed to reach an `Array`
 * allocation, whatever budget the caller passes. It is a resource-safety limit,
 * not the `2**32 - 1` maximum of the JavaScript array-length spec — a matrix
 * that large is already a catastrophic allocation. 1_000_000 slots (~1000x1000)
 * is orders of magnitude past any real hand-authored or imported Grid.
 */
export const HARD_MAX_MATRIX_SLOTS = 1_000_000;

/**
 * Recovery-only node for invalid source. It is intentionally excluded from all
 * semantic AST unions below. It carries no source location of its own — a
 * recovery result's source-annotation sidecar annotates each `ErrorBlock`
 * (`AnnotatableNode` in `src/parser-contract.ts`).
 */
export interface ErrorBlock {
  type: 'errorBlock';
  reason: string;
  rawContent: string;
}

// ---------------------------------------------------------------------------
// Metadata attributes
// ---------------------------------------------------------------------------

/**
 * Stored without the `data-` prefix. Keys are lowercase ASCII and match
 * [a-z][a-z0-9_-]*. data-* never carries indispensable Markanto Core meaning.
 */
export type DataAttributes = Record<string, string>;

export interface ImageResourceAttributes {
  /** NFC-normalised document-local opaque group identifier. */
  group?: string;
  /** Well-formed BCP 47 tag; registry lookup is not a Core validity condition. */
  lang?: string;
  dataAttrs?: DataAttributes;
}

export interface MediaResourceAttributes extends ImageResourceAttributes {
  /** Well-formed BCP 47 tag; registry lookup is not a Core validity condition. */
  lang?: string;
  /** Resource target using the same destination semantics as Markdown links. */
  preview?: string;
}

export interface DownloadResourceAttributes {
  /** Well-formed BCP 47 tag; registry lookup is not a Core validity condition. */
  lang?: string;
  dataAttrs?: DataAttributes;
}

export interface MetadataSpanAttributes {
  lang?: string;
  dataAttrs?: DataAttributes;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export interface Document {
  type: 'document';
  children: DocumentBlock[];
  /**
   * Footnote definitions are semantic document data. The canonical formatter
   * places them at the end. This array is already in the canonical order
   * defined by the specification; a formatter does not reorder it.
   */
  footnotes: FootnoteDefinition[];
}

// ---------------------------------------------------------------------------
// Block unions
// ---------------------------------------------------------------------------

export type LeafBlock =
  | Heading
  | Paragraph
  | HorizontalRule
  | CodeBlock
  | MathBlock
  | CommentBlock
  | ImageBlock
  | VideoBlock
  | AudioBlock
  | EmbedBlock
  | DownloadBlock
  | List
  | Table;

/** Containers are not permitted inside quote regions. */
export type QuoteContentBlock = LeafBlock;

/** Ordinary container content: block Markdown/Markanto content, but no container. */
export type ContainerOrdinaryBlock = LeafBlock | QuoteRegion;

/** Fenced containers may contain either ordinary content or one semantic Grid. */
export type FencedContainerContentBlock = ContainerOrdinaryBlock | Grid;

/** Lined containers may additionally contain direct fenced-container children. */
export type LinedContainerContentBlock =
  | ContainerOrdinaryBlock
  | FencedContainer;

export type Container = LinedContainer | FencedContainer;

export type DocumentBlock = LeafBlock | QuoteRegion | Container;
export type Block = DocumentBlock | FootnoteDefinition;

// ---------------------------------------------------------------------------
// Leaf blocks
// ---------------------------------------------------------------------------

export interface Heading {
  type: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
  id?: NodeId;
  children: NonEmptyArray<InlineWithoutBreak>;
}

export interface Paragraph {
  type: 'paragraph';
  id?: NodeId;
  children: NonEmptyArray<Inline>;
}

export interface HorizontalRule {
  type: 'horizontalRule';
  id?: NodeId;
}

export interface CodeBlock {
  type: 'codeBlock';
  /** `math` is represented by MathBlock instead. */
  lang?: string;
  /** Literal fenced content; excludes the structural LF immediately before the closer. */
  value: string;
  id?: NodeId;
}

export interface MathBlock {
  type: 'mathBlock';
  /** Literal fenced content; excludes the structural LF immediately before the closer. */
  value: string;
  id?: NodeId;
}

/**
 * Dedicated HTML-comment syntax `<!--...-->`. `value` is exactly the literal
 * character sequence between opener and closer. Renderers emit no visible
 * content, but the node is semantic so parse/format round-trips preserve it.
 */
export interface CommentBlock {
  type: 'commentBlock';
  /** Valid semantic AST values must not contain the literal closer `-->`. */
  value: string;
}

// ---------------------------------------------------------------------------
// Resource blocks
// ---------------------------------------------------------------------------

/** Native Markdown image used as a block resource. */
export interface ImageBlock {
  type: 'imageBlock';
  src: string;
  /** Parsed Markdown image description; may be empty. Renderer derives plain alt text. */
  alt: Inline[];
  title?: string;
  /** Children of the syntax-only outer caption emphasis carrier. */
  caption?: NonEmptyArray<InlineWithoutBreak>;
  /** image context: group + data-* only */
  attrs?: ImageResourceAttributes;
  id?: NodeId;
}

export interface VideoBlock {
  type: 'videoBlock';
  src: string;
  label: Inline[];
  title?: string;
  caption?: NonEmptyArray<InlineWithoutBreak>;
  /** video context: group + lang + preview + data-* */
  attrs?: MediaResourceAttributes;
  id?: NodeId;
}

export interface AudioBlock {
  type: 'audioBlock';
  src: string;
  label: Inline[];
  title?: string;
  caption?: NonEmptyArray<InlineWithoutBreak>;
  /** audio context: group + lang + preview + data-* */
  attrs?: MediaResourceAttributes;
  id?: NodeId;
}

export interface EmbedBlock {
  type: 'embedBlock';
  target: string;
  label: Inline[];
  title?: string;
  caption?: NonEmptyArray<InlineWithoutBreak>;
  /** embed context: group + lang + preview + data-* */
  attrs?: MediaResourceAttributes;
  id?: NodeId;
}

/** `download` is block-capable again in 0.1.0 when it occupies the full logical line. */
export interface DownloadBlock {
  type: 'downloadBlock';
  href: string;
  label: Inline[];
  title?: string;
  caption?: NonEmptyArray<InlineWithoutBreak>;
  /** download context: lang + data-* only */
  attrs?: DownloadResourceAttributes;
  id?: NodeId;
}

// ---------------------------------------------------------------------------
// Quote region
// ---------------------------------------------------------------------------

export interface QuoteRegion {
  type: 'quoteRegion';
  id?: NodeId;
  attribution?: NonEmptyArray<InlineWithoutBreak>;
  children: NonEmptyArray<QuoteBlock>;
}

/** Helper record, not an AST node. */
export interface QuoteBlock {
  level: number;
  block: QuoteContentBlock;
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

interface ContainerBase {
  /** `type` is the AST discriminator; source TYPE is stored in containerType. */
  type: 'container';
  containerType: string | null;
  title: string | null;
  id?: NodeId;
}

/** Lined form. May contain ordinary blocks plus direct fenced-container children. */
export interface LinedContainer extends ContainerBase {
  form: 'lined';
  children: NonEmptyArray<LinedContainerContentBlock>;
}

/** Fenced form. May not contain another Markanto container. */
export interface FencedContainer extends ContainerBase {
  form: 'fenced';
  /** If a Grid is present, it is the sole child. */
  children: NonEmptyArray<FencedContainerContentBlock>;
}

// ---------------------------------------------------------------------------
// Fenced-container grids
// ---------------------------------------------------------------------------

/**
 * Semantic two-dimensional composition inside a fenced container.
 * Surface separators (`--`, `==`) and continuation markers (`^`, `<`) are not
 * retained in the AST. The formatter reconstructs them from geometry.
 */
export interface Grid {
  type: 'grid';
  /** Rectangular grid width in logical columns. */
  columns: number;
  /** Optional header rows introduced by the surface `::` separator. */
  header?: NonEmptyArray<GridRow>;
  /** Body rows, or all rows when no header is present. */
  rows: NonEmptyArray<GridRow>;
}

/** Helper record, not an independently placeable document block. */
export interface GridRow {
  type: 'gridRow';
  /** Anchor cells that start in this row, ordered by ascending column. */
  cells: GridCell[];
}

/**
 * An anchor cell. `column` is one-based. Missing span fields mean 1.
 * Cell content may contain ordinary container blocks but never a container or Grid.
 */
export interface GridCell {
  type: 'gridCell';
  column: number;
  rowSpan?: number;
  colSpan?: number;
  children: NonEmptyArray<ContainerOrdinaryBlock>;
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export type ListKind = 'unordered' | 'ordered' | 'definition';
export type TaskState = 'open' | 'done';

export interface List {
  type: 'list';
  kind: ListKind;
  /** ordered lists only; absent when canonical start is 1 */
  start?: number;
  id?: NodeId;
  items: NonEmptyArray<ListItem>;
}

export interface ListItem {
  type: 'listItem';
  /** ordered lists only, and only for a visible deviation from expected value */
  value?: number;
  task?: TaskState;
  children: [Paragraph, ...ListItemBlock[]];
}

export type ListItemBlock =
  | Paragraph
  | CodeBlock
  | MathBlock
  | CommentBlock
  | ImageBlock
  | VideoBlock
  | AudioBlock
  | EmbedBlock
  | DownloadBlock
  | Table
  | List
  | QuoteRegion;

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export type CellAlignment = 'default' | 'left' | 'center' | 'right';

export interface Table {
  type: 'table';
  id?: NodeId;
  alignments: NonEmptyArray<CellAlignment>;
  head: TableRow;
  body: TableRow[];
}

export interface TableRow {
  type: 'tableRow';
  /** Cells in source/logical column order; length equals `Table.alignments.length`. */
  cells: TableCell[];
}

export interface TableCell {
  type: 'tableCell';
  /** GFM-near table cells have no span geometry in Markanto 0.1.0. */
  children: InlineWithoutBreak[];
}

// ---------------------------------------------------------------------------
// Footnotes
// ---------------------------------------------------------------------------

export interface FootnoteDefinition {
  type: 'footnoteDefinition';
  identifier: string;
  id?: NodeId;
  children: NonEmptyArray<Exclude<InlineWithoutBreak, FootnoteReference>>;
}

// ---------------------------------------------------------------------------
// Inline AST
// ---------------------------------------------------------------------------

export type Inline =
  | Text
  | SoftBreak
  | HardBreak
  | InlineCode
  | InlineMath
  | Em
  | Strong
  | Deletion
  | Obsolete
  | Insert
  | Mark
  | Sup
  | Sub
  | Link
  | InlineImage
  | Autolink
  | FootnoteReference
  | MetadataSpan;

/** Top-level inline nodes permitted in physical single-line contexts.
 * Nested children are additionally checked by the normative AST validator.
 */
export type InlineWithoutBreak = Exclude<Inline, SoftBreak | HardBreak>;

export interface Text {
  type: 'text';
  value: string;
}

export interface SoftBreak { type: 'softBreak'; }
export interface HardBreak { type: 'hardBreak'; }

export interface InlineCode {
  type: 'inlineCode';
  value: string;
}

export interface InlineMath {
  type: 'inlineMath';
  /** Non-empty, single-line, and must not contain the literal closing sequence `` `$ ``. */
  value: string;
}

export interface Em {
  type: 'em';
  children: NonEmptyArray<Inline>;
}

export interface Strong {
  type: 'strong';
  children: NonEmptyArray<Inline>;
}

export interface Deletion {
  type: 'deletion';
  children: NonEmptyArray<Inline>;
}

export interface Obsolete {
  type: 'obsolete';
  children: NonEmptyArray<Inline>;
}

export interface Insert {
  type: 'insert';
  children: NonEmptyArray<Inline>;
}

export interface Mark {
  type: 'mark';
  children: NonEmptyArray<Inline>;
}

/** Sup/sub contents are atomic, non-empty, whitespace-free plain text.
 * Sup values must not contain `^`; Sub values must not contain `~`.
 */
export interface Sup {
  type: 'sup';
  value: string;
}

export interface Sub {
  type: 'sub';
  value: string;
}

export interface Link {
  type: 'link';
  href: string;
  title?: string;
  children: Inline[];
  /**
   * Present only for inline `<m download>...</m>`. Such a link may additionally
   * carry only download-context attributes (lang + data-*).
   */
  download?: true;
  attrs?: DownloadResourceAttributes;
}

export interface InlineImage {
  type: 'inlineImage';
  src: string;
  /** Parsed Markdown image description; may be empty. Renderer derives plain alt text. */
  alt: Inline[];
  title?: string;
  /** image context: group + data-* only */
  attrs?: ImageResourceAttributes;
}

export interface Autolink {
  type: 'autolink';
  kind: 'url' | 'email';
  value: string;
}

export interface FootnoteReference {
  type: 'footnoteReference';
  identifier: string;
}

/** Kindless inline `<m attrs>...</m>`. At least one attribute is required. */
export interface MetadataSpan {
  type: 'metadataSpan';
  attrs: MetadataSpanAttributes;
  children: NonEmptyArray<Inline>;
}

// ---------------------------------------------------------------------------
// Parser-only intermediate syntax records
// ---------------------------------------------------------------------------

/** `{#id}` is attached to the preceding eligible block and does not survive. */
export interface BlockSuffix {
  type: 'blockSuffix';
  id: NodeId;
}

/**
 * Optional recovery representation. Valid-source semantic consumers should
 * only consume `Document`, never this type. It carries no diagnostics of its
 * own — the single diagnostic list is on the `ParseResult` that returns it
 * (`src/parser-contract.ts`).
 */
export interface RecoveryDocument {
  type: 'recoveryDocument';
  children: Array<DocumentBlock | ErrorBlock>;
  footnotes: FootnoteDefinition[];
}

// ---------------------------------------------------------------------------
// Normative semantic / validation contracts
// ---------------------------------------------------------------------------

/**
 * Semantic equality ignores all parser/tooling source-location and recovery metadata.
 * It includes CommentBlock.value, container form, TYPE/title, explicit IDs,
 * resource metadata, Grid geometry, footnotes, and all other semantic fields above.
 * Resource exhaustion is an operational result, never `false` equality.
 */
export type SemanticEqualityResult =
  | { status: 'ok'; equal: boolean }
  | { status: 'resource'; diagnostics: readonly Diagnostic[] };

export type SemanticDocumentEquals = (
  left: Document,
  right: Document,
  budget?: ResourceBudget,
) => SemanticEqualityResult;

// `ParseResult`, `CanonicalFormatResult`, `ValidationResult`, `ValidateDocument`
// are the operational API surface — see `src/parser-contract.ts`.

export type IdGenerator = () => NodeId;

export interface AdoptResult {
  document: Document;
  addedIds: number;
}

/**
 * ID generation policy is tooling, not language semantics. `createId` must
 * return values that satisfy the block-ID grammar (§5.2) and must eventually
 * yield one not already used in the document; an implementation raises a
 * descriptive error rather than store an invalid or colliding ID.
 */
export type AdoptDocument = (
  doc: Document,
  createId: IdGenerator,
) => AdoptResult;

export type IsIdRequired = (block: Block, scope: IdScope) => boolean;

export type IdScope =
  | { owner: 'document' | 'container' }
  | { owner: 'listItem' | 'quoteRegion' | 'gridCell'; idsAllowed: false };

export const MIN_ORDERED_LIST_NUMBER = 0 as const;
export const MAX_ORDERED_LIST_NUMBER = 999_999_999 as const;

// ---------------------------------------------------------------------------
// Lightweight type guards
// ---------------------------------------------------------------------------

export const isContainer = (node: unknown): node is Container =>
  typeof node === 'object' && node !== null &&
  (node as { type?: unknown }).type === 'container' &&
  ((node as { form?: unknown }).form === 'lined' ||
   (node as { form?: unknown }).form === 'fenced');

export const hasInlineType = (node: unknown): node is Inline => {
  if (typeof node !== 'object' || node === null || !('type' in node)) return false;
  return new Set<string>([
    'text', 'softBreak', 'hardBreak', 'inlineCode', 'inlineMath',
    'em', 'strong', 'deletion', 'obsolete', 'insert', 'mark', 'sup', 'sub',
    'link', 'inlineImage', 'autolink', 'footnoteReference', 'metadataSpan',
  ]).has(String((node as { type: unknown }).type));
};

export const hasDocumentBlockType = (node: unknown): node is DocumentBlock => {
  if (typeof node !== 'object' || node === null || !('type' in node)) return false;
  return new Set<string>([
    'heading', 'paragraph', 'horizontalRule', 'codeBlock', 'mathBlock',
    'commentBlock', 'imageBlock', 'videoBlock', 'audioBlock', 'embedBlock',
    'downloadBlock', 'quoteRegion', 'container', 'list', 'table',
  ]).has(String((node as { type: unknown }).type));
};
