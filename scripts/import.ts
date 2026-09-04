import { readFileSync } from 'node:fs';

import { importCommonMark } from '../src/commonmark/index.js';

const file = process.argv[2];
if (file === undefined) {
  process.stderr.write('usage: bun run import <file>\n');
  process.exit(1);
}

const result = importCommonMark(readFileSync(file, 'utf8'));
for (const diagnostic of result.diagnostics) {
  process.stderr.write(`${diagnostic.location.line}:${diagnostic.location.column}: ${diagnostic.category}: ${diagnostic.message}\n`);
}
process.stdout.write(result.markanto);
