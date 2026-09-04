# Migration — previous monorepo → 0.1.0 reimplementation

Status: **executed** (2026-09). The reference parser, canonical formatter and
validator are implemented; `case` (Hadley's document layer) runs on the 0.1.0
engine by default; all **six** Hadley sites' content is migrated to canonical
0.1.0 surface syntax and their renderers read the 0.1.0 AST natively. The
previous `monorepo` stays available as a rollback until the 0.1.0 conformance
freeze.

The **full v0.5.3 → 0.1.0 language delta** — every kept / changed / removed
construct with its rationale — is [`EVOLUTION_V053_TO_010.md`](EVOLUTION_V053_TO_010.md).
This document covers the *operational* contract: API shape, source mapping,
URL security, the migration tool, packaging.

## What this is

This repository is a ground-up reimplementation of Markanto against a redesigned
language contract (spec `0.1.0`). It was developed in parallel with the previous
monorepo, which stayed in production for Hadley until the cutover.

The main risk this document exists to manage: building a correct parser that
cannot drop-in replace the production package because it changed the
*operational* contract (result shape, source locations, obsolete fields).

## Package

| | previous monorepo | this repo |
|---|---|---|
| name | `@markantolang/parser` (never published) | `@markantolang/parser` |
| version | `0.3.0` (package-local) | `0.1.0` (aligned to spec `0.1.0`) |
| spec implemented | v0.5.3 / AST v0.4.0 | `0.1.0` (redesign) |
| distribution | `file:` dep in the Hadley sites | `file:` dep, then npm at cutover |

The npm name does not change. The spec version number goes **down** (0.5.3 →
0.1.0): a deliberate reset, not a rollback. The package CHANGELOG must state
plainly that `@markantolang/parser` 0.1.0 implements the redesigned language and
supersedes the 0.5.3-era builds.

## 1. Public API breakage

| previous | 0.1.0 | consumer action |
|---|---|---|
| `parse(source, opts?)` returns a `Document` directly (throws / embeds `ErrorBlock` on failure) | `parse(source, opts?)` returns a `ParseResult` tagged `ok` / `invalid` / `resource` (`docs/PARSER_CONTRACT.md`) | branch on `status`; read `result.document` only under `ok` |
| errors surfaced as thrown exceptions or inline `ErrorBlock` | `invalid` result with `diagnostics`; a `RecoveryDocument` only when `ParserOptions.errorRecovery` is set | pass `errorRecovery: true` if a partial tree is needed; otherwise handle `invalid` |
| `format` / `validate` / `adopt` return bare values | `CanonicalFormatResult` / `ValidationResult` (same `status` union); `adoptDocument` provides ID adoption | branch on `status` |
| resource limits reported as syntax errors | `status: 'resource'` / `category: 'resource'` — never a validity verdict | treat `resource` as "try smaller input / raise budget", not "invalid" |

`ParserOptions` is `{ strict?, errorRecovery?, resourceBudget? }`. There is no
`lineBreaks` option (the single semantic line-break model replaces it).

## 2. Semantic AST breakage

0.1.0 does not carry these obsolete fields/nodes. Reconstruct adapter-side or
drop; do **not** ask Core to keep them.

| obsolete | 0.1.0 | adapter note |
|---|---|---|
| `heading.slug` | not a Core field — automatic slugs are renderer/tooling behaviour (spec §6.3) | compute the slug in the renderer from `Heading.children` plain text |
| `Span` node | `MetadataSpan` (kindless `<m>` with ≥1 attribute) | remap; a bare `[text]{k=v}` no longer parses (see §5) |
| `Strike` node | `Deletion` (`~~…~~` → `<del>`) and `Obsolete` (`--…--` → `<s>`) are distinct | map `Strike` → `Deletion`; `<s>` output now comes only from `Obsolete` |
| `<f>`/`<v>`/`<au>`/`<e>` wrappers | folded into `<m>` (MIB) and the typed block resources `imageBlock`/`videoBlock`/`audioBlock`/`embedBlock` | renderer reads the typed block nodes; wrapper tag names are gone from source |
| `<em>`/`<strong>` wrapper tags | `<i>`/`<b>` map to `Em`/`Strong` | source rewrite; AST nodes unchanged |
| Sup/Sub with inline children | `Sup`/`Sub` carry an atomic `value: string` (no children) | flatten |
| container discriminators / old `containerType` semantics | `form: 'lined' | 'fenced'`; `containerType` is opaque author vocabulary with no Core meaning | do not switch renderer behaviour on TYPE spelling except as an explicit theme convention |
| automatic parser-assigned block IDs | IDs only from explicit `{#id}` (spec §5); adoption is separate tooling (`adoptDocument`) | if the renderer needs an id per block, derive it from the sidecar range or a traversal index, not from `node.id` |
| reference-style links in Core | not recognised; resolution is the CommonMark import path (spec ch. 16) | run the importer before Core, or migrate the source |

## 3. Source mapping

**Stable now** — `docs/PARSER_CONTRACT.md` is authoritative.

- Source locations are **not** on semantic nodes. A `ParseResult.ok` carries a
  `SourceAnnotations` sidecar; `annotations.forNode(node)` → `{ range }`.
- **Coordinate space:** every offset/line/column is in the raw input with a
  leading BOM removed and CRLF/CR preserved — i.e. the editor's own source, not
  the parser's normalised text. `annotations.offsetUnit` (`utf16-code-unit`
  here) is declared once per result.
- **`range` is half-open `[start, end)`** and follows the boundary rule in
  `docs/PARSER_CONTRACT.md`: it includes the node's own carriers (fences,
  markers, `{#id}` suffix, caption/attribution lines) but **not** separating
  blank lines and **not** the terminating LF after the node's last token. This
  matches the special EOF/LF compensation the current Hadley consumer already
  does by hand — it can be deleted.
- Annotated: `Document`, `RecoveryDocument`, every block (incl. `Grid`),
  `ListItem`, `TableRow`, `TableCell`, `FootnoteDefinition`, every `Inline`,
  `QuoteBlock`, `GridRow`, `GridCell`, recovery `ErrorBlock`.
- Coalesced / aliased / reordered nodes: `range` is a best-fit enclosing span,
  not a guaranteed round-trip (`docs/PARSER_CONTRACT.md`).

### Hadley adapter obligations (source mapping)

`/home/mko/dev/hadley/ssg/packages/case/index.ts` and
`markanto-renderer.ts:386–409` currently read `node.range` for `editorBlocks`,
source ordering, `data-hadley-id` and editor offsets, and already do
`[...document.children, ...document.footnotes].sort(bySourceOffset)`. The
adapter must:

1. call `parse()`, branch on `status`, keep the `annotations` handle alongside
   the `document`;
2. replace every `node.range` read with `annotations.forNode(node)?.range`;
3. **for source ordering**: `document.footnotes` is stored in *canonical*
   (first-reference then ASCII) order, **not** source order, and a bare
   `document.children` walk drops footnotes entirely. Merge
   `document.children` with `document.footnotes`, read each node's
   `annotations.forNode(node).range.start.offset`, and sort by that. For
   recovery, merge `recovery.children` **and `recovery.footnotes`** (the
   recovery document has its own footnotes array too) and sort the same way;
4. derive `data-hadley-id` from that stable sorted position or the range, not
   from a parser-assigned `node.id` (there is none);
5. treat `annotations.forNode` returning `undefined` as "no precise range" and
   fall back to the nearest annotated ancestor (`Document` /
   `RecoveryDocument` are always annotated);
6. read the coordinate unit from `result.offsetUnit` (or the equal
   `annotations.offsetUnit`); if the editor keeps a leading BOM in its buffer,
   add 1 to every absolute offset, to a line-1 UTF-16 column, and to every
   `source.slice` base — Core's coordinates exclude the BOM.

## 4. URL / destination security

Core 0.1.0 **delegates destination safety to the host** (spec §8.1). The
previous parser rejected unsafe resource schemes and required HTTPS for embeds;
Core no longer does.

The Hadley renderer migration must add, renderer-side:

- an allowlist of permitted URL schemes for links, images, media `src`,
  `preview`, and embed targets;
- explicit rejection + negative tests for `javascript:`, `data:`, `file:`,
  protocol-relative (`//host`), and foreign-scheme destinations;
- the same checks on `data-*` values that end up in `href`/`src` positions.

Attribute escaping alone is **not** sufficient. This is a renderer
responsibility, not a Core parser change — do not add scheme validation to
Core.

## 5. Old Markanto (v0.5.3) content migration

The CommonMark/GFM importer **cannot** recover old Markanto-specific semantics;
those go through the dedicated v0.5.3 transform `tools/migrate/` (`migrateV053`,
categories `mapped` / `dropped` / `unrepresentable` / `review`) — **silent
fallback to an ordinary paragraph or container is forbidden**. Handled deltas
include:

- `[Text]{lang: en}` bracket attributes → `<m lang=en>Text</m>`
- old `: Caption` resource captions → the 0.1.0 mandatory-hard-break + emphasis
  carrier caption form
- `::: grid` plus `:--` / `:==` markers → 0.1.0 Fenced Grid (`::`/`--`/`==`)
- `<f>` / `<v>` / `<au>` / `<e>` wrappers → `<m>` / typed block resources
- reference definitions → resolved direct links (importer) **or** source rewrite
- intended internal `/identifier` links → `#identifier` / `$identifier` per spec §8

Deltas that **cannot** be represented (heading line breaks, raw inline HTML)
are reported, not guessed. The full list is `EVOLUTION_V053_TO_010.md`.

## 6. Packaging / CLI

Implemented: `package.json` `exports` / `bin` / `files` / `engines`;
`prepublishOnly` runs typecheck + build + full test; the shipped tree is
boundary-checked (`scripts/check-shipped-deps.mjs`); the CLI is
`markanto <check|format|adopt> <file>`.

**Not yet done:** the npm publish itself — `@markantolang/parser` is still a
`file:` dependency in `case`; publishing `0.1.0` (and dropping `private`) is
gated on the 0.1.0 conformance freeze.

## 7. Downstream parity gate — met

- realistic-corpus round-trip runner green on all 14 documents;
- Hadley renderer ported to the 0.1.0 AST natively (`packages/case/markanto-native-renderer.ts`),
  with the URL allowlist and negative tests; a `CASE_RENDERER=adapter` shim
  path and a `CASE_MARKANTO=v0.5.3` full-legacy path remain as rollbacks;
- per-site golden byte-diff (`hadley/ssg/docs/golden/`) held across the cutover
  on all six sites — the two accepted content-driven changes are recorded in
  `hadley/ssg/docs/markanto-0.1.0-migration.md`.

## Cutover — done (2026-09)

Per site, in `create/<site>/site`: run `hadley/ssg/scripts/migrate-content.ts`
over the content, review the per-file diff, commit the rewritten canonical
source; then the `case` engine flip + native-renderer merge deploy together.
Sites: hadley.sh, stechfliegenhund.de, limaformat.dev, markanto.org, teblo.de
(mko.run had no migratable content).

The migration **evolution gate** is met: `test/migrate/migration-evolution-gate.test.ts`
runs `migrateV053` over a frozen snapshot of the valid v0.5.3 conformance corpus
(`test/migrate/v053-corpus/`, the `{id, specRef, input}` of every case with a
clean v0.4.0 AST the vendored legacy parser accepts — 265, error / recovery
cases excluded; regenerated by `scripts/vendor-v053-corpus.mjs`). It asserts
that every case yields a valid 0.1.0 document *or* an explicit
`dropped` / `unrepresentable` / `review` diagnostic that names a construct-level
obstruction (never only the generic fallback); that no v0.5.3 construct — the
source re-parsed with the vendored legacy parser, mapped to its 0.1.0 name —
vanishes from the migrated AST without a diagnostic; and that every
meaning-preserving (`mapped`) migration round-trips through the strict parser.
The breakdown is regenerated to `docs/audits/migration-evolution-gate.md`.

The migration gate reads a frozen `test/migrate/v053-corpus/` snapshot rather
than the previous monorepo's tree, so it keeps working after that repository is
retired.
