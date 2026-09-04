import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ResourceLimitError,
  validateSemanticAstSnapshot,
} from '../../scripts/validate-semantic-ast.mjs';

const doc = (children = [], footnotes = []) => ({ type: 'document', children, footnotes });
const paragraph = (children, extra = {}) => ({ type: 'paragraph', children, ...extra });
const text = (value) => ({ type: 'text', value });
const listItem = (children, extra = {}) => ({ type: 'listItem', children, ...extra });
const tableCell = (value) => ({ type: 'tableCell', children: [text(value)] });

function rejects(ast, pattern, options) {
  assert.throws(() => validateSemanticAstSnapshot(ast, 'semanticAst', options), pattern);
}

test('accepts a minimal valid document snapshot', () => {
  assert.doesNotThrow(() => validateSemanticAstSnapshot(doc([paragraph([text('ok')])])));
});

test('requires normalized Text nodes and Unicode scalar strings', () => {
  assert.doesNotThrow(() => validateSemanticAstSnapshot(doc([paragraph([text('😀')])])));
  rejects(doc([paragraph([text('')])]), /must be non-empty/);
  rejects(doc([paragraph([text('a'), text('b')])]), /adjacent Text nodes must be coalesced/);
  rejects(doc([paragraph([text('a\nb')])]), /must not contain line breaks/);
  rejects(doc([paragraph([text('\uD800')])]), /Unicode scalar values only/);
});

test('rejects other atomic values without canonical surfaces', () => {
  rejects(doc([paragraph([{ type: 'inlineCode', value: '' }])]), /must be non-empty/);
  rejects(doc([{ type: 'codeBlock', lang: 'js`x', value: '' }]), /must not contain a backtick/);
  rejects(doc([paragraph([{ type: 'link', href: 'a\nb', children: [text('x')] }])]), /must not contain a line break/);
});

test('MetadataSpan requires actual metadata attributes', () => {
  rejects(doc([paragraph([{ type: 'metadataSpan', children: [text('x')] }])]), /must contain at least one metadata attribute/);
});

test('rejects source ranges in the semantic AST', () => {
  rejects(doc([paragraph([text('x')], { range: { start: {}, end: {} } })]), /tooling metadata, not semantic AST/);
});

test('rejects break nodes in headings at nested depth', () => {
  rejects(doc([{
    type: 'heading', level: 1, children: [{ type: 'em', children: [text('x'), { type: 'softBreak' }, text('y')] }],
  }]), /softBreak forbidden/);
});

test('accepts Deletion and Obsolete as distinct inline semantics', () => {
  assert.doesNotThrow(() => validateSemanticAstSnapshot(doc([paragraph([
    { type: 'deletion', children: [text('removed')] },
    text(' '),
    { type: 'obsolete', children: [text('outdated')] },
  ])])));
});

test('rejects a Deletion/Obsolete/Insert/Mark flanked by a word-character Text', () => {
  for (const type of ['deletion', 'obsolete', 'insert', 'mark']) {
    rejects(doc([paragraph([text('x'), { type, children: [text('a')] }])]),
      /opener after a word character has no canonical surface/);
    rejects(doc([paragraph([{ type, children: [text('a')] }, text('x')])]),
      /closer before a word character has no canonical surface/);
  }
  for (const lead of ['-', '--', 'x-']) {
    rejects(doc([paragraph([text(lead), { type: 'obsolete', children: [text('a')] }])]),
      /Text ending in "-" immediately before an Obsolete has no canonical surface/);
  }
  // Whitespace / non-word punctuation on the boundary is fine.
  assert.doesNotThrow(() => validateSemanticAstSnapshot(doc([paragraph([
    text('x. '), { type: 'obsolete', children: [text('a')] }, text(' -'),
  ])])));
});

test('the flanking word class is L*/Nd/_ and codepoint-safe (matches characterClass)', () => {
  // No (½) and Nl (Ⅷ) are not word characters — representable, must be accepted.
  for (const lead of ['½', 'Ⅷ']) {
    assert.doesNotThrow(() => validateSemanticAstSnapshot(doc([paragraph([
      text(lead), { type: 'deletion', children: [text('a')] },
    ])])));
  }
  // A non-BMP letter (U+10400) is a word character; a UTF-16 slice(-1) would
  // miss it.
  rejects(doc([paragraph([text('\u{10400}'), { type: 'deletion', children: [text('a')] }])]),
    /opener after a word character has no canonical surface/);
});

test('multiline spans allow SoftBreak but reject HardBreak and line-local extension spans stay single-line', () => {
  assert.doesNotThrow(() => validateSemanticAstSnapshot(doc([paragraph([
    { type: 'deletion', children: [text('a'), { type: 'softBreak' }, text('b')] },
  ])])));
  assert.doesNotThrow(() => validateSemanticAstSnapshot(doc([paragraph([{
    type: 'metadataSpan', attrs: { lang: 'de' }, children: [text('a'), { type: 'softBreak' }, text('b')],
  }])])));
  rejects(doc([paragraph([{
    type: 'metadataSpan', attrs: { lang: 'de' },
    children: [{ type: 'em', children: [text('a'), { type: 'hardBreak' }, text('b')] }],
  }])]), /hardBreak forbidden/);
  rejects(doc([paragraph([{ type: 'obsolete', children: [text('a'), { type: 'softBreak' }, text('b')] }])]),
    /softBreak forbidden/);
});

test('rejects direct same-kind wrapper nesting', () => {
  rejects(doc([paragraph([{ type: 'strong', children: [{ type: 'strong', children: [text('x')] }] }])]),
    /direct same-kind wrapper nesting forbidden/);
});

test('rejects the retired Strike semantic node', () => {
  rejects(doc([paragraph([{ type: 'strike', children: [text('x')] }])]), /unknown inline type strike/);
});

test('rejects unrepresentable comment closer in semantic value', () => {
  rejects(doc([{ type: 'commentBlock', value: 'a --> b' }]), /unrepresentable closer/);
});

test('rejects unrepresentable inline math closer sequence', () => {
  rejects(doc([paragraph([{ type: 'inlineMath', value: 'x `$ y' }])]), /unrepresentable closer sequence/);
});

test('rejects sup/sub delimiter characters in atomic values', () => {
  rejects(doc([paragraph([{ type: 'sup', value: 'a^b' }])]), /must not contain \^/);
  rejects(doc([paragraph([{ type: 'sub', value: 'a~b' }])]), /must not contain ~/);
});

test('rejects nested links', () => {
  rejects(doc([paragraph([{
    type: 'link', href: '/outer', children: [{ type: 'link', href: '/inner', children: [text('x')] }],
  }])]), /nested link forbidden/);
});

test('rejects context-invalid resource attributes', () => {
  rejects(doc([{
    type: 'imageBlock', src: 'x.png', alt: [], attrs: { preview: 'p.png' },
  }]), /attribute not valid in image context/);
});

test('rejects empty containers', () => {
  rejects(doc([{
    type: 'container', form: 'fenced', containerType: null, title: null, children: [],
  }]), /must be non-empty/);
});

test('container TITLE requires a non-empty TYPE', () => {
  rejects(doc([{
    type: 'container', form: 'lined', containerType: null, title: 'Title', children: [paragraph([text('x')])],
  }]), /title requires containerType/);
  rejects(doc([{
    type: 'container', form: 'lined', containerType: '', title: null, children: [paragraph([text('x')])],
  }]), /containerType must be non-empty/);
});

test('lined container canonical header must not become a competing block', () => {
  rejects(doc([{
    type: 'container', form: 'lined', containerType: '#', title: 'Title', children: [paragraph([text('x')])],
  }]), /competing block introducer/);
  rejects(doc([{
    type: 'container', form: 'lined', containerType: '-', title: 'item', children: [paragraph([text('x')])],
  }]), /competing block introducer/);
});

test('lined containers may freely mix ordinary blocks and multiple direct fenced children', () => {
  assert.doesNotThrow(() => validateSemanticAstSnapshot(doc([{
    type: 'container', form: 'lined', containerType: 'Section', title: null,
    children: [
      paragraph([text('before')], { id: 'before' }),
      { type: 'container', form: 'fenced', containerType: 'Note', title: null, id: 'n1', children: [paragraph([text('one')])] },
      paragraph([text('between')], { id: 'between' }),
      { type: 'container', form: 'fenced', containerType: 'Warning', title: null, id: 'n2', children: [paragraph([text('two')])] },
    ],
  }])));
});

test('fenced containers may not contain containers and lined may not contain lined', () => {
  rejects(doc([{
    type: 'container', form: 'fenced', containerType: null, title: null,
    children: [{ type: 'container', form: 'fenced', containerType: null, title: null, children: [paragraph([text('x')])] }],
  }]), /fenced container may not nest a container/);
  rejects(doc([{
    type: 'container', form: 'lined', containerType: null, title: null,
    children: [{ type: 'container', form: 'lined', containerType: null, title: null, children: [paragraph([text('x')])] }],
  }]), /lined container may only contain direct fenced containers/);
});

test('tables are positional and require exact row width', () => {
  rejects(doc([{
    type: 'table', alignments: ['default', 'default'],
    head: { type: 'tableRow', cells: [tableCell('A'), tableCell('B')] },
    body: [{ type: 'tableRow', cells: [tableCell('1')] }],
  }]), /cells length must equal table width 2/);
});

test('tables reject Grid-only geometry fields', () => {
  rejects(doc([{
    type: 'table', alignments: ['default'],
    head: { type: 'tableRow', cells: [{ type: 'tableCell', column: 1, children: [text('A')] }] },
    body: [],
  }]), /column is not part of 0\.1\.0 table semantics/);
  rejects(doc([{
    type: 'table', alignments: ['default'],
    head: { type: 'tableRow', cells: [{ type: 'tableCell', rowSpan: 2, children: [text('A')] }] },
    body: [],
  }]), /rowSpan is Grid-only/);
});

test('exact-cell ^ and < are ordinary table text', () => {
  assert.doesNotThrow(() => validateSemanticAstSnapshot(doc([{
    type: 'table', alignments: ['default', 'default'],
    head: { type: 'tableRow', cells: [tableCell('^'), tableCell('<')] },
    body: [{ type: 'tableRow', cells: [tableCell('<'), tableCell('^')] }],
  }])));
});

test('rejects duplicate and missing footnote relations', () => {
  rejects(doc([paragraph([{ type: 'footnoteReference', identifier: 'x' }])]), /missing footnote definition x/);
  rejects(doc([], [
    { type: 'footnoteDefinition', identifier: 'x', children: [text('one')] },
    { type: 'footnoteDefinition', identifier: 'x', children: [text('two')] },
  ]), /duplicate footnote definition x/);
});

test('footnotes are normalized in the AST and source-only leading whitespace is absent', () => {
  rejects(doc([paragraph([text('A. '), { type: 'footnoteReference', identifier: 'a' }])], [
    { type: 'footnoteDefinition', identifier: 'a', children: [text('A')] },
  ]), /whitespace before FootnoteReference is source trivia/);

  rejects(doc([paragraph([
    { type: 'footnoteReference', identifier: 'b' }, text('x'),
    { type: 'footnoteReference', identifier: 'a' },
  ])], [
    { type: 'footnoteDefinition', identifier: 'a', children: [text('A')] },
    { type: 'footnoteDefinition', identifier: 'b', children: [text('B')] },
  ]), /canonical reference\/ASCII order/);

  rejects(doc([], [
    { type: 'footnoteDefinition', identifier: 'z', children: [text('Z')] },
    { type: 'footnoteDefinition', identifier: 'a', children: [text('A')] },
  ]), /canonical reference\/ASCII order/);
});

test('Autolink values use one canonical representable domain', () => {
  assert.doesNotThrow(() => validateSemanticAstSnapshot(doc([paragraph([{
    type: 'autolink', kind: 'url', value: 'https://example.org/a(b)',
  }])])));
  rejects(doc([paragraph([{ type: 'autolink', kind: 'url', value: 'https://example.org>' }])]),
    /canonical URL autolink domain/);
  rejects(doc([paragraph([{ type: 'autolink', kind: 'url', value: 'https:\/\/' }])]),
    /canonical URL autolink domain/);
  rejects(doc([paragraph([{ type: 'autolink', kind: 'email', value: 'https://example.org' }])]),
    /canonical email autolink domain/);
});

test('group is semantically non-empty', () => {
  rejects(doc([{ type: 'imageBlock', src: 'x.png', alt: [], attrs: { group: '' } }]),
    /group must be non-empty/);
});

test('empty markdown resource titles are valid while container titles stay non-empty', () => {
  for (const node of [
    paragraph([{ type: 'link', href: 'u', title: '', children: [text('x')] }]),
    paragraph([text('See '), { type: 'inlineImage', src: 'x', title: '', alt: [text('a')] }]),
    { type: 'imageBlock', src: 'x', title: '', alt: [text('a')] },
    { type: 'videoBlock', src: 'x', title: '', label: [text('a')] },
    { type: 'audioBlock', src: 'x', title: '', label: [text('a')] },
    { type: 'embedBlock', target: 'x', title: '', label: [text('a')] },
    { type: 'downloadBlock', href: 'x', title: '', label: [text('a')] },
  ]) assert.doesNotThrow(() => validateSemanticAstSnapshot(doc([node])));
  rejects(doc([{
    type: 'container', form: 'fenced', containerType: 'note', title: '',
    children: [paragraph([text('body')])],
  }]), /title must be non-empty/);
});

test('block-capable full-line resources are not valid Paragraph ASTs', () => {
  rejects(doc([paragraph([{ type: 'inlineImage', src: 'x.png', alt: [] }])]), /not representable as Paragraph/);
  rejects(doc([paragraph([{
    type: 'link', href: 'x.zip', download: true, children: [text('file')],
  }])]), /not representable as Paragraph/);
});

test('footnote references inside Grid headers participate in global relation validation', () => {
  rejects(doc([{
    type: 'container', form: 'fenced', containerType: 'Grid', title: null,
    children: [{
      type: 'grid', columns: 1,
      header: [{ type: 'gridRow', cells: [{
        type: 'gridCell', column: 1,
        children: [paragraph([{ type: 'footnoteReference', identifier: 'missing' }])],
      }] }],
      rows: [{ type: 'gridRow', cells: [{ type: 'gridCell', column: 1, children: [paragraph([text('body')])] }] }],
    }],
  }]), /missing footnote definition missing/);
});

test('accepts valid fenced-container Grid geometry', () => {
  assert.doesNotThrow(() => validateSemanticAstSnapshot(doc([{
    type: 'container', form: 'fenced', containerType: 'Vergleich', title: null,
    children: [{
      type: 'grid', columns: 2, rows: [
        { type: 'gridRow', cells: [{
          type: 'gridCell', column: 1, rowSpan: 2, colSpan: 2,
          children: [paragraph([text('A')])],
        }] },
        { type: 'gridRow', cells: [] },
      ],
    }],
  }])));
});

test('rejects an unrepresentable headerless 1x1 Grid', () => {
  rejects(doc([{
    type: 'container', form: 'fenced', containerType: null, title: null,
    children: [{ type: 'grid', columns: 1, rows: [{ type: 'gridRow', cells: [{
      type: 'gridCell', column: 1, children: [paragraph([text('x')])],
    }] }] }],
  }]), /headerless 1x1 Grid has no canonical Grid surface/);
});

test('accepts a 1x1-header + 1x1-body Grid because :: is semantic structure', () => {
  assert.doesNotThrow(() => validateSemanticAstSnapshot(doc([{
    type: 'container', form: 'fenced', containerType: null, title: null,
    children: [{
      type: 'grid', columns: 1,
      header: [{ type: 'gridRow', cells: [{ type: 'gridCell', column: 1, children: [paragraph([text('h')])] }] }],
      rows: [{ type: 'gridRow', cells: [{ type: 'gridCell', column: 1, children: [paragraph([text('b')])] }] }],
    }],
  }])));
});

test('rejects Grid outside fenced sole-child position', () => {
  rejects(doc([{
    type: 'container', form: 'lined', containerType: null, title: null,
    children: [{ type: 'grid', columns: 2, rows: [{ type: 'gridRow', cells: [
      { type: 'gridCell', column: 1, children: [paragraph([text('x')])] },
      { type: 'gridCell', column: 2, children: [paragraph([text('y')])] },
    ] }] }],
  }]), /grid is fenced-container-only/);

  rejects(doc([{
    type: 'container', form: 'fenced', containerType: null, title: null,
    children: [
      { type: 'grid', columns: 2, rows: [{ type: 'gridRow', cells: [
        { type: 'gridCell', column: 1, children: [paragraph([text('x')])] },
        { type: 'gridCell', column: 2, children: [paragraph([text('y')])] },
      ] }] },
      paragraph([text('sibling')]),
    ],
  }]), /grid must be the sole/);
});

test('rejects invalid Grid geometry and explicit unit spans', () => {
  rejects(doc([{
    type: 'container', form: 'fenced', containerType: null, title: null,
    children: [{ type: 'grid', columns: 2, rows: [{ type: 'gridRow', cells: [{
      type: 'gridCell', column: 1, children: [paragraph([text('only one slot')])],
    }] }] }],
  }]), /uncovered grid slot/);

  rejects(doc([{
    type: 'container', form: 'fenced', containerType: null, title: null,
    children: [{ type: 'grid', columns: 1, header: [{ type: 'gridRow', cells: [{
      type: 'gridCell', column: 1, children: [paragraph([text('h')])],
    }] }], rows: [{ type: 'gridRow', cells: [{
      type: 'gridCell', column: 1, rowSpan: 1, children: [paragraph([text('x')])],
    }] }] }],
  }]), /rowSpan must be >= 2/);
});

test('accepts Grid header and body as independent span geometries', () => {
  assert.doesNotThrow(() => validateSemanticAstSnapshot(doc([{
    type: 'container', form: 'fenced', containerType: 'Vergleich', title: null,
    children: [{
      type: 'grid', columns: 2,
      header: [
        { type: 'gridRow', cells: [{
          type: 'gridCell', column: 1, rowSpan: 2,
          children: [paragraph([text('Group')])],
        }, { type: 'gridCell', column: 2, children: [paragraph([text('A')])] }] },
        { type: 'gridRow', cells: [{ type: 'gridCell', column: 2, children: [paragraph([text('B')])] }] },
      ],
      rows: [{ type: 'gridRow', cells: [{
        type: 'gridCell', column: 1, colSpan: 2,
        children: [paragraph([text('Body')])],
      }] }],
    }],
  }])));
});

test('rejects Grid rowspan that exceeds header instead of crossing into body', () => {
  rejects(doc([{
    type: 'container', form: 'fenced', containerType: 'Vergleich', title: null,
    children: [{
      type: 'grid', columns: 1,
      header: [{ type: 'gridRow', cells: [{
        type: 'gridCell', column: 1, rowSpan: 2,
        children: [paragraph([text('Header')])],
      }] }],
      rows: [{ type: 'gridRow', cells: [{
        type: 'gridCell', column: 1, children: [paragraph([text('Body')])],
      }] }],
    }],
  }]), /rowSpan exceeds semanticAst\.children\[0\]\.children\[0\]\.header height/);
});

test('QuoteRegion must start at level 1 and may rise by at most one', () => {
  rejects(doc([{
    type: 'quoteRegion', children: [{ level: 2, block: paragraph([text('x')]) }],
  }]), /must start at depth 1/);
  rejects(doc([{
    type: 'quoteRegion', children: [
      { level: 1, block: paragraph([text('a')]) },
      { level: 3, block: paragraph([text('b')]) },
    ],
  }]), /rises by more than one/);
  assert.doesNotThrow(() => validateSemanticAstSnapshot(doc([{
    type: 'quoteRegion', children: [
      { level: 1, block: paragraph([text('a')]) },
      { level: 2, block: paragraph([text('b')]) },
      { level: 3, block: paragraph([text('c')]) },
      { level: 1, block: paragraph([text('d')]) },
    ],
  }])));
});

test('contained blocks cannot carry IDs, while direct container children can', () => {
  rejects(doc([{
    type: 'quoteRegion', id: 'quote', children: [{ level: 1, block: paragraph([text('x')], { id: 'inner' }) }],
  }]), /id forbidden inside quoteRegion/);

  rejects(doc([{
    type: 'list', kind: 'unordered', items: [listItem([paragraph([text('x')], { id: 'inner' })])],
  }]), /id forbidden inside listItem/);

  rejects(doc([{
    type: 'container', form: 'fenced', containerType: null, title: null,
    children: [{ type: 'grid', columns: 2, rows: [{ type: 'gridRow', cells: [
      { type: 'gridCell', column: 1, children: [paragraph([text('x')], { id: 'inner' })] },
      { type: 'gridCell', column: 2, children: [paragraph([text('y')])] },
    ] }] }],
  }]), /id forbidden inside gridCell/);

  assert.doesNotThrow(() => validateSemanticAstSnapshot(doc([{
    type: 'container', form: 'fenced', containerType: null, title: null,
    children: [paragraph([text('addressable')], { id: 'inside-container' })],
  }])));
});

test('ordered-list start is normalized and ordered-only', () => {
  rejects(doc([{
    type: 'list', kind: 'ordered', start: 1,
    items: [listItem([paragraph([text('x')])])],
  }]), /start=1 is non-semantic/);
  rejects(doc([{
    type: 'list', kind: 'unordered', start: 7,
    items: [listItem([paragraph([text('x')])])],
  }]), /start is ordered-list-only/);
  assert.doesNotThrow(() => validateSemanticAstSnapshot(doc([{
    type: 'list', kind: 'ordered', start: 3,
    items: [listItem([paragraph([text('three')])]), listItem([paragraph([text('four')])])],
  }])));
});

test('ordered item value exists only for real visible deviations', () => {
  rejects(doc([{
    type: 'list', kind: 'ordered',
    items: [listItem([paragraph([text('one')])], { value: 1 })],
  }]), /duplicates List.start on the first item/);
  rejects(doc([{
    type: 'list', kind: 'ordered',
    items: [
      listItem([paragraph([text('one')])]),
      listItem([paragraph([text('two')])], { value: 2 }),
    ],
  }]), /not a visible deviation/);
  assert.doesNotThrow(() => validateSemanticAstSnapshot(doc([{
    type: 'list', kind: 'ordered',
    items: [
      listItem([paragraph([text('one')])]),
      listItem([paragraph([text('seven')])], { value: 7 }),
      listItem([paragraph([text('eight')])]),
    ],
  }])));
});

test('task status is forbidden on definition-list items', () => {
  rejects(doc([{
    type: 'list', kind: 'definition', items: [listItem([paragraph([text('term')])], { task: 'open' })],
  }]), /not permitted in definition lists/);
  assert.doesNotThrow(() => validateSemanticAstSnapshot(doc([{
    type: 'list', kind: 'ordered', items: [listItem([paragraph([text('step')])], { task: 'done' })],
  }])));
});

test('ListItem children follow the closed AST child union', () => {
  rejects(doc([{
    type: 'list', kind: 'unordered', items: [listItem([
      paragraph([text('item')]), { type: 'heading', level: 2, children: [text('not allowed')] },
    ])],
  }]), /block type is not permitted in ListItem/);
  rejects(doc([{
    type: 'list', kind: 'unordered', items: [listItem([
      paragraph([text('item')]), { type: 'horizontalRule' },
    ])],
  }]), /block type is not permitted in ListItem/);
});

test('deep grammatically valid list nesting is stack-safe', () => {
  let nested = paragraph([text('leaf')]);
  for (let i = 0; i < 5_000; i += 1) {
    nested = {
      type: 'list', kind: 'unordered',
      items: [listItem([paragraph([text(`level ${i}`)]), nested])],
    };
  }
  assert.doesNotThrow(() => validateSemanticAstSnapshot(doc([nested])));
});

test('resource exhaustion is reported as resource rather than invalidity or stack overflow', () => {
  let nested = paragraph([text('leaf')]);
  for (let i = 0; i < 100; i += 1) {
    nested = {
      type: 'list', kind: 'unordered',
      items: [listItem([paragraph([text(`level ${i}`)]), nested])],
    };
  }
  assert.throws(
    () => validateSemanticAstSnapshot(doc([nested]), 'semanticAst', {
      resourceBudget: { maxNodes: 50, maxFrames: 1_000, maxMatrixSlots: 1_000 },
    }),
    (error) => error instanceof ResourceLimitError && error.category === 'resource',
  );
});
