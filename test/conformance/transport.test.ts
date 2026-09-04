import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { format, parse } from '../../src/index.js';

/**
 * Byte / transport conformance (spec §7, §7.4). Unlike every other fixture
 * group, a `transport` case's `source` is the byte-exact input: it may carry a
 * leading BOM, CRLF or lone-CR line endings, a missing / doubled terminal LF,
 * or be the empty document. `scripts/validate-corpus.mjs` exempts this group
 * from the LF-only / trailing-LF shape checks.
 */
interface FixtureCase {
  readonly id: string;
  readonly source: string;
  readonly expect: { readonly normal: Expectation; readonly strict: Expectation };
}
interface Expectation {
  readonly valid: boolean;
  readonly canonical?: string;
  readonly diagnostics?: readonly { readonly category: string }[];
}

const fixtures = (JSON.parse(
  readFileSync(new URL('../fixtures/transport/cases.json', import.meta.url), 'utf8'),
) as { readonly cases: FixtureCase[] }).cases;

assert.equal(fixtures.length, 14, 'all transport fixtures are covered');

for (const fixture of fixtures) {
  test(`transport conformance: ${fixture.id}`, () => {
    checkMode(fixture, false);
    checkMode(fixture, true);
  });
}

function checkMode(fixture: FixtureCase, strict: boolean): void {
  const expected = strict ? fixture.expect.strict : fixture.expect.normal;
  const result = parse(fixture.source, strict ? { strict: true } : {});
  assert.equal(result.status === 'ok', expected.valid, `${strict ? 'strict' : 'normal'} validity: ${describe(result)}`);

  if (result.status === 'ok') {
    if (expected.canonical === undefined) return;
    const formatted = format(result.document);
    assert.equal(formatted.status, 'ok', `${fixture.id} format`);
    if (formatted.status !== 'ok') return;
    assert.equal(formatted.source, expected.canonical, `${fixture.id} canonical`);

    // The canonical surface is a normalised transport: strict accepts it and
    // formatting is byte-idempotent (spec §7.2 law 3 / §7.4).
    const canonical = parse(formatted.source, { strict: true });
    assert.equal(canonical.status, 'ok', `${fixture.id} canonical is strict-valid`);
    if (canonical.status === 'ok') {
      const again = format(canonical.document);
      assert.equal(again.status === 'ok' && again.source, formatted.source, `${fixture.id} idempotent`);
    }
    return;
  }

  if (expected.diagnostics !== undefined) {
    assert.equal(result.diagnostics[0]?.category, expected.diagnostics[0]?.category, `${fixture.id} diagnostic category`);
  }
}

function describe(result: ReturnType<typeof parse>): string {
  return result.status === 'ok' ? 'ok' : `${result.status}: ${result.diagnostics[0]?.message ?? ''}`;
}
