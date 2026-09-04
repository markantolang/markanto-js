import type { Container, Document, DocumentBlock, ErrorBlock, FootnoteDefinition, RecoveryDocument } from '../ast.js';
import { DiagnosticSink } from '../diagnostics.js';
import { createSourceAnnotationBuilder, type ParserOptions, type ParseResult } from '../parser-contract.js';
import { openSource } from '../source/index.js';
import { leadingSpaces, recognizeBlock } from './blocks.js';
import { isIdentifier, parseStandaloneSuffix } from './block-id.js';
import { recognizeFootnoteDefinition, resolveFootnotes } from './footnotes.js';
import { checkParsedCanonical } from './canonical.js';
import { exceedsGridMatrixBudget } from './grid.js';

const OFFSET_UNIT = 'utf16-code-unit' as const;

export function parse(raw: string, options: ParserOptions = {}): ParseResult {
  const source = openSource(raw);
  const { text, lines, transport } = source;
  const annotations = createSourceAnnotationBuilder(source);
  const diagnostics = new DiagnosticSink();
  const children: DocumentBlock[] = [];
  const recoveryChildren: Array<DocumentBlock | ErrorBlock> = [];
  const footnoteDefinitions: FootnoteDefinition[] = [];
  let failed = false;
  let nodeCount = 0;
  let separatedByBlank = true;

  const resource = (message: string): ParseResult => ({
    status: 'resource', offsetUnit: OFFSET_UNIT,
    diagnostics: [{ category: 'resource', severity: 'error', message }],
  });
  if (options.resourceBudget?.maxSourceBytes !== undefined && utf8ByteLength(raw) > options.resourceBudget.maxSourceBytes) {
    return resource('source byte budget exceeded');
  }
  const maxStructuralFrames = options.resourceBudget?.maxFrames ?? 1000;
  if (maximumStructuralFrames(text) > maxStructuralFrames) return resource('structural frame budget exceeded');
  const transportFault = transport.loneCrOffsets.length > 0
    ? 'lone CR is not valid Markanto transport'
    : transport.firstLoneSurrogateOffset >= 0
      ? 'lone UTF-16 surrogate is not a valid Unicode scalar value'
      : null;
  if (transportFault !== null) {
    diagnostics.syntaxError({ message: transportFault });
    if (options.errorRecovery !== true) return { status: 'invalid', offsetUnit: OFFSET_UNIT, diagnostics: diagnostics.drain() };
    const error: ErrorBlock = { type: 'errorBlock', reason: transportFault, rawContent: text };
    annotations.set(error, 0, text.length);
    const recovery: RecoveryDocument = { type: 'recoveryDocument', children: [error], footnotes: [] };
    annotations.set(recovery, 0, text.length);
    return { status: 'invalid', offsetUnit: OFFSET_UNIT, diagnostics: diagnostics.drain(), recovery, annotations: annotations.seal() };
  }

  while (!lines.atEnd) {
    const current = lines.current!;
    if (lines.isWhitespaceOnly(current)) {
      lines.advance();
      separatedByBlank = true;
      continue;
    }
    const standalone = parseStandaloneSuffix(text.slice(current.start, current.contentEnd));
    if (standalone.kind !== 'not-suffix') {
      lines.advance();
      const message = standalone.kind === 'valid' && separatedByBlank
        ? 'block id after blank line'
        : 'invalid block id suffix';
      diagnostics.syntaxError({ message });
      if (options.errorRecovery !== true) return { status: 'invalid', offsetUnit: OFFSET_UNIT, diagnostics: diagnostics.drain() };
      const error: ErrorBlock = { type: 'errorBlock', reason: message, rawContent: text.slice(current.start, current.contentEnd) };
      annotations.set(error, current.start, current.contentEnd);
      recoveryChildren.push(error);
      nodeCount += 1;
      failed = true;
      separatedByBlank = false;
      if (options.resourceBudget?.maxNodes !== undefined && nodeCount > options.resourceBudget.maxNodes) return resource('node budget exceeded');
      continue;
    }
    const footnote = recognizeFootnoteDefinition(current, text, annotations);
    if (footnote !== null) {
      lines.advance();
      if ('error' in footnote) {
        if (footnote.category === 'semantic') diagnostics.semanticError({ message: footnote.error });
        else diagnostics.syntaxError({ message: footnote.error });
        if (options.errorRecovery !== true) return { status: 'invalid', offsetUnit: OFFSET_UNIT, diagnostics: diagnostics.drain() };
        const error: ErrorBlock = { type: 'errorBlock', reason: footnote.error, rawContent: text.slice(footnote.start, footnote.end) };
        annotations.set(error, footnote.start, footnote.end);
        recoveryChildren.push(error);
        nodeCount += 1;
        failed = true;
      } else {
        const suffixLine = lines.current;
        if (suffixLine !== null) {
          const suffix = parseStandaloneSuffix(text.slice(suffixLine.start, suffixLine.contentEnd));
          if (suffix.kind === 'valid') {
            lines.advance();
            footnote.node.id = suffix.id;
            // The `{#id}` suffix is a postfix of the carrier block (parser
            // contract boundary rule), so extend the definition's range over it.
            annotations.set(footnote.node, current.start, suffixLine.contentEnd);
          } else if (suffix.kind === 'invalid') {
            lines.advance();
            const message = 'invalid block id suffix';
            diagnostics.syntaxError({ message });
            if (options.errorRecovery !== true) return { status: 'invalid', offsetUnit: OFFSET_UNIT, diagnostics: diagnostics.drain() };
            const error: ErrorBlock = { type: 'errorBlock', reason: message, rawContent: text.slice(suffixLine.start, suffixLine.contentEnd) };
            annotations.set(error, suffixLine.start, suffixLine.contentEnd);
            recoveryChildren.push(error);
            nodeCount += 1;
            failed = true;
          }
        }
        footnoteDefinitions.push(footnote.node);
        nodeCount += footnote.nodeCount;
      }
      separatedByBlank = false;
      if (options.resourceBudget?.maxNodes !== undefined && nodeCount > options.resourceBudget.maxNodes) return resource('node budget exceeded');
      continue;
    }
    // Every `recognizeBlock` call at document level starts a fresh block —
    // `recognizeParagraph` consumes its own continuation lines — so `current` is
    // this block's first line. Four or more leading spaces on it would be an
    // indented code block in CommonMark; Markanto has no indented code (§1.2)
    // and skips the indentation (§7.7), and a blank-line-separated indented
    // paragraph is not re-associated with a deeper list item either. Flag the
    // dropped indentation rather than reinterpret it silently: strict mode
    // already rejects it as noncanonical, normal mode keeps the prose but warns.
    const freshBlockIndent = leadingSpaces(text, current);
    const result = recognizeBlock(lines, text, annotations);
    if (result.status !== 'error' && result.node.type === 'paragraph' && freshBlockIndent >= 4) {
      diagnostics.advisory({
        message: 'leading indentation on this block is dropped, not preserved (§1.2): Markanto has no indented code block — use a fenced code block for code',
      });
    }
    if (result.status === 'error') {
      if (result.category === 'semantic') diagnostics.semanticError({ message: result.message });
      else diagnostics.syntaxError({ message: result.message });
      if (options.errorRecovery !== true) return { status: 'invalid', offsetUnit: OFFSET_UNIT, diagnostics: diagnostics.drain() };
      const error: ErrorBlock = { type: 'errorBlock', reason: result.message, rawContent: text.slice(result.start, result.safeEnd) };
      annotations.set(error, result.start, result.safeEnd);
      recoveryChildren.push(error);
      nodeCount += 1;
      failed = true;
      separatedByBlank = false;
    } else {
      let blockEnd = result.end;
      const suffixLine = lines.current;
      if (suffixLine !== null) {
        const suffix = parseStandaloneSuffix(text.slice(suffixLine.start, suffixLine.contentEnd));
        if (suffix.kind !== 'not-suffix') {
          lines.advance();
          const eligible = result.node.type === 'paragraph' || result.node.type === 'codeBlock' || result.node.type === 'mathBlock' ||
            result.node.type === 'imageBlock' || result.node.type === 'videoBlock' || result.node.type === 'audioBlock' ||
            result.node.type === 'embedBlock' || result.node.type === 'downloadBlock' || result.node.type === 'quoteRegion' || result.node.type === 'list' || result.node.type === 'table' ||
            result.node.type === 'container';
          if (eligible && suffix.kind === 'valid') {
            result.node.id = suffix.id;
            blockEnd = suffixLine.contentEnd;
          } else {
            annotations.set(result.node, result.start, result.end);
            children.push(result.node);
            recoveryChildren.push(result.node);
            nodeCount += result.nodeCount;
            const message = 'invalid block id suffix';
            diagnostics.syntaxError({ message });
            if (options.errorRecovery !== true) return { status: 'invalid', offsetUnit: OFFSET_UNIT, diagnostics: diagnostics.drain() };
            const error: ErrorBlock = { type: 'errorBlock', reason: message, rawContent: text.slice(suffixLine.start, suffixLine.contentEnd) };
            annotations.set(error, suffixLine.start, suffixLine.contentEnd);
            recoveryChildren.push(error);
            nodeCount += 1;
            failed = true;
            separatedByBlank = false;
            if (options.resourceBudget?.maxNodes !== undefined && nodeCount > options.resourceBudget.maxNodes) return resource('node budget exceeded');
            continue;
          }
        }
      }
      annotations.set(result.node, result.start, blockEnd);
      children.push(result.node);
      recoveryChildren.push(result.node);
      nodeCount += result.nodeCount;
      separatedByBlank = false;
      if (result.node.type === 'container' &&
          exceedsGridMatrixBudget({ children: [result.node], footnotes: [] }, options.resourceBudget)) {
        return resource('grid matrix slot budget exceeded');
      }
    }
    if (options.resourceBudget?.maxNodes !== undefined && nodeCount > options.resourceBudget.maxNodes) {
      return resource('node budget exceeded');
    }
  }

  const footnoteResolution = resolveFootnotes(children, footnoteDefinitions, diagnostics);
  const idsUnique = checkBlockIdUniqueness(children, footnoteDefinitions, diagnostics);

  if (failed || !footnoteResolution.ok || !idsUnique) {
    const recovery: RecoveryDocument = { type: 'recoveryDocument', children: recoveryChildren, footnotes: footnoteResolution.footnotes };
    annotations.set(recovery, 0, text.length);
    if (options.errorRecovery !== true) {
      return { status: 'invalid', offsetUnit: OFFSET_UNIT, diagnostics: diagnostics.drain() };
    }
    return { status: 'invalid', offsetUnit: OFFSET_UNIT, diagnostics: diagnostics.drain(), recovery, annotations: annotations.seal() };
  }
  const document: Document = { type: 'document', children, footnotes: footnoteResolution.footnotes };
  annotations.set(document, 0, text.length);
  if (options.strict === true) {
    const canonical = checkParsedCanonical(raw, document);
    if (canonical.status !== 'canonical') {
      // Noncanonical input has valid semantics, so recovery has nothing to recover.
      return { status: 'invalid', offsetUnit: OFFSET_UNIT, diagnostics: canonical.diagnostics };
    }
  }
  return { status: 'ok', offsetUnit: OFFSET_UNIT, diagnostics: diagnostics.drain(), document, annotations: annotations.seal() };
}

/**
 * Document-wide block-ID relation (spec §5, §6). A `Document` with a duplicate
 * or ill-formed explicit block ID is not a valid semantic AST (INVARIANTS), so
 * `parse()` rejects it here rather than leaving it to a later `validate()` —
 * the same treatment the footnote relation gets. IDs only ever sit on
 * document-level blocks, direct container children (recursing `lined -> fenced`),
 * and footnote definitions, so those are the positions walked.
 */
function checkBlockIdUniqueness(
  children: readonly DocumentBlock[], footnotes: readonly FootnoteDefinition[], diagnostics: DiagnosticSink,
): boolean {
  const seen = new Set<string>();
  let ok = true;
  const register = (id: string): void => {
    if (!isIdentifier(id)) {
      diagnostics.semanticError({ message: `invalid block id {#${id}}` });
      ok = false;
    } else if (seen.has(id)) {
      diagnostics.semanticError({ message: `duplicate block id {#${id}}` });
      ok = false;
    } else {
      seen.add(id);
    }
  };
  const walk = (block: DocumentBlock): void => {
    if ('id' in block && block.id !== undefined) register(block.id);
    if (block.type === 'container') {
      for (const child of (block as Container).children) {
        if (child.type !== 'grid') walk(child);
      }
    }
  };
  for (const block of children) walk(block);
  for (const definition of footnotes) if (definition.id !== undefined) register(definition.id);
  return ok;
}

/** Conservative, allocation-free guard before recursive logical-line parsing. */
/**
 * UTF-8 byte length of a JS (UTF-16) string, computed directly so the Rust port
 * measures the same quantity `ResourceBudget.maxSourceBytes` names (bytes, not
 * code units). A surrogate pair is one 4-byte scalar; a lone surrogate — which
 * `parse()` rejects a few lines below — is counted as 3 for the size gate only.
 */
function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) { bytes += 4; index += 1; } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

function maximumStructuralFrames(text: string): number {
  let maximum = 0; let lineStart = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index !== text.length && text.charCodeAt(index) !== 0x0a) continue;
    let cursor = lineStart; let frames = 0;
    while (cursor < index && text.charCodeAt(cursor) === 0x20) cursor += 1;
    frames += Math.floor((cursor - lineStart) / 2);
    while (cursor < index && text.charCodeAt(cursor) === 0x3e) {
      frames += 1; cursor += 1; if (text.charCodeAt(cursor) === 0x20) cursor += 1;
      while (cursor < index && text.charCodeAt(cursor) === 0x20) cursor += 1;
    }
    const code = text.charCodeAt(cursor);
    if (code === 0x2d || code === 0x2a || code === 0x2b || code === 0x3a || code >= 0x30 && code <= 0x39) frames += 1;
    if (frames > maximum) maximum = frames;
    lineStart = index + 1;
  }
  return maximum;
}
