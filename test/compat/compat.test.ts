import assert from 'node:assert/strict';
import test from 'node:test';

import { loadDeferredCatalogue } from './catalogue.js';
import { runCompatibility } from './harness.js';

const results = runCompatibility();

test('every vendored reference case is classified exactly once', () => {
  assert.equal(results.length, 672);
  assert.equal(new Set(results.map((result) => result.case.example ?? result.case.id)).size, 672);
});

test('all vendored CommonMark/GFM cases execute without classified failures', () => {
  const failed = results.filter((result) => result.status === 'fail');
  assert.deepEqual(
    failed.map((result) => ({ id: result.case.example ?? result.case.id, section: result.case.section, observation: result.observation })),
    [],
  );
});

test('the active gate has no catalogue gaps', () => {
  const gaps = results.filter((result) => result.status === 'gap-uncovered');
  assert.deepEqual(gaps.map((result) => ({ id: result.case.example ?? result.case.id, observation: result.observation })), []);
});

test('nothing is deferred — every vendored case classifies against a catalogue row', () => {
  const catalogue = loadDeferredCatalogue();
  assert.equal(catalogue.sections.size, 0);
  assert.equal(catalogue.constructs.size, 0);
  const deferred = results.filter((result) => result.status === 'deferred-uncovered');
  assert.deepEqual(deferred.map((result) => result.case.example ?? result.case.id), []);
});
