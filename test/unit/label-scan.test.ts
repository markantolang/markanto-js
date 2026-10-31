import assert from 'node:assert/strict';
import test from 'node:test';

import { parse } from '../../src/index.js';

// A search for a label's end that started over at each `[` took twice as long for each one more: forty of them in a
// document never ended. Forward-only scanning (AGENTS.md) is what makes this input cheap.
test('open brackets end at once, however many there are', () => {
  for (const text of ['['.repeat(64), '!['.repeat(64), `${'['.repeat(64)}x`, `${'[['.repeat(64)}a]`]) {
    assert.equal(parse(text).status, 'ok');
  }
});

test('a label still sees the complete links inside it, and only those', () => {
  assert.equal(parse('[a [b](u) c](v)').status, 'invalid');
  assert.match(JSON.stringify(parse('[a [b] c](v)')), /"type":"text","value":"\[a \[b\] c\]\(v\)"/);
  assert.match(JSON.stringify(parse('![^a](u)')), /"type":"imageBlock","src":"u"/);
});
