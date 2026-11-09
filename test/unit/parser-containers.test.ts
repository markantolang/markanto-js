import assert from 'node:assert/strict';
import test from 'node:test';

import { format, parse } from '../../src/index.js';
import type { Document } from '../../src/ast.js';

function parseOk(source: string): Document {
  const result = parse(source);
  assert.equal(result.status, 'ok', `expected ok for ${JSON.stringify(source)}`);
  if (result.status !== 'ok') throw new Error('unreachable');
  return result.document;
}

function firstCategory(source: string): string | undefined {
  const result = parse(source);
  if (result.status === 'ok') return undefined;
  return result.diagnostics[0]?.category;
}

test('fence run-length matching: a shorter closer leaves the fence unclosed', () => {
  assert.equal(firstCategory(':::: Warning\nContent.\n:::\n'), 'syntax');
  assert.equal(firstCategory(':::: Warning\nContent.\n::::\n'), undefined);
  assert.equal(firstCategory(':::: Warning\nContent.\n:::::\n'), undefined);
});

test('TYPE character rejection is a syntax error', () => {
  assert.equal(firstCategory('A|B\n___\n\nContent.\n___\n'), 'syntax');
  assert.equal(firstCategory('A\\B\n___\n\nContent.\n___\n'), 'syntax');
  assert.equal(firstCategory('A`B\n___\n\nContent.\n___\n'), 'syntax');
  assert.equal(firstCategory('Bad<Type\n___\n\nText.\n___\n'), 'syntax');
  assert.equal(firstCategory('C#\n___\n\nContent.\n___\n'), undefined);
  assert.equal(firstCategory('RFC:9110\n___\n\nContent.\n___\n'), undefined);
});

test('the lined one-line-lookahead guard keeps a heading a heading', () => {
  const doc = parseOk('# Heading\n___\n\nContent.\n___\n');
  assert.equal(doc.children[0]?.type, 'heading');
  assert.equal(doc.children[1]?.type, 'container');
});

test('the lined one-line-lookahead guard keeps quote and list markers out of headers', () => {
  for (const source of [
    '> quote\n___\n\nX.\n___\n',
    '>tight\n___\n\nX.\n___\n',
    '- item\n___\n\nX.\n___\n',
  ]) {
    const doc = parseOk(source);
    assert.notEqual(doc.children[0]?.type, 'container');
  }

  const unrepresentable: Document = {
    type: 'document',
    children: [{
      type: 'container',
      form: 'lined',
      containerType: '-',
      title: null,
      children: [{ type: 'paragraph', children: [{ type: 'text', value: 'X.' }] }],
    }],
    footnotes: [],
  };
  assert.equal(format(unrepresentable).status, 'invalid');
});

test('typed lined containers nested in lined bodies fail without recovery reinterpretation', () => {
  for (const source of [
    'Outer\n___\n\nInner\n___\n\nNested.\n___\n___\n',
    'Exkurs\n___\n\nInner\n___\n\nA.\n___\n___\n',
  ]) {
    const result = parse(source, { errorRecovery: true });
    assert.equal(result.status, 'invalid');
    if (result.status !== 'invalid') throw new Error('unreachable');
    assert.equal(result.diagnostics[0]?.category, 'semantic');
    assert.equal(result.diagnostics[0]?.message, 'forbidden container nesting');
    assert.ok(result.recovery !== undefined);
    if (result.recovery !== undefined) {
      const silentlyReinterpreted = result.recovery.children.some((child) =>
        child.type === 'container' && child.children.some((nested) =>
          nested.type === 'paragraph' && nested.children.some((inline) => inline.type === 'text' && inline.value === 'Inner')
        )
      );
      assert.equal(silentlyReinterpreted, false);
    }
  }
});

test('N anonymous sibling lined containers round-trip (B3 — no false nesting)', () => {
  for (let n = 1; n <= 6; n += 1) {
    const source = Array.from({ length: n }, (_, i) => `___\n\nc${i + 1}\n___\n`).join('\n');
    const result = parse(source);
    const detail = result.status === 'ok' ? 'ok' : (result.diagnostics[0]?.message ?? 'invalid');
    assert.equal(result.status, 'ok', `${n} siblings -> ${detail}`);
    if (result.status !== 'ok') throw new Error('unreachable');
    assert.equal(result.document.children.length, n);
    assert.ok(result.document.children.every((c) => c.type === 'container' && c.form === 'lined'));
    const formatted = format(result.document);
    assert.equal(formatted.status, 'ok');
    if (formatted.status === 'ok') assert.equal(formatted.source, source);
  }
});

test('typed sibling lined containers round-trip (B3)', () => {
  const source = 'Exkurs A\n___\n\nc1\n___\n\nExkurs B\n___\n\nc2\n___\n\nExkurs C\n___\n\nc3\n___\n';
  const result = parse(source);
  const detail = result.status === 'ok' ? 'ok' : (result.diagnostics[0]?.message ?? 'invalid');
  assert.equal(result.status, 'ok', detail);
  if (result.status !== 'ok') throw new Error('unreachable');
  assert.equal(result.document.children.length, 3);
});

test('a typed lined header followed by a fence becomes a lined container', () => {
  const doc = parseOk('Exkurs\n___\n\nContent.\n___\n');
  const container = doc.children[0];
  assert.equal(container?.type, 'container');
  if (container?.type === 'container') {
    assert.equal(container.form, 'lined');
    assert.equal(container.containerType, 'Exkurs');
  }
});

test('grid rectangle validation rejects non-rectangular spans', () => {
  assert.equal(firstCategory('::: X\nA\n--\n<\n==\n^\n--\nB\n:::\n'), 'semantic');
  assert.equal(firstCategory('::: X\nA\n--\nB\n==\nC\n:::\n'), 'semantic');
});

test('a {#id} in an identity-forbidden scope is a parser semantic error (B2)', () => {
  for (const source of [
    '::: V\na\n{#inside}\n--\nb\n:::\n',     // standalone line in a grid cell
    '::: V\n# H {#inside}\n--\nb\n:::\n',    // same-line heading id in a grid cell
    '> # H {#inside}\n',                      // same-line heading id in a quote
    '- item\n\n  # H {#inside}\n',            // same-line heading id in a list item
  ]) {
    const result = parse(source);
    assert.equal(result.status, 'invalid', source);
    if (result.status === 'invalid') {
      assert.equal(result.diagnostics[0]?.category, 'semantic', source);
    }
  }
});

test('grid continuation markers are invalid in the first row/column', () => {
  assert.equal(firstCategory('::: X\n^\n--\nB\n:::\n'), 'semantic');
  assert.equal(firstCategory('::: X\n<\n--\nB\n:::\n'), 'semantic');
});

test('grid separators expose empty cells to semantic validation', () => {
  for (const source of [
    '::: V\nA\n--\n--\nB\n:::\n',
    '::: V\n--\nA\n--\nB\n:::\n',
  ]) {
    const result = parse(source);
    assert.equal(result.status, 'invalid');
    if (result.status !== 'invalid') throw new Error('unreachable');
    assert.equal(result.diagnostics[0]?.category, 'semantic');
    assert.equal(result.diagnostics[0]?.message, 'empty grid cell');
  }
});

test('a deferred grid trigger re-commits pre-trigger continuation markers', () => {
  assert.equal(firstCategory('::: X\n^\n--\nB\n:::\n'), 'semantic');
  assert.equal(firstCategory('::: X\n<\n==\nB\n:::\n'), 'semantic');
});

test('the deferred scan ignores markers inside a code fence', () => {
  const doc = parseOk('::: Beispiel\n```text\n::\n--\n==\n```\n:::\n');
  const container = doc.children[0];
  assert.equal(container?.type, 'container');
  if (container?.type === 'container' && container.children[0]?.type === 'codeBlock') {
    assert.equal(container.children[0].value, '::\n--\n==');
  }
});

test('grid canonical output round-trips through strict mode', () => {
  const source = '::: Vergleich\nAlpha\n--\nBeta\n==\nGamma\n--\nDelta\n:::\n';
  const result = parse(source, { strict: true });
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') {
    const formatted = format(result.document);
    assert.equal(formatted.status === 'ok' && formatted.source, source);
  }
});

// hadley, 2026-11-09: `:::tldr` (no space) is refused, its closing `:::` opens an anonymous fenced container, and a
// nested opener inside fails it. The lines between the opener and the failing line were consumed and missing from the
// recovery entirely: recovery may not lose what it consumed (spec 7.5, AGENTS.md).
test('a fenced container that fails in its body keeps every consumed line in the recovery', () => {
  for (const source of [
    ':::tldr\nPara one.\n:::\n\nMid paragraph.\n\n## Heading\n\nLater.\n\n:::loud\nLoud.\n:::\n\nEnd.\n',
    ':::\n\nMid paragraph.\n\n## Heading\n\nLater.\n\n::: loud\nLoud.\n:::\n:::\n\nEnd.\n',
  ]) {
    const result = parse(source, { errorRecovery: true });
    assert.equal(result.status, 'invalid');
    if (result.status !== 'invalid' || result.recovery === undefined) throw new Error('expected a recovery');
    const kept = JSON.stringify(result.recovery);
    for (const words of ['Mid paragraph.', 'Heading', 'Later.', 'Loud.', 'End.'])
      assert.ok(kept.includes(words), `${JSON.stringify(words)} is missing from the recovery of ${JSON.stringify(source)}`);
  }
});

test('a lined container that fails in its body keeps every consumed line in the recovery', () => {
  const result = parse('Outer\n___\n\nKept before.\n\nInner\n___\n\nNested.\n___\n___\n', { errorRecovery: true });
  assert.equal(result.status, 'invalid');
  if (result.status !== 'invalid' || result.recovery === undefined) throw new Error('expected a recovery');
  assert.ok(JSON.stringify(result.recovery).includes('Kept before.'));
});

test('a fence with its name and no space is refused, and says so', () => {
  for (const source of [':::tldr\nShort.\n:::\n', '::::Note\nText.\n::::\n']) {
    const result = parse(source);
    assert.equal(result.status, 'invalid');
    assert.equal(result.diagnostics[0]?.message, "a fenced container's name follows its fence after a space");
    assert.equal(result.diagnostics[0]?.category, 'syntax');
  }
  // with the space, it is a container; a definition list keeps its own message
  assert.equal(parse('::: tldr\nShort.\n:::\n').status, 'ok');
  assert.equal(parse(':x\n').status, 'invalid');
  assert.equal(parse(':x\n').diagnostics[0]?.message, 'list marker requires exactly one space');
});

// review 2026-11-09 (Astra): a quote that fails at a deeper level kept only that level; a container's error moved its
// diagnostic to the opener; the fence message fired on an indented fence with its space
test('a quote that fails at one level keeps the whole region in the recovery, in a container too', () => {
  for (const source of ['> #\n>> LOST\n\nAfter.\n', '::: box\nKept.\n\n> #\n>> LOST\n:::\n\nAfter.\n']) {
    const result = parse(source, { errorRecovery: true });
    if (result.status !== 'invalid' || result.recovery === undefined) throw new Error('expected a recovery');
    const kept = JSON.stringify(result.recovery);
    for (const words of ['LOST', 'After.']) assert.ok(kept.includes(words), `${words} is missing for ${JSON.stringify(source)}`);
  }
});

test("a container's error keeps its diagnostic where the error is, its recovery from the opener", () => {
  const result = parse('::: box\nKept.\n\n#\n:::\n', { errorRecovery: true });
  if (result.status !== 'invalid' || result.recovery === undefined) throw new Error('expected a recovery');
  assert.equal(result.diagnostics[0]?.message, 'empty heading');
  assert.equal(result.diagnostics[0]?.range?.start.line, 4);
  const first = result.recovery.children[0];
  assert.equal(first?.type, 'errorBlock');
  if (first?.type === 'errorBlock') assert.ok(first.rawContent.startsWith('::: box\nKept.'));
});

test('the fence message is only for a fence on its baseline with its name and no space', () => {
  for (const source of [' ::: tldr\n', ' :::\n', '  :::: Note\n']) {
    const result = parse(source);
    assert.equal(result.status, 'invalid', source);
    assert.notEqual(result.diagnostics[0]?.message, "a fenced container's name follows its fence after a space", source);
  }
});

// second review 2026-11-09 (Astra): an endless loop, and three more places where recovery lost or doubled text
test('recovery ends on an invalid container name, and keeps every line once', () => {
  const cases: [string, string[]][] = [
    ['::: A|B\nText.\n:::\n\nAfter.\n', ['Text.', 'After.']],
    ['A|B\n___\n\nContent.\n___\n\nAfter.\n', ['Content.', 'After.']],
    ['| [x]( |\n| --- |\n\nAfter.\n', ['| --- |', 'After.']],
    ['[^a]: FIRST\n\n[^a]: LOST\n\nAfter.\n', ['FIRST', 'LOST', 'After.']],
    ['::: box\n#\n:::\n\nAfter.\n', ['After.']],
  ];
  for (const [source, words] of cases) {
    const result = parse(source, { errorRecovery: true });
    assert.equal(result.status, 'invalid', source);
    if (result.status !== 'invalid' || result.recovery === undefined) throw new Error('expected a recovery');
    const kept = JSON.stringify(result.recovery);
    for (const word of words) {
      const count = kept.split(word).length - 1;
      assert.ok(count >= 1, `${word} is missing for ${JSON.stringify(source)}`);
    }
    // the case of the doubled paragraph: once
    if (source.startsWith('::: box')) assert.equal(kept.split('After.').length - 1, 1, kept);
  }
});
