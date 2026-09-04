# Candidate edge-case sources (Phase 10A input pool)

**These are not fixtures.** They are raw candidate source strings with a
one-line *intent* note, produced in bulk to feed the Phase 10A conformance-corpus
work. Nothing here is loaded by any test or by `scripts/validate-corpus.mjs` —
this directory is a sibling of `test/fixtures/`, deliberately outside every
corpus glob.

## Pipeline

1. **Generate** (weak model): fill `<family>.json` with candidates —
   `{ id, spec, source, intent }` only.
2. **Triage** (`scripts/triage-candidates.mjs`, built once the Phase 9 Part 2
   formatter lands): run `parse` / `format` / the four §7.2 laws over every
   candidate, classify each (`same` / `noncanonical` / `rejects` /
   `intent-mismatch` / `not-idempotent` / …), write a report.
3. **Promote** (Codex / Claude): the interesting candidates become real
   `test/fixtures/<family>/cases.json` entries **with a correct, spec-checked
   `expect` block** and, where useful, a `semanticAst`.

## Candidate schema

```jsonc
{
  "family": "blocks",
  "candidates": [
    {
      "id": "cand.blocks.heading.uneven-closing-hashes",
      "spec": "2.1",                       // spec section the case probes
      "source": "# Title ##\n",            // must end in "\n"; LF only; no BOM
      "intent": "uneven closing-hash run — tolerated, expected to normalise to '# Title'"
    }
  ]
}
```

- `id` — `cand.<family>.<area>.<slug>`, unique across all files.
- `source` — the literal input. **Always** ends with `\n`. LF only. No BOM,
  no CRLF (those are separate transport cases, not surface cases).
- `intent` — one line: what the case probes and what the author *expects* to
  happen. This is a hypothesis for the triage step to confirm or refute; it is
  **not** an assertion and is never copied into a fixture verbatim.
- **No `expect`, no `semanticAst`, no `diagnostics`.** Determining the actual
  behaviour needs the reference parser and spec knowledge — that is the triage
  and promotion step, not generation.
