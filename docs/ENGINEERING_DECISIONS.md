# Engineering Decisions and Pre-Implementation Risks

These decisions are implementation-facing. They should be settled deliberately
rather than discovered independently by coding agents.

## 1. Complexity contract

Target parser complexity is O(n) in source length, excluding output/AST storage.
No input region may be repeatedly rescanned by competing parsers.

Avoid accidental quadratic behavior from:

- repeated string slicing/concatenation in loops
- repeatedly normalizing the same substring
- searching from the start of an already-scanned region
- renderer/formatter recursion that repeatedly computes child text

Use output chunk arrays/builders and join once.

## 2. Avoid call-stack recursion for source-controlled depth

The language intentionally does not define a small fixed maximum quote/list
depth. Implement source-controlled nesting with explicit stacks/frames rather
than recursive function calls where practical. This applies to parsing,
validation, semantic equality, and formatting.

Implementation safety limits may cap resources, but reaching them is a
`resource` diagnostic, not proof that the source is syntactically invalid.

## 3. Source locations are tooling metadata

See `PORTABILITY.md`. Source ranges are not semantic-AST fields. A parser/editor
API may choose and declare an offset unit independently; Core never depends on it.

## 4. Unicode normalization

Markanto 0.1.0 fixes Unicode **15.1.0** for Core normalization/property
semantics. A host runtime's built-in `String.prototype.normalize` may be used
only when its behavior is verified to be compatible with that fixed language
data for all accepted input scalars; host-version drift must not silently alter
Core output. The reference implementation should isolate normalization behind a
helper so vendored/generated Unicode 15.1 data can replace the runtime path.

Rust's standard library does not provide full Unicode NFC normalization. A Rust
port will need either:

- a narrowly approved Unicode normalization dependency, or
- generated/vendored Unicode normalization data plus a local implementation.

Do not weaken the Markanto NFC language rule merely to preserve a literal
"zero crates" policy. Dependency policy and language semantics are separate.

## 5. HTML named entities

The specification recognizes valid HTML entities in normal inline text. With a
zero-runtime-dependency TypeScript implementation, do not depend on an HTML
parser package. This repository commits the exact 0.1.0 mapping as
`data/html-named-character-references-v0.1.0.json` with hash/provenance metadata.
That committed snapshot is the language data. Implementations may generate a
compact lookup representation from it, but must not query a runtime HTML parser
or network registry for Core conformance.

Use the same generated data as input for a Rust port where possible. Generated
data is preferable to hand-maintained entity lists.

## 6. Regex policy

"RE2-compatible" means the source regex language must stay within the RE2
feature subset. It does not require adding RE2 as a dependency.

Each committed regex should be trivially portable to Rust's `regex` crate or a
small scanner implementation. If portability is doubtful, write scanner code.

## 7. ASCII structural fast path

Most Markanto structure is ASCII. Scanner decisions for markers, fences,
attributes, IDs, and sigils should operate on ASCII code units/bytes where
possible. Decode/iterate Unicode scalar values only where language semantics
require them (running text, TYPE validation/normalization, etc.).

This makes a later byte-oriented Rust scanner natural without changing the
algorithm.

## 8. Numeric parsing

Parse ordered-list numbers incrementally and enforce the 0..999,999,999 bound
while scanning. Do not call a permissive numeric parser and then repair the
result.

## 9. Locale independence

Canonicalization must never depend on process locale. In particular:

- BCP-47 canonical lowercase is ASCII lowercase, not locale-sensitive casing;
- canonical attribute keys and unused footnote identifiers use ascending ASCII
  byte order exactly, not locale collation;
- no `Intl.Collator`/locale-sensitive comparison in Core formatting.

## 10. Public API minimalism

Start with a deliberately small API surface:

```ts
parse(source, options?)
validate(document, options?)
format(document)
semanticEquals(left, right)
```

Do not expose parser internals, scanner states, or unstable source-location
representations as public API prematurely.

## 11. Diagnostics

Category and severity are orthogonal. Exact text is not API. Stable diagnostic
codes should be introduced only when each condition has a clear conformance
case. Do not generate a large speculative code catalog before tests exist.

## 12. Cross-language conformance corpus

Fixtures should be plain UTF-8 JSON/data, not executable TypeScript. The same
corpus should eventually run unchanged against TypeScript and Rust.

This corpus, not implementation-specific internal tests, is the strongest guard
against semantic drift between ports.

## 13. No hidden environment semantics

Parsing/formatting must not depend on:

- locale
- timezone
- filesystem
- network
- environment variables
- current Unicode registry state beyond committed/built-in language data
- renderer configuration

Identical source plus the same Markanto version must yield identical semantic
AST and canonical output.

## Fenced Grid is structural, not merely a richer table

Decision: `Grid` remains a fenced-container-only block-composition model rather
than an extension of the GFM-derived table AST. Grid cells contain ordinary block
content and exclusively own Markanto's `^` / `<` rowspan/colspan metaphor. GFM-near
pipe tables remain inline-only and have no cell-span semantics in 0.1.0.

Surface syntax intentionally uses `:::` / `::`+`==`+`--` / `^`+`<` as a 3:2:1 visual
weight hierarchy. `::` is the optional Grid header/body boundary and itself establishes
Grid mode. Grid markers are context-local to fenced containers, so graceful CommonMark
degradation is not a design constraint for this subgrammar.

Grid recognition uses deferred commitment: the fenced body remains structurally
undecided until `::`, `--`, or `==` occurs (or the closer proves it ordinary content).
This is implemented with uncommitted slices/state, not parser rewind. The semantic
AST stores only rectangular anchor geometry. Separator and continuation markers are
formatter-reconstructable surface syntax.
