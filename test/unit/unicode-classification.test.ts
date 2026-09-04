import assert from 'node:assert/strict';
import test from 'node:test';

import { parse } from '../../src/index.js';
import { characterClass, isUnicodeWhitespace } from '../../src/parser/inline/unicode.js';

test('Unicode 15.1 symbols flank emphasis as punctuation', () => {
  const parsed = parse('©*x*\n', { strict: true });
  assert.equal(parsed.status, 'ok');
  if (parsed.status !== 'ok') return;
  assert.deepEqual(parsed.document.children[0], {
    type: 'paragraph',
    children: [
      { type: 'text', value: '©' },
      { type: 'em', children: [{ type: 'text', value: 'x' }] },
    ],
  });
  for (const value of ['©', '×', '÷', '§', '¶', '•']) {
    assert.equal(characterClass(value.codePointAt(0)!), 'P', value);
  }
});

test('Unicode 15.1 W/P/S boundaries follow L-star, Nd, underscore, and White_Space', () => {
  for (const value of ['A', '9', '_', 'Ж', '界', '𐐀']) {
    assert.equal(characterClass(value.codePointAt(0)!), 'W', value);
  }
  for (const value of ['½', 'Ⅷ', '\u0301']) {
    assert.equal(characterClass(value.codePointAt(0)!), 'P', value);
  }
  for (const value of ['\u00a0', '\u2028']) {
    const code = value.codePointAt(0)!;
    assert.equal(characterClass(code), 'S', value);
    assert.equal(isUnicodeWhitespace(code), true, value);
  }
  assert.equal(characterClass(-1), 'S', 'line boundary sentinel');
});
