/**
 * The package smoke test: builds `dist/` (the build the gate needs), packs the package, installs it in a consumer
 * project and runs its API and CLI under the Node on the PATH and under Bun, first without the optional peers, then
 * the CommonMark entry with them. A plain script, so that no probe can be skipped: every step runs, and any failure
 * throws and exits non-zero.
 *
 *   node test/package-smoke.ts
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHILD_TIMEOUT_MS = 2 * 60 * 1000;

interface CommandOutput {
  readonly status: number | null;
  readonly error: Error | undefined;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * `process.env` minus the npm lifecycle / config variables an outer `npm`
 * invocation exports. Without this, running the suite from inside
 * `npm publish --dry-run` leaks `npm_config_dry_run=true` into the child
 * `npm install` here and it becomes a silent no-op.
 */
const hermeticEnv: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^npm_(config|lifecycle|package)_/u.test(key)),
);

function run(command: string, args: readonly string[], cwd: string, env = hermeticEnv): CommandOutput {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: CHILD_TIMEOUT_MS });
  return { status: result.status, error: result.error, stdout: result.stdout, stderr: result.stderr };
}

function explain(label: string, result: CommandOutput): string {
  const error = result.error === undefined ? '' : ` (${result.error.message})`;
  return `${label}: status ${result.status}${error}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}

/** The runtimes the packed package is run on: the Node on the PATH, which the gate and CI choose, and Bun. */
const RUNTIMES = ['node', 'bun'] as const;

const repository = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'markanto-package-'));
try {
  // The package's build, the gate's one build; --ignore-scripts runs no lifecycle hook (a `prebuild`) with it.
  const build = run('npm', ['--ignore-scripts', 'run', 'build'], repository);
  assert.equal(build.status, 0, explain('build', build));

  const packDirectory = join(temporary, 'pack');
  mkdirSync(packDirectory);
  const packed = run('bun', ['pm', 'pack', '--destination', packDirectory, '--ignore-scripts'], repository);
  assert.equal(packed.status, 0, explain('pack', packed));
  const tarballs = readdirSync(packDirectory).filter((name) => name.endsWith('.tgz'));
  assert.equal(tarballs.length, 1, `tarballs: ${tarballs.join(', ')}`);
  const tarball = join(packDirectory, tarballs[0]!);

  const listed = run('tar', ['-tzf', tarball], repository);
  assert.equal(listed.status, 0, explain('tar list', listed));
  const entries = listed.stdout.split('\n').filter(Boolean);
  for (const required of [
    'package/package.json', 'package/README.md', 'package/LICENSE', 'package/CHANGELOG.md',
    'package/dist/index.js', 'package/dist/index.d.ts', 'package/dist/cli.js',
    'package/data/html-named-character-references-v0.1.0.json',
  ]) {
    assert.ok(entries.includes(required), `missing ${required}`);
  }
  for (const entry of entries.map((name) => name.replace(/\/$/u, ''))) {
    assert.match(
      entry,
      /^package\/(?:package\.json|README\.md|LICENSE|CHANGELOG\.md|(?:dist|data)(?:\/.+)?)$/u,
      `unexpected tar entry ${entry}`,
    );
    assert.equal(/(?:^|\/)(?:src|test|tools)(?:\/|$)/u.test(entry), false, `source/tooling leak ${entry}`);
    assert.equal(entry.endsWith('.map'), false, `source map leak ${entry}`);
    assert.equal(entry.includes('.test.'), false, `test leak ${entry}`);
  }

  const project = join(temporary, 'project');
  mkdirSync(project);
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'smoke', private: true, type: 'module' }));
  const npmCache = join(temporary, 'npm-cache');
  mkdirSync(npmCache);
  const installed = run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', npmCache, tarball], project);
  assert.equal(installed.status, 0, explain('install', installed));

  writeFileSync(join(project, 'probe.mjs'), `
    import { adoptDocument, format, parse } from '@markantolang/parser';
    const parsed = parse('# Title\\n');
    if (parsed.status !== 'ok') throw new Error('parse ' + parsed.status);
    const formatted = format(parsed.document);
    if (formatted.status !== 'ok' || formatted.source !== '# Title\\n') throw new Error('format');
    let next = 0;
    const adopted = adoptDocument(parsed.document, () => 'id-' + (++next));
    if (adopted.addedIds !== 1 || adopted.document.children[0].id !== 'id-1') throw new Error('adopt');
    process.exit(42);
  `);
  writeFileSync(join(project, 'valid.md'), '# Title\n');

  // The installed command as a consumer runs it, by its own shebang: the bin npm linked from the package's `bin` field.
  writeFileSync(join(project, 'command.md'), '##  Title\n');
  const command = run(join(project, 'node_modules', '.bin', 'markanto'), ['format', 'command.md', '--stdout'], project);
  assert.equal(command.status, 0, explain('installed markanto', command));
  assert.equal(command.stdout, '## Title\n', explain('installed markanto output', command));

  // The CLI under each runtime: the JavaScript file the installed manifest's `bin` names.
  const installedPackage = join(project, 'node_modules', '@markantolang', 'parser');
  const installedManifest = JSON.parse(readFileSync(join(installedPackage, 'package.json'), 'utf8')) as {
    bin?: { markanto?: unknown };
  };
  const binTarget = installedManifest.bin?.markanto;
  assert.equal(typeof binTarget, 'string', 'the installed manifest names a bin.markanto file');
  const cli = join(installedPackage, binTarget as string);
  for (const runtime of RUNTIMES) {
    const api = run(runtime, ['probe.mjs'], project);
    assert.equal(api.status, 42, explain(`${runtime} API`, api));
    const check = run(runtime, [cli, 'check', 'valid.md'], project);
    assert.equal(check.status, 0, explain(`${runtime} CLI check`, check));

    writeFileSync(join(project, 'stdout.md'), '##  Title\n');
    const stdoutRun = run(runtime, [cli, 'format', 'stdout.md', '--stdout'], project);
    assert.equal(stdoutRun.status, 0, explain(`${runtime} CLI --stdout`, stdoutRun));
    assert.equal(stdoutRun.stdout, '## Title\n', explain(`${runtime} --stdout output`, stdoutRun));
    assert.equal(readFileSync(join(project, 'stdout.md'), 'utf8'), '##  Title\n', '--stdout must not touch the file');

    writeFileSync(join(project, 'noncanonical.md'), '##  Title\n');
    const formatted = run(runtime, [cli, 'format', 'noncanonical.md'], project);
    assert.equal(formatted.status, 0, explain(`${runtime} CLI format`, formatted));
    assert.equal(readFileSync(join(project, 'noncanonical.md'), 'utf8'), '## Title\n');
    writeFileSync(join(project, 'adopt.md'), '# Title\n');
    const adopt = run(runtime, [cli, 'adopt', 'adopt.md'], project);
    assert.equal(adopt.status, 0, explain(`${runtime} CLI adopt`, adopt));
    assert.match(readFileSync(join(project, 'adopt.md'), 'utf8'), /\{#[A-Za-z0-9_-]+\}/u);
  }

  // The Core API and CLI ran without the optional peers. The CommonMark entry needs them, and npm leaves them out;
  // the smoke test has no network, so the consumer gets the ones of this checkout.
  const manifest = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')) as { peerDependencies: Record<string, string> };
  for (const peer of Object.keys(manifest.peerDependencies)) {
    symlinkSync(join(repository, 'node_modules', peer), join(project, 'node_modules', peer), 'junction');
  }
  writeFileSync(join(project, 'commonmark-probe.mjs'), `
    import { importCommonMark } from '@markantolang/parser/commonmark';
    if (importCommonMark('Title\\n=====\\n').markanto !== '# Title\\n') throw new Error('importCommonMark');
    process.exit(42);
  `);
  for (const runtime of RUNTIMES) {
    const imported = run(runtime, ['commonmark-probe.mjs'], project);
    assert.equal(imported.status, 42, explain(`${runtime} CommonMark import`, imported));
  }

  assert.equal(readFileSync(join(project, 'valid.md'), 'utf8'), '# Title\n', 'check never mutates its input');
  console.log(`package-smoke: the packed package works under ${RUNTIMES.join(' and ')}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
