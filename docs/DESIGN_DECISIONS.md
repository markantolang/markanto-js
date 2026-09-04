# Design decisions

The load-bearing language and API decisions behind Markanto 0.1.0, with their
rationale. The specification (`spec/markanto-spec-v0.1.0.md`) is normative; this
file explains *why* the spec reads the way it does, so a later revision does not
undo a choice without knowing what it was for.

## Inherited constraints

Carried forward from the pre-0.1.0 work and still in force: diagnostic
dimensions are aligned across parser/validator/formatter; AST snapshots are
invariant-validated; inline-code canonicalisation is reversible; ATX / fenced
-code deltas from CommonMark are explicit; list tolerance is pinned to
CommonMark 0.31.2; Unicode-dependent behaviour is pinned to Unicode 15.1.0;
named character-reference data is vendored and versioned; bare-autolink trimming
follows the documented GFM path; footnote relations are semantic invariants;
strict byte-surface rules are explicit; corpus fixtures are data-first and
runtime-neutral.

## Language decisions

1. **Table spans removed.** Pipe tables are GFM-near, exact-width, positional
   tables. Exact-cell `^` and `<` are ordinary table content. `rowSpan` /
   `colSpan` exist only in fenced Grid geometry.
2. **`Deletion` and `Obsolete` are distinct.** `~~…~~` lowers to `Deletion`
   (editorial removal, `<del>`); `--…--` lowers to `Obsolete` (retained but
   no-longer-accurate content, `<s>`). The name `Strike` is retired.
3. **Lined containment is wide but not recursive.** A lined container may freely
   mix ordinary direct blocks with any number of direct fenced-container
   children. Fenced containers contain no containers; lined-in-lined is
   forbidden.
4. **A headerless 1×1 is not a semantic Grid.** A Grid must have a visible
   trigger in its canonical surface: a header (`::`), multiple columns (`--`),
   or multiple body rows (`==`). A 1×1 header + `::` + 1×1 body is valid.
5. **Grid recognition is deferred but deterministic.** A fenced body starts
   undecided; the first complete baseline `::`, `--`, or `==` outside literal
   regions commits the whole body to Grid interpretation. `^` / `<` alone never
   trigger Grid mode. Explicit buffering and classification — not parse-fail
   rewind or general backtracking.
6. **Container closers use fence-length monotonicity.** Normal mode: opener
   length `n ≥ 3`, a matching closer has `m ≥ n`, shorter runs do not close.
   Canonical / strict output uses exactly three fence characters.
7. **A container TITLE requires a TYPE.** TYPE and TITLE, when present, are
   non-empty; TYPE must also satisfy the normalised TYPE grammar.
8. **Ordered-list state is normalised in the AST.** `start` is absent for the
   default start `1` and exists only on a non-1 start. The first item never
   stores `value`; a later `value` exists iff the visible marker deviates from
   the expected sequence, which then continues from that deviation.
9. **Quote depth is continuous.** Every `QuoteRegion` starts at level 1; depth
   may stay equal or decrease freely, and may rise by at most one between
   consecutive `QuoteBlock`s.
10. **Addressability follows ownership boundaries.** The `QuoteRegion` owns
    quote identity; blocks inside `QuoteRegion`s, `ListItem`s and Grid cells
    have no independent IDs. Direct ordinary children of lined / fenced
    containers stay independently addressable, as do direct fenced children of
    lined containers.
11. **Task state is list-kind constrained.** `task` is valid only on ordered
    and unordered list items, never definition-list items. Definition lists
    remain in 0.1.0.
12. **Canonical escape placement is unique.** When one escape can neutralise a
    multi-character structural marker, canonical output escapes the leftmost
    effective character. Other effective placements may be normal-valid but are
    strict-noncanonical.
13. **Inline closing is stack-aware.** Opening recognition stays
    longest / most-specific; at a close position a valid closer for the top
    open delimiter wins over a longer competing delimiter. So `***x***` is
    `Strong(Em(x))` and `~~~x~~~` is `Deletion(Sub(x))`, without backtracking.
14. **Outer structural block ownership precedes table confirmation.** A line
    already claimed at the current baseline by list / quote / footnote
    structure is not retroactively reinterpreted as a table header because the
    next line resembles a separator. Table recognition still applies normally
    inside an already-established quote / list child context where permitted.
15. **Resource exhaustion is not invalidity.** Parser, validator, formatter,
    semantic-equality and every other source-controlled traversal distinguish
    an operational `resource` result from syntax / semantic invalidity. The
    grammar has no small fixed list / quote depth limit.
16. **Source locations are not part of the semantic AST.** Ranges / offsets are
    optional parser / tooling sidecar metadata. Core does not normatively pick
    UTF-16, UTF-8-byte, or another offset unit.
17. **Terminology.** `lined` and `fenced` are normative grammar / AST terms.
    `quiet` and `loud` are design-rationale metaphors only and confer no
    semantics.
18. **A valid semantic AST is already in canonical normal form.** The formatter
    accepts only normalised, canonically representable ASTs and never repairs
    nearly-valid input — scalar-only strings, coalesced non-empty `Text` nodes,
    representable lined headers, block-vs-inline resource placement.
19. **Whitespace before a footnote is source trivia.** Normal mode discards the
    tolerated whitespace before `[^id]`; it is not in the semantic AST.
20. **Footnote arrays are canonically ordered.** Referenced definitions follow
    first-reference order; unused definitions follow in ASCII order. Semantic
    equality neither ignores nor reorders this array.
21. **Multiline inline content is bounded.** A `MetadataSpan` (and `Em` /
    `Strong` / `Deletion` / link label / image alt) may contain a `SoftBreak`
    in multiline-capable block content, never a `HardBreak`; its opening tag
    and attributes stay on one physical line; a blank line, a block boundary,
    or a single-line owner is a hard stop. (0.1.0 narrowed an earlier
    strictly line-local rule after the CommonMark / GFM compatibility audit —
    spec §10.7, `INVARIANTS.md`.)
22. **A resource `group` is non-empty.** Attribute syntax may express empty
    strings in general, but an empty `group` value is semantically invalid.
23. **Autolinks have one value domain.** URL values exclude whitespace, `<` and
    `>` in both bracketed and bare forms. Bare scanning excludes both brackets,
    trims trailing punctuation, then revalidates the remaining URL.

## Consistency rules from the same pass

- Block recognition has an explicit context-dependent postfix phase before the
  next independent block is recognised.
- List nesting forbids only upward jumps greater than one; arbitrary decreases
  are permitted.
- A missing definition caused by a case-sensitive footnote mismatch is a
  semantic error in both the spec and the corpus.

## CommonMark / GFM import is why tolerant sugar stays out of Core

Reference-style links / images and their definitions are **not** recognised by
the Markanto parser in either mode: `[text][label]`, `[text][]`, `[text]`, and a
`[label]: target` line are ordinary text — never an error, never promoted to a
link. Resolving them to the direct form is the job of the import pipeline
(spec ch. 16). Shortcut and collapsed reference forms are not supported
anywhere.

Rationale: the construct has zero AST footprint, so it is pure input sugar the
formatter would erase; carrying it in Core would force a document-level
label-resolution phase in the inline parser for no canonical-output benefit.
Footnotes stay in Core by contrast — they are part of the canonical output
language.

The scattered per-construct "Import from CommonMark/GFM" spec subsections remain
normative for their transforms; ch. 16 states the shared contract — pipeline
order, output is canonical Markanto source plus a separate import-diagnostic
taxonomy, no silent reinterpretation.

## Package identity

Nothing was ever published under `@markantolang/parser` or bare `markanto`. The
name is chosen freely and fixed: the npm package is **`@markantolang/parser`**,
version-aligned to the language spec. Project home is `markanto.org`; source is
the `@markantolang` GitHub org.

## Deliberately not redesigned in 0.1.0

Each of these was reviewed and left unchanged; the spec stays normative until a
later version explicitly revisits them:

- the unclosed-opener error policy for several inline delimiters;
- the positional definition-list representation beyond the invariants above;
- whether `SoftBreak` remains part of semantic identity;
- any Core document-metadata / front-matter facility.

## Known limitations at 0.1.0

Narrow edge cases, each rejected by `validate()` (so not a canonical-closure
break) and unreachable from any real migrated document:

- A fence info token containing non-ASCII whitespace (NBSP, U+3000) parses `ok`
  but has no canonical surface.
- `Strong(Text("a*"))` and other *trailing*-delimiter-in-ordinary-text emphasis
  ASTs have no canonical surface (only a leading delimiter run is escaped).
- The pre-parse structural-frame heuristic counts a `>` run inside fenced code
  or an HTML comment toward nesting depth, so a code block with a 1000+ `>` line
  is rejected `resource` under the default budget — a conservative over-count.
- The four-space-indented-content advisory fires at document level only; a drop
  inside a quote / container / list-item body is still silent in normal mode
  (strict mode rejects it).
