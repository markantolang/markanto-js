# Changelog

## Unreleased

Markanto 0.3.0 (`vendor/spec/0.3.0/spec.md`, the approved draft at `markantolang/spec` `d817af7`, not yet tagged):
eight changes that read more of what Markdown writers write and say what Markanto reads differently. Strict mode
accepts what it accepted before, and no canonical form changes.

### Language

- **A nested list on two spaces, the parent's content column, or four spaces.** Each nested marker is read on any of
  the three, under every kind of marker: `- A` over `    - B`, `1. A` over `    - B`, and `1. A`, `   - B`, `    - C`
  are lists now. A marker on any other column is error 9.3, as before; the formatter writes two spaces per level.
- **Two or more spaces after a list marker** open an item: `-  item`, `1.  item`, `:  term`. Before, they were
  "empty list item". The formatter writes one space.
- **A block after a blank line belongs to the item from its base.** The base is two spaces, or the column of the
  item's first nested marker. A line four or more spaces past it stays in the item, with the advisory for dropped
  indentation, where 0.2.3 ended the list: `- A\n\n      text` gives A a second paragraph.
- **A paragraph line over `---` is an error**, "setext heading not permitted", as one over `===` has been. Before,
  it was a paragraph and a thematic break. `x` over `--` stays a paragraph, and `- - -` a thematic break.
- **New warnings in normal mode**, none of which makes a document invalid: a line without `>` right after a quote,
  except an attribution, a block ID, or the closer or Grid marker that ends the sequence; tag-like text such as
  `<br>` or `</div>` in ordinary inline text; a paragraph that begins with `[label]:`; a tab in front of a
  paragraph's first line, which gets the advisory four spaces have had, at the top level and in a list item alike:
  `\t2026 report` and `\t*em*` are paragraphs. Only a list marker after the tab, `\t- item` or `\t1. item`, stays
  an error.
- **Diagnostics say what to write**: an emphasis opened inside the same kind names its escape (`\*\*` for `**`,
  `\<i>` for `<i>`); a broken link destination says what is wrong with it, and for a space that `<…>` or `%20`
  writes it; a list marker on a column Markanto does not read says how far it stands from its parent's marker and
  which columns are read there; an unclosed backtick and a code fence with more than one info field say what to
  write instead.

### Fixed

- **A continuation line continues the nested item it reaches.** Without a blank line before it, a line that is no
  list marker continues the paragraph of the deepest open item whose base it reaches, as §9.6 has said since 0.2.0:
  `- A\n  - B\n    continued` is one paragraph `B⏎continued` in B, under every marker and on each of the three
  columns of §9.4. 0.2.0 to 0.2.3 gave the line to A as a paragraph after the nested list, so the formatter's own
  form of a soft break in B was not valid strict input. A code fence at that place belongs to B the same way, with
  its content's indentation. A line under the nested item's base but on the outer item's, `- A\n  - B\n  text`,
  still closes B and is A's.
- The canonical form of a third-level item's second block, `- A\n  - B\n    - C\n\n      text`, is read back into
  C. In 0.2.3 `text` landed outside the list, and strict mode refused the formatter's own output.
- **A tab in the content of a code or math block deep in a list stays content.** Only the item that reads a line
  checks it for a tab in front of a list marker, so the fenced block of a third- or deeper-level item keeps a line
  such as `\tx` or `\t- x` (§2.4), in strict mode too. Before, an outer item checked the line as its own indentation
  and reported "tab in list indentation", so the formatter's own output of such a block was not valid input.

### Conformance

- 118 new corpus cases, among them the 26 owners of a block after a blank line from the specification's table, and the
  corpus sweep now requires every valid case to state its warnings; eight footnote cases state the warning for an
  unused definition they had before. The corpus has 784 cases. Of the 672 CommonMark and GFM cases, 24 change their
  classification and 256 their diagnostics (`docs/COMMONMARK_DIVERGENCE.md`).
- `bun run check:spec-sync` fails until `v0.3.0` is tagged in `markantolang/spec`.

## 0.2.3 — 2026-11-10

### Fixed

- Code and math blocks in a list item keep the indentation of their content, with or without a blank line before them. Before, a `python` block right under `- A` lost the indentation of its lines.
- A nested list on its parent's content column is read as the parent's child, as §9.4 requires: three spaces under `1. `, four under `10. `. Before, it was a syntax error. Two spaces per level remain the canonical form, which the formatter writes and strict mode requires, and documents that were valid keep their meaning.
- Indentation of four or more spaces that Markanto drops now gets its advisory in quotes, containers, Grid cells and list items too, not only at the top level. Continuation lines and the content of code or math blocks get none.

## 0.2.2 — 2026-11-09

### Fixed

- With `errorRecovery`, a container whose name has a character a name may not have (`::: A|B`) made `parse` run forever: the recovery read the same line again and again. It goes on after the line now, as after any error. From a security review.
- With `errorRecovery`, a block that failed lost part of what it had read: a container whose body failed lost the lines between its opener and the failing line, a quote that failed at one level its other levels, a table whose header failed its separator, and a second definition of a footnote all of itself. They were in neither a node nor an error block. The error block now holds all of it, and the diagnostic stays where the error is. An unclosed container no longer claims the lines after it, which then appeared twice. Found in hadley, where a mistyped `:::tldr` turned the following `:::` into an opener and three blocks of the page disappeared.
- `:::tldr`, a fence on its baseline with its name but without the space before it, is refused as before, now with "a fenced container's name follows its fence after a space" instead of "list marker requires exactly one space".

### Repository

- `docs/facts.lima` holds what is measured about the repository, from `scripts/facts.ts`, which `verify` checks; markanto.org reads its numbers from it at a commit.

## 0.2.1 — 2026-10-31

### Fixed

- A document of open brackets did not end: each `[` or `![` doubled the time the search for a label's end took, so a line of forty stopped `parse` for good. The search is one forward pass now, with the same results. From a security review.

### Repository

- The specification has its own repository,
  [`markantolang/spec`](https://github.com/markantolang/spec): one `spec.md`,
  one tag per version, and the named character references it makes normative.
  `vendor/spec/` holds the copies the tests read; `scripts/check-spec-sync.ts`
  compares them, and `data/`, with the tagged commits. The CommonMark and GFM
  suites of the compatibility harness moved to `test/compat/data/`.

## 0.2.0 — 2026-10-29

Markanto 0.2.0 (`spec/markanto-spec-v0.2.0.md`): two changes towards GFM. The
specification of 0.1.0 stays as it was.

### Language

- **A number with a dot is text.** Digits followed by `.` or `)` and then a
  decimal digit open no list item: `3.14 is close to pi`, `2.0 and later` and
  `1.2.3 Overview` are ordinary text at the start of a line, where 0.1.0
  reported "list marker requires exactly one space". `1.Item` and `2)Second`
  stay errors. The escape 0.1.0 needed (`3\.14`) is now a tolerated,
  noncanonical surface.
- **`\|` in a table cell is a pipe, inside code too.** Within a table cell,
  `\|` stands for `|` also inside a code span, inline math, an autolink, a
  superscript and a subscript, as in GFM; `\\|` stands for `\|` in a code
  span, inline math and an autolink. Canonical cells write every literal `|` as
  `\|`, in all of these and in link destinations and titles as well, so a
  canonical table is the same table on GitHub. An MIB attribute value keeps `|`
  as written, and GitHub splits a cell there. A superscript or subscript is not
  atomic for the row tokenizer, so in a cell its value cannot hold a `\`
  directly before a `|`; `format` reports such a tree as invalid.

### Conformance

- Nine table cases now expect the escaped canonical form; thirty-nine new cases
  cover both changes, among them pipes in wrapped images, downloads, metadata
  spans, superscripts and subscripts, and numbers in list items, quotes,
  footnotes and headings. The corpus has 622 cases.

## 0.1.1 — 2026-09-16

Diagnostics now carry source locations.

### Parser

- `Diagnostic.range` — part of the type since 0.1.0, but never populated by
  any emission site — is now set on every syntax, semantic, and advisory
  diagnostic `parse()` reports: duplicate/unreferenced footnote definitions,
  an unresolved footnote reference, invalid or duplicate block ids, unclosed
  wrappers and other recognition failures, malformed `{#id}` suffixes,
  dropped leading indentation, and invalid transport (lone CR / lone
  surrogate). A consumer (e.g. an editor) can now locate an error precisely
  instead of matching on message text, which stays implementation-defined.
- No parsing behaviour changed and no new public API was added — `range` was
  already part of the `Diagnostic` type (`docs/IMPLEMENTATION.md` §12). As
  before, `validate()`, `format()`, and strict-mode canonicality diagnostics
  operate on a source-less semantic AST and never carry `range`.

## 0.1.0 — 2026-09-04

First release of `@markantolang/parser` as the reference implementation of the
**redesigned Markanto 0.1.0 language**. It supersedes the earlier builds based
on the 0.5.3-era specification (previously versioned `0.3.0` package-local). The
lower version number is deliberate: it marks the new, stable language baseline.
See [`docs/MIGRATION.md`](docs/MIGRATION.md) for the consumer cutover and
[`docs/EVOLUTION_V053_TO_010.md`](docs/EVOLUTION_V053_TO_010.md) for every
language delta.

### Public API

- Every operation returns a **tagged status union** — consumers branch on
  `status` before reading a payload. `parse()` yields
  `status: "ok" | "invalid" | "resource"`; `format()`, `validate()`, and
  `checkCanonical()` use corresponding envelopes. This replaces the previous
  thrown-error and inline-`ErrorBlock` model for ordinary failures.
- Source positions are no longer fields of AST nodes. Each `ok` (and each
  recovery) result carries an `annotations` sidecar that maps nodes to source
  ranges on demand.
- `parse(source, { strict: true })` accepts only the canonical surface;
  `{ errorRecovery: true }` adds a `RecoveryDocument` on invalid input without
  affecting valid input.
- CommonMark / GFM import moved to the explicit `@markantolang/parser/commonmark`
  subpath. Its `micromark` / `mdast` dependencies are **optional peer
  dependencies**; the core parser and root entry point ship dependency-free.

### Language

- Canonical surface: exactly one serialisation per meaning, enforced by the
  formatter and the `spec-dogfood` gate (the specification itself is stored in
  canonical Markanto).
- Wrapper tags reduced from 7 to 3; reference links resolved at import time;
  hard breaks in headings written as `\n`; uniform list model (spec §9.9).
- Full v0.5.3 → 0.1.0 migrator (`tools/migrate/`) with a frozen-corpus
  evolution gate: every case maps to a valid 0.1.0 AST or a construct-named
  diagnostic — no silent loss.

### Quality

- Language design and specification independently audited (2026-08-30);
  independent whole-repo review of the implementation completed with a
  **SHIP / FREEZE** verdict — 0 blockers, 0 retained major findings.
- Resource safety: a Grid occupancy matrix is bounded by a caller-tunable
  default (`DEFAULT_MAX_MATRIX_SLOTS`, 100 000) and an absolute, non-overridable
  ceiling (`HARD_MAX_MATRIX_SLOTS`, 1 000 000); an over-budget or
  non-representable matrix returns `resource`, never a native `RangeError`.
- Gates at release: `verify` (type + boundary + 583-case conformance corpus +
  the full 1898-test suite), `verify:node`, `compat:report` (672 vendored
  CommonMark 0.31.2 / GFM cases, 0 `fail`), `soak` (100 000 seeded documents
  per stream through the §7.2 laws plus a parser-linearity probe).
