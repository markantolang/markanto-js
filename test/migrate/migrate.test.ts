import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { format, parse, semanticDocumentEquals } from '../../src/index.js';
import { migrateV053 } from '../../tools/migrate/index.js';

// Paths resolve from the repo root — both `bun test` and the Node build
// (`node --test .migrate-dist/...`) run with cwd at the repo root.
const legacyDir = resolve('test/migrate/legacy-corpus') + '/';
const portedDir = resolve('test/corpus-realistic') + '/';

/**
 * Documented oracle divergences: the migration tool's output is semantically
 * correct but not identical to the Phase-10B hand port because the porter made
 * a formatting judgement the AST does not carry. Each must be covered by a
 * `review` diagnostic (asserted below).
 *
 * `konferenz-programm.mrk`: a `[…]{lang: en}` bracket span straddles a line
 * break in the source; `<m>` is line-local, so the tool collapses the break
 * to a space inside the span while the porter moved it before the span. Same
 * meaning up to one `softBreak`'s position. Maintainer-signed-off 2026-09-02:
 * the deterministic collapse is the accepted behaviour.
 */
const ORACLE_DIVERGENCE = new Set(['konferenz-programm.mrk']);

const legacyFiles = readdirSync(legacyDir).filter((name) => name.endsWith('.mrk')).sort();
assert.equal(legacyFiles.length, 14, 'all 14 v0.5.3 sources are vendored');

function assertStable(text: string, label: string): void {
  const parsed = parse(text, { strict: true });
  assert.equal(parsed.status, 'ok', `${label}: strict parse — ${JSON.stringify(parsed.status === 'ok' ? '' : parsed.diagnostics)}`);
  if (parsed.status !== 'ok') return;
  const formatted = format(parsed.document);
  assert.equal(formatted.status, 'ok', `${label}: reformat`);
  if (formatted.status === 'ok') assert.equal(formatted.source, text, `${label}: byte-stable`);
}

for (const name of legacyFiles) {
  test(`v0.5.3 corpus migrates: ${name}`, () => {
    const result = migrateV053(readFileSync(`${legacyDir}${name}`, 'utf8'));
    assert.ok(result.text.length > 0, `${name}: produced output`);
    assert.ok(
      result.diagnostics.every((d) => d.category !== 'unrepresentable'),
      `${name}: no unrepresentable diagnostics — ${JSON.stringify(result.diagnostics.filter((d) => d.category === 'unrepresentable'))}`,
    );
    assertStable(result.text, name);

    const migrated = parse(result.text);
    const ported = parse(readFileSync(`${portedDir}${name}`, 'utf8'));
    assert.equal(migrated.status, 'ok');
    assert.equal(ported.status, 'ok');
    if (migrated.status !== 'ok' || ported.status !== 'ok') return;

    const equal = semanticDocumentEquals(migrated.document, ported.document);
    if (ORACLE_DIVERGENCE.has(name)) {
      assert.ok(
        !(equal.status === 'ok' && equal.equal),
        `${name}: listed as a divergence but now matches — remove it from ORACLE_DIVERGENCE`,
      );
      assert.ok(
        result.diagnostics.some((d) => d.category === 'review'),
        `${name}: an oracle divergence must carry a review diagnostic`,
      );
    } else {
      assert.deepEqual(equal, { status: 'ok', equal: true }, `${name}: matches the hand port`);
    }
  });
}

// --- targeted delta cases ------------------------------------------------

for (const [label, source, expected] of [
  ['strike -> deletion', 'A ~~gone~~ line.\n', 'A ~~gone~~ line.\n'],
  ['obsolete stays obsolete', 'A --old-- line.\n', 'A --old-- line.\n'],
  ['bracket span -> <m>', 'A [term]{lang=en} here.\n', 'A <m lang=en>term</m> here.\n'],
  ['sup flatten', 'E = mc^2^ today.\n', 'E = mc^2^ today.\n'],
  ['sub flatten', 'Water is H~2~O here.\n', 'Water is H~2~O here.\n'],
  ['directive container -> lined', 'Note\n___\nBody text.\n___\n', 'Note\n___\n\nBody text.\n___\n'],
  ['legacy grid geometry', '::: grid\nA\n:--\nB\n:==\nC\n:--\nD\n:::\n', '::: grid\nA\n--\nB\n==\nC\n--\nD\n:::\n'],
] as const) {
  test(`delta: ${label}`, () => {
    const result = migrateV053(source);
    assert.equal(result.text, expected, JSON.stringify(result.diagnostics));
    assertStable(result.text, label);
  });
}

test('a caption-style definition list after a resource becomes the caption', () => {
  const result = migrateV053('![Alt](p.jpg)\n: A caption\n');
  const parsed = parse(result.text, { strict: true });
  assert.equal(parsed.status, 'ok');
  if (parsed.status !== 'ok') return;
  const block = parsed.document.children[0];
  assert.equal(block?.type, 'imageBlock');
  assert.ok(block?.type === 'imageBlock' && block.caption !== undefined, 'caption attached');
  assert.ok(result.diagnostics.some((d) => d.category === 'review'));
});

test('a legacy parse failure returns empty text with a diagnostic', () => {
  const result = migrateV053('```\nunclosed fence\n');
  assert.equal(result.text, '');
  assert.ok(result.diagnostics.some((d) => d.category === 'unrepresentable'));
});

test('the bracket-span rewrite never touches literal contexts', () => {
  for (const literal of ['```\n[x]{lang=en}\n```\n', '`[x]{lang=en}` inline\n', '<!-- [x]{lang=en} -->\n']) {
    const result = migrateV053(literal);
    assert.ok(!result.text.includes('<m '), `${JSON.stringify(literal)} → ${JSON.stringify(result.text)}`);
  }
});

test('a quoted bracket-span attribute value keeps its quotes', () => {
  const result = migrateV053('A [x]{data-a="a b"} here.\n');
  assert.equal(result.text, 'A <m data-a="a b">x</m> here.\n', JSON.stringify(result.diagnostics));
  assertStable(result.text, 'quoted attr');
});

test('an uppercase legacy data-* key is diagnosed instead of silently passed through', () => {
  const result = migrateV053('<m data-Foo=x>Text</m>\n');
  assert.equal(result.text, '');
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.category === 'review' &&
    diagnostic.message === 'data-* key "data-Foo" is not a valid 0.1.0 key (lowercase only); left as-is for author review'
  ));
});

test('an inline-image lang attribute is mapped without loss', () => {
  const result = migrateV053('See <m lang=de>![a](x)</m> here.\n');
  assert.equal(result.text, 'See <m lang=de>![a](x)</m> here.\n');
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.category === 'mapped' && diagnostic.message.includes('inline image `lang`')
  ));
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.category === 'dropped'));
  assertStable(result.text, 'inline image lang');
});

test('an empty-label link surfaces its destination as the label', () => {
  const result = migrateV053('[](https://example.com)\n');
  assertStable(result.text, 'empty-label link');
  assert.ok(result.diagnostics.some((d) => d.category === 'review'));
});

test('a non-attribute bracket/brace does not swallow a later real span', () => {
  const result = migrateV053('Cell arr[0]{idx} and [term]{lang=en} here.\n');
  assert.equal(result.text, 'Cell arr[0]{idx} and <m lang=en>term</m> here.\n', JSON.stringify(result.diagnostics));
  assertStable(result.text, 'mixed bracket/brace');
});

test('a root-relative /identifier link is flagged for review', () => {
  const result = migrateV053('See [the glossary](/glossary).\n');
  assert.ok(result.diagnostics.some((d) => d.category === 'review' && d.message.includes('/glossary')));
});

test('failed grid recovery stays literal, not an ordinary container', () => {
  const result = migrateV053('::: grid\nno cell markers here\n:::\n');
  const parsed = parse(result.text, { strict: true });
  assert.equal(parsed.status, 'ok');
  if (parsed.status !== 'ok') return;
  assert.equal(parsed.document.children[0]?.type, 'codeBlock');
  assert.ok(result.diagnostics.some((d) => d.category === 'unrepresentable'));
});

test('a caption definition list is folded even inside a quote region', () => {
  const result = migrateV053('> ![Alt](p.jpg)\n> : A caption\n');
  const parsed = parse(result.text, { strict: true });
  assert.equal(parsed.status, 'ok', JSON.stringify(result.diagnostics));
  if (parsed.status !== 'ok') return;
  const region = parsed.document.children[0];
  assert.equal(region?.type, 'quoteRegion');
  const first = region?.type === 'quoteRegion' ? region.children[0]?.block : undefined;
  assert.ok(first?.type === 'imageBlock' && first.caption !== undefined, 'quoted image has a caption');
  assert.ok(result.diagnostics.some((d) => d.category === 'review'));
});

test('trailing / break-adjacent line whitespace is normalised, not carried into an invalid AST', () => {
  // v0.5.3 kept the raw trailing space of a wrapped line; 0.1.0 strips it.
  const result = migrateV053('**Lead.** some text \n  and more here\n');
  assert.notEqual(result.text, '');
  const parsed = parse(result.text, { strict: true });
  assert.equal(parsed.status, 'ok', result.text);
  if (parsed.status === 'ok') {
    assert.equal(parse(result.text).status, 'ok');
  }
});

test('a v0.5.3 blank-line-separated run of same-marker items migrates to one list', () => {
  const result = migrateV053('- one\n- two\n\n- three\n- four\n');
  const parsed = parse(result.text, { strict: true });
  assert.equal(parsed.status, 'ok', result.text);
  if (parsed.status === 'ok') {
    const list = parsed.document.children[0];
    assert.ok(list?.type === 'list' && list.items.length === 4, result.text);
  }
  assert.ok(result.diagnostics.some((d) => d.category === 'mapped' && /adjacent same-kind lists/.test(d.message)));
});

test('a v0.5.3 blank-line-split ordered run (start renumbering) merges to one tight list', () => {
  const result = migrateV053('1. First point.\n\n2. Second point.\n\n3. Third point.\n');
  assert.equal(result.text, '1. First point.\n2. Second point.\n3. Third point.\n');
  const parsed = parse(result.text, { strict: true });
  assert.equal(parsed.status, 'ok');
  if (parsed.status === 'ok') {
    const list = parsed.document.children[0];
    assert.ok(list?.type === 'list' && list.kind === 'ordered' && list.items.length === 3 && list.start === undefined);
  }
});

test('a v0.5.3 blank-line-split ordered run with a discontinuous ordinal keeps it as a visible value', () => {
  // Two v0.5.3 ordered lists [1] and [5] -> one 0.1.0 list whose second item
  // shows `5` (spec §9.9 / §9.15): a canonical surface exists, so the merge
  // applies rather than reporting `unrepresentable`.
  const result = migrateV053('1. a\n\n5. b\n\n6. c\n');
  assert.equal(result.text, '1. a\n5. b\n6. c\n');
  assert.ok(result.diagnostics.some((d) => d.category === 'mapped' && /discontinuous ordinal/.test(d.message)));
  assert.ok(result.diagnostics.every((d) => d.category !== 'unrepresentable'));
  const parsed = parse(result.text, { strict: true });
  assert.equal(parsed.status, 'ok');
  if (parsed.status === 'ok') {
    const list = parsed.document.children[0];
    assert.ok(list?.type === 'list' && list.kind === 'ordered' && list.items.length === 3);
    assert.equal(list?.type === 'list' ? list.items[1]?.value : undefined, 5);
    assert.equal(list?.type === 'list' ? list.items[2]?.value : undefined, undefined);
  }
});

test('a v0.5.3 blank-line-split ordered run that restarts at 1 keeps the visible restart', () => {
  const result = migrateV053('1. a\n\n1. b\n');
  assert.equal(result.text, '1. a\n1. b\n');
  const parsed = parse(result.text, { strict: true });
  assert.equal(parsed.status, 'ok');
  if (parsed.status === 'ok') {
    const list = parsed.document.children[0];
    assert.equal(list?.type === 'list' ? list.items[1]?.value : undefined, 1);
  }
});
