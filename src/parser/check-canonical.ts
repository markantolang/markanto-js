import type { CanonicalCheckResult } from '../parser-contract.js';
import { checkParsedCanonical } from './canonical.js';
import { parse } from './parse.js';

/** Parse normally, then report whether the original bytes are canonical Markanto. */
export function checkCanonical(source: string): CanonicalCheckResult {
  const parsed = parse(source);
  if (parsed.status !== 'ok') {
    return { status: parsed.status, diagnostics: parsed.diagnostics };
  }
  return checkParsedCanonical(source, parsed.document);
}
