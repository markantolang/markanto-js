# Parser and Scanner Architecture

## Goal

A small deterministic parser whose control flow can later be ported to Rust
without redesigning the algorithm.

## Forward-only rule

Maintain one monotonic source cursor. A parser may inspect bounded lookahead but
must not commit consumption until the construct is confirmed. Once committed,
consumed input is never reparsed by a competing complete parser.

Prefer this shape:

```text
peek -> classify -> confirm with bounded lookahead -> consume -> emit
```

Never this shape:

```text
parse A deeply -> fail -> rewind -> parse B deeply
```

## Line layer

Use a line reader that exposes physical lines without copying when practical.
The structural layer derives a logical-line view:

```text
physical line
 -> active outer indentation
 -> list child indentation
 -> quote prefix/depth
 -> logical content baseline
```

The logical view should carry source spans back to the original source.

## Explicit buffer

Use a tiny explicit logical-line buffer. Initial target: current + one next line.
This supports:

- typed lined confirmation with one-line lookahead
- lined-opener spacing: tolerate zero/multiple blank lines in normal mode, require exactly one in strict mode
- table header + separator confirmation

Do not generalize this into arbitrary parser backtracking.

Fenced/literal content is scanned forward until its locally known closer. For a
fenced container, Grid classification may remain undecided during that scan; keep
uncommitted slices rather than deeply parsing and rewinding them.

## Block parser

Recognition order is defined in `IMPLEMENTATION.md`. Each recognizer should
prefer a shape such as:

```ts
interface Match<T> {
  readonly node: T;
  readonly next: Cursor;
}
```

or an equivalent result that makes cursor advancement explicit.

A recognizer that cannot match returns a cheap sentinel; invalid-but-recognized
syntax returns a diagnostic/recovery result rather than pretending no construct
was present.

## Inline scanner

Use a cursor over the current physical inline slice. At each position inspect
only the prefixes required by scanner priority.

Recommended primitives:

- `peekCodePoint()` / `peekAscii()`
- `startsWithAscii()`
- `consumeEscapedPunctuation()`
- `scanRun(char)`
- `scanUntil(predicate)`
- `scanBalanced(open, close)` with integer depth
- `scanIdentifier()`

Regexes should be reserved for flat lexical classification, never nested
structure.

## RE2 compatibility

Permitted regex design subset:

- literals
- character classes
- alternation
- ordinary capturing/noncapturing groups
- bounded/unbounded repetition
- anchors where locally useful

Avoid even if JavaScript supports them:

- lookbehind
- backreferences
- engine-specific Unicode/property behavior unless mirrored explicitly in Rust
- catastrophic ambiguous alternation/repetition patterns

Lookahead is best avoided in regex too; express context in scanner code so a
Rust port can use the same state machine.

## Recognition vs validation

Parser answers: "what construct is this and what does it contain?"

Validator answers: "is this recognized structure permitted in this context and
does its semantic AST satisfy invariants?"

Canonical checker answers: "was the accepted source already canonical?"

Keep these concerns distinct even when one pass can cheaply collect data for all
three.

## Recovery

Recovery must be opt-in operational behavior. A valid `Document` never contains
`ErrorBlock`. Recovery should advance monotonically to a safe local boundary and
attach diagnostics out-of-band/in a `RecoveryDocument`.


## Grid subgrammar of fenced containers

Grid markers are context-local exact complete lines on the fenced-container content
baseline: `::` (header/body), `--` (next column), `==` (next row), `^` (continue
above), `<` (continue left). The body begins `undecided`; `::`, `--`, or `==` commits
it to Grid, while `^`/`<` alone do not. Literal regions are classified before marker
tests.

Deferred commitment is not backtracking: preserve uncommitted slices and parse each
final ordinary cell/body slice once. `::` occurs at most once and creates independent
non-empty header/body groups. Each group must resolve to one rectangular width, all
continuation ownership must be rectangular, and rowspan cannot cross `::`. A
headerless semantic Grid must have more than one column or more than one body row.
