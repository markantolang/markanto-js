import assert from 'node:assert/strict';
import test from 'node:test';
import { format, parse } from '../../src/index.js';

function firstCategory(source: string): string | undefined {
  const result = parse(source);
  return result.status === 'invalid' ? result.diagnostics[0]?.category : undefined;
}

test('a reference with a definition produces a hoisted FootnoteDefinition', () => {
  const result = parse('Text.[^1]\n\n[^1]: Note.\n');
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.deepEqual(result.document.children.map((child) => child.type), ['paragraph']);
  assert.equal(result.document.footnotes.length, 1);
  assert.equal(result.document.footnotes[0]!.identifier, '1');
});

test('the footnote relation errors are all semantic', () => {
  assert.equal(firstCategory('Text.[^missing]\n'), 'semantic');
  assert.equal(firstCategory('Text.[^x]\n\n[^x]: a.\n[^x]: b.\n'), 'semantic');
  assert.equal(firstCategory('A.[^A]\n\n[^a]: lower.\n'), 'semantic');
  assert.equal(firstCategory('A[^x].\n\n[^x]: nested[^y].\n[^y]: other.\n'), 'semantic');
});

test('an unused definition is a warning, not an error', () => {
  const result = parse('Text.\n\n[^unused]: Note.\n');
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.category === 'advisory' && diagnostic.severity === 'warning'));
});

test('canonical footnote order: referenced by first reference, then unused by ASCII identifier', () => {
  const referenced = parse('A.[^b] B.[^a]\n\n[^a]: A def.\n[^b]: B def.\n');
  assert.equal(referenced.status, 'ok');
  if (referenced.status === 'ok') {
    assert.deepEqual(referenced.document.footnotes.map((definition) => definition.identifier), ['b', 'a']);
    const formatted = format(referenced.document);
    assert.equal(formatted.status === 'ok' && formatted.source, 'A.[^b] B.[^a]\n\n[^b]: B def.\n[^a]: A def.\n');
  }
  const unused = parse('Text.\n\n[^a]: lower.\n[^_]: underscore.\n[^A]: upper.\n[^0]: digit.\n[^-]: dash.\n');
  assert.equal(unused.status, 'ok');
  if (unused.status === 'ok') {
    assert.deepEqual(unused.document.footnotes.map((definition) => definition.identifier), ['-', '0', 'A', '_', 'a']);
  }
});

test('a definition after its referencing paragraph is hoisted to the document end', () => {
  const parsed = parse('First[^x].\n[^x]: Note.\n\nSecond.\n');
  assert.equal(parsed.status, 'ok');
  if (parsed.status !== 'ok') return;
  assert.deepEqual(parsed.document.children.map((child) => child.type), ['paragraph', 'paragraph']);
  const formatted = format(parsed.document);
  assert.equal(formatted.status === 'ok' && formatted.source, 'First[^x].\n\nSecond.\n\n[^x]: Note.\n');
});

test('a footnote may be referenced inside a quote or a container; the definition stays at document level', () => {
  for (const source of ['> Quote[^x].\n\n[^x]: Note.\n', '::: Note\nText[^x].\n:::\n\n[^x]: Note.\n']) {
    const result = parse(source);
    assert.equal(result.status, 'ok', source);
    if (result.status === 'ok') assert.equal(result.document.footnotes.length, 1);
  }
});

test('a `[^id]: ` line inside a container is not hoisted as a definition (definitions are document-level only)', () => {
  // The `[^id]` token is still an inline footnote reference wherever it appears,
  // so it needs a document-level definition; the container line itself is not a
  // definition and is not moved into `Document.footnotes`.
  const withDefinition = parse('::: Note\n[^x]: text\n:::\n\n[^x]: real definition.\n');
  assert.equal(withDefinition.status, 'ok');
  if (withDefinition.status !== 'ok') return;
  assert.equal(withDefinition.document.footnotes.length, 1);
  const container = withDefinition.document.children[0]!;
  assert.equal(container.type, 'container');
  if (container.type === 'container') assert.equal(container.children[0]?.type, 'paragraph');

  // Without the document-level definition the reference is unresolved.
  assert.equal(firstCategory('::: Note\n[^x]: text\n:::\n'), 'semantic');
});

test('footnote reference order is independent of JavaScript object-property order (M3)', () => {
  const alignments = ['default', 'default'] as const;
  const cellA = { type: 'tableCell' as const, children: [{ type: 'text' as const, value: 'x' }, { type: 'footnoteReference' as const, identifier: 'a' }] };
  const cellB = { type: 'tableCell' as const, children: [{ type: 'text' as const, value: 'y' }, { type: 'footnoteReference' as const, identifier: 'b' }] };
  const head = { type: 'tableRow' as const, cells: [cellA, { type: 'tableCell' as const, children: [{ type: 'text' as const, value: 'h' }] }] };
  const body = [{ type: 'tableRow' as const, cells: [cellB, { type: 'tableCell' as const, children: [{ type: 'text' as const, value: 'z' }] }] }];
  const defs = [
    { type: 'footnoteDefinition' as const, identifier: 'a', children: [{ type: 'text' as const, value: 'A.' }] },
    { type: 'footnoteDefinition' as const, identifier: 'b', children: [{ type: 'text' as const, value: 'B.' }] },
  ];

  // head-before-body in the reference order -> [a, b]
  const fieldOrderA = { type: 'document' as const, footnotes: defs, children: [{ type: 'table' as const, alignments, head, body }] };
  const fieldOrderB = { type: 'document' as const, footnotes: defs, children: [{ type: 'table' as const, body, head, alignments }] };

  for (const document of [fieldOrderA, fieldOrderB]) {
    const formatted = format(document as never);
    assert.equal(formatted.status, 'ok');
    if (formatted.status === 'ok') {
      assert.match(formatted.source, /\[\^a\]: A\.\n\[\^b\]: B\./u);
    }
  }
});
