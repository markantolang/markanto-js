# Vendored specification

The normative specification lives in
[`markantolang/spec`](https://github.com/markantolang/spec). This folder holds
`spec.md` of each version at its tag, as `source.json` records, so the tests
need no network: `test/unit/spec-dogfood.test.ts` checks that each is canonical
Markanto. The named character references in `../../data/` come from the same
repository, at the version `source.json` names as `data`.

To take a new version, or a new tag, with a clone of the specification
repository next to this one (`../spec`):

1. copy `spec.md` at the tag to `vendor/spec/<version>/spec.md`;
2. record the tag and its commit in `source.json`;
3. run `bun scripts/check-spec-sync.ts` — it compares every vendored file with
  the tagged commit and exits 1 on a difference.

`bun scripts/format-spec.ts ../spec/spec.md` writes a specification in its
canonical form before it is committed there.
