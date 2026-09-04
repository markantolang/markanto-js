import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const sourceRoot = new URL('data/unicode-15.1.0/', root);
const metadata = JSON.parse(await readFile(new URL('.meta.json', sourceRoot), 'utf8'));
assert.equal(metadata.unicodeVersion, '15.1.0');

const sources = new Map();
for (const source of metadata.sources) {
  const text = await readFile(new URL(source.file, sourceRoot), 'utf8');
  const actual = createHash('sha256').update(text).digest('hex');
  assert.equal(actual, source.sha256, `${source.file}: SHA-256 mismatch`);
  sources.set(source.file, text);
}

const word = [];
let pendingFirst;
for (const line of sources.get('UnicodeData.txt').split('\n')) {
  if (line.length === 0) continue;
  const fields = line.split(';');
  const code = Number.parseInt(fields[0], 16);
  const name = fields[1];
  const category = fields[2];
  if (name.endsWith(', First>')) {
    pendingFirst = { code, category };
    continue;
  }
  let start = code;
  if (name.endsWith(', Last>')) {
    assert.ok(pendingFirst !== undefined, `${name}: Last without First`);
    assert.equal(category, pendingFirst.category, `${name}: category mismatch`);
    start = pendingFirst.code;
    pendingFirst = undefined;
  }
  if (category.startsWith('L') || category === 'Nd') word.push([start, code]);
}
assert.equal(pendingFirst, undefined, 'unterminated UnicodeData range');
word.push([0x5f, 0x5f]);

const whitespace = [];
for (const line of sources.get('PropList.txt').split('\n')) {
  const match = /^([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s+;\s+White_Space\b/u.exec(line);
  if (match === null) continue;
  whitespace.push([Number.parseInt(match[1], 16), Number.parseInt(match[2] ?? match[1], 16)]);
}

function merge(ranges) {
  ranges.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged = [];
  for (const [start, end] of ranges) {
    assert.ok(Number.isInteger(start) && start >= 0 && end >= start && end <= 0x10ffff);
    const previous = merged.at(-1);
    if (previous !== undefined && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

const table = { word: merge(word), whitespace: merge(whitespace) };
await writeFile(new URL('data/unicode-classes-v0.1.0.json', root), `${JSON.stringify(table)}\n`);
console.log(`Unicode ${metadata.unicodeVersion} classes: ${table.word.length} word ranges, ${table.whitespace.length} whitespace ranges.`);
