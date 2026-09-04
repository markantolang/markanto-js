/**
 * Minimal semantic-AST builders for unit tests.
 *
 * These construct plain objects matching `src/ast.ts` shapes. They do not
 * validate invariants — a test that needs an invalid AST builds one directly.
 */

import type {
  Document,
  FootnoteDefinition,
  Heading,
  Inline,
  List,
  ListItem,
  Paragraph,
  QuoteBlock,
  QuoteRegion,
  Text,
} from '../../src/ast.js';

export const text = (value: string): Text => ({ type: 'text', value });

export const paragraph = (
  children: Inline[],
  extra: Partial<Omit<Paragraph, 'type' | 'children'>> = {},
): Paragraph => ({
  type: 'paragraph',
  children: children as Paragraph['children'],
  ...extra,
});

export const heading = (
  level: Heading['level'],
  children: Inline[],
  extra: Partial<Omit<Heading, 'type' | 'level' | 'children'>> = {},
): Heading => ({
  type: 'heading',
  level,
  children: children as Heading['children'],
  ...extra,
});

export const doc = (
  children: Document['children'] = [],
  footnotes: FootnoteDefinition[] = [],
): Document => ({ type: 'document', children, footnotes });

export const listItem = (
  children: ListItem['children'],
  extra: Partial<Omit<ListItem, 'type' | 'children'>> = {},
): ListItem => ({ type: 'listItem', children, ...extra });

export const unorderedList = (items: ListItem[]): List => ({
  type: 'list',
  kind: 'unordered',
  items: items as List['items'],
});

export const quoteBlock = (level: number, block: QuoteBlock['block']): QuoteBlock => ({
  level,
  block,
});

export const quoteRegion = (
  children: QuoteBlock[],
  extra: Partial<Omit<QuoteRegion, 'type' | 'children'>> = {},
): QuoteRegion => ({
  type: 'quoteRegion',
  children: children as QuoteRegion['children'],
  ...extra,
});

/**
 * A left-nested unordered list `depth` items deep, each item a paragraph plus
 * (except the innermost) a child list. Used to prove the traversal is not
 * bounded by the host call stack.
 */
export function deeplyNestedList(depth: number): List {
  let inner: List = unorderedList([listItem([paragraph([text(`leaf ${depth}`)])])]);
  for (let level = depth - 1; level >= 1; level -= 1) {
    inner = unorderedList([listItem([paragraph([text(`level ${level}`)]), inner])]);
  }
  return inner;
}
