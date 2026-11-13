import assert from 'node:assert/strict';
import test from 'node:test';

import { parse } from '../../src/index.js';

// What the Markanto 0.3.0 diagnostics say and where they point (spec §7.8). The fixtures state category and
// severity; the wording and the ranges live here.

function only(source: string): { category: string; message: string; text: string } {
  const parsed = parse(source);
  assert.equal(parsed.diagnostics.length, 1, `${JSON.stringify(source)}: ${parsed.diagnostics.map((d) => d.message).join(' | ')}`);
  const [diagnostic] = parsed.diagnostics;
  const range = diagnostic!.range!;
  return { category: diagnostic!.category, message: diagnostic!.message!, text: source.slice(range.start.offset, range.end.offset) };
}

test('an opener of the same kind names the escape that writes it as text (§10.6, §10.8)', () => {
  for (const [source, message] of [
    ['*a *b* c*\n', '`*` opens an emphasis inside an emphasis that is still open: `\\*` writes it as text'],
    ['**a **b** c**\n', '`**` opens a strong emphasis inside a strong emphasis that is still open: `\\*\\*` writes it as text'],
    ['_a _b_ c_\n', '`_` opens an emphasis inside an emphasis that is still open: `\\_` writes it as text'],
    ['__a __b__ c__\n', '`__` opens a strong emphasis inside a strong emphasis that is still open: `\\__` writes it as text'],
    ['<i>a <i>b</i> c</i>\n', 'An emphasis is open already where `<i>` opens another: `\\<i>` writes the tag as text'],
    ['**a <b>b</b> c**\n', 'A strong emphasis is open already where `<b>` opens another: `\\<b>` writes the tag as text'],
  ] as const) {
    const parsed = parse(source);
    assert.equal(parsed.status, 'invalid', source);
    assert.equal(parsed.diagnostics[0]?.message, message, source);
  }
});

test('a malformed destination says what is wrong with it (§10.5.1)', () => {
  for (const [source, fault] of [
    ['[a](foo bar)\n', 'a space in the destination — put the destination in `<…>` or write the space as `%20`'],
    ['[a]( foo)\n', 'a space in the destination — put the destination in `<…>` or write the space as `%20`'],
    ['[a](foo(bar)\n', 'the destination is not closed with `)`'],
    ['[a](foo(bar\n', 'an unbalanced parenthesis in the destination — write it as `\\(` or `\\)`'],
    ['[a](<foo\n', 'the destination opened with `<` has no `>`'],
    ['[a](u "t" x)\n', 'a malformed title — only `)` may follow it'],
    ['[a](u "t\n', 'the link title is not closed'],
  ] as const) {
    const parsed = parse(source);
    assert.equal(parsed.status, 'invalid', source);
    assert.equal(parsed.diagnostics[0]?.message, `invalid link destination after \`](\`: ${fault}`, source);
  }
  // the forms the message names are read
  assert.equal(parse('[a](<foo bar>)\n').status, 'ok');
  assert.equal(parse('[a](foo%20bar)\n').status, 'ok');
});

test('an unclosed backtick and an info string with more than one field say what to write (§10.9, §2.4)', () => {
  assert.equal(parse('use `foo\n').diagnostics[0]?.message, 'unclosed inline code: write \\` for a literal backtick');
  assert.equal(parse('```python {1-3}\nx\n```\n').diagnostics[0]?.message,
    'code fence info string must be one token: only the language stands after the fence, as in ```python');
});

test('a line without `>` after a quote is reported on that line (§3.7)', () => {
  assert.deepEqual(only('> Quote.\nText.\n'), {
    category: 'advisory', text: 'Text.',
    message: 'a line without `>` ends the quote: start it with `>` to continue the quote, or put a blank line before it',
  });
  // in a list item the range is projected to the physical line
  assert.equal(only('- A\n\n  > Quote.\n  Text.\n').text, 'Text.');
  // the boundary of the owning sequence is checked before the warning: a Grid marker, a container closer
  for (const source of [':::\n> a\n--\nb\n:::\n', '::: box\n> a\n:::\n', '___\n\n> a\n___\n', '> a\n-- Author\n', '> a\n{#q}\n']) {
    assert.deepEqual(parse(source).diagnostics, [], source);
  }
});

test('tag-like text is reported from its `<` to its `>`, and stays text (§10.4)', () => {
  assert.deepEqual(only('A <br> b.\n'), {
    category: 'advisory', text: '<br>', message: '`<br>` is shown as written: Markanto reads no HTML, and its only tags are <m>, <i> and <b>',
  });
  assert.equal(only('x <div class="a">\n').message, '`<div …>` is shown as written: Markanto reads no HTML, and its only tags are <m>, <i> and <b>');
  // the `>` may stand on a later line of the paragraph; in a list item the range is projected
  assert.equal(only('- a <span\n  title="t"> b\n').text, '<span\n  title="t">');
  for (const source of ['`<br>`\n', '$`<br>`$\n', 'x^<b>^\n', '[x](<a>)\n', '\\<br>\n', '&lt;br>\n', 'a<b\n', '<irc://x>\n', '<MAILTO:x>\n', '<https://example.org>\n', 'a < b > c\n']) {
    assert.deepEqual(parse(source).diagnostics, [], source);
  }
});

test('a paragraph that begins like a link-reference definition is reported once (§10.5)', () => {
  assert.deepEqual(only('[docs]: https://example.org\nmore\n[x]: y\n'), {
    category: 'advisory', text: '[docs]:',
    message: 'a paragraph that begins with `[docs]:` is text: Markanto has no link-reference definitions — write the link where it is used, as `[text](target)`',
  });
  for (const source of ['Text\n[a]: b\n', '[]: b\n', '\\[a]: b\n', '[a] : b\n', '![a]: b\n']) {
    assert.deepEqual(parse(source).diagnostics, [], source);
  }
});

test('a tab in the leading whitespace of a paragraph gets the indentation advisory; a tab before a marker stays 9.5 (§7.4)', () => {
  assert.equal(only('\tProse.\n').category, 'advisory');
  assert.equal(only('  \tProse.\n').text, '  \tProse.');
  assert.deepEqual(parse('Prose\n\tcontinued.\n').diagnostics, []);
  const marker = parse('\t- item\n');
  assert.equal(marker.status, 'invalid');
  assert.equal(marker.diagnostics[0]?.message, 'tab in list indentation');
});
