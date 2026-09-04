import test from 'node:test';
import assert from 'node:assert/strict';

import { codePointCount, LineMap } from '../../src/source/position.js';

test('maps offsets to 1-based line/column', () => {
  const map = new LineMap('ab\ncde\n\nf');
  assert.deepEqual(map.pointAt(0), { line: 1, column: 1, offset: 0 });
  assert.deepEqual(map.pointAt(2), { line: 1, column: 3, offset: 2 });
  // first char of line 2
  assert.equal(map.pointAt(3).line, 2);
  assert.equal(map.pointAt(3).column, 1);
  // the blank line 3
  assert.equal(map.pointAt(7).line, 3);
  assert.equal(map.pointAt(7).column, 1);
  // last char, line 4
  assert.equal(map.pointAt(8).line, 4);
  assert.equal(map.pointAt(8).column, 1);
});

test('column counts scalar values, not UTF-16 code units', () => {
  const map = new LineMap('a😀b\n');
  // '😀' is two code units; 'b' is at code-unit offset 3
  assert.equal(map.pointAt(3).column, 3);
  assert.equal(map.pointAt(3).line, 1);
});

test('clamps out-of-range offsets', () => {
  const map = new LineMap('abc\n');
  assert.equal(map.pointAt(-5).offset, 0);
  assert.equal(map.pointAt(999).offset, 4);
});

test('lineStart and spanAt', () => {
  const map = new LineMap('one\ntwo\n');
  assert.equal(map.lineCount, 3); // trailing LF opens a third (empty) line start
  assert.equal(map.lineStart(1), 0);
  assert.equal(map.lineStart(2), 4);
  assert.equal(map.lineStart(3), 8);
  assert.equal(map.lineStart(4), -1);
  const span = map.spanAt(0, 3);
  assert.deepEqual(span.start, { line: 1, column: 1, offset: 0 });
  assert.deepEqual(span.end, { line: 1, column: 4, offset: 3 });
});

test('recognises LF, CRLF and lone CR as physical line terminators', () => {
  // lone CR
  const cr = new LineMap('a\rb\rc');
  assert.equal(cr.lineCount, 3);
  assert.equal(cr.pointAt(2).line, 2);
  assert.equal(cr.pointAt(2).column, 1);

  // CRLF is one terminator
  const crlf = new LineMap('a\r\nbb\r\n');
  assert.equal(crlf.lineCount, 3); // trailing CRLF opens a third line start
  assert.equal(crlf.pointAt(3).line, 2); // 'b' after the first CRLF
  assert.equal(crlf.pointAt(3).column, 1);
  assert.equal(crlf.lineStart(2), 3);

  // mixed
  const mixed = new LineMap('x\ny\r\nz\r');
  assert.equal(mixed.pointAt(2).line, 2); // 'y'
  assert.equal(mixed.pointAt(5).line, 3); // 'z'
});

test('codePointCount handles surrogate pairs and lone surrogates', () => {
  assert.equal(codePointCount('a😀b', 0, 4), 3);
  assert.equal(codePointCount('😀', 0, 2), 1);
  // lone high surrogate counts as one scalar position
  assert.equal(codePointCount('\uD800x', 0, 2), 2);
});
