import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { format, parse, semanticDocumentEquals } from '../../src/index.js';

interface FixtureCase {
  readonly id: string;
  readonly source: string;
  readonly semanticAst?: unknown;
  readonly expect: {
    readonly normal: Expectation;
    readonly strict: Expectation;
  };
}
interface Expectation {
  readonly valid: boolean;
  readonly canonical?: string;
  readonly diagnostics?: readonly { readonly category: string }[];
}

const allowlist = new Set(`
block.heading.h1 block.heading.h6 block.heading.setext-rejected
block.heading.leading-spaces-normalizes block.heading.closing-hashes-normalize block.heading.empty-invalid
block.heading.setext-standalone-is-text
block.hr.canonical block.hr.stars-normalizes block.hr.long-normalizes block.hr.mixed-invalid
block.hr.spaced-dashes-normalizes block.hr.trailing-space-normalizes
block.code.backticks block.code.tilde-normalizes block.code.overlong-normalizes block.code.shortest-safe-four
block.code.unclosed-invalid block.code.leading-spaces-normalizes block.code.extra-info-invalid
block.code.final-blank-line-preserved
block.comment.single-line block.comment.multiline block.comment.unclosed block.comment.trailing-visible-invalid
block.comment.empty block.comment.inner-whitespace-preserved block.comment.leading-spaces-normalizes
block.boundary.heading-without-blank block.boundary.multiple-blanks-normalize
block.id.heading block.id.paragraph block.id.after-blank-invalid block.id.long-form-removed block.id.hr block.id.code
block.id.container block.id.duplicate-invalid
block.terminal.empty-document-canonical block.terminal.trailing-blank-lines-normalize
block.boundary.heading-escaped-then-real block.priority.block-id-after-list block.boundary.two-lines-same-paragraph
block.code.mixed-fence-characters-literal block.code.backtick-in-info-is-inline-code block.code.backtick-fence-info-token block.code.backtick-in-info-does-not-interrupt-paragraph block.heading.escaped-hash-literal block.hr.escaped-dash-literal
block.priority.comment-vs-fence block.priority.quote-vs-heading block.priority.setext-after-code-literal
block.boundary.code-after-paragraph-no-blank block.boundary.comment-after-paragraph-no-blank
block.boundary.comment-between-paragraphs block.boundary.heading-after-paragraph-no-blank
block.boundary.hr-after-paragraph-no-blank block.priority.heading-vs-hr block.priority.hr-vs-list-item
block.heading.id-extra-content-invalid block.boundary.setext-after-paragraph-diagnostic
block.code.escaped-backtick-literal block.comment.content-close-sequence-cannot-escape
math.block math.block.tilde-normalizes math.block.unclosed-invalid math.block.duplicate-id-invalid math.dollar-literal math.shell-dollar-literal
`.trim().split(/\s+/u));

const fixtures = [
  load('../fixtures/blocks/cases.json'),
  load('../fixtures/math/cases.json'),
].flat().filter((fixture) => allowlist.has(fixture.id));

assert.equal(fixtures.length, allowlist.size, 'every allowlisted fixture exists');

for (const fixture of fixtures) {
  test(`Phase 1 conformance: ${fixture.id}`, () => {
    checkMode(fixture, false);
    checkMode(fixture, true);
  });
}

function checkMode(fixture: FixtureCase, strict: boolean): void {
  const expected = strict ? fixture.expect.strict : fixture.expect.normal;
  const result = parse(fixture.source, strict ? { strict: true } : {});
  assert.equal(result.status === 'ok', expected.valid, `${strict ? 'strict' : 'normal'} validity`);
  if (result.status === 'ok') {
    if (expected.canonical !== undefined) {
      const formatted = format(result.document);
      assert.equal(formatted.status, 'ok');
      if (formatted.status === 'ok') assert.equal(formatted.source, expected.canonical);
    }
    if (!strict && fixture.semanticAst !== undefined) {
      const equality = semanticDocumentEquals(result.document, fixture.semanticAst as never);
      assert.deepEqual(equality, { status: 'ok', equal: true });
    }
  } else if (expected.diagnostics !== undefined) {
    assert.equal(result.diagnostics[0]?.category, expected.diagnostics[0]?.category);
  }
}

function load(relative: string): FixtureCase[] {
  const url = new URL(relative, import.meta.url);
  return (JSON.parse(readFileSync(url, 'utf8')) as { readonly cases: FixtureCase[] }).cases;
}
