# Tests

Use Node's built-in `node:test` and `node:assert` only. Conformance fixtures
should remain language-neutral so the future Rust implementation can reuse them.

A test file is named `*.test.ts` or `*.test.mjs` and lives below `test/`, outside
any directory whose name starts with a dot. `bun test` finds these files by its
own discovery, and Node runs them by the same convention:
`node --test 'test/**/*.test.ts' 'test/**/*.test.mjs'`. `./check.sh` stops and
names any file of the working tree, ignored or not, that is named like a test
(`.spec`, `_test`, another case or extension, another directory) and does not
follow it.
