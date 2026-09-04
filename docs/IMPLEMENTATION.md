# Markanto 0.1.0 — Implementation Contract

This is a compact engineering companion to the normative specification. The
specification remains authoritative.

## 1. Core model

Markanto accepts explicitly documented tolerant input in normal mode, projects
it to one semantic AST, validates that AST/context, and serializes canonical
source. Strict mode accepts canonical source only; it must not change meaning.

Required laws:

1. semantic round-trip: `parse(format(ast))` reproduces the same semantic AST;
2. formatter idempotence: canonical output is byte-stable;
3. normal-form convergence: tolerated surfaces for the same AST converge;
4. canonical output is valid strict input.

## 2. Baselines

- CommonMark 0.31.2 for retained CommonMark grammar.
- Unicode 15.1.0 for Unicode-dependent Core normalization/property behavior.
- GFM 0.29-gfm only for explicitly retained extensions such as task-list
  markers and pipe tables.
- Markanto recognition/validation/semantics/canonicalization wins on conflict.
- Block and inline inventories are closed.

## 3. Block recognition

After outer structural context has been resolved, use this priority:

1. active closer for current literal/fenced context
2. blank line
3. legal context-dependent postfix for the completed construct (attribution,
   caption, or ID)
4. confirmed lined container (`___` or typed header + one-line lookahead)
5. fenced container (`:::`)
6. code/math fence or HTML-comment construct
7. ATX heading
8. thematic break
9. quote/list/footnote structural openers
10. confirmed table (only when step 9 did not claim the line)
11. standalone block resource
12. paragraph

Recognition operates on logical lines after structural indentation and quote
prefixes are removed. Tables and typed lined container headers require at most one
logical line of buffered lookahead.

## 4. Containers

Two semantic forms share `type: 'container'`:

- `form: 'lined'`
- `form: 'fenced'`

`quiet` / `loud` are design-rationale vocabulary only, not grammar labels.

Both must contain at least one child. The blank line immediately after a
lined opener is surface-only: normal mode accepts zero or multiple blank lines,
while canonical output and strict input use exactly one. No AST field stores
this spacing.

Containment:

- Lined -> Fenced: allowed in any number, direct children only
- Lined -> Lined: forbidden
- Fenced -> Lined: forbidden
- Fenced -> Fenced: forbidden

Multiple fenced siblings inside one lined container are allowed. TYPE never changes
containment.

TYPE:

- Unicode, case-sensitive
- normalize to NFC before AST storage/comparison
- first non-empty whitespace-free token
- exclude Unicode whitespace, controls, `< > [ ] { } | \\ \``

TITLE is a non-empty literal remainder after TYPE + one ASCII space and cannot
exist without TYPE. No title-specific escaping or quoting.

## 5. Quotes

Every physical quote line carries its full prefix. No lazy continuation.
Canonical prefix uses `> ` per non-empty level; empty quote lines omit the final
trailing space. Depth may increase by at most one.

Normative semantic representation is a `QuoteRegion` containing flat
`QuoteBlock { level, block }` records with absolute levels. Renderer derives a
nested presentation tree.

Containers are not allowed inside quotes.

## 6. Lists

- unordered canonical marker: `- `
- ordered canonical marker: decimal + `. `
- ordered values: 0..999,999,999
- normal indentation aliases are exactly those the fixed CommonMark 0.31.2
  list-item ownership rule assigns to the same item/one-level child; no
  implementation-specific tolerant aliases
- definition-list canonical marker: `: `
- canonical indentation: two ASCII spaces per level
- task markers: `[ ]`, `[x]`; `[X]` tolerated only in normal mode
- list level may rise by at most one
- no tight/loose semantic distinction

Lists and quote regions use their ordinary recursive grammars at every permitted
level. The language defines no small fixed list, quote, or mixed-nesting depth.
Implementations must bound source-controlled complexity with resource limits and
should prefer explicit stacks/frames to call-stack recursion. Exhausting such a
limit is a resource diagnostic, not a syntax error.

## 7. Resources and MIB

Reserved wrappers are exactly `<m>`, `<i>`, `<b>`.

`<i>` maps to `Em`, `<b>` maps to `Strong`; formatter prefers ordinary Markdown
star delimiters whenever safe.

`<m>`:

- kindless inline metadata span requires at least one attribute;
- image identity comes from native `![...](...)`;
- `video`, `audio`, `embed` are block-only and contain exactly one Markdown link;
- `download` may be inline or block;
- typed-content mismatches are errors;
- block captions use mandatory trailing hard break + one full emphasis carrier line.

Attribute matrix:

- metadata span: `lang`, `data-*`
- image: `group`, `lang`, `data-*`
- video/audio/embed: `group`, `lang`, `preview`, `data-*`
- download: `lang`, `data-*`

`group` is NFC-normalized. `lang` is syntactically well-formed BCP 47 and stored
lowercase canonically; no mutable registry controls Core validity.

## 8. Links

Reference-style links and link-reference definitions do not exist.

Direct links remain standard:

`[text](destination "optional title")`

Internal forms explicitly retained:

- `#identifier` — concrete document anchor; `{#identifier}` defines the durable
  block anchor and `[text](#identifier)` refers to it.
- `$identifier` — symbolic tooling target, preserved literally in `Link.href`;
  Core does not resolve it.

Identifiers use `[A-Za-z0-9_-]+`.

An unresolved `#identifier` can produce a warning; it is not a syntax error.

## 9. Inline scanner

Use deterministic longest/specific recognition. Priority classes:

1. escapes and code spans
2. complete Markdown links/images and autolinks
3. MIB wrappers
4. footnote references and structured bracketed forms
5. multi-character inline delimiters
6. single-character emphasis/sup/sub delimiters
7. text

Inline delimiter state (an open `*`/`_`/`**`/`__`/`~~` run, an open `<m>`/`<i>`/
`<b>`, an open backtick run) may carry forward across a `SoftBreak` of the same
open block — the scanner keeps its stack, it does not backtrack (spec §10.7).
It never crosses a `HardBreak`, a blank line, a block boundary, or into a
single-line owning context (heading, table cell, caption, attribution).
`Obsolete`/`Insert`/`Mark` (`--`/`++`/`==`) and `Sup`/`Sub` stay strictly
line-local. Inline code collapses each crossed line ending to one space.

Balanced link destinations use counters/state, not backtracking regexes.

At its permitted boundary, an unmatched `*`, `_`, `~~`, `--`, `++`, or `==`
delimiter frame is resolved left-to-right into literal `Text` in normal mode.
Canonical formatting escapes the effective opener, so the original unescaped
surface remains invalid in strict mode. Atomic `^` / single-`~` precedence is
unchanged.

## 10. Canonical file surface

- UTF-8 without BOM; normal mode may strip one initial BOM, strict rejects it
- LF line endings; normal mode may normalize CRLF, strict rejects CRLF
- exactly one final LF
- no tabs in structural indentation
- hard breaks use trailing `\\`
- canonical tables are compact and unpadded; source rows have the same logical cell count
  after Markanto atomic row tokenization; table cells are positional and `^` / `<` have no
  table-span meaning in 0.1.0
- explicit IDs preserved
- comments preserve their exact interior value

## 11. Valid AST / formatter domain

`src/ast.ts` is a structural reference shape plus the normative invariants in
`docs/INVARIANTS.md`. The formatter accepts only valid semantic ASTs and rejects
unserializable/context-invalid structures rather than guessing. Required law:

```text
parseStrict(format(ast)) == ast
```

for every valid semantic AST.

Valid ASTs are already in semantic normal form; the formatter is not a repair
or normalization pass. This includes coalesced non-empty `Text` nodes,
canonical footnote-array order, removal of tolerated pre-reference footnote
whitespace, and canonical representability of every atomic value and lined
header.

## 12. Diagnostics

Diagnostics have two independent dimensions:

Category:

- `syntax`
- `semantic`
- `resource`
- `noncanonical`
- `advisory`

Severity:

- `error`
- `warning`

Source ranges live only in parser/tooling sidecars or diagnostics; semantic AST
nodes do not carry them. Diagnostics, recovery nodes, renderer hints, and concrete
resource limits are non-semantic. Resource exhaustion has its own operational result
and must not be converted to invalidity.

`Diagnostic` lives in `src/diagnostics.ts` (not `src/ast.ts`). Its optional
`range` is a `Span` with mandatory `line`/`column`/`offset`, in the coordinate
space declared by the `ParseResult.offsetUnit` that carries it — the public raw
space (BOM removed, CRLF/CR preserved). Formatter and pure-AST-validator
diagnostics have no source and carry no `range`.

The operational surface — `ParseResult` / `CanonicalFormatResult` /
`ValidationResult`, `ParserOptions`, and the `SourceAnnotations` sidecar that
gives consumers a per-node source range without a `range` field on any semantic
node — is defined in `src/parser-contract.ts` and documented in
`docs/PARSER_CONTRACT.md`.


## Fenced-container Grid recognition

After the outer fenced-container opener establishes its content baseline, the body
starts in an explicit **undecided** state. Scan forward structurally for complete
baseline marker lines `::`, `--`, and `==`, while honoring code/math/comment literal
regions. The first such marker commits the body to Grid interpretation. If the outer
closer arrives first, parse it as ordinary fenced-container content. `^` and `<` never
trigger Grid mode by themselves.

Do not implement this as parse-fail-rewind. Retain uncommitted source slices/cell
candidates and deeply block-parse each final ordinary slice once after classification.
A pre-trigger `^`/`<` is a continuation only if its complete resolved cell is exactly
that marker. A headerless 1x1 Grid is not a valid semantic value because it has no
Grid-triggering canonical surface.

`::` occurs at most once and partitions a non-empty header from a non-empty body.
Header and body are independent matrices, so rowspan cannot cross the boundary.
Within either group, `--` advances one column and `==` starts a new row. Resolve
continuation-only slots in row-major order (`^` above, `<` left). Reject ragged rows,
missing neighbours, overlap, uncovered slots, and non-rectangular anchor ownership.
Convert to semantic anchor cells with one-based `column` plus optional `rowSpan` /
`colSpan`. A Grid is the sole child of its fenced container.

Formatting performs the inverse transformation. Reconstruct occupancy from anchor
rectangles; emit `<` when only the left neighbour represents the same anchor and
otherwise `^` when above does. Thus `^` wins ambiguous continuation slots.
