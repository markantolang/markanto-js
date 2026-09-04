import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { checkCanonical, format, parse } from '../../src/index.js';

test('accepts canonical source', () => {
  assert.deepEqual(checkCanonical('# Title\n'), { status: 'canonical', diagnostics: [] });
});

test('returns the canonical target for a tolerated surface', () => {
  const result = checkCanonical('## Title ##\n');
  assert.equal(result.status, 'noncanonical');
  if (result.status !== 'noncanonical') return;
  assert.equal(result.canonical, '## Title\n');
  assert.equal(result.diagnostics[0]?.message, 'surface differs from the canonical form');
});

for (const [name, source, message] of [
  ['BOM', '\ufeff# Title\n', 'input has a UTF-8 BOM'],
  ['CRLF', '# Title\r\n', 'input uses CRLF line endings'],
  ['missing final LF', '# Title', 'input does not end with exactly one newline'],
] as const) {
  test(`reports ${name}`, () => {
    const result = checkCanonical(source);
    assert.equal(result.status, 'noncanonical');
    assert.equal(result.diagnostics.some((entry) => entry.message === message), true);
  });
}

test('lone CR remains invalid Markanto transport', () => {
  const result = checkCanonical('# Title\r');
  assert.equal(result.status, 'invalid');
  assert.equal(result.diagnostics.some((entry) => entry.message?.includes('lone CR') === true), true);
});

test('semantic syntax errors remain invalid rather than noncanonical', () => {
  assert.equal(checkCanonical('##\n').status, 'invalid');
});

test('strict parsing uses the same specific canonicality diagnostics', () => {
  const result = parse('# Title\r\n', { strict: true });
  assert.equal(result.status, 'invalid');
  assert.equal(result.diagnostics[0]?.message, 'input uses CRLF line endings');
});

interface FixtureCase {
  readonly id: string;
  readonly source: string;
  readonly expect: {
    readonly normal: { readonly valid: boolean; readonly canonical?: string };
    readonly strict: { readonly valid: boolean; readonly canonical?: string };
  };
}

test('all canonical corpus targets are classified canonical', () => {
  const fixturesDir = new URL('../fixtures/', import.meta.url);
  let checked = 0;
  for (const entry of readdirSync(fixturesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const cases = (JSON.parse(readFileSync(new URL(`${entry.name}/cases.json`, fixturesDir), 'utf8')) as { cases: FixtureCase[] }).cases;
    for (const fixture of cases) {
      if (!fixture.expect.normal.valid) continue;
      let canonical = fixture.expect.normal.canonical;
      if (canonical === undefined) {
        const parsed = parse(fixture.source);
        assert.equal(parsed.status, 'ok', fixture.id);
        if (parsed.status !== 'ok') continue;
        const formatted = format(parsed.document);
        assert.equal(formatted.status, 'ok', fixture.id);
        if (formatted.status !== 'ok') continue;
        canonical = formatted.source;
      }
      assert.equal(checkCanonical(canonical).status, 'canonical', fixture.id);
      checked += 1;
    }
  }
  assert.ok(checked > 250, `expected all normally valid corpus cases, got ${checked}`);
});
