/**
 * Source/text layer: transport normalisation, physical lines, offset→point
 * mapping, and the forward-only scanner. Nothing here knows Markanto grammar.
 */

export { normalizeTransport, isCanonicalTransport, rawOffsetProjector } from './transport.js';
export type { TransportReport } from './transport.js';

export { LineReader } from './lines.js';
export type { PhysicalLine } from './lines.js';

export { LineMap, codePointCount } from './position.js';
export type { Point, Span } from './position.js';

export {
  Scanner,
  isAsciiDigit,
  isAsciiLower,
  isAsciiUpper,
  isAsciiLetter,
  isAsciiBlank,
  isIdentifierChar,
} from './scanner.js';
export type { CodePredicate } from './scanner.js';

import { normalizeTransport, rawOffsetProjector, type TransportReport } from './transport.js';
import { LineReader } from './lines.js';
import { LineMap } from './position.js';

/**
 * Convenience bundle: normalise raw input once and hand back the shared views.
 *
 * - `text` is the normalised parser input (BOM removed, CRLF/CR → LF).
 * - `lines` reads physical lines over `text`, in normalised offsets.
 * - `sourceMap` maps positions in the **public source coordinate space** — the
 *   raw input with a leading BOM removed and CRLF/CR preserved
 *   (docs/PARSER_CONTRACT.md).
 * - `toSourceOffset` projects a normalised parser offset into that space.
 */
export interface Source {
  readonly text: string;
  readonly transport: TransportReport;
  readonly lines: LineReader;
  readonly sourceMap: LineMap;
  readonly toSourceOffset: (normalizedOffset: number) => number;
}

export function openSource(raw: string): Source {
  const { text, report } = normalizeTransport(raw);
  const publicSource = report.hadBom ? raw.slice(1) : raw;
  return {
    text,
    transport: report,
    lines: new LineReader(text),
    sourceMap: new LineMap(publicSource),
    toSourceOffset: rawOffsetProjector(report),
  };
}
