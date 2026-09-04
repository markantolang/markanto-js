import assert from 'node:assert/strict';
import test from 'node:test';

import type { Document, Heading } from '../../src/ast.js';
import { adoptDocument, parse, validate } from '../../src/index.js';

function counter(): () => string {
  let n = 0;
  return () => `g${(n += 1)}`;
}

function documentOf(source: string): Document {
  const result = parse(source);
  assert.equal(result.status, 'ok', source);
  if (result.status !== 'ok') throw new Error('unreachable');
  return result.document;
}

test('adoptDocument fills every document-level block that lacks an id', () => {
  const source = documentOf('# One\n\nTwo.\n\n> Quote.\n');
  const { document, addedIds } = adoptDocument(source, counter());
  assert.equal(addedIds, 3);
  assert.deepEqual(document.children.map((child) => (child as { id?: string }).id), ['g1', 'g2', 'g3']);
  // The original is untouched.
  assert.equal((source.children[0] as { id?: string }).id, undefined);
});

test('adoptDocument never overwrites an explicit id and is idempotent', () => {
  const base: Document = {
    type: 'document',
    children: [
      { type: 'heading', level: 1, id: 'keep', children: [{ type: 'text', value: 'A' }] } as Heading,
      { type: 'paragraph', children: [{ type: 'text', value: 'b' }] },
    ],
    footnotes: [],
  };
  const once = adoptDocument(base, counter());
  assert.equal(once.addedIds, 1);
  assert.equal((once.document.children[0] as { id?: string }).id, 'keep');
  assert.equal((once.document.children[1] as { id?: string }).id, 'g1');

  const twice = adoptDocument(once.document, counter());
  assert.equal(twice.addedIds, 0);
  assert.deepEqual(
    twice.document.children.map((child) => (child as { id?: string }).id),
    once.document.children.map((child) => (child as { id?: string }).id),
  );
});

test('adoptDocument does not collide with an existing id', () => {
  const base: Document = {
    type: 'document',
    children: [
      { type: 'heading', level: 1, id: 'g1', children: [{ type: 'text', value: 'A' }] } as Heading,
      { type: 'paragraph', children: [{ type: 'text', value: 'b' }] },
    ],
    footnotes: [],
  };
  const { document } = adoptDocument(base, counter());
  const ids = document.children.map((child) => (child as { id?: string }).id);
  assert.equal(ids[0], 'g1');
  assert.equal(ids[1], 'g2');
});

test('adoptDocument assigns ids to direct container children but not to grid / quote / list contents', () => {
  const source = documentOf('::: Note\nInside paragraph.\n\n> Quote inside.\n:::\n');
  const { document } = adoptDocument(source, counter());
  const container = document.children[0]!;
  assert.equal(container.type, 'container');
  if (container.type !== 'container') return;
  assert.equal((container as { id?: string }).id, 'g1');
  for (const child of container.children) {
    assert.notEqual((child as { id?: string }).id, undefined);
  }
});

test('adoptDocument assigns an id to a footnote definition (spec §5.1) and the result validates strictly', () => {
  const source = documentOf('Ref.[^a]\n\n[^a]: note.\n');
  const { document, addedIds } = adoptDocument(source, counter());
  assert.equal(addedIds, 2); // the paragraph and the footnote definition
  assert.notEqual(document.footnotes[0]!.id, undefined);
  assert.equal(validate(document).status, 'ok');
  assert.equal(validate(document, { identity: 'required' }).status, 'ok');
});

test('adoptDocument leaves a comment block without an id', () => {
  const source = documentOf('<!-- a -->\n\nText.\n');
  const { document } = adoptDocument(source, counter());
  const comment = document.children.find((child) => child.type === 'commentBlock');
  assert.ok(comment !== undefined);
  assert.equal((comment as { id?: string }).id, undefined);
});

test('adoptDocument rejects a non-conforming createId (M5)', () => {
  const doc: Document = { type: 'document', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'x' }] }], footnotes: [] };

  assert.throws(() => adoptDocument(doc, () => 'not a valid id'), /not a valid block identifier/u);
  assert.throws(() => adoptDocument(doc, () => ''), /not a valid block identifier/u);

  const doc2: Document = {
    type: 'document',
    children: [{ type: 'heading', level: 1, id: 'taken', children: [{ type: 'text', value: 'A' }] } as Heading, { type: 'paragraph', children: [{ type: 'text', value: 'b' }] }],
    footnotes: [],
  };
  assert.throws(() => adoptDocument(doc2, () => 'taken'), /did not produce a fresh identifier/u);
});
