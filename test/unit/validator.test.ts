import assert from 'node:assert/strict';
import test from 'node:test';

import type { Document, Heading, Paragraph } from '../../src/ast.js';
import { parse, validate } from '../../src/index.js';

function documentOf(source: string): Document {
  const result = parse(source);
  assert.equal(result.status, 'ok', source);
  if (result.status !== 'ok') throw new Error('unreachable');
  return result.document;
}

function heading(text: string, id?: string): Heading {
  return { type: 'heading', level: 2, ...(id !== undefined ? { id } : {}), children: [{ type: 'text', value: text }] };
}

function paragraph(text: string): Paragraph {
  return { type: 'paragraph', children: [{ type: 'text', value: text }] };
}

test('a document parsed from valid source validates ok', () => {
  const document = documentOf('# Title {#top}\n\nBody with a [link](#top).\n\n[^a]: note.\n\nRef.[^a]\n');
  const result = validate(document);
  assert.equal(result.status, 'ok');
  assert.ok(!result.diagnostics.some((entry) => entry.severity === 'error'));
});

test('a non-document is rejected as semantic invalid', () => {
  const result = validate({ type: 'paragraph' } as unknown as Document);
  assert.equal(result.status, 'invalid');
  assert.equal(result.diagnostics[0]?.category, 'semantic');
});

test('checkShape is a total closed check — no exception for an arbitrary AST (B3)', () => {
  const cases: unknown[] = [
    { type: 'document', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'x' }], bogus: 1 }], footnotes: [] },
    { type: 'document', children: [null], footnotes: [] },
    { type: 'document', children: [{ type: 'not-a-real-type' }], footnotes: [] },
    { type: 'document', children: [{ type: 'heading', level: 'two', children: [{ type: 'text', value: 'x' }] }], footnotes: [] },
    { type: 'document', children: [{ type: 'paragraph', children: 'not-an-array' }], footnotes: [] },
    { type: 'document', children: [{ type: 'quoteRegion', children: [{ level: 1 }] }], footnotes: [] },
    // Closed attribute records — B1: these used to pass checkShape and then
    // throw a TypeError in the formatter / attribute matrix.
    { type: 'document', footnotes: [], children: [{ type: 'imageBlock', src: 'x', alt: [], attrs: { dataAttrs: null } }] },
    { type: 'document', footnotes: [], children: [{ type: 'imageBlock', src: 'x', alt: [], attrs: { group: 5 } }] },
    { type: 'document', footnotes: [], children: [{ type: 'imageBlock', src: 'x', alt: [], attrs: { dataAttrs: { k: null } } }] },
    { type: 'document', footnotes: [], children: [{ type: 'imageBlock', src: 'x', alt: [], attrs: { bogus: 'y' } }] },
  ];
  for (const value of cases) {
    const result = validate(value as Document);
    assert.equal(result.status, 'invalid', JSON.stringify(value));
    assert.equal(result.diagnostics[0]?.category, 'semantic');
  }
});

test('a deep AST yields resource, not a stack overflow (B2)', () => {
  let node: Document['children'][number] = { type: 'paragraph', children: [{ type: 'text', value: 'x' }] };
  for (let i = 0; i < 20_000; i += 1) {
    node = { type: 'list', kind: 'unordered', items: [{ type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'i' }] }, node] }] };
  }
  const document: Document = { type: 'document', children: [node], footnotes: [] };
  assert.equal(validate(document, { resourceBudget: { maxFrames: 10 } }).status, 'resource');
  assert.equal(validate(document).status, 'resource');
});

test('a wide flat document is not mistaken for a resource overrun (B2)', () => {
  const children = Array.from({ length: 5_000 }, (_unused, i) => paragraph(`p${i}`));
  const document: Document = { type: 'document', children, footnotes: [] };
  assert.equal(validate(document).status, 'ok');
});

test('duplicate document-wide block IDs are a semantic error', () => {
  const document: Document = { type: 'document', children: [heading('A', 'dup'), heading('B', 'dup')], footnotes: [] };
  const result = validate(document);
  assert.equal(result.status, 'invalid');
  assert.ok(result.diagnostics.some((entry) => entry.category === 'semantic' && /duplicate block id/.test(entry.message ?? '')));
});

test('an ill-formed block identifier is a semantic error', () => {
  const document: Document = { type: 'document', children: [heading('A', 'has space')], footnotes: [] };
  const result = validate(document);
  assert.equal(result.status, 'invalid');
  assert.ok(result.diagnostics.some((entry) => /invalid block id/.test(entry.message ?? '')));
});

test('a block ID inside a quote region is rejected (contained scope)', () => {
  const document: Document = {
    type: 'document',
    children: [{
      type: 'quoteRegion',
      children: [{ level: 1, block: heading('Q', 'nested') }],
    }],
    footnotes: [],
  };
  const result = validate(document);
  assert.equal(result.status, 'invalid');
  assert.ok(result.diagnostics.some((entry) => /not permitted at quoteRegion scope/.test(entry.message ?? '')));
});

test('a footnote reference without a definition is a semantic error', () => {
  const document: Document = {
    type: 'document',
    children: [{ type: 'paragraph', children: [{ type: 'text', value: 'x' }, { type: 'footnoteReference', identifier: 'missing' }] }],
    footnotes: [],
  };
  const result = validate(document);
  assert.equal(result.status, 'invalid');
  assert.ok(result.diagnostics.some((entry) => entry.category === 'semantic' && /no definition/.test(entry.message ?? '')));
});

test('a duplicate footnote definition is a semantic error', () => {
  const document: Document = {
    type: 'document',
    children: [{ type: 'paragraph', children: [{ type: 'text', value: 'x' }, { type: 'footnoteReference', identifier: 'a' }] }],
    footnotes: [
      { type: 'footnoteDefinition', identifier: 'a', children: [{ type: 'text', value: 'one' }] },
      { type: 'footnoteDefinition', identifier: 'a', children: [{ type: 'text', value: 'two' }] },
    ],
  };
  const result = validate(document);
  assert.equal(result.status, 'invalid');
  assert.ok(result.diagnostics.some((entry) => /duplicate footnote definition/.test(entry.message ?? '')));
});

test('a footnote definition id collides in the document-wide id space (spec §5.1)', () => {
  const document: Document = {
    type: 'document',
    children: [{ ...heading('A', 'x'), children: [{ type: 'text', value: 'A' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'r' }, { type: 'footnoteReference', identifier: 'a' }] }],
    footnotes: [{ type: 'footnoteDefinition', identifier: 'a', id: 'x', children: [{ type: 'text', value: 'n' }] }],
  };
  const result = validate(document);
  assert.equal(result.status, 'invalid');
  assert.ok(result.diagnostics.some((entry) => /duplicate block id \{#x\}/.test(entry.message ?? '')));
});

test('an unused footnote definition is an advisory warning, not an error', () => {
  const document: Document = {
    type: 'document',
    children: [paragraph('nothing references it')],
    footnotes: [{ type: 'footnoteDefinition', identifier: 'a', children: [{ type: 'text', value: 'one' }] }],
  };
  const result = validate(document);
  assert.equal(result.status, 'ok');
  assert.ok(result.diagnostics.some((entry) => entry.category === 'advisory' && entry.severity === 'warning'));
});

test('a link to an unresolved document anchor is an advisory warning', () => {
  const document: Document = {
    type: 'document',
    children: [{ type: 'paragraph', children: [{ type: 'link', href: '#nowhere', children: [{ type: 'text', value: 'x' }] }] }],
    footnotes: [],
  };
  const result = validate(document);
  assert.equal(result.status, 'ok');
  assert.ok(result.diagnostics.some((entry) => entry.category === 'advisory' && /unresolved document anchor #nowhere/.test(entry.message ?? '')));
});

test('identity: required flags a document-level block without an id', () => {
  const document: Document = { type: 'document', children: [heading('A', 'has-id'), heading('B')], footnotes: [] };
  assert.equal(validate(document).status, 'ok');
  const strict = validate(document, { identity: 'required' });
  assert.equal(strict.status, 'invalid');
  assert.ok(strict.diagnostics.some((entry) => /block id required/.test(entry.message ?? '')));
});

test('identity: required does not demand an id on a comment block', () => {
  const document: Document = {
    type: 'document',
    children: [heading('A', 'a'), { type: 'commentBlock', value: ' note ' }],
    footnotes: [],
  };
  assert.equal(validate(document, { identity: 'required' }).status, 'ok');
});

test('a structurally unrepresentable document is rejected via the formatter gate', () => {
  // Footnotes stored out of canonical order: referenced-first is violated.
  const document: Document = {
    type: 'document',
    children: [{
      type: 'paragraph',
      children: [
        { type: 'text', value: 'a' }, { type: 'footnoteReference', identifier: 'b' },
        { type: 'text', value: ' a' }, { type: 'footnoteReference', identifier: 'a' },
      ],
    }],
    footnotes: [
      { type: 'footnoteDefinition', identifier: 'a', children: [{ type: 'text', value: 'A' }] },
      { type: 'footnoteDefinition', identifier: 'b', children: [{ type: 'text', value: 'B' }] },
    ],
  };
  assert.equal(validate(document).status, 'invalid');
});
