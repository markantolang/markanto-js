# AGENTS.md — Markanto reference implementation

## Read first

For most implementation tasks, read in this order:

1. `docs/IMPLEMENTATION.md`
2. `docs/INVARIANTS.md`
3. the relevant section of `spec/markanto-spec-v0.1.0.md`
4. `src/ast.ts`

Do not repeatedly ingest the complete specification unless the task spans many
language areas.

For work touching the parser/formatter/validator API or source locations, also
read `docs/PARSER_CONTRACT.md` (operational contract; `src/parser-contract.ts`).

## Hard constraints

- No production/runtime dependencies.
- Development dependencies are allowed when they materially improve typing, testing, static analysis, or reproducibility.
- Never import a development dependency from shipped Core runtime code.
- Adding a production dependency requires an explicit project decision.
- TypeScript must remain straightforward and readable.
- Prefer plain functions, small records, discriminated unions, and explicit state.
- Forward-only scanner: consumed input is never reconsidered by a competing full parser.
- Lookahead must be bounded and explicit. Buffer only what the grammar requires.
- All regexes must be RE2-compatible: no lookbehind, backreferences, recursion,
  conditional groups, atomic groups, or other engine-specific constructs.
- Balanced structures use counters/state machines, never recursive regexes.
- Avoid JavaScript-specific semantics that would make a Rust port structurally different.
- Separate parse recognition, semantic validation, and canonical formatting.
- Invalid input recovery must never silently produce a different valid interpretation.
- Resource/safety limits are implementation policy, not grammar validity.
- Never invent syntax or semantics absent from the specification.

## Architecture

Target pipeline:

`Source -> Scanner -> Block parser -> Inline parser -> Semantic AST -> Validator -> Formatter`

Recovery diagnostics are side data, not valid semantic AST nodes.

## Tests

Every feature should add:

- accepted normal-mode input
- canonical/strict input
- canonical output
- semantic AST expectation where useful
- invalid cases with category + severity
- at least one boundary/ambiguity case

For formatter-supported constructs test:

- parse(format(ast)) == ast
- format(parse(format(parse(source)))) is byte-stable

## Do not invent

- no raw HTML
- no Setext headings
- no indented code blocks
- no reference-style links or link-reference definitions in the parser
  (`[text][label]` / `[label]: url` stay literal text; resolution belongs to
  the spec chapter 16 import tooling in `src/commonmark/` — never Core)
- no semantic parser mode changing the AST of identical source
- no recursive Markanto-container trees
- no inferred media kind from extension
- no automatic block IDs during parsing
- no resolution of `$id` inside Core
- no mutable-registry requirement for `lang`
