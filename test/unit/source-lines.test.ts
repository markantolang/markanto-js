import test from 'node:test';
import assert from 'node:assert/strict';

import { LineReader } from '../../src/source/lines.js';

test('splits physical lines with offsets and terminator info', () => {
  const reader = new LineReader('a\nbb\n\nc');
  assert.equal(reader.lineCount, 4);

  const first = reader.advance()!;
  assert.deepEqual(
    { ...first },
    { number: 1, start: 0, contentEnd: 1, end: 2, terminated: true },
  );
  assert.equal(reader.contentOf(first), 'a');

  const second = reader.advance()!;
  assert.equal(reader.contentOf(second), 'bb');
  assert.equal(second.terminated, true);

  const blank = reader.advance()!;
  assert.equal(reader.isBlank(blank), true);
  assert.equal(reader.contentOf(blank), '');

  const last = reader.advance()!;
  assert.equal(last.terminated, false);
  assert.equal(reader.contentOf(last), 'c');

  assert.equal(reader.advance(), null);
  assert.equal(reader.atEnd, true);
});

test('a trailing newline does not create a trailing empty line', () => {
  const reader = new LineReader('x\n');
  assert.equal(reader.lineCount, 1);
  assert.equal(reader.contentOf(reader.current!), 'x');
});

test('empty input has no lines', () => {
  const reader = new LineReader('');
  assert.equal(reader.lineCount, 0);
  assert.equal(reader.current, null);
  assert.equal(reader.atEnd, true);
});

test('peek does not advance and is bounded', () => {
  const reader = new LineReader('1\n2\n3\n');
  assert.equal(reader.contentOf(reader.peek(0)!), '1');
  assert.equal(reader.contentOf(reader.peek(1)!), '2');
  assert.equal(reader.contentOf(reader.peek(2)!), '3');
  assert.equal(reader.peek(3), null);
  assert.equal(reader.contentOf(reader.current!), '1');
});

test('peek rejects negative or non-integer lookahead', () => {
  const reader = new LineReader('1\n2\n');
  assert.throws(() => reader.peek(-1), RangeError);
  assert.throws(() => reader.peek(1.5), RangeError);
  assert.throws(() => reader.peek(Number.NaN), RangeError);
});

test('whitespace-only detection distinguishes blank from spaces/tabs', () => {
  const reader = new LineReader('  \n\t\nx \n');
  const spaces = reader.advance()!;
  assert.equal(reader.isBlank(spaces), false);
  assert.equal(reader.isWhitespaceOnly(spaces), true);

  const tab = reader.advance()!;
  assert.equal(reader.isWhitespaceOnly(tab), true);

  const withText = reader.advance()!;
  assert.equal(reader.isWhitespaceOnly(withText), false);
});
