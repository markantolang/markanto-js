import assert from 'node:assert/strict';
import test from 'node:test';

import { runAdopt, runCheck, runFormat } from '../../src/cli.js';

test('check accepts a clean document', () => {
  assert.deepEqual(runCheck('# Title\n'), { output: '', exitCode: 0 });
});

test('format canonicalises while --check reports a would-be change', () => {
  const source = '##  Title\n';
  const formatted = runFormat(source);
  assert.equal(formatted.exitCode, 0);
  assert.equal(formatted.newContent, '## Title\n');
  const checked = runFormat(source, { check: true });
  assert.equal(checked.exitCode, 1);
  assert.match(checked.output, /error\[noncanonical\]/u);
  assert.equal(checked.newContent, undefined);
});

test('invalid input reports a shared line-and-column diagnostic', () => {
  const checked = runCheck('# \n');
  assert.equal(checked.exitCode, 1);
  assert.match(checked.output, /^1:1: error\[syntax\]: empty heading$/u);
  assert.equal(runFormat('# \n').newContent, undefined);
});

test('warning-only input is visible and exits successfully', () => {
  const checked = runCheck('[^unused]: note\n');
  assert.equal(checked.exitCode, 0);
  assert.match(checked.output, /warning\[advisory\]/u);
});

test('adopt fills eligible IDs and --check never returns new content', () => {
  const ids = ['heading-id'];
  const adopted = runAdopt('# Title\n', { createId: () => ids.shift() ?? 'fallback' });
  assert.equal(adopted.exitCode, 0);
  assert.equal(adopted.newContent, '# Title {#heading-id}\n');
  const checked = runAdopt('# Title\n', { check: true, createId: () => 'heading-id' });
  assert.equal(checked.exitCode, 1);
  assert.match(checked.output, /adopt would modify/u);
  assert.equal(checked.newContent, undefined);
});

test('--check and --stdout are rejected before mutation', () => {
  assert.equal(runFormat('# Title\n', { check: true, stdout: true }).exitCode, 1);
  assert.equal(runAdopt('# Title\n', { check: true, stdout: true }).exitCode, 1);
});
