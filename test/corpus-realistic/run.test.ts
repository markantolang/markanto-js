import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import type { Document } from '../../src/ast.js';
import { format, parse, semanticDocumentEquals, validate } from '../../src/index.js';

const directory = new URL('./', import.meta.url);
const documents = readdirSync(directory).filter((name) => name.endsWith('.mrk')).sort();
assert.equal(documents.length, 14, 'all realistic documents are registered');

for (const name of documents) {
  test(`realistic canonical document: ${name}`, () => {
    const source = readFileSync(new URL(name, directory), 'utf8');
    const snapshot = JSON.parse(readFileSync(new URL(`${name.slice(0, -4)}.ast.json`, directory), 'utf8')) as Document;

    const normal = parse(source);
    assert.equal(normal.status, 'ok', describe(normal));
    if (normal.status !== 'ok') return;
    assert.deepEqual(normal.document, snapshot, 'semantic AST snapshot drift');

    const formatted = format(normal.document);
    assert.equal(formatted.status, 'ok', describe(formatted));
    if (formatted.status !== 'ok') return;
    assert.equal(formatted.source, source, 'fixture is not byte-canonical');

    const strict = parse(source, { strict: true });
    assert.equal(strict.status, 'ok', describe(strict));
    if (strict.status !== 'ok') return;

    const valid = validate(normal.document);
    assert.equal(valid.status, 'ok', describe(valid));

    const semantic = semanticDocumentEquals(normal.document, strict.document);
    assert.deepEqual(semantic, { status: 'ok', equal: true }, 'normal/strict semantic drift');

    const again = format(strict.document);
    assert.equal(again.status === 'ok' && again.source, source, 'formatter is not byte-idempotent');

    const reparsed = parse(formatted.source);
    assert.equal(reparsed.status, 'ok', describe(reparsed));
    if (reparsed.status === 'ok') {
      assert.deepEqual(semanticDocumentEquals(normal.document, reparsed.document), { status: 'ok', equal: true });
    }
  });
}

function describe(result: { readonly status: string; readonly diagnostics?: readonly { readonly category?: string; readonly message?: string }[] }): string {
  const first = result.diagnostics?.[0];
  return first === undefined ? result.status : `${result.status}: ${first.category ?? ''} ${first.message ?? ''}`;
}
