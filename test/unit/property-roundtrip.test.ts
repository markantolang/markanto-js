import assert from 'node:assert/strict';
import test from 'node:test';

import { format, parse, semanticDocumentEquals } from '../../src/index.js';
import { generateSource, mulberry32 } from '../helpers/generate-source.js';

/**
 * Deterministic multi-phase closure check. A seeded generator composes
 * documents from Phase 2–7 surface constructs (inline emphasis / code / links /
 * images / footnote references / math, lists, quotes, lined + fenced
 * containers, Grids, tables, block resources) and asserts the four laws of
 * spec §7.2 for each generated document:
 *
 *  1. `parse` of the canonical form reproduces the same semantic AST;
 *  2. `format` is byte-idempotent;
 *  3. the tolerated surface and its canonical form converge;
 *  4. canonical output is valid strict input.
 *
 * `test/unit/parser-roundtrip.test.ts` is the narrower Phase-1 version. The
 * seed is fixed so any failure reproduces exactly.
 */

test('multi-phase generated documents satisfy the four canonical laws', () => {
  const r = mulberry32(0x5eed_1234);
  let checked = 0;
  for (let n = 0; n < 1500; n += 1) {
    const source = generateSource(r);

    const first = parse(source);
    if (first.status !== 'ok') continue; // tolerated-surface generator may still emit an invalid combination
    checked += 1;

    const formatted = format(first.document);
    assert.equal(formatted.status, 'ok', `#${n} format failed for ${JSON.stringify(source)}`);
    if (formatted.status !== 'ok') continue;

    const strict = parse(formatted.source, { strict: true });
    assert.equal(
      strict.status, 'ok',
      `#${n} LAW4 strict rejects canonical ${JSON.stringify(formatted.source)}: ${
        strict.status === 'invalid' ? strict.diagnostics[0]?.message : strict.status}`,
    );
    if (strict.status !== 'ok') continue;

    const eq = semanticDocumentEquals(first.document, strict.document);
    assert.equal(eq.status === 'ok' && eq.equal, true, `#${n} LAW1 semantic drift for ${JSON.stringify(source)} -> ${JSON.stringify(formatted.source)}`);

    const again = format(strict.document);
    assert.equal(again.status === 'ok' && again.source, formatted.source, `#${n} LAW2 not idempotent for ${JSON.stringify(formatted.source)}`);

    const reNormal = parse(formatted.source);
    assert.equal(reNormal.status, 'ok', `#${n} LAW3 canonical fails normal parse`);
    if (reNormal.status === 'ok') {
      const eq2 = semanticDocumentEquals(strict.document, reNormal.document);
      assert.equal(eq2.status === 'ok' && eq2.equal, true, `#${n} LAW3 normal/strict AST diverge on canonical`);
    }
  }
  // The tolerated-surface generator can emit invalid combinations; a large
  // majority must still parse or the harness is not exercising the pipeline.
  assert.ok(checked >= 800, `only ${checked} / 1500 generated documents parsed; generator too lossy`);
});
