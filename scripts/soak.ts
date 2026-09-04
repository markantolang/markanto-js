/**
 * Large deterministic property soak (audit #6). A seeded run of many thousands
 * of generated documents — both surface text and hand-built ASTs — checked
 * against the four §7.2 canonicalisation laws, the `validate()` domain, and a
 * coarse parser-linearity probe.
 *
 * This is a nightly / pre-freeze gate, **not** part of `bun run verify` (the
 * `property-*.test.ts` suites are the fast smoke version). The previous line
 * ran a 100 000-case soak (`../monorepo/js/property-run.ts`); this restores the
 * volume with a fixed seed so any failure reproduces exactly.
 *
 *   bun run soak                 # 100 000 cases per stream, seed 0x50AC
 *   bun run soak -- --count 5000 # shorter run
 *   bun run soak -- --seed 42
 */
import { format, parse, semanticDocumentEquals, validate } from '../src/index.js';
import { generateSource } from '../test/helpers/generate-source.js';
import { generateAst, mulberry32 } from '../test/helpers/generate-ast.js';

interface Options { count: number; seed: number }

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { count: 100_000, seed: 0x50ac };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--count') options.count = Number(argv[++i]);
    else if (arg === '--seed') options.seed = Number(argv[++i]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.count) || options.count < 1) throw new Error('--count must be a positive integer');
  if (!Number.isInteger(options.seed)) throw new Error('--seed must be an integer');
  return options;
}

interface Failure { readonly stream: 'source' | 'ast'; readonly n: number; readonly law: string; readonly detail: string }
interface StreamResult { readonly checked: number; readonly failures: readonly Failure[] }

function equalDocs(a: Parameters<typeof semanticDocumentEquals>[0], b: Parameters<typeof semanticDocumentEquals>[1]): boolean {
  const result = semanticDocumentEquals(a, b);
  return result.status === 'ok' && result.equal;
}

/** Surface-text stream: the four §7.2 laws over `generateSource`. */
function sourceStream(count: number, seed: number): StreamResult {
  const r = mulberry32(seed);
  const failures: Failure[] = [];
  let checked = 0;
  for (let n = 0; n < count && failures.length <= 50; n += 1) {
    const source = generateSource(r);
    const first = parse(source);
    if (first.status !== 'ok') continue; // the tolerated-surface generator may emit invalid combinations
    checked += 1;
    const formatted = format(first.document);
    if (formatted.status !== 'ok') { failures.push({ stream: 'source', n, law: 'format', detail: `${formatted.status} for ${JSON.stringify(source)}` }); continue; }
    const strict = parse(formatted.source, { strict: true });
    if (strict.status !== 'ok') { failures.push({ stream: 'source', n, law: '4 (strict accepts canonical)', detail: JSON.stringify(formatted.source) }); continue; }
    if (!equalDocs(first.document, strict.document)) { failures.push({ stream: 'source', n, law: '1 (parseNormal∘format)', detail: JSON.stringify(formatted.source) }); continue; }
    const again = format(strict.document);
    if (again.status !== 'ok' || again.source !== formatted.source) { failures.push({ stream: 'source', n, law: '3 (idempotence)', detail: JSON.stringify(formatted.source) }); continue; }
    const reNormal = parse(formatted.source);
    if (reNormal.status !== 'ok' || !equalDocs(strict.document, reNormal.document)) {
      failures.push({ stream: 'source', n, law: '2 (normal/strict converge)', detail: JSON.stringify(formatted.source) });
    }
  }
  return { checked, failures };
}

/** AST stream: laws 2 + 3 + 4 over every `validate()`-accepted `generateAst`. */
function astStream(count: number, seed: number): StreamResult {
  const r = mulberry32(seed ^ 0x1357);
  const failures: Failure[] = [];
  let checked = 0;
  for (let n = 0; n < count && failures.length <= 50; n += 1) {
    const document = generateAst(r);
    if (validate(document).status !== 'ok') continue;
    checked += 1;
    const formatted = format(document);
    if (formatted.status !== 'ok') { failures.push({ stream: 'ast', n, law: 'format (validate-accepted)', detail: formatted.status }); continue; }
    const reparsed = parse(formatted.source);
    if (reparsed.status !== 'ok') { failures.push({ stream: 'ast', n, law: 'canonical parses', detail: JSON.stringify(formatted.source) }); continue; }
    if (!equalDocs(document, reparsed.document)) { failures.push({ stream: 'ast', n, law: '2 (parseStrict∘format)', detail: JSON.stringify(formatted.source) }); continue; }
    const again = format(reparsed.document);
    if (again.status !== 'ok' || again.source !== formatted.source) { failures.push({ stream: 'ast', n, law: '3 (idempotence)', detail: JSON.stringify(formatted.source) }); continue; }
    if (parse(formatted.source, { strict: true }).status !== 'ok') {
      failures.push({ stream: 'ast', n, law: '4 (strict accepts canonical)', detail: JSON.stringify(formatted.source) });
    }
  }
  return { checked, failures };
}

/**
 * Coarse linearity probe: parse the same document at doubling sizes and check
 * that per-byte cost does not blow up. Best-of-5 per point damps GC noise; a
 * warm-up pass precedes the first measured point; every point is compared to
 * the running minimum, so a mid-range spike is not masked by a fast endpoint.
 * This is a smoke check, not a rigorous complexity bound.
 */
function linearityProbe(seed: number): string | null {
  const r = mulberry32(seed ^ 0x2468);
  const unit = `${generateSource(r)}\n${generateSource(r)}\n`;
  const factors = [8, 16, 32, 64, 128, 256];
  parse(unit.repeat(factors[0]!)); // warm-up
  const perByte = factors.map((factor) => {
    const doc = unit.repeat(factor);
    let best = Infinity;
    for (let i = 0; i < 5; i += 1) {
      const start = performance.now();
      parse(doc);
      best = Math.min(best, (performance.now() - start) / doc.length);
    }
    return best;
  });
  // Linear parsing keeps per-byte cost roughly flat across a 32x size range.
  // Allow 3x slack for allocator / cache effects; a superlinear parser blows
  // past it well before the largest point.
  let floor = perByte[0]!;
  for (let i = 1; i < perByte.length; i += 1) {
    if (perByte[i]! > floor * 3) {
      return `per-byte parse cost spiked ${(perByte[i]! / floor).toFixed(1)}x at ${factors[i]}x input ` +
        `(${perByte.map((v) => v.toExponential(1)).join(' → ')})`;
    }
    floor = Math.min(floor, perByte[i]!);
  }
  return null;
}

function main(): void {
  const { count, seed } = parseArgs(process.argv.slice(2));
  console.log(`soak: ${count.toLocaleString()} cases per stream, seed 0x${seed.toString(16)}`);
  const start = performance.now();

  const source = sourceStream(count, seed);
  const ast = astStream(count, seed);
  const linearity = linearityProbe(seed);

  const failures = [...source.failures, ...ast.failures];
  const elapsed = ((performance.now() - start) / 1000).toFixed(1);

  console.log(`source stream: ${source.checked.toLocaleString()} / ${count.toLocaleString()} parsed and law-checked`);
  console.log(`ast stream:    ${ast.checked.toLocaleString()} / ${count.toLocaleString()} validate-accepted and law-checked`);
  console.log(`linearity probe: ${linearity ?? 'ok'}`);
  console.log(`elapsed: ${elapsed}s`);

  if (failures.length === 0 && linearity === null) {
    console.log('SOAK PASS — no law violations');
    return;
  }
  for (const f of failures.slice(0, 50)) console.log(`  FAIL [${f.stream} #${f.n}] law ${f.law}: ${f.detail}`);
  if (linearity !== null) console.log(`  FAIL linearity: ${linearity}`);
  console.log(`SOAK FAIL — ${failures.length} law violation(s)${linearity ? ' + linearity' : ''}`);
  process.exit(1);
}

main();
