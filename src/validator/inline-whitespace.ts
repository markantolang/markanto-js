/**
 * Inline-whitespace domain check (spec §7.7, `docs/INVARIANTS.md`).
 *
 * Normal-mode parsing strips Unicode whitespace from the edges of an inline
 * sequence and from either side of a semantic line break; it never produces a
 * `Text` node whose value begins or ends a sequence with whitespace, nor a
 * whitespace-only `Text` at such an edge. A hand-built / imported / adopted AST
 * can, and `format()` would then have to trim it — losing semantic content.
 *
 * The normative decision (2026-09) is to keep the parser and the valid-AST
 * domain aligned: such an edge-whitespace `Text` is **not** a valid semantic
 * document. Interior whitespace, including a whitespace-only `Text` between two
 * non-`Text` inline nodes on the same logical line (`*a* *b*` →
 * `Em, Text(" "), Em`), stays valid — the parser produces it.
 *
 * Only the **outer** edges of the top-level `Paragraph` / `Heading` /
 * `TableCell` inline sequence, and either side of a `SoftBreak` / `HardBreak`,
 * are constrained: those are the exact positions normal-mode parsing strips.
 * Nested inline sequences are **not** — a `Link` label, `InlineImage.alt`,
 * `Em` / wrapper content, a caption, or a resource label may legally begin or
 * end with whitespace (`[ x](y)` → `Link(Text(" x"))`, a lossless
 * round-trip). `FootnoteDefinition` and `QuoteRegion` attribution keep their
 * post-marker whitespace verbatim (spec §11.7, §3.17), so their top-level
 * sequence is not edge-checked either — only its break-adjacent positions.
 *
 * Returns a list of human-readable messages, empty when the document conforms.
 */
import type {
  Block, Document, DocumentBlock, Inline,
} from '../ast.js';
import { isUnicodeWhitespace } from '../parser/inline/unicode.js';

function leadingWhitespace(value: string): boolean {
  return value.length > 0 && isUnicodeWhitespace(value.charCodeAt(0));
}
function trailingWhitespace(value: string): boolean {
  return value.length > 0 && isUnicodeWhitespace(value.charCodeAt(value.length - 1));
}

/** The inner inline sequence of a wrapper node, or `undefined` for a leaf. */
function innerSequence(node: Inline): readonly Inline[] | undefined {
  switch (node.type) {
    case 'em': case 'strong': case 'deletion': case 'obsolete': case 'insert':
    case 'mark': case 'link': case 'metadataSpan':
      return node.children;
    case 'inlineImage':
      return node.alt;
    default:
      return undefined;
  }
}

function checkSequence(sequence: readonly Inline[], where: string, out: string[], checkOuterEdges = true): void {
  if (sequence.length === 0) return;
  if (checkOuterEdges) {
    const first = sequence[0]!;
    if (first.type === 'text' && leadingWhitespace(first.value)) {
      out.push(`${where}: inline content begins with Unicode whitespace`);
    }
    const last = sequence[sequence.length - 1]!;
    if (last.type === 'text' && trailingWhitespace(last.value)) {
      out.push(`${where}: inline content ends with Unicode whitespace`);
    }
  }
  for (let index = 0; index < sequence.length; index += 1) {
    const node = sequence[index]!;
    if (node.type === 'softBreak' || node.type === 'hardBreak') {
      const before = sequence[index - 1];
      const after = sequence[index + 1];
      if (before?.type === 'text' && trailingWhitespace(before.value)) {
        out.push(`${where}: Unicode whitespace before a line break`);
      }
      if (after?.type === 'text' && leadingWhitespace(after.value)) {
        out.push(`${where}: Unicode whitespace after a line break`);
      }
    }
    // A break may now sit inside `Em` / `Strong` / `Deletion` / `MetadataSpan`
    // / a link label / an image alt (spec §10.7). Its edges are still
    // constrained on either side of that nested break; the nested sequence's
    // own outer edges are not (`[ x](y)` is a lossless round-trip).
    const inner = innerSequence(node);
    if (inner !== undefined) checkSequence(inner, where, out, false);
  }
}

function checkBlock(block: Block, out: string[]): void {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      // Top-level sequence of a Paragraph / Heading: outer edge + break-adjacent.
      checkSequence(block.children, block.type, out);
      break;
    case 'footnoteDefinition':
      // Content keeps its post-`]: ` whitespace; only break-adjacency applies
      // (and it cannot contain a break anyway).
      checkSequence(block.children, block.type, out, false);
      break;
    case 'table':
      for (const cell of block.head.cells) checkSequence(cell.children, 'table cell', out);
      for (const row of block.body) for (const cell of row.cells) checkSequence(cell.children, 'table cell', out);
      break;
    case 'quoteRegion':
      for (const entry of block.children) checkBlock(entry.block, out);
      if (block.attribution) checkSequence(block.attribution, 'quote attribution', out, false);
      break;
    case 'list':
      for (const item of block.items) for (const child of item.children) checkBlock(child, out);
      break;
    case 'container':
      for (const child of block.children) {
        if (child.type === 'grid') {
          for (const gridRow of [...(child.header ?? []), ...child.rows]) {
            for (const gridCell of gridRow.cells) for (const cellBlock of gridCell.children) checkBlock(cellBlock, out);
          }
        } else {
          checkBlock(child as DocumentBlock, out);
        }
      }
      break;
    // imageBlock / videoBlock / … alt, label, and caption sequences are nested
    // inline contexts (like a link label) and may legally carry edge
    // whitespace — not checked (spec §7.7).
    default:
      break;
  }
}

export function checkInlineWhitespace(document: Document): string[] {
  const out: string[] = [];
  for (const block of document.children) checkBlock(block, out);
  for (const definition of document.footnotes) checkBlock(definition, out);
  return out;
}
