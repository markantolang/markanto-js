import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isCanonicalTransport,
  normalizeTransport,
  rawOffsetProjector,
} from '../../src/source/transport.js';

test('canonical input passes through unchanged', () => {
  const { text, report } = normalizeTransport('# Title\n\nBody\n');
  assert.equal(text, '# Title\n\nBody\n');
  assert.equal(report.hadBom, false);
  assert.equal(report.crlfCount, 0);
  assert.deepEqual(report.loneCrOffsets, []);
  assert.equal(report.trailingLfCount, 1);
  assert.equal(isCanonicalTransport(report), true);
});

test('strips one leading BOM and records it', () => {
  const { text, report } = normalizeTransport('﻿# Title\n');
  assert.equal(text, '# Title\n');
  assert.equal(report.hadBom, true);
  assert.equal(isCanonicalTransport(report), false);
});

test('only the first BOM is stripped', () => {
  const { text } = normalizeTransport('﻿a﻿b\n');
  assert.equal(text, 'a﻿b\n');
});

test('collapses CRLF to LF and records each collapsed LF offset', () => {
  const { text, report } = normalizeTransport('a\r\nb\r\nc\n');
  assert.equal(text, 'a\nb\nc\n');
  assert.equal(report.crlfCount, 2);
  assert.deepEqual(report.crlfOffsets, [1, 3]); // normalised offsets of the two replacement LFs
  assert.deepEqual(report.loneCrOffsets, []);
  assert.equal(isCanonicalTransport(report), false);
});

test('rawOffsetProjector undoes the CRLF collapse; BOM and lone CR do not shift', () => {
  // fast path (no CR): identity
  const id = rawOffsetProjector(normalizeTransport('abc\n').report);
  assert.equal(id(2), 2);

  // BOM + two CRLFs. BOM is excluded from both spaces, so no BOM term.
  const { report } = normalizeTransport('﻿ab\r\ncd\r\nef\n');
  const toRaw = rawOffsetProjector(report);
  assert.deepEqual(report.crlfOffsets, [2, 5]);
  assert.equal(toRaw(0), 0); // before any CRLF
  assert.equal(toRaw(2), 2); // exactly at the first replacement LF -> points at the CR
  assert.equal(toRaw(3), 4); // just after it -> +1
  assert.equal(toRaw(6), 8); // after both -> +2

  // a lone CR is a 1:1 rewrite -> no shift
  const lone = rawOffsetProjector(normalizeTransport('a\rb\n').report);
  assert.equal(lone(3), 3);
});

test('rewrites a lone CR to LF and records its normalised offset', () => {
  const { text, report } = normalizeTransport('a\rb\n');
  assert.equal(text, 'a\nb\n');
  assert.deepEqual(report.loneCrOffsets, [1]);
});

test('lone-CR offsets are relative to the post-CRLF text', () => {
  const { text, report } = normalizeTransport('a\r\nb\rc\n');
  assert.equal(text, 'a\nb\nc\n');
  assert.equal(report.crlfCount, 1);
  assert.deepEqual(report.loneCrOffsets, [3]);
  assert.equal(text.charCodeAt(report.loneCrOffsets[0]!), 0x0a);
});

test('reports the exact trailing-LF count', () => {
  assert.equal(normalizeTransport('no newline').report.trailingLfCount, 0);
  assert.equal(normalizeTransport('one\n').report.trailingLfCount, 1);
  assert.equal(normalizeTransport('two\n\n').report.trailingLfCount, 2);
  assert.equal(normalizeTransport('blank body\n\n\n').report.trailingLfCount, 3);
  assert.equal(normalizeTransport('').report.trailingLfCount, 0);
  assert.equal(normalizeTransport('\n').report.trailingLfCount, 1);
});

test('isCanonicalTransport requires exactly one terminal LF, empty doc included', () => {
  assert.equal(isCanonicalTransport(normalizeTransport('x\n').report), true);
  assert.equal(isCanonicalTransport(normalizeTransport('x').report), false);
  assert.equal(isCanonicalTransport(normalizeTransport('x\n\n').report), false);
  // empty document canonicalises to "\n" (spec §7.4)
  assert.equal(isCanonicalTransport(normalizeTransport('').report), false);
  assert.equal(isCanonicalTransport(normalizeTransport('\n').report), true);
  assert.equal(isCanonicalTransport(normalizeTransport('\n\n').report), false);
});

test('trailing-LF count is measured after CRLF normalisation', () => {
  assert.equal(normalizeTransport('x\r\n\r\n').report.trailingLfCount, 2);
});

test('preserves tabs and non-BMP content', () => {
  const { text } = normalizeTransport('\tcol\t😀\n');
  assert.equal(text, '\tcol\t😀\n');
});
