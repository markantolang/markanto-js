import assert from 'node:assert/strict';
import test from 'node:test';

import { format, parse, semanticDocumentEquals } from '../../src/index.js';
import type { Document } from '../../src/ast.js';

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

const ATOMS = [
  'plain', '*em*', '**strong**', '***both***', '~~deleted~~', '--obsolete--',
  '++inserted++', '==marked==', '^sup^', '~sub~', '`code`', '``a`b``',
  '$`x_*_y`$', '[label](https://example.org)', '![alt](image.png)',
  '<https://example.org/x>', '<a@example.org>', '\\*literal*',
  '[a\\]b](y)', '![x\\[y](i)', '[![a](i)](u)',
] as const;

test('Phase-2 generated inline documents satisfy the four canonical laws', () => {
  const next = random(0x1a11ce);
  for (let iteration = 0; iteration < 500; iteration += 1) {
    const count = 1 + Math.floor(next() * 4);
    const atoms: string[] = [];
    for (let index = 0; index < count; index += 1) atoms.push(ATOMS[Math.floor(next() * ATOMS.length)]!);
    const source = `p ${atoms.join(' ')} q\n`;

    const strict = parse(source, { strict: true });
    assert.equal(strict.status, 'ok', `#${iteration} strict parse: ${JSON.stringify(source)}`);
    if (strict.status !== 'ok') continue;
    const formatted = format(strict.document);
    assert.equal(formatted.status, 'ok', `#${iteration} format`);
    if (formatted.status !== 'ok') continue;
    assert.equal(formatted.source, source, `#${iteration} canonical bytes changed`);

    const reparsed = parse(formatted.source, { strict: true });
    assert.equal(reparsed.status, 'ok', `#${iteration} formatter output rejected`);
    if (reparsed.status !== 'ok') continue;
    const equality = semanticDocumentEquals(strict.document, reparsed.document);
    assert.deepEqual(equality, { status: 'ok', equal: true }, `#${iteration} semantic drift`);

    const again = format(reparsed.document);
    assert.equal(again.status === 'ok' && again.source, formatted.source, `#${iteration} formatter not idempotent`);
    assert.equal(parse(formatted.source).status, 'ok', `#${iteration} canonical normal parse failed`);
  }
});

test('literal Text that resembles every structural family remains Text', () => {
  const values = [
    '*em*', '**strong**', '~~deleted~~', '--obsolete--', '++inserted++', '==marked==',
    '^sup^', '~sub~', '`code`', '$`math`$', '[label](target)', '![alt](image.png)',
    '[^note]', '<https://example.org>', '<a@example.org>', '<i>x</i>', '&amp;',
    'https://example.org',
    'a====b', 'x~~~y',
  ];
  for (const value of values) {
    const document: Document = {
      type: 'document',
      children: [{ type: 'paragraph', children: [{ type: 'text', value }] }],
      footnotes: [],
    };
    const formatted = format(document);
    assert.equal(formatted.status, 'ok', `format ${JSON.stringify(value)}`);
    if (formatted.status !== 'ok') continue;
    const reparsed = parse(formatted.source, { strict: true });
    assert.equal(reparsed.status, 'ok', `strict parse ${JSON.stringify(formatted.source)}`);
    if (reparsed.status !== 'ok') continue;
    assert.deepEqual(semanticDocumentEquals(document, reparsed.document), { status: 'ok', equal: true });
  }
});

test('label-context escaping closes B1 for valid semantic ASTs', () => {
  const documents: Document[] = [
    { type: 'document', children: [{ type: 'paragraph', children: [{ type: 'link', href: 'y', children: [{ type: 'text', value: 'a]b' }] }] }], footnotes: [] },
    { type: 'document', children: [{ type: 'paragraph', children: [{ type: 'link', href: 'y', children: [{ type: 'text', value: 'a](b' }] }] }], footnotes: [] },
    { type: 'document', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'See ' }, { type: 'inlineImage', src: 'i', alt: [{ type: 'text', value: 'x[y' }] }] }], footnotes: [] },
  ];
  for (const document of documents) {
    const formatted = format(document);
    assert.equal(formatted.status, 'ok');
    if (formatted.status !== 'ok') continue;
    const strict = parse(formatted.source, { strict: true });
    assert.equal(strict.status, 'ok', formatted.source);
    if (strict.status === 'ok') assert.deepEqual(semanticDocumentEquals(document, strict.document), { status: 'ok', equal: true });
  }
});

test('indirect repeated wrapper kinds remain representable through MIB fallback', () => {
  const parsed = parse('<i><b><i>x</i></b></i>\n');
  assert.equal(parsed.status, 'ok');
  if (parsed.status !== 'ok') return;
  const formatted = format(parsed.document);
  assert.equal(formatted.status, 'ok');
  if (formatted.status !== 'ok') return;
  const strict = parse(formatted.source, { strict: true });
  assert.equal(strict.status, 'ok');
  if (strict.status === 'ok') {
    assert.deepEqual(semanticDocumentEquals(parsed.document, strict.document), { status: 'ok', equal: true });
  }
});

test('link destinations and titles decode numeric references after token recognition', () => {
  const parsed = parse('[a](/x&#38;y "&#x71;")\n');
  assert.equal(parsed.status, 'ok');
  if (parsed.status !== 'ok') return;
  const paragraph = parsed.document.children[0];
  assert.equal(paragraph?.type, 'paragraph');
  if (paragraph?.type !== 'paragraph') return;
  assert.deepEqual(paragraph.children[0], {
    type: 'link', href: '/x&y', title: 'q', children: [{ type: 'text', value: 'a' }],
  });
  const formatted = format(parsed.document);
  assert.equal(formatted.status === 'ok' && formatted.source, '[a](/x&y "q")\n');
});

test('empty destination is distinct from whitespace-only destination and empty label', () => {
  assert.equal(parse('[a]()\n').status, 'ok');
  assert.equal(parse('[a](<>)\n', { strict: true }).status, 'ok');
  assert.equal(parse('[a]( )\n').status, 'invalid');
  assert.equal(parse('[](<>)\n').status, 'invalid');
});

test('a present empty title is distinct from an absent title and both round-trip', () => {
  const empty = parse('[x](u "")\n');
  const absent = parse('[x](u)\n');
  assert.equal(empty.status, 'ok');
  assert.equal(absent.status, 'ok');
  if (empty.status !== 'ok' || absent.status !== 'ok') return;
  assert.deepEqual(semanticDocumentEquals(empty.document, absent.document), { status: 'ok', equal: false });
  assert.deepEqual(format(empty.document), { status: 'ok', source: '[x](u "")\n', diagnostics: [] });
  assert.deepEqual(format(absent.document), { status: 'ok', source: '[x](u)\n', diagnostics: [] });
  assert.equal(parse('[x](u "")\n', { strict: true }).status, 'ok');
});

test('an Em/Strong wrapping a lone delimiter run serialises as <i>/<b>', () => {
  // `**\***` fuses the `**` closer with the escaped `*` into `***`; the
  // `<i>`/`<b>` form is unambiguous. Nested emphasis (`***x***`) is unaffected.
  for (const [type, tag] of [['strong', 'b'], ['em', 'i']] as const) {
    for (const value of ['*', '**', '_', '__']) {
      const doc: Document = {
        type: 'document',
        children: [{ type: 'paragraph', children: [{ type: type, children: [{ type: 'text', value }] }] }],
        footnotes: [],
      };
      const formatted = format(doc);
      assert.equal(formatted.status, 'ok', `${type}(${value})`);
      if (formatted.status !== 'ok') continue;
      assert.equal(formatted.source, `<${tag}>${value}</${tag}>\n`);
      const reparsed = parse(formatted.source, { strict: true });
      assert.equal(reparsed.status, 'ok');
      if (reparsed.status === 'ok') {
        assert.deepEqual(semanticDocumentEquals(doc, reparsed.document), { status: 'ok', equal: true });
      }
    }
  }
  // `***x***` still round-trips as the triple-run.
  assert.deepEqual(
    format({ type: 'document', children: [{ type: 'paragraph', children: [{ type: 'strong', children: [{ type: 'em', children: [{ type: 'text', value: 'x' }] }] }] }], footnotes: [] }),
    { status: 'ok', source: '***x***\n', diagnostics: [] },
  );
});

const roundTrips = (children: unknown[], label: string, expected?: string): void => {
  const doc = { type: 'document', children, footnotes: [] } as unknown as Document;
  const formatted = format(doc);
  assert.equal(formatted.status, 'ok', `${label}: format`);
  if (formatted.status !== 'ok') return;
  if (expected !== undefined) assert.equal(formatted.source, expected, `${label}: surface`);
  const reparsed = parse(formatted.source, { strict: true });
  assert.equal(reparsed.status, 'ok', `${label}: strict reparse`);
  if (reparsed.status === 'ok') {
    assert.deepEqual(semanticDocumentEquals(doc, reparsed.document), { status: 'ok', equal: true }, `${label}: semantic`);
  }
};

test('a paragraph line that would open a block quote is escaped on continuation lines too', () => {
  const t = (value: string) => ({ type: 'text', value });
  const sb = { type: 'softBreak' };
  roundTrips(
    [{ type: 'paragraph', children: [t('plain'), sb, t('> q')] }] as never,
    'plain / > q', 'plain\n\\> q\n',
  );
  roundTrips([{ type: 'paragraph', children: [t('a'), sb, t('>'), sb, t('b')] }], 'a / > / b');
});

test('a paragraph / heading text that is a literal block-id suffix is escaped', () => {
  const t = (value: string) => ({ type: 'text', value });
  const sb = { type: 'softBreak' };
  roundTrips([{ type: 'heading', level: 2, children: [t('H {#x}')] }], 'heading H {#x}', '## H \\{#x}\n');
  roundTrips([{ type: 'heading', level: 1, children: [t('{#x}')] }], 'heading = {#x}', '# \\{#x}\n');
  roundTrips([{ type: 'heading', level: 3, children: [t('H {#bad!}')] }], 'heading bad id');
  roundTrips([{ type: 'paragraph', children: [t('a'), sb, t('{#x}')] }], 'para a / {#x}', 'a\n\\{#x}\n');
  roundTrips([{ type: 'paragraph', children: [t('word {#x} mid')] }], 'para {#x} mid (no id, unescaped)', 'word {#x} mid\n');
});

test('a pipe-less table separator surface after content is escaped', () => {
  const t = (value: string) => ({ type: 'text', value });
  const sb = { type: 'softBreak' };
  roundTrips([{ type: 'paragraph', children: [t('a | b'), sb, t('--- | ---')] }], 'a|b / ---|---', 'a | b\n\\--- | ---\n');
  roundTrips([{ type: 'paragraph', children: [t('x | y'), sb, t(':-: | :-:')] }], 'x|y / :-: | :-:');
  // no pipe on the header line -> no table -> not escaped
  roundTrips([{ type: 'paragraph', children: [t('Cost'), sb, t('| --- |')] }], 'Cost / | --- |', 'Cost\n| --- |\n');
});

test('a `|` inside an atomic inline token on the header line does not trigger the separator guard', () => {
  const t = (value: string) => ({ type: 'text', value });
  const sb = { type: 'softBreak' };
  // The parser reads a `|` inside a code span as content, so `` `|` header `` is
  // not a table row and `--- | ---` below it needs no escape (the guard must
  // walk atomic tokens exactly as the row scanner does).
  roundTrips(
    [{ type: 'paragraph', children: [{ type: 'inlineCode', value: '|' }, t(' header'), sb, t('--- | ---')] }],
    'code-span pipe / ---|---', '`|` header\n--- | ---\n',
  );
});

test('a paragraph line that is a table separator surface after content is escaped', () => {
  // `| a |` then `| --- |` would reparse as a table — escape the separator line.
  const doc: Document = {
    type: 'document',
    children: [{
      type: 'paragraph',
      children: [{ type: 'text', value: '| a |' }, { type: 'softBreak' }, { type: 'text', value: '| --- |' }],
    }],
    footnotes: [],
  };
  const formatted = format(doc);
  assert.equal(formatted.status, 'ok');
  if (formatted.status !== 'ok') return;
  assert.equal(formatted.source, '\\| a |\n\\| --- |\n');
  const reparsed = parse(formatted.source, { strict: true });
  assert.equal(reparsed.status, 'ok');
  if (reparsed.status === 'ok') {
    assert.deepEqual(semanticDocumentEquals(doc, reparsed.document), { status: 'ok', equal: true });
  }
});
