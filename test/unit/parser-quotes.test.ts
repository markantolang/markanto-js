import assert from 'node:assert/strict';
import test from 'node:test';
import { format, parse, semanticDocumentEquals } from '../../src/index.js';
import { scanQuotePrefix } from '../../src/parser/quotes.js';
import { LineReader } from '../../src/source/index.js';

function firstCategory(source: string, strict = false): string | undefined {
  const result = parse(source, strict ? { strict: true } : {});
  return result.status === 'invalid' ? result.diagnostics[0]?.category : undefined;
}

test('quote prefix scanner reports depth, compact content, empty lines, and tabs', () => {
  for (const [source, depth, content] of [['> Text\n', 1, 2], ['>>Text\n', 2, 2], ['> >\n', 2, 3]] as const) {
    const line = new LineReader(source).current!;
    const result = scanQuotePrefix(source, line);
    assert.ok(result !== null && !('error' in result));
    if (result !== null && !('error' in result)) {
      assert.equal(result.depth, depth);
      assert.equal(result.contentStart, content);
    }
  }
  const tab = scanQuotePrefix('>\tX\n', new LineReader('>\tX\n').current!);
  assert.ok(tab !== null && 'error' in tab);
});

test('every §3.16 quote error case has the right status and diagnostic category', () => {
  // 3.1 — region begins above depth 1
  assert.equal(firstCategory('> > L2.\n'), 'syntax');
  // 3.2 — upward level jump greater than one
  assert.equal(firstCategory('> L1.\n> > > L3.\n'), 'syntax');
  // 3.3 — missing space in canonical form (strict only; normal-mode tolerated)
  assert.equal(parse('>Text\n').status, 'ok');
  assert.equal(firstCategory('>Text\n', true), 'noncanonical');
  // 3.4 — compact prefix: `>>` alone is a depth-2 start (3.1); the compact form
  // at a valid depth is normal-mode tolerated, strict-mode noncanonical.
  assert.equal(firstCategory('>> Text\n'), 'syntax');
  assert.equal(parse('> L1.\n>> L2.\n').status, 'ok');
  assert.equal(firstCategory('> L1.\n>> L2.\n', true), 'noncanonical');
  // 3.5 — an unmarked continuation line ends the region; both blocks are valid
  const lazy = parse('> Quote line.\nContinuation.\n');
  assert.equal(lazy.status, 'ok');
  if (lazy.status === 'ok') {
    assert.deepEqual(lazy.document.children.map((child) => child.type), ['quoteRegion', 'paragraph']);
  }
  // 3.6 — a deeper empty quote line opens a new level
  assert.equal(firstCategory('> Text.\n> >\n'), 'syntax');
  // 3.8 — a code fence that loses its prefix is an unclosed fence
  assert.equal(firstCategory('> ```js\nx()\n> ```\n'), 'syntax');
  // 3.9 — tab in the prefix
  assert.equal(firstCategory('>\tText\n'), 'syntax');
});

test('a container inside a quote is a semantic error', () => {
  const container = parse('> ::: Warning\n> Content.\n> :::\n');
  assert.equal(container.status, 'invalid');
  if (container.status === 'invalid') assert.equal(container.diagnostics[0]?.category, 'semantic');
});

test('an empty quote line separates two paragraphs at the same depth into two QuoteBlocks', () => {
  const parsed = parse('> First.\n>\n> Second.\n');
  assert.equal(parsed.status, 'ok');
  if (parsed.status !== 'ok') return;
  const region = parsed.document.children[0]!;
  assert.equal(region.type, 'quoteRegion');
  if (region.type !== 'quoteRegion') return;
  assert.equal(region.children.length, 2);
  assert.deepEqual(region.children.map((entry) => [entry.level, entry.block.type]), [[1, 'paragraph'], [1, 'paragraph']]);
});

test('a quote delegates a code fence and a block resource to the ordinary block parser', () => {
  for (const [source, innerType] of [
    ['> ```js\n> x()\n> ```\n', 'codeBlock'],
    ['> <m video>[Video](film.mp4)</m>\n', 'videoBlock'],
  ] as const) {
    const parsed = parse(source);
    assert.equal(parsed.status, 'ok', source);
    if (parsed.status !== 'ok') continue;
    const region = parsed.document.children[0]!;
    assert.equal(region.type, 'quoteRegion');
    if (region.type !== 'quoteRegion') continue;
    assert.equal(region.children[0]!.block.type, innerType);
    const formatted = format(parsed.document);
    assert.equal(formatted.status, 'ok');
    if (formatted.status !== 'ok') continue;
    const roundtrip = parse(formatted.source, { strict: true });
    assert.equal(roundtrip.status, 'ok');
    if (roundtrip.status === 'ok') {
      assert.deepEqual(semanticDocumentEquals(roundtrip.document, parsed.document), { status: 'ok', equal: true });
    }
  }
});

test('the logical-line projector maps quote content annotations back to the original source', () => {
  const source = '> a\n> b\n';
  const parsed = parse(source);
  assert.equal(parsed.status, 'ok');
  if (parsed.status !== 'ok') return;
  const region = parsed.document.children[0]!;
  assert.equal(region.type, 'quoteRegion');
  if (region.type !== 'quoteRegion') return;
  const paragraph = region.children[0]!.block;
  const annotation = parsed.annotations.forNode(paragraph);
  assert.ok(annotation !== undefined);
  if (annotation === undefined) return;
  // The paragraph spans both physical lines; its source slice therefore
  // includes the `> ` prefix of the continuation line (original coordinates,
  // not the prefix-stripped virtual text).
  assert.equal(source.slice(annotation.range.start.offset, annotation.range.end.offset), 'a\n> b');
});

test('quote attribution and quote-region IDs; blank separation prevents attachment', () => {
  const attributed = parse('> ```js\n> x()\n> ```\n-- *Author*\n{#q}\n');
  assert.equal(attributed.status, 'ok');
  if (attributed.status === 'ok') {
    const region = attributed.document.children[0]!;
    assert.equal(region.type, 'quoteRegion');
    if (region.type === 'quoteRegion') {
      assert.equal(region.id, 'q');
      assert.equal(region.attribution?.[0]?.type, 'em');
      assert.equal(attributed.annotations.forNode(region)?.range.start.offset, 0);
    }
  }
  const separated = parse('> Quote.\n\n-- Author\n');
  assert.equal(separated.status, 'ok');
  if (separated.status === 'ok') {
    assert.deepEqual(separated.document.children.map((child) => child.type), ['quoteRegion', 'paragraph']);
  }
});
