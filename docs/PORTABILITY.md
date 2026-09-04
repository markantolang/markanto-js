# TypeScript -> Rust Portability Rules

The TypeScript implementation is the first reference implementation, not a
JavaScript-specific definition of the language.

## Preferred common denominator

Use concepts with direct Rust equivalents:

- discriminated/tagged unions
- readonly-style records / structs
- explicit enums represented by string unions in TypeScript
- integer counters
- slices/ranges rather than regex captures where practical
- explicit parser state structs
- `Result`-like return values
- pure functions for validation/canonical formatting where practical

Avoid dynamic prototype tricks, monkey patching, implicit coercion, sparse
arrays, regex replacement callbacks as parsers, and exception-driven ordinary
control flow.

## Unicode

The language reasons about Unicode scalar values in places such as TYPE and
normalization. JavaScript strings are UTF-16 internally; Rust strings are UTF-8.
Do not scatter native string-index assumptions through parser logic.

Create a small source/text abstraction responsible for:

- advancing by Unicode scalar value when grammar semantics require it
- ASCII fast paths for structural syntax
- mapping logical positions to source offsets

### Source-location policy

Source locations are not part of the portable semantic AST. Parsers and tools may
expose ranges as sidecar/diagnostic metadata, and may use UTF-8 byte offsets,
UTF-16 code-unit offsets, or another explicitly documented indexing convention.
That API choice must not affect parsing, semantic equality, or canonical output.

`src/ast.ts` therefore does not attach source ranges to semantic nodes and does
not fix one offset unit for Core. Tooling metadata that includes an offset declares
its unit explicitly.

The concrete sidecar is `SourceAnnotations` in `src/parser-contract.ts`
(`docs/PARSER_CONTRACT.md`): `offsetUnit` declared once per result; all offsets
in the raw (BOM-removed, CRLF-preserved) coordinate space. The TS reference impl
backs it with a `WeakMap` keyed by object identity. A Rust port has no cheap
identity map and instead builds a parallel annotation structure during the same
traversal that builds the AST — an arena-index table, or a shape-parallel tree.
The portable contract is *behavioural*: for every traversable result object, its
annotation is deterministically retrievable. A port need not offer a
`forNode(node)` method with this signature; its retrieval API may depend on
ownership, arena ids, or borrowing.

## Normalization

NFC normalization and BCP-47 lowercase canonicalization are language rules.
Markanto 0.1.0 fixes Unicode 15.1.0 for Unicode-dependent Core behavior.
Implement normalization/property checks behind explicit helpers so TypeScript
and Rust consume behavior compatible with the same fixed data. A built-in
normalizer is an optimization only when compatibility with the fixed baseline
is verified; it is not itself the normative data source.

## Regex

Every regex committed to the TypeScript implementation must be documented as
RE2-compatible. Prefer scanner functions for anything non-flat.

## Numeric ranges

Use explicit safe integer bounds from the spec. Do not rely on JavaScript's
number coercion. Parse decimal values incrementally and reject/diagnose overflow
before arithmetic can lose precision.

## Error model

Do not use thrown exceptions for expected syntax failures. Return tagged results
or diagnostics. Reserve exceptions for programmer bugs / impossible states.


## Fenced Grid exception

The Core portability preference for graceful Markdown degradation does not govern
Grid marker syntax (`::`, `==`, `--`, `^`, `<`) inside `:::` containers. Fenced containers already opt into an
explicit Markanto-specific fenced form; `::`, `==`, `--`, `^`, and `<` may therefore be
optimised for compact visual structure rather than standalone CommonMark meaning. “Loud” is
a design-rationale description only, not a grammar term.
