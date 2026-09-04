/**
 * Move source annotations from a virtual-text `SourceAnnotationBuilder` (used
 * when a list item or quote region is parsed from a prefix-stripped slice) onto
 * the real result builder, projecting every offset back into the public source
 * space.
 *
 * The traversal is generic: it visits every object and array value reachable
 * from the node, so it cannot miss an annotatable child the way a hand-kept
 * field list did — `Table.head` / `body`, `TableRow.cells`, `Grid.header` /
 * `rows`, `GridRow.cells`, `GridCell.children`, `QuoteRegion.attribution`, and
 * the typeless `QuoteBlock` (`{ level, block }`) helper are all covered.
 */
import type { AnnotatableNode } from '../parser-contract.js';
import type { SourceAnnotationBuilder } from '../parser-contract.js';

export function transferAnnotations(
  node: object,
  from: SourceAnnotationBuilder,
  to: SourceAnnotationBuilder,
  project: (offset: number) => number,
): void {
  const stack: unknown[] = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      for (const entry of current) stack.push(entry);
      continue;
    }
    const annotation = from.forNode(current);
    if (annotation !== undefined) {
      to.set(current as AnnotatableNode, project(annotation.range.start.offset), project(annotation.range.end.offset));
    }
    for (const value of Object.values(current as Record<string, unknown>)) {
      if (value !== null && typeof value === 'object') stack.push(value);
    }
  }
}
