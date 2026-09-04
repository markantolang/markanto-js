/**
 * Forward-only cursor over a slice of normalised source text.
 *
 * Contract (docs/PARSER.md):
 *  - one monotonic cursor; `pos` never decreases;
 *  - bounded lookahead via `peek*` / `startsWith` without consuming;
 *  - consume only once a construct is confirmed;
 *  - no method rewinds.
 *
 * The scanner works on `[start, end)` of `text`. Inline scanning uses a scanner
 * bounded to one physical line slice; block scanning uses primitives on the
 * line layer instead.
 *
 * Portability: `pos` / `start` / `end` are UTF-16 code-unit offsets — the unit a
 * JavaScript string indexes natively. That unit is an implementation/API choice
 * (docs/PORTABILITY.md, "Source-location policy"); a Rust port indexes the same
 * `&str` by UTF-8 byte offset. The control flow does not depend on the unit:
 * every structural comparison is against an ASCII scalar value, which is
 * identical as a UTF-16 code unit and as a UTF-8 byte, and a surrogate half
 * (0xD800–0xDFFF) never equals one. Scalar-value decoding is confined to
 * `peekCodePoint` / `next`; a Rust port replaces those with `chars()`.
 * `scanRun` and `startsWith` take ASCII arguments only.
 */

const ASCII_MAX = 0x7f;

export type CodePredicate = (code: number) => boolean;

/**
 * Guard the forward-only / bounded contract at every public numeric entry
 * point. JavaScript would otherwise accept `NaN`, `Infinity`, fractions and
 * negatives here; a Rust port takes an unsigned integer and could not, so an
 * unguarded value is a latent cross-implementation divergence.
 */
function assertOffset(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`Scanner: ${label} must be a non-negative integer, got ${value}`);
  }
}

export class Scanner {
  private cursor: number;

  constructor(
    readonly text: string,
    readonly start: number = 0,
    readonly end: number = text.length,
  ) {
    assertOffset(start, 'start');
    assertOffset(end, 'end');
    if (end > text.length || start > end) {
      throw new RangeError(`Scanner bounds out of range: [${start}, ${end}) of ${text.length}`);
    }
    this.cursor = start;
  }

  /** Current absolute code-unit offset into `text`. */
  get pos(): number {
    return this.cursor;
  }

  get atEnd(): boolean {
    return this.cursor >= this.end;
  }

  /** Code units left in the slice. */
  get remaining(): number {
    return this.end - this.cursor;
  }

  /**
   * Slice from the cursor to `end`. Allocates — use only for diagnostics or a
   * confirmed final token value, never for classification in a loop.
   */
  rest(): string {
    return this.text.slice(this.cursor, this.end);
  }

  /** Slice already consumed since `from` (default: slice start). */
  consumedSince(from: number = this.start): string {
    assertOffset(from, 'consumedSince(from)');
    if (from > this.cursor) {
      throw new RangeError(`Scanner.consumedSince: from ${from} is ahead of the cursor ${this.cursor}`);
    }
    return this.text.slice(from, this.cursor);
  }

  // -- lookahead -----------------------------------------------------------

  /**
   * UTF-16 code unit `ahead` (a non-negative integer) positions from the
   * cursor, or `-1` past `end`. Negative lookahead is rejected, not silently
   * allowed to read already-consumed input.
   */
  peekUnit(ahead = 0): number {
    assertOffset(ahead, 'peekUnit(ahead)');
    const at = this.cursor + ahead;
    return at < this.end ? this.text.charCodeAt(at) : -1;
  }

  /**
   * Unicode scalar value at the cursor, or `-1` at `end`.
   *
   * A lone surrogate (unpaired, or split by `end`) is returned as its raw code
   * unit. That input cannot occur in a Rust `&str` at all, so this fallthrough
   * has no Rust counterpart — it is defensive handling of malformed UTF-16 that
   * a Rust port rejects at decode time instead.
   */
  peekCodePoint(): number {
    if (this.atEnd) return -1;
    const code = this.text.charCodeAt(this.cursor);
    if (code >= 0xd800 && code <= 0xdbff && this.cursor + 1 < this.end) {
      const low = this.text.charCodeAt(this.cursor + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        return (code - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
      }
    }
    return code;
  }

  /** The single ASCII character `ahead` from the cursor, or `null`. */
  peekAscii(ahead = 0): string | null {
    const code = this.peekUnit(ahead);
    return code >= 0 && code <= ASCII_MAX ? this.text[this.cursor + ahead]! : null;
  }

  /**
   * Exact match of a non-empty ASCII `literal` at the cursor (bounded by `end`).
   * ASCII-only so the code-unit compare is identical to a UTF-8 byte compare in
   * a Rust port; a non-ASCII literal is a caller bug.
   */
  startsWith(literal: string): boolean {
    if (literal.length === 0) {
      throw new RangeError('Scanner.startsWith: empty literal');
    }
    if (literal.length > this.remaining) return false;
    for (let i = 0; i < literal.length; i += 1) {
      const lit = literal.charCodeAt(i);
      if (lit > ASCII_MAX) {
        throw new RangeError(`Scanner.startsWith expects an ASCII literal, got ${JSON.stringify(literal)}`);
      }
      if (this.text.charCodeAt(this.cursor + i) !== lit) return false;
    }
    return true;
  }

  // -- consumption -------------------------------------------------------

  /** Advance by `units` (a non-negative integer) code units, clamped to `end`. */
  advance(units = 1): void {
    assertOffset(units, 'advance(units)');
    this.cursor = Math.min(this.cursor + units, this.end);
  }

  /** Consume one scalar value and return it, or `-1` at `end`. */
  next(): number {
    const cp = this.peekCodePoint();
    if (cp < 0) return -1;
    this.cursor += cp > 0xffff ? 2 : 1;
    return cp;
  }

  /** Consume the maximal run of the single ASCII character `ch`; return its length. */
  scanRun(ch: string): number {
    if (ch.length !== 1 || ch.charCodeAt(0) > ASCII_MAX) {
      throw new RangeError(`Scanner.scanRun expects one ASCII character, got ${JSON.stringify(ch)}`);
    }
    const code = ch.charCodeAt(0);
    const from = this.cursor;
    while (this.cursor < this.end && this.text.charCodeAt(this.cursor) === code) {
      this.cursor += 1;
    }
    return this.cursor - from;
  }

  /** Consume code units while `pred` holds; return the count consumed. */
  scanWhile(pred: CodePredicate): number {
    const from = this.cursor;
    while (this.cursor < this.end && pred(this.text.charCodeAt(this.cursor))) {
      this.cursor += 1;
    }
    return this.cursor - from;
  }

  /**
   * Advance until the cursor sits on a unit equal to `code` (not consumed).
   * Returns `true` if found within the slice, `false` if it stopped at `end`.
   */
  scanUntilUnit(code: number): boolean {
    while (this.cursor < this.end) {
      if (this.text.charCodeAt(this.cursor) === code) return true;
      this.cursor += 1;
    }
    return false;
  }

  /**
   * Depth-counted balanced scan. The cursor must sit on an `open` unit. On
   * success the cursor is left just past the matching `close`; on failure it is
   * left at `end` and the method returns `false`. `\` escapes the next unit.
   * `open` and `close` must be distinct — with equal delimiters depth could
   * never return to zero.
   */
  scanBalanced(open: number, close: number): boolean {
    if (open === close) {
      throw new RangeError('Scanner.scanBalanced requires distinct open and close units');
    }
    if (this.peekUnit() !== open) return false;
    let depth = 0;
    while (this.cursor < this.end) {
      const code = this.text.charCodeAt(this.cursor);
      if (code === 0x5c /* backslash */) {
        this.cursor = Math.min(this.cursor + 2, this.end);
        continue;
      }
      this.cursor += 1;
      if (code === open) depth += 1;
      else if (code === close) {
        depth -= 1;
        if (depth === 0) return true;
      }
    }
    return false;
  }
}

// -- shared code-unit predicates -----------------------------------------

export const isAsciiDigit = (code: number): boolean => code >= 0x30 && code <= 0x39;
export const isAsciiLower = (code: number): boolean => code >= 0x61 && code <= 0x7a;
export const isAsciiUpper = (code: number): boolean => code >= 0x41 && code <= 0x5a;
export const isAsciiLetter = (code: number): boolean => isAsciiLower(code) || isAsciiUpper(code);
/** ASCII space or tab. LF/CR are line structure, not inline whitespace. */
export const isAsciiBlank = (code: number): boolean => code === 0x20 || code === 0x09;
/** Identifier grammar `[A-Za-z0-9_-]` shared by block IDs and internal targets. */
export const isIdentifierChar = (code: number): boolean =>
  isAsciiLetter(code) || isAsciiDigit(code) || code === 0x5f || code === 0x2d;
