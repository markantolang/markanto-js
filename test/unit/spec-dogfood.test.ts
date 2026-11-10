import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { format, parse } from '../../src/index.js';

// The normative specifications are themselves written in Markanto. Each must not only
// parse as a valid Markanto document — a spec that violates its own rules
// (a code span whose delimiter is no longer than an inner backtick run, a
// ```-fence example that closes on a nested ``` run, a hard-wrapped
// continuation line that looks like a list marker, …) is a defect — it must be
// written in the *canonical* form: strict-valid and byte-stable under the
// formatter. Keep this green: when a spec edit trips it, run
// `bun scripts/format-spec.ts <spec.md>` in the specification repository (or
// fix the prose), don't relax the check.
for (const version of ['0.1.0', '0.2.0']) {
  const name = `vendor/spec/${version}/spec.md`;
  const source = readFileSync(fileURLToPath(new URL(`../../${name}`, import.meta.url)), 'utf8');

  test(`${name} parses as a valid Markanto document`, () => {
    assert.equal(parse(source).status, 'ok');
  });

  test(`${name} is written in canonical Markanto (strict-valid, byte-stable)`, () => {
    assert.equal(parse(source, { strict: true }).status, 'ok');

    const parsed = parse(source);
    assert.equal(parsed.status, 'ok');
    if (parsed.status !== 'ok') return;
    const formatted = format(parsed.document);
    assert.equal(formatted.status, 'ok');
    if (formatted.status === 'ok') assert.equal(formatted.source, source);
  });
}

// The guide for Markdown writers (`guide.md`) teaches by example: the guide and
// every `markdown` example in it must be canonical Markanto, so that a change of
// the language cannot leave an example behind that no longer holds.
function markdownExamples(source: string): string[] {
  const examples: string[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const opener = lines[i]!;
    const indent = opener.length - opener.trimStart().length;
    const fence = opener.trimStart();
    const ticks = fence.length - fence.replace(/^`+/, '').length;
    if (ticks < 3 || fence.slice(ticks) !== 'markdown') continue;
    const closer = ' '.repeat(indent) + '`'.repeat(ticks);
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && lines[j] !== closer) {
      body.push(lines[j]!.slice(indent));
      j += 1;
    }
    assert.ok(j < lines.length, `the markdown example at line ${i + 1} is not closed`);
    examples.push(body.join('\n') + '\n');
    i = j;
  }
  return examples;
}

for (const version of ['0.2.0']) {
  const name = `vendor/spec/${version}/guide.md`;
  const source = readFileSync(fileURLToPath(new URL(`../../${name}`, import.meta.url)), 'utf8');
  const documents = [{ label: name, text: source }].concat(
    markdownExamples(source).map((text, index) => ({ label: `${name}, example ${index + 1}`, text })),
  );

  test(`${name} has its examples`, () => {
    assert.ok(documents.length > 1);
  });

  for (const { label, text } of documents) {
    test(`${label} is written in canonical Markanto (strict-valid, byte-stable)`, () => {
      assert.equal(parse(text, { strict: true }).status, 'ok');

      const parsed = parse(text);
      assert.equal(parsed.status, 'ok');
      if (parsed.status !== 'ok') return;
      const formatted = format(parsed.document);
      assert.equal(formatted.status, 'ok');
      if (formatted.status === 'ok') assert.equal(formatted.source, text);
    });
  }
}
