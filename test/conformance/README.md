# Conformance runners

The canonical corpus lives under `test/fixtures/` and is runtime-neutral JSON.

Schema/integrity validation is deliberately implemented in
`scripts/validate-corpus.mjs`, not in a Bun- or Node-specific test framework.
It must run unchanged under both runtimes:

```sh
bun scripts/validate-corpus.mjs
node scripts/validate-corpus.mjs
```

Parser/formatter conformance runners added later should consume the same fixture
files. Bun is the primary development runtime; Node is the compatibility check.
Do not fork corpus semantics by runtime.
