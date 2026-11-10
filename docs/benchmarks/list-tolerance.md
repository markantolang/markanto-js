# List tolerance fixes: compatibility and performance

The language remains `vendor/spec/0.2.0/spec.md`; package/release versions are
unchanged. Baseline: `12387e9a85c72b0ca698b59058cc150bff15564e` (`main` at the
start of the run). Measurements below use the final compiled implementation.

## Behaviour and compatibility boundaries

- `- A\n  ```python\n  if ok:\n    run()\n  ```\n` previously stored
  `if ok:\nrun()`. It now stores `if ok:\n  run()`, as the blank-separated
  form already did. Code/math content loses only the list frame's structural
  prefix, including through deeper list frames. Fence-line indentation is not
  a content baseline. Tabs, blank lines, and marker-looking literal content
  are preserved. Existing comment values and inline backticks are unchanged.
- `1. A\n   - B\n` and `10. A\n    - B\n` were syntax errors and now have
  the same AST as their two-space forms. The formatter still writes two
  spaces; strict parsing rejects the aliases as noncanonical. The content
  column is measured before a task marker. Canonical ownership wins:
  `- A\n  1. B\n    - C\n` and `10. A\n  - B\n    - C\n` keep their
  three-level trees. `- A\n    - B\n` remains a syntax error.
- `>     prose\n` and `:::\n    prose\n:::\n` keep their paragraph ASTs
  and canonical output, but now report the same `advisory/warning` as
  document-level discarded indentation. Lined containers, Grid cells, and
  list-item paragraphs use that path too. Diagnostics project through list
  and quote prefixes to raw source offsets; a test includes BOM, CRLF, and
  a non-BMP character. Continuation lines and literal content do not warn.
- The quote asymmetry remains: `- A\n   > B\n` contains a quote, while
  `- A\n\n   > B\n` contains literal paragraph text `> B`. Changing the
  latter would change an already-valid AST and needs a separate rule.

Two additional ownership corrections were deliberately excluded:

1. `1. A\n  - B\n    continued\n  - D\n` already parses successfully,
   with `continued` as a separate paragraph in A. Moving it into B would
   change an existing valid AST. The three-space alias preserves this same
   interpretation; fully correcting nested continuation ownership is outside
   the compatibility allowance. Its combined form with a following grandchild
   also exposes the existing canonical-closure conflict.
2. `- A\n  - B\n    ```python\n    if ok:\n      run()\n    ```\n`
   already places the code block in A, after B's list. That block ownership is
   preserved. Its value now keeps the indentation after A's two-space prefix:
   `  if ok:\n    run()`. With a blank line before the fence, the deeper
   frame can now preserve its full literal content without ending early.

The new corpus group has 44 cases with normal/strict expectations, semantic
ASTs for valid inputs, canonical output, and exact diagnostic categories and
severities. Every accepted case checks strict semantic round-trip and byte
stability. Against the baseline, eight literal cases, seven child-column cases,
and six advisory cases fail their new expectations. Existing AST snapshots remain unchanged.

## Validation

- `bun run build`: passed; no installed/upgraded packages or runtime dependencies.
- `bun run verify`: passed, 666 corpus cases and 2,088 tests. The first run
  reached the expected stale-facts failure; `bun run facts` updated the measured
  counts and the subsequent full verification passed.
- `bun run verify:node`: passed. The 44 new fixtures and both annotation tests
  additionally passed under Node against the final `dist` build (46 tests).
- `bun run soak`: passed, default seed `0x50ac`, 100,000 cases per stream;
  88,705 source documents and 32,722 accepted ASTs law-checked, linearity probe
  passed, 15.0 seconds.
- Additional baseline comparison: 37,954 inputs (the corpus, 25,000 generated
  sources, and 12,288 list/literal boundary combinations). Of 24,528 previously
  accepted inputs, none changed AST structure or lost an existing diagnostic;
  68 changed only code/math values. There were 123 newly accepted inputs, all
  satisfying strict canonical closure. This is sampled evidence, not an
  exhaustive proof over all possible sources.

## Benchmark method

`bun run build`, then the unchanged `bun scripts/bench.mjs --json`, four runs
per variant, sequentially in the order **before, after, after, before, before,
after, after, before**. The baseline and final compiled `dist` directories were
copied into place between runs; the branch was never switched. The final build
was restored afterwards. No tests or soak ran concurrently with measurements.

The JSON artifact retains every raw Markanto and `marked` measurement. Times
are milliseconds per operation; an operation parses the full realistic corpus
in the first scenario and one document in the remaining scenarios. The last
row measures parse plus canonical formatting, while the reference emits HTML;
it is orientation only, not an equivalent output operation. Four process
samples cannot establish a statistical performance guarantee.


Runtime: **Bun 1.4.4**.

[Raw measurements](list-tolerance.json).

| Scenario | Before ms/op, runs 1–4 | After ms/op, runs 1–4 | Median before → after | Change |
|---|---|---|---|---:|
| 14 realistic docs (17 KB) | 1.130, 1.226, 1.187, 1.145 | 1.147, 1.302, 1.151, 1.171 | 1.166 → 1.161 | -0.4% |
| largest realistic doc "handbuch-mehrseitig-teil-1.md" (2.0 KB) | 0.105, 0.118, 0.104, 0.105 | 0.109, 0.133, 0.107, 0.108 | 0.105 → 0.109 | +3.6% |
| 814 KB synthetic | 27.703, 29.619, 27.611, 27.222 | 31.632, 31.532, 28.180, 28.268 | 27.657 → 29.900 | +8.1% |
| 814 KB synthetic — whole pipeline (Markanto → canonical, marked → HTML) | 43.099, 45.616, 41.014, 41.657 | 49.018, 45.455, 44.907, 42.917 | 42.378 → 45.181 | +6.6% |

| Scenario | `marked` median before → after, ms/op | Change | Median marked/Markanto ratio before → after |
|---|---|---:|---|
| 14 realistic docs (17 KB) | 1.661 → 1.645 | -1.0% | 1.413 → 1.405 |
| largest realistic doc "handbuch-mehrseitig-teil-1.md" (2.0 KB) | 0.168 → 0.170 | +1.0% | 1.510 → 1.502 |
| 814 KB synthetic | 59.563 → 60.209 | +1.1% | 2.139 → 2.085 |
| 814 KB synthetic — whole pipeline (Markanto → canonical, marked → HTML) | 61.570 → 63.773 | +3.6% | 1.447 → 1.407 |


The synthetic **+8.1%** and whole-pipeline **+6.6%** raw median increases are
performance findings; these measurements do not justify describing performance
as unchanged. The control also slowed, and individual values overlap across
variants. Using each process's marked/Markanto ratio before taking its median
reduces the apparent loss to about **2.6%** for synthetic parsing and **2.9%**
for the pipeline. This control is imperfect: marked runs after Markanto in each
scenario, so it cannot remove load changes during the process.

The implementation adds a content-column field to scanned markers, small
per-item baseline/literal state, literal classification of collected rows, and
one projected advisory callback per virtual list/quote slice. These are actual
new constant-factor costs even when a document has no advisory; there is no
new full parse, rewind, or unbounded lookahead. The measurements do not isolate
which cost dominates, and neither a causal percentage nor statistical
significance was established. A small remaining regression cannot be ruled
out. No claim about other runtimes, hardware, or all possible documents is
made.
