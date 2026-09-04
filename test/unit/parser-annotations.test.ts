import assert from 'node:assert/strict';
import test from 'node:test';

import type { SourceAnnotations } from '../../src/parser-contract.js';
import { parse } from '../../src/index.js';

/**
 * Every object node reachable from a parsed tree (any `{ type: string }` record,
 * plus the arrays that hold them) must be retrievable in the sidecar. This is
 * the recursive form D3 requires; it walks `Document` and `RecoveryDocument`
 * without a hand-written node list, so a future child-bearing node or a missed
 * `annotations.set` is caught.
 *
 * `AnnotatableNode` also covers the typeless `QuoteBlock` helper
 * (`{ level, block }`); the walker picks it up by shape.
 */
function collectNodes(root: unknown): object[] {
  const out: object[] = [];
  const seen = new Set<object>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (value === null || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
      continue;
    }
    const record = value as Record<string, unknown>;
    if (typeof record['type'] === 'string' || ('level' in record && 'block' in record)) out.push(value);
    for (const key of Object.keys(record)) stack.push(record[key]);
  }
  return out;
}

function assertFullyAnnotated(annotations: SourceAnnotations, root: unknown): void {
  const nodes = collectNodes(root);
  assert.ok(nodes.length > 0, 'walker found nodes');
  for (const node of nodes) {
    assert.equal(
      annotations.has(node),
      true,
      `unannotated ${(node as { type?: string }).type ?? 'quoteBlock'} node`,
    );
  }
}

test('virtual list-item / quote subtrees are fully annotated, tables included (M3)', () => {
  for (const source of [
    '- x\n\n  | A | B |\n  | --- | --- |\n  | 1 | 2 |\n',
    '> | A | B |\n> | --- | --- |\n> | 1 | 2 |\n',
    '- item\n\n  > quoted\n  > > deeper\n',
    '- a\n  - b\n    - c\n',
  ]) {
    const result = parse(source);
    assert.equal(result.status, 'ok', source);
    if (result.status === 'ok') assertFullyAnnotated(result.annotations, result.document);
  }
});

test('every node of an ok document is recursively annotated', () => {
  const source =
    '# A {#h}\r\n\r\nBody\r\nnext\\\r\nline\r\n{#p}\r\n\r\n```js\r\nx\r\n```\r\n{#c}\r\n\r\n<!-- a\r\nb -->\r\n\r\n---\r\n';
  const result = parse(source);
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assertFullyAnnotated(result.annotations, result.document);
});

test('every nested Phase-2 inline node is annotated at its carrier extent', () => {
  const source = '**a *b* [c](https://example.org) `d` $`e`$ ~~f~~ ++g++ ==h== ^i^ ~j~[^n]**\n\n[^n]: note.\n';
  const result = parse(source);
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assertFullyAnnotated(result.annotations, result.document);

  const paragraph = result.document.children[0];
  assert.equal(paragraph?.type, 'paragraph');
  if (paragraph?.type !== 'paragraph') return;
  const strong = paragraph.children[0];
  assert.equal(strong?.type, 'strong');
  if (strong?.type !== 'strong') return;
  const em = strong.children.find((node) => node.type === 'em');
  assert.ok(em);
  const annotation = result.annotations.forNode(em!);
  assert.equal(source.slice(annotation!.range.start.offset, annotation!.range.end.offset), '*b*');
});

test('every node of a recovery document is recursively annotated', () => {
  const source = 'before\n\n```js extra\nbody\n```\n\n<!-- unterminated\n';
  const result = parse(source, { errorRecovery: true });
  assert.equal(result.status, 'invalid');
  if (result.status !== 'invalid' || result.recovery === undefined) {
    assert.fail('expected an annotated recovery document');
    return;
  }
  assertFullyAnnotated(result.annotations, result.recovery);
});

test('block ranges slice back to the raw source (BOM removed, CRLF preserved)', () => {
  const source = '# A {#h}\r\n\r\nBody\r\n';
  const result = parse(source);
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;

  const heading = result.document.children[0]!;
  const paragraph = result.document.children[1]!;
  const h = result.annotations.forNode(heading)!;
  const p = result.annotations.forNode(paragraph)!;
  assert.equal(source.slice(h.range.start.offset, h.range.end.offset), '# A {#h}');
  assert.equal(source.slice(p.range.start.offset, p.range.end.offset), 'Body');

  const doc = result.annotations.forNode(result.document)!;
  assert.deepEqual([doc.range.start.offset, doc.range.end.offset], [0, source.length]);
});

test('a next-line {#id} suffix is inside the block range; error ranges exclude the terminator', () => {
  const ok = parse('Paragraph.\n{#p1}\n');
  assert.equal(ok.status, 'ok');
  if (ok.status === 'ok') {
    const p = ok.annotations.forNode(ok.document.children[0]!)!;
    assert.equal('Paragraph.\n{#p1}\n'.slice(p.range.start.offset, p.range.end.offset), 'Paragraph.\n{#p1}');
  }

  const rec = parse('##\n', { errorRecovery: true });
  assert.equal(rec.status, 'invalid');
  if (rec.status === 'invalid' && rec.recovery !== undefined) {
    const err = rec.recovery.children[0]!;
    const a = rec.annotations.forNode(err)!;
    // "##\n" — the error range is [0, 2), not [0, 3): no trailing LF.
    assert.deepEqual([a.range.start.offset, a.range.end.offset], [0, 2]);
  }
});

test('a footnote definition range covers its {#id} postfix (M4)', () => {
  for (const source of ['R.[^a]\n\n[^a]: note.\n{#note-id}\n', 'R.[^a]\n\n[^a]: note.\n{#note-id}']) {
    const result = parse(source);
    assert.equal(result.status, 'ok', source);
    if (result.status !== 'ok') continue;
    const definition = result.document.footnotes[0]!;
    const annotation = result.annotations.forNode(definition)!;
    assert.equal(
      source.slice(annotation.range.start.offset, annotation.range.end.offset),
      '[^a]: note.\n{#note-id}',
      source,
    );
  }
});
