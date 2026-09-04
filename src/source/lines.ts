/**
 * Physical line layer.
 *
 * Exposes the normalised source as physical lines described by offsets, without
 * copying line text until a caller asks for it. The structural layer (Phase 3+)
 * derives the logical-line view — outer indentation, list-child indentation,
 * quote prefix/depth — on top of this; that is deliberately not here yet.
 *
 * A tiny explicit lookahead buffer (`current` + `peekNext`) supports typed
 * lined-container confirmation, lined-opener blank-line handling, and table
 * header/separator confirmation. It is not a general backtracking buffer.
 */

export interface PhysicalLine {
  /** 1-based line number. */
  readonly number: number;
  /** Code-unit offset of the first character of the line. */
  readonly start: number;
  /** Code-unit offset just past the line content, before any terminator. */
  readonly contentEnd: number;
  /** Code-unit offset just past the line terminator (== next line `start`). */
  readonly end: number;
  /** True when the line was terminated by an LF (false only for a final line without one). */
  readonly terminated: boolean;
}

export class LineReader {
  private readonly lines: readonly PhysicalLine[];
  private index = 0;

  constructor(private readonly text: string) {
    const lines: PhysicalLine[] = [];
    let start = 0;
    let number = 1;
    for (let i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) === 0x0a) {
        lines.push({ number, start, contentEnd: i, end: i + 1, terminated: true });
        start = i + 1;
        number += 1;
      }
    }
    if (start < text.length) {
      lines.push({ number, start, contentEnd: text.length, end: text.length, terminated: false });
    }
    this.lines = lines;
  }

  get lineCount(): number {
    return this.lines.length;
  }

  get atEnd(): boolean {
    return this.index >= this.lines.length;
  }

  /** The line the reader is positioned on, or `null` at end. */
  get current(): PhysicalLine | null {
    return this.lines[this.index] ?? null;
  }

  /**
   * Bounded lookahead: the line `ahead` (a non-negative integer) positions on,
   * without advancing. `ahead` of 0 is the current line. Negative lookahead is
   * rejected rather than silently reaching already-consumed lines.
   */
  peek(ahead = 1): PhysicalLine | null {
    if (!Number.isInteger(ahead) || ahead < 0) {
      throw new RangeError(`LineReader.peek: ahead must be a non-negative integer, got ${ahead}`);
    }
    return this.lines[this.index + ahead] ?? null;
  }

  /** Advance past `current`; returns the line advanced over, or `null` at end. */
  advance(): PhysicalLine | null {
    const line = this.lines[this.index] ?? null;
    if (line !== null) this.index += 1;
    return line;
  }

  /** Line content without its terminator. Allocates. */
  contentOf(line: PhysicalLine): string {
    return this.text.slice(line.start, line.contentEnd);
  }

  /** True when the line has no content before its terminator. */
  isBlank(line: PhysicalLine): boolean {
    return line.contentEnd === line.start;
  }

  /** True when the line is empty or only ASCII spaces/tabs. */
  isWhitespaceOnly(line: PhysicalLine): boolean {
    for (let i = line.start; i < line.contentEnd; i += 1) {
      const code = this.text.charCodeAt(i);
      if (code !== 0x20 && code !== 0x09) return false;
    }
    return true;
  }
}
