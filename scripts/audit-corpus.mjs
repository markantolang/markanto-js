import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const specText = await readFile(new URL('spec/markanto-spec-v0.1.0.md', root), 'utf8');
const manifest = JSON.parse(await readFile(new URL('test/fixtures/manifest.json', root), 'utf8'));

const headings = new Map();
for (const [index, line] of specText.split('\n').entries()) {
  const match = /^(?:#{2,6})\s+(\d+(?:\.\d+)*(?:[a-z])?)\s+(.+)$/.exec(line);
  if (match) headings.set(match[1], { title: match[2], line: index + 1 });
}

const counts = new Map();
let cases = 0;
for (const entry of manifest.files) {
  const corpus = JSON.parse(await readFile(new URL(entry.path, root), 'utf8'));
  for (const item of corpus.cases) {
    const sections = item.spec.split(',').map((section) => section.trim());
    for (const section of sections) {
      assert.equal(headings.has(section), true, `${item.id}: unknown spec section ${section}`);
      counts.set(section, (counts.get(section) ?? 0) + 1);
    }
    cases += 1;
  }
}

console.log(`Corpus coverage: ${cases} cases; ${counts.size}/${headings.size} numbered sections have direct case references.`);
console.log('');
for (const [section, meta] of headings) {
  const count = counts.get(section) ?? 0;
  if (count > 0) console.log(`${section.padEnd(8)} ${String(count).padStart(3)}  ${meta.title}`);
}
