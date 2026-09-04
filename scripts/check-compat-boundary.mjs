import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const sourceRoot = new URL('../src/', import.meta.url);
const importRoot = new URL('../src/commonmark/', import.meta.url);
const migrateRoot = new URL('../tools/migrate/', import.meta.url);
const forbidden = [
  'mdast-util-from-markdown',
  'micromark-extension-gfm',
  'mdast-util-gfm',
  'tools/migrate/legacy',
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) files.push(...await sourceFiles(url));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(url);
  }
  return files;
}

for (const file of (await sourceFiles(sourceRoot)).filter((file) => !file.pathname.includes('/src/commonmark/'))) {
  const contents = await readFile(file, 'utf8');
  for (const packageName of forbidden) {
    assert.equal(
      contents.includes(packageName),
      false,
      `${file.pathname} must not import compatibility-only package ${packageName}`,
    );
  }
}

// `src/commonmark/` may import the three GFM libraries (checked against the
// allowlist by `check-shipped-deps.mjs`); `tools/migrate/` may import nothing
// bare at all. Both may reach Core only through its public index.
const allowedBare = {
  [importRoot.pathname]: new Set(['mdast-util-from-markdown', 'micromark-extension-gfm', 'mdast-util-gfm']),
  [migrateRoot.pathname]: new Set(),
};
for (const root of [importRoot, migrateRoot]) {
  for (const file of await sourceFiles(root)) {
    const contents = await readFile(file, 'utf8');
    // static `from '…'` / `import '…'`, dynamic `import('…')`, and `require('…')`.
    for (const match of contents.matchAll(/(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (specifier.startsWith('node:') || allowedBare[root.pathname].has(specifier)) continue;
      if (specifier.startsWith('..')) {
        assert.equal(
          specifier === '../index.js' || specifier.endsWith('/src/index.js'),
          true,
          `${file.pathname} must reach Core only through its public index (found ${specifier})`,
        );
        continue;
      }
      assert.equal(
        specifier.startsWith('./'),
        true,
        `${file.pathname} imports a bare / non-local module ${JSON.stringify(specifier)} outside the allowlist`,
      );
    }
  }
}

console.log('Compatibility dependency boundary OK.');
