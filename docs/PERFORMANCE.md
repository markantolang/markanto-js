# Performance Contract

Performance is a design constraint, not a license to obscure the code.

## Parser

- target O(n) time
- monotonic cursor
- bounded lookahead for grammar disambiguation
- explicit stack for source-controlled nesting
- no whole-document regex parser
- no recursive regex behavior
- no speculative full-branch parsing

## Memory

- AST/output storage may naturally be O(n)
- line buffering should remain small and explicit
- avoid copying entire source substrings merely to classify them
- preserve ranges/slices where useful, materialize strings when the semantic AST
  requires ownership

## Formatter

- append to chunks/builder and join once
- avoid repeated concatenation of growing strings
- iterative traversal for source-controlled depth where practical

## Validation

- one or a small fixed number of AST passes
- use maps/sets for document-wide identity checks
- no renderer-dependent validation

## Benchmarks

Do not optimize before correctness. Once the conformance corpus is stable, add
benchmarks for:

- large running-text document
- many short blocks
- deeply nested lists/quotes up to configured resource policy
- large tables
- delimiter-heavy adversarial inline text
- long balanced link destinations

`scripts/bench.mjs` (`bun run bench` / `bench:bun`) compares `parse` against
`marked.lexer` under Node and Bun — a stable external reference point. The 0.1.0
freeze numbers are recorded in `docs/benchmarks/0.1.0-baseline.md`; a per-release
regression is a scenario whose MB/s falls against `marked` on the same runtime.
`bun run soak` (audit #6) is the volume gate: 100 000 seeded documents per
stream through the four §7.2 laws, plus a coarse parser-linearity probe (per-byte
`parse` cost must stay within 3x over a 16x input-size increase). A heavier
gate, run before a release, not part of `verify`.

Benchmark inputs must also be valid conformance inputs or explicitly labeled
resource/adversarial fixtures.
