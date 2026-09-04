import assert from 'node:assert/strict';
import test from 'node:test';

import { format, parse, semanticDocumentEquals } from '../../src/index.js';
import { isWellFormedBcp47, parseMOpen, validateAttributeContext } from '../../src/parser/resources.js';

test('mOpen parses exact spacing, quoted values, and rejects duplicate or unknown keys', () => {
  const source = '<m video data-label="a\\"b" lang=DE>';
  const parsed = parseMOpen(source, 0, source.length);
  assert.equal(parsed?.status, 'ok');
  if (parsed?.status === 'ok') {
    assert.equal(parsed.kind, 'video');
    assert.deepEqual(parsed.attrs, { lang: 'de', dataAttrs: { label: 'a"b' } });
  }
  assert.equal(parseMOpen('<m  lang=en>', 0, 12)?.status, 'error');
  assert.equal(parseMOpen('<m lang=en lang=en>', 0, 19)?.status, 'error');
  assert.equal(parseMOpen('<m width=2>', 0, 11)?.status, 'error');
  assert.equal(parseMOpen('<m lang=en >', 0, 12)?.status, 'error');
});

test('attribute matrix accepts and rejects each resource context', () => {
  assert.equal(validateAttributeContext('generic', { lang: 'de', dataAttrs: { role: 'term' } }), null);
  assert.equal(validateAttributeContext('generic', { group: 'x' })?.category, 'semantic');
  assert.equal(validateAttributeContext('image', { group: 'x' }), null);
  assert.equal(validateAttributeContext('image', { lang: 'de' }), null);
  assert.equal(validateAttributeContext('video', { group: 'x', lang: 'de', preview: 'poster.jpg' }), null);
  assert.equal(validateAttributeContext('download', { lang: 'de' }), null);
  assert.equal(validateAttributeContext('download', { preview: 'x' })?.category, 'semantic');
});

test('BCP 47 validation is syntactic but structurally complete', () => {
  for (const value of ['de', 'de-de', 'zh-hant-tw', 'sl-rozaj', 'en-us-u-ca-gregory', 'x-private']) assert.equal(isWellFormedBcp47(value), true, value);
  for (const value of ['', 'e', 'en_US', 'en-', 'en-a', 'en-12', 'en-u-ca-u-nu']) assert.equal(isWellFormedBcp47(value), false, value);
});

test('whole-line classification distinguishes block and inline resources', () => {
  const block = parse('![Alt](image.jpg)\n');
  assert.equal(block.status, 'ok');
  if (block.status === 'ok') assert.equal(block.document.children[0]?.type, 'imageBlock');
  const inline = parse('See ![Alt](image.jpg) now.\n');
  assert.equal(inline.status, 'ok');
  if (inline.status === 'ok') assert.equal(inline.document.children[0]?.type, 'paragraph');
  const leading = parse('![Alt](image.jpg) now.\n');
  assert.equal(leading.status, 'ok');
  if (leading.status === 'ok') assert.equal(leading.document.children[0]?.type, 'paragraph');
  const adjacent = parse('Text.\n![Alt](image.jpg)\n');
  assert.equal(adjacent.status, 'ok');
  if (adjacent.status === 'ok') assert.deepEqual(adjacent.document.children.map((node) => node.type), ['paragraph', 'imageBlock']);
});

test('caption requires the hard-break carrier and formats canonically', () => {
  const withCaption = parse('![Alt](image.jpg)\\\n*Caption*\n');
  assert.equal(withCaption.status, 'ok');
  if (withCaption.status === 'ok' && withCaption.document.children[0]?.type === 'imageBlock') {
    assert.equal(withCaption.document.children[0].caption?.[0]?.type, 'text');
    assert.equal(format(withCaption.document).status, 'ok');
  }
  const adjacent = parse('![Alt](image.jpg)\n*Caption*\n');
  assert.equal(adjacent.status, 'ok');
  if (adjacent.status === 'ok') assert.equal(adjacent.document.children.length, 2);
});

test('whole-line resources and captions ignore trailing ASCII blanks in normal mode', () => {
  for (const source of ['![Alt](image.jpg) \n', '![Alt](image.jpg)\t\n']) {
    const parsed = parse(source);
    assert.equal(parsed.status, 'ok');
    if (parsed.status !== 'ok') continue;
    assert.equal(parsed.document.children[0]?.type, 'imageBlock');
    assert.deepEqual(format(parsed.document), { status: 'ok', source: '![Alt](image.jpg)\n', diagnostics: [] });
    const strict = parse(source, { strict: true });
    assert.equal(strict.status, 'invalid');
    if (strict.status === 'invalid') assert.equal(strict.diagnostics[0]?.category, 'noncanonical');
  }

  const source = '![Alt](i.jpg)\\\n*Cap* \n';
  const parsed = parse(source);
  assert.equal(parsed.status, 'ok');
  if (parsed.status === 'ok') {
    assert.equal(parsed.document.children[0]?.type, 'imageBlock');
    if (parsed.document.children[0]?.type === 'imageBlock') assert.notEqual(parsed.document.children[0].caption, undefined);
    const formatted = format(parsed.document);
    assert.equal(formatted.status, 'ok');
    if (formatted.status === 'ok') {
      const reparsed = parse(formatted.source);
      assert.equal(reparsed.status, 'ok');
      if (reparsed.status === 'ok') {
        assert.deepEqual(semanticDocumentEquals(reparsed.document, parsed.document), { status: 'ok', equal: true });
      }
    }
  }
  const strict = parse(source, { strict: true });
  assert.equal(strict.status, 'invalid');
  if (strict.status === 'invalid') assert.equal(strict.diagnostics[0]?.category, 'noncanonical');
});

test('unclosed typed resource wrapper is a syntax error', () => {
  const parsed = parse('<m video>text\n');
  assert.equal(parsed.status, 'invalid');
  if (parsed.status === 'invalid') {
    assert.equal(parsed.diagnostics[0]?.category, 'syntax');
    assert.equal(parsed.diagnostics[0]?.message, 'unclosed <m> wrapper');
  }
});

test('attribute order and quoting converge and round-trip', () => {
  const parsed = parse('<m video data-label="two words" preview=poster.jpg group=trip lang=DE>[V](v.mp4)</m>\n');
  assert.equal(parsed.status, 'ok');
  if (parsed.status !== 'ok') return;
  const formatted = format(parsed.document);
  assert.equal(formatted.status, 'ok');
  if (formatted.status !== 'ok') return;
  assert.equal(formatted.source, '<m video group=trip lang=de preview=poster.jpg data-label="two words">[V](v.mp4)</m>\n');
  const strict = parse(formatted.source, { strict: true });
  assert.equal(strict.status, 'ok');
  if (strict.status === 'ok') assert.deepEqual(semanticDocumentEquals(strict.document, parsed.document), { status: 'ok', equal: true });
});

test('lang metadata on an inline image is retained and strictly round-trips', () => {
  const parsed = parse('See <m lang=DE>![a](x)</m> here.\n');
  assert.equal(parsed.status, 'ok');
  if (parsed.status !== 'ok') return;
  const paragraph = parsed.document.children[0];
  assert.equal(paragraph?.type, 'paragraph');
  const image = paragraph?.type === 'paragraph' ? paragraph.children[1] : undefined;
  assert.deepEqual(image, { type: 'inlineImage', src: 'x', alt: [{ type: 'text', value: 'a' }], attrs: { lang: 'de' } });
  const formatted = format(parsed.document);
  assert.deepEqual(formatted, { status: 'ok', source: 'See <m lang=de>![a](x)</m> here.\n', diagnostics: [] });
  if (formatted.status === 'ok') {
    const strict = parse(formatted.source, { strict: true });
    assert.equal(strict.status, 'ok');
    if (strict.status === 'ok') assert.deepEqual(semanticDocumentEquals(strict.document, parsed.document), { status: 'ok', equal: true });
  }
});

test('every Phase-4 resource AST family has a strict canonical surface', () => {
  const documents = [
    { type: 'document', children: [{ type: 'imageBlock', src: 'image.jpg', alt: [], attrs: { group: 'trip', dataAttrs: { role: 'hero' } } }], footnotes: [] },
    { type: 'document', children: [{ type: 'videoBlock', src: 'v.mp4', label: [], caption: [{ type: 'text', value: 'Caption' }], attrs: { lang: 'de', preview: 'poster.jpg' } }], footnotes: [] },
    { type: 'document', children: [{ type: 'audioBlock', src: 'a.mp3', label: [{ type: 'text', value: 'Audio' }] }], footnotes: [] },
    { type: 'document', children: [{ type: 'embedBlock', target: 'https://example.org', label: [{ type: 'text', value: 'Demo' }] }], footnotes: [] },
    { type: 'document', children: [{ type: 'downloadBlock', href: 'f.zip', label: [], attrs: { lang: 'en' } }], footnotes: [] },
    { type: 'document', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'A ' }, { type: 'metadataSpan', attrs: { lang: 'de' }, children: [{ type: 'text', value: 'Wort' }] }] }], footnotes: [] },
    { type: 'document', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'A ' }, { type: 'inlineImage', src: 'i.jpg', alt: [], attrs: { group: 'g', lang: 'de' } }] }], footnotes: [] },
    { type: 'document', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Get ' }, { type: 'link', href: 'f.zip', children: [], download: true, attrs: { lang: 'en' } }] }], footnotes: [] },
  ] as const;
  for (const document of documents) {
    const formatted = format(document as never);
    assert.equal(formatted.status, 'ok');
    if (formatted.status !== 'ok') continue;
    const strict = parse(formatted.source, { strict: true });
    assert.equal(strict.status, 'ok', formatted.source);
    if (strict.status !== 'ok') continue;
    assert.deepEqual(semanticDocumentEquals(strict.document, document as never), { status: 'ok', equal: true });
    assert.deepEqual(format(strict.document), formatted);
  }
});

test('resource blocks, captions, metadata wrappers, and their inline children are annotated', () => {
  for (const source of [
    '<m video>[Talk](talk.mp4)\\\n*Recorded **today***</m>\n',
    'A <m lang=de>Wort</m>.\n',
  ]) {
    const result = parse(source);
    assert.equal(result.status, 'ok');
    if (result.status !== 'ok') continue;
    const stack: object[] = [result.document];
    while (stack.length > 0) {
      const node = stack.pop()! as Record<string, unknown>;
      assert.equal(result.annotations.has(node as never), true, String(node.type));
      for (const key of ['children', 'alt', 'label', 'caption']) {
        const children = node[key];
        if (Array.isArray(children)) for (const child of children) if (typeof child === 'object' && child !== null) stack.push(child);
      }
    }
  }
});

test('metadata wrapper closing is stack-aware and direct same-kind nesting is rejected', () => {
  assert.equal(parse('<m lang=en><m data-x=y>X</m></m>\n').status, 'invalid');
  const indirect = parse('<m lang=en>*<m data-x=y>X</m>*</m>\n');
  assert.equal(indirect.status, 'ok');
  if (indirect.status === 'ok') {
    const formatted = format(indirect.document);
    assert.equal(formatted.status, 'ok');
    if (formatted.status === 'ok') assert.equal(parse(formatted.source, { strict: true }).status, 'ok');
  }
});

test('formatter rejects present-but-empty resource attribute objects', () => {
  for (const child of [
    { type: 'imageBlock', src: 'i.jpg', alt: [], attrs: {} },
    { type: 'paragraph', children: [{ type: 'text', value: 'A ' }, { type: 'inlineImage', src: 'i.jpg', alt: [], attrs: {} }] },
    { type: 'paragraph', children: [{ type: 'text', value: 'Get ' }, { type: 'link', href: 'f.zip', children: [], download: true, attrs: {} }] },
  ]) assert.equal(format({ type: 'document', children: [child], footnotes: [] } as never).status, 'invalid');
});
