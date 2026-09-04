import assert from 'node:assert/strict';
import test from 'node:test';

import type { Document } from '../../src/ast.js';
import { format, parse, semanticDocumentEquals, validate } from '../../src/index.js';

const CASES = [
  ['em', '*foo\nbar*', 'em'],
  ['strong', '**foo\nbar**', 'strong'],
  ['MIB em', '<i>foo\nbar</i>', 'em'],
  ['MIB strong', '<b>foo\nbar</b>', 'strong'],
  ['metadata', '<m lang=de>foo\nbar</m>', 'metadataSpan'],
  ['deletion', '~~foo\nbar~~', 'deletion'],
  ['link label', '[foo\nbar](/target)', 'link'],
  ['image alt', 'before ![foo\nbar](/target) after', 'inlineImage'],
] as const;

for (const [name, source, type] of CASES) {
  test(`${name} preserves a paragraph SoftBreak and round-trips strictly`, () => {
    const parsed = parse(source);
    assert.equal(parsed.status, 'ok');
    if (parsed.status !== 'ok') return;
    const paragraph = parsed.document.children[0];
    assert.equal(paragraph?.type, 'paragraph');
    if (paragraph?.type !== 'paragraph') return;
    const span = paragraph.children.find((node) => node.type === type);
    assert.ok(span);
    const nested = span.type === 'inlineImage' ? span.alt : 'children' in span ? span.children : undefined;
    assert.ok(nested);
    assert.deepEqual(nested.map((node) => node.type), ['text', 'softBreak', 'text']);
    const formatted = format(parsed.document);
    assert.equal(formatted.status, 'ok');
    if (formatted.status !== 'ok') return;
    const strict = parse(formatted.source, { strict: true });
    assert.equal(strict.status, 'ok');
    if (strict.status === 'ok') assert.deepEqual(semanticDocumentEquals(parsed.document, strict.document), { status: 'ok', equal: true });
  });
}

test('multiline inline code collapses each SoftBreak to a space and formats on one line', () => {
  const parsed = parse('before `cargo\nfix` after');
  assert.equal(parsed.status, 'ok');
  if (parsed.status !== 'ok') return;
  const paragraph = parsed.document.children[0];
  assert.equal(paragraph?.type, 'paragraph');
  if (paragraph?.type !== 'paragraph') return;
  assert.deepEqual(paragraph.children[1], { type: 'inlineCode', value: 'cargo fix' });
  assert.deepEqual(format(parsed.document), { status: 'ok', source: 'before `cargo fix` after\n', diagnostics: [] });
});

test('directly constructed multiline span ASTs satisfy format/strict-parse equality', () => {
  const nested = () => [{ type: 'text', value: 'foo' }, { type: 'softBreak' }, { type: 'text', value: 'bar' }] as const;
  const spans = [
    { type: 'em', children: nested() },
    { type: 'strong', children: nested() },
    { type: 'deletion', children: nested() },
    { type: 'metadataSpan', attrs: { lang: 'de' }, children: nested() },
    { type: 'link', href: '/x', children: nested() },
    { type: 'inlineImage', src: '/x', alt: nested() },
  ];
  for (const span of spans) {
    const document = {
      type: 'document', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'before ' }, span, { type: 'text', value: ' after' }] }], footnotes: [],
    } as unknown as Document;
    assert.equal(validate(document).status, 'ok', span.type);
    const formatted = format(document);
    assert.equal(formatted.status, 'ok', span.type);
    if (formatted.status !== 'ok') continue;
    const reparsed = parse(formatted.source, { strict: true });
    assert.equal(reparsed.status, 'ok', span.type);
    if (reparsed.status === 'ok') assert.deepEqual(semanticDocumentEquals(document, reparsed.document), { status: 'ok', equal: true });
  }
});

test('a hard break or block boundary resolves an unmatched delimiter to literal text', () => {
  for (const source of ['**foo  \nbar**', '**foo\\\nbar**', '**foo\n\nbar**']) {
    const parsed = parse(source);
    assert.equal(parsed.status, 'ok', source);
    if (parsed.status !== 'ok') continue;
    const formatted = format(parsed.document);
    assert.equal(formatted.status, 'ok', source);
    if (formatted.status !== 'ok') continue;
    const strict = parse(formatted.source, { strict: true });
    assert.equal(strict.status, 'ok', formatted.source);
    if (strict.status === 'ok') assert.deepEqual(semanticDocumentEquals(strict.document, parsed.document), { status: 'ok', equal: true });
    assert.equal(parse(source, { strict: true }).status, 'invalid', source);
  }
});

test('list and quote paragraph ownership keeps the inline stack across SoftBreak', () => {
  for (const source of ['- **foo\n  bar**', '> **foo\n> bar**']) {
    const parsed = parse(source);
    assert.equal(parsed.status, 'ok', source);
    if (parsed.status !== 'ok') continue;
    const formatted = format(parsed.document);
    assert.equal(formatted.status, 'ok', source);
    if (formatted.status === 'ok') assert.equal(parse(formatted.source, { strict: true }).status, 'ok');
  }
});

test('only GFM deletion among the additional paired delimiters may span a SoftBreak', () => {
  for (const source of ['--foo\nbar--', '++foo\nbar++', '==foo\nbar==']) {
    const parsed = parse(source);
    assert.equal(parsed.status, 'ok', source);
    if (parsed.status !== 'ok') continue;
    const paragraph = parsed.document.children[0];
    assert.equal(paragraph?.type, 'paragraph');
    if (paragraph?.type === 'paragraph') assert.ok(paragraph.children.every((node) => node.type === 'text' || node.type === 'softBreak'));
    assert.equal(parse(source, { strict: true }).status, 'invalid', source);
  }
});

test('single-line owning contexts reject nested SoftBreaks', () => {
  const soft = { type: 'softBreak' } as const;
  const text = (value: string) => ({ type: 'text', value }) as const;
  const strong = { type: 'strong', children: [text('a'), soft, text('b')] } as const;
  const documents = [
    { type: 'document', children: [{ type: 'heading', level: 1, children: [strong] }], footnotes: [] },
    { type: 'document', children: [{ type: 'table', alignments: ['default'], head: { type: 'tableRow', cells: [{ type: 'tableCell', children: [strong] }] }, body: [] }], footnotes: [] },
    { type: 'document', children: [{ type: 'quoteRegion', children: [{ level: 1, block: { type: 'paragraph', children: [text('q')] } }], attribution: [strong] }], footnotes: [] },
    { type: 'document', children: [{ type: 'imageBlock', src: '/x', alt: [], caption: [strong] }], footnotes: [] },
  ] as unknown as Document[];
  for (const document of documents) assert.equal(validate(document).status, 'invalid');
});

// Regression — independent review 2026-09-03: a non-ASCII whitespace (tab,
// NBSP, …) at a sequence edge or beside a SoftBreak inside one of the newly
// multiline-capable spans must be normalised away by the parser, not left in a
// `Text` value that `validate`/`format` would then reject (§7.2 law 1, §7.7).
for (const ws of ['\t', ' ', ' ']) {
  const label = ws === '\t' ? 'tab' : `U+${ws.codePointAt(0)!.toString(16).toUpperCase()}`;
  for (const [name, source] of [
    ['strong, before break', `**foo${ws}\nbar**`],
    ['strong, after break', `**foo\n${ws}bar**`],
    ['deletion, before break', `a ~~x${ws}\ny~~ b`],
    ['metadata span, after break', `<m lang=de>x\n${ws}y</m>`],
    ['link label, before break', `[a${ws}\nb](/u)`],
    ['image alt, after break', `before ![a\n${ws}b](/u) after`],
    ['paragraph outer edge', `text${ws}\n`],
  ] as const) {
    test(`${label} at ${name} yields a formattable, strict-stable AST`, () => {
      const parsed = parse(source);
      assert.equal(parsed.status, 'ok', source);
      if (parsed.status !== 'ok') return;
      assert.equal(validate(parsed.document).status, 'ok');
      const formatted = format(parsed.document);
      assert.equal(formatted.status, 'ok');
      if (formatted.status !== 'ok') return;
      const strict = parse(formatted.source, { strict: true });
      assert.equal(strict.status, 'ok');
      if (strict.status === 'ok') {
        assert.deepEqual(semanticDocumentEquals(parsed.document, strict.document), { status: 'ok', equal: true });
      }
    });
  }
}

test('the validator recurses break-adjacency into nested spans but not their outer edges', () => {
  const soft = { type: 'softBreak' } as const;
  const text = (value: string) => ({ type: 'text', value }) as const;
  const bad = (spanType: 'strong' | 'deletion' | 'metadataSpan' | 'link') => ({
    type: 'document',
    children: [{ type: 'paragraph', children: [{
      ...(spanType === 'metadataSpan' ? { type: 'metadataSpan', attrs: { lang: 'de' } }
        : spanType === 'link' ? { type: 'link', href: '/u' } : { type: spanType }),
      children: [text('foo\t'), soft, text('bar')],
    }] }],
    footnotes: [],
  }) as unknown as Document;
  for (const spanType of ['strong', 'deletion', 'metadataSpan', 'link'] as const) {
    assert.equal(validate(bad(spanType)).status, 'invalid', spanType);
  }
  // a nested sequence's own outer edge stays legal — `[ x](y)` is lossless
  const okLabel = { type: 'document', children: [{ type: 'paragraph', children: [
    { type: 'link', href: '/u', children: [text(' x')] }, text(' y'),
  ] }], footnotes: [] } as unknown as Document;
  assert.equal(validate(okLabel).status, 'ok');
});
