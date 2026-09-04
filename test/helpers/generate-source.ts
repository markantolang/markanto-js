/**
 * Seeded multi-phase surface-text generator: paragraphs, headings, thematic
 * breaks, lists, quotes, tables, code fences, block resources, lined + fenced
 * containers and small Grids, plus footnote definitions at document end. Shared
 * by `test/unit/property-roundtrip.test.ts` and the `bun run soak` gate.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'value', 'note', 'text', 'item', 'core', 'unit'];
const URLS = ['https://example.com/a', 'https://example.org/p/1', 'docs/readme.md', '#anchor-1', '$symbol'];

interface Ctx {
  r: () => number;
  /** Footnote identifiers referenced so far; definitions are emitted at document end. */
  footnotes: Set<string>;
  depth: number;
}

function pick<T>(ctx: Ctx, items: readonly T[]): T {
  return items[Math.floor(ctx.r() * items.length)]!;
}
function chance(ctx: Ctx, p: number): boolean {
  return ctx.r() < p;
}
function word(ctx: Ctx): string {
  return pick(ctx, WORDS);
}
function ident(ctx: Ctx): string {
  return `${word(ctx)}-${Math.floor(ctx.r() * 1000)}`;
}

/** Inline fragment with no leading/trailing space and no break. */
function inlineAtom(ctx: Ctx): string {
  const kinds = ctx.depth >= 2
    ? ['text', 'text', 'code']
    : ['text', 'text', 'em', 'strong', 'iwrap', 'bwrap', 'code', 'del', 'obsolete',
       'insert', 'mark', 'sup', 'sub', 'link', 'image', 'autolink', 'footnote', 'math'];
  const kind = pick(ctx, kinds);
  const inner = (): string => {
    const child = { ...ctx, depth: ctx.depth + 1 };
    return `${word(child)}${chance(child, 0.4) ? ` ${word(child)}` : ''}`;
  };
  switch (kind) {
    case 'em': return `*${inner()}*`;
    case 'strong': return `**${inner()}**`;
    case 'iwrap': return `<i>${inner()}</i>`;
    case 'bwrap': return `<b>${inner()}</b>`;
    case 'code': return `\`${word(ctx)} ${word(ctx)}\``;
    case 'del': return `~~${inner()}~~`;
    case 'obsolete': return `--${inner()}--`;
    case 'insert': return `++${inner()}++`;
    case 'mark': return `==${inner()}==`;
    case 'sup': return `^${word(ctx)}^`;
    case 'sub': return `~${word(ctx)}~`;
    case 'link': return `[${inner()}](${pick(ctx, URLS)})`;
    case 'image': return `![${word(ctx)}](${pick(ctx, URLS)})`;
    case 'autolink': return `<https://example.com/${word(ctx)}>`;
    case 'math': return `$\`${word(ctx)} + ${word(ctx)}\`$`;
    case 'footnote': {
      const fid = ident(ctx);
      ctx.footnotes.add(fid);
      return `${word(ctx)}[^${fid}]`;
    }
    default: return word(ctx);
  }
}

/** A single inline line (paragraph line, heading text, cell, caption…). */
function inlineLine(ctx: Ctx, atoms = 1 + Math.floor(ctx.r() * 3)): string {
  const parts: string[] = [];
  for (let i = 0; i < atoms; i += 1) parts.push(inlineAtom(ctx));
  return parts.join(' ');
}

function paragraph(ctx: Ctx): string {
  const lines = 1 + Math.floor(ctx.r() * 2);
  const out: string[] = [];
  for (let i = 0; i < lines; i += 1) out.push(inlineLine(ctx));
  return out.join('\n');
}

function heading(ctx: Ctx): string {
  return `${'#'.repeat(1 + Math.floor(ctx.r() * 6))} ${inlineLine(ctx, 1 + Math.floor(ctx.r() * 2))}`;
}

function list(ctx: Ctx): string {
  const kind = pick(ctx, ['unordered', 'ordered', 'task', 'definition'] as const);
  const count = 2 + Math.floor(ctx.r() * 2);
  const child = { ...ctx, depth: ctx.depth + 1 };
  const rows: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const text = inlineLine(child, 1 + Math.floor(child.r() * 2));
    if (kind === 'unordered') rows.push(`- ${text}`);
    else if (kind === 'ordered') rows.push(`${i + 1}. ${text}`);
    else if (kind === 'task') rows.push(`- [${chance(child, 0.5) ? 'x' : ' '}] ${text}`);
    else rows.push(`: ${text}`);
  }
  return rows.join('\n');
}

function quote(ctx: Ctx): string {
  const child = { ...ctx, depth: ctx.depth + 1 };
  const lines = 1 + Math.floor(child.r() * 3);
  const out: string[] = [];
  let level = 1;
  for (let i = 0; i < lines; i += 1) {
    out.push(`${'> '.repeat(level)}${inlineLine(child, 1 + Math.floor(child.r() * 2))}`);
    if (chance(child, 0.3) && level < 3) level += 1;
    else if (chance(child, 0.2) && level > 1) level -= 1;
  }
  if (chance(child, 0.3)) out.push(`-- ${word(child)} ${word(child)}`);
  return out.join('\n');
}

function table(ctx: Ctx): string {
  const cols = 2 + Math.floor(ctx.r() * 2);
  const child = { ...ctx, depth: ctx.depth + 1 };
  const cell = (): string => inlineLine(child, 1 + Math.floor(child.r() * 2));
  const row = (): string => `| ${Array.from({ length: cols }, cell).join(' | ')} |`;
  const align = (): string => pick(child, ['---', ':---', '---:', ':---:']);
  const rows = [row(), `| ${Array.from({ length: cols }, align).join(' | ')} |`];
  const bodyRows = 1 + Math.floor(child.r() * 3);
  for (let i = 0; i < bodyRows; i += 1) rows.push(row());
  return rows.join('\n');
}

function codeFence(ctx: Ctx): string {
  const lang = chance(ctx, 0.5) ? pick(ctx, ['js', 'rust', 'text', 'math']) : '';
  const body = `${word(ctx)}\n${word(ctx)} ${word(ctx)}`;
  return `\`\`\`${lang}\n${body}\n\`\`\``;
}

function resourceBlock(ctx: Ctx): string {
  const kind = pick(ctx, ['image', 'video', 'audio', 'download'] as const);
  const url = pick(ctx, URLS.filter((u) => u.startsWith('http') || u.includes('/')));
  const label = word(ctx);
  const caption = chance(ctx, 0.4) ? `\\\n*${word(ctx)} ${word(ctx)}*` : '';
  if (kind === 'image') return `![${label}](${url})${caption}`;
  const attr = chance(ctx, 0.5) ? ` group=${word(ctx)}` : '';
  return `<m ${kind}${attr}>[${label}](${url})</m>${caption}`;
}

function linedContainer(ctx: Ctx): string {
  const child = { ...ctx, depth: ctx.depth + 1 };
  const type = chance(child, 0.6) ? word(child) : null;
  const title = type !== null && chance(child, 0.4) ? ` ${word(child)}` : '';
  const header = type === null ? '' : `${type}${title}\n`;
  const inner: string[] = [];
  const n = 1 + Math.floor(child.r() * 2);
  for (let i = 0; i < n; i += 1) inner.push(chance(child, 0.7) ? paragraph(child) : list(child));
  return `${header}___\n\n${inner.join('\n\n')}\n___`;
}

function fencedContainer(ctx: Ctx): string {
  const child = { ...ctx, depth: ctx.depth + 1 };
  const type = chance(child, 0.6) ? word(child) : null;
  const header = type === null ? ':::' : `::: ${type}`;
  if (chance(child, 0.35)) {
    // A small rectangular Grid.
    const shape = pick(child, ['1x2', '2x1', '2x2', 'header-1x2'] as const);
    const cellText = (): string => inlineLine(child, 1 + Math.floor(child.r() * 2));
    if (shape === '1x2') return `${header}\n${cellText()}\n--\n${cellText()}\n:::`;
    if (shape === '2x1') return `${header}\n${cellText()}\n==\n${cellText()}\n:::`;
    if (shape === '2x2') return `${header}\n${cellText()}\n--\n${cellText()}\n==\n${cellText()}\n--\n${cellText()}\n:::`;
    return `${header}\n${cellText()}\n--\n${cellText()}\n::\n${cellText()}\n--\n${cellText()}\n:::`;
  }
  const inner: string[] = [];
  const n = 1 + Math.floor(child.r() * 2);
  for (let i = 0; i < n; i += 1) inner.push(chance(child, 0.6) ? paragraph(child) : chance(child, 0.5) ? list(child) : table(child));
  return `${header}\n${inner.join('\n\n')}\n:::`;
}

/** [block text, idEligible] */
const TOP_BLOCKS: ReadonlyArray<[(ctx: Ctx) => string, boolean]> = [
  [paragraph, true],
  [heading, true],
  [() => '---', true],
  [list, true],
  [quote, true],
  [table, true],
  [codeFence, true],
  [resourceBlock, true],
  [linedContainer, true],
  [fencedContainer, true],
  [(ctx) => `<!-- ${word(ctx)} ${word(ctx)} -->`, false],
];

export function generateSource(r: () => number): string {
  const ctx: Ctx = { r, footnotes: new Set(), depth: 0 };
  const count = 1 + Math.floor(r() * 5);
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const [make, idEligible] = pick(ctx, TOP_BLOCKS);
    let chunk = make(ctx);
    if (idEligible && chance(ctx, 0.25)) {
      const singleLine = !chunk.includes('\n') && (chunk === '---' || chunk.startsWith('#'));
      chunk += singleLine ? ` {#${ident(ctx)}}` : `\n{#${ident(ctx)}}`;
    }
    parts.push(chunk);
  }
  for (const fid of ctx.footnotes) {
    const suffix = chance(ctx, 0.35) ? `\n{#${ident(ctx)}}` : '';
    parts.push(`[^${fid}]: ${word(ctx)} ${word(ctx)}.${suffix}`);
  }
  return `${parts.join('\n\n')}\n`;
}
