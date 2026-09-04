import assert from 'node:assert/strict';
import test from 'node:test';

import { format, parse, semanticDocumentEquals, validate } from '../../src/index.js';

/**
 * Regression cases from the candidate-triage sweep: the formatter must escape
 * (or wrapper-encode) constructs that would otherwise be re-recognised on
 * reparse, so `parse(format(x))` stays equal to `x` (spec §7.2 law 1).
 */
const CASES = [
  // block markers at a paragraph line start
  '\\# not a heading\n',
  '\\--- not a rule\n',
  '\\* not a list\n',
  '\\1. not ordered\n',
  '\\: not a definition\n',
  '\\:::not a container\n',
  '\\___\n',
  '\\> not a quote\n',
  'first line\n\\# continued, not a heading\n',
  'text\n\\--- still one paragraph\n',
  // intra-word emphasis has no `*` form and must stay a wrapper
  'a<i>b</i>c\n',
  'a<b>b</b>c\n',
  // a bare delimiter adjacent to an emphasis of the same character
  '\\**x**\n',
  '\\~~x~~\n',
  // `$` adjacent to a code span would open inline math
  '\\$`code`$\n',
  // an emphasis line right after an image + hard break is not a caption unless
  // it is the `*…*` carrier — the formatter must keep the wrapper form
  '![Alt](image.jpg)\\\n_Caption_\n',
  // a blank line inside a list item must carry no trailing indentation, or the
  // following block detaches to an outer level on reparse
  ': Fruit\n\n  : Apple\n\n    A fruit with a core.\n',
  '- one\n\n  a second paragraph\n\n- two\n',
];

for (const source of CASES) {
  test(`escapes for round-trip: ${JSON.stringify(source)}`, () => {
    const first = parse(source);
    assert.equal(first.status, 'ok', source);
    if (first.status !== 'ok') return;

    const formatted = format(first.document);
    assert.equal(formatted.status, 'ok');
    if (formatted.status !== 'ok') return;

    const strict = parse(formatted.source, { strict: true });
    assert.equal(strict.status, 'ok', `strict rejects ${JSON.stringify(formatted.source)}`);
    if (strict.status !== 'ok') return;

    assert.deepEqual(semanticDocumentEquals(first.document, strict.document), { status: 'ok', equal: true });

    const again = format(strict.document);
    assert.equal(again.status === 'ok' && again.source, formatted.source, 'not idempotent');
  });
}

test('a Grid cell paragraph that is exactly a Grid marker round-trips (B1)', () => {
  const gridDoc = (value: string): never => ({
    type: 'document', footnotes: [],
    children: [{
      type: 'container', form: 'fenced', containerType: null, title: null,
      children: [{
        type: 'grid', columns: 2,
        rows: [{
          type: 'gridRow', cells: [
            { type: 'gridCell', column: 1, children: [{ type: 'paragraph', children: [{ type: 'text', value }] }] },
            { type: 'gridCell', column: 2, children: [{ type: 'paragraph', children: [{ type: 'text', value: 'b' }] }] },
          ],
        }],
      }],
    }],
  }) as never;
  for (const marker of ['--', '==', '::', '^', '<']) {
    const formatted = format(gridDoc(marker));
    assert.equal(formatted.status, 'ok', marker);
    if (formatted.status !== 'ok') continue;
    const strict = parse(formatted.source, { strict: true });
    assert.equal(strict.status, 'ok', `strict rejects ${JSON.stringify(formatted.source)}`);
    if (strict.status !== 'ok') continue;
    assert.deepEqual(semanticDocumentEquals(gridDoc(marker), strict.document), { status: 'ok', equal: true }, marker);
    const again = format(strict.document);
    assert.equal(again.status === 'ok' && again.source, formatted.source, `not idempotent: ${marker}`);
  }
});

/**
 * AST-driven cases: a Text / Heading value can hold a string that the parser
 * never emits (an importer, `adoptDocument`, or a hand-built consumer can), and
 * whose bare surface would either be a competing block or a recogniser error.
 * `format` must produce a strict-valid, idempotent surface or a diagnostic —
 * never `ok` with a surface that reparses differently (spec §7.2 law 1/2).
 */
const doc = (block: unknown): never => ({ type: 'document', children: [block], footnotes: [] }) as never;
const para = (value: string): never => doc({ type: 'paragraph', children: [{ type: 'text', value }] });
const head = (level: number, value: string): never => doc({ type: 'heading', level, children: [{ type: 'text', value }] });

for (const [label, input, expectText] of [
  ['paragraph "-one"', para('-one'), '-one'],
  ['paragraph bare "-"', para('-'), '-'],
  ['paragraph "- spaced"', para('- spaced'), '- spaced'],
  ['paragraph ":x"', para(':x'), ':x'],
  ['paragraph ": def-shaped"', para(': def-shaped'), ': def-shaped'],
  ['paragraph ":::x"', para(':::x'), ':::x'],
  ['paragraph "1.two"', para('1.two'), '1.two'],
  ['paragraph "1. list-shaped"', para('1. list-shaped'), '1. list-shaped'],
  ['paragraph "10)two"', para('10)two'), '10)two'],
  ['paragraph "3.14 is pi"', para('3.14 is pi'), '3.14 is pi'],
  ['paragraph "1234567890. overflows"', para('1234567890. overflows'), '1234567890. overflows'],
  ['paragraph bare "*"', para('*'), '*'],
  ['paragraph bare "+"', para('+'), '+'],
  ['paragraph "--dash run stays text"', para('--dash run stays text'), '--dash run stays text'],
  ['paragraph "v1.2 note stays text"', para('v1.2 note stays text'), 'v1.2 note stays text'],
  ['heading "foo #"', head(2, 'foo #'), 'foo #'],
  ['heading "foo ###"', head(3, 'foo ###'), 'foo ###'],
  ['heading all hashes', head(1, '###'), '###'],
  ['heading "foo# tight"', head(2, 'foo# tight'), 'foo# tight'],
] as const) {
  test(`AST round-trip: ${label}`, () => {
    const formatted = format(input);
    assert.equal(formatted.status, 'ok', `${label}: format`);
    if (formatted.status !== 'ok') return;

    const strict = parse(formatted.source, { strict: true });
    assert.equal(strict.status, 'ok', `strict rejects ${JSON.stringify(formatted.source)}`);
    if (strict.status !== 'ok') return;

    const again = format(strict.document);
    assert.equal(again.status === 'ok' && again.source, formatted.source, 'not idempotent');

    // the reparsed leaf keeps exactly the intended text (nothing silently dropped)
    const leaf = strict.document.children[0];
    const kids = leaf?.type === 'paragraph' || leaf?.type === 'heading' ? leaf.children : [];
    assert.equal(kids.length === 1 && kids[0]?.type === 'text' && kids[0].value, expectText, JSON.stringify(formatted.source));
  });
}

test('a clean soft break stays a soft break, and whitespace hugging a break has no surface (Q1)', () => {
  // Clean AST: soft break round-trips as a soft break.
  const clean = doc({
    type: 'paragraph',
    children: [{ type: 'text', value: 'first' }, { type: 'softBreak' }, { type: 'text', value: 'second' }],
  }) as never;
  const formatted = format(clean);
  assert.equal(formatted.status, 'ok');
  if (formatted.status !== 'ok') return;
  const strict = parse(formatted.source, { strict: true });
  assert.equal(strict.status, 'ok');
  if (strict.status === 'ok') {
    const leaf = strict.document.children[0];
    assert.deepEqual(leaf?.type === 'paragraph' ? leaf.children.map((c) => c.type) : [], ['text', 'softBreak', 'text']);
  }

  // Whitespace on a `Text` hugging a line break: no canonical surface (§7.7).
  const dirty = doc({
    type: 'paragraph',
    children: [{ type: 'text', value: 'first  ' }, { type: 'softBreak' }, { type: 'text', value: 'second' }],
  }) as never;
  assert.equal(format(dirty).status, 'invalid');
  assert.equal(validate(dirty).status, 'invalid');
});

test('edge whitespace on Paragraph / Heading / TableCell text has no canonical surface (Q1)', () => {
  const p = (children: unknown[]): never => ({ type: 'document', footnotes: [], children: [{ type: 'paragraph', children }] }) as never;
  const invalidDocs: never[] = [
    p([{ type: 'text', value: ' ' }]),
    p([{ type: 'text', value: '  hello' }]),
    p([{ type: 'text', value: 'hello  ' }]),
    p([{ type: 'text', value: ' nbsp' }]),
    ({ type: 'document', footnotes: [], children: [{ type: 'heading', level: 2, children: [{ type: 'text', value: 'title ' }] }] }) as never,
    ({ type: 'document', footnotes: [], children: [{
      type: 'table', alignments: ['default', 'default'],
      head: { type: 'tableRow', cells: [{ type: 'tableCell', children: [{ type: 'text', value: ' a' }] }, { type: 'tableCell', children: [{ type: 'text', value: 'b' }] }] },
      body: [],
    }] }) as never,
  ];
  for (const document of invalidDocs) {
    assert.equal(validate(document).status, 'invalid', JSON.stringify(document));
    assert.equal(format(document).status, 'invalid', JSON.stringify(document));
  }

  // Interior whitespace between two non-Text inline nodes is valid — the parser produces it.
  const interior = p([{ type: 'em', children: [{ type: 'text', value: 'a' }] }, { type: 'text', value: ' ' }, { type: 'em', children: [{ type: 'text', value: 'b' }] }]);
  assert.equal(validate(interior).status, 'ok');

  // Edge whitespace inside a NESTED inline sequence (link label, image alt,
  // wrapper content) is fine — it round-trips (`[ x](y)` -> Link(Text(" x"))).
  for (const source of ['[ x](y)\n', '[x ](y)\n', '![ x](y)\n', 'text <m data-k=v> x</m> end\n']) {
    const parsed = parse(source);
    assert.equal(parsed.status, 'ok', source);
    if (parsed.status === 'ok') assert.equal(validate(parsed.document).status, 'ok', source);
  }

  // A footnote definition keeps its post-marker leading space (spec §11.7).
  const footnote = ({
    type: 'document',
    children: [{ type: 'paragraph', children: [{ type: 'text', value: 'x' }, { type: 'footnoteReference', identifier: 'a' }] }],
    footnotes: [{ type: 'footnoteDefinition', identifier: 'a', children: [{ type: 'text', value: ' leading' }] }],
  }) as never;
  assert.equal(validate(footnote).status, 'ok');
});

test('a real heading / list / container / caption is not over-escaped', () => {
  for (const source of [
    '# Heading\n', '- item\n', '::: Note\nx\n:::\n', '1. one\n2. two\n',
    'ends with a hash #\n', 'has - a hyphen mid line\n',
    '![x](y)\\\n*a genuine caption*\n',
    '<m group=g>![a](b)\\\n*cap*</m>\n',
  ]) {
    const parsed = parse(source);
    assert.equal(parsed.status, 'ok', source);
    if (parsed.status !== 'ok') continue;
    const formatted = format(parsed.document);
    assert.equal(formatted.status === 'ok' && formatted.source, source, source);
  }
});
