import assert from 'node:assert/strict';
import test from 'node:test';

import type { Document } from '../../src/ast.js';
import { format, parse } from '../../src/index.js';

test('non-ATX hash runs remain literal paragraphs', () => {
  for (const source of ['###x\n', '####### Heading\n']) {
    const result = parse(source);
    assert.equal(result.status, 'ok');
    if (result.status === 'ok') assert.equal(result.document.children[0]?.type, 'paragraph');
  }
});

test('a closing-hash-only heading remains an empty-heading syntax error', () => {
  assert.equal(parse('## ##\n').status, 'invalid');
});

test('a non-trailing same-line id shape remains literal heading content', () => {
  const result = parse('# x {#a} tail\n');
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') assert.deepEqual(result.document.children[0], {
    type: 'heading', level: 1, children: [{ type: 'text', value: 'x {#a} tail' }],
  });
});

test('a longer matching fence closes a code block', () => {
  const result = parse('```js\nx\n`````\n');
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') assert.deepEqual(result.document.children[0], { type: 'codeBlock', lang: 'js', value: 'x' });
});

test('minimal paragraph scanner distinguishes soft and tolerated hard breaks', () => {
  const result = parse('a\nb\\\nc  \nd\n');
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  const paragraph = result.document.children[0];
  assert.equal(paragraph?.type, 'paragraph');
  if (paragraph?.type === 'paragraph') {
    assert.deepEqual(paragraph.children.map((child) => child.type), [
      'text', 'softBreak', 'text', 'hardBreak', 'text', 'hardBreak', 'text',
    ]);
  }
});

test('an even terminal backslash run is one escaped literal backslash', () => {
  const result = parse('a\\\\\n');
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') {
    const paragraph = result.document.children[0];
    assert.equal(paragraph?.type, 'paragraph');
    if (paragraph?.type === 'paragraph') assert.deepEqual(paragraph.children, [{ type: 'text', value: 'a\\' }]);
  }
});

test('one trailing trivia space does not hide a backslash hard-break carrier', () => {
  const result = parse('a\\ \nb\n');
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') {
    const paragraph = result.document.children[0];
    assert.equal(paragraph?.type, 'paragraph');
    if (paragraph?.type === 'paragraph') assert.equal(paragraph.children[1]?.type, 'hardBreak');
  }
});

test('source whitespace before a footnote reference is discarded as trivia', () => {
  const result = parse('sentence. \t [^note]\n\n[^note]: n.\n');
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  const paragraph = result.document.children[0];
  assert.equal(paragraph?.type, 'paragraph');
  if (paragraph?.type === 'paragraph') assert.deepEqual(paragraph.children, [
    { type: 'text', value: 'sentence.' },
    { type: 'footnoteReference', identifier: 'note' },
  ]);
});

test('a comment starts a local block boundary without a blank line', () => {
  const result = parse('text\n<!-- note -->\n');
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') assert.deepEqual(result.document.children.map((block) => block.type), ['paragraph', 'commentBlock']);
});

test('a quote interrupts a paragraph without a blank line (M1, §2.5)', () => {
  for (const source of ['P.\n> Q.\n', 'a\nb\n> Q.\n', 'P.\n>Q.\n']) {
    const result = parse(source);
    assert.equal(result.status, 'ok', source);
    if (result.status === 'ok') {
      assert.deepEqual(result.document.children.map((b) => b.type), ['paragraph', 'quoteRegion'], source);
    }
  }
});

test('a typed lined-container header interrupts a paragraph without a blank line (M1, §2.5)', () => {
  for (const source of ['P.\nExkurs\n___\n\nC\n___\n', 'a\nb\nExkurs T\n___\n\nC\n___\n']) {
    const result = parse(source);
    assert.equal(result.status, 'ok', source);
    if (result.status === 'ok') {
      assert.deepEqual(result.document.children.map((b) => b.type), ['paragraph', 'container'], source);
      const container = result.document.children[1];
      assert.ok(container?.type === 'container' && container.form === 'lined');
    }
  }
  // A plain multi-line paragraph is not split by an ordinary trailing line.
  const plain = parse('plain para\ncontinues here\nand here\n');
  assert.equal(plain.status, 'ok');
  if (plain.status === 'ok') assert.equal(plain.document.children.length, 1);
});

test('resource budgets return resource without a tree', () => {
  assert.equal(parse('abc\n', { resourceBudget: { maxSourceBytes: 3 } }).status, 'resource');
  assert.equal(parse('abc\n', { resourceBudget: { maxNodes: 1 } }).status, 'resource');
});

test('maxSourceBytes is measured in UTF-8 bytes, not UTF-16 code units (M4)', () => {
  // `é\n` is 3 UTF-8 bytes (2 code units); `😀\n` is 5 bytes (3 code units).
  assert.equal(parse('é\n', { resourceBudget: { maxSourceBytes: 2 } }).status, 'resource');
  assert.equal(parse('é\n', { resourceBudget: { maxSourceBytes: 3 } }).status, 'ok');
  assert.equal(parse('😀\n', { resourceBudget: { maxSourceBytes: 4 } }).status, 'resource');
  assert.equal(parse('😀\n', { resourceBudget: { maxSourceBytes: 5 } }).status, 'ok');
});

test('maxMatrixSlots bounds a parsed Grid occupancy matrix (M4)', () => {
  const grid = ':::\na\n--\nb\n:::\n'; // one 2x1 Grid = 2 slots
  assert.equal(parse(grid, { resourceBudget: { maxMatrixSlots: 1 } }).status, 'resource');
  assert.equal(parse(grid, { resourceBudget: { maxMatrixSlots: 2 } }).status, 'ok');
});

test('a new block indented four or more spaces is prose with an advisory, not silent (M5, §1.2)', () => {
  const hasIndentAdvisory = (source: string): boolean => {
    const result = parse(source);
    return result.status === 'ok'
      && result.diagnostics.some((d) => d.category === 'advisory' && d.severity === 'warning' && /indentation/u.test(d.message ?? ""));
  };
  // CommonMark would make each of these an indented code block; Markanto keeps
  // the prose (indentation dropped) and warns.
  assert.ok(hasIndentAdvisory('para\n\n    code line\n'), '4 spaces after a blank line');
  assert.ok(hasIndentAdvisory('      first line\n'), '6 spaces at document start');
  assert.ok(hasIndentAdvisory('- x\n\n      y\n'), 'a list continuation that pops out to the document');
  // strict mode rejects the same input as noncanonical (the surface is not stable)
  assert.equal(parse('para\n\n    code line\n', { strict: true }).status, 'invalid');
  // no advisory for legitimate surfaces
  for (const clean of ['a\n  b\n', 'a\n    b\n', 'para\n\n   three\n', '- a\n\n  more\n', '```\n    x\n```\n', 'x\n\ny\n']) {
    const result = parse(clean);
    assert.ok(
      result.status === 'ok' && !result.diagnostics.some((d) => d.category === 'advisory' && /indentation/u.test(d.message ?? "")),
      `no advisory for ${JSON.stringify(clean)}`,
    );
  }
});

test('lone CR is syntax-invalid and can produce an annotated recovery tree', () => {
  assert.equal(parse('a\rb\n').status, 'invalid');
  const result = parse('a\rb\n', { errorRecovery: true });
  assert.equal(result.status, 'invalid');
  if (result.status === 'invalid' && result.recovery !== undefined) {
    assert.equal(result.recovery.children[0]?.type, 'errorBlock');
    assert.equal(result.annotations.has(result.recovery.children[0]!), true);
  }
});

test('a lone UTF-16 surrogate is invalid transport in every mode (B2)', () => {
  for (const source of ['\ud800\n', 'a\udc00b\n', 'ok\n\ud834 broken\n', '\ud83d\n']) {
    assert.equal(parse(source).status, 'invalid', JSON.stringify(source));
    assert.equal(parse(source, { strict: true }).status, 'invalid', JSON.stringify(source));
    const recovered = parse(source, { errorRecovery: true });
    assert.equal(recovered.status, 'invalid');
    if (recovered.status === 'invalid') {
      assert.ok(recovered.diagnostics.some((d) => d.message?.includes('surrogate') === true));
    }
  }
  // A well-formed astral character (surrogate pair) is fine.
  assert.equal(parse('😀\n').status, 'ok');
});

test('every Phase-1 syntax family has deterministic recovery', () => {
  const sources = [
    '##\n', '-*-\n', '```js extra\nx\n```\n', '```\nx\n',
    '<!-- x\n', '<!-- x --> visible\n', 'Heading\n===\n', 'p\n{id: p}\n',
  ];
  for (const source of sources) {
    const result = parse(source, { errorRecovery: true });
    assert.equal(result.status, 'invalid', source);
    if (result.status === 'invalid' && result.recovery !== undefined) {
      assert.equal(result.recovery.children.some((node) => node.type === 'errorBlock'), true, source);
    }
  }
});

test('recovery children remain in source order and fenced failures consume their body', () => {
  const result = parse('before\n\n```js extra\n# not a heading\n```\n\nafter\n', { errorRecovery: true });
  assert.equal(result.status, 'invalid');
  if (result.status === 'invalid' && result.recovery !== undefined) {
    assert.deepEqual(result.recovery.children.map((node) => node.type), ['paragraph', 'errorBlock', 'paragraph']);
  }
});

test('strict noncanonical input stays bare-invalid even with recovery requested', () => {
  const result = parse('***\n', { strict: true, errorRecovery: true });
  assert.equal(result.status, 'invalid');
  if (result.status === 'invalid') assert.equal(result.recovery, undefined);
  assert.equal(result.diagnostics[0]?.category, 'noncanonical');
});

test('normal mode converges BOM and CRLF while strict mode rejects them as noncanonical', () => {
  for (const source of ['\ufeff# A\n', '# A\r\n']) {
    assert.equal(parse(source).status, 'ok');
    const strict = parse(source, { strict: true, errorRecovery: true });
    assert.equal(strict.status, 'invalid');
    assert.equal(strict.diagnostics[0]?.category, 'noncanonical');
    if (strict.status === 'invalid') assert.equal(strict.recovery, undefined);
  }
});

test('formatter rejects checkable invalid Phase-1 ASTs without throwing', () => {
  const documents: Document[] = [
    { type: 'document', children: [{ type: 'heading', level: 1, children: [] as never }], footnotes: [] },
    { type: 'document', children: [{ type: 'codeBlock', lang: 'math', value: '' }], footnotes: [] },
    { type: 'document', children: [{ type: 'codeBlock', lang: 'js\u00a0x', value: '' }], footnotes: [] },
    { type: 'document', children: [{ type: 'commentBlock', value: 'x-->y' }], footnotes: [] },
    { type: 'document', children: [{ type: 'paragraph', children: [{ type: 'text', value: '' }] }], footnotes: [] },
    { type: 'document', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'x' }, { type: 'softBreak' }] }], footnotes: [] },
    { type: 'document', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'x' }, { type: 'hardBreak' }] }], footnotes: [] },
  ];
  for (const document of documents) assert.equal(format(document).status, 'invalid');
});

test('a terminal backslash is literal and round-trips strictly', () => {
  const parsed = parse('a\\\n');
  assert.equal(parsed.status, 'ok');
  if (parsed.status !== 'ok') return;
  const formatted = format(parsed.document);
  assert.deepEqual(formatted, { status: 'ok', source: 'a\\\n', diagnostics: [] });
  assert.equal(parse('a\\\n', { strict: true }).status, 'ok');
});

test('parse() rejects a document-wide duplicate block id (F-2, spec §6.1)', () => {
  for (const source of [
    '# One {#same}\n\n# Two {#same}\n',            // two headings
    '::: A\nx\n:::\n{#d}\n\n::: B\ny\n:::\n{#d}\n', // two containers
    '# H {#h}\n\nR.[^a]\n\n[^a]: n.\n{#h}\n',       // heading vs footnote definition
  ]) {
    const result = parse(source);
    assert.equal(result.status, 'invalid', source);
    if (result.status === 'invalid') {
      assert.equal(result.diagnostics[0]?.category, 'semantic');
      assert.match(result.diagnostics[0]?.message ?? '', /duplicate block id/u);
    }
  }
  assert.equal(parse('# a {#x}\n\n# b {#y}\n').status, 'ok');
});
