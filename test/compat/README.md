# test/compat/ — CommonMark / GFM conformance harness

**Status: gate active, nothing deferred.** All 672 vendored cases classify
against a `docs/COMMONMARK_DIVERGENCE.md` row with zero `fail`, zero
`gap-uncovered`, and zero `deferred-uncovered` — the former `Indented code
blocks` and `Thematic break _ form` phase gates are retired. The current split
lives only in `test/compat/reports/latest.md` (do not copy it here — a
hand-written `reject 194 / import-only 84` had already gone stale against the
generated `191 / 87`).

`same` is only *"parser accepts + block-only skeleton matches the reference"* —
not inline-semantic, link-resolution or rendered equivalence. Tighten the label
once a semantic-subset projection exists (audit 2026-09-02 §7.2, §7.5).

## Purpose

External ground truth for the parser, independent of our own `test/fixtures/`
corpus (which only checks what we thought to check). The spec frames Markanto
as "CommonMark 0.31.2 baseline + explicit delta" (§1.1, §1.2) — this harness
turns that claim into a CI gate.

## Design (carried over from the previous monorepo's `compat/`)

- **Reference parser:** `micromark` + `micromark-extension-gfm`, pinned. This
  is a **devDependency only** — it must never be imported from `src/`. It is
  tested against the official CommonMark suite upstream, is maintained, and
  covers CommonMark core + GFM (tables, strikethrough, task lists, extended
  autolinks) — exactly the "CommonMark/GFM" scope the spec references.
  The exact devDependency versions are `mdast-util-from-markdown@2.0.2`,
  `micromark-extension-gfm@3.0.0`, and `mdast-util-gfm@3.1.0`.
- **Input corpus:**
  - `spec/commonmark-0.31.2.json` — official CommonMark 0.31.2 testsuite
    (<https://spec.commonmark.org/0.31.2/spec.json>), vendored unchanged.
  - `spec/gfm-0.29-extra.json` — hand-curated GFM cases (no standardised
    machine-readable GFM suite exists), examples from
    <https://github.github.com/gfm/>.
- **Comparison:** Markanto Core produces an AST, not HTML, so there is no
  direct "same HTML" target. Compare block structure and classify each case
  against `docs/COMMONMARK_DIVERGENCE.md`:
  - `same` — Markanto parses; block structure matches the reference.
  - `reject` — reference accepts, Markanto emits a diagnostic **and the
    divergence catalogue says it should**.
  - `structural` — both parse, structure differs, catalogue says by design.
  - `import-only` — construct the parser does not recognise; belongs to the
    ch. 16 import path.
  - `n/a` — isolated link-reference-definition lines, raw-HTML carriers.
  - `deferred-uncovered` — a catalogue-declared construct branch that was
    explicitly phase-gated. None remain; the code path stays so a future
    re-gate is cheap.
  - `gap-uncovered` — no complete catalogue mapping; always fails the gate.
  - **fail** — anything not covered by the catalogue. This is the gate.

Once a canonical HTML renderer exists (reference tooling, not Core), tighten
`same` from block-count heuristics to HTML equivalence.

## knownDivergence

The previous monorepo kept a `knownDivergence.ts` regex→note map. Here the
authority is `docs/COMMONMARK_DIVERGENCE.md`; the harness loads that table and
maps reference-suite sections / Markanto diagnostic codes onto its rows. Keep
the two in sync in the same commit as any §1.2 change.

## Run (once built)

```sh
bun test test/compat        # pass/fail gate
bun run compat:report       # writes test/compat/reports/latest.md
```

Totals live only in `reports/latest.md`, never duplicated by hand.
