import type { Document } from '../ast.js';
import { diagnostic, type Diagnostic } from '../diagnostics.js';
import { format } from '../formatter/format.js';
import type { CanonicalCheckResult } from '../parser-contract.js';
import { isCanonicalTransport, openSource } from '../source/index.js';

/** Shared canonicality verdict for an already normally parsed document. */
export function checkParsedCanonical(source: string, document: Document): CanonicalCheckResult {
  const opened = openSource(source);
  const formatted = format(document);
  if (formatted.status !== 'ok') return formatted;

  if (isCanonicalTransport(opened.transport) && formatted.source === source) {
    return { status: 'canonical', diagnostics: [] };
  }

  const diagnostics: Diagnostic[] = [];
  if (opened.transport.hadBom) diagnostics.push(noncanonical('input has a UTF-8 BOM'));
  if (opened.transport.crlfCount > 0) diagnostics.push(noncanonical('input uses CRLF line endings'));
  if (opened.transport.trailingLfCount !== 1) {
    diagnostics.push(noncanonical('input does not end with exactly one newline'));
  }
  if (diagnostics.length === 0) diagnostics.push(noncanonical('surface differs from the canonical form'));
  return { status: 'noncanonical', canonical: formatted.source, diagnostics };
}

function noncanonical(message: string): Diagnostic {
  return diagnostic('noncanonical', 'error', { message });
}
