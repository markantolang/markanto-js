import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

import { parse } from '../src/index.js';

const directory = new URL('../test/corpus-realistic/', import.meta.url);
for (const name of readdirSync(directory).filter((entry) => entry.endsWith('.mrk')).sort()) {
  const source = readFileSync(new URL(name, directory), 'utf8');
  const parsed = parse(source);
  if (parsed.status !== 'ok') {
    throw new Error(`${name}: ${parsed.status} ${parsed.diagnostics[0]?.message ?? ''}`);
  }
  const target = new URL(`${name.slice(0, -4)}.ast.json`, directory);
  writeFileSync(target, `${JSON.stringify(parsed.document, null, 2)}\n`);
}
