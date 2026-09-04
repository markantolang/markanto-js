/**
 * Freezes a compact snapshot of the previous line's conformance corpus
 * (`../monorepo/corpus/`, spec v0.5.3 / AST v0.4.0) under
 * `test/migrate/v053-corpus/` so the v0.5.3 -> 0.1.0 migration evolution gate
 * (`test/migrate/migration-evolution-gate.test.ts`) survives the 0.1.0 freeze,
 * after which `../monorepo` may go away.
 *
 * Only the valid cases (`result.ast` present) are kept, and only the fields the
 * gate needs: `id`, `specRef`, `input`. The v0.4.0 expected AST is deliberately
 * not vendored — the gate re-parses `input` with the vendored legacy parser
 * (`tools/migrate/legacy/`) to learn the source construct inventory, and checks
 * the migrated 0.1.0 output for representability and round-trip; it never
 * compares against the old AST.
 *
 * Run from the repo root:  node scripts/vendor-v053-corpus.mjs
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { parse as legacyParse } from '../tools/migrate/legacy/parser.js';

const SOURCE_ROOT = new URL('../../monorepo/corpus/', import.meta.url);
const OUT_DIR = new URL('../test/migrate/v053-corpus/', import.meta.url);

if (!existsSync(SOURCE_ROOT)) {
  console.error(`missing ${SOURCE_ROOT.pathname} — the previous monorepo must be a sibling checkout`);
  process.exit(1);
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) yield* walk(child);
    else if (entry.name.endsWith('.json') && !dir.pathname.includes('/schema/')) yield child;
  }
}

/** Whether a v0.5.3 AST fragment carries an error-recovery node. */
function hasErrorNode(node) {
  if (node === null || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(hasErrorNode);
  if (node.type === 'errorBlock' || node.type === 'recoveryDocument') return true;
  return Object.values(node).some(hasErrorNode);
}

const cases = [];
let skippedError = 0;
let skippedLegacyReject = 0;
for (const file of walk(SOURCE_ROOT)) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  // Valid cases only: a v0.4.0 AST with no error-recovery node, and one the
  // vendored legacy parser accepts without recovery. An error / recovery case
  // has no valid document to migrate — `migrateV053` correctly rejects it, but
  // it is not what the evolution gate measures.
  if (!Array.isArray(parsed.result?.ast) || hasErrorNode(parsed.result.ast)) { skippedError += 1; continue; }
  try {
    legacyParse(parsed.input, { errorRecovery: false });
  } catch {
    skippedLegacyReject += 1;
    continue;
  }
  cases.push({ id: parsed.id, specRef: String(parsed.specRef ?? ''), input: parsed.input });
}
cases.sort((left, right) => left.id.localeCompare(right.id));

const hash = createHash('sha256').update(cases.map((c) => `${c.id}\n${c.input}\n`).join('')).digest('hex');

writeFileSync(new URL('cases.json', OUT_DIR), `${JSON.stringify({ schemaVersion: 1, cases }, null, 1)}\n`);
writeFileSync(
  new URL('provenance.json', OUT_DIR),
  `${JSON.stringify({
    source: 'monorepo/corpus — the v0.5.3 conformance corpus (spec v0.5.3, AST v0.4.0)',
    extractedFields: ['id', 'specRef', 'input'],
    validOnly: true,
    note: 'The v0.4.0 expected AST is not vendored; the evolution gate checks the migrated 0.1.0 output, not equality against the old AST.',
    caseCount: cases.length,
    inputsSha256: hash,
  }, null, 2)}\n`,
);

console.log(
  `vendored ${cases.length} valid v0.5.3 cases -> test/migrate/v053-corpus/ ` +
  `(sha256 ${hash.slice(0, 16)}…; skipped ${skippedError} error/recovery + ${skippedLegacyReject} legacy-rejected)`,
);
