# How Markanto 0.1.0 was built

A short account of where this implementation comes from and how it was
validated. For the *what* and *why* of individual rules, see
[`DESIGN_DECISIONS.md`](DESIGN_DECISIONS.md) and the specification.

## The 0.1.0 reset

Markanto began as a Markdown-family document language with a 0.5.3-era
specification and a working parser. 0.1.0 is a deliberate reset: the language
was redesigned from a clean sheet and the version number was **lowered** on
purpose, to mark the new stable baseline rather than imply continuity with the
earlier drafts.

The redesign has one through-line — **exactly one canonical surface form per
meaning** — and a few consequences that shaped everything else:

- **Tolerant in, strict in the middle, canonical out.** The parser accepts a
  documented range of familiar Markdown; the semantic AST is strict and
  normalised; the formatter emits the single canonical form and never repairs a
  nearly-valid AST.
- **Resource exhaustion is not invalidity.** Every traversal distinguishes an
  operational `resource` result from a syntax or semantic error. Safety limits
  are implementation policy, not grammar.
- **Source positions are sidecar data.** The AST carries no offsets; a parse
  result exposes them separately, so the core stays free of a coordinate-unit
  choice.
- **Portability to Rust is a constraint, not an aspiration.** Forward-only
  scanning, bounded explicit lookahead, no backtracking over competing
  interpretations, RE2-compatible expressions only.

Concrete language changes from the 0.5.3 era — wrapper tags reduced from seven
to three, reference-style links moved out of the core parser into an explicit
import step, hard breaks in headings dropped, a uniform list model, a fenced
Grid construct — are catalogued with rationale in
[`EVOLUTION_V053_TO_010.md`](EVOLUTION_V053_TO_010.md).

## How it was validated

- **Spec first.** The specification is the authority; the reference parser,
  validator and formatter are gated against it. The spec is itself written in
  canonical Markanto and a test pins that it parses strict-valid and
  round-trips byte-for-byte.
- **Staged build, reviewed stage by stage.** The implementation was built in
  stages — source layer, block parser, inline parser, containers and Grid,
  resources, quotes, tables, footnotes, validator, formatter, then the
  CommonMark/GFM import and the migration tool. Each stage was reviewed
  independently before the next began.
- **Conformance corpus as data.** Fixtures are runtime-neutral JSON, run under
  both Bun and Node, each case exercised in normal and strict mode with its AST
  snapshot and its canonical output checked.
- **Canonicalisation laws as a test battery.** `parse(format(ast))` reproduces
  the AST; `format(parse(source))` is canonical and idempotent; two surfaces
  with one meaning format identically. These run over the corpus and over
  generated ASTs.
- **A large deterministic soak.** 100 000 seeded documents per stream — surface
  text and hand-built ASTs — through the canonicalisation laws plus a
  parser-linearity probe.
- **CommonMark / GFM compatibility harness.** The vendored CommonMark 0.31.2 and
  GFM 0.29-gfm spec suites (672 cases) are classified against a written
  catalogue of every intentional deviation, with zero unexplained failures.

## Independent review

The language design and specification were independently audited, and the audit
findings were resolved before implementation. The finished implementation then
went through an independent whole-repo review; its final verdict was to ship.
0.1.0 is a **frozen reference implementation** — the language contract does not
move within the 0.1.0 line.
