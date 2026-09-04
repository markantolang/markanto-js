import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const sourceRoot = new URL('../src/', import.meta.url);
const commonmarkRoot = new URL('../src/commonmark/', import.meta.url);
const commonmarkDependencies = new Set([
  'mdast-util-from-markdown',
  'mdast-util-gfm',
  'micromark-extension-gfm',
]);

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

const importPatterns = [
  /\bfrom\s+['"]([^'"]+)['"]/gu,
  /\bimport\s+['"]([^'"]+)['"]/gu,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
];

for (const file of await sourceFiles(sourceRoot)) {
  const contents = await readFile(file, 'utf8');
  for (const pattern of importPatterns) {
    for (const match of contents.matchAll(pattern)) {
      const specifier = match[1];
      assert.ok(
        specifier.startsWith('.') || specifier.startsWith('node:') ||
          (file.pathname.startsWith(commonmarkRoot.pathname) && commonmarkDependencies.has(specifier)),
        `${file.pathname} imports shipped runtime dependency ${JSON.stringify(specifier)}`,
      );
    }
  }
  // A dynamic import whose argument is not a single string literal (a
  // concatenation, template with substitution, or identifier) escapes the
  // patterns above — forbid it outright in shipped code.
  for (const match of contents.matchAll(/\bimport\s*\(\s*([^)]*?)\s*\)/gu)) {
    const argument = match[1];
    assert.ok(
      /^(['"])[^'"]*\1$/u.test(argument) || /^`[^`$]*`$/u.test(argument),
      `${file.pathname} uses a non-literal dynamic import: import(${argument})`,
    );
  }
  assert.equal(
    /\bimport\s+\w+\s*=\s*require\s*\(/u.test(contents),
    false,
    `${file.pathname} uses TS import-equals require()`,
  );
}

console.log('Shipped dependency boundary OK.');
