# Semantic and Validation Invariants

This checklist is normative companion material for `src/ast.ts` and is intended
to map almost directly to validator code and tests. The TypeScript interfaces
are a structural reference shape; **structural type compatibility alone does
not make an object a valid Markanto semantic AST**.

## Valid semantic AST / formatter domain

A valid semantic AST is a `Document` that satisfies every invariant below.
The canonical formatter accepts only valid semantic ASTs. It must reject an
invalid AST rather than guess, silently discard data, or emit source that
parses to a different AST.

Required closure law:

```text
for every valid semantic AST A:
parseStrict(format(A)) == A
```

The formatter must additionally be byte-idempotent.

## Document

- valid semantic AST contains no `ErrorBlock`
- explicit block IDs are unique document-wide
- every referenced footnote identifier has exactly one definition
- duplicate footnote definitions are semantic errors
- unused footnote definition is valid with advisory/warning
- footnote definitions serialize at document end in specified canonical order
- `Document.footnotes` is already stored in that canonical order: referenced
  definitions in first-reference order, followed by unreferenced definitions
  in ascending ASCII byte order
- unused footnote identifiers sort by ascending ASCII byte order

## Source annotations and operational metadata

- source ranges/offsets are not fields of the normative semantic AST
- parsers/tooling may keep source locations in sidecar metadata or diagnostics
- the offset unit is an implementation/API concern, not a Core semantic choice
- diagnostics and recovery records are ignored by semantic equality
- resource exhaustion is an operational `resource` result, never semantic invalidity

## Literal / atomic values

- every string contains Unicode scalar values only; lone UTF-16 surrogates are invalid
- `Text.value` is non-empty and contains no CR or LF. An entity is decoded only
  if its decoded string has valid scalar values and no C0/C1 control except tab
  (`&NewLine;`, `&#0;`, `&#10;`, surrogates, out-of-range … stay literal, no
  diagnostic — spec §10.8.1).
- `Link.href` / `InlineImage.src` / any `title` string contains no CR, no LF,
  and no other C0/C1 control character except tab (spec §10.5.1). `href` / `src`
  may be the empty string (`[x]()` / `[x](<>)`); a `title` may be the empty
  string (`[x](u "")`), distinct from no title. Backslash escapes and entity/numeric references inside a
  destination or title are resolved (CommonMark 0.31.2 grammar) subject to the
  §10.8.1 filter before the value is stored.
- adjacent `Text` siblings are coalesced into one `Text` node
- literal delimiter-looking `Text` is valid; the formatter escapes any
  flanking `*`, `_`, `~~`, `--`, `++`, or `==` opener needed to keep it literal
- whitespace tolerated immediately before a footnote reference is source trivia
  and is absent from the semantic AST
- `CommentBlock.value` contains no literal `-->`
- `InlineMath.value` is non-empty, contains no LF, and contains no literal
  closing sequence `` `$ ``
- `Sup.value` is non-empty, contains no Unicode whitespace, and contains no `^`
- `Sub.value` is non-empty, contains no Unicode whitespace, and contains no `~`
- `CodeBlock.lang`, when present, is non-empty and whitespace-free; `math` is
  represented by `MathBlock`, not `CodeBlock`; it contains no backtick because
  canonical code fences use backticks
- `InlineCode.value` is non-empty and contains no CR or LF
- inline-code boundary protection is reversible; real leading/trailing ASCII
  spaces remain part of `InlineCode.value`

## Single-line inline contexts

The following owning contexts contain no `SoftBreak` or `HardBreak` **at any
depth** inside nested inline wrappers:

- heading content
- quote attribution
- table-cell content
- footnote-definition content
- block-resource caption content
- block-resource alt/label content (`ImageBlock.alt` and typed-resource
  labels); inline direct-link labels and image alts inherit their owning context

In multiline-capable paragraph content, `Em`, `Strong`, `Deletion`,
`MetadataSpan`, `Link.children`, and `InlineImage.alt` may contain `SoftBreak`
at nested depth but never `HardBreak`. `Obsolete`, `Insert`, `Mark`, `Sup`, and
`Sub` stay single-line (spec §10.3, §10.5.1, §10.7, §10.11).

## Inline edge whitespace (spec §7.7)

- the inline sequence of a `Paragraph`, `Heading`, or `TableCell` does not begin
  or end with a `Text` whose value has leading / trailing Unicode whitespace
- no `Text` immediately before a `SoftBreak` / `HardBreak` ends with Unicode
  whitespace; no `Text` immediately after one begins with it (every context)
- interior whitespace is unconstrained, including a whitespace-only `Text`
  between two non-`Text` inline nodes (`*a* *b*` → `Em, Text(" "), Em`)
- `FootnoteDefinition` and `QuoteRegion` attribution content keep the whitespace
  after their `]: ` / `-- ` marker verbatim — only nested sequences and
  break-adjacent positions are constrained there, not the outer edge
- the formatter never trims a `Text` value to make it serialisable; an
  out-of-domain value is a validation error

## Containers

- `children.length >= 1`
- Markanto containers occur only at document level, except for direct `lined -> fenced` containment
- a lined container may contain any number of direct fenced-container children, freely mixed with ordinary direct blocks
- lined container may not contain lined container
- fenced may not contain any Markanto container
- `containerType`, when present, is non-empty, NFC-normalized according to Unicode 15.1.0, and satisfies the TYPE character grammar
- `title`, when present, is non-empty, single-line, and requires non-null `containerType`
- containment never depends on TYPE spelling
- lined-opener blank-line spacing and fence run length are surface-only and are not stored in the AST
- Grid is permitted only as the sole child of a fenced container
- Grid has at least one body row and a positive integer `columns` width
- a headerless Grid must have `columns > 1` or more than one body row; headerless 1x1 is not a valid semantic Grid
- `header`, when present, is non-empty; header and body are independent span geometries and rowspan never crosses their boundary
- Grid cells are anchor cells; `column` is one-based and strictly increasing within each row
- explicit `rowSpan` / `colSpan` values are integers >= 2; omitted means 1
- anchor rectangles do not overlap, exceed Grid bounds, or leave uncovered logical slots
- Grid-cell content is non-empty ordinary fenced-container content; containers and nested Grids are forbidden
- blocks contained in Grid cells carry no independent block IDs
- `::`, `==`, `--`, `^`, and `<` are surface-only Grid syntax and are not stored as AST nodes

## Quotes

- `QuoteRegion.children` is non-empty
- the first `QuoteBlock` has `level == 1`
- depth may stay equal or decrease by any amount; it rises by at most one at a time
- every `QuoteBlock.level >= 1`
- quote content contains no Markanto container
- the `QuoteRegion` itself may carry an ID when its placement is ID-eligible
- all contained quote blocks, including nested lists/quotes/tables/resources, carry no independent block IDs

## Lists

- list has at least one item
- each item begins with a non-empty paragraph
- ordered marker/value range is `0..999,999,999`
- `List.start` is ordered-list-only; it is absent for start 1 and must not store explicit `1`
- the first ordered item never stores `ListItem.value`; its visible number is represented by `List.start` or implicit 1
- for later ordered items, `value` is present iff the visible marker differs from the expected previous-value-plus-one sequence; the sequence continues from any explicit deviation
- unordered and definition lists never store `start` or item `value`
- task state is `open` or `done` and is permitted only on ordered/unordered items, never definition items
- blocks contained in any list item carry no independent block IDs, including nested lists/quotes/tables
- list/quote recursion has no language-level numeric depth cap; resource limits are implementation policy
- validators/formatters/parsers must use safe explicit traversal state or report `resource`; call-stack overflow is not a validity result
- normal-mode indentation aliases are exactly those delegated to the fixed
  CommonMark 0.31.2 list-item ownership rule by the specification; implementations
  may not invent extra tolerant aliases

## Inline structure

- `Em`, `Strong`, `Deletion`, `Obsolete`, insert, and mark children are non-empty
- in multiline-capable block content, `Em`, `Strong` (incl. `<i>`/`<b>`),
  `Deletion`, `MetadataSpan`, a link label, and an image alt may contain a
  `SoftBreak` at any depth but never a `HardBreak`; `Obsolete`, `Insert`,
  `Mark`, `Sup`, and `Sub` contain neither and stay line-local (spec §10.7)
- a `SoftBreak` inside any of those spans still has no Unicode whitespace on
  either side of it (spec §7.7) — the constraint recurses into nested spans,
  though a nested sequence's own outer edge may carry whitespace (`[ x](y)`)
- a valid `Paragraph` never consists solely of one `InlineImage` or one
  `Link` with `download: true` (or the `<m>` wrapper form of either) — that is a
  block resource and must use `ImageBlock` / `DownloadBlock` (spec §4.4)
- in `Paragraph.children`, a `SoftBreak` or `HardBreak` is never the first or
  last element and never immediately adjacent to another `SoftBreak`/`HardBreak`
  (spec §10.7). A terminal trailing backslash is a literal backslash, not a
  `HardBreak`.
- a wrapper may not directly contain another wrapper of the same semantic kind
- a `Link` label and an image alt contain no nested `Link`, no `Autolink`, and
  no `FootnoteReference` at any depth (each would produce a nested anchor); a
  nested `InlineImage` is permitted
- a `Link` label is non-empty (`Link.children.length >= 1`); an empty label is
  a syntax error, not a valid AST. An empty image alt (`InlineImage.alt == []`)
  is valid
- footnote definition content contains no nested footnote reference at any depth
- metadata span has at least one permitted attribute
- in normal mode an unmatched baseline or Markanto paired-delimiter frame is
  literal `Text`; strict mode accepts only its escaped canonical surface
- a `Deletion` / `Obsolete` / `Insert` / `Mark` immediately adjacent to a `Text`
  whose facing character is a word character (letter, digit, `_`) has no
  canonical surface: the `--` / `++` / `==` / `~~` opener and closer are only
  recognised next to whitespace or non-word punctuation (GFM-style flanking).
  The `Obsolete` opener additionally has none when the preceding `Text` ends in
  `-` (the `---` three-run rule). The parser never emits these adjacencies and
  `validate` / `format` reject them. `Em` / `Strong` in the same position fall
  back to the `<i>` / `<b>` wrapper form instead.

## Resources

- image attrs: group + lang + data-* only (for block and inline images)
- video/audio/embed attrs: group + lang + preview + data-* only
- download attrs: lang + data-* only
- generic metadata attrs: lang + data-* only
- group is NFC-normalized according to Unicode 15.1.0
- group is non-empty; the generic quoted-attribute ability to spell `""` does
  not make an empty group semantically valid
- lang is lowercase canonical and syntactically well-formed BCP 47
- data-* keys are lowercase ASCII and match `[a-z][a-z0-9_-]*`; case variants
  are invalid, not aliases (migration tooling diagnoses them without lowercasing)
- when `attrs` is present it contains at least one actual attribute; an empty
  attribute object is invalid/canonicalized as absence before semantic AST storage
- when `dataAttrs` is present it contains at least one key; an empty map is absent
- typed wrapper contains exactly one primary Markdown link
- caption exists only on block resources
- caption contains no soft/hard breaks or block content

## Tables

- `alignments` is non-empty
- `alignments.length` defines the logical table width
- `head.cells.length == alignments.length`
- every body row has exactly `alignments.length` cells
- `TableCell` is positional and stores no `column`, `rowSpan`, or `colSpan` geometry
- table cells contain single-line inline content only
- exact-cell `^` and `<` have no table-span semantics; they are ordinary inline/literal cell input
- escaped `\|` and pipes inside complete atomic inline tokens are not column delimiters

## Links

- direct links only; no link-reference definitions
- a link/image commits at `](` and its destination / optional title stay on
  one physical line; the label / alt may cross a `SoftBreak` in
  multiline-capable block content (never a `HardBreak`). The anchor-producing
  nodes forbidden in a label / alt are `Link`, `Autolink`, and
  `FootnoteReference`
- `#id` is retained literally and denotes a concrete document anchor
- `$id` is retained literally and remains unresolved by Core
- unresolved `#id` is not a syntax error
- nested links are invalid semantic AST
- URL autolinks match the common canonical URL domain
  `https?://` followed by one or more non-whitespace characters other than
  `<` and `>`; email autolinks match the bracketed email domain from section 13.2

## Canonicalization

- every valid semantic AST has a representable canonical surface; headerless 1x1 Grid is excluded for this reason
- strict output parses to same semantic AST
- formatter is byte-idempotent
- tolerated forms converge on canonical form
- when one escape neutralizes a multi-character structural marker, the canonical escape is the leftmost effective character
- source-semantic choices such as container form are preserved
- canonical attribute keys and unused footnotes use locale-independent ASCII order
- strict byte input rejects BOM and CRLF as noncanonical; normal mode may normalize them
