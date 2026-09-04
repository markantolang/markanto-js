import assert from 'node:assert/strict';
import test from 'node:test';

import { format, parse } from '../../src/index.js';
import type { Document } from '../../src/ast.js';

function parseOk(source: string): Document {
  const result = parse(source);
  assert.equal(result.status, 'ok', `expected ok for ${JSON.stringify(source)}`);
  if (result.status !== 'ok') throw new Error('unreachable');
  return result.document;
}

function firstCategory(source: string): string | undefined {
  const result = parse(source);
  if (result.status === 'ok') return undefined;
  return result.diagnostics[0]?.category;
}

test('fence run-length matching: a shorter closer leaves the fence unclosed', () => {
  assert.equal(firstCategory(':::: Warning\nContent.\n:::\n'), 'syntax');
  assert.equal(firstCategory(':::: Warning\nContent.\n::::\n'), undefined);
  assert.equal(firstCategory(':::: Warning\nContent.\n:::::\n'), undefined);
});

test('TYPE character rejection is a syntax error', () => {
  assert.equal(firstCategory('A|B\n___\n\nContent.\n___\n'), 'syntax');
  assert.equal(firstCategory('A\\B\n___\n\nContent.\n___\n'), 'syntax');
  assert.equal(firstCategory('A`B\n___\n\nContent.\n___\n'), 'syntax');
  assert.equal(firstCategory('Bad<Type\n___\n\nText.\n___\n'), 'syntax');
  assert.equal(firstCategory('C#\n___\n\nContent.\n___\n'), undefined);
  assert.equal(firstCategory('RFC:9110\n___\n\nContent.\n___\n'), undefined);
});

test('the lined one-line-lookahead guard keeps a heading a heading', () => {
  const doc = parseOk('# Heading\n___\n\nContent.\n___\n');
  assert.equal(doc.children[0]?.type, 'heading');
  assert.equal(doc.children[1]?.type, 'container');
});

test('the lined one-line-lookahead guard keeps quote and list markers out of headers', () => {
  for (const source of [
    '> quote\n___\n\nX.\n___\n',
    '>tight\n___\n\nX.\n___\n',
    '- item\n___\n\nX.\n___\n',
  ]) {
    const doc = parseOk(source);
    assert.notEqual(doc.children[0]?.type, 'container');
  }

  const unrepresentable: Document = {
    type: 'document',
    children: [{
      type: 'container',
      form: 'lined',
      containerType: '-',
      title: null,
      children: [{ type: 'paragraph', children: [{ type: 'text', value: 'X.' }] }],
    }],
    footnotes: [],
  };
  assert.equal(format(unrepresentable).status, 'invalid');
});

test('typed lined containers nested in lined bodies fail without recovery reinterpretation', () => {
  for (const source of [
    'Outer\n___\n\nInner\n___\n\nNested.\n___\n___\n',
    'Exkurs\n___\n\nInner\n___\n\nA.\n___\n___\n',
  ]) {
    const result = parse(source, { errorRecovery: true });
    assert.equal(result.status, 'invalid');
    if (result.status !== 'invalid') throw new Error('unreachable');
    assert.equal(result.diagnostics[0]?.category, 'semantic');
    assert.equal(result.diagnostics[0]?.message, 'forbidden container nesting');
    assert.ok(result.recovery !== undefined);
    if (result.recovery !== undefined) {
      const silentlyReinterpreted = result.recovery.children.some((child) =>
        child.type === 'container' && child.children.some((nested) =>
          nested.type === 'paragraph' && nested.children.some((inline) => inline.type === 'text' && inline.value === 'Inner')
        )
      );
      assert.equal(silentlyReinterpreted, false);
    }
  }
});

test('N anonymous sibling lined containers round-trip (B3 — no false nesting)', () => {
  for (let n = 1; n <= 6; n += 1) {
    const source = Array.from({ length: n }, (_, i) => `___\n\nc${i + 1}\n___\n`).join('\n');
    const result = parse(source);
    const detail = result.status === 'ok' ? 'ok' : (result.diagnostics[0]?.message ?? 'invalid');
    assert.equal(result.status, 'ok', `${n} siblings -> ${detail}`);
    if (result.status !== 'ok') throw new Error('unreachable');
    assert.equal(result.document.children.length, n);
    assert.ok(result.document.children.every((c) => c.type === 'container' && c.form === 'lined'));
    const formatted = format(result.document);
    assert.equal(formatted.status, 'ok');
    if (formatted.status === 'ok') assert.equal(formatted.source, source);
  }
});

test('typed sibling lined containers round-trip (B3)', () => {
  const source = 'Exkurs A\n___\n\nc1\n___\n\nExkurs B\n___\n\nc2\n___\n\nExkurs C\n___\n\nc3\n___\n';
  const result = parse(source);
  const detail = result.status === 'ok' ? 'ok' : (result.diagnostics[0]?.message ?? 'invalid');
  assert.equal(result.status, 'ok', detail);
  if (result.status !== 'ok') throw new Error('unreachable');
  assert.equal(result.document.children.length, 3);
});

test('a typed lined header followed by a fence becomes a lined container', () => {
  const doc = parseOk('Exkurs\n___\n\nContent.\n___\n');
  const container = doc.children[0];
  assert.equal(container?.type, 'container');
  if (container?.type === 'container') {
    assert.equal(container.form, 'lined');
    assert.equal(container.containerType, 'Exkurs');
  }
});

test('grid rectangle validation rejects non-rectangular spans', () => {
  assert.equal(firstCategory('::: X\nA\n--\n<\n==\n^\n--\nB\n:::\n'), 'semantic');
  assert.equal(firstCategory('::: X\nA\n--\nB\n==\nC\n:::\n'), 'semantic');
});

test('a {#id} in an identity-forbidden scope is a parser semantic error (B2)', () => {
  for (const source of [
    '::: V\na\n{#inside}\n--\nb\n:::\n',     // standalone line in a grid cell
    '::: V\n# H {#inside}\n--\nb\n:::\n',    // same-line heading id in a grid cell
    '> # H {#inside}\n',                      // same-line heading id in a quote
    '- item\n\n  # H {#inside}\n',            // same-line heading id in a list item
  ]) {
    const result = parse(source);
    assert.equal(result.status, 'invalid', source);
    if (result.status === 'invalid') {
      assert.equal(result.diagnostics[0]?.category, 'semantic', source);
    }
  }
});

test('grid continuation markers are invalid in the first row/column', () => {
  assert.equal(firstCategory('::: X\n^\n--\nB\n:::\n'), 'semantic');
  assert.equal(firstCategory('::: X\n<\n--\nB\n:::\n'), 'semantic');
});

test('grid separators expose empty cells to semantic validation', () => {
  for (const source of [
    '::: V\nA\n--\n--\nB\n:::\n',
    '::: V\n--\nA\n--\nB\n:::\n',
  ]) {
    const result = parse(source);
    assert.equal(result.status, 'invalid');
    if (result.status !== 'invalid') throw new Error('unreachable');
    assert.equal(result.diagnostics[0]?.category, 'semantic');
    assert.equal(result.diagnostics[0]?.message, 'empty grid cell');
  }
});

test('a deferred grid trigger re-commits pre-trigger continuation markers', () => {
  assert.equal(firstCategory('::: X\n^\n--\nB\n:::\n'), 'semantic');
  assert.equal(firstCategory('::: X\n<\n==\nB\n:::\n'), 'semantic');
});

test('the deferred scan ignores markers inside a code fence', () => {
  const doc = parseOk('::: Beispiel\n```text\n::\n--\n==\n```\n:::\n');
  const container = doc.children[0];
  assert.equal(container?.type, 'container');
  if (container?.type === 'container' && container.children[0]?.type === 'codeBlock') {
    assert.equal(container.children[0].value, '::\n--\n==');
  }
});

test('grid canonical output round-trips through strict mode', () => {
  const source = '::: Vergleich\nAlpha\n--\nBeta\n==\nGamma\n--\nDelta\n:::\n';
  const result = parse(source, { strict: true });
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') {
    const formatted = format(result.document);
    assert.equal(formatted.status === 'ok' && formatted.source, source);
  }
});
