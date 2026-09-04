#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { format, parse } from '../../../src/index.ts';
import { importCommonMark } from '../../../src/commonmark/index.ts';

const root = new URL('.', import.meta.url).pathname;
const lock = JSON.parse(await readFile(join(root, 'sources-lock.json'), 'utf8'));

function refKinds(source) {
  const rootNode = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const kinds = new Set();
  const stack = [rootNode];
  while (stack.length) { const node = stack.pop(); kinds.add(node.type); stack.push(...(node.children ?? [])); }
  return kinds;
}
function referenceSkeleton(source) {
  const rootNode = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const visit = (node) => {
    switch (node.type) {
      case 'paragraph': return [{ kind: 'paragraph' }]; case 'heading': return [{ kind: `heading(${node.depth})` }];
      case 'code': return [{ kind: 'codeBlock' }]; case 'thematicBreak': return [{ kind: 'horizontalRule' }];
      case 'blockquote': return [{ kind: 'quoteRegion', children: (node.children ?? []).flatMap(visit) }];
      case 'list': return [{ kind: `list(${node.ordered ? 'ordered' : 'unordered'})`, children: (node.children ?? []).flatMap(visit) }];
      case 'listItem': return [{ kind: 'listItem', children: (node.children ?? []).flatMap(visit) }];
      case 'table': return [{ kind: 'table', children: (node.children ?? []).flatMap(visit) }];
      case 'tableRow': return [{ kind: 'tableRow', children: (node.children ?? []).flatMap(visit) }];
      case 'tableCell': return [{ kind: 'tableCell' }];
      case 'html': return [{ kind: node.value?.trimStart().startsWith('<!--') ? 'commentBlock' : 'rawHtml' }];
      case 'definition': return []; default: return [];
    }
  };
  return rootNode.children.flatMap(visit);
}
function markantoSkeleton(document) {
  const visit = (node) => {
    switch (node.type) {
      case 'paragraph': case 'codeBlock': case 'mathBlock': case 'horizontalRule': case 'commentBlock': return [{ kind: node.type }];
      case 'heading': return [{ kind: `heading(${node.level})` }];
      case 'quoteRegion': return [{ kind: 'quoteRegion', children: node.children.flatMap((child) => visit(child.block)) }];
      case 'list': return [{ kind: `list(${node.kind})`, children: node.items.flatMap(visit) }];
      case 'listItem': return [{ kind: 'listItem', children: node.children.flatMap(visit) }];
      case 'table': return [{ kind: 'table', children: [...visit(node.head), ...node.body.flatMap(visit)] }];
      case 'tableRow': return [{ kind: 'tableRow', children: node.cells.flatMap(visit) }];
      case 'tableCell': return [{ kind: 'tableCell' }];
      default: return [{ kind: node.type }];
    }
  };
  return document.children.flatMap(visit);
}
function markantoKinds(document) {
  const kinds = [];
  const stack = [...document.children];
  while (stack.length) {
    const node = stack.pop(); kinds.push(node.type);
    if (node.type === 'list') for (const item of node.items) stack.push(...item.children);
    else if (node.type === 'quoteRegion') for (const item of node.children) stack.push(item.block);
    else if (node.type === 'container') stack.push(...node.children);
  }
  return kinds;
}
function hasCrossLine(source) {
  return [
    /\*\*[^\n]*\n[^]*?\*\*/u,
    /(^|[^*])\*[^*\n][^\n]*\n[^]*?\*(?!\*)/mu,
    /<m(?:\s[^>]*)?>[^\n]*\n[^]*?<\/m>/iu,
    /(`+)[^\n]*\n[^]*?\1/u,
  ].some((pattern) => pattern.test(source));
}
function collapseCrossLine(source) {
  const patterns = [/(\*\*[^\n]*)\n([^]*?\*\*)/gu, /(<m(?:\s[^>]*)?>[^\n]*)\n([^]*?<\/m>)/giu, /(`+[^\n]*)\n([^]*?`+)/gu];
  let out = source;
  for (const pattern of patterns) out = out.replace(pattern, '$1 $2');
  out = out.replace(/((?:^|[^*])\*[^*\n][^\n]*)\n([^]*?\*(?!\*))/gmu, '$1 $2');
  return out;
}
function classify(source, diagnostics, refs) {
  const rows = new Set();
  const messages = diagnostics.map((item) => `${item.code ?? ''} ${item.message ?? ''}`).join(' ').toLowerCase();
  if (refs.has('html')) rows.add('HTML blocks / raw inline HTML');
  if (refs.has('definition') || refs.has('linkReference') || refs.has('imageReference')) rows.add('Reference-style links/images + `[label]: url` definitions');
  if (/(^|\n)( {4}|\t)\S/u.test(source) && refs.has('code')) rows.add('Indented code blocks');
  if (/(^|\n)[^\n]+\n[=-]+\s*(?:\n|$)/u.test(source) && refs.has('heading')) rows.add('Setext headings');
  if (/(^|\n)\s*(?:_\s*){3,}(?:\n|$)/u.test(source)) rows.add('Thematic break `_` form');
  if (hasCrossLine(source)) rows.add('Multiline CommonMark inline constructs');
  if (refs.has('blockquote') && /\n(?!\s*>)[^\n]+/u.test(source)) rows.add('Block quotes');
  if (refs.has('list') && /(?:^|\n)(?:\t| {1,8})[-+*]\s/u.test(source)) rows.add('Lists');
  if (/fence|backtick|unclosed code/iu.test(messages)) rows.add('Fenced code blocks');
  if (/inline|delimiter|token|link|image|wrapper/iu.test(messages) && rows.size === 0) rows.add('Unclosed inline token');
  if (rows.size === 0) rows.add('Block/inline precedence');
  return [...rows];
}

const records = [];
for (const item of lock.documents) {
  const raw = await readFile(join(root, item.local), 'utf8');
  // Repository metadata is not Markdown content. Audit the page body, matching
  // how documentation generators hand content to their Markdown parser.
  const source = raw.replace(/^\uFEFF?---\s*\n[^]*?\n---\s*(?:\n|$)/u, '');
  const normal = parse(source, { errorRecovery: false });
  const recovery = parse(source, { errorRecovery: true });
  const refs = refKinds(source);
  const status = normal.status === 'ok'
    ? (JSON.stringify(referenceSkeleton(source)) === JSON.stringify(markantoSkeleton(normal.document)) ? 'ok' : 'structural')
    : 'reject';
  const imported = normal.status === 'ok' ? null : importCommonMark(source);
  const strict = imported === null ? null : parse(imported.markanto, { strict: true });
  const reformatted = strict?.status === 'ok' ? format(strict.document) : null;
  const stable = imported !== null && strict?.status === 'ok' && reformatted?.status === 'ok' && reformatted.source === imported.markanto;
  const lossy = imported?.diagnostics.some((d) => d.category === 'content-dropped' || d.category === 'unrepresentable') ?? false;
  const collapsed = hasCrossLine(source) ? collapseCrossLine(source) : source;
  const crossLineOnly = normal.status !== 'ok' && collapsed !== source && parse(collapsed, { errorRecovery: false }).status === 'ok';
  records.push({
    local: item.local, category: item.category, bytes: Buffer.byteLength(source), frontmatterBytes: raw.length - source.length, status,
    normalStatus: normal.status, recovery: recovery.status === 'invalid' && recovery.recovery ? 'available' : recovery.status,
    diagnostics: normal.diagnostics.map((d) => ({ code: d.code, message: d.message, line: d.range?.start.line })),
    constructs: normal.status === 'ok' ? [] : classify(source, normal.diagnostics, refs),
    crossLineOnly,
    import: imported === null ? null : { stable, lossy, diagnostics: imported.diagnostics.map((d) => d.category) },
    markantoKinds: normal.status === 'ok' ? markantoKinds(normal.document) : [],
  });
}
const summary = { total: records.length };
for (const key of ['ok', 'reject', 'structural']) summary[key] = records.filter((r) => r.status === key).length;
summary.crossLineOnly = records.filter((r) => r.crossLineOnly).length;
summary.importStable = records.filter((r) => r.import?.stable).length;
summary.importLossless = records.filter((r) => r.import?.stable && !r.import.lossy).length;
await writeFile(join(root, 'results.json'), `${JSON.stringify({ summary, records }, null, 2)}\n`);
console.log(summary);
