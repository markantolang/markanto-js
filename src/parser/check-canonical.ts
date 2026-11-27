import type { CanonicalCheckResult } from '../parser-contract.ts';
import { checkParsedCanonical } from './canonical.ts';
import { parse } from './parse.ts';

/** Parse normally, then report whether the original bytes are canonical Markanto. */
export function checkCanonical(source: string): CanonicalCheckResult {
  const parsed = parse(source);
  if (parsed.status !== 'ok') {
    return { status: parsed.status, diagnostics: parsed.diagnostics };
  }
  return checkParsedCanonical(source, parsed.document);
}
