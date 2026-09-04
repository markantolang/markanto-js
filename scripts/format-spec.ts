/**
 * Rewrites `spec/markanto-spec-v0.1.0.md` in its canonical Markanto surface, so
 * `test/unit/spec-dogfood.test.ts` (strict-valid + byte-stable) stays green
 * after a prose edit. Refuses to write if the canonicalisation would change the
 * word multiset — that would mean the edit introduced a construct with no
 * canonical form, which must be fixed in the prose, not papered over here.
 *
 *   bun scripts/format-spec.ts          # rewrite in place
 *   bun scripts/format-spec.ts --check  # exit 1 if not already canonical
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { format, parse } from '../src/index.js';

const path = new URL('../spec/markanto-spec-v0.1.0.md', import.meta.url);
const source = readFileSync(path, 'utf8');
const check = process.argv.includes('--check');

const parsed = parse(source);
if (parsed.status !== 'ok') {
  console.error(`spec does not parse: ${parsed.status} — ${parsed.status === 'invalid' ? parsed.diagnostics[0]?.message : ''}`);
  process.exit(1);
}
const formatted = format(parsed.document);
if (formatted.status !== 'ok') {
  console.error(`spec has no canonical surface: ${JSON.stringify(formatted.diagnostics[0] ?? formatted.status)}`);
  process.exit(1);
}

const words = (text: string): string[] => (text.toLowerCase().match(/\p{L}[\p{L}\p{N}_-]*/gu) ?? []).sort();
const before = words(source);
const after = words(formatted.source);
if (before.length !== after.length || before.some((word, index) => word !== after[index])) {
  console.error('canonicalisation would change the spec word multiset — fix the offending construct in the prose');
  process.exit(1);
}

if (formatted.source === source) {
  console.log('spec is already canonical.');
  process.exit(0);
}
if (check) {
  console.error('spec is not in canonical form — run `bun scripts/format-spec.ts`');
  process.exit(1);
}
writeFileSync(path, formatted.source);
console.log(`rewrote spec in canonical form (${source.length} → ${formatted.source.length} bytes).`);
