import test from 'node:test';
import assert from 'node:assert/strict';

import { diagnostic, DiagnosticSink } from '../../src/diagnostics.js';

test('diagnostic() omits absent optional fields', () => {
  assert.deepEqual(diagnostic('syntax', 'error'), { category: 'syntax', severity: 'error' });
  assert.deepEqual(
    diagnostic('advisory', 'warning', { code: 'M-ADV-001', message: 'unresolved anchor' }),
    { category: 'advisory', severity: 'warning', code: 'M-ADV-001', message: 'unresolved anchor' },
  );
});

test('sink preserves report order', () => {
  const sink = new DiagnosticSink();
  sink.syntaxError({ message: 'first' });
  sink.advisory({ message: 'second' });
  sink.semanticError({ message: 'third' });
  assert.deepEqual(
    sink.list.map((d) => d.message),
    ['first', 'second', 'third'],
  );
});

test('category and severity are independent dimensions', () => {
  const sink = new DiagnosticSink();
  sink.resource({ message: 'budget exhausted' });
  const [d] = sink.list;
  assert.equal(d!.category, 'resource');
  assert.equal(d!.severity, 'error');
  assert.equal(sink.has('resource'), true);
  assert.equal(sink.has('syntax'), false);
});

test('hasErrors ignores warnings', () => {
  const sink = new DiagnosticSink();
  sink.advisory({ message: 'w' });
  assert.equal(sink.hasErrors(), false);
  sink.noncanonical({ message: 'e' });
  assert.equal(sink.hasErrors(), true);
});

test('drain returns a frozen copy detached from later pushes', () => {
  const sink = new DiagnosticSink();
  sink.syntaxError();
  const drained = sink.drain();
  assert.equal(Object.isFrozen(drained), true);
  sink.syntaxError();
  assert.equal(drained.length, 1);
  assert.equal(sink.length, 2);
});
