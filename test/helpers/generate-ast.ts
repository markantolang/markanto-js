/**
 * Seeded generator for hand-built semantic ASTs in the wider `validate()`
 * domain — `Text` payloads, emphasis nestings, destinations and sibling
 * arrangements the parser never emits. Shared by
 * `test/unit/property-ast-roundtrip.test.ts` and the `bun run soak` gate.
 *
 * `mulberry32` is re-exported so callers pin one seed.
 */
import type { Document, DocumentBlock, Inline } from '../../src/ast.js';

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['alpha', 'beta', 'gamma', 'value', 'note', 'item'];
// Deliberately awkward Text payloads the parser would never hand back verbatim.
const TEXT_ATOMS = [
  'plain', 'a', 'x', 'two words', 'C:\\notepad', 'a & b', 'less < than', 'more > than',
  '*', '_', '-', '--', '~', '^', '#', '###', ':', '::', '|', '1.', '10)', '3.14',
  'a*b*c', '\\escaped', 'end#', '# start', 'trailing hash #', 'snake_case', 'mc^2',
  '©', '×', '§', '•', '½', '\u00a0nbsp\u00a0trim',
];
const HREFS = ['', 'plain', '/root', '#frag', '$sym', 'a b', 'a\tb', 'a(b)c', 'a)b', 'has&amp;', 'https://ex.com/p'];

interface Ctx { r: () => number; depth: number }
const pick = <T>(ctx: Ctx, xs: readonly T[]): T => xs[Math.floor(ctx.r() * xs.length)]!;
const chance = (ctx: Ctx, p: number): boolean => ctx.r() < p;
const word = (ctx: Ctx): string => pick(ctx, WORDS);

function text(ctx: Ctx): Inline {
  return { type: 'text', value: pick(ctx, TEXT_ATOMS) };
}

function inlineNode(ctx: Ctx): Inline {
  if (ctx.depth >= 4) return text(ctx);
  const kind = pick(ctx, [
    'text', 'text', 'text', 'em', 'strong', 'deletion', 'obsolete', 'insert', 'mark',
    'inlineCode', 'sup', 'sub', 'link', 'inlineImage', 'autolink', 'metadataSpan',
  ] as const);
  const kids = (): Inline[] => {
    const child = { ...ctx, depth: ctx.depth + 1 };
    const n = 1 + Math.floor(child.r() * 2);
    return Array.from({ length: n }, () => inlineNode(child));
  };
  switch (kind) {
    case 'em': return { type: 'em', children: kids() as [Inline, ...Inline[]] };
    case 'strong': return { type: 'strong', children: kids() as [Inline, ...Inline[]] };
    case 'deletion': return { type: 'deletion', children: kids() as [Inline, ...Inline[]] };
    case 'obsolete': return { type: 'obsolete', children: kids() as [Inline, ...Inline[]] };
    case 'insert': return { type: 'insert', children: kids() as [Inline, ...Inline[]] };
    case 'mark': return { type: 'mark', children: kids() as [Inline, ...Inline[]] };
    case 'inlineCode': return { type: 'inlineCode', value: `${word(ctx)} ${word(ctx)}` };
    case 'sup': return { type: 'sup', value: word(ctx) };
    case 'sub': return { type: 'sub', value: word(ctx) };
    case 'link': return { type: 'link', href: pick(ctx, HREFS), children: kids(), ...(chance(ctx, 0.3) ? { title: word(ctx) } : {}) };
    case 'inlineImage': return { type: 'inlineImage', src: pick(ctx, HREFS), alt: [text(ctx)] };
    case 'autolink': return { type: 'autolink', kind: 'url', value: `https://example.com/${word(ctx)}` };
    case 'metadataSpan': return { type: 'metadataSpan', attrs: { lang: 'de' }, children: kids() as [Inline, ...Inline[]] };
    default: return text(ctx);
  }
}

function inlineSeq(ctx: Ctx): [Inline, ...Inline[]] {
  const n = 1 + Math.floor(ctx.r() * 4);
  return Array.from({ length: n }, () => inlineNode(ctx)) as [Inline, ...Inline[]];
}

function block(ctx: Ctx): DocumentBlock {
  const kind = pick(ctx, ['paragraph', 'paragraph', 'heading', 'hr', 'code', 'list', 'quote'] as const);
  switch (kind) {
    case 'heading': return { type: 'heading', level: (1 + Math.floor(ctx.r() * 6)) as 1, children: inlineSeq(ctx) as never };
    case 'hr': return { type: 'horizontalRule' };
    case 'code': return { type: 'codeBlock', value: `${word(ctx)}\n${word(ctx)}`, ...(chance(ctx, 0.5) ? { lang: 'js' } : {}) };
    case 'list': {
      const items = 1 + Math.floor(ctx.r() * 3);
      return {
        type: 'list', kind: pick(ctx, ['unordered', 'ordered'] as const),
        items: Array.from({ length: items }, () => ({ type: 'listItem', children: [{ type: 'paragraph', children: inlineSeq({ ...ctx, depth: ctx.depth + 1 }) }] })) as never,
      };
    }
    case 'quote': return {
      type: 'quoteRegion',
      children: [{ level: 1, block: { type: 'paragraph', children: inlineSeq({ ...ctx, depth: ctx.depth + 1 }) } }] as never,
    };
    default: return { type: 'paragraph', children: inlineSeq(ctx) };
  }
}

export function generateAst(r: () => number): Document {
  const ctx: Ctx = { r, depth: 0 };
  const count = 1 + Math.floor(r() * 4);
  return {
    type: 'document',
    children: Array.from({ length: count }, () => block(ctx)),
    footnotes: [],
  };
}
