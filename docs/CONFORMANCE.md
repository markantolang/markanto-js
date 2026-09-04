# Conformance Corpus Format

The corpus should be data-first and portable to a later Rust test runner.
Avoid TypeScript-only fixture logic.

Recommended fixture representation: UTF-8 JSON files using only JSON data.

Example shape:

```json
{
  "name": "normal hr converges",
  "mode": "normal",
  "source": "* * *\n",
  "valid": true,
  "canonical": "---\n"
}
```

For invalid input:

```json
{
  "name": "empty fenced container",
  "mode": "normal",
  "source": ":::\n:::\n",
  "valid": false,
  "diagnostics": [
    { "category": "semantic", "severity": "error" }
  ]
}
```

AST snapshots may be separate JSON documents if direct TypeScript AST literals
become noisy. Semantic snapshots never contain `range`; source-mapping tests use
separate parser/tooling metadata fixtures.

### Transport group

`test/fixtures/transport/cases.json` (group `transport`) is the byte / transport
channel (spec §7, §7.4). Its `source` is the **byte-exact** input and may carry
a leading BOM, CRLF or lone-CR endings, a missing / doubled terminal LF, or be
the empty document — `validate-corpus.mjs` exempts the group from the LF-only
and trailing-LF shape checks. Every other group's `source` still must be
LF-only and end in exactly one LF.

Coverage: single / absent / doubled / tripled terminal LF, the empty document
and the lone `\n`, a stripped BOM (with content and empty), CRLF normalisation
(with and without a blank line), a lone CR (mid-line and trailing — invalid in
both modes), and a lone UTF-16 surrogate (invalid). Byte-level malformed UTF-8
beyond a lone surrogate has no distinct entry point while `parse()` takes a
JS string; it awaits a `parseBytes` boundary and is out of scope here.

`test/conformance/transport.test.ts` runs the group under `bun test` (part of
`bun run verify`): parse in both modes against the expected validity, the
canonical surface via `format`, and — for each normalising case — that the
canonical form is strict-valid and byte-idempotent. `validate-corpus.mjs`
validates the fixture shapes under both `bun` and `node` (`verify:node`), the
same split every other conformance group uses.

Fixture IDs/names should remain stable across the TypeScript and Rust runners.


## Semantic AST snapshot requirements

When `semanticAst` is present it is normative expected document meaning, not an
illustrative example. `scripts/validate-corpus.mjs` recursively validates the
snapshot against the structural shape and major serializability/context
invariants. Once the reference parser/formatter exists, every snapshot case must
also satisfy:

```text
parseNormal(source) == semanticAst
parseStrict(canonical) == semanticAst
parseStrict(format(semanticAst)) == semanticAst
format(semanticAst) == canonical
```

A fixture may not be changed merely to make an implementation pass; changes
must be justified against the specification and recorded in review history.
