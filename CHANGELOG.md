# Changelog

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
