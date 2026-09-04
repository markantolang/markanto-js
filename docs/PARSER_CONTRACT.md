# Parser / formatter / validator contract

Operational API surface. **Not language semantics** — nothing here is read by
`semanticDocumentEquals`, affects canonical output, or is part of spec
conformance. Types live in `src/parser-contract.ts`.

The semantic AST (`src/ast.ts`) carries no source locations by design
(`docs/PORTABILITY.md`, "Source-location policy"). Consumers that need
source-addressable blocks get them from the **source-annotation sidecar**
returned with the document.

## Coordinate space

Every offset, line, and column the sidecar reports is in **one** space:

> the raw input with a leading BOM removed and CRLF / lone CR preserved.

The parser works internally on normalised text (BOM stripped, CRLF/CR → LF) and
**projects offsets back** into that space before recording an annotation
(`Source.toSourceOffset`, `rawOffsetProjector`). So a consumer's editor
positions line up with the source the user actually edits, and a document that
uses CRLF is not silently shifted.

- `ParseResult.offsetUnit` declares the unit **once per result**, on every
  variant — it applies to any `Diagnostic.range` and, where present, to the
  sidecar (`SourceAnnotations.offsetUnit`, always equal). `utf16-code-unit` for
  the TypeScript reference implementation; a Rust port may declare `utf8-byte`.
  Never repeated on an individual point, never mixed within a result.
- A leading BOM is excluded from the space. A consumer that keeps the BOM in
  its own buffer must compensate: **every** absolute `offset` needs `+1`, a
  line-1 UTF-16 `column` needs `+1`, and `source.slice(range…)` needs the same
  `+1` base shift. `hadBom` is on `TransportReport` but not on `ParseResult`;
  a consumer detects a BOM in its own input.
- The formatter and pure-AST validator have no source, so their diagnostics
  carry no `range` and their results have no `offsetUnit`.

## Range type

`NodeAnnotation.range` is `AnnotatedRange` — a half-open span of `AnnotatedPoint`
(`src/source/position.ts` `Span` / `Point`). **Every field is mandatory**:

```ts
interface AnnotatedPoint { readonly line: number; readonly column: number; readonly offset: number }
interface AnnotatedRange { readonly start: AnnotatedPoint; readonly end: AnnotatedPoint }
```

`line`/`column` are 1-based; `column` counts Unicode scalar values. There is no
per-point `offsetUnit` (it is on `SourceAnnotations`), so start and end can
never disagree on the unit.

### Range boundary rule

`range` is **half-open `[start, end)`**. A node's range covers:

- **all of the node's own syntactic carriers**: fence opener and closer, the
  `#` run and any closing `#` run, `<m>`/`<i>`/`<b>` wrapper tags, a table's
  separator row and outer pipes, Grid surface markers (`::`/`--`/`==`/`^`/`<`),
  the `>` prefix on each of a quote's own lines;
- **the node's own postfixes**: the block-ID suffix `{#id}` attached to it, a
  quote attribution line, a resource caption carrier line.

It does **not** cover:

- the blank line(s) that separate it from a sibling;
- the **physical line terminator** after the node's last own token — LF, CRLF,
  **or** lone CR. `end` is at that last own non-terminator character + 1
  (so for a CRLF-terminated line both raw code units are excluded). A final
  block with no terminating newline ends at end-of-input.

Helper-record boundaries beyond this general rule (does a table's separator row
belong to `TableRow` head or only to `Table`? do a `ListItem`'s interior blank
lines belong to the item? how does one `QuoteBlock` span cover its repeated
`>` prefixes? which Grid marker rows belong to which `GridRow`?) are settled
per construct in the phase that implements it, not here.

Whole-document and container spans:

- `Document.range` and `RecoveryDocument.range` = `[0, sourceLength)` — the
  entire coordinate space, including any trailing newline(s). (The excluded
  BOM is already outside the space.)
- A container's range runs from its opener to its closer inclusive. Blank lines
  *between* its children are interior to the container range but belong to no
  child.

## Which nodes are annotated

`AnnotatableNode`: `Document`, `RecoveryDocument`, every block
(`DocumentBlock` and every nested block, including `Grid`), `ListItem`,
`TableRow`, `TableCell`, `FootnoteDefinition`, every `Inline` node, the helper
records `QuoteBlock` / `GridRow` / `GridCell`, and `ErrorBlock` in a recovery
tree.

A required node without an annotation is an implementation bug, not a valid
state — but consumers must still handle `undefined` defensively and fall back
to the nearest annotated ancestor (which bottoms out at `Document` /
`RecoveryDocument`, always annotated).

`ListItem`, `TableRow`, `TableCell`, `GridRow`, `GridCell` are annotated for
precise diagnostics, future structured editor operations, and range fallbacks —
**not** because the current Hadley `editorBlocks()` treats them as editor
blocks (it does not; it uses top-level blocks plus footnotes).

## Nodes whose source and semantic form are not one-to-one

`range` is the node's source extent per the boundary rule. It is **not**
required to reproduce the node byte-for-byte. Important cases (**not an
exhaustive list** — any lossy surface→AST step behaves this way):

| Case | Rule |
|---|---|
| coalesced `Text` | span from the first source run's start to the last run's end; if the runs were separated by removed source, the span covers the gap and `source.slice(range) !== Text.value` |
| discarded pre-`[^id]` whitespace | the `FootnoteReference` range starts at `[`; the tolerated whitespace is owned by no node |
| reordered `Document.footnotes` | each entry's annotation points at its own definition's source position, so ranges need not increase with array index |
| normal-mode aliases (`* * *`→`---`, `~~~`→```` ``` ````, `## h ##`→`# h`) | `range` covers the accepted source, not the canonical form |
| carriers (fences, markers, `{#id}`, caption/attribution lines) | inside the owning node's range (boundary rule), not the node's semantic content |
| trivia (separating blank lines, terminating LF) | outside every node's range |
| transport (BOM, CRLF, lone CR) | already resolved by the coordinate-space projection — annotations are always in raw space |
| entity / escape decoding, inline delimiters, Grid geometry reconstruction | `range` is the source extent; the decoded/normalised value differs |

## Tagged results

Discriminated on `status`; never thrown for expected failures.

### `ParseResult`

Every variant carries `offsetUnit: OffsetUnit` and `diagnostics: readonly
Diagnostic[]`.

| `status` | extra payload | meaning |
|---|---|---|
| `ok` | `document: Document`, `annotations: SourceAnnotations` | a fully valid semantic document. `diagnostics` may carry `warning`-severity advisories; never an `error`. |
| `invalid` (recovered) | `recovery: RecoveryDocument`, `annotations` | no valid semantic document; `ParserOptions.errorRecovery` was set. `recovery` may contain `ErrorBlock`s; `annotations` annotates the recovery tree. |
| `invalid` (bare) | — | no valid semantic document; recovery was not requested. |
| `resource` | — | a declared budget was exhausted before a verdict. No tree, not a validity judgement. |

`document` / `recovery` / `annotations` are each pinned to `never` on the
variants that must not carry them, so an over-shaped object (`resource` with a
`document`, `ok` with a `recovery`, …) is not assignable to `ParseResult` even
from a pre-bound variable. The type still cannot couple `recovery`'s *presence*
to the `errorRecovery` *option value*.

A valid `Document` is returned **only** on `ok`. `ErrorBlock` appears **only**
inside a `RecoveryDocument` and carries no `range` of its own — it is annotated
by the recovery result's sidecar.

### `CanonicalFormatResult`, `ValidationResult`

`ok` / `invalid` / `resource`, `diagnostics: readonly Diagnostic[]` throughout.
The formatter's `ok` adds `source: string`. Neither carries annotations or
`offsetUnit`: they operate on a semantic AST, which has no source, so their
diagnostics point at an AST node/path, never a source span, and carry no
`Diagnostic.range`.

`format(document, budget?)` accepts an optional `ResourceBudget`. Its
`maxFrames` limits structural block nesting; exhaustion returns `resource`
rather than throwing. `validate()` forwards its own budget to this formatter
gate.

`maxMatrixSlots` bounds a Grid's transient occupancy matrix
(`columns × (header + body rows)`). A compact AST can name a huge matrix
through a large `columns` / `colSpan` with no matching source size, so `parse`,
`validate`, and `format` all apply a default of **100 000** slots when the
caller passes no `maxMatrixSlots` — well above any hand-authored Grid. An
explicit budget raises or lowers that default.

A second, **non-negotiable** bound sits above it: `HARD_MAX_MATRIX_SLOTS`
(**1 000 000**, in `src/ast.ts`). No `maxMatrixSlots` can lift it — a matrix
past this ceiling, or one whose slot count is not a usable finite number, is
`resource` before any array is allocated, whatever the caller passes. An
unusable `maxMatrixSlots` value (NaN, Infinity, negative, non-number) is
ignored and the default applies; it never disables the gate.

### Diagnostics

`{ category, severity }` is the machine contract (`docs/IMPLEMENTATION.md` §12).
`category` ∈ `syntax | semantic | resource | noncanonical | advisory`;
`severity` ∈ `error | warning`. `resource` is a category, not a severity. There
is exactly **one** diagnostic list per operation — the one on the result.
`RecoveryDocument` carries none of its own.

`Diagnostic.range`, when present, is a `Span` (mandatory `line`/`column`/
`offset`) in the `ParseResult.offsetUnit` coordinate space — the same public
raw space as the sidecar. `Diagnostic` lives in `src/diagnostics.ts`, not
`src/ast.ts`.

## The sidecar: read-only view vs. builder

- **`SourceAnnotations`** (interface) is the stable consumer contract:
  `offsetUnit`, `forNode(node)`, `has(node)`. Read-only.
- **`SourceAnnotationBuilder`** (class) is parser-internal. It is currently
  exported (a future parser module in another file needs it) but is **not**
  part of the package's supported API and will be internalised at package
  freeze. Build it with `createSourceAnnotationBuilder(source)` — the factory
  takes one `Source`, so map, projector and length can never be mismatched.
  `set(node, normStart, normEnd)` takes normalised parser offsets, validates
  them (integer, in `[0, normalizedLength]`, `start ≤ end` — a bad offset
  throws, it is never silently clamped) and projects them. `seal()` returns a
  frozen `SourceAnnotations` view (`Object.freeze`d, so even `offsetUnit` is
  runtime-immutable) and makes further `set` throw; every stored
  `NodeAnnotation` and its points are already frozen.

`ParseResult.offsetUnit` and `SourceAnnotations.offsetUnit` are always equal
(the parser derives both from one `Source`); the type does not prove it, so
code that constructs a `ParseResult` by hand must keep them in sync.

### Association mechanism is not the contract

The contract is behavioural: *for every traversable object of this result's
`document` / `recovery`, its annotation is deterministically retrievable.* The
TypeScript reference implementation uses a `WeakMap` keyed by object identity.
A Rust port has no cheap identity map and owns the tree, so it builds a parallel
annotation structure during the AST-building traversal (an arena-index table,
or a shape-parallel tree). A port satisfies the contract by making annotations
retrievable per result object — it need not expose a `forNode(node)` method
with this exact signature, and its retrieval API may depend on ownership /
arena ids / borrowing.

### Semantic-equality guarantee

`SourceAnnotations` is never consulted by `semanticDocumentEquals`. Two results
with structurally equal documents and different (or absent) annotations are
semantically equal. Enforced by `test/unit/parser-contract.test.ts` and
`test/unit/semantic-equality.test.ts`.

## Options

`ParserOptions { strict?, errorRecovery?, resourceBudget? }` —
`errorRecovery` only affects invalid input.
`ValidationOptions { identity?, canonical?, resourceBudget? }`.

Annotations are always built (the `WeakMap` cost is negligible); there is no
opt-out flag in the contract.

### `identity` and the durable-identity tooling profile

`§5`/`§6` say only that an explicit block ID, when present, is durable, unique,
and grammar-conforming, and that tooling *may* generate or adopt IDs. The
`identity` option is a **tooling policy on top of Core**, not a Core validity
rule:

- `identity` absent / `'optional'` — the default. A block with no `id` is valid.
- `identity: 'required'` — the *durable-identity profile*: every ID-eligible
  position must carry an explicit `id`. ID-eligible = a document-level block, a
  direct child of a lined/fenced container (recursing through `lined -> fenced`
  nesting), or a footnote definition; **not** `commentBlock` (no identity slot),
  and never a block inside a list item, quote region, or Grid cell. This is
  exactly the set `adoptDocument(doc, createId)` fills, so
  `validate(adoptDocument(doc, id).document, { identity: 'required' })` is
  always `ok` for a shape-valid `doc`.

`canonical` is **reserved and currently ignored** — a source-free semantic AST
has nothing to check surface canonicality against. Use the source-level
`checkCanonical(source)` API instead.

### Canonicality

`checkCanonical(source)` parses in normal mode and returns one of four tagged
results: `canonical`, `noncanonical`, `invalid`, or `resource`. A
`noncanonical` result includes the exact canonical target in `canonical` and
specific diagnostics for transport differences (BOM, CRLF, and terminal-LF
count); other surface differences use a general diagnostic and are exposed by
diffing the target. Invalid syntax or semantics remain `invalid` rather than
being relabelled as noncanonical. A lone CR is invalid transport in both modes.

Strict parsing uses the same canonicality comparison and diagnostics, but keeps
the established `ParseResult` contract: noncanonical input is returned in the
bare `status: 'invalid'` envelope with `category: 'noncanonical'` diagnostics.

### Resource budgets in the validator

`validate()` honours `resourceBudget` (`maxNodes`, `maxFrames` = maximum AST
nesting depth). Every validator traversal — the closed shape check, the
block-ID / footnote / anchor relation walks — uses an explicit work stack and
reports `resource` on a budget overrun; a source-controlled AST depth never
produces a host stack overflow (spec §7.5). The canonical formatter is invoked
as the representability gate only after the shape check has bounded the depth.
Defaults: `maxNodes` 100 000, `maxFrames` 5 000, `maxMatrixSlots` 100 000.

## Consumer obligations (Hadley and others)

See `docs/MIGRATION.md` for the full adapter obligations: source ordering and
editor blocks come from the sidecar, not `node.range`; footnote definitions are
canonically ordered so a `document.children` walk must be merged with
`document.footnotes` and sorted by annotated start offset; `parse()` returns a
`ParseResult`, not a bare `Document`; obsolete semantic fields (`heading.slug`,
`Span`, `Strike`, old wrappers, `lineBreaks`) are gone; destination-URL safety
is the host's responsibility and needs a renderer-side allowlist.
