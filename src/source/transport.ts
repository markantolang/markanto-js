/**
 * Byte-surface transport normalisation (spec §7.4, §10).
 *
 * This is the one place that touches the raw decoded string before any grammar
 * layer sees it. It records what it changed so the strict-mode checker can turn
 * each tolerated deviation into a `noncanonical` diagnostic without re-scanning.
 *
 * Kept as a pure function with a direct Rust analogue: input string in, new
 * string plus a small report out. No cursor, no parser state.
 *
 * Portability: every character this function acts on — U+FEFF, CR, LF — is
 * ASCII/BMP, so the logic ports unchanged. The single forward loop indexes by
 * UTF-16 code unit only because that is how a JS string iterates; a non-BMP
 * character is copied across two iterations. A Rust port iterates bytes or
 * `chars()`. All offsets in the report are in the normalised text in that same
 * UTF-16 code-unit unit.
 *
 * The public **source coordinate space** (docs/PARSER_CONTRACT.md) is the raw
 * input with a leading BOM removed and CRLF/CR preserved. `rawOffsetProjector`
 * maps a normalised parser offset back into that space.
 */

export interface TransportReport {
  /** A single leading U+FEFF was present and stripped (normal mode only). */
  readonly hadBom: boolean;
  /** Number of CRLF pairs collapsed to LF. */
  readonly crlfCount: number;
  /**
   * Normalised-text offsets of every LF that replaced a CRLF pair, ascending.
   * `rawOffsetProjector` uses these to undo the collapse.
   */
  readonly crlfOffsets: readonly number[];
  /**
   * UTF-16 code-unit offsets, into the normalised text, of every lone CR that
   * was rewritten to LF. A lone CR is invalid in both modes; the parser still
   * sees a line break so recovery stays local. A lone CR is a 1:1 rewrite, so
   * it does not shift the raw projection.
   */
  readonly loneCrOffsets: readonly number[];
  /**
   * Count of consecutive LF at the very end of the normalised text. Canonical
   * source ends in exactly one LF, including the empty document (spec §7.4), so
   * any value other than 1 is a noncanonical terminal-newline situation the
   * strict checker reports. `""` has 0, `"\n"` has 1.
   */
  readonly trailingLfCount: number;
  /**
   * UTF-16 code-unit offset of the first unpaired surrogate in the input, or
   * `-1`. Markanto text is Unicode scalar values only (spec §7.4,
   * `docs/INVARIANTS.md`); a lone surrogate is invalid transport in both modes,
   * like a lone CR.
   */
  readonly firstLoneSurrogateOffset: number;
}

/** UTF-16 code-unit offset of the first unpaired surrogate, or -1. */
function firstLoneSurrogate(text: string): number {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { i += 1; continue; }
      return i;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return i;
  }
  return -1;
}

const BOM = 0xfeff;
const CR = 0x0d;
const LF = 0x0a;

function countTrailingLf(text: string): number {
  let count = 0;
  for (let i = text.length - 1; i >= 0 && text.charCodeAt(i) === LF; i -= 1) {
    count += 1;
  }
  return count;
}

/**
 * @param raw decoded source text (already UTF-8 → string by the caller)
 */
export function normalizeTransport(raw: string): {
  readonly text: string;
  readonly report: TransportReport;
} {
  const hadBom = raw.charCodeAt(0) === BOM;
  const body = hadBom ? raw.slice(1) : raw;

  // Fast path: nothing to rewrite.
  if (body.indexOf('\r') === -1) {
    return {
      text: body,
      report: {
        hadBom,
        crlfCount: 0,
        crlfOffsets: [],
        loneCrOffsets: [],
        trailingLfCount: countTrailingLf(body),
        firstLoneSurrogateOffset: firstLoneSurrogate(body),
      },
    };
  }

  // Single forward pass. CRLF → LF, lone CR → LF (recorded).
  let out = '';
  const crlfOffsets: number[] = [];
  const loneCrOffsets: number[] = [];
  for (let i = 0; i < body.length; i += 1) {
    const code = body.charCodeAt(i);
    if (code !== CR) {
      out += body[i];
      continue;
    }
    if (body.charCodeAt(i + 1) === LF) {
      crlfOffsets.push(out.length);
      out += '\n';
      i += 1;
    } else {
      loneCrOffsets.push(out.length);
      out += '\n';
    }
  }

  return {
    text: out,
    report: {
      hadBom,
      crlfCount: crlfOffsets.length,
      crlfOffsets,
      loneCrOffsets,
      trailingLfCount: countTrailingLf(out),
      firstLoneSurrogateOffset: firstLoneSurrogate(out),
    },
  };
}

/**
 * Maps a normalised parser offset back to the public source coordinate space
 * (raw input, BOM removed, CRLF/CR preserved). Each collapsed CRLF strictly
 * before the offset adds one; a BOM adds nothing because it is excluded from
 * both spaces, and a lone CR is a 1:1 rewrite.
 */
export function rawOffsetProjector(
  report: TransportReport,
): (normalizedOffset: number) => number {
  const crlf = report.crlfOffsets;
  if (crlf.length === 0) return (n) => n;
  return (n) => {
    let lo = 0;
    let hi = crlf.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (crlf[mid]! < n) lo = mid + 1;
      else hi = mid;
    }
    return n + lo;
  };
}

/**
 * True when the raw input carried no tolerated transport deviation: no BOM, no
 * CRLF, no lone CR, and exactly one terminal LF. The empty document is not
 * special — its canonical surface is `"\n"` (spec §7.4), so `""` is a
 * noncanonical transport and `"\n"` is canonical.
 */
export function isCanonicalTransport(report: TransportReport): boolean {
  return (
    !report.hadBom &&
    report.crlfCount === 0 &&
    report.loneCrOffsets.length === 0 &&
    report.trailingLfCount === 1
  );
}
