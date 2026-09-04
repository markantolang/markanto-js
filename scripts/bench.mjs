/**
 * Benchmark: Markanto 0.1.0 vs `marked` — under whichever runtime executes this
 * file (`bun scripts/bench.mjs` or `node scripts/bench.mjs`).
 *
 * `marked` is a stable, widely-used external reference point, so this is the
 * benchmark to track across 0.1.0 releases.
 *
 * The fair, like-for-like comparison is **`parse` vs `marked.lexer`**: both turn
 * source into a structured tree without rendering. `parse + format` vs
 * `marked.parse` (→ HTML) is a secondary whole-pipeline data point — Markanto
 * emits a canonical Markanto surface, marked emits HTML, so it is orientation
 * only, not an apples-to-apples number.
 *
 * Prerequisite: `bun run build` (reads `dist/index.js`). `marked` is a dev
 * dependency of this repo.
 * Output: a Markdown section on stdout. `--json` emits raw measurements.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const runtime = typeof globalThis.Bun !== 'undefined' ? `Bun ${globalThis.Bun.version}` : `Node ${process.versions.node}`;

const nu = await import(resolve(repo, 'dist/index.js'));
const markedMod = await import('marked');
const marked = { lexer: (s) => markedMod.marked.lexer(s), toHtml: (s) => markedMod.marked.parse(s) };

const corpusDir = resolve(repo, 'test/corpus-realistic');
const docs = readdirSync(corpusDir)
  .filter((n) => n.endsWith('.mrk'))
  .sort()
  .map((name) => ({ name, text: readFileSync(resolve(corpusDir, name), 'utf8') }));
const corpusBytes = docs.reduce((n, d) => n + d.text.length, 0);
const largest = docs.reduce((a, b) => (b.text.length > a.text.length ? b : a));

/** A large plain document: headings, prose, lists, code, quotes, tables — no IDs, no footnotes. */
function syntheticDoc(sections) {
  const word = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod'.split(' ');
  const lorem = (n) => Array.from({ length: n }, (_, i) => word[i % word.length]).join(' ');
  const out = [];
  for (let s = 1; s <= sections; s += 1) {
    out.push(`## Section ${s}`, '', lorem(40), '', lorem(35), '');
    out.push(`- ${lorem(6)}`, `- ${lorem(5)}`, `- ${lorem(7)}`, '');
    if (s % 3 === 0) out.push('```', lorem(10), lorem(8), '```', '');
    if (s % 4 === 0) out.push(`> ${lorem(12)}`, '');
    if (s % 5 === 0) out.push('| a | b |', '| - | - |', `| ${lorem(2)} | ${lorem(2)} |`, '');
  }
  return `${out.join('\n')}\n`;
}
const big = syntheticDoc(1200);

const mkParse = (s) => { const r = nu.parse(s, {}); if (r.status !== 'ok') throw new Error(`parse ${r.status}`); return r.document; };
const mkFormat = (d) => { const r = nu.format(d); if (r.status !== 'ok') throw new Error(`format ${r.status}`); return r.source; };

function measure(fn, bytes, budgetMs = 2500) {
  for (let i = 0; i < 20; i += 1) fn();
  let iterations = 0;
  const started = performance.now();
  let elapsed = 0;
  while (elapsed < budgetMs) { fn(); iterations += 1; elapsed = performance.now() - started; }
  const msPerOp = elapsed / iterations;
  return { msPerOp, mbPerSec: bytes / 1e6 / (msPerOp / 1000) };
}

const bigKb = (big.length / 1024).toFixed(0);
const scenarios = [
  {
    key: `${docs.length} realistic docs (${(corpusBytes / 1024).toFixed(0)} KB)`,
    like: true,
    bytes: corpusBytes,
    markanto: () => { for (const d of docs) mkParse(d.text); },
    marked: () => { for (const d of docs) marked.lexer(d.text); },
  },
  {
    key: `largest realistic doc "${largest.name}" (${(largest.text.length / 1024).toFixed(1)} KB)`,
    like: true,
    bytes: largest.text.length,
    markanto: () => mkParse(largest.text),
    marked: () => marked.lexer(largest.text),
  },
  {
    key: `${bigKb} KB synthetic`,
    like: true,
    bytes: big.length,
    markanto: () => mkParse(big),
    marked: () => marked.lexer(big),
  },
  {
    key: `${bigKb} KB synthetic — whole pipeline (Markanto → canonical, marked → HTML)`,
    like: false,
    bytes: big.length,
    markanto: () => mkFormat(mkParse(big)),
    marked: () => marked.toHtml(big),
  },
];

const rows = scenarios.map((s) => ({
  scenario: s.key,
  like: s.like,
  markanto: measure(s.markanto, s.bytes),
  marked: measure(s.marked, s.bytes),
})).map((r) => ({ ...r, ratio: r.marked.msPerOp / r.markanto.msPerOp }));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ runtime, corpusBytes, docCount: docs.length, rows }, null, 2));
} else {
  console.log(`### ${runtime}\n`);
  console.log('`parse` vs `marked.lexer` is the like-for-like comparison; the pipeline row is orientation only.\n');
  console.log('| scenario | marked ms/op | Markanto ms/op | marked MB/s | Markanto MB/s | Markanto vs marked |');
  console.log('|---|--:|--:|--:|--:|--:|');
  for (const r of rows) {
    const v = r.ratio >= 1 ? `${r.ratio.toFixed(2)}× faster` : `${(1 / r.ratio).toFixed(2)}× slower`;
    console.log(`| ${r.scenario} | ${r.marked.msPerOp.toFixed(3)} | ${r.markanto.msPerOp.toFixed(3)} | ${r.marked.mbPerSec.toFixed(1)} | ${r.markanto.mbPerSec.toFixed(1)} | ${r.like ? v : `_${v}_`} |`);
  }
  console.log(`\nmarked ${markedMod.marked?.constructor?.name ? '' : ''}v${JSON.parse(readFileSync(resolve(repo, 'node_modules/marked/package.json'), 'utf8')).version} · ${new Date().toISOString().slice(0, 10)}`);
}
