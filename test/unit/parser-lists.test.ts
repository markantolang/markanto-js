import assert from 'node:assert/strict';
import test from 'node:test';
import { format, parse, semanticDocumentEquals } from '../../src/index.js';
import type { Document, List, ListItem, ListKind, Paragraph } from '../../src/ast.js';
import { scanListMarker } from '../../src/parser/lists.js';
import { LineReader } from '../../src/source/index.js';

test('list marker and task scanner covers all marker families', () => {
  for (const source of ['- x\n', '* x\n', '+ x\n', '2. x\n', '2) x\n', ': x\n', '- [ ] x\n', '- [X] x\n', '-  x\n', '1.   x\n', ':  x\n']) assert.notEqual(scanListMarker(source, new LineReader(source).current!), null);
  for (const source of ['- \n', '-   \n', ':  \n', '-x\n', '- [x]x\n', '\t- x\n', '1000000000. x\n']) { const result = scanListMarker(source, new LineReader(source).current!); assert.ok(result !== null && 'error' in result); }
});

test('ordered numbering stores only start and real deviations', () => {
  const result = parse('3. Three\n7. Seven\n8. Eight\n'); assert.equal(result.status, 'ok'); if (result.status !== 'ok') return;
  const list = result.document.children[0]; assert.equal(list?.type, 'list'); if (list?.type === 'list') { assert.equal(list.start, 3); assert.equal(list.items[0]?.value, undefined); assert.equal(list.items[1]?.value, 7); assert.equal(list.items[2]?.value, undefined); }
});

test('structured children, sublists, definitions, and kind switches remain distinct', () => {
  for (const source of ['- Intro\n\n  Second.\n', '- Parent\n  - Child\n', ': A\n: B\n\n  Definition.\n', ': Term\n- Item\n']) { const parsed = parse(source); assert.equal(parsed.status, 'ok', source); if (parsed.status === 'ok') assert.equal(format(parsed.document).status, 'ok'); }
  const switched = parse(': Term\n- Item\n'); if (switched.status === 'ok') assert.deepEqual(switched.document.children.map((node) => node.type), ['list', 'list']);
});

test('recursive list-quote-list annotations project to original offsets', () => {
  const source = '- Outer\n\n  > Context.\n  >\n  > - Inner\n  >   - Child\n'; const parsed = parse(source); assert.equal(parsed.status, 'ok'); if (parsed.status !== 'ok') return;
  const outer = parsed.document.children[0]!; assert.equal(outer.type, 'list'); assert.equal(parsed.annotations.forNode(outer)?.range.start.offset, 0);
  const formatted = format(parsed.document); assert.equal(formatted.status, 'ok'); if (formatted.status === 'ok') { const strict = parse(formatted.source, { strict: true }); assert.equal(strict.status, 'ok'); if (strict.status === 'ok') assert.deepEqual(semanticDocumentEquals(strict.document, parsed.document), { status: 'ok', equal: true }); }
});

test('mixed structural depth exhaustion is resource, never syntax', () => {
  const source = '- Outer\n\n  > Quote\n  > - Inner\n';
  const parsed = parse(source, { resourceBudget: { maxFrames: 2 } });
  assert.equal(parsed.status, 'resource');
  if (parsed.status === 'resource') assert.equal(parsed.diagnostics[0]?.category, 'resource');
});

test('list ids and canonical list ASTs round-trip strictly', () => {
  const parsed = parse('- A\n{#items}\n'); assert.equal(parsed.status, 'ok'); if (parsed.status !== 'ok') return;
  const formatted = format(parsed.document); assert.deepEqual(formatted, { status: 'ok', source: '- A\n{#items}\n', diagnostics: [] });
  if (formatted.status === 'ok') { const strict = parse(formatted.source, { strict: true }); assert.equal(strict.status, 'ok'); if (strict.status === 'ok') assert.deepEqual(semanticDocumentEquals(strict.document, parsed.document), { status: 'ok', equal: true }); }
});

test('canonical lists may grow one level per recursive frame beyond depth two', () => {
  for (const source of [
    '- a\n  - b\n    - c\n',
    '- a\n  - b\n    - c\n    - c2\n  - b2\n- a2\n',
  ]) {
    const parsed = parse(source);
    assert.equal(parsed.status, 'ok', source);
    if (parsed.status !== 'ok') continue;
    const level1 = parsed.document.children[0];
    assert.equal(level1?.type, 'list');
    if (level1?.type !== 'list') continue;
    const level2 = level1.items[0]?.children[1];
    assert.equal(level2?.type, 'list');
    if (level2?.type !== 'list') continue;
    const level3 = level2.items[0]?.children[1];
    assert.equal(level3?.type, 'list');
    const formatted = format(parsed.document);
    assert.equal(formatted.status, 'ok');
    if (formatted.status === 'ok') {
      assert.equal(formatted.source, source);
      const strict = parse(formatted.source, { strict: true });
      assert.equal(strict.status, 'ok');
      if (strict.status === 'ok') assert.deepEqual(semanticDocumentEquals(strict.document, parsed.document), { status: 'ok', equal: true });
    }
  }
});

test('a nested marker on a column §9.4 does not read is error 9.3, and says which columns it reads (§7.8)', () => {
  for (const [source, message] of [
    ['- One\n      - Too deep\n', "nested list marker indented 6 spaces from its parent's marker: a nested list is read two or four spaces in"],
    ['- A\n   - B\n', "nested list marker indented 3 spaces from its parent's marker: a nested list is read two or four spaces in"],
    ['1. A\n     - B\n', "nested list marker indented 5 spaces from its parent's marker: a nested list is read two spaces in, on its content column 3 spaces in, or four spaces in"],
    // measured from the innermost open item: under `- B` (at two) a marker at five stands three in
    ['- A\n  - B\n     - C\n', "nested list marker indented 3 spaces from its parent's marker: a nested list is read two or four spaces in"],
    ['  - A\n', 'list marker indented 2 spaces: a list that is not nested in a list item starts without indentation'],
  ] as const) {
    const parsed = parse(source);
    assert.equal(parsed.status, 'invalid', source);
    assert.equal(parsed.diagnostics[0]?.category, 'syntax', source);
    assert.equal(parsed.diagnostics[0]?.message, message, source);
  }
});

test('a nested marker reads two spaces, the content column, or four, unbound to the first child (§9.4)', () => {
  const nested = (source: string): string => {
    const parsed = parse(source);
    assert.equal(parsed.status, 'ok', source);
    if (parsed.status !== 'ok') return '';
    const formatted = format(parsed.document);
    return formatted.status === 'ok' ? formatted.source : '';
  };
  assert.equal(nested('- A\n    - B\n'), '- A\n  - B\n');
  assert.equal(nested('1. A\n    - B\n'), '1. A\n  - B\n');
  assert.equal(nested('1. A\n  - B\n   - C\n'), '1. A\n  - B\n  - C\n');
  assert.equal(nested('1. A\n   - B\n    - C\n'), '1. A\n  - B\n  - C\n');
  // the canonical column is assigned first: four under `- B` at two is B's child
  assert.equal(nested('- A\n  - B\n    - C\n'), '- A\n  - B\n    - C\n');
});

test('after a blank line a line from the item\'s base stays in the item; four surplus spaces get the advisory (§9.8)', () => {
  const inItem = parse('- x\n\n     y\n'); // 5 spaces = 3 past the base
  assert.equal(inItem.status, 'ok');
  if (inItem.status === 'ok') {
    const list = inItem.document.children[0];
    assert.ok(list?.type === 'list' && list.items[0]!.children.map((b) => b.type).join(',') === 'paragraph,paragraph');
    assert.deepEqual(inItem.diagnostics, []);
  }

  // 0.2.3 ended the list here; 0.3.0 keeps the line in the item, with the advisory of §1.2
  const deep = parse('- x\n\n      y\n'); // 6 spaces = 4 past the base
  assert.equal(deep.status, 'ok');
  if (deep.status === 'ok') {
    assert.deepEqual(deep.document.children.map((b) => b.type), ['list']);
    const list = deep.document.children[0];
    assert.ok(list?.type === 'list' && list.items[0]!.children.map((b) => b.type).join(',') === 'paragraph,paragraph');
    assert.deepEqual(deep.diagnostics.map(({ category, severity }) => ({ category, severity })), [{ category: 'advisory', severity: 'warning' }]);
  }

  // strict mode rejects the noncanonical indentation rather than silently keeping it
  assert.equal(parse('- x\n\n      y\n', { strict: true }).status, 'invalid');
});

test('a soft break in a nested item reads back into that item from its canonical form (§9.6; 0.2.x gave it to the parent)', () => {
  const kinds: readonly ListKind[] = ['unordered', 'ordered', 'definition'];
  const brokenParagraph = (word: string): Paragraph =>
    ({ type: 'paragraph', children: [{ type: 'text', value: word }, { type: 'softBreak' }, { type: 'text', value: `${word} continued` }] });
  // One item per level, the innermost first; `everyLevel` breaks the paragraph of each item, else only the deepest.
  const nestedList = (levels: readonly ListKind[], everyLevel: boolean, task: boolean): List => {
    let inner: List | null = null;
    for (let level = levels.length - 1; level >= 0; level -= 1) {
      const kind = levels[level]!;
      const word = `level${level + 1}`;
      const paragraph: Paragraph = inner === null || everyLevel ? brokenParagraph(word) : { type: 'paragraph', children: [{ type: 'text', value: word }] };
      const item: ListItem = {
        type: 'listItem',
        ...(task && kind !== 'definition' ? { task: 'done' as const } : {}),
        children: inner === null ? [paragraph] : [paragraph, inner],
      };
      inner = { type: 'list', kind, items: [item] };
    }
    return inner!;
  };
  for (const outer of kinds) for (const middle of kinds) for (const innermost of [null, ...kinds]) {
    const levels = innermost === null ? [outer, middle] : [outer, middle, innermost];
    for (const everyLevel of [false, true]) for (const task of [false, true]) {
      const document: Document = { type: 'document', children: [nestedList(levels, everyLevel, task)], footnotes: [] };
      const formatted = format(document);
      assert.equal(formatted.status, 'ok');
      if (formatted.status !== 'ok') continue;
      const reparsed = parse(formatted.source, { strict: true });
      assert.equal(reparsed.status, 'ok', JSON.stringify(formatted.source));
      if (reparsed.status !== 'ok') continue;
      assert.deepEqual(semanticDocumentEquals(reparsed.document, document), { status: 'ok', equal: true }, JSON.stringify(formatted.source));
    }
  }
});

test('the canonical second block of a third-level item reads back into that item (§9.8; 0.2.3 lost it)', () => {
  const source = '- A\n  - B\n    - C\n\n      text\n';
  const parsed = parse(source, { strict: true });
  assert.equal(parsed.status, 'ok');
  if (parsed.status !== 'ok') return;
  const formatted = format(parsed.document);
  assert.equal(formatted.status === 'ok' && formatted.source, source);
  const a = parsed.document.children[0];
  assert.ok(a?.type === 'list');
  const b = a.items[0].children[1];
  assert.ok(b?.type === 'list');
  const c = b.items[0].children[1];
  assert.ok(c?.type === 'list');
  assert.deepEqual(c.items[0].children.map((block) => block.type), ['paragraph', 'paragraph']);
});

test('leading spaces on a paragraph line are skipped, never kept as Text (M5, §7.7)', () => {
  for (const [source, expected] of [
    ['      y\n', 'y'],
    ['   y\n', 'y'],
    ['x\n      y\n', 'x'],
  ] as const) {
    const result = parse(source);
    assert.equal(result.status, 'ok', source);
    if (result.status === 'ok') {
      const para = result.document.children[0];
      assert.ok(para?.type === 'paragraph' && para.children[0]?.type === 'text' && para.children[0].value === expected, source);
      assert.equal(format(result.document).status, 'ok');
    }
  }
});

test('a leading tab is literal content unless a list marker follows it (§7.4)', () => {
  // Bare `\t…` is an ordinary paragraph; the leading tab is skipped like spaces.
  const bare = parse('\ty\n');
  assert.equal(bare.status, 'ok');
  if (bare.status === 'ok') {
    const para = bare.document.children[0];
    assert.ok(para?.type === 'paragraph' && para.children[0]?.type === 'text' && para.children[0].value === 'y');
  }
  // An interior tab stays literal.
  const interior = parse('a\tb\n');
  assert.equal(interior.status, 'ok');
  if (interior.status === 'ok') {
    const para = interior.document.children[0];
    assert.ok(para?.type === 'paragraph' && para.children[0]?.type === 'text' && para.children[0].value === 'a\tb');
  }
  // A tab before a real list marker is still a structural error.
  for (const source of ['\t- item\n', '  \t- item\n', '\t1. x\n']) {
    const result = parse(source);
    assert.equal(result.status, 'invalid', source);
    if (result.status === 'invalid') assert.equal(result.diagnostics[0]?.message, 'tab in list indentation', source);
  }
});
