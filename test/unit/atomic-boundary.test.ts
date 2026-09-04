import assert from 'node:assert/strict';
import test from 'node:test';

import { createSourceAnnotationBuilder } from '../../src/parser-contract.js';
import { atomicTokenEnd } from '../../src/parser/inline/atomic.js';
import { parseInline } from '../../src/parser/inline/scanner.js';
import { openSource } from '../../src/source/index.js';

/**
 * `atomicTokenEnd` (used by the pipe-table row tokenizer) must agree with the
 * inline scanner on where an atomic inline token ends — otherwise a `|` inside
 * a link / code span / `<m>` wrapper could be a column delimiter for one and
 * not the other. This pins the two together.
 */

/** Where the inline scanner's first produced node ends, in source offsets. */
function scannerFirstTokenEnd(text: string): { end: number; nodeCount: number; ok: boolean } {
  const source = openSource(text);
  const builder = createSourceAnnotationBuilder(source);
  const result = parseInline(source.text, 0, source.text.length, builder);
  if (result.status !== 'ok' || result.nodes.length === 0) return { end: -1, nodeCount: 0, ok: false };
  const sealed = builder.seal();
  const annotation = sealed.forNode(result.nodes[0]!);
  return { end: annotation?.range.end.offset ?? -1, nodeCount: result.nodes.length, ok: true };
}

/** Strings that are exactly one atomic inline token the scanner also accepts. */
const ATOMIC = [
  '`code`',
  '`a|b`',
  '``a`b``',
  '$`x + y`$',
  '[label](url)',
  '[a|b](url)',
  '[t](/x?a|b)',
  '[t](/x "ti|tle")',
  '![alt](img.png)',
  '![a|b](img.png)',
  '<https://example.com/a|b>',
  '<a@b.com>',
  '<i>emph|asis</i>',
  '<b>str|ong</b>',
  '<m lang=en>content|here</m>',
  '<m data-x="p|q">z</m>',
  '<m data-x="</m>|x">z</m>',
  '<m download>[t](d.zip)</m>',
  '[^note-1]',
  'https://example.com/path|segment',
];

for (const token of ATOMIC) {
  test(`atomic token: ${JSON.stringify(token)}`, () => {
    assert.equal(atomicTokenEnd(token, 0, token.length, false), token.length, 'atomicTokenEnd covers the whole token');

    // Space-separated tail: the scanner must consume exactly the token first.
    const withTail = `${token} x`;
    const scanner = scannerFirstTokenEnd(withTail);
    assert.equal(scanner.ok, true, 'scanner accepts the token');
    assert.equal(scanner.end, token.length, 'scanner and atomicTokenEnd agree on the token end');
    assert.equal(atomicTokenEnd(withTail, 0, withTail.length, false), token.length, 'atomicTokenEnd stops at the token end');
  });
}

/**
 * Surface-complete tokens whose *content* is semantically invalid inline
 * (typed resource block-only, nested anchor, same-kind wrapper nesting). The
 * scanner rejects them, but the boundary is still well defined — a `|` inside
 * must not become a table column delimiter.
 */
const SURFACE_ATOMIC = [
  '<m video>[t](v.mp4)</m>',
  '<m audio>[t](a|b.mp3)</m>',
  '[outer [inner](in) end](out)',
  '<i>a <i>b</i> c</i>',
];

for (const token of SURFACE_ATOMIC) {
  test(`surface-atomic wrapper: ${JSON.stringify(token)}`, () => {
    assert.equal(atomicTokenEnd(token, 0, token.length, false), token.length);
    assert.equal(atomicTokenEnd(`${token}|z`, 0, token.length + 2, false), token.length);
  });
}

/** Strings where no atomic token begins at offset 0. */
const NOT_ATOMIC = [
  '`unclosed',
  '[label](unbalanced',
  '[label] not a link',
  '<https://has space>',
  '<not-an-autolink>',
  '<a|b@c.de>',            // `|` is not in the email autolink alphabet (M1)
  '[x](a b)',         // NBSP breaks the bare destination, same as the scanner (M1)
  '<m lang=en>unclosed',
  'plain text',
  '*emphasis*',
];

for (const value of NOT_ATOMIC) {
  test(`not an atomic token: ${JSON.stringify(value)}`, () => {
    assert.equal(atomicTokenEnd(value, 0, value.length, false), 0);
  });
}

test('a bare URL only autolinks when not glued to a preceding word character', () => {
  const text = 'xhttps://example.com/a';
  assert.equal(atomicTokenEnd(text, 1, text.length, true), 1);
  assert.equal(atomicTokenEnd(text, 1, text.length, false), text.length);
});

test('cross-check over a generated inline corpus', () => {
  const words = ['a', 'b|c', 'de', 'f g'];
  const tokens = [
    (w: string) => `\`${w}\``,
    (w: string) => `[${w}](/u?x=${w})`,
    (w: string) => `![${w}](/i)`,
    (w: string) => `<i>${w}</i>`,
    (w: string) => `<m lang=en>${w}</m>`,
    (w: string) => `<m data-k="${w}">${w}</m>`,
  ];
  for (const make of tokens) {
    for (const w of words) {
      const token = make(w);
      const withTail = `${token} rest`;
      const scanner = scannerFirstTokenEnd(withTail);
      if (!scanner.ok) continue;
      assert.equal(
        atomicTokenEnd(withTail, 0, withTail.length, false),
        scanner.end,
        `disagreement on ${JSON.stringify(token)}`,
      );
    }
  }
});
