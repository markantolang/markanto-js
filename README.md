# @markantolang/parser

The reference implementation of **Markanto 0.1.0** — a parser, a semantic-AST
validator, and a canonical formatter for a Markdown variant.

**Read tolerantly, model strictly, serialise canonically.** CommonMark
standardises how Markdown is *read*; Markanto also standardises how it is
*written*. The parser accepts the loose Markdown people actually write, models
it in a strict semantic AST, and the formatter serialises **exactly one
canonical surface form per meaning**. Markanto-specific syntax is designed to
degrade gracefully — in a plain Markdown renderer it should lose its meaning,
never its readability.

Parsing, validation, canonical formatting, and diagnostics are separate
operations with separate result types; resource exhaustion is always distinct
from language invalidity.

- **Zero production dependencies.** `npm install @markantolang/parser` pulls
  nothing else.
- **Deterministic.** Forward-only scanning, bounded lookahead, no backtracking
  over competing interpretations, RE2-compatible expressions only.
- **Runtime-neutral.** Node ≥ 18.20 and Bun. The semantic core uses no
  runtime-specific APIs.

Specification: [`spec/markanto-spec-v0.1.0.md`](spec/markanto-spec-v0.1.0.md) ·
Homepage: <https://markanto.org>

## Install

```sh
npm install @markantolang/parser
```

## Quickstart

```js
import { parse, format, validate } from '@markantolang/parser';

const source = '# Title\n\nSome **bold** text and a [link](https://example.org).\n';

const parsed = parse(source);
if (parsed.status !== 'ok') {
  // 'invalid'  — not a valid Markanto document (see parsed.diagnostics)
  // 'resource' — a resource budget was exceeded
  throw new Error(`parse: ${parsed.status}`);
}

// parsed.document is the semantic AST (see `src/ast.ts` for its shape).
const formatted = format(parsed.document);
if (formatted.status === 'ok') {
  console.log(formatted.source === source); // true — this input was already canonical
}

console.log(validate(parsed.document).status); // 'ok'
```

Every operation returns a tagged union — **branch on `status` before reading any
payload**. There is no thrown error and no inline error node for ordinary
failures.

| Operation | Call | `status` | Payload on success |
|---|---|---|---|
| Parse surface → AST | `parse(source, options?)` | `ok` \| `invalid` \| `resource` | `document`, `annotations` |
| AST → canonical surface | `format(document, budget?)` | `ok` \| `invalid` \| `resource` | `source` |
| Validate an AST | `validate(document, options?)` | `ok` \| `invalid` \| `resource` | — |
| Check surface canonicality | `checkCanonical(source)` | `canonical` \| `noncanonical` \| `invalid` \| `resource` | `canonical` (the corrected surface) |

`parse(source, { strict: true })` accepts **only** the canonical surface and
returns `invalid` with a `noncanonical` diagnostic otherwise. Default
(`strict: false`) accepts the documented tolerant surface.
`parse(source, { errorRecovery: true })` additionally returns a
`RecoveryDocument` (which may hold `ErrorBlock`s) on invalid input — it never
changes the AST of valid input.

Source positions are not fields of AST nodes; when you need them, read the
per-result `annotations` sidecar (`parsed.annotations`, only present on `ok`
and on recovery results). See
[`docs/PARSER_CONTRACT.md`](docs/PARSER_CONTRACT.md).

## CommonMark / GFM import

Converting existing CommonMark or GFM into Markanto is an explicit, lossy
operation behind a separate entry point, so the core parser never depends on a
Markdown library:

```js
import { importCommonMark } from '@markantolang/parser/commonmark';

const { markanto, diagnostics } = importCommonMark('# Hi\n\nsome _text_\n');
```

The `micromark` / `mdast` packages this subpath needs are **optional peer
dependencies** — install them alongside `@markantolang/parser` only if you use
the subpath. `diagnostics` is an ordered loss-policy ladder: `normalised`,
`resolved`, `source-structure-loss`, `semantic-degradation`, `content-dropped`,
`unrepresentable`. The last two are hard-loss conditions suitable for failing an
unattended import.

## CLI

```sh
npx markanto check  <file>            # is the file a valid Markanto document?
npx markanto check  <file> --strict   # …and is its surface exactly canonical?
npx markanto format <file> --stdout   # print the canonical form
npx markanto format <file>            # rewrite the file in place
npx markanto adopt  <file> --stdout   # attach durable identity (see docs/PARSER_CONTRACT.md)
```

`check` exits non-zero when the file fails the requested check.

## Guarantees

- **One meaning ⇒ one surface.** `format(parse(s).document)` is idempotent, and
  two surfaces with the same meaning format to the same bytes.
- **Semantic round-trip.** `parse(format(ast))` reproduces the same semantic AST.
- **Linear time.** Target O(n) parsing with a monotonic cursor; the property
  gate (`bun run soak`) includes a parser-linearity probe.
- **Portability.** The architecture is written to be ported mechanically to
  safe, idiomatic Rust (`docs/PORTABILITY.md`).

## Documentation

- [`spec/markanto-spec-v0.1.0.md`](spec/markanto-spec-v0.1.0.md) — normative
  language specification (the specification wins over any implementation note)
- [`src/ast.ts`](src/ast.ts) — normative semantic-AST shape
- [`docs/PARSER_CONTRACT.md`](docs/PARSER_CONTRACT.md) — result shapes,
  resource budgets, source-annotation sidecar
- [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md) — compact implementation
  contract
- [`docs/DESIGN_DECISIONS.md`](docs/DESIGN_DECISIONS.md) — the load-bearing
  language and API decisions, with rationale
- [`docs/COMMONMARK_DIVERGENCE.md`](docs/COMMONMARK_DIVERGENCE.md) — every
  intentional CommonMark / GFM deviation
- [`docs/MIGRATION.md`](docs/MIGRATION.md) — cutover from the 0.5.3-era builds
- [`docs/EVOLUTION_V053_TO_010.md`](docs/EVOLUTION_V053_TO_010.md) — every
  v0.5.3 → 0.1.0 language delta and its rationale
- [`docs/DESIGN_PROCESS.md`](docs/DESIGN_PROCESS.md) — how 0.1.0 was built and
  reviewed
- [`CHANGELOG.md`](CHANGELOG.md)

## Development

```sh
bun run verify        # type check + boundary checks + conformance corpus + full test suite
bun run verify:node   # the portable subset under the supported Node baseline
bun run compat:report # classify the 672 vendored CommonMark 0.31.2 / GFM cases
bun run soak          # 100k seeded documents per stream through the §7.2 laws (heavier gate)
bun run bench         # parse throughput vs marked.lexer (Node; bench:bun for Bun)
```

Bun is the primary test/runtime environment; Node is the secondary
compatibility check. The conformance corpus is JSON and is validated by the
same `.mjs` script under both.

## Non-goals

No added syntax, no compatibility aliases, no parser profiles that alter
meaning, no raw HTML, no plugin semantics, no heuristic media typing, no
generalized recursive containers.

## License

ISC © Michael Kortstiege
