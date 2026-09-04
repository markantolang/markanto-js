import assert from 'node:assert/strict';
import test from 'node:test';

import { format, parse } from '../../src/index.js';
import { importCommonMark, type ImportOptions } from '../../src/commonmark/index.js';
import { runCompatibility } from '../compat/harness.js';

interface ImportCase {
  readonly name: string;
  readonly source: string;
  readonly options?: ImportOptions;
  readonly expected?: string;
  readonly categories?: readonly string[];
}

const cases: readonly ImportCase[] = [
  { name: 'resolved reference', source: '[text][key]\n\n[key]: https://example.test "Title"\n', expected: '[text](https://example.test "Title")\n', categories: ['resolved'] },
  { name: 'unresolved reference', source: '[text][missing]\n', categories: [] },
  { name: 'nested lazy quote', source: '> outer\nlazy\n> > inner\n', expected: '> outer\n> lazy\n> > inner\n' },
  { name: 'Setext heading', source: 'Heading\n=======\n', expected: '# Heading\n', categories: ['normalised'] },
  { name: 'indented code', source: '    literal\n', expected: '```\nliteral\n```\n' },
  { name: 'underscore thematic break', source: '_ _ _\n', expected: '---\n' },
  { name: 'padded thematic break', source: '*  *  *\n', expected: '---\n' },
  { name: 'trailing-space break', source: 'one  \ntwo\n', expected: 'one\\\ntwo\n' },
  { name: 'unordered marker normalization', source: '* one\n+ two\n', expected: '- one\n- two\n' },
  { name: 'ordered marker and visible deviation', source: '1) one\n3) three\n', expected: '1. one\n3. three\n' },
  { name: 'tight and loose list', source: '- one\n\n- two\n', expected: '- one\n- two\n' },
  { name: 'GFM table', source: '| a | b |\n| :- | -: |\n| c | d |\n' },
  { name: 'GFM task list', source: '- [ ] open\n- [x] done\n', expected: '- [ ] open\n- [x] done\n' },
  { name: 'strikethrough', source: '~~gone~~\n', expected: '~~gone~~\n' },
  { name: 'inline footnote', source: 'note[^n]\n\n[^n]: inline\n' },
  { name: 'numeric footnote identifier', source: 'note[^1]\n\n[^1]: numeric\n', expected: 'note[^1]\n\n[^1]: numeric\n' },
  { name: 'flattened footnote blocks', source: 'note[^n]\n\n[^n]: first\n\n    second\n', categories: ['source-structure-loss'] },
  { name: 'literal empty brackets between soft breaks', source: 'a\n[]\nb\n', expected: 'a\n[]\nb\n', categories: [] },
  { name: 'raw inline HTML removed', source: '<span>x</span>\n', expected: 'x\n', categories: ['semantic-degradation', 'semantic-degradation'] },
  { name: 'raw HTML escaped', source: '<div>\nx\n</div>\n', options: { rawHtml: 'escape' }, categories: ['semantic-degradation'] },
  { name: 'CRLF and BOM', source: '\uFEFFHeading\r\n-------\r\n', expected: '## Heading\n' },
  { name: 'GFM literal autolink', source: 'https://example.test\n', expected: '<https://example.test>\n' },
];

for (const item of cases) {
  test(item.name, () => {
    const imported = importCommonMark(item.source, item.options);
    if (item.expected !== undefined) assert.equal(imported.markanto, item.expected);
    if (item.categories !== undefined) assert.deepEqual(imported.diagnostics.map((diagnostic) => diagnostic.category), item.categories);
    assertStable(imported.markanto);
  });
}

test('an unresolved reference remains literal and never becomes a link', () => {
  const imported = importCommonMark('[text][missing]\n');
  const result = parse(imported.markanto, { strict: true });
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') {
    const paragraph = result.document.children[0];
    assert.equal(paragraph?.type, 'paragraph');
    assert.equal(paragraph?.type === 'paragraph' && paragraph.children.some((child) => child.type === 'link'), false);
  }
});

test('every live import-only compatibility case imports to stable strict Markanto', () => {
  const importedCases = runCompatibility().filter((result) => result.status === 'import-only');
  assert.ok(importedCases.length > 0);
  for (const item of importedCases) {
    assert.doesNotThrow(() => assertStable(importCommonMark(item.case.markdown).markanto), `${item.case.example ?? item.case.id}: ${item.case.section}`);
  }
});

test('the importer has no failure variant across the complete vendored baseline', () => {
  let documentFallbacks = 0;
  for (const item of runCompatibility()) {
    const imported = importCommonMark(item.case.markdown);
    if (imported.diagnostics.some((diagnostic) => diagnostic.message.includes('combination with no canonical Markanto form'))) documentFallbacks += 1;
    assert.doesNotThrow(() => assertStable(imported.markanto), `${item.case.example ?? item.case.id}: ${item.case.section}`);
  }
  assert.equal(documentFallbacks, 0);
});

test('unrepresentable wrappers and leading committed tokens recover locally', () => {
  const wrapper = importCommonMark('before *(*inside*)* after\n');
  assert.match(wrapper.markanto, /before/u);
  assert.match(wrapper.markanto, /inside/u);
  assert.match(wrapper.markanto, /after/u);
  assert.ok(wrapper.diagnostics.some((diagnostic) => diagnostic.category === 'semantic-degradation'));

  // A leading list-marker-shaped token in a paragraph now round-trips as an
  // escaped paragraph (Core formatter guards it); no code-fence recovery.
  const marker = importCommonMark('kept\n\n1234567890. literal\n\nkept too\n');
  assert.match(marker.markanto, /kept/u);
  assert.match(marker.markanto, /1234567890\\\. literal/u);
  assert.match(marker.markanto, /kept too/u);
  assert.equal(marker.markanto.includes('```'), false);
  assertStable(marker.markanto);

  // A construct with no canonical Markanto surface still recovers locally as
  // fenced code, leaving the surrounding blocks intact.
  const fenced = importCommonMark('kept\n\n> > > deep\nlazy\n\nkept too\n');
  assert.match(fenced.markanto, /kept/u);
  assert.match(fenced.markanto, /kept too/u);
  assert.ok(fenced.diagnostics.some((diagnostic) => diagnostic.category === 'unrepresentable'));
  assertStable(fenced.markanto);
});

test('the six import diagnostic levels each have a live trigger', () => {
  const triggers: Readonly<Record<string, readonly [string, ImportOptions?]>> = {
    normalised: ['Heading\n=======\n'],
    resolved: ['[text][key]\n\n[key]: https://example.test\n'],
    'source-structure-loss': ['note[^n]\n\n[^n]: first\n\n    second\n'],
    'semantic-degradation': ['<div>literal</div>\n', { rawHtml: 'escape' }],
    'content-dropped': ['<script>discarded()</script>\n'],
    unrepresentable: ['kept\n\n> > > deep\nlazy\n\nkept too\n'],
  };
  for (const [category, [source, options]] of Object.entries(triggers)) {
    const imported = importCommonMark(source, options);
    assert.ok(imported.diagnostics.some((diagnostic) => diagnostic.category === category), category);
    assertStable(imported.markanto);
  }
});

function assertStable(source: string): void {
  const parsed = parse(source, { strict: true });
  assert.equal(parsed.status, 'ok', JSON.stringify(parsed.diagnostics));
  if (parsed.status !== 'ok') return;
  const formatted = format(parsed.document);
  assert.equal(formatted.status, 'ok');
  if (formatted.status === 'ok') assert.equal(formatted.source, source);
}
