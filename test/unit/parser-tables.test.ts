import assert from 'node:assert/strict';
import test from 'node:test';
import { format, parse, semanticDocumentEquals } from '../../src/index.js';
import { separatorAlignments, tokenizeRow } from '../../src/parser/tables.js';
import { LineReader } from '../../src/source/index.js';

function cells(source: string): string[] {
  const line = new LineReader(`${source}\n`).current!;
  return tokenizeRow(source, line.start, line.contentEnd).map((span) => source.slice(span.start, span.end));
}

test('the row tokenizer honours edge pipes, escapes, and atomic inline tokens', () => {
  assert.deepEqual(cells('| a | b |'), ['a', 'b']);
  assert.deepEqual(cells('a | b'), ['a', 'b']);
  assert.deepEqual(cells('| x\\|y | z |'), ['x\\|y', 'z']);
  assert.deepEqual(cells('| `a|b` | c |'), ['`a|b`', 'c']);
  assert.deepEqual(cells('| [t](http://x/a|b) | c |'), ['[t](http://x/a|b)', 'c']);
  assert.deepEqual(cells('|  | x |'), ['', 'x']);
});

test('separator rows classify alignment and reject non-separator cells', () => {
  const parse2 = (row: string): (string | null)[] => {
    const line = new LineReader(`${row}\n`).current!;
    const spans = tokenizeRow(row, line.start, line.contentEnd);
    return [separatorAlignments(row, spans)].map((r) => (r === null ? null : r.join(',')));
  };
  assert.deepEqual(parse2('| --- | :--- | ---: | :---: |'), ['default,left,right,center']);
  assert.deepEqual(parse2('| -- | not |'), [null]);
});

test('a table needs a confirming separator; without one it is a paragraph', () => {
  const table = parse('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
  assert.equal(table.status, 'ok');
  if (table.status === 'ok') assert.equal(table.document.children[0]?.type, 'table');

  const notTable = parse('| A | B |\n| 1 | 2 |\n');
  assert.equal(notTable.status, 'ok');
  if (notTable.status === 'ok') assert.equal(notTable.document.children[0]?.type, 'paragraph');
});

test('a body row with the wrong cell count is a syntax error', () => {
  for (const source of ['| A | B |\n| --- | --- |\n| 1 |\n', '| A | B |\n| --- | --- |\n| 1 | 2 | 3 |\n']) {
    const result = parse(source);
    assert.equal(result.status, 'invalid');
    if (result.status === 'invalid') assert.equal(result.diagnostics[0]?.category, 'syntax');
  }
});

test('`^` and `<` in a cell are ordinary literal content, never span geometry', () => {
  const result = parse('| A | B |\n| --- | --- |\n| ^ | < |\n');
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  const table = result.document.children[0]!;
  assert.equal(table.type, 'table');
  if (table.type !== 'table') return;
  assert.deepEqual(table.body[0]!.cells.map((cell) => cell.children), [
    [{ type: 'text', value: '^' }],
    [{ type: 'text', value: '<' }],
  ]);
});

test('an unmatched cell delimiter becomes literal text without losing the cell', () => {
  for (const source of [
    '| *oops | x |\n| --- | --- |\n',           // header cell
    '| a | b |\n| --- | --- |\n| c | *oops |\n', // body cell
  ]) {
    const result = parse(source);
    assert.equal(result.status, 'ok', source);
    if (result.status !== 'ok') continue;
    const formatted = format(result.document);
    assert.equal(formatted.status, 'ok');
    if (formatted.status === 'ok') assert.equal(parse(formatted.source, { strict: true }).status, 'ok');
    assert.equal(parse(source, { strict: true }).status, 'invalid');
  }
});

test('a pipe inside a complete atomic token never confirms or splits a table', () => {
  // Candidate probe and tokenizer share `atomicTokenEnd`, so both agree.
  const notTable = parse('x [t](a|b)\n|---|\n');
  assert.equal(notTable.status, 'ok');
  if (notTable.status === 'ok') assert.equal(notTable.document.children[0]?.type, 'paragraph');

  // `<a|b@c.de>` is not an email autolink (`|` outside the alphabet), so the
  // pipe is a real delimiter — matching the inline scanner (M1).
  const emailish = parse('<a|b@c.de>\n|---|---|\n');
  assert.equal(emailish.status, 'ok');
  if (emailish.status === 'ok') {
    assert.equal(emailish.document.children[0]?.type, 'table');
    if (emailish.document.children[0]?.type === 'table') assert.equal(emailish.document.children[0].alignments.length, 2);
  }

  for (const source of [
    '| [t](/x?a|b) | y |\n| --- | --- |\n',
    '| `a|b` | y |\n| --- | --- |\n',
    '| <m data-x="</m>|x">z</m> | y |\n| --- | --- |\n',
    '| see https://ex.com/a|b | y |\n| --- | --- |\n',
  ]) {
    const result = parse(source);
    assert.equal(result.status, 'ok', source);
    if (result.status !== 'ok') continue;
    const table = result.document.children[0]!;
    assert.equal(table.type, 'table', source);
    if (table.type === 'table') assert.equal(table.alignments.length, 2, source);
    const formatted = format(result.document);
    assert.equal(formatted.status, 'ok');
    if (formatted.status === 'ok') {
      assert.equal(parse(formatted.source, { strict: true }).status, 'ok', `round-trip ${source}`);
    }
  }
});

test('a table interrupts a paragraph and normalises padding on a strict round-trip', () => {
  const parsed = parse('para\n| Name  | Value |\n|-------|------:|\n| Width | 100   |\n');
  assert.equal(parsed.status, 'ok');
  if (parsed.status !== 'ok') return;
  assert.deepEqual(parsed.document.children.map((child) => child.type), ['paragraph', 'table']);
  const formatted = format(parsed.document);
  assert.equal(formatted.status, 'ok');
  if (formatted.status !== 'ok') return;
  assert.equal(formatted.source, 'para\n\n| Name | Value |\n| --- | ---: |\n| Width | 100 |\n');
  const roundtrip = parse(formatted.source, { strict: true });
  assert.equal(roundtrip.status, 'ok');
  if (roundtrip.status === 'ok') {
    assert.deepEqual(semanticDocumentEquals(roundtrip.document, parsed.document), { status: 'ok', equal: true });
  }
});
