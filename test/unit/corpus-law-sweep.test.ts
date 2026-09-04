import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { format, parse, semanticDocumentEquals } from '../../src/index.js';

/**
 * Runs the four §7.2 laws over every fixture in `test/fixtures/` that a mode
 * declares valid — independent of each family's curated conformance runner.
 * This is the standing version of the Phase-9 formatter audit sweep: it fails
 * the moment any valid corpus surface stops round-tripping.
 *
 *  1. canonical form parses back to the same semantic AST (normal and strict);
 *  2. `format` is byte-idempotent;
 *  3. tolerated surface and canonical form converge;
 *  4. canonical output is valid strict input.
 */

interface FixtureCase {
  readonly id: string;
  readonly source: string;
  readonly semanticAst?: unknown;
  readonly expect: { readonly normal: Expectation; readonly strict: Expectation };
}
interface Expectation {
  readonly valid: boolean;
  readonly canonical?: string;
}

const fixturesDir = new URL('../fixtures/', import.meta.url);
const cases: FixtureCase[] = [];
for (const entry of readdirSync(fixturesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const file = new URL(`${entry.name}/cases.json`, fixturesDir);
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { cases: FixtureCase[] };
  for (const fixture of parsed.cases) cases.push(fixture);
}

assert.ok(cases.length > 300, `expected the full corpus, found ${cases.length}`);

for (const fixture of cases) {
  test(`corpus law sweep: ${fixture.id}`, () => {
    for (const mode of ['normal', 'strict'] as const) {
      const expected = fixture.expect[mode];
      if (!expected.valid) continue;

      const first = parse(fixture.source, mode === 'strict' ? { strict: true } : {});
      assert.equal(first.status, 'ok', `${mode} parse: ${describe(first)}`);
      if (first.status !== 'ok') continue;

      const formatted = format(first.document);
      assert.equal(formatted.status, 'ok', `${mode} format: ${describe(formatted)}`);
      if (formatted.status !== 'ok') continue;

      if (expected.canonical !== undefined) {
        assert.equal(formatted.source, expected.canonical, `${mode} canonical output`);
      }

      // Law 4.
      const strict = parse(formatted.source, { strict: true });
      assert.equal(strict.status, 'ok', `${mode} LAW4 canonical not valid strict input: ${describe(strict)}`);
      if (strict.status !== 'ok') continue;

      // Law 2.
      const again = format(strict.document);
      assert.equal(again.status === 'ok' && again.source, formatted.source, `${mode} LAW2 idempotence`);

      // Law 1.
      const eq = semanticDocumentEquals(first.document, strict.document);
      assert.equal(eq.status === 'ok' && eq.equal, true, `${mode} LAW1 closure: ${JSON.stringify(eq)}`);

      // Law 1 from the stored AST, when present.
      if (mode === 'normal' && fixture.semanticAst !== undefined) {
        const roundtrip = semanticDocumentEquals(first.document, fixture.semanticAst as never);
        assert.equal(roundtrip.status === 'ok' && roundtrip.equal, true, 'stored semanticAst mismatch');
      }
    }
  });
}

function describe(result: { status: string; diagnostics?: readonly { message?: string; category?: string }[] }): string {
  const first = result.diagnostics?.[0];
  return first === undefined ? result.status : `${result.status} ${first.category ?? ''} ${first.message ?? ''}`.trim();
}
