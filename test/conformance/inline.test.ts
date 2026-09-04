import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { format, parse, semanticDocumentEquals } from '../../src/index.js';

interface FixtureCase {
  readonly id: string;
  readonly source: string;
  readonly semanticAst?: unknown;
  readonly expect: { readonly normal: Expectation; readonly strict: Expectation };
}
interface Expectation {
  readonly valid: boolean;
  readonly canonical?: string;
  readonly diagnostics?: readonly { readonly category: string }[];
}

const fixtures = [
  ...load('../fixtures/inline/cases.json'),
  ...load('../fixtures/math/cases.json').filter((fixture) => fixture.id.startsWith('math.inline')),
];

assert.equal(fixtures.length, 131, 'all 123 inline and eight inline-math fixtures are covered');

for (const fixture of fixtures) {
  test(`Phase 2 conformance: ${fixture.id}`, () => {
    checkMode(fixture, false);
    checkMode(fixture, true);
  });
}

function checkMode(fixture: FixtureCase, strict: boolean): void {
  const expected = strict ? fixture.expect.strict : fixture.expect.normal;
  const result = parse(fixture.source, strict ? { strict: true } : {});
  assert.equal(result.status === 'ok', expected.valid, `${strict ? 'strict' : 'normal'} validity`);
  if (result.status === 'ok') {
    if (expected.canonical !== undefined) {
      const formatted = format(result.document);
      assert.equal(formatted.status, 'ok');
      if (formatted.status === 'ok') assert.equal(formatted.source, expected.canonical);
    }
    if (!strict && fixture.semanticAst !== undefined) {
      const equality = semanticDocumentEquals(result.document, fixture.semanticAst as never);
      assert.deepEqual(equality, { status: 'ok', equal: true });
    }
  } else if (expected.diagnostics !== undefined) {
    assert.equal(result.diagnostics[0]?.category, expected.diagnostics[0]?.category);
  }
}

function load(relative: string): FixtureCase[] {
  const url = new URL(relative, import.meta.url);
  return (JSON.parse(readFileSync(url, 'utf8')) as { readonly cases: FixtureCase[] }).cases;
}
