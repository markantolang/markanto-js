import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { format, parse } from '../../src/index.js';

// The normative specifications are themselves written in Markanto. Each must not only
// parse as a valid Markanto document — a spec that violates its own rules
// (a code span whose delimiter is no longer than an inner backtick run, a
// ```-fence example that closes on a nested ``` run, a hard-wrapped
// continuation line that looks like a list marker, …) is a defect — it must be
// written in the *canonical* form: strict-valid and byte-stable under the
// formatter. Keep this green: when a spec edit trips it, run
// `bun scripts/format-spec.ts` (or fix the prose), don't relax the check.
for (const name of ['markanto-spec-v0.1.0.md', 'markanto-spec-v0.2.0.md']) {
  const source = readFileSync(fileURLToPath(new URL(`../../spec/${name}`, import.meta.url)), 'utf8');

  test(`spec/${name} parses as a valid Markanto document`, () => {
    assert.equal(parse(source).status, 'ok');
  });

  test(`spec/${name} is written in canonical Markanto (strict-valid, byte-stable)`, () => {
    assert.equal(parse(source, { strict: true }).status, 'ok');

    const parsed = parse(source);
    assert.equal(parsed.status, 'ok');
    if (parsed.status !== 'ok') return;
    const formatted = format(parsed.document);
    assert.equal(formatted.status, 'ok');
    if (formatted.status === 'ok') assert.equal(formatted.source, source);
  });
}
