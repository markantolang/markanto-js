import { readFileSync } from 'node:fs';

import { migrateV053 } from '../tools/migrate/index.js';

const file = process.argv[2];
if (file === undefined) {
  process.stderr.write('usage: bun run migrate <file>\n');
  process.exit(1);
}

const raw = readFileSync(file, 'utf8');

// A leading YAML / LIMA frontmatter block (`---` … `---`, optionally HTML-comment
// wrapped as `<!---` … `--->`) is not Markanto — pass it through untouched and
// migrate only the body.
const frontmatter = raw.match(/^(<!)?---[^\S\r\n]*\r?\n[\s\S]*?^--->?[^\S\r\n]*\r?\n/mu)?.[0] ?? '';
const body = raw.slice(frontmatter.length);

const result = migrateV053(body);
for (const diagnostic of result.diagnostics) {
  process.stderr.write(`${diagnostic.location.line}:${diagnostic.location.column}: ${diagnostic.category}: ${diagnostic.message}\n`);
}

const unrepresentable = result.text.length === 0 && result.diagnostics.some((diagnostic) => diagnostic.category === 'unrepresentable');
if (unrepresentable) {
  process.stderr.write('migration produced no output — nothing written\n');
  process.exit(1);
}

process.stdout.write(frontmatter + result.text);
