import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(repositoryRoot, 'dist');
const expected = join(repositoryRoot, 'dist');

if (dist !== expected || dirname(dist) !== repositoryRoot || dist === repositoryRoot) {
  throw new Error(`refusing to clean unexpected build path: ${dist}`);
}

await rm(dist, { recursive: true, force: true });
