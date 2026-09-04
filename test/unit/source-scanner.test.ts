import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isAsciiBlank,
  isIdentifierChar,
  Scanner,
} from '../../src/source/scanner.js';

test('peek does not move the cursor; advance is monotonic', () => {
  const s = new Scanner('abc');
  assert.equal(s.pos, 0);
  assert.equal(s.peekAscii(), 'a');
  assert.equal(s.peekAscii(1), 'b');
  assert.equal(s.pos, 0);
  s.advance();
  assert.equal(s.pos, 1);
  assert.throws(() => s.advance(-1), RangeError);
});

test('honours slice bounds', () => {
  const s = new Scanner('xxABCxx', 2, 5);
  assert.equal(s.rest(), 'ABC');
  assert.equal(s.peekAscii(), 'A');
  assert.equal(s.peekUnit(3), -1);
  s.advance(10);
  assert.equal(s.pos, 5);
  assert.equal(s.atEnd, true);
  assert.throws(() => new Scanner('abc', 2, 1), RangeError);
});

test('peekCodePoint and next walk scalar values', () => {
  const s = new Scanner('a😀b');
  assert.equal(s.peekCodePoint(), 0x61);
  assert.equal(s.next(), 0x61);
  assert.equal(s.peekCodePoint(), 0x1f600);
  assert.equal(s.next(), 0x1f600);
  assert.equal(s.pos, 3); // emoji consumed two code units
  assert.equal(s.next(), 0x62);
  assert.equal(s.next(), -1);
});

test('peekAscii returns null for non-ASCII', () => {
  const s = new Scanner('é');
  assert.equal(s.peekAscii(), null);
  assert.equal(s.peekCodePoint(), 0xe9);
});

test('startsWith is an exact bounded literal match', () => {
  const s = new Scanner(':::note');
  assert.equal(s.startsWith(':::'), true);
  assert.equal(s.startsWith(':::note'), true);
  assert.equal(s.startsWith(':::notex'), false);
  const tail = new Scanner('::', 0, 2);
  assert.equal(tail.startsWith(':::'), false);
});

test('scanRun consumes a maximal ASCII run', () => {
  const s = new Scanner('###### heading');
  assert.equal(s.scanRun('#'), 6);
  assert.equal(s.peekAscii(), ' ');
  assert.equal(s.scanRun('#'), 0);
});

test('scanWhile and scanUntilUnit', () => {
  const s = new Scanner('  \tlead');
  assert.equal(s.scanWhile(isAsciiBlank), 3);
  assert.equal(s.rest(), 'lead');

  const u = new Scanner('key=value');
  assert.equal(u.scanUntilUnit(0x3d /* = */), true);
  assert.equal(u.pos, 3);
  assert.equal(u.scanUntilUnit(0x40 /* @ */), false);
  assert.equal(u.atEnd, true);
});

test('scanBalanced counts depth and honours backslash escape', () => {
  const s = new Scanner('(a (b) c)rest');
  assert.equal(s.scanBalanced(0x28, 0x29), true);
  assert.equal(s.rest(), 'rest');

  const escaped = new Scanner('(a \\) b)');
  assert.equal(escaped.scanBalanced(0x28, 0x29), true);
  assert.equal(escaped.atEnd, true);

  const unbalanced = new Scanner('(a (b)');
  assert.equal(unbalanced.scanBalanced(0x28, 0x29), false);
  assert.equal(unbalanced.atEnd, true);

  const notOpen = new Scanner('a)');
  assert.equal(notOpen.scanBalanced(0x28, 0x29), false);
  assert.equal(notOpen.pos, 0);
});

test('identifier predicate matches the shared grammar', () => {
  for (const ch of 'aZ0_-') assert.equal(isIdentifierChar(ch.charCodeAt(0)), true);
  for (const ch of ' .:{}') assert.equal(isIdentifierChar(ch.charCodeAt(0)), false);
});

test('rejects non-integer / negative offsets at every numeric entry point', () => {
  assert.throws(() => new Scanner('abc', Number.NaN, 1), RangeError);
  assert.throws(() => new Scanner('abc', 0.5, 2), RangeError);
  assert.throws(() => new Scanner('abc', -1, 2), RangeError);

  const s = new Scanner('abcdef');
  assert.throws(() => s.advance(Number.NaN), RangeError);
  assert.throws(() => s.advance(Infinity), RangeError);
  assert.throws(() => s.advance(1.5), RangeError);
  assert.throws(() => s.peekUnit(-1), RangeError);
  assert.throws(() => s.peekAscii(-2), RangeError);
  assert.throws(() => s.consumedSince(-1), RangeError);

  s.advance(2);
  assert.throws(() => s.consumedSince(5), RangeError); // ahead of the cursor
  assert.equal(s.pos, 2); // unchanged after every rejected call
});

test('primitive scanner-argument contracts are enforced', () => {
  const s = new Scanner('###');
  assert.throws(() => s.scanRun(''), RangeError);
  assert.throws(() => s.scanRun('##'), RangeError);
  assert.throws(() => s.scanRun('é'), RangeError);
  assert.throws(() => s.startsWith(''), RangeError);
  assert.throws(() => new Scanner('(a)').scanBalanced(0x28, 0x28), RangeError);
});
