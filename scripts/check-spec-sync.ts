/**
 * Checks that the vendored specifications in `vendor/spec/` and the named
 * character references in `data/` are exactly what the specification
 * repository holds at the tags `vendor/spec/source.json` records.
 *
 * It reads a local clone of https://github.com/markantolang/spec and never
 * the network:
 *
 *   bun scripts/check-spec-sync.ts [--checkout <dir>]   # default: ../spec
 *
 * Exit 0 = in sync · 1 = a difference · 2 = setup error.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Source {
  readonly repository: string;
  readonly versions: Readonly<Record<string, { readonly tag: string; readonly commit: string }>>;
  readonly data: string;
}

const root = new URL('../', import.meta.url);
const at = process.argv.indexOf('--checkout');
const checkout = resolve(at >= 0 && process.argv[at + 1] !== undefined ? process.argv[at + 1]! : '../spec');
const source = JSON.parse(readFileSync(new URL('vendor/spec/source.json', root), 'utf8')) as Source;
const DATA = ['html-named-character-references-v0.1.0.json', 'html-named-character-references-v0.1.0.meta.json'];

function git(...args: string[]): Buffer {
  const result = spawnSync('git', ['-C', checkout, ...args], { timeout: 30_000, maxBuffer: 64 * 1024 * 1024 });
  if (result.error !== undefined || result.status !== 0) {
    console.error(`check-spec-sync: git ${args.join(' ')} failed in ${checkout}: ${result.error?.message ?? result.stderr.toString().trim()}`);
    process.exit(2);
  }
  return result.stdout;
}

let differences = 0;
function compare(label: string, expected: Buffer, actual: Buffer): void {
  if (expected.equals(actual)) return;
  console.error(`check-spec-sync: ${label} differs from the specification repository`);
  differences += 1;
}

for (const [version, { tag, commit }] of Object.entries(source.versions)) {
  const tagged = git('rev-parse', '--verify', '--end-of-options', `refs/tags/${tag}^{commit}`).toString().trim();
  if (tagged !== commit) {
    console.error(`check-spec-sync: tag ${tag} is ${tagged}, vendor/spec/source.json records ${commit}`);
    differences += 1;
    continue;
  }
  compare(`vendor/spec/${version}/spec.md`, git('cat-file', 'blob', `${commit}:spec.md`),
    readFileSync(new URL(`vendor/spec/${version}/spec.md`, root)));
}

const dataCommit = source.versions[source.data]?.commit;
if (dataCommit === undefined) {
  console.error(`check-spec-sync: vendor/spec/source.json names data version ${source.data}, which it does not list`);
  process.exit(2);
}
for (const name of DATA) {
  compare(`data/${name}`, git('cat-file', 'blob', `${dataCommit}:data/${name}`), readFileSync(new URL(`data/${name}`, root)));
}

if (differences > 0) process.exit(1);
console.log(`check-spec-sync: vendor/spec and data match ${source.repository} at ${Object.values(source.versions).map((v) => v.tag).join(', ')}`);
