import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type HarnessCode = 'same' | 'reject' | 'structural' | 'import-only' | 'n/a';

export interface CatalogueRow {
  readonly construct: string;
  readonly markanto: string;
  readonly spec: string;
  readonly harness: string;
  readonly codes: ReadonlySet<HarnessCode>;
}

export interface DeferredCatalogue {
  readonly sections: ReadonlySet<string>;
  readonly constructs: ReadonlySet<string>;
}

const LEGAL_CODES = new Set<HarnessCode>(['same', 'reject', 'structural', 'import-only', 'n/a']);

export function loadCatalogue(path = resolve('docs/COMMONMARK_DIVERGENCE.md')): readonly CatalogueRow[] {
  const source = readFileSync(path, 'utf8');
  const rows: CatalogueRow[] = [];
  for (const line of source.split('\n')) {
    if (!line.startsWith('|') || /^\|[-|]+\|$/u.test(line.replaceAll(' ', ''))) continue;
    const cells = splitTableRow(line);
    if (cells.length !== 4 || cells[0] === 'Construct') continue;
    const matches = cells[3]!.match(/import-only|structural|reject|same|n\/a/gu) ?? [];
    const codes = new Set(matches as HarnessCode[]);
    if (codes.size === 0) throw new Error(`illegal or missing Harness code for catalogue row: ${cells[0]}`);
    for (const code of codes) {
      if (!LEGAL_CODES.has(code)) throw new Error(`illegal Harness code ${code} for catalogue row: ${cells[0]}`);
    }
    rows.push({ construct: cells[0]!, markanto: cells[1]!, spec: cells[2]!, harness: cells[3]!, codes });
  }
  if (rows.length === 0) throw new Error('no catalogue rows found');
  return rows;
}

export function loadDeferredCatalogue(path = resolve('docs/COMMONMARK_DIVERGENCE.md')): DeferredCatalogue {
  const source = readFileSync(path, 'utf8');
  const paragraph = source.match(/- \*\*Deferred sections\.\*\*([\s\S]*?)(?:\n\n|$)/u)?.[1];
  if (paragraph === undefined) throw new Error('catalogue has no Deferred sections rule');
  // Nothing is deferred any more: every vendored case classifies against a
  // catalogue row (spec §1.2). The bullet must say so; a future re-gate would
  // reintroduce a machine-readable list here.
  if (!/nothing is deferred/iu.test(paragraph)) {
    throw new Error('Deferred sections bullet no longer states that nothing is deferred');
  }
  return { sections: new Set<string>(), constructs: new Set<string>() };
}

export function catalogueRowsFor(
  rows: readonly CatalogueRow[], section: string, markdown: string, referenceKinds: ReadonlySet<string>,
): readonly CatalogueRow[] {
  const constructs = constructsFor(section, markdown, referenceKinds);
  return constructs.flatMap((construct) => rows.filter((row) => row.construct === construct));
}

export function constructsFor(section: string, markdown: string, referenceKinds: ReadonlySet<string>): readonly string[] {
  const outer = outerConstructs(section, markdown, referenceKinds);
  if (outer.length > 0) return outer;
  switch (section) {
    case 'Tabs': return ['Tabs'];
    case 'Backslash escapes': return ['Backslash escapes'];
    case 'Precedence': return ['Block/inline precedence'];
    case 'Thematic breaks':
      if (referenceKinds.has('heading')) return ['Thematic break context collisions', 'Setext headings'];
      return hasUnderscoreBreakCandidate(markdown) ? ['Thematic break `_` form'] : ['Thematic break `-`/`*`'];
    case 'ATX headings': return ['ATX headings'];
    case 'Setext headings': return ['Setext headings'];
    case 'Indented code blocks': return ['Indented code blocks'];
    case 'Fenced code blocks': return ['Fenced code blocks', ...(referenceKinds.has('heading') ? ['Setext headings'] : [])];
    case 'HTML blocks':
      return markdown.trimStart().startsWith('<!--') ? ['HTML comments'] : ['HTML blocks / raw inline HTML'];
    case 'Block quotes': return ['Block quotes', 'Block quote starting at depth > 1'];
    case 'List items':
    case 'Lists': return ['Lists', 'List marker leading spaces'];
    case 'Link reference definitions': return [
      'Link reference definitions', 'Reference-style links/images + `[label]: url` definitions',
      ...(hasSetextCandidate(markdown) ? ['Setext headings'] : []),
      ...(markdown.includes('](') ? ['Direct link/image — Markanto context restrictions'] : []),
    ];
    case 'Paragraphs':
    case 'Blank lines': return ['Paragraphs and blank separation'];
    case 'Inlines': return ['Inline code, variable backticks', 'Unclosed paired delimiter'];
    case 'Code spans': return ['Inline code, variable backticks'];
    case 'Emphasis and strong emphasis': return ['Emphasis / strong', 'Same-kind direct nesting (`**a**b**c**`)'];
    case 'Links':
    case 'Images':
      return referenceKinds.has('definition') || referenceKinds.has('linkReference') || referenceKinds.has('imageReference')
        ? ['Link reference definitions', 'Reference-style links/images + `[label]: url` definitions']
        : ['Inline links/images (direct)', 'Direct link/image — Markanto context restrictions', 'Unclosed paired delimiter'];
    case 'Autolinks': return ['Autolinks'];
    case 'Raw HTML': return referenceKinds.has('html')
      ? ['HTML blocks / raw inline HTML']
      : ['Plain textual content', 'Unclosed paired delimiter'];
    case 'Hard line breaks': return ['Hard/soft breaks', 'Multiline CommonMark inline constructs'];
    case 'Soft line breaks': return ['Hard/soft breaks'];
    case 'Entity and numeric character references': return [
      'Entity & numeric character references',
      ...(markdown.includes('](') ? ['Direct link/image — Markanto context restrictions'] : []),
    ];
    case 'Textual content': return ['Plain textual content'];
    case 'Tables (extension)': return ['Pipe tables'];
    case 'Strikethrough (extension)': return ['Strikethrough `~~x~~`'];
    case 'Task list items (extension)': return ['GFM task-list markers', 'Task lists'];
    case 'Autolinks (extension)': return ['Autolink extension (bare URLs)'];
    default: return [];
  }
}

function outerConstructs(section: string, markdown: string, referenceKinds: ReadonlySet<string>): readonly string[] {
  if (section === 'HTML blocks' || section === 'Raw HTML') return [];
  if (referenceKinds.has('html')) return ['HTML blocks / raw inline HTML'];
  if (section !== 'Link reference definitions' &&
      (referenceKinds.has('definition') || referenceKinds.has('linkReference') || referenceKinds.has('imageReference'))) {
    return [
      'Link reference definitions', 'Reference-style links/images + `[label]: url` definitions',
      ...(hasSetextCandidate(markdown) ? ['Setext headings'] : []),
      ...(markdown.includes('](') ? ['Direct link/image — Markanto context restrictions'] : []),
    ];
  }
  if (section !== 'Fenced code blocks' && referenceKinds.has('code') && isIndentedCarrier(markdown)) {
    return ['Indented code blocks'];
  }
  if (referenceKinds.has('table')) return ['Pipe tables'];
  if (referenceKinds.has('blockquote')) return ['Block quotes'];
  if (referenceKinds.has('list')) return ['Lists', 'List marker leading spaces'];
  return [];
}

function hasUnderscoreBreakCandidate(markdown: string): boolean {
  for (const line of markdown.split('\n')) {
    let markers = 0;
    let valid = true;
    for (const character of line.trim()) {
      if (character === '_') markers += 1;
      else if (character !== ' ' && character !== '\t') { valid = false; break; }
    }
    if (valid && markers >= 3) return true;
  }
  return false;
}

function hasSetextCandidate(markdown: string): boolean {
  const lines = markdown.split('\n');
  for (let index = 1; index < lines.length; index += 1) {
    const underline = lines[index]!.trim();
    if (underline.length < 1 || !allSame(underline, '=') && !allSame(underline, '-')) continue;
    if (lines[index - 1]!.trim().length > 0) return true;
  }
  return false;
}

function allSame(value: string, expected: string): boolean {
  for (const character of value) if (character !== expected) return false;
  return true;
}

function isIndentedCarrier(markdown: string): boolean {
  for (const line of markdown.split('\n')) {
    if (line.startsWith('    ') || line.startsWith('\t')) return true;
  }
  return false;
}

function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let escaped = false;
  for (let index = 1; index < line.length - 1; index += 1) {
    const character = line[index]!;
    if (character === '|' && !escaped) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
    escaped = character === '\\' && !escaped;
    if (character !== '\\') escaped = false;
  }
  cells.push(cell.trim());
  return cells;
}
