import assert from 'node:assert/strict';

import unicodeClasses from '../data/unicode-classes-v0.1.0.json' with { type: 'json' };

/**
 * Markanto's normative word class (`L* ∪ Nd ∪ _`), matching
 * `src/parser/inline/unicode.ts#characterClass`'s `'W'` result. `\p{N}` (adds
 * Nl/No) and a UTF-16 `slice(-1)` both diverge from it, so use the same range
 * table and a codepoint-safe read.
 */
function isWordCodePoint(code) {
  if (code < 0) return false;
  if (code < 0x80) {
    return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) || code === 0x5f;
  }
  const ranges = unicodeClasses.word;
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (code < ranges[mid][0]) high = mid - 1;
    else if (code > ranges[mid][1]) low = mid + 1;
    else return true;
  }
  return false;
}

const lastCodePoint = (value) => {
  if (value.length === 0) return -1;
  const last = value.charCodeAt(value.length - 1);
  if (last >= 0xdc00 && last <= 0xdfff && value.length >= 2) {
    const prev = value.charCodeAt(value.length - 2);
    if (prev >= 0xd800 && prev <= 0xdbff) return (prev - 0xd800) * 0x400 + (last - 0xdc00) + 0x10000;
  }
  return last;
};

const inlineWrapperTypes = new Set(['em', 'strong', 'deletion', 'obsolete', 'insert', 'mark']);
const mediaBlockTypes = new Set(['videoBlock', 'audioBlock', 'embedBlock']);
const blockTypes = new Set([
  'heading', 'paragraph', 'horizontalRule', 'codeBlock', 'mathBlock', 'commentBlock',
  'imageBlock', 'videoBlock', 'audioBlock', 'embedBlock', 'downloadBlock',
  'quoteRegion', 'container', 'list', 'table',
]);

export const DEFAULT_SEMANTIC_AST_RESOURCE_BUDGET = Object.freeze({
  maxNodes: 250_000,
  maxFrames: 100_000,
  maxMatrixSlots: 1_000_000,
});

export class ResourceLimitError extends Error {
  constructor(message, code = 'M-RESOURCE-AST') {
    super(message);
    this.name = 'ResourceLimitError';
    this.category = 'resource';
    this.code = code;
  }
}

function object(value, label) {
  assert.equal(typeof value, 'object', `${label} must be an object`);
  assert.notEqual(value, null, `${label} must not be null`);
  assert.equal(Array.isArray(value), false, `${label} must not be an array`);
}

function string(value, label, { nonEmpty = false } = {}) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  if (nonEmpty) assert.notEqual(value.length, 0, `${label} must be non-empty`);
  assert.equal(/[\uD800-\uDFFF]/u.test(value), false, `${label} must contain Unicode scalar values only`);
}

function optionalString(value, label, options) {
  if (value !== undefined) string(value, label, options);
}

function destination(value, label) {
  string(value, label);
  assert.equal(/[\r\n]/u.test(value), false, `${label} must not contain a line break`);
}

function nonEmptyArray(value, label) {
  assert.equal(Array.isArray(value), true, `${label} must be an array`);
  assert.ok(value.length > 0, `${label} must be non-empty`);
}

function noSourceLocation(node, label) {
  assert.equal(Object.prototype.hasOwnProperty.call(node, 'range'), false, `${label}.range is tooling metadata, not semantic AST`);
}

function validateId(id, label) {
  if (id === undefined) return;
  string(id, label, { nonEmpty: true });
  assert.match(id, /^[A-Za-z0-9_-]+$/, `${label} invalid`);
}

function validateDataAttrs(value, label) {
  if (value === undefined) return;
  object(value, label);
  assert.ok(Object.keys(value).length > 0, `${label} must be non-empty when present`);
  for (const [key, val] of Object.entries(value)) {
    assert.match(key, /^[a-z][a-z0-9_-]*$/, `${label}.${key}: invalid data-* key`);
    string(val, `${label}.${key}`);
  }
}

function validateAttrs(attrs, label, kind) {
  if (attrs === undefined) return;
  object(attrs, label);
  const allowed = {
    image: new Set(['group', 'lang', 'dataAttrs']),
    media: new Set(['group', 'lang', 'preview', 'dataAttrs']),
    download: new Set(['lang', 'dataAttrs']),
    metadata: new Set(['lang', 'dataAttrs']),
  }[kind];
  for (const key of Object.keys(attrs)) {
    assert.ok(allowed.has(key), `${label}.${key}: attribute not valid in ${kind} context`);
  }
  validateDataAttrs(attrs.dataAttrs, `${label}.dataAttrs`);
  const actualCount = (attrs.group !== undefined ? 1 : 0) +
    (attrs.lang !== undefined ? 1 : 0) +
    (attrs.preview !== undefined ? 1 : 0) +
    (attrs.dataAttrs !== undefined ? Object.keys(attrs.dataAttrs).length : 0);
  assert.ok(actualCount > 0, `${label} must contain at least one actual attribute when present`);
  if (attrs.group !== undefined) {
    string(attrs.group, `${label}.group`, { nonEmpty: true });
    assert.equal(attrs.group.normalize('NFC'), attrs.group, `${label}.group must be NFC-normalized`);
  }
  if (attrs.lang !== undefined) {
    string(attrs.lang, `${label}.lang`, { nonEmpty: true });
    assert.equal(attrs.lang, attrs.lang.toLowerCase(), `${label}.lang must be lowercase canonical`);
  }
  optionalString(attrs.preview, `${label}.preview`);
}

function validateContainerType(value, label) {
  if (value === null) return;
  string(value, label, { nonEmpty: true });
  assert.equal(value.normalize('NFC'), value, `${label} must be NFC-normalized`);
  assert.equal(/[\s\p{Cc}<>\[\]{}|\\`]/u.test(value), false, `${label} contains a forbidden character`);
}

function validateLinedHeaderRepresentability(node, label) {
  if (node.form !== 'lined' || node.containerType === null) return;
  const header = node.title === null
    ? node.containerType
    : `${node.containerType} ${node.title}`;
  const startsCompetingBlock = /^(?:#{1,6}(?: |$)|>|[-+*] |\d{1,9}[.)] |: |`{3,}|~{3,}|:{3,})/u.test(header) ||
    /^(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/u.test(header);
  assert.equal(startsCompetingBlock, false,
    `${label}: canonical lined header begins with a competing block introducer`);
}

function createState(options = {}) {
  const budget = {
    ...DEFAULT_SEMANTIC_AST_RESOURCE_BUDGET,
    ...(options.resourceBudget ?? options),
  };
  for (const key of ['maxNodes', 'maxFrames', 'maxMatrixSlots']) {
    assert.ok(Number.isSafeInteger(budget[key]) && budget[key] >= 1, `${key} must be a positive safe integer`);
  }
  return {
    budget,
    nodes: 0,
    ids: new Set(),
    refs: new Set(),
    defs: new Set(),
    work: [],
  };
}

function consumeNode(state, label) {
  state.nodes += 1;
  if (state.nodes > state.budget.maxNodes) {
    throw new ResourceLimitError(`${label}: semantic AST node budget exceeded`, 'M-RESOURCE-AST-NODES');
  }
}

function push(state, task) {
  if (state.work.length + 1 > state.budget.maxFrames) {
    throw new ResourceLimitError(`${task.label}: semantic AST frame budget exceeded`, 'M-RESOURCE-AST-FRAMES');
  }
  state.work.push(task);
}

function registerId(state, id, label) {
  if (id === undefined) return;
  validateId(id, label);
  assert.equal(state.ids.has(id), false, `duplicate block id ${id}`);
  state.ids.add(id);
}

function pushInlineArray(state, nodes, label, ctx = {}) {
  assert.equal(Array.isArray(nodes), true, `${label} must be an array`);
  if (ctx.nonEmpty) assert.ok(nodes.length > 0, `${label} must be non-empty`);
  for (let i = 0; i < nodes.length; i += 1) {
    if (i > 0) {
      assert.equal(nodes[i - 1]?.type === 'text' && nodes[i]?.type === 'text', false,
        `${label}: adjacent Text nodes must be coalesced`);
    }
    if (nodes[i]?.type === 'footnoteReference' && nodes[i - 1]?.type === 'text') {
      assert.equal(/[ \t\f\v]$/u.test(nodes[i - 1].value), false,
        `${label}: whitespace before FootnoteReference is source trivia and absent from semantic AST`);
    }
    const flankNodes = ['deletion', 'obsolete', 'insert', 'mark'];
    if (flankNodes.includes(nodes[i]?.type) && nodes[i - 1]?.type === 'text') {
      const value = nodes[i - 1].value;
      assert.equal(isWordCodePoint(lastCodePoint(value)), false,
        `${label}: a ${nodes[i].type} opener after a word character has no canonical surface (GFM flanking)`);
      if (nodes[i].type === 'obsolete') {
        assert.equal(value.endsWith('-'), false,
          `${label}: a Text ending in "-" immediately before an Obsolete has no canonical surface (the "---" three-run rule)`);
      }
    }
    if (flankNodes.includes(nodes[i - 1]?.type) && nodes[i]?.type === 'text') {
      assert.equal(isWordCodePoint(nodes[i].value.codePointAt(0) ?? -1), false,
        `${label}: a ${nodes[i - 1].type} closer before a word character has no canonical surface (GFM flanking)`);
    }
  }
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    push(state, { kind: 'inline', node: nodes[i], label: `${label}[${i}]`, ctx });
  }
}

function validateInlineTask(state, node, label, ctx = {}) {
  consumeNode(state, label);
  object(node, label);
  noSourceLocation(node, label);
  string(node.type, `${label}.type`, { nonEmpty: true });

  if (ctx.singleLine) {
    assert.notEqual(node.type, 'softBreak', `${label}: softBreak forbidden in single-line context`);
    assert.notEqual(node.type, 'hardBreak', `${label}: hardBreak forbidden in single-line context`);
  }
  if (ctx.noHardBreak) assert.notEqual(node.type, 'hardBreak', `${label}: hardBreak forbidden inside multiline inline construct`);
  if (ctx.noFootnote) assert.notEqual(node.type, 'footnoteReference', `${label}: nested footnote reference forbidden`);
  if (ctx.noLink) assert.equal(node.type === 'link' || node.type === 'autolink', false, `${label}: nested link forbidden`);
  if (ctx.directWrapperType !== undefined) {
    assert.notEqual(node.type, ctx.directWrapperType, `${label}: direct same-kind wrapper nesting forbidden`);
  }

  switch (node.type) {
    case 'text':
      string(node.value, `${label}.value`, { nonEmpty: true });
      assert.equal(/[\r\n]/u.test(node.value), false, `${label}.value must not contain line breaks`);
      break;
    case 'softBreak':
    case 'hardBreak':
      break;
    case 'inlineCode':
      string(node.value, `${label}.value`, { nonEmpty: true });
      assert.equal(node.value.includes('\n'), false, `${label}.value must be single-line`);
      break;
    case 'inlineMath':
      string(node.value, `${label}.value`, { nonEmpty: true });
      assert.equal(node.value.includes('\n'), false, `${label}.value must be single-line`);
      assert.equal(node.value.includes('`$'), false, `${label}.value contains unrepresentable closer sequence`);
      break;
    case 'sup':
      string(node.value, `${label}.value`, { nonEmpty: true });
      assert.equal(/\s/u.test(node.value), false, `${label}.value must be whitespace-free`);
      assert.equal(node.value.includes('^'), false, `${label}.value must not contain ^`);
      break;
    case 'sub':
      string(node.value, `${label}.value`, { nonEmpty: true });
      assert.equal(/\s/u.test(node.value), false, `${label}.value must be whitespace-free`);
      assert.equal(node.value.includes('~'), false, `${label}.value must not contain ~`);
      break;
    case 'link':
      destination(node.href, `${label}.href`);
      optionalString(node.title, `${label}.title`);
      if (node.download !== undefined) assert.equal(node.download, true, `${label}.download must be true when present`);
      if (node.attrs !== undefined) assert.equal(node.download, true, `${label}.attrs require download=true`);
      validateAttrs(node.attrs, `${label}.attrs`, 'download');
      pushInlineArray(state, node.children, `${label}.children`, { ...ctx, noLink: true, noHardBreak: true });
      break;
    case 'inlineImage':
      destination(node.src, `${label}.src`);
      optionalString(node.title, `${label}.title`);
      validateAttrs(node.attrs, `${label}.attrs`, 'image');
      pushInlineArray(state, node.alt, `${label}.alt`, { ...ctx, noLink: true, noHardBreak: true });
      break;
    case 'autolink':
      assert.ok(node.kind === 'url' || node.kind === 'email', `${label}.kind invalid`);
      string(node.value, `${label}.value`, { nonEmpty: true });
      if (node.kind === 'url') {
        assert.match(node.value, /^https?:\/\/[^\s<>]+$/u, `${label}.value is outside the canonical URL autolink domain`);
      } else {
        assert.match(node.value, /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/u,
          `${label}.value is outside the canonical email autolink domain`);
      }
      break;
    case 'footnoteReference':
      string(node.identifier, `${label}.identifier`, { nonEmpty: true });
      assert.match(node.identifier, /^[A-Za-z0-9_-]+$/, `${label}.identifier invalid`);
      state.refs.add(node.identifier);
      break;
    case 'metadataSpan':
      assert.notEqual(node.attrs, undefined, `${label}.attrs must contain at least one metadata attribute`);
      validateAttrs(node.attrs, `${label}.attrs`, 'metadata');
      pushInlineArray(state, node.children, `${label}.children`, { ...ctx, nonEmpty: true, noHardBreak: true });
      break;
    default:
      if (inlineWrapperTypes.has(node.type)) {
        pushInlineArray(state, node.children, `${label}.children`, {
          ...ctx, nonEmpty: true,
          ...(node.type === 'em' || node.type === 'strong' || node.type === 'deletion'
            ? { noHardBreak: true }
            : { singleLine: true }),
          directWrapperType: node.type,
        });
        break;
      }
      assert.fail(`${label}: unknown inline type ${node.type}`);
  }
}

function validateResourceBlock(state, node, label, kind) {
  if (node.type === 'imageBlock') {
    destination(node.src, `${label}.src`);
    pushInlineArray(state, node.alt, `${label}.alt`, { singleLine: true, noLink: true });
  } else if (node.type === 'downloadBlock') {
    destination(node.href, `${label}.href`);
    pushInlineArray(state, node.label, `${label}.label`, { singleLine: true, noLink: true });
  } else {
    const targetKey = node.type === 'embedBlock' ? 'target' : 'src';
    destination(node[targetKey], `${label}.${targetKey}`);
    pushInlineArray(state, node.label, `${label}.label`, { singleLine: true, noLink: true });
  }
  optionalString(node.title, `${label}.title`);
  if (node.caption !== undefined) pushInlineArray(state, node.caption, `${label}.caption`, { nonEmpty: true, singleLine: true });
  validateAttrs(node.attrs, `${label}.attrs`, kind);
}

function validateTable(state, node, label) {
  nonEmptyArray(node.alignments, `${label}.alignments`);
  for (const [i, alignment] of node.alignments.entries()) {
    assert.ok(['default', 'left', 'center', 'right'].includes(alignment), `${label}.alignments[${i}] invalid`);
  }
  const width = node.alignments.length;
  const rows = [node.head, ...(Array.isArray(node.body) ? node.body : [])];
  object(node.head, `${label}.head`);
  assert.equal(Array.isArray(node.body), true, `${label}.body must be an array`);

  for (const [r, row] of rows.entries()) {
    const rowLabel = r === 0 ? `${label}.head` : `${label}.body[${r - 1}]`;
    consumeNode(state, rowLabel);
    object(row, rowLabel);
    noSourceLocation(row, rowLabel);
    assert.equal(row.type, 'tableRow', `${rowLabel}.type must be tableRow`);
    assert.equal(Array.isArray(row.cells), true, `${rowLabel}.cells must be an array`);
    assert.equal(row.cells.length, width, `${rowLabel}.cells length must equal table width ${width}`);
    for (const [i, cell] of row.cells.entries()) {
      const cellLabel = `${rowLabel}.cells[${i}]`;
      consumeNode(state, cellLabel);
      object(cell, cellLabel);
      noSourceLocation(cell, cellLabel);
      assert.equal(cell.type, 'tableCell', `${cellLabel}.type must be tableCell`);
      assert.equal(Object.prototype.hasOwnProperty.call(cell, 'column'), false, `${cellLabel}.column is not part of 0.1.0 table semantics`);
      assert.equal(Object.prototype.hasOwnProperty.call(cell, 'rowSpan'), false, `${cellLabel}.rowSpan is Grid-only in 0.1.0`);
      assert.equal(Object.prototype.hasOwnProperty.call(cell, 'colSpan'), false, `${cellLabel}.colSpan is Grid-only in 0.1.0`);
      pushInlineArray(state, cell.children, `${cellLabel}.children`, { singleLine: true });
    }
  }
}

function validateGridGeometryAndPushChildren(state, node, label) {
  assert.ok(Number.isInteger(node.columns) && node.columns >= 1, `${label}.columns must be a positive integer`);
  nonEmptyArray(node.rows, `${label}.rows`);
  if (node.header !== undefined) nonEmptyArray(node.header, `${label}.header`);
  assert.ok(node.header !== undefined || node.columns > 1 || node.rows.length > 1,
    `${label}: headerless 1x1 Grid has no canonical Grid surface`);

  const validateGroup = (rows, groupLabel) => {
    const height = rows.length;
    const slots = height * node.columns;
    if (!Number.isSafeInteger(slots) || slots > state.budget.maxMatrixSlots) {
      throw new ResourceLimitError(`${groupLabel}: Grid occupancy budget exceeded`, 'M-RESOURCE-GRID-SLOTS');
    }
    const occupancy = Array.from({ length: height }, () => Array(node.columns).fill(null));

    for (const [r, row] of rows.entries()) {
      const rowLabel = `${groupLabel}[${r}]`;
      consumeNode(state, rowLabel);
      object(row, rowLabel);
      noSourceLocation(row, rowLabel);
      assert.equal(row.type, 'gridRow', `${rowLabel}.type must be gridRow`);
      assert.equal(Array.isArray(row.cells), true, `${rowLabel}.cells must be an array`);
      let previousColumn = 0;

      for (const [i, cell] of row.cells.entries()) {
        const cellLabel = `${rowLabel}.cells[${i}]`;
        consumeNode(state, cellLabel);
        object(cell, cellLabel);
        noSourceLocation(cell, cellLabel);
        assert.equal(cell.type, 'gridCell', `${cellLabel}.type must be gridCell`);
        assert.ok(Number.isInteger(cell.column) && cell.column >= 1 && cell.column <= node.columns, `${cellLabel}.column invalid`);
        assert.ok(cell.column > previousColumn, `${cellLabel}.column must be strictly increasing within row`);
        previousColumn = cell.column;
        const rowSpan = cell.rowSpan ?? 1;
        const colSpan = cell.colSpan ?? 1;
        if (cell.rowSpan !== undefined) assert.ok(Number.isInteger(cell.rowSpan) && cell.rowSpan >= 2, `${cellLabel}.rowSpan must be >= 2 when present`);
        if (cell.colSpan !== undefined) assert.ok(Number.isInteger(cell.colSpan) && cell.colSpan >= 2, `${cellLabel}.colSpan must be >= 2 when present`);
        assert.ok(r + rowSpan <= height, `${cellLabel}.rowSpan exceeds ${groupLabel} height`);
        assert.ok(cell.column - 1 + colSpan <= node.columns, `${cellLabel}.colSpan exceeds grid width`);
        nonEmptyArray(cell.children, `${cellLabel}.children`);

        for (let rr = r; rr < r + rowSpan; rr += 1) {
          for (let cc = cell.column - 1; cc < cell.column - 1 + colSpan; cc += 1) {
            assert.equal(occupancy[rr][cc], null, `${cellLabel}: overlaps another grid cell`);
            occupancy[rr][cc] = cellLabel;
          }
        }
        for (let j = cell.children.length - 1; j >= 0; j -= 1) {
          const child = cell.children[j];
          assert.notEqual(child?.type, 'container', `${cellLabel}: containers forbidden in grid cells`);
          assert.notEqual(child?.type, 'grid', `${cellLabel}: nested Grid forbidden in grid cells`);
          push(state, {
            kind: 'block', node: child, label: `${cellLabel}.children[${j}]`,
            ctx: { idsAllowed: false, owner: 'gridCell' },
          });
        }
      }
    }
    for (let r = 0; r < height; r += 1) {
      for (let c = 0; c < node.columns; c += 1) {
        assert.notEqual(occupancy[r][c], null, `${groupLabel}: uncovered grid slot at row ${r + 1}, column ${c + 1}`);
      }
    }
  };

  if (node.header !== undefined) validateGroup(node.header, `${label}.header`);
  validateGroup(node.rows, `${label}.rows`);
}

function validateBlockTask(state, node, label, ctx = {}) {
  consumeNode(state, label);
  object(node, label);
  noSourceLocation(node, label);
  assert.ok(blockTypes.has(node.type), `${label}: unknown block type ${node.type}`);

  if (node.id !== undefined) {
    assert.notEqual(node.type, 'commentBlock', `${label}: CommentBlock cannot carry an ID`);
    assert.notEqual(ctx.idsAllowed, false, `${label}.id forbidden inside ${ctx.owner}`);
    registerId(state, node.id, `${label}.id`);
  }

  switch (node.type) {
    case 'heading':
      assert.ok(Number.isInteger(node.level) && node.level >= 1 && node.level <= 6, `${label}.level invalid`);
      pushInlineArray(state, node.children, `${label}.children`, { nonEmpty: true, singleLine: true });
      break;
    case 'paragraph':
      pushInlineArray(state, node.children, `${label}.children`, { nonEmpty: true });
      if (node.children.length === 1) {
        const only = node.children[0];
        assert.equal(only?.type === 'inlineImage' || (only?.type === 'link' && only.download === true), false,
          `${label}: full-line block-capable resource is not representable as Paragraph`);
      }
      break;
    case 'horizontalRule':
      break;
    case 'codeBlock':
      string(node.value, `${label}.value`);
      if (node.lang !== undefined) {
        string(node.lang, `${label}.lang`, { nonEmpty: true });
        assert.equal(/\s/u.test(node.lang), false, `${label}.lang must be whitespace-free`);
        assert.equal(node.lang.includes('`'), false, `${label}.lang must not contain a backtick`);
        assert.notEqual(node.lang, 'math', `${label}.lang=math must use MathBlock`);
      }
      break;
    case 'mathBlock':
      string(node.value, `${label}.value`);
      break;
    case 'commentBlock':
      string(node.value, `${label}.value`);
      assert.equal(node.value.includes('-->'), false, `${label}.value contains unrepresentable closer`);
      break;
    case 'imageBlock':
      validateResourceBlock(state, node, label, 'image');
      break;
    case 'videoBlock':
    case 'audioBlock':
    case 'embedBlock':
      validateResourceBlock(state, node, label, 'media');
      break;
    case 'downloadBlock':
      validateResourceBlock(state, node, label, 'download');
      break;
    case 'quoteRegion': {
      nonEmptyArray(node.children, `${label}.children`);
      if (node.attribution !== undefined) pushInlineArray(state, node.attribution, `${label}.attribution`, { nonEmpty: true, singleLine: true });
      let previousLevel = null;
      for (let i = node.children.length - 1; i >= 0; i -= 1) {
        const qb = node.children[i];
        const qLabel = `${label}.children[${i}]`;
        object(qb, qLabel);
        noSourceLocation(qb, qLabel);
        assert.ok(Number.isInteger(qb.level) && qb.level >= 1, `${qLabel}.level invalid`);
        if (i === 0) assert.equal(qb.level, 1, `${qLabel}.level: QuoteRegion must start at depth 1`);
        if (i > 0) {
          const prior = node.children[i - 1].level;
          assert.ok(qb.level <= prior + 1, `${qLabel}.level rises by more than one`);
        }
        previousLevel = qb.level;
        assert.notEqual(qb.block?.type, 'container', `${qLabel}: container forbidden in quote`);
        push(state, { kind: 'block', node: qb.block, label: `${qLabel}.block`, ctx: { idsAllowed: false, owner: 'quoteRegion' } });
      }
      void previousLevel;
      break;
    }
    case 'container': {
      assert.ok(node.form === 'lined' || node.form === 'fenced', `${label}.form invalid`);
      validateContainerType(node.containerType, `${label}.containerType`);
      assert.ok(node.title === null || typeof node.title === 'string', `${label}.title invalid`);
      if (node.title !== null) {
        string(node.title, `${label}.title`, { nonEmpty: true });
        assert.notEqual(node.containerType, null, `${label}.title requires containerType`);
        assert.equal(/[\r\n]/u.test(node.title), false, `${label}.title must be single-line`);
      }
      validateLinedHeaderRepresentability(node, label);
      nonEmptyArray(node.children, `${label}.children`);
      const grids = node.children.filter((child) => child?.type === 'grid');
      if (node.form === 'lined') assert.equal(grids.length, 0, `${label}: grid is fenced-container-only`);
      if (grids.length > 0) {
        assert.equal(node.form, 'fenced', `${label}: grid is fenced-container-only`);
        assert.equal(node.children.length, 1, `${label}: grid must be the sole fenced-container child`);
        const grid = grids[0];
        consumeNode(state, `${label}.children[0]`);
        object(grid, `${label}.children[0]`);
        noSourceLocation(grid, `${label}.children[0]`);
        assert.equal(grid.type, 'grid', `${label}.children[0].type must be grid`);
        validateGridGeometryAndPushChildren(state, grid, `${label}.children[0]`);
        break;
      }
      for (let i = node.children.length - 1; i >= 0; i -= 1) {
        const child = node.children[i];
        if (node.form === 'fenced') assert.notEqual(child?.type, 'container', `${label}: fenced container may not nest a container`);
        if (node.form === 'lined' && child?.type === 'container') {
          assert.equal(child.form, 'fenced', `${label}: lined container may only contain direct fenced containers`);
        }
        push(state, { kind: 'block', node: child, label: `${label}.children[${i}]`, ctx: { idsAllowed: true, owner: 'container' } });
      }
      break;
    }
    case 'list': {
      assert.ok(['unordered', 'ordered', 'definition'].includes(node.kind), `${label}.kind invalid`);
      if (node.kind === 'ordered') {
        if (node.start !== undefined) {
          assert.ok(Number.isInteger(node.start) && node.start >= 0 && node.start <= 999_999_999, `${label}.start invalid`);
          assert.notEqual(node.start, 1, `${label}.start=1 is non-semantic; omit the field`);
        }
      } else {
        assert.equal(node.start, undefined, `${label}.start is ordered-list-only`);
      }
      nonEmptyArray(node.items, `${label}.items`);
      const listItemBlockTypes = new Set([
        'paragraph', 'codeBlock', 'mathBlock', 'commentBlock', 'imageBlock',
        'videoBlock', 'audioBlock', 'embedBlock', 'downloadBlock', 'table',
        'list', 'quoteRegion',
      ]);
      let expected = node.kind === 'ordered' ? (node.start ?? 1) : null;
      for (const [i, item] of node.items.entries()) {
        const itemLabel = `${label}.items[${i}]`;
        consumeNode(state, itemLabel);
        object(item, itemLabel);
        noSourceLocation(item, itemLabel);
        assert.equal(item.type, 'listItem', `${itemLabel}.type must be listItem`);
        if (node.kind !== 'ordered') assert.equal(item.value, undefined, `${itemLabel}.value is ordered-list-only`);
        if (node.kind === 'ordered') {
          if (i === 0) assert.equal(item.value, undefined, `${itemLabel}.value duplicates List.start on the first item`);
          if (item.value !== undefined) {
            assert.ok(Number.isInteger(item.value) && item.value >= 0 && item.value <= 999_999_999, `${itemLabel}.value invalid`);
            assert.notEqual(item.value, expected, `${itemLabel}.value is not a visible deviation; omit it`);
            expected = item.value;
          } else {
            assert.ok(expected >= 0 && expected <= 999_999_999, `${itemLabel}: implicit ordered value is outside the valid marker range; store a visible deviation`);
          }
          expected += 1;
        }
        if (item.task !== undefined) {
          assert.ok(item.task === 'open' || item.task === 'done', `${itemLabel}.task invalid`);
          assert.notEqual(node.kind, 'definition', `${itemLabel}.task is not permitted in definition lists`);
        }
        nonEmptyArray(item.children, `${itemLabel}.children`);
        assert.equal(item.children[0]?.type, 'paragraph', `${itemLabel}.children[0] must be paragraph`);
        for (let j = item.children.length - 1; j >= 0; j -= 1) {
          const child = item.children[j];
          assert.notEqual(child?.type, 'container', `${itemLabel}: containers forbidden in list items`);
          assert.ok(listItemBlockTypes.has(child?.type), `${itemLabel}.children[${j}]: block type is not permitted in ListItem`);
          push(state, { kind: 'block', node: child, label: `${itemLabel}.children[${j}]`, ctx: { idsAllowed: false, owner: 'listItem' } });
        }
      }
      break;
    }
    case 'table':
      validateTable(state, node, label);
      break;
    default:
      assert.fail(`${label}: unhandled block type ${node.type}`);
  }
}

function validateFootnoteDefinition(state, def, label) {
  consumeNode(state, label);
  object(def, label);
  noSourceLocation(def, label);
  assert.equal(def.type, 'footnoteDefinition', `${label}.type must be footnoteDefinition`);
  string(def.identifier, `${label}.identifier`, { nonEmpty: true });
  assert.match(def.identifier, /^[A-Za-z0-9_-]+$/, `${label}.identifier invalid`);
  assert.equal(state.defs.has(def.identifier), false, `duplicate footnote definition ${def.identifier}`);
  state.defs.add(def.identifier);
  registerId(state, def.id, `${label}.id`);
  pushInlineArray(state, def.children, `${label}.children`, { nonEmpty: true, singleLine: true, noFootnote: true });
}

export function validateSemanticAstSnapshot(doc, label = 'semanticAst', options = {}) {
  const state = createState(options);
  object(doc, label);
  noSourceLocation(doc, label);
  assert.equal(doc.type, 'document', `${label}.type must be document`);
  assert.equal(Array.isArray(doc.children), true, `${label}.children must be an array`);
  assert.equal(Array.isArray(doc.footnotes), true, `${label}.footnotes must be an array`);

  for (let i = doc.footnotes.length - 1; i >= 0; i -= 1) {
    push(state, { kind: 'footnote', node: doc.footnotes[i], label: `${label}.footnotes[${i}]` });
  }
  for (let i = doc.children.length - 1; i >= 0; i -= 1) {
    push(state, { kind: 'block', node: doc.children[i], label: `${label}.children[${i}]`, ctx: { idsAllowed: true, owner: 'document' } });
  }

  while (state.work.length > 0) {
    const task = state.work.pop();
    if (task.kind === 'block') validateBlockTask(state, task.node, task.label, task.ctx);
    else if (task.kind === 'inline') validateInlineTask(state, task.node, task.label, task.ctx);
    else if (task.kind === 'footnote') validateFootnoteDefinition(state, task.node, task.label);
    else assert.fail(`unknown validation task ${task.kind}`);
  }

  for (const ref of state.refs) assert.equal(state.defs.has(ref), true, `missing footnote definition ${ref}`);

  const referenced = [...state.refs];
  const unused = doc.footnotes
    .map((definition) => definition.identifier)
    .filter((identifier) => !state.refs.has(identifier))
    .sort();
  const expectedFootnoteOrder = [...referenced, ...unused];
  assert.deepEqual(doc.footnotes.map((definition) => definition.identifier), expectedFootnoteOrder,
    `${label}.footnotes must be in canonical reference/ASCII order`);
}
