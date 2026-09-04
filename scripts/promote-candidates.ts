import { readFile, writeFile } from 'node:fs/promises';

import { format, parse, semanticDocumentEquals, validate } from '../src/index.js';

type Candidate = {
  readonly id: string;
  readonly family: string;
  readonly spec: string;
  readonly source: string;
  readonly outcome: string;
  readonly intent: string;
  readonly intentMismatch: boolean;
};

type Fixture = {
  readonly id: string;
  readonly spec: string;
  readonly source: string;
  readonly expect: { readonly normal: Expectation; readonly strict: Expectation };
  readonly semanticAst?: unknown;
};

type Expectation = {
  readonly valid: boolean;
  readonly canonical?: string;
  readonly diagnostics?: readonly { readonly category: string; readonly severity: string }[];
};

const family = process.argv[2];
if (family === undefined) throw new Error('usage: bun scripts/promote-candidates.ts <family>');

const fixturePath = `test/fixtures/${family}/cases.json`;
const report = JSON.parse(await readFile('test/corpus-candidates/triage-report.json', 'utf8')) as
  | Candidate[]
  | { readonly candidates: Candidate[] };
const candidates = Array.isArray(report) ? report : report.candidates;
const corpus = JSON.parse(await readFile(fixturePath, 'utf8')) as {
  schemaVersion: number;
  group: string;
  cases: Fixture[];
};

const parserBugs = new Set([
  'cand.resources.image.kindless-no-attr-invalid',
  'cand.lists.structured.heading-invalid',
  'cand.lists.structured.hr-invalid',
  'cand.tables.rows.header-more-cells-invalid',
  'cand.tables.rows.separator-more-cells-invalid',
]);
const existingSources = new Set(corpus.cases.map((fixture) => fixture.source));
const existingIds = new Set(corpus.cases.map((fixture) => fixture.id));

const ranked = candidates
  .filter((candidate) => candidate.family === family && !parserBugs.has(candidate.id))
  .filter((candidate) => !existingSources.has(candidate.source))
  .filter((candidate) => !existingIds.has(promotedId(candidate)))
  .map((candidate) => ({ candidate, area: candidate.id.split('.')[2] ?? '', score: coverageScore(candidate) }))
  .sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id));

const selected: Candidate[] = [];
const perArea = new Map<string, number>();
const perOutcome = new Map<string, number>();
for (const entry of ranked) {
  if ((perArea.get(entry.area) ?? 0) >= 8) continue;
  if (entry.candidate.outcome.startsWith('rejects') && (perOutcome.get('rejects') ?? 0) >= 8) continue;
  selected.push(entry.candidate);
  perArea.set(entry.area, (perArea.get(entry.area) ?? 0) + 1);
  const outcome = entry.candidate.outcome.startsWith('rejects') ? 'rejects' : entry.candidate.outcome;
  perOutcome.set(outcome, (perOutcome.get(outcome) ?? 0) + 1);
  if (selected.length === 20) break;
}
if (selected.length !== 20) throw new Error(`${family}: selected ${selected.length}, expected 20`);

const promoted: Fixture[] = [];
for (const candidate of selected) promoted.push(verifyAndBuild(candidate));
corpus.cases.push(...promoted);
await writeFile(fixturePath, `${JSON.stringify(corpus, null, 2)}\n`);

const manifest = JSON.parse(await readFile('test/fixtures/manifest.json', 'utf8')) as {
  caseCount: number;
  files: { path: string; cases: number }[];
};
const manifestEntry = manifest.files.find((entry) => entry.path === fixturePath);
if (manifestEntry === undefined) throw new Error(`${fixturePath}: absent from manifest`);
manifestEntry.cases += promoted.length;
manifest.caseCount += promoted.length;
await writeFile('test/fixtures/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`${family}: promoted ${promoted.length}`);
for (const fixture of promoted) console.log(`  ${fixture.id}`);

function verifyAndBuild(candidate: Candidate): Fixture {
  const normal = parse(candidate.source);
  const strict = parse(candidate.source, { strict: true });
  const expectedOutcome = normal.status === 'ok'
    ? formatOrThrow(normal.document).source === candidate.source ? 'canonical' : 'noncanonical'
    : `rejects-${normal.diagnostics[0]?.category}`;
  if (expectedOutcome !== candidate.outcome) {
    throw new Error(`${candidate.id}: stale triage ${candidate.outcome}, actual ${expectedOutcome}`);
  }

  let semanticAst: unknown;
  if (normal.status === 'ok') {
    const validation = validate(normal.document);
    if (validation.status !== 'ok') throw new Error(`${candidate.id}: parser produced invalid AST`);
    const canonical = formatOrThrow(normal.document).source;
    const canonicalParse = parse(canonical, { strict: true });
    if (canonicalParse.status !== 'ok') throw new Error(`${candidate.id}: canonical strict parse failed`);
    const equality = semanticDocumentEquals(normal.document, canonicalParse.document);
    if (equality.status !== 'ok' || !equality.equal) throw new Error(`${candidate.id}: semantic round-trip failed`);
    const second = formatOrThrow(canonicalParse.document).source;
    if (second !== canonical) throw new Error(`${candidate.id}: formatter byte idempotence failed`);
    semanticAst = normal.document;
  }

  return {
    id: promotedId(candidate),
    spec: candidate.spec,
    source: candidate.source,
    expect: { normal: expectation(normal), strict: expectation(strict) },
    ...(semanticAst === undefined ? {} : { semanticAst }),
  };
}

function expectation(result: ReturnType<typeof parse>): Expectation {
  if (result.status === 'ok') return { valid: true, canonical: formatOrThrow(result.document).source };
  const diagnostic = result.diagnostics[0];
  if (diagnostic === undefined) throw new Error('invalid/resource parse without diagnostic');
  return {
    valid: false,
    diagnostics: [{ category: diagnostic.category, severity: diagnostic.severity }],
  };
}

function formatOrThrow(document: Parameters<typeof format>[0]): Extract<ReturnType<typeof format>, { status: 'ok' }> {
  const result = format(document);
  if (result.status !== 'ok') throw new Error('formatter rejected parser-produced document');
  return result;
}

function promotedId(candidate: Candidate): string {
  const id = candidate.id.slice('cand.'.length);
  return candidate.family === 'blocks' ? id.replace(/^blocks\./u, 'block.') : id;
}

function coverageScore(candidate: Candidate): number {
  const signals = [
    'priority', 'boundary', 'collision', 'nested', 'overlap', 'atomic', 'escape',
    'depth', 'jump', 'inside', 'adjacent', 'mixed', 'context', 'delimiter',
    'structured', 'order', 'grid', 'caption', 'continuation', 'interaction',
  ];
  let score = candidate.outcome === 'canonical' ? 4 : candidate.outcome === 'noncanonical' ? 3 : 0;
  for (const signal of signals) if (candidate.id.includes(signal)) score += 5;
  if (candidate.intentMismatch) score += 2;
  return score;
}
