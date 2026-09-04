# Real-world CommonMark/GFM compatibility corpus

Evidence gathered for an independent CommonMark / GFM compatibility audit. This
is **not** part of the `bun test test/compat` gate — that runs the vendored
CommonMark 0.31.2 / GFM 0.29-gfm spec suites. This corpus measures how much
*ordinary* Markdown from real projects and assistant output the Markanto parser
accepts.

## Regenerate

The corpus itself is not vendored (189 files, ~40k lines of third-party
prose). `documents/` and `results.json` are git-ignored and rebuilt from
`sources-lock.json`:

```sh
node test/compat/realworld/collect.mjs   # fetch the 102 pinned public docs +
                                         # write the 60 deterministic synthetic ones
bun  test/compat/realworld/analyse.mjs   # → results.json (per-document evidence)
```

`sources-lock.json` pins every public document to an exact commit and records
its licence; `LICENSES/` keeps the applicable licence texts. The 60
`llm-generated/answer-*.md` files are CC0 fixtures written by `collect.mjs`
from a template — a **challenge-fixture set** (cross-line spans, reference
definitions, raw HTML, tables injected by construction), not a sample of model
output frequency.

## Caveats (audit §7)

- Read the 102 public docs and the 60 synthetic fixtures as **separate
  populations**; do not aggregate them into a prevalence percentage.
- "Accepted + same block skeleton" means only: normal-mode parse succeeded and
  the block-only skeleton matches the reference — not inline-semantic,
  link-resolution or rendered equivalence.
- Public-doc selection is deterministic but purposive (root README, then
  lexicographic under a few directory names, capped per repo) — reproducible,
  not statistically representative.
