# Evolution — Markanto v0.5.3 → 0.1.0

`0.1.0` is a ground-up reimplementation against a redesigned language contract
(`docs/MIGRATION.md`), not a version bump. The spec number goes *down* on
purpose. This document is the single record of **what changed and why**, so that
after the 0.1.0 conformance freeze no delta depends on reading the previous
`monorepo` (which stays available only as a rollback until the freeze).

Columns: the v0.5.3 contract; the 0.1.0 contract; the rationale for the change;
what a v0.5.3 consumer / document experiences (and what the migration tool
`tools/migrate/` does — `mapped` / `dropped` / `unrepresentable` / `review`).

Where a row cites the old spec it means `../monorepo/docs/markanto-spec-v0.5.3.md`
and `../monorepo/docs/markanto-rationale-v0.5.3.md`; the new spec is
`spec/markanto-spec-v0.1.0.md`.

## A. Language surface

| # | v0.5.3 | 0.1.0 | rationale | consequence |
|---|---|---|---|---|
| A1 | **7 reserved wrapper tags** — `<m> <f> <v> <au> <e> <i> <b>` | **3** — `<m>` (MIB) + `<i>`/`<b>` as emphasis-fallback surfaces | `<f>`/`<v>`/`<au>`/`<e>` were a media grammar bolted onto a generic wrapper; 0.1.0 folds them into the typed block resources `ImageBlock` / `VideoBlock` / `AudioBlock` / `EmbedBlock` + generic `<m>`, so the resource semantics live in one place and the wrapper set is minimal | `mapped` — the migrator rewrites `<f …>` etc. to the typed block resource; the media semantics are preserved |
| A2 | `<em>` / `<strong>` reserved, **paragraph-wide multi-line emphasis** allowed (old rationale ~119, ~156, ~318) | renamed `<i>` / `<b>`; **line-local** in the first 0.1.0 draft, then **restored** 2026-09-03 | the rename disambiguates from HTML `<em>`/`<strong>` semantics; the line-local restriction was found (CommonMark / GFM compatibility audit) to cost ordinary hard-wrapped prose without buying a determinism property, so it was narrowed back to "SoftBreak inside `Em`/`Strong`/`<i>`/`<b>`/`<m>`/`~~`/link label/image alt in multiline-capable block content; never HardBreak / blank line / block boundary / single-line owner" (spec §10.7) | net: v0.5.3 multi-line emphasis behaviour is available again under the new node names |
| A3 | in-heading hard break `# Line 1\nLine 2` (v0.5.3-era addition; old rationale 130–141 argued for it and against a global `\n`) | **no line breaks inside a heading at all** (spec §2.1) | a heading is a single logical line; a two-line heading is better expressed as a heading + a following paragraph, and the AST stays simpler. The old pro-argument is not carried into a new con-argument here — recorded as a deliberate reversal | `dropped` — a v0.5.3 two-line heading loses the break; the migrator flags it. **An author can no longer express this meaning.** |
| A4 | reference-style links + `[label]: url` definitions **not** recognised by the parser (already the case in v0.5.3) | same; the CommonMark import subpath (`@markantolang/parser/commonmark`, `src/commonmark/`, spec ch. 16) rewrites them | reference resolution is non-local and conflicts with local semantics + predictable incremental tooling (`DESIGN_DECISIONS.md`, Djot precedent) | unchanged for native Markanto; foreign Markdown goes through the importer |
| A5 | container discriminators `directive` / `fenced`; `fenceLength` was **semantic** (any length preserved) | one `Container` node with `form: 'lined' \| 'fenced'`; `fenceLength` is surface-only, canonical is exactly three; `containerType` is opaque author vocabulary with no Core meaning | fence length carries no meaning a reader needs; canonicalising it removes a state; `DESIGN_DECISIONS.md` §6 records the exact rule (normal tolerant `m ≥ n`, strict exact three) | `mapped` — `:::loud` → `:::`, `:::tldr` → `::: TLDR`, `::: type: "Title"` → `::: type Title` |
| A6 | `lineBreaks: 'hard' \| 'soft'` parser profile — the same source could mean different things | single semantic line-break model; canonical hard break `\` (two trailing spaces tolerated); **identical source has identical meaning** (spec §7) | "meaning travels with the file" — an external parser profile must not change the semantic interpretation | `mapped` — the migrator picks the single model; documents authored assuming `hard` mode need a review pass |
| A7 | `_` usable as a thematic break (CommonMark form) | `_` is the quiet lined-container fence; a bare `_` run is a diagnostic; the importer converts a genuine CommonMark `_` break to `---` | `---` already gives a canonical thematic break; `_` is needed for the container surface | `import-only` |
| A8 | Setext headings, indented code blocks, raw HTML blocks / inline HTML, lazy block-quote continuation | all **excluded** from the Core parser; handled by the import path | closed semantic AST + explicit structure; each has a canonical Markanto equivalent | `import-only` (Setext → ATX, indented → fenced, lazy → prefixed) / raw HTML has no equivalent → `unrepresentable` |
| A9 | GFM strikethrough as `Strike` | `Deletion` → `<del>`; distinct from `Obsolete` (`--…--` → `<s>`) | `<del>` and `<s>` are different semantics; the old single node conflated them | `mapped` |
| A10 | `Sup` / `Sub` content was an inline sequence; v0.5.1 already required whitespace-free atomic content | `Sup.value` / `Sub.value` are atomic strings, whitespace-free, no `^` / `~` | the AST is aligned to the constraint the spec already imposed | `mapped` where the old content was already atomic; otherwise `review` |
| A11 | `MAX_LINK_PAREN_DEPTH = 8` was normative | balanced link destinations use counters/state; no fixed normative paren-depth cap | a fixed small syntactic cap is arbitrary; resource-limit policy (§7.5) covers exhaustion | capability **gain** — deeper legitimate destinations parse |
| A12 | CommonMark distinguishes tight vs. loose lists, and a bullet-character change (`- a` then `* b`) or a blank-line gap starts a **new** list — so a v0.5.3 document could carry two adjacent same-kind `list` nodes | one uniform list model (spec §9.9/§9.14/§9.15): the bullet character is not semantic, a blank line between items is a tolerated normal-mode surface removed in the canonical (always-tight) form, and two adjacent same-kind lists with nothing between them are **one** list — there is no canonical surface for keeping them apart | the tight/loose distinction and the bullet-character identity carry no meaning a reader needs; canonicalising them away removes two state dimensions and keeps list parsing single-pass | `mapped` — the migrator folds a v0.5.3 blank-line-split run of same-kind lists into one, with a `mapped` diagnostic. A discontinuous ordinal (`1.` then `5.`) is representable and is kept as the merged item's visible `value`; a different-kind neighbour (ordered vs. unordered) or any intervening block still separates the lists. |

## B. Attributes and resources — the three decided deltas (2026-09-03)

| # | v0.5.3 | 0.1.0 | decision + rationale | consequence |
|---|---|---|---|---|
| B1 | `data-*` key grammar `[a-zA-Z][a-zA-Z0-9_-]*` — mixed / upper case valid (old spec ~2218) | `data-*` keys are **lowercase-only**; case variants are not tolerated aliases (spec ~1644) | **KEEP the removal.** Matches the HTML `data-*` convention and keeps the AST key space unambiguous; `data-Foo` and `data-foo` must **not** be silently unified because `data-*` is opaque application metadata | `data-Foo=x` is no longer a valid key. The migrator **must emit a diagnostic** (not silently drop / lowercase). A conformance fixture pins the rejection. |
| B2 | `lang` valid on **any** `<m>` content, including an inline image (`<m lang=de>![alt](x.png)</m>`; old spec ~2404, ~2032) | a kindless `<m>` around an image collapses to `inlineImage`; its attrs allowed only `group` | **RESTORE.** Real use cases (an image of text in a specific language; `<img lang>` for assistive tech); the per-context attribute asymmetry costs cognitive load and Markanto is meant to be usable by third parties | `lang` is added back to the inline-image attribute set. Migrator: `mapped`. |
| B3 | markdown link/image title grammar `'"' char* '"'` — **empty** title `[x](u "")` valid, distinct from *no* title (old spec ~1853) | "an empty-string title is invalid — omit the title instead" (spec ~2934, `INVARIANTS.md` ~52) | **RESTORE.** CommonMark and GFM both allow an empty title and render `title=""`, distinct from no `title`; `title: ""` and `title: undefined` are two legitimate AST states, each with one canonical surface | the "`title` when present is non-empty" invariant is dropped for markdown link/image titles (the **container** `::: type ""` title stays non-empty). Migrator passes empty titles through. |
| B4 | media wrappers carried `label` / `alt` as strings | typed block resources carry `label` / `alt` as `Inline[]` | preserves markdown structure in the label instead of flattening it (a thumbnail image label round-trips) | capability **gain** |
| B5 | `DownloadBlock` type existed but was deliberately unreachable since v0.5.0 | reachable — `<m download>[…](…)` is block-capable | v0.5.0 regression undone | capability **gain** |

## C. De-scoped from Core (moved to tooling / the host, not lost)

| # | v0.5.3 | 0.1.0 | rationale |
|---|---|---|---|
| C1 | automatic parser-assigned block IDs; `heading.slug` on the node | only explicit `{#id}` (spec §5); slugs are renderer/tooling behaviour (`docs/MIGRATION.md`); ID adoption is a separate stage (`adopt`) | slug generation is presentation, not source meaning; keeping it out of Core keeps parsing local and deterministic |
| C2 | `SourceRange` on essentially every AST node; the offset unit was part of the type | source ranges are a sidecar (`annotations.forNode(node)`); the offset unit is an API concern (`PARSER_CONTRACT.md`) | source geometry is not document meaning and must not enter semantic equality |
| C3 | smart-quote / document-language handling in the parser (`Document.meta.lang`) | a renderer concern; not in the semantic AST | typography is presentation |
| C4 | `Document.meta.encoding`, `Document.meta.lineBreakMode` | removed from the AST | transport facts, not semantics |
| C5 | fixed syntactic depth limits `maxQuoteDepth` / `maxListDepth` / `maxMixedContainerDepth` | resource-limit policy (`resourceBudget`, §7.5) — exhaustion is an operational `resource` result, never syntax invalidity | a language should not have a hard-coded nesting number; recursion is bounded by budget, separately from validity |
| C6 | URL safety was partly the parser's job | a renderer-side allowlist (`docs/MIGRATION.md` §4); the parser records destinations, the host decides | security policy belongs to the environment, not the grammar |

## D. Additive in 0.1.0 (no v0.5.3 equivalent)

- **Grid** — a fenced-container subgrammar with `column` / `rowSpan` / `colSpan`
  geometry (spec §2.7.7 / §12).
- **`ErrorBlock` / `RecoveryDocument`** — invalid input produces a recovery
  tree that is *outside* the valid semantic-AST domain, so it can never be
  confused with a valid document meaning.
- **CommonMark/GFM import subpath** (`@markantolang/parser/commonmark`, spec ch. 16) — a distinct
  ingest stage, not a parser mode.
- the four **§7.2 canonicalisation laws** as an executed test battery
  (`test/unit/corpus-law-sweep.test.ts`, `property-*.test.ts`).

## E. Non-delta work completed alongside 0.1.0

Byte / transport fixtures, the property soak, the migration evolution gate, the
same-kind-list §9.9 reconciliation, and the CommonMark / GFM audit's P0-7
(unclosed baseline / `--` / `++` / `==` delimiter → literal in normal mode,
escaped-canonical in strict) are not language deltas. They are part of the
0.1.0 test and conformance infrastructure, not this table.
