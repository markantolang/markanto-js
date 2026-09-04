import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

import { parse } from '../../src/parser/parse.js';
import { catalogueRowsFor, constructsFor, loadCatalogue, loadDeferredCatalogue, type CatalogueRow, type HarnessCode } from './catalogue.js';

export type CompatStatus = HarnessCode | 'fail' | 'gap-uncovered' | 'deferred-uncovered';

export interface ReferenceCase {
  readonly markdown: string;
  readonly html: string;
  readonly section: string;
  readonly example?: number;
  readonly id?: string;
}

export interface SkeletonNode {
  readonly kind: string;
  readonly children?: readonly SkeletonNode[];
}

export interface CompatResult {
  readonly case: ReferenceCase;
  readonly status: CompatStatus;
  readonly expected: readonly HarnessCode[];
  readonly markanto: readonly SkeletonNode[];
  readonly reference: readonly SkeletonNode[];
  readonly observation: string;
  readonly catalogueConstructs: readonly string[];
}

export function referenceTree(markdown: string): unknown {
  return fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

export function classifyCase(item: ReferenceCase, catalogue = loadCatalogue()): CompatResult {
  const referenceRoot = referenceTree(item.markdown) as MdNode;
  const referenceKinds = collectKinds(referenceRoot);
  const rows = catalogueRowsFor(catalogue, item.section, item.markdown, referenceKinds);
  const routedConstructs = constructsFor(item.section, item.markdown, referenceKinds);
  const deferred = loadDeferredCatalogue();
  const expected = [...new Set(rows.flatMap((row) => [...row.codes]))];
  const reference = referenceSkeleton(referenceRoot);
  const normal = parse(item.markdown, {});
  const recovery = parse(item.markdown, { errorRecovery: true });
  const markanto = normal.status === 'ok'
    ? markantoSkeleton(normal.document as unknown as MarkantoNode)
    : recovery.status === 'invalid' && recovery.recovery !== undefined
      ? markantoSkeleton(recovery.recovery as unknown as MarkantoNode)
      : [];

  if (rows.length === 0) {
    return result('gap-uncovered', `no catalogue mapping for reference section ${item.section}`);
  }
  if (normal.status === 'resource' || recovery.status === 'resource') {
    return result('fail', 'reference-sized input exhausted the parser resource budget');
  }

  let observed: HarnessCode;
  if (referenceKinds.has('html') && expected.includes('n/a')) {
    observed = 'n/a';
  } else if (normal.status === 'invalid') {
    observed = 'reject';
  } else if (sameSkeleton(markanto, reference)) {
    observed = 'same';
  } else if (expected.includes('import-only') && isLiteralFallback(markanto, reference)) {
    observed = 'import-only';
  } else {
    observed = 'structural';
  }

  if (deferred.sections.has(item.section) || routedConstructs.some((construct) => deferred.constructs.has(construct))) {
    return result('deferred-uncovered', `deferred construct; observed ${observed}: ${describe(normal.status, markanto, reference)}`);
  }

  if (expected.includes(observed)) {
    return result(observed, describe(normal.status, markanto, reference));
  }
  return result('gap-uncovered', `catalogue allows ${expected.join('/')} but observed ${observed}: ${describe(normal.status, markanto, reference)}`);

  function result(status: CompatStatus, observation: string): CompatResult {
    return {
      case: item, status, expected, markanto, reference, observation,
      catalogueConstructs: rows.map((row: CatalogueRow) => row.construct),
    };
  }
}

export function runCompatibility(): readonly CompatResult[] {
  const commonmark = loadCases(resolve('spec/commonmark-0.31.2.json'));
  const gfmCases = loadCases(resolve('spec/gfm-0.29-extra.json'));
  const catalogue = loadCatalogue();
  return [...commonmark, ...gfmCases].map((item) => classifyCase(item, catalogue));
}

function loadCases(path: string): ReferenceCase[] {
  return JSON.parse(readFileSync(path, 'utf8')) as ReferenceCase[];
}

interface MdNode { readonly type: string; readonly value?: string; readonly depth?: number; readonly ordered?: boolean; readonly children?: readonly MdNode[] }
interface MarkantoNode { readonly type: string; readonly level?: number; readonly kind?: string; readonly form?: string; readonly block?: MarkantoNode; readonly children?: readonly MarkantoNode[]; readonly items?: readonly MarkantoNode[]; readonly head?: MarkantoNode; readonly body?: readonly MarkantoNode[]; readonly cells?: readonly MarkantoNode[] }

function referenceSkeleton(root: MdNode): SkeletonNode[] {
  return (root.children ?? []).flatMap(referenceNode);
}

function referenceNode(node: MdNode): SkeletonNode[] {
  switch (node.type) {
    case 'paragraph': return [{ kind: 'paragraph' }];
    case 'heading': return [{ kind: `heading(${node.depth ?? '?'})` }];
    case 'code': return [{ kind: 'codeBlock' }];
    case 'thematicBreak': return [{ kind: 'horizontalRule' }];
    case 'blockquote': return [{ kind: 'quoteRegion', children: (node.children ?? []).flatMap(referenceNode) }];
    case 'list': return [{ kind: `list(${node.ordered === true ? 'ordered' : 'unordered'})`, children: (node.children ?? []).flatMap(referenceNode) }];
    case 'listItem': return [{ kind: 'listItem', children: (node.children ?? []).flatMap(referenceNode) }];
    case 'table': return [{ kind: 'table', children: (node.children ?? []).flatMap(referenceNode) }];
    case 'tableRow': return [{ kind: 'tableRow', children: (node.children ?? []).flatMap(referenceNode) }];
    case 'tableCell': return [{ kind: 'tableCell' }];
    case 'html': return [{ kind: node.value?.trimStart().startsWith('<!--') === true ? 'commentBlock' : 'rawHtml' }];
    case 'definition': return [];
    default: return [];
  }
}

function markantoSkeleton(root: MarkantoNode): SkeletonNode[] {
  const nodes = root.children ?? [];
  return nodes.flatMap(markantoNode);
}

function markantoNode(node: MarkantoNode): SkeletonNode[] {
  switch (node.type) {
    case 'paragraph': case 'codeBlock': case 'mathBlock': case 'horizontalRule': case 'commentBlock': case 'errorBlock':
      return [{ kind: node.type }];
    case 'heading': return [{ kind: `heading(${node.level ?? '?'})` }];
    case 'quoteRegion': return [{ kind: 'quoteRegion', children: (node.children ?? []).flatMap((child) => child.block === undefined ? [] : markantoNode(child.block)) }];
    case 'list': return [{ kind: `list(${node.kind ?? '?'})`, children: (node.items ?? []).flatMap(markantoNode) }];
    case 'listItem': return [{ kind: 'listItem', children: (node.children ?? []).flatMap(markantoNode) }];
    case 'table': return [{ kind: 'table', children: [...(node.head === undefined ? [] : markantoNode(node.head)), ...(node.body ?? []).flatMap(markantoNode)] }];
    case 'tableRow': return [{ kind: 'tableRow', children: (node.cells ?? []).flatMap(markantoNode) }];
    case 'tableCell': return [{ kind: 'tableCell' }];
    case 'container': return [{ kind: `container(${node.form ?? '?'})`, children: (node.children ?? []).flatMap(markantoNode) }];
    default: return [{ kind: node.type }];
  }
}

function collectKinds(root: MdNode): ReadonlySet<string> {
  const kinds = new Set<string>();
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    kinds.add(node.type);
    for (const child of node.children ?? []) stack.push(child);
  }
  return kinds;
}

function sameSkeleton(left: readonly SkeletonNode[], right: readonly SkeletonNode[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isLiteralFallback(markanto: readonly SkeletonNode[], reference: readonly SkeletonNode[]): boolean {
  return markanto.length > 0 && markanto.every((node) => node.kind === 'paragraph') && !sameSkeleton(markanto, reference);
}

function describe(status: string, markanto: readonly SkeletonNode[], reference: readonly SkeletonNode[]): string {
  return `Markanto ${status} ${compact(markanto)}; reference ${compact(reference)}`;
}

function compact(nodes: readonly SkeletonNode[]): string {
  return JSON.stringify(nodes).replaceAll('"kind":', '');
}
