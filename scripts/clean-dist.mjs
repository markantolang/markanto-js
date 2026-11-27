/**
 * Removes `dist`, the compiler output at the repository root, and refuses when git tracks any file in it, under any
 * case of the name: on a case-insensitive file system `Dist/` is `dist/`.
 */
import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv.length > 2) {
  throw new Error(`clean-dist takes no arguments; it cleans dist only (got ${process.argv.slice(2).join(' ')})`);
}
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tracked = execFileSync('git', ['ls-files', '--', ':(icase)dist'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
  timeout: 60_000,
});
if (tracked.length > 0) {
  throw new Error(`refusing to clean dist: git tracks files in it:\n${tracked}`);
}
await rm(resolve(repositoryRoot, 'dist'), { recursive: true, force: true });
