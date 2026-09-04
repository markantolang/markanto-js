/**
 * Offset → line/column mapping.
 *
 * Source locations are NOT part of the semantic AST (docs/PORTABILITY.md).
 * A `LineMap` is built over one string and reports positions in that string's
 * code-unit space:
 *
 *  - `offset` is a UTF-16 code-unit offset into that string (the unit a
 *    JavaScript string indexes natively);
 *  - `line` is 1-based;
 *  - `column` is 1-based and counts Unicode scalar values from the line start,
 *    so a non-BMP character advances the column by one, not two.
 *
 * All three fields are mandatory. The *unit* is declared once, away from the
 * point — on `SourceAnnotations.offsetUnit` for the parser sidecar. A Rust port
 * may build its `LineMap` over UTF-8 bytes instead.
 */

/** A resolved position. Every field is mandatory. */
export interface Point {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

/** A half-open span: `end` is the first position not covered. */
export interface Span {
  readonly start: Point;
  readonly end: Point;
}

export class LineMap {
  /** `lineStarts[n]` is the code-unit offset where 1-based line `n + 1` begins. */
  private readonly lineStarts: readonly number[];
  private readonly length: number;

  constructor(private readonly text: string) {
    const starts = [0];
    // Recognise every physical line terminator the public source space can
    // contain: LF, CRLF (one terminator), and lone CR.
    for (let i = 0; i < text.length; i += 1) {
      const c = text.charCodeAt(i);
      if (c === 0x0a) {
        starts.push(i + 1);
      } else if (c === 0x0d) {
        if (text.charCodeAt(i + 1) === 0x0a) {
          starts.push(i + 2);
          i += 1;
        } else {
          starts.push(i + 1);
        }
      }
    }
    this.lineStarts = starts;
    this.length = text.length;
  }

  /** Number of line starts; a trailing newline opens a further (empty) line. */
  get lineCount(): number {
    return this.lineStarts.length;
  }

  /** Code-unit offset at which 1-based `line` starts, or `-1` if out of range. */
  lineStart(line: number): number {
    if (line < 1 || line > this.lineStarts.length) return -1;
    return this.lineStarts[line - 1] ?? -1;
  }

  pointAt(offset: number): Point {
    const clamped = offset < 0 ? 0 : offset > this.length ? this.length : offset;
    const lineIndex = this.lineIndexFor(clamped);
    const lineStart = this.lineStarts[lineIndex] ?? 0;
    const column = codePointCount(this.text, lineStart, clamped) + 1;
    return { line: lineIndex + 1, column, offset: clamped };
  }

  spanAt(start: number, end: number): Span {
    return { start: this.pointAt(start), end: this.pointAt(end) };
  }

  /** Binary search: 0-based line index whose range contains `offset`. */
  private lineIndexFor(offset: number): number {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.lineStarts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}

/** Count Unicode scalar values in `text` over the code-unit range [from, to). */
export function codePointCount(text: string, from: number, to: number): number {
  let count = 0;
  let i = from;
  while (i < to) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < to) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        i += 2;
        count += 1;
        continue;
      }
    }
    i += 1;
    count += 1;
  }
  return count;
}
