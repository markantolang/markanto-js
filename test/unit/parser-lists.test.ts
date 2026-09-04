import assert from 'node:assert/strict';
import test from 'node:test';
import { format, parse, semanticDocumentEquals } from '../../src/index.js';
import { scanListMarker } from '../../src/parser/lists.js';
import { LineReader } from '../../src/source/index.js';

test('list marker and task scanner covers all marker families', () => {
  for (const source of ['- x\n', '* x\n', '+ x\n', '2. x\n', '2) x\n', ': x\n', '- [ ] x\n', '- [X] x\n']) assert.notEqual(scanListMarker(source, new LineReader(source).current!), null);
  for (const source of ['- \n', ':  x\n', '- [x]x\n', '\t- x\n', '1000000000. x\n']) { const result = scanListMarker(source, new LineReader(source).current!); assert.ok(result !== null && 'error' in result); }
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

test('a direct two-level rise remains a syntax error in the recursive frame', () => {
  const parsed = parse('- One\n    - Too deep\n');
  assert.equal(parsed.status, 'invalid');
  if (parsed.status === 'invalid') {
    assert.equal(parsed.diagnostics[0]?.category, 'syntax');
    assert.equal(parsed.diagnostics[0]?.message, 'list level rises by more than one');
  }
});

test('a list continuation after a blank line ends at 4 spaces past the baseline (M5, §9.6)', () => {
  // 2-3 spaces past the 2-space item baseline stays in the item; 4+ (which
  // CommonMark makes an indented code block, and Markanto does not represent)
  // dedents the line out of the list.
  const inItem = parse('- x\n\n     y\n'); // 5 spaces = 3 past baseline
  assert.equal(inItem.status, 'ok');
  if (inItem.status === 'ok') {
    const list = inItem.document.children[0];
    assert.ok(list?.type === 'list' && list.items[0]!.children.map((b) => b.type).join(',') === 'paragraph,paragraph');
  }

  const dedented = parse('- x\n\n      y\n'); // 6 spaces = 4 past baseline
  assert.equal(dedented.status, 'ok');
  if (dedented.status === 'ok') {
    assert.deepEqual(dedented.document.children.map((b) => b.type), ['list', 'paragraph']);
    const trailing = dedented.document.children[1];
    assert.ok(trailing?.type === 'paragraph' && trailing.children.length === 1
      && trailing.children[0]?.type === 'text' && trailing.children[0].value === 'y');
  }

  // strict mode rejects the noncanonical indentation rather than silently keeping it
  assert.equal(parse('- x\n\n      y\n', { strict: true }).status, 'invalid');
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
