import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

interface CommandOutput { readonly status: number | null; readonly stdout: string; readonly stderr: string }

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
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function explain(label: string, result: CommandOutput): string {
  return `${label}: status ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}

function nodeBins(): string[] {
  const configured = process.env['MARKANTO_NODE_BINS'];
  if (configured !== undefined && configured.length > 0) return configured.split(':').filter(Boolean);
  const bins = new Set<string>(['node']);
  const mise = join(homedir(), '.local', 'share', 'mise', 'installs', 'node');
  if (existsSync(mise)) {
    for (const version of readdirSync(mise)) {
      if (!/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(version)) continue;
      const binary = join(mise, version, 'bin', 'node');
      if (existsSync(binary)) bins.add(binary);
    }
  }
  return [...bins];
}

test('packed package is minimal and works under every local Node baseline and Bun when available', { timeout: 120_000 }, (t) => {
  const repository = resolve('.');
  const temporary = mkdtempSync(join(tmpdir(), 'markanto-package-'));
  try {
    const build = run('bun', ['run', 'build'], repository);
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
    writeFileSync(join(project, 'valid.mrk'), '# Title\n');
    writeFileSync(join(project, 'noncanonical.mrk'), '##  Title\n');

    const cli = join(project, 'node_modules', '@markantolang', 'parser', 'dist', 'cli.js');
    assert.ok(existsSync(cli), 'installed CLI entry exists');
    assert.ok(existsSync(join(project, 'node_modules', '.bin', 'markanto')), 'installed markanto bin exists');
    for (const binary of nodeBins()) {
      const version = run(binary, ['--version'], project);
      assert.equal(version.status, 0, explain(`${binary} --version`, version));
      const api = run(binary, ['probe.mjs'], project);
      assert.equal(api.status, 42, explain(`${binary} API`, api));
      const check = run(binary, [cli, 'check', 'valid.mrk'], project);
      assert.equal(check.status, 0, explain(`${binary} CLI check`, check));

      writeFileSync(join(project, 'stdout.mrk'), '##  Title\n');
      const stdoutRun = run(binary, [cli, 'format', 'stdout.mrk', '--stdout'], project);
      assert.equal(stdoutRun.status, 0, explain(`${binary} CLI --stdout`, stdoutRun));
      assert.equal(stdoutRun.stdout, '## Title\n', explain(`${binary} --stdout output`, stdoutRun));
      assert.equal(readFileSync(join(project, 'stdout.mrk'), 'utf8'), '##  Title\n', '--stdout must not touch the file');

      writeFileSync(join(project, 'noncanonical.mrk'), '##  Title\n');
      const formatted = run(binary, [cli, 'format', 'noncanonical.mrk'], project);
      assert.equal(formatted.status, 0, explain(`${binary} CLI format`, formatted));
      assert.equal(readFileSync(join(project, 'noncanonical.mrk'), 'utf8'), '## Title\n');
      writeFileSync(join(project, 'adopt.mrk'), '# Title\n');
      const adopt = run(binary, [cli, 'adopt', 'adopt.mrk'], project);
      assert.equal(adopt.status, 0, explain(`${binary} CLI adopt`, adopt));
      assert.match(readFileSync(join(project, 'adopt.mrk'), 'utf8'), /\{#[A-Za-z0-9_-]+\}/u);
    }

    const bunVersion = run('bun', ['--version'], project);
    if (bunVersion.status === null) {
      t.diagnostic('Bun consumer checks skipped: bun is not available');
    } else {
      assert.equal(bunVersion.status, 0, explain('bun --version', bunVersion));
      const api = run('bun', ['probe.mjs'], project);
      assert.equal(api.status, 42, explain('bun API', api));
      const check = run('bun', [cli, 'check', 'valid.mrk'], project);
      assert.equal(check.status, 0, explain('bun CLI check', check));

      writeFileSync(join(project, 'bun-stdout.mrk'), '##  Title\n');
      const stdoutRun = run('bun', [cli, 'format', 'bun-stdout.mrk', '--stdout'], project);
      assert.equal(stdoutRun.status, 0, explain('bun CLI --stdout', stdoutRun));
      assert.equal(stdoutRun.stdout, '## Title\n', explain('bun --stdout output', stdoutRun));
      assert.equal(readFileSync(join(project, 'bun-stdout.mrk'), 'utf8'), '##  Title\n', '--stdout must not touch the file');

      writeFileSync(join(project, 'bun-adopt.mrk'), '# Title\n');
      const adopt = run('bun', [cli, 'adopt', 'bun-adopt.mrk'], project);
      assert.equal(adopt.status, 0, explain('bun CLI adopt', adopt));
      assert.match(readFileSync(join(project, 'bun-adopt.mrk'), 'utf8'), /\{#[A-Za-z0-9_-]+\}/u);
    }

    assert.equal(readFileSync(join(project, 'valid.mrk'), 'utf8'), '# Title\n', 'check never mutates its input');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
