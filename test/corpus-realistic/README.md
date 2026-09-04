# Realistic full-document fixtures

Long-form prose documents used as integration / round-trip fixtures. They
complement the per-feature `test/fixtures/*/cases.json` cases, which do not
exercise how constructs hold together across a whole document.

## Status: Markanto 0.1.0 canonical

These 14 files originated under the **Markanto spec v0.5.3** surface and are
now ported to canonical 0.1.0. The migration covered:

- old media wrappers to typed `<m>` resources and canonical captions;
- reference-style links resolved manually to direct links;
- old `:--` / `:==` Grid separators to current `--` / `==` geometry;
- canonical table separators and canonical footnote order.

## Executable contract

`run.test.ts` checks normal parsing, strict parsing, validator acceptance,
byte-canonical formatting, formatter idempotence, semantic round-trip, and the
committed `.ast.json` snapshot for every document. Refresh snapshots only after
an intentional semantic change with:

```sh
bun scripts/update-realistic-snapshots.ts
```

Files remain byte-stable via `.gitattributes` (`-text`) after their intentional
0.1.0 migration.
The original v0.5.3-era index is kept as `README.orig-v0.5.3.md`.
