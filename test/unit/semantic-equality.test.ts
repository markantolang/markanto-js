import test from 'node:test';
import assert from 'node:assert/strict';

import type { Document } from '../../src/ast.js';
import { semanticDocumentEquals } from '../../src/semantic-equality.js';
import {
  deeplyNestedList,
  doc,
  heading,
  paragraph,
  quoteBlock,
  quoteRegion,
  text,
} from '../helpers/ast-builders.js';

function assertEqual(a: Document, b: Document): void {
  const r = semanticDocumentEquals(a, b);
  assert.equal(r.status, 'ok');
  assert.equal(r.status === 'ok' && r.equal, true);
}

function assertNotEqual(a: Document, b: Document): void {
  const r = semanticDocumentEquals(a, b);
  assert.equal(r.status, 'ok');
  assert.equal(r.status === 'ok' && r.equal, false);
}

test('structurally identical documents are equal', () => {
  assertEqual(
    doc([heading(1, [text('Title')]), paragraph([text('Body')])]),
    doc([heading(1, [text('Title')]), paragraph([text('Body')])]),
  );
});

test('differences in any semantic field are detected', () => {
  assertNotEqual(doc([paragraph([text('a')])]), doc([paragraph([text('b')])]));
  assertNotEqual(doc([heading(1, [text('x')])]), doc([heading(2, [text('x')])]));
  assertNotEqual(doc([paragraph([text('a')])]), doc([paragraph([text('a')], { id: 'p1' })]));
});

test('array order is significant', () => {
  assertNotEqual(
    doc([paragraph([text('one')]), paragraph([text('two')])]),
    doc([paragraph([text('two')]), paragraph([text('one')])]),
  );
});

test('ignores a range field on an AST node (tooling source location)', () => {
  const withRange = doc([
    {
      ...paragraph([{ ...text('x'), range: { start: {}, end: {} } } as never]),
      range: { start: {}, end: {} },
    } as never,
  ]);
  assertEqual(withRange, doc([paragraph([text('x')])]));
});

test('a data-range attribute is a compared semantic value, not ignored', () => {
  const withAttr = (value: string): Document =>
    doc([
      paragraph([
        {
          type: 'metadataSpan',
          attrs: { dataAttrs: { range: value } },
          children: [text('x')],
        },
      ] as never),
    ]);
  assertEqual(withAttr('left'), withAttr('left'));
  assertNotEqual(withAttr('left'), withAttr('right'));
});

test('omitted optional and explicit undefined compare equal', () => {
  assertEqual(
    doc([paragraph([text('a')], { id: undefined as never })]),
    doc([paragraph([text('a')])]),
  );
});

test('an extra defined key makes objects unequal', () => {
  assertNotEqual(
    doc([{ ...paragraph([text('a')]), extra: 1 } as never]),
    doc([paragraph([text('a')])]),
  );
});

test('footnote array order participates in equality', () => {
  const a = doc(
    [paragraph([text('body')])],
    [
      { type: 'footnoteDefinition', identifier: 'a', children: [text('A')] },
      { type: 'footnoteDefinition', identifier: 'b', children: [text('B')] },
    ],
  );
  const b = doc(
    [paragraph([text('body')])],
    [
      { type: 'footnoteDefinition', identifier: 'b', children: [text('B')] },
      { type: 'footnoteDefinition', identifier: 'a', children: [text('A')] },
    ],
  );
  assertNotEqual(a, b);
});

test('deep nesting does not overflow the call stack', () => {
  const left = doc([deeplyNestedList(20_000)]);
  const right = doc([deeplyNestedList(20_000)]);
  assertEqual(left, right);
});

test('exceeding the frame budget yields a resource result, not inequality', () => {
  const left = doc([deeplyNestedList(5_000)]);
  const right = doc([deeplyNestedList(5_000)]);
  const r = semanticDocumentEquals(left, right, { maxFrames: 50 });
  assert.equal(r.status, 'resource');
  assert.equal(r.status === 'resource' && r.diagnostics[0]?.category, 'resource');
});

test('the node budget is exact — no off-by-one past maxNodes', () => {
  const tiny = doc([paragraph([text('x')])]);
  // Traversal visits well more than 3 frames; a budget below that must trip.
  const r = semanticDocumentEquals(tiny, doc([paragraph([text('x')])]), { maxNodes: 3 });
  assert.equal(r.status, 'resource');
});

test('a very wide array trips the frame budget before mass-pushing children', () => {
  const wide = (): Document =>
    doc([paragraph(Array.from({ length: 10_000 }, (_, i) => text(`t${i}`)))]);
  const r = semanticDocumentEquals(wide(), wide(), { maxFrames: 100 });
  assert.equal(r.status, 'resource');
});

test('quote regions compare by flat level records', () => {
  const region = quoteRegion([
    quoteBlock(1, paragraph([text('outer')])),
    quoteBlock(2, paragraph([text('inner')])),
  ]);
  assertEqual(doc([region]), doc([
    quoteRegion([
      quoteBlock(1, paragraph([text('outer')])),
      quoteBlock(2, paragraph([text('inner')])),
    ]),
  ]));
  assertNotEqual(doc([region]), doc([
    quoteRegion([
      quoteBlock(1, paragraph([text('outer')])),
      quoteBlock(1, paragraph([text('inner')])),
    ]),
  ]));
});
