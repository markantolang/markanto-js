import assert from 'node:assert/strict';
import test from 'node:test';

import { format, parse, semanticDocumentEquals, validate } from '../../src/index.js';
import { generateAst, mulberry32 } from '../helpers/generate-ast.js';

/**
 * AST-first closure check (neutral review N2). `property-roundtrip.test.ts`
 * only exercises the closure of *parser-produced* ASTs; `validate()` accepts a
 * wider domain — an importer, `adoptDocument`, or a hand-built consumer can
 * construct `Text` values, emphasis nestings, destinations, and sibling
 * arrangements the parser never emits.
 *
 * This generator composes documents directly in that wider domain, then, for
 * every document `validate()` accepts, verifies the §7.2 laws **independently
 * of the validator's own representability gate**:
 *
 *  - `format(A)` succeeds;
 *  - `parseStrict(format(A))` is semantically equal to `A` (law 2);
 *  - `format` is byte-idempotent (law 3).
 *
 * Documents `validate()` rejects are out of domain and skipped — but a healthy
 * fraction must be accepted or the generator is not reaching the pipeline.
 */

test('validate-accepted hand-built ASTs satisfy the canonical-closure laws (N2)', () => {
  const r = mulberry32(0x5eed_a57);
  let accepted = 0;
  for (let n = 0; n < 2000; n += 1) {
    const document = generateAst(r);
    if (validate(document).status !== 'ok') continue;
    accepted += 1;

    const formatted = format(document);
    assert.equal(formatted.status, 'ok', `#${n} validate ok but format ${formatted.status}`);
    if (formatted.status !== 'ok') continue;

    const reparsed = parse(formatted.source);
    assert.equal(reparsed.status, 'ok', `#${n} canonical does not parse: ${JSON.stringify(formatted.source)}`);
    if (reparsed.status !== 'ok') continue;

    const eq = semanticDocumentEquals(document, reparsed.document);
    assert.equal(eq.status === 'ok' && eq.equal, true, `#${n} law-2 drift: ${JSON.stringify(formatted.source)}`);

    const again = format(reparsed.document);
    assert.equal(again.status === 'ok' && again.source, formatted.source, `#${n} law-3 not idempotent`);

    assert.equal(parse(formatted.source, { strict: true }).status, 'ok', `#${n} strict rejects canonical`);
  }
  assert.ok(accepted >= 200, `only ${accepted} / 2000 generated ASTs were in-domain; generator too narrow`);
});
