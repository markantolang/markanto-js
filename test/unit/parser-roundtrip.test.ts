import assert from 'node:assert/strict';
import test from 'node:test';

import { format, parse, semanticDocumentEquals } from '../../src/index.js';

/**
 * Deterministic Phase-1 closure check. A seeded generator composes Phase-1
 * documents from valid and tolerated block forms and asserts the four laws of
 * spec §7.2 hold for each:
 *
 *  1. `parse(format(ast))` reproduces the same semantic AST;
 *  2. `format` is byte-idempotent;
 *  3. all tolerated surfaces converge on the canonical surface (checked via
 *     strict acceptance of `format` output);
 *  4. `format` output is valid strict input.
 *
 * This replaces the "5,000 adversarial round-trips" mentioned in the Phase-1
 * report, which had no committed test. 600 cases is ample for the Phase-1
 * grammar; the seed is fixed so failures are reproducible.
 */

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'value', 'note', 'text', 'item'];

/** Block templates. Each returns a chunk that ends WITHOUT a trailing LF. */
const BLOCKS: ReadonlyArray<(r: () => number) => string> = [
  (r) => `${'#'.repeat(1 + Math.floor(r() * 6))} ${word(r)} ${word(r)}`,
  (r) => `## ${word(r)} ##`, // tolerated closing hashes
  (r) => `${word(r)} ${word(r)}\n${word(r)}`, // soft break
  (r) => `${word(r)}\\\n${word(r)}`, // hard break (backslash)
  (r) => `${word(r)}  \n${word(r)}`, // tolerated hard break (two spaces)
  () => '---',
  () => '* * *', // tolerated HR
  () => '------', // tolerated HR
  (r) => `--- {#${id(r)}}`,
  (r) => `\`\`\`${r() < 0.5 ? 'js' : ''}\n${word(r)}\n\`\`\``,
  (r) => `\`\`\`\`\n\`\`\`\n\`\`\`\``, // content contains a backtick run
  (r) => `\`\`\`\n${word(r)}\n\n${word(r)}\n\`\`\``, // internal blank line
  (r) => `\`\`\`math\n${word(r)}\n\`\`\``,
  (r) => `~~~\n${word(r)}\n~~~`, // tolerated tilde fence
  (r) => `<!-- ${word(r)} -->`,
  (r) => `<!-- ${word(r)}\n${word(r)} -->`,
  (r) => `  <!-- ${word(r)} -->`, // tolerated leading spaces
];

/** Blocks that may carry a next-line {#id}. */
const ID_ELIGIBLE = new Set([2, 3, 4, 9, 10, 11, 12, 13]);

function word(r: () => number): string {
  return WORDS[Math.floor(r() * WORDS.length)]!;
}
function id(r: () => number): string {
  return `${word(r)}-${Math.floor(r() * 1000)}`;
}

function generate(r: () => number): string {
  const count = 1 + Math.floor(r() * 4);
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const index = Math.floor(r() * BLOCKS.length);
    let chunk = BLOCKS[index]!(r);
    if (ID_ELIGIBLE.has(index) && r() < 0.3) chunk += `\n{#${id(r)}}`;
    parts.push(chunk);
  }
  // one blank line between siblings, exactly one terminating LF
  return `${parts.join('\n\n')}\n`;
}

test('Phase-1 generated documents satisfy the four canonical laws', () => {
  const r = mulberry32(0xc0ffee);
  for (let n = 0; n < 600; n += 1) {
    const source = generate(r);

    const first = parse(source);
    assert.equal(first.status, 'ok', `#${n} parse normal: ${JSON.stringify(source)}`);
    if (first.status !== 'ok') continue;

    const formatted = format(first.document);
    assert.equal(formatted.status, 'ok', `#${n} format: ${JSON.stringify(source)}`);
    if (formatted.status !== 'ok') continue;

    // Law 4: canonical output is valid strict input.
    const strict = parse(formatted.source, { strict: true });
    assert.equal(
      strict.status,
      'ok',
      `#${n} strict rejects own canonical ${JSON.stringify(formatted.source)}: ${
        strict.status === 'invalid' ? strict.diagnostics[0]?.message : strict.status
      }`,
    );
    if (strict.status !== 'ok') continue;

    // Law 1: semantic round-trip.
    const eq = semanticDocumentEquals(first.document, strict.document);
    assert.equal(eq.status === 'ok' && eq.equal, true, `#${n} semantic drift: ${JSON.stringify(source)}`);

    // Law 2: formatter idempotence.
    const again = format(strict.document);
    assert.equal(again.status === 'ok' && again.source, formatted.source, `#${n} not idempotent`);

    // Law 3: a fresh normal parse of the canonical form is also stable.
    const reNormal = parse(formatted.source);
    assert.equal(reNormal.status, 'ok', `#${n} canonical fails normal parse`);
    if (reNormal.status === 'ok') {
      const eq2 = semanticDocumentEquals(strict.document, reNormal.document);
      assert.equal(eq2.status === 'ok' && eq2.equal, true, `#${n} normal/strict AST diverge on canonical`);
    }
  }
});
