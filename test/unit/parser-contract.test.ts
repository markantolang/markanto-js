import test from 'node:test';
import assert from 'node:assert/strict';

import type { Document, FootnoteDefinition, Heading } from '../../src/ast.js';
import {
  createSourceAnnotationBuilder,
  SourceAnnotationBuilder,
} from '../../src/parser-contract.js';
import { openSource } from '../../src/source/index.js';
import { semanticDocumentEquals } from '../../src/semantic-equality.js';
import { doc, heading, paragraph, text } from '../helpers/ast-builders.js';

/**
 * A synthetic "parse": build a document plus a sealed annotation sidecar from a
 * known source, the way a real parser will in Phase 1+. `set` takes normalised
 * parser offsets; the builder projects them into the public (raw) space.
 */
function synthParse(raw: string): {
  document: Document;
  annotations: ReturnType<SourceAnnotationBuilder['seal']>;
} {
  const src = openSource(raw);
  const b = createSourceAnnotationBuilder(src);

  // normalised text is always "# Title\n\nBody paragraph.\n\n[^n]: note\n"
  //   0 "# Title"          [0,7)
  //   9 "Body paragraph."  [9,24)
  //   26 "[^n]: note"      [26,36)
  const h: Heading = heading(1, [text('Title')]);
  const p = paragraph([text('Body paragraph.')]);
  const fn: FootnoteDefinition = {
    type: 'footnoteDefinition',
    identifier: 'n',
    children: [text('note')],
  };
  const document = doc([h, p], [fn]);

  b.set(document, 0, src.text.length);
  b.set(h, 0, 7); // "# Title"
  b.set(h.children[0], 2, 7); // "Title"
  b.set(p, 9, 24); // "Body paragraph."
  b.set(p.children[0], 9, 24);
  b.set(fn, 26, 36); // "[^n]: note"
  b.set(fn.children[0], 32, 36); // "note"

  return { document, annotations: b.seal() };
}

const LF_SOURCE = '# Title\n\nBody paragraph.\n\n[^n]: note\n';

test('top-level editor block ranges are reconstructible from the sidecar', () => {
  const { document, annotations } = synthParse(LF_SOURCE);

  const blockRanges = document.children.map((block) => {
    const a = annotations.forNode(block);
    assert.ok(a, `block ${block.type} has an annotation`);
    return [a.range.start.offset, a.range.end.offset] as const;
  });

  assert.deepEqual(blockRanges, [
    [0, 7],
    [9, 24],
  ]);
  assert.equal(LF_SOURCE.slice(0, 7), '# Title');
  assert.equal(LF_SOURCE.slice(9, 24), 'Body paragraph.');
});

test('footnote definitions and inline nodes are annotated too', () => {
  const { document, annotations } = synthParse(LF_SOURCE);

  const fnAnn = annotations.forNode(document.footnotes[0]!);
  assert.ok(fnAnn);
  assert.equal(LF_SOURCE.slice(fnAnn.range.start.offset, fnAnn.range.end.offset), '[^n]: note');

  const inlineAnn = annotations.forNode((document.children[0] as Heading).children[0]);
  assert.ok(inlineAnn);
  assert.equal(LF_SOURCE.slice(inlineAnn.range.start.offset, inlineAnn.range.end.offset), 'Title');
});

test('the offset unit is declared once on the sidecar', () => {
  const { annotations } = synthParse(LF_SOURCE);
  assert.equal(annotations.offsetUnit, 'utf16-code-unit');
});

test('sidecar ranges are in the raw coordinate space (BOM removed, CRLF preserved)', () => {
  // BOM + CRLF everywhere; normalised text is the same LF_SOURCE
  const { document, annotations } = synthParse('﻿# Title\r\n\r\nBody paragraph.\r\n\r\n[^n]: note\r\n');
  const raw = '# Title\r\n\r\nBody paragraph.\r\n\r\n[^n]: note\r\n'; // BOM already excluded

  const p = document.children[1]!;
  const a = annotations.forNode(p)!;
  // normalised [9,24) -> raw shifted by the 2 collapsed CRLFs before offset 9
  assert.equal(a.range.start.offset, 11);
  assert.equal(raw.slice(a.range.start.offset, a.range.end.offset), 'Body paragraph.');
  // line/column are in raw coordinates
  assert.equal(a.range.start.line, 3);
  assert.equal(a.range.start.column, 1);
});

test('forNode returns undefined for a node not from this result', () => {
  const { annotations } = synthParse(LF_SOURCE);
  assert.equal(annotations.forNode(paragraph([text('other')])), undefined);
  assert.equal(annotations.has(paragraph([text('other')])), false);
});

function builderFor(raw: string): {
  b: SourceAnnotationBuilder;
  normalizedLength: number;
} {
  const src = openSource(raw);
  return {
    b: createSourceAnnotationBuilder(src),
    normalizedLength: src.text.length,
  };
}

test('a sealed sidecar is immutable, including its offsetUnit', () => {
  const { b } = builderFor(LF_SOURCE);
  const node = paragraph([text('x')]);
  b.set(node, 0, 1);
  const sealed = b.seal();

  assert.throws(() => b.set(paragraph([text('y')]), 0, 1), /seal\(\)/);
  assert.equal(Object.isFrozen(sealed), true);
  const ann = sealed.forNode(node)!;
  assert.equal(Object.isFrozen(ann), true);
  assert.equal(Object.isFrozen(ann.range), true);
  assert.equal(Object.isFrozen(ann.range.start), true);
});

test('the builder rejects out-of-range / malformed offsets', () => {
  const { b, normalizedLength } = builderFor(LF_SOURCE);
  const n = paragraph([text('x')]);
  assert.throws(() => b.set(n, -1, 3), RangeError);
  assert.throws(() => b.set(n, 1.5, 3), RangeError);
  assert.throws(() => b.set(n, Number.NaN, 3), RangeError);
  assert.throws(() => b.set(n, 5, 3), RangeError); // start > end
  assert.throws(() => b.set(n, 0, normalizedLength + 1), RangeError);
  // the boundary value is allowed
  assert.doesNotThrow(() => b.set(n, 0, normalizedLength));
});

test('lazy annotations: forNode is stable, memoised, and exact', () => {
  const { b } = builderFor(LF_SOURCE);
  const first = paragraph([text('a')]);
  const second = paragraph([text('b')]);
  b.set(first, 0, 1);
  b.set(second, 0, 0); // packed value 0 must not read as "missing"

  // materialisation happens after seal(), lazily, and is identical each call
  const sealed = b.seal();
  const a1 = sealed.forNode(first)!;
  const a2 = sealed.forNode(first)!;
  assert.strictEqual(a1, a2);
  assert.equal(Object.isFrozen(a1), true);
  assert.equal(a1.range.start.offset, 0);
  assert.equal(a1.range.end.offset, 1);

  const z = sealed.forNode(second)!;
  assert.equal(z.range.start.offset, 0);
  assert.equal(z.range.end.offset, 0);
  assert.strictEqual(sealed.forNode(second), z);

  // the pre-seal handle memoises to the same object
  assert.strictEqual(b.forNode(first), a1);
});

test('lazy annotations decode exactly for a large (still packable) source', () => {
  // a source big enough to exercise multi-digit line/column arithmetic
  const src = openSource(`${'x\n'.repeat(20_000)}tail\n`);
  const b = createSourceAnnotationBuilder(src);
  const node = paragraph([text('t')]);
  const start = src.text.length - 5; // start of "tail"
  b.set(node, start, start + 4);
  const ann = b.seal().forNode(node)!;
  assert.equal(ann.range.start.offset, start);
  assert.equal(ann.range.end.offset, start + 4);
  assert.equal(ann.range.start.line, 20_001);
  assert.equal(ann.range.start.column, 1);
});

test('lazy annotations use the tuple fallback above the ~95 M packing cutoff', () => {
  // A fake source context: `text.length` beyond `sqrt(MAX_SAFE_INTEGER) - 1`
  // forces `stride === 0` (the `[start, end]` tuple path) without allocating
  // a 190 MB string. `spanAt` echoes offsets so we can check the decode.
  const hugeLength = 100_000_000; // > 94_906_265
  const fakeContext = {
    text: { length: hugeLength } as unknown as string,
    toSourceOffset: (offset: number) => offset,
    sourceMap: {
      spanAt: (from: number, to: number) => ({
        start: { line: 1, column: from + 1, offset: from },
        end: { line: 1, column: to + 1, offset: to },
      }),
    },
  } as unknown as ConstructorParameters<typeof SourceAnnotationBuilder>[1];

  const b = new SourceAnnotationBuilder('utf16-code-unit', fakeContext);
  const node = paragraph([text('x')]);
  const start = hugeLength - 12;
  b.set(node, start, start + 7);

  const view = b.seal();
  const ann = view.forNode(node)!;
  assert.equal(ann.range.start.offset, start);
  assert.equal(ann.range.end.offset, start + 7);
  assert.equal(Object.isFrozen(ann.range.start), true);
  assert.strictEqual(view.forNode(node), ann); // memoised

  // packed-path arithmetic would have overflowed here — confirm it did not run
  assert.notEqual(ann.range.start.offset, ann.range.end.offset);
});

test('sidecar line/column are correct after a lone CR (invalid but recoverable)', () => {
  const src = openSource('a\rb\n');
  // normalised "a\nb\n"; raw public space keeps the lone CR
  assert.equal(src.sourceMap.pointAt(2).line, 2);
  assert.equal(src.sourceMap.pointAt(2).column, 1);
  assert.equal(src.sourceMap.pointAt(0).line, 1);
});

test('annotation differences do not change semantic equality', () => {
  const left = synthParse(LF_SOURCE);
  const right = synthParse(LF_SOURCE);

  const eq = semanticDocumentEquals(left.document, right.document);
  assert.equal(eq.status === 'ok' && eq.equal, true);

  // a document with no annotations at all still compares equal
  const bare = doc(
    [heading(1, [text('Title')]), paragraph([text('Body paragraph.')])],
    [{ type: 'footnoteDefinition', identifier: 'n', children: [text('note')] }],
  );
  const eq2 = semanticDocumentEquals(left.document, bare);
  assert.equal(eq2.status === 'ok' && eq2.equal, true);
});
