import assert from 'node:assert/strict';
import test from 'node:test';

import { format, parse, semanticDocumentEquals, validate } from '../../src/index.js';
import type { Document } from '../../src/ast.js';

const cases = [
  ['*open', '\\*open'],
  ['_open', '\\_open'],
  ['**open', '\\*\\*open'],
  ['__open', '\\__open'],
  ['~~open', '\\~\\~open'],
  ['--open', '\\--open'],
  ['++open', '\\++open'],
  ['==open', '\\==open'],
] as const;

for (const [sourceBody, canonicalBody] of cases) {
  test(`normal mode resolves an unmatched ${JSON.stringify(sourceBody)} delimiter to literal text`, () => {
    const source = `${sourceBody}\n`;
    const parsed = parse(source);
    assert.equal(parsed.status, 'ok');
    if (parsed.status !== 'ok') return;
    assert.deepEqual(parsed.document.children, [{
      type: 'paragraph', children: [{ type: 'text', value: sourceBody }],
    }]);

    const formatted = format(parsed.document);
    assert.deepEqual(formatted, { status: 'ok', source: `${canonicalBody}\n`, diagnostics: [] });
    if (formatted.status !== 'ok') return;

    const strict = parse(formatted.source, { strict: true });
    assert.equal(strict.status, 'ok');
    if (strict.status !== 'ok') return;
    assert.deepEqual(semanticDocumentEquals(strict.document, parsed.document), { status: 'ok', equal: true });
    assert.deepEqual(format(strict.document), formatted);
    assert.equal(parse(source, { strict: true }).status, 'invalid');
  });
}

test('single tilde precedence remains atomic-or-literal and intended pairs remain structured', () => {
  for (const source of ['~/.bashrc\n', '5~10\n', 'a ~ b\n']) {
    assert.equal(parse(source).status, 'ok');
    assert.equal(parse(source, { strict: true }).status, 'ok');
  }
  for (const source of ['**bold**\n', 'a --b-- c\n', '~~gone~~\n']) {
    const parsed = parse(source, { strict: true });
    assert.equal(parsed.status, 'ok', source);
  }
});

test('a recovered opener adjacent to a following construct is escaped, not fused', () => {
  // `***a*` recovers as Text("**") + Em("a"); a naive literal `**` would
  // concatenate with the `Em`'s `*a*` back into `***a*`, which strict mode
  // would then wrongly accept as canonical.
  const parsed = parse('***a*\n');
  assert.equal(parsed.status, 'ok');
  if (parsed.status !== 'ok') return;
  assert.deepEqual(parsed.document.children, [{
    type: 'paragraph',
    children: [{ type: 'text', value: '**' }, { type: 'em', children: [{ type: 'text', value: 'a' }] }],
  }]);

  const formatted = format(parsed.document);
  assert.deepEqual(formatted, { status: 'ok', source: '\\*\\**a*\n', diagnostics: [] });
  if (formatted.status !== 'ok') return;

  // The unescaped surface is rejected by strict mode; the canonical one round-trips.
  assert.equal(parse('***a*\n', { strict: true }).status, 'invalid');
  const strict = parse(formatted.source, { strict: true });
  assert.equal(strict.status, 'ok');
  if (strict.status !== 'ok') return;
  assert.deepEqual(semanticDocumentEquals(strict.document, parsed.document), { status: 'ok', equal: true });
  assert.deepEqual(format(strict.document), formatted);
});

test('a recovered `~~` opener neutralises both characters (§10.8 effective form)', () => {
  // Leftmost-only would be shorter but is not always effective: a single
  // exposed `~` can pair with a later `~` in the value, a `~~~…` run, or the
  // opener of an adjacent `Sub` / `Deletion` sibling. Both `~` are escaped.
  const values = ['~~open', '~~a ~', '~~a~', '~~a~~', '~~~a~'];
  for (const value of values) {
    const document: Document = {
      type: 'document',
      children: [{ type: 'paragraph', children: [{ type: 'text', value }] }],
      footnotes: [],
    };
    const formatted = format(document);
    assert.equal(formatted.status, 'ok', value);
    if (formatted.status !== 'ok') continue;
    assert.match(formatted.source, /^\\~\\~/, `${JSON.stringify(value)} -> ${JSON.stringify(formatted.source)}`);
    const strict = parse(formatted.source, { strict: true });
    assert.equal(strict.status, 'ok', formatted.source);
    if (strict.status !== 'ok') continue;
    assert.deepEqual(semanticDocumentEquals(strict.document, document), { status: 'ok', equal: true });
  }
  // The sibling edge the leftmost-only attempt broke: `Text("~~a")` before a
  // `Sub` whose opener would fuse with an exposed `~` (`\~~a~b~` reparsed as
  // `~ Sub("a") b~`). With both `~` escaped it round-trips.
  const withSub: Document = {
    type: 'document',
    children: [{ type: 'paragraph', children: [{ type: 'text', value: '~~a' }, { type: 'sub', value: 'b' }] }],
    footnotes: [],
  };
  const subFormatted = format(withSub);
  assert.equal(subFormatted.status, 'ok');
  if (subFormatted.status !== 'ok') return;
  const subStrict = parse(subFormatted.source, { strict: true });
  assert.equal(subStrict.status, 'ok', subFormatted.source);
  if (subStrict.status !== 'ok') return;
  assert.deepEqual(semanticDocumentEquals(subStrict.document, withSub), { status: 'ok', equal: true });
});

test('a Deletion/Obsolete/Insert/Mark against a word-character Text has no canonical surface', () => {
  const span = (type: 'deletion' | 'obsolete' | 'insert' | 'mark') =>
    ({ type, children: [{ type: 'text' as const, value: 'a' }] });
  const wrap = (children: readonly unknown[]): Document => ({
    type: 'document',
    children: [{ type: 'paragraph', children: children as never }],
    footnotes: [],
  });

  // Opener after a word character: `x--a--`, `a~~b~~`, … all reparse as literal
  // text — the GFM/flanking opener is not recognised there.
  for (const type of ['deletion', 'obsolete', 'insert', 'mark'] as const) {
    const doc = wrap([{ type: 'text', value: 'x' }, span(type)]);
    assert.equal(format(doc).status, 'invalid', `format opener/${type}`);
    assert.equal(validate(doc).status, 'invalid', `validate opener/${type}`);
    // Closer before a word character is equally unrepresentable.
    const doc2 = wrap([span(type), { type: 'text', value: 'x' }]);
    assert.equal(format(doc2).status, 'invalid', `format closer/${type}`);
    assert.equal(validate(doc2).status, 'invalid', `validate closer/${type}`);
  }
  // The extra `-` three-run case for Obsolete specifically.
  for (const lead of ['-', '--', 'x-']) {
    const doc = wrap([{ type: 'text', value: lead }, span('obsolete')]);
    assert.equal(format(doc).status, 'invalid', `format ${JSON.stringify(lead)}`);
    assert.equal(validate(doc).status, 'invalid', `validate ${JSON.stringify(lead)}`);
  }
  // Whitespace or non-word punctuation on the boundary round-trips.
  for (const [before, after] of [[' ', ' '], ['.', ')'], ['(', '!']] as const) {
    const doc = wrap([{ type: 'text', value: `y${before}` }, span('deletion'), { type: 'text', value: `${after}z` }]);
    const formatted = format(doc);
    assert.equal(formatted.status, 'ok', `${before}|${after}`);
    if (formatted.status !== 'ok') continue;
    const strict = parse(formatted.source, { strict: true });
    assert.equal(strict.status, 'ok', formatted.source);
    if (strict.status !== 'ok') continue;
    assert.deepEqual(semanticDocumentEquals(strict.document, doc), { status: 'ok', equal: true });
  }
});

test('footnote trivia trimming keeps the recovered Text end-offset in step', () => {
  // With an open `*` frame the pre-footnote space is trimmed off the Text but
  // the scanner's own end index must follow, or `recoverTopFrame` over-reports.
  const parsed = parse('*a [^n]\n\n[^n]: note\n');
  assert.equal(parsed.status, 'ok');
  if (parsed.status !== 'ok') return;
  const paragraph = parsed.document.children[0]!;
  assert.equal(paragraph.type, 'paragraph');
  if (paragraph.type !== 'paragraph') return;
  const text = paragraph.children[0]!;
  assert.deepEqual(text, { type: 'text', value: '*a' });
  assert.deepEqual(parsed.annotations.forNode(text), {
    range: {
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 2, line: 1, column: 3 },
    },
  });
});

test('nested unmatched delimiter frames resolve left-to-right without backtracking', () => {
  const parsed = parse('*outer **inner\n');
  assert.equal(parsed.status, 'ok');
  if (parsed.status !== 'ok') return;
  assert.deepEqual(parsed.document.children, [{
    type: 'paragraph', children: [{ type: 'text', value: '*outer **inner' }],
  }]);
  const paragraph = parsed.document.children[0]!;
  assert.equal(paragraph.type, 'paragraph');
  if (paragraph.type === 'paragraph') {
    assert.deepEqual(parsed.annotations.forNode(paragraph.children[0]!), {
      range: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 14, line: 1, column: 15 },
      },
    });
  }
  const formatted = format(parsed.document);
  assert.equal(formatted.status, 'ok');
  if (formatted.status === 'ok') assert.equal(parse(formatted.source, { strict: true }).status, 'ok');
});
