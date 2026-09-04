import assert from 'node:assert/strict';
import test from 'node:test';

import type { Document, DocumentBlock, Inline, List } from '../../src/ast.js';
import { format, parse, validate } from '../../src/index.js';

function paragraph(value = 'x'): DocumentBlock {
  return { type: 'paragraph', children: [{ type: 'text', value }] };
}

function nestedList(depth: number): Document {
  let child: DocumentBlock = paragraph();
  for (let index = 0; index < depth; index += 1) {
    child = {
      type: 'list', kind: 'unordered',
      items: [{ type: 'listItem', children: [paragraph(), child] }],
    } as List;
  }
  return { type: 'document', children: [child], footnotes: [] };
}

test('formats a 5000-deep list without recursion or quadratic reprocessing', () => {
  const started = performance.now();
  const result = format(nestedList(5_000));
  const elapsed = performance.now() - started;
  assert.equal(result.status, 'ok');
  assert.ok(elapsed < 1_000, `formatter took ${elapsed.toFixed(1)} ms`);
});

test('returns resource before traversing a 20000-deep list', () => {
  const result = format(nestedList(20_000));
  assert.equal(result.status, 'resource');
  assert.equal(result.diagnostics[0]?.category, 'resource');
});

test('a wide document is not mistaken for nesting exhaustion', () => {
  const document: Document = {
    type: 'document',
    children: Array.from({ length: 10_000 }, (_, index) => paragraph(`p${index}`)),
    footnotes: [],
  };
  assert.equal(format(document).status, 'ok');
});

test('an explicit formatter frame budget is honoured', () => {
  assert.equal(format(nestedList(20), { maxFrames: 10 }).status, 'resource');
});

test('deep inline nesting returns resource, not a RangeError (M4)', () => {
  const deepInline = (depth: number): Document => {
    let child: Inline = { type: 'text', value: 'x' };
    for (let index = 0; index < depth; index += 1) {
      child = { type: index % 2 === 0 ? 'em' : 'strong', children: [child] } as Inline;
    }
    return { type: 'document', children: [{ type: 'paragraph', children: [child] }], footnotes: [] };
  };
  assert.equal(format(deepInline(50), { maxFrames: 10 }).status, 'resource');
  assert.equal(format(deepInline(12_000)).status, 'resource');
  assert.equal(validate(deepInline(12_000)).status, 'resource');
  // a normal shallow nest still formats
  assert.equal(format(deepInline(3)).status, 'ok');
});

test('maxMatrixSlots bounds the Grid occupancy matrix in every stage (M4)', () => {
  const grid2x1 = {
    type: 'document', footnotes: [],
    children: [{
      type: 'container', form: 'fenced', containerType: null, title: null,
      children: [{
        type: 'grid', columns: 2,
        rows: [{
          type: 'gridRow', cells: [
            { type: 'gridCell', column: 1, children: [paragraph('a')] },
            { type: 'gridCell', column: 2, children: [paragraph('b')] },
          ],
        }],
      }],
    }],
  } as unknown as Document;
  assert.equal(format(grid2x1, { maxMatrixSlots: 1 }).status, 'resource');
  assert.equal(validate(grid2x1, { resourceBudget: { maxMatrixSlots: 1 } }).status, 'resource');
  assert.equal(format(grid2x1, { maxMatrixSlots: 2 }).status, 'ok');
});

const gridDoc = (columns: unknown, rows = 1, colSpan?: unknown): Document => ({
  type: 'document', footnotes: [],
  children: [{
    type: 'container', form: 'fenced', containerType: 'X', title: null,
    children: [{
      type: 'grid', columns,
      rows: Array.from({ length: rows }, () => ({
        type: 'gridRow',
        cells: [{
          type: 'gridCell', column: 1, children: [paragraph('x')],
          ...(colSpan === undefined ? {} : { colSpan }),
        }],
      })),
    }],
  }],
}) as unknown as Document;

test('a compact AST cannot name an unbounded Grid matrix without an explicit budget (B1)', () => {
  // ~200 bytes of AST, a multi-million-slot occupancy matrix. Before the default
  // limit `validate()`/`format()` allocated it (seconds of work, then `ok`), or
  // threw a native `RangeError: Invalid array length`. Now every stage rejects
  // it as `resource` with no allocation.
  for (const columns of [2 ** 32, 2 ** 32 - 1, 5_000_000, 2 ** 53, Number.MAX_SAFE_INTEGER]) {
    assert.equal(validate(gridDoc(columns, 1, columns)).status, 'resource', `validate columns=${columns}`);
    assert.equal(format(gridDoc(columns, 1, columns)).status, 'resource', `format columns=${columns}`);
  }
  // rows x columns: each dimension individually well under the limit, product over it
  assert.equal(format(gridDoc(400, 400, 400)).status, 'resource');
  assert.equal(validate(gridDoc(400, 400, 400)).status, 'resource');
  // an explicit budget above the slot count opts back in (a filled 50k-wide row)
  assert.equal(format(gridDoc(50_000, 1, 50_000), { maxMatrixSlots: 1_000_000 }).status, 'ok');
  assert.equal(
    validate(gridDoc(50_000, 1, 50_000), { resourceBudget: { maxMatrixSlots: 1_000_000 } }).status, 'ok',
  );
});

test('an explicit maxMatrixSlots cannot lift the hard matrix ceiling (B1-R1)', () => {
  // A caller may raise the default policy, but never past HARD_MAX_MATRIX_SLOTS.
  // `2**32` is already past the JavaScript array-length maximum; a budget of the
  // same size must not wave it through into an allocation / native RangeError.
  for (const explicit of [2 ** 32, Number.MAX_SAFE_INTEGER]) {
    const budget = { maxMatrixSlots: explicit };
    assert.equal(validate(gridDoc(2 ** 32, 1), { resourceBudget: budget }).status, 'resource');
    assert.equal(format(gridDoc(2 ** 32, 1), budget).status, 'resource');
  }
  // A matrix one slot past the hard ceiling is `resource` even with a budget
  // well above it — and the gate returns before any Array is allocated.
  const overCeiling = { maxMatrixSlots: 2_000_000 };
  assert.equal(validate(gridDoc(1_000_001, 1), { resourceBudget: overCeiling }).status, 'resource');
  assert.equal(format(gridDoc(1_000_001, 1), overCeiling).status, 'resource');
  // A previously valid opt-in stays valid: slots under the ceiling, budget above.
  assert.equal(format(gridDoc(50_000, 1, 50_000), { maxMatrixSlots: 200_000 }).status, 'ok');
  // An unusable budget value never disables the gate — it falls back to the
  // default policy, so a matrix past the default is still rejected.
  for (const bad of [NaN, Infinity, -1, '999999999' as unknown as number]) {
    assert.equal(format(gridDoc(500_000, 1), { maxMatrixSlots: bad }).status, 'resource', `format bad=${String(bad)}`);
    assert.equal(
      validate(gridDoc(500_000, 1), { resourceBudget: { maxMatrixSlots: bad } }).status, 'resource',
      `validate bad=${String(bad)}`,
    );
  }
});

test('no public API throws for a Grid dimension it cannot represent — resource or invalid, never RangeError', () => {
  const dims: unknown[] = [
    0, 1, -1, 3.5, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32, 2 ** 53 + 1,
    1e21, 1.8e308, '5', null, undefined, {},
  ];
  for (const columns of dims) {
    for (const colSpan of [undefined, columns]) {
      const doc = gridDoc(columns, 1, colSpan);
      for (const [label, run] of [['validate', () => validate(doc)], ['format', () => format(doc)]] as const) {
        let status: string;
        try { status = (run() as { status: string }).status; }
        catch (error) { assert.fail(`${label} threw for columns=${String(columns)}: ${(error as Error).message}`); }
        assert.ok(status === 'resource' || status === 'invalid', `${label} columns=${String(columns)} -> ${status}`);
      }
    }
  }
});

test('the parser shares the same matrix-budget gate', () => {
  // A parsed Grid is inherently source-bounded (every slot needs its own marker
  // or cell line), so the 100_000 default is only reachable from a very large
  // source; an explicit budget exercises the shared gate on a small one.
  const grid3 = '::: G\na\n--\nb\n--\nc\n:::\n';
  assert.equal(parse(grid3, { resourceBudget: { maxMatrixSlots: 2 } }).status, 'resource');
  assert.equal(parse(grid3, { resourceBudget: { maxMatrixSlots: 3 } }).status, 'ok');
  assert.equal(parse(grid3).status, 'ok');
});
