/**
 * Triage the raw candidate edge-case sources in `test/corpus-candidates/`.
 *
 * For every `{ id, spec, source, intent }` candidate this runs the reference
 * parser + formatter, classifies the observed behaviour, checks the four §7.2
 * laws, and compares the outcome against the author's one-line `intent` guess.
 * It writes a human report (`triage-report.md`) and a machine-readable
 * `triage-report.json` for the promotion step. It changes nothing else.
 *
 * Run: `bun scripts/triage-candidates.ts`
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

import { format, parse, semanticDocumentEquals } from '../src/index.js';

const dir = new URL('../test/corpus-candidates/', import.meta.url);

interface Candidate {
  readonly id: string;
  readonly spec: string;
  readonly source: string;
  readonly intent: string;
}

type Outcome =
  | 'canonical'          // parses ok and is already its own canonical form
  | 'noncanonical'       // parses ok, formats, but the canonical form differs
  | 'rejects-syntax'
  | 'rejects-semantic'
  | 'rejects-noncanonical'
  | 'resource'
  | 'format-bug'         // parse ok but format failed — a real defect
  | 'law1-closure'       // parse(format(x)) drifts semantically
  | 'law2-idempotence'   // format is not byte-idempotent
  | 'law4-strict';       // strict rejects the formatter's own output

interface Result {
  readonly id: string;
  readonly spec: string;
  readonly family: string;
  readonly source: string;
  readonly intent: string;
  readonly outcome: Outcome;
  readonly detail: string;
  readonly canonical?: string;
  readonly intentMismatch: boolean;
}

const REJECT_HINTS = ['error', 'invalid', 'reject', 'not valid', 'fehler', 'ungültig', 'ungueltig', 'abgelehnt', 'nicht erlaubt', 'verboten'];
const TOLERATE_HINTS = ['tolerat', 'toleri', 'normalis', 'normalisiert', 'canonicali', 'kanonisch', 'accepted', 'valid', 'gültig', 'gueltig', 'ok'];

function intentSuggestsReject(intent: string): boolean {
  const lower = intent.toLowerCase();
  return REJECT_HINTS.some((hint) => lower.includes(hint)) && !lower.includes('not an error') && !lower.includes('kein fehler');
}
function intentSuggestsAccept(intent: string): boolean {
  const lower = intent.toLowerCase();
  return TOLERATE_HINTS.some((hint) => lower.includes(hint));
}

function classify(candidate: Candidate): Omit<Result, 'id' | 'spec' | 'family' | 'source' | 'intent' | 'intentMismatch'> {
  const p1 = parse(candidate.source);
  if (p1.status === 'resource') return { outcome: 'resource', detail: p1.diagnostics[0]?.message ?? '' };
  if (p1.status === 'invalid') {
    const category = p1.diagnostics[0]?.category ?? 'syntax';
    const outcome: Outcome = category === 'semantic' ? 'rejects-semantic' : category === 'noncanonical' ? 'rejects-noncanonical' : 'rejects-syntax';
    return { outcome, detail: `${category}: ${p1.diagnostics[0]?.message ?? ''}` };
  }

  const f1 = format(p1.document);
  if (f1.status !== 'ok') return { outcome: 'format-bug', detail: `${f1.status}: ${f1.diagnostics[0]?.message ?? ''}` };

  const p2 = parse(f1.source, { strict: true });
  if (p2.status !== 'ok') {
    return { outcome: 'law4-strict', detail: `strict rejects canonical output: ${p2.status} ${p2.status === 'invalid' ? p2.diagnostics[0]?.message ?? '' : ''}`, canonical: f1.source };
  }
  const eq = semanticDocumentEquals(p1.document, p2.document);
  if (!(eq.status === 'ok' && eq.equal)) {
    return { outcome: 'law1-closure', detail: 'parse(format(x)) is not semantically equal to x', canonical: f1.source };
  }
  const f2 = format(p2.document);
  if (!(f2.status === 'ok' && f2.source === f1.source)) {
    return { outcome: 'law2-idempotence', detail: 'format is not byte-idempotent', canonical: f1.source };
  }

  if (f1.source === candidate.source) return { outcome: 'canonical', detail: '' };
  return { outcome: 'noncanonical', detail: 'tolerated surface', canonical: f1.source };
}

const results: Result[] = [];
for (const file of readdirSync(dir).filter((name) => name.endsWith('.json') && !name.startsWith('triage-'))) {
  const parsed = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as { family: string; candidates: Candidate[] };
  for (const candidate of parsed.candidates) {
    const base = classify(candidate);
    const accepted = base.outcome === 'canonical' || base.outcome === 'noncanonical';
    const rejected = base.outcome.startsWith('rejects');
    const intentMismatch =
      (accepted && intentSuggestsReject(candidate.intent) && !intentSuggestsAccept(candidate.intent)) ||
      (rejected && intentSuggestsAccept(candidate.intent) && !intentSuggestsReject(candidate.intent));
    results.push({
      id: candidate.id, spec: candidate.spec, family: parsed.family,
      source: candidate.source, intent: candidate.intent,
      intentMismatch, ...base,
    });
  }
}

const bugs = results.filter((r) => r.outcome === 'format-bug' || r.outcome.startsWith('law'));
const mismatches = results.filter((r) => r.intentMismatch && !bugs.includes(r));
const bucketCounts = new Map<Outcome, number>();
for (const r of results) bucketCounts.set(r.outcome, (bucketCounts.get(r.outcome) ?? 0) + 1);

const q = (value: string): string => JSON.stringify(value);
const block = (r: Result): string => `- \`${r.id}\` (§${r.spec}) — ${r.detail || r.outcome}\n  source: \`${q(r.source)}\`\n  intent: ${r.intent}`;

const lines: string[] = [
  '# Candidate triage report',
  '',
  `Generated by \`scripts/triage-candidates.ts\` over ${results.length} candidates. Not committed as fixtures — this drives the promotion step.`,
  '',
  '## Buckets',
  '',
  '| outcome | count |',
  '|---|---:|',
  ...[...bucketCounts.entries()].sort((a, b) => b[1] - a[1]).map(([outcome, count]) => `| \`${outcome}\` | ${count} |`),
  `| **intent mismatches** | ${mismatches.length} |`,
  `| **parser/formatter bugs** | ${bugs.length} |`,
  '',
];

if (bugs.length > 0) {
  lines.push('## ⚠️ Parser / formatter bugs — investigate before promoting anything', '');
  for (const r of bugs) lines.push(block(r), '');
}

lines.push('## ⚠️ Intent mismatches — the parser disagrees with the author guess; a reviewer decides which is right', '');
if (mismatches.length === 0) lines.push('_none_', '');
for (const r of mismatches) lines.push(block(r), '');

for (const outcome of ['canonical', 'noncanonical', 'rejects-syntax', 'rejects-semantic', 'rejects-noncanonical', 'resource'] as const) {
  const rows = results.filter((r) => r.outcome === outcome && !r.intentMismatch);
  lines.push(`## ${outcome} (${rows.length})`, '');
  const hint = {
    canonical: 'promote as **canonical valid** fixtures',
    noncanonical: 'promote as **tolerated valid**, using the `canonical` field as `expect.*.canonical`',
    'rejects-syntax': 'promote as **invalid syntax** (pin `diagnostics[0].category = "syntax"`)',
    'rejects-semantic': 'promote as **invalid semantics** (pin `diagnostics[0].category = "semantic"`)',
    'rejects-noncanonical': 'review — a noncanonical rejection in normal mode is unusual',
    resource: 'review — a small candidate should not hit a budget',
  }[outcome];
  lines.push(`_${hint}._`, '');
  for (const r of rows) {
    lines.push(`- \`${r.id}\` (§${r.spec}) \`${q(r.source)}\`${r.canonical !== undefined ? ` → \`${q(r.canonical)}\`` : ''} — ${r.intent}`);
  }
  lines.push('');
}

writeFileSync(new URL('triage-report.md', dir), `${lines.join('\n')}\n`);
writeFileSync(new URL('triage-report.json', dir), `${JSON.stringify(results, null, 2)}\n`);

console.log(`triaged ${results.length} candidates`);
console.log(`  bugs: ${bugs.length}   intent mismatches: ${mismatches.length}`);
for (const [outcome, count] of [...bucketCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${outcome}: ${count}`);
}
if (bugs.length > 0) process.exitCode = 1;
