# CommonMark / GFM divergence catalogue

This is the expanded, reviewable form of spec §1.2. It exists so that:

1. an independent reviewer can check every intentional deviation in one place;
2. the conformance harness (`test/compat/`) has a machine-checkable expectation
   for each CommonMark 0.31.2 / GFM 0.29-gfm construct instead of a hand-wave.

Baseline: **CommonMark 0.31.2 (2024-01-28)** + **GFM 0.29-gfm (2019-04-06)**,
frozen (spec §1.1). Where this table and the detailed Markanto chapters
disagree, the chapters win.

## Harness expectation legend

| Code | Meaning for the compat run |
|---|---|
| `same` | Markanto parses it; block structure matches the reference |
| `reject` | Reference accepts; Markanto **must** emit a syntax/semantic diagnostic (by design) |
| `structural` | Both parse; block structure differs **by design** (indentation model, nesting rules) — not a bug, but flagged for human review |
| `import-only` | Not recognised by the parser; the CommonMark import path (spec ch. 16) rewrites it |
| `n/a` | Reference testsuite case not structurally comparable (isolated link-reference-definition lines, raw-HTML carriers) |

## Catalogue

### Blocks

| Construct | Markanto 0.1.0 | Spec | Harness |
|---|---|---|---|
| Tabs | retained as ordinary literal / inline content; the CommonMark contextual tab-to-indentation expansion is narrowed — tabs are forbidden in Markanto list / container structural indentation, and the logical-line layer (§7.3) owns any remaining stripping | §2, §7.3, §9.4 | `same` / `structural` / `import-only` / `reject` |
| Backslash escapes | retained in ordinary inline content and in the delegated direct-link destination / title and fence-info fields; literal contexts (code, code blocks) keep the backslash; where the escaped source sits inside an excluded or changed outer construct the outer construct's row and precedence rules decide | §10.4, §10.5.1 | `same` / `structural` / `import-only` / `reject` |
| ATX headings | retained; ≤3 leading spaces and optional closing `#` accepted in normal mode, stripped canonically; an empty heading is a syntax error (`Heading.children` non-empty, §2.1); 4-space indentation is routed through *Indented code blocks* | §2.1 | `same` / `reject` (empty) |
| Setext headings | not recognised by the parser: a committed `text\n===`/`text\n---` candidate is a diagnostic (fixture `block.heading.setext-rejected`); the CommonMark import path (16) may convert one to ATX; `-` underlines that are also valid thematic breaks stay thematic breaks; competing outer list / quote / indented-code contexts classify by the outer construct | §2.1, §1.2 | `reject` (committed candidate) / `import-only` (import conversion) / `structural` (competing outer block) / `same` (not a Setext heading for CommonMark either) |
| Thematic break `-`/`*` | retained; `---` canonical; padded/spaced forms accepted in normal mode; malformed delimiter-looking lines (`+++`, `*-*`, mixed runs) that reach inline parsing follow the normal-mode literal-delimiter fallback and canonical escaping rule | §2.2, §10.10 | `same` / `structural` / `reject` (committed malformed block candidate) |
| Thematic break `_` form | excluded — `_` is the quiet lined-container fence; a standalone `_` run that is not a valid lined-container opener is a diagnostic in the parser, and the import path (16) converts a genuine CommonMark `_` break to `---` | §2.2 | `import-only` (import → `---`) / `reject` (parser) |
| Thematic break context collisions | excluded Setext / indented-code carriers and retained list ownership take precedence over a break candidate on the same lines | §1.2, §2.2, §7.3 | `structural` / `import-only` / `reject` |
| Indented code blocks | excluded as their own construct; a four-or-more-space-indented line is not indented code. Leading spaces on a paragraph *continuation* line are skipped as soft-wrap (§7.7); where CommonMark also keeps the line in the paragraph, `same`. Where CommonMark would form a code block — a new block's first line indented four or more spaces, including a blank-line-separated indented paragraph CommonMark would attach to a list item — Markanto keeps the prose, drops the indentation, and **emits an advisory** (normal mode) so the discarded surface is not silent; strict mode rejects it as noncanonical; the chapter-16 import path rewrites real indented code to a fenced block (`import-only`). In a composite Setext / thematic / quote context the outer construct classifies it (`structural`); an invalid outer structure is `reject` | §2.4, §1.2, §7.7, §9.6 | `same` (continuation soft-wrap) / `import-only` (indented code → fenced, or the advisory surface) / `structural` (composite context) / `reject` (invalid outer structure) |
| Fenced code blocks | retained with Markanto canonicalisation; an unclosed fence is a syntax error, never literal; a 4-space-indented fence line is ordinary paragraph content and may form a multiline inline-code span, not a block fence; a `` ```+ `` line whose remainder contains a backtick is **not** a fence (the info token may not contain a backtick, §2.4) — it is a paragraph line whose leading run opens an inline code span; the backtick test spans the whole remainder and takes precedence over the one-token info rule. The fence/no-fence decision then matches CommonMark, but the span it opens still follows Markanto inline-code rules (an unclosed leading run is a syntax error, not literal — see below) | §2.4, §10.9 | `same` / `structural` / `reject` (unclosed) |
| HTML blocks / raw inline HTML | excluded | §1.2, §8.2 | `reject` / `n/a` (carriers) |
| HTML comments | only the dedicated `CommentBlock` syntax; visible text after `-->` on the closing line is a syntax error; a 4-space-indented comment carrier is *Indented code blocks* | §2.4.1 | `same` / `reject` (visible closing-line suffix) / `structural` (indented carrier) |
| Block quotes | retained; explicit `>` prefix on **every** belonging line; no lazy continuation; malformed or empty CommonMark quote shapes outside Markanto's QuoteRegion invariants are rejected | §3 | `same` / `structural` (lazy lines) / `reject` |
| Block quote starting at depth > 1 | invalid — a QuoteRegion starts at level 1 | §3.6 | `reject` |
| Paragraphs and blank separation | retained; blank / whitespace-only lines separate blocks and otherwise produce no node; leading (≤3) and continuation indentation and the Markanto break canonicalisation are applied by the logical-line layer | §2.5, §7.3, §10.7 | `same` / `structural` (indentation, break delta) / `reject` (invalid committed outer structure) |
| Block/inline precedence | outer block recognition precedes line-local inline token recognition; composition is classified by the established outer block | §7.3, §10.9 | `structural` / `reject` |
| Link reference definitions | not recognised: a `[label]: target` line and any `[text][label]` / `[text]` reference stay literal text where CommonMark also leaves the candidate literal, become an import-path rewrite where CommonMark forms a definition or resolves a reference, and classify by the outer construct when nested in an excluded / changed block | §1.2, ch. 16 | `same` / `import-only` / `structural` |
| Lists | retained; Strict/canonical uses **exactly 2 ASCII spaces per semantic level**, and level may rise by at most 1; normal mode additionally accepts only the indentation surfaces that CommonMark 0.31.2 deterministically assigns to the same already-open item or its one-level-deeper child, subject to Markanto's no-indented-code and level-rise rules, then normalises them to 2 spaces per level. Empty items, markers without required spacing, ordered markers outside the supported range, tab indentation, and upward jumps by more than one level are rejected | §9.4–§9.6 | `same` for the explicitly retained normal-mode surfaces / `structural` otherwise / `reject` only for the enumerated invalid forms |
| List marker leading spaces | not accepted as a free-standing alias; noncanonical indentation before a marker is accepted in normal mode only when the §9.4 CommonMark-0.31.2 assignment rule attaches it to an already-open item or its one-level-deeper child; Strict accepts only the 2-space-per-level form. Tab indentation and an upward jump by more than one level are rejected rather than treated as indentation aliases | §9.4 | `same` for the explicitly retained normal-mode surfaces / `structural` otherwise / `reject` only for the enumerated invalid forms |
| Tight/loose lists and the bullet character | not adopted: `-` / `+` / `*` are one unordered kind (`+` / `*` normalised to `-`, a diagnostic in strict), and a blank line between simple-list items does not split the list — it is a normal-mode surface removed in the always-tight canonical form (strict rejects it as noncanonical). CommonMark's `- a\n\n- b` (one loose list) and `- a\n\n* b` / `- a\n\n<!-- -->\n\n- b` (two lists) all become one Markanto list unless a different-kind list or a real intervening block separates them | §9.3, §9.9, §9.14, §9.15 | `same` where CommonMark also yields one list / `structural` where CommonMark splits on the blank line or bullet change |
| GFM task-list markers | retained with Markanto canonicalisation; ordered/unordered only, not definition lists | §9.3.2 | `same` |

### Inline

| Construct | Markanto 0.1.0 | Spec | Harness |
|---|---|---|---|
| Inline links/images (direct) | retained; CommonMark destination/title grammar is the baseline; destination breaks only on ASCII space/tab/LF (not all Unicode whitespace); backslash escapes and entity/numeric references are resolved inside the destination and title (CommonMark 0.31.2), subject to the §10.8.1 scalar/control filter; an empty destination is permitted (`[x]()` / `[x](<>)` → empty `href`/`src`, canonical `<>`), as is a present empty title (`[x](u "")` → `title: ""`, distinct from no title). A kindless `<m>` may add `group`, `lang`, and `data-*` to an image. A whole-line image is structurally promoted from CommonMark's paragraph to Markanto `ImageBlock` by §4.4 | §4, §10, §10.5.1 | `same` / `structural` |
| Direct link/image — Markanto context restrictions | a syntax error, not a literal fallback, for: an empty link label (`[](dest)`, error 10.3); a malformed parenthesised group once `](` (or `![…](`) has committed — unescaped space / line break in a bare destination, unbalanced parentheses, an ill-formed title (CommonMark reparses these as text; Markanto does not); a nested anchor (`Link`, `Autolink`, or `FootnoteReference`) in a label or image alt. The label / alt may cross a `SoftBreak` in multiline-capable block content (see the *Multiline CommonMark inline constructs* row); the committing `](` and the destination / title stay on one line. A nested `InlineImage` (linked image) is allowed | §10.5.1, §10.7, INVARIANTS | `same` / `structural` / `reject` |
| Reference-style links/images + `[label]: url` definitions | **not recognised**; `[text][label]`, `[text][]`, `[text]`, `[label]: url` are ordinary text, never an error, never promoted to a link | §1.2, ch. 16 | `import-only` (resolve to direct form) / `same` (CommonMark also leaves it literal) |
| Unicode delimiter flanking classes | Markanto's Unicode-15.1.0 word class is `L*` ∪ `Nd` ∪ `_`; `White_Space` is whitespace and every other code point is punctuation for flanking. Unlike CommonMark 0.31.2's `P*` ∪ `S*` punctuation model, Markanto therefore treats `Nl`/`No` numbers, combining/format characters, and other non-letter/non-decimal characters as punctuation | §10.3 | `same` / `structural` |
| Emphasis / strong | retained; Markanto delimiter + canonical-fallback rules; `<i>`/`<b>` (MIB) are the escape-hatch surfaces for `Em`/`Strong` | §10.6, wrapper-tags | `same` |
| Same-kind direct nesting (`**a**b**c**`) | rejected — no same-kind direct nesting | §10.6 | `reject` |
| Unclosed paired delimiter | an unmatched `*`, `_`, `~~`, `--`, `++`, or `==` opener becomes literal text at its permitted boundary in normal mode; canonical output escapes the opener and the unescaped surface is rejected in strict mode. Other unclosed committed inline tokens remain syntax errors. A lone `^`/`~` with no valid atomic partner stays literal even in strict mode | §10.10 | `same` / `structural` / `reject` |
| Empty token content | syntax error | §10.10 | `reject` |
| Inline code, variable backticks | retained; opener without a same-length closer is a syntax error; an unmatched backtick arrangement with no confirmed opener stays literal | §10.9, §10.10 | `same` / `reject` |
| Hard/soft breaks | single semantic line-break model; canonical hard break is trailing `\`; two-trailing-spaces accepted in normal mode | §7.1, §10.7 | `same` (normalised) |
| Multiline CommonMark inline constructs | in multiline-capable block content, `Em` / `Strong` (and `<i>`/`<b>`), generic `<m>`, direct-link label / image alt, and GFM `Deletion` preserve `SoftBreak`; inline-code line endings collapse to spaces. `HardBreak`, single-line owning contexts, `Obsolete` / `Insert` / `Mark`, and `Sup` / `Sub` remain rejected | §7.7, §10.3, §10.5.1, §10.7, §10.9, §10.11 | `same` / `structural` / `reject` |
| Heading `\n` escape | does not exist — no line breaks inside a heading at all | §2.1 | `reject` / literal |
| Autolinks | replaced/extended by chapter 13 (bracketed + bare); one URL value domain, trailing-punctuation trim on bare | §13 | `same` |
| Entity & numeric character references | semicolon-terminated named refs per vendored `data/…v0.1.0.json`; decimal/hex per Unicode 15.1; also resolved inside a direct-link destination / title | §10.8.1, §10.5.1 | `same` |
| Plain textual content | retained; punctuation, Unicode, and internal whitespace are ordinary text | §10.8 | `same` |

### GFM extensions

| Construct | Markanto 0.1.0 | Spec | Harness |
|---|---|---|---|
| Pipe tables | retained; exact-width positional cells; **no** cell-span geometry — `^`/`<` in a cell are ordinary content | §12 | `same` / `structural` |
| Strikethrough `~~x~~` | retained as `Deletion` → `<del>`; may preserve a `SoftBreak` in multiline-capable block content, not a `HardBreak` (see the *Multiline CommonMark inline constructs* row) | §10.7, §10.11 | `same` / `structural` |
| `--x--` | Markanto addition: `Obsolete` → `<s>` (not GFM) | §10.11 | n/a (not in baseline) |
| Autolink extension (bare URLs) | superseded by chapter 13 rules | §13.2a | `same` / `structural` (trim differences) |
| Task lists | see Blocks table | §9.3.2 | `same` |

## Harness precedence rules

These are comparison rules for `test/compat/`, not language deltas. No §1.2 row
corresponds to them.

- **Outer construct wins.** A reference case is classified by its outermost
  block construct before any inline-section label. An example filed under
  *Entity references* or *Backslash escapes* whose outer block is raw HTML, a
  reference definition, indented code, or a list composes as `n/a` /
  `import-only` / `structural` accordingly; the inline behaviour itself stays
  `same`.
- **Block recognition precedes line-local inline tokens** (§7.3, §10.9): a
  case that depends on inline parsing crossing a physical line or on a
  block/inline precedence that Markanto resolves at the block layer is
  `structural` when the outer block structure is retained.
- **Deferred sections.** Nothing is deferred any more — neither a whole
  reference section nor a construct branch. Every vendored CommonMark 0.31.2 /
  GFM 0.29-gfm case classifies against a catalogue row. The former
  `Indented code blocks` and `Thematic break _ form` phase gates are gone: the
  no-indented-code rule (§1.2), the paragraph / list-continuation leading-space
  handling, and the lined-container recogniser are all settled, so those cases
  now land as `same` (ordinary continuation), `import-only` (an actual code
  block / `_` break that only the chapter-16 import path forms), `structural`
  (a composite Setext / thematic / quote context), or `reject` (an invalid
  outer structure).

## Maintenance rule

Every row here must correspond to a `| … | Markanto 0.1.0 |` row in spec §1.2
or to an explicit chapter statement. When §1.2 changes, this file changes in
the same commit. The `test/compat/` harness loads this catalogue; a CommonMark
testsuite section with no matching expectation is a harness failure, not a
silent pass.
