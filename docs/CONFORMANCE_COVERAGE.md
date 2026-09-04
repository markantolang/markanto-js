# Markanto 0.1.0 conformance coverage

This matrix audits the executable corpus by language family and by six coverage
categories. A cell names representative fixture IDs; many
families have additional cases. “Rich expectation” means at least one
non-trivial case in the family pins a semantic AST and canonical output, while
diagnostic-bearing cases pin category and severity where a diagnostic adds
signal. Invalid cases intentionally have no semantic AST.

| Family | Canonical valid | Tolerated valid | Invalid syntax | Invalid semantics | Boundary / ambiguity | Rich expectation |
|---|---|---|---|---|---|---|
| blocks | `block.heading.h1`, `block.code.backticks` | `block.heading.leading-spaces-normalizes`, `block.hr.stars-normalizes` | `block.code.unclosed-invalid`, `block.heading.setext-rejected` | `block.id.duplicate-invalid` | `block.boundary.heading-without-blank`, `block.heading.setext-standalone-is-text` | `block.code.final-blank-line-preserved`, `block.terminal.empty-document-canonical` |
| containers | `container.fenced.typed`, `container.lined.titled` | `container.fenced.longer-closer-normalizes`, `container.type.nfc-normalizes` | `container.fenced.shorter-closer-invalid`, `container.type.pipe-invalid` | `container.lined.contains-lined-invalid`, `container.fenced.grid.ragged-invalid` | `container.fenced.grid.deferred-caret-first-cell-invalid`, `container.lined.mixed-content-and-fenced-siblings` | `container.fenced.grid.combined-span`, `container.direct-child-id-valid` |
| footnotes | `footnote.basic`, `footnote.repeated-reference` | `footnote.definition-order-normalizes`, `footnote.definition-after-paragraph-moves-end` | `footnote.definition.block-id-after-blank-invalid` | `footnote.missing-definition-invalid`, `footnote.duplicate-definition-invalid` | `footnote.identifier-case-sensitive`, `footnote.in-quote-reference` | `footnote.basic`, `footnote.definition.block-id` |
| inline | `inline.em.star`, `inline.link.linked-image` | `inline.em.wrapper-normalizes`, `inline.autolink.bare-url-normalizes` | `inline.link.nested-direct-link-invalid`, `inline.token.cross-line-invalid` | `inline.metadata.group-invalid` | `inline.strong-em.stack-aware`, `inline.entity.structure-does-not-retroactively-open` | `inline.link.destination-entity-control-stays-literal`, `inline.escape.underscore-run-four` |
| lists | `list.unordered.basic`, `list.ordered.visible-deviation-preserved` | `list.unordered.star-normalizes`, `list.continuation.indent-normalizes` | `list.level-jump-invalid`, `list.task.missing-space-invalid` | `list.container-child-invalid`, `list.contained-paragraph-id-invalid` | `list.definition.kind-switch`, `list.recursive.quote-list-quote-valid` | `list.unordered.basic`, `list.definition.task-shaped-term-is-literal` |
| math | `math.inline`, `math.block` | `math.block.tilde-normalizes` | `math.inline.cross-line-invalid`, `math.block.unclosed-invalid` | `math.block.duplicate-id-invalid` | `math.dollar-literal`, `math.shell-dollar-literal` | `math.inline`, `math.block` |
| quotes | `quote.basic`, `quote.attribution` | `quote.compact-normalizes`, `quote.no-space-normalizes` | `quote.depth-jump-invalid`, `quote.tab-prefix-invalid` | `quote.container-invalid` | `quote.lazy-continuation-not-quote`, `quote.attribution.blank-separated-not-attribution` | `quote.basic` |
| resources | `resource.image.bare`, `resource.video.basic` | `resource.attr.order-normalizes`, `resource.group.nfc-normalizes` | `resource.attr.duplicate-invalid`, `resource.kind.case-invalid` | `resource.image.typed-conflict`, `resource.lang.invalid-bcp47` | `resource.caption.no-hardbreak-not-caption`, `resource.download.inline` | `resource.metadata.lang-canonical`, `resource.image.bare` |
| tables | `table.basic`, `table.alignment` | `table.no-outer-pipes-normalizes`, `table.padding-normalizes` | `table.short-body-row-invalid`, `table.cell-unclosed-emphasis-invalid` | `table.duplicate-id-invalid` | `table.candidate-does-not-override-list-opener`, `table.pipe-inside-metadata-wrapper-not-delimiter` | `table.basic`, `table.span-shaped-markers-literal` |

## Gaps closed during the coverage audit

The coverage audit found three genuine empty cells and added one focused
fixture for each:

- inline semantic invalidity: `inline.metadata.group-invalid`;
- math semantic invalidity: `math.block.duplicate-id-invalid`;
- table semantic invalidity: `table.duplicate-id-invalid`.

All other cells were already represented by the corpus. The
matrix is intentionally evidence-oriented rather than a claim that one example
exhausts a grammar family; the standing law sweep and family runners execute
every fixture.

## Candidate promotion pass

The adversarial candidate pass promoted 180 additional fixtures (20 per
family), taking the executable corpus from 365 to 545 cases; it has grown
further since (run `bun scripts/validate-corpus.mjs` for the current count).
Selection favoured coverage interactions rather than raw volume. Representative
additions are:

- block recognition collisions and adjacency boundaries:
  `block.priority.comment-vs-fence`, `block.boundary.hr-after-paragraph-no-blank`;
- deferred Grid recognition and lined-header collisions:
  `containers.fenced.grid-marker-in-code-literal`,
  `containers.lined.typed-header-collision-list`;
- footnote ordering and cross-construct references:
  `footnotes.order.mixed-referenced-unused`,
  `footnotes.reference.inside-table-cell`;
- inline stack, escape, and atomic-token priority:
  `inline.code.priority-over-em`, `inline.escape.leftmost-effective-pair`,
  `inline.priority.autolink-vs-email`;
- deep list/quote recursion and numbering transitions:
  `lists.depth.five-levels`, `lists.quote.quote-inside-list-inside-quote`,
  `lists.ordered.deviation-resets-sequence`;
- math in structural contexts and dollar collisions:
  `math.block.grid-cell`, `math.inline.adjacent-footnote`,
  `math.dollar.dollar-then-code-span`;
- quote depth transitions and structural children:
  `quotes.paragraph-boundary-by-depth`, `quotes.depth-rise-one-at-a-time`,
  `quotes.inside-grid-cell`;
- caption carriers and attribute-value boundaries:
  `resources.caption.double-emphasis-carrier`,
  `resources.attr.preview-quoted-space`;
- atomic pipes and outer-construct precedence in tables:
  `tables.delimiter.pipe-in-m-wrapper-atomic`, `tables.context.list-table`,
  `tables.delimiter.pipe-in-link-title`.

Every promoted valid source pins its complete Semantic AST and was checked for
normal-to-canonical convergence, strict canonical parsing, semantic round-trip,
validator acceptance, and formatter byte idempotence before being written.
