import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { format, parse, semanticDocumentEquals } from '../../src/index.js';
import type { Document } from '../../src/ast.js';

interface DiagnosticExpectation { readonly category: string; readonly severity: string }
interface Expectation {
  readonly valid: boolean;
  readonly canonical?: string;
  readonly diagnostics: readonly DiagnosticExpectation[];
}
interface Fixture {
  readonly id: string;
  readonly source: string;
  readonly semanticAst?: Document;
  readonly expect: { readonly normal: Expectation; readonly strict: Expectation };
}
const fixtures = (JSON.parse(readFileSync(new URL('../fixtures/tolerance/cases.json', import.meta.url), 'utf8')) as { cases: Fixture[] }).cases;

for (const fixture of fixtures) {
  test(`Indentation conformance: ${fixture.id}`, () => {
    for (const strict of [false, true]) {
      const expected = strict ? fixture.expect.strict : fixture.expect.normal;
      const parsed = parse(fixture.source, { strict });
      assert.equal(parsed.status === 'ok', expected.valid, `${strict ? 'strict' : 'normal'} validity`);
      assert.deepEqual(parsed.diagnostics.map(({ category, severity }) => ({ category, severity })), expected.diagnostics);
      if (parsed.status !== 'ok') continue;
      assert.deepEqual(parsed.document, fixture.semanticAst);
      const formatted = format(parsed.document);
      assert.equal(formatted.status, 'ok');
      if (formatted.status !== 'ok') continue;
      assert.equal(formatted.source, expected.canonical);
      const canonical = parse(formatted.source, { strict: true });
      assert.equal(canonical.status, 'ok', 'canonical output is strict input');
      if (canonical.status !== 'ok') continue;
      assert.deepEqual(semanticDocumentEquals(parsed.document, canonical.document), { status: 'ok', equal: true });
      assert.deepEqual(format(canonical.document), formatted, 'canonical output is byte-stable');
    }
  });
}

test('nested indentation advisories project through list/quote prefixes and CRLF', () => {
  const source = '\uFEFF- 😀\r\n\r\n  >     prose\r\n';
  const parsed = parse(source);
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.diagnostics.length, 1);
  const range = parsed.diagnostics[0]?.range;
  assert.deepEqual(range, {
    start: { line: 3, column: 5, offset: 12 },
    end: { line: 3, column: 14, offset: 21 },
  });
  assert.equal(source.slice(1).slice(range!.start.offset, range!.end.offset), '    prose');
});

test('content-column aliases keep nested annotations at their physical columns', () => {
  const source = '10. A\n    - B\n      - C\n    - D\n';
  const parsed = parse(source);
  assert.equal(parsed.status, 'ok');
  if (parsed.status !== 'ok') return;
  const parent = parsed.document.children[0];
  assert.ok(parent?.type === 'list');
  const child = parent.items[0].children[1];
  assert.ok(child?.type === 'list');
  assert.equal(parsed.annotations.forNode(child.items[0])?.range.start.offset, source.indexOf('- B'));
  const nested = child.items[0].children[1];
  assert.ok(nested?.type === 'list');
  assert.equal(parsed.annotations.forNode(nested.items[0])?.range.start.offset, source.indexOf('- C'));
  assert.equal(parsed.annotations.forNode(child.items[1]!)?.range.start.offset, source.indexOf('- D'));
});
