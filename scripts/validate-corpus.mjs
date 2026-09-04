import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateSemanticAstSnapshot } from './validate-semantic-ast.mjs';

const root = new URL('../', import.meta.url);
const manifestUrl = new URL('test/fixtures/manifest.json', root);
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));

const allowedCategories = new Set(['syntax', 'semantic', 'resource', 'noncanonical', 'advisory']);
const allowedSeverities = new Set(['error', 'warning']);

function assertLfOnly(value, label) {
  assert.equal(value.includes('\r'), false, `${label} contains CR`);
}

function validateMode(mode, label) {
  assert.equal(typeof mode.valid, 'boolean', `${label}.valid must be boolean`);
  if (mode.canonical !== undefined) {
    assert.equal(typeof mode.canonical, 'string', `${label}.canonical must be string`);
    assertLfOnly(mode.canonical, `${label}.canonical`);
    assert.equal(mode.canonical.endsWith('\n'), true, `${label}.canonical must end in LF`);
  }
  for (const diagnostic of mode.diagnostics ?? []) {
    assert.equal(allowedCategories.has(diagnostic.category), true, `${label}: unknown category ${diagnostic.category}`);
    assert.equal(allowedSeverities.has(diagnostic.severity), true, `${label}: unknown severity ${diagnostic.severity}`);
  }
}

assert.equal(manifest.schemaVersion, 1, 'unsupported manifest schema');
const ids = new Set();
let seen = 0;

for (const entry of manifest.files) {
  const fileUrl = new URL(entry.path, root);
  const corpus = JSON.parse(await readFile(fileUrl, 'utf8'));
  assert.equal(corpus.schemaVersion, 1, `${entry.path}: unsupported schema`);
  assert.equal(corpus.group, entry.group, `${entry.path}: group mismatch`);
  assert.equal(corpus.cases.length, entry.cases, `${entry.path}: manifest count mismatch`);

  // The transport group deliberately exercises inputs the other groups may not
  // express: a leading BOM, CRLF / lone CR endings, a missing or doubled
  // terminal LF, the empty document. Its `source` is the byte-exact input, so
  // the LF-only / trailing-LF shape checks do not apply to it (spec §7 / §7.4).
  const isTransport = entry.group === 'transport';

  for (const item of corpus.cases) {
    assert.equal(typeof item.id, 'string', `${entry.path}: case id missing`);
    assert.equal(ids.has(item.id), false, `duplicate case id ${item.id}`);
    ids.add(item.id);
    assert.equal(typeof item.spec, 'string', `${item.id}.spec missing`);
    assert.notEqual(item.spec.length, 0, `${item.id}.spec empty`);
    assert.equal(typeof item.source, 'string', `${item.id}.source missing`);
    if (!isTransport) {
      assertLfOnly(item.source, `${item.id}.source`);
      assert.equal(item.source.endsWith('\n'), true, `${item.id}.source must end in LF`);
    }
    assert.ok(item.expect?.normal, `${item.id}.expect.normal missing`);
    assert.ok(item.expect?.strict, `${item.id}.expect.strict missing`);
    validateMode(item.expect.normal, `${item.id}.normal`);
    validateMode(item.expect.strict, `${item.id}.strict`);
    if (item.semanticAst !== undefined) {
      validateSemanticAstSnapshot(item.semanticAst, `${item.id}.semanticAst`);
    }
    seen += 1;
  }
}

assert.equal(seen, manifest.caseCount, `manifest caseCount=${manifest.caseCount}, seen=${seen}`);
console.log(`Conformance corpus OK: ${seen} cases across ${manifest.files.length} files.`);
