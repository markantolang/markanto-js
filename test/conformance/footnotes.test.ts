import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { format, parse, semanticDocumentEquals } from '../../src/index.js';
interface Expectation { readonly valid: boolean; readonly canonical?: string; readonly diagnostics?: readonly { readonly category: string }[] }
interface Fixture { readonly id: string; readonly source: string; readonly semanticAst?: unknown; readonly expect: { readonly normal: Expectation; readonly strict: Expectation } }
const fixtures = (JSON.parse(readFileSync(new URL('../fixtures/footnotes/cases.json', import.meta.url), 'utf8')) as { cases: Fixture[] }).cases;
for (const fixture of fixtures) test(`Phase 7 conformance: ${fixture.id}`, () => { check(fixture, false); check(fixture, true); });
function check(fixture: Fixture, strict: boolean): void {
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
      assert.deepEqual(semanticDocumentEquals(result.document, fixture.semanticAst as never), { status: 'ok', equal: true });
    }
  } else if (expected.diagnostics !== undefined) {
    assert.equal(result.diagnostics[0]?.category, expected.diagnostics[0]?.category);
  }
}
