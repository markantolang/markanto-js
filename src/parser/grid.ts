/**
 * Fenced-container Grid (spec §2.7.7). Deferred commitment: a single forward
 * structural pass over the already-delimited body decides whether it is a Grid
 * (a `::`/`--`/`==` marker outside literal regions) or ordinary content, then
 * partitions slots, resolves `^`/`<` continuations, and validates rectangle
 * geometry. `^` and `<` alone never trigger Grid mode.
 */
import type { Grid, GridCell, GridRow, NonEmptyArray, ResourceBudget } from '../ast.js';
import { DEFAULT_MAX_MATRIX_SLOTS, HARD_MAX_MATRIX_SLOTS } from '../ast.js';
import type { SourceAnnotationBuilder } from '../parser-contract.js';
import type { PhysicalLine } from '../source/index.js';
import { leadingSpaces, onlyAsciiBlank, runLength } from './blocks.js';

type LiteralRegion =
  | { kind: 'fence'; char: number; length: number }
  | { kind: 'comment' }
  | { kind: 'code'; length: number };
type Marker = '::' | '==' | '--' | '^' | '<';

export function codeFenceOpener(text: string, line: PhysicalLine): { char: number; length: number } | null {
  const indent = leadingSpaces(text, line);
  if (indent > 3) return null;
  const start = line.start + indent;
  const code = text.charCodeAt(start);
  if (code !== 0x60 && code !== 0x7e) return null;
  const length = runLength(text, start, code, line.contentEnd);
  if (length < 3) return null;
  // A backtick fence's info token may not contain a backtick (spec §2.4); with
  // one, the line is a paragraph whose leading run opens an inline code span.
  if (code === 0x60) {
    for (let index = start + length; index < line.contentEnd; index += 1) {
      if (text.charCodeAt(index) === 0x60) return null;
    }
  }
  return { char: code, length };
}

export function codeFenceCloser(text: string, line: PhysicalLine, char: number, length: number): boolean {
  const indent = leadingSpaces(text, line);
  if (indent > 3) return false;
  const start = line.start + indent;
  const run = runLength(text, start, char, line.contentEnd);
  return run >= length && onlyAsciiBlank(text, start + run, line.contentEnd);
}

export function commentContentStart(text: string, line: PhysicalLine): number {
  const indent = leadingSpaces(text, line);
  if (indent > 3) return -1;
  if (!text.startsWith('<!--', line.start + indent)) return -1;
  return line.start + indent + 4;
}

export function commentClosesOnLine(text: string, line: PhysicalLine, searchStart: number): boolean {
  const closer = text.indexOf('-->', searchStart);
  return closer >= 0 && closer + 3 <= line.contentEnd;
}

/**
 * Backtick-run length left open by an inline code span at the end of
 * `text[start, end)`, given `open` (0 = none) carried in from earlier lines.
 * Mirrors the inline scanner's code-span pairing (§10.9): a run of length N
 * opens, the next run of exactly N closes, other runs inside are content, and a
 * backslash escapes the following character only *outside* a span. Inline code
 * may cross a soft break, so an open span makes a physical `::`/`--`/`==` line
 * inside it ordinary content, not a Grid marker (§2.7.7 "inside code … remains
 * content"). This is one forward pass — no second parse of the slice.
 */
export function inlineCodeStateAfter(text: string, start: number, end: number, open: number): number {
  let cursor = start;
  let run = open;
  while (cursor < end) {
    const code = text.charCodeAt(cursor);
    if (code === 0x5c && run === 0) { cursor += 2; continue; }
    if (code !== 0x60) { cursor += 1; continue; }
    let runEnd = cursor;
    while (runEnd < end && text.charCodeAt(runEnd) === 0x60) runEnd += 1;
    const length = runEnd - cursor;
    if (run === 0) run = length;
    else if (length === run) run = 0;
    cursor = runEnd;
  }
  return run;
}

/** A Grid marker line at the Grid baseline, or null. */
/**
 * Occupancy-matrix slot count for one Grid — `columns × (header + body rows)`.
 * This is the transient rectangle the parser, validator, and formatter each
 * allocate to resolve `^`/`<` spans; `ResourceBudget.maxMatrixSlots` bounds it.
 *
 * A `columns` that is not a finite value at or below `Number.MAX_SAFE_INTEGER`
 * cannot describe a real Grid and must never reach an `Array` allocation, so it
 * counts as an unbounded (`Infinity`) matrix — every caller then converts it to
 * a `resource` result. A finite-but-malformed `columns` (negative, fractional)
 * multiplies through small and is left for the shape / geometry checks to
 * reject as `invalid`.
 */
export function gridSlotCount(grid: Grid): number {
  const columns = grid.columns as unknown;
  if (typeof columns !== 'number' || !Number.isFinite(columns) || columns > Number.MAX_SAFE_INTEGER) {
    return Number.POSITIVE_INFINITY;
  }
  return columns * ((grid.header?.length ?? 0) + grid.rows.length);
}

/** Largest Grid occupancy matrix anywhere in the document (0 when there is none). */
export function maxGridSlots(document: { children: readonly unknown[]; footnotes: readonly unknown[] }): number {
  let maximum = 0;
  const stack: unknown[] = [...document.children, ...document.footnotes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    const record = node as Record<string, unknown>;
    if (record['type'] === 'grid') {
      const slots = gridSlotCount(record as unknown as Grid);
      if (slots > maximum) maximum = slots;
    }
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) for (const child of value) if (child !== null && typeof child === 'object') stack.push(child);
      else if (value !== null && typeof value === 'object') stack.push(value);
    }
  }
  return maximum;
}

/**
 * The single matrix-budget gate shared by `parse`, `validate`, and `format` so
 * the three paths cannot drift to different effective limits (spec §7.5). True
 * when some Grid in `document` would need a larger occupancy matrix than the
 * caller may have. The result is resource exhaustion, never invalidity.
 *
 * Two limits, kept apart on purpose:
 *
 * - {@link HARD_MAX_MATRIX_SLOTS} is an implementation ceiling the caller cannot
 *   lift. A matrix past it — including one whose slot count is not a usable
 *   finite number — never reaches an `Array` allocation.
 * - {@link DEFAULT_MAX_MATRIX_SLOTS} is the normal policy. A caller's
 *   `maxMatrixSlots` may raise it (up to, never past, the hard ceiling) or lower
 *   it. An unusable budget value (NaN, Infinity, negative, non-number) is
 *   ignored — it falls back to the default, it never disables the gate.
 */
export function exceedsGridMatrixBudget(
  document: { children: readonly unknown[]; footnotes: readonly unknown[] },
  budget: ResourceBudget | undefined,
): boolean {
  const slots = maxGridSlots(document);
  if (!Number.isFinite(slots) || slots > HARD_MAX_MATRIX_SLOTS) return true;
  const requested = budget?.maxMatrixSlots;
  const callerLimit =
    typeof requested === 'number' && Number.isFinite(requested) && requested >= 0
      ? Math.min(requested, HARD_MAX_MATRIX_SLOTS)
      : DEFAULT_MAX_MATRIX_SLOTS;
  return slots > callerLimit;
}

export function gridMarkerKind(text: string, line: PhysicalLine): Marker | null {
  if (leadingSpaces(text, line) !== 0) return null;
  const start = line.start;
  if (line.contentEnd - start >= 2) {
    const c0 = text.charCodeAt(start);
    const c1 = text.charCodeAt(start + 1);
    if (c0 === 0x3a && c1 === 0x3a && onlyAsciiBlank(text, start + 2, line.contentEnd)) return '::';
    if (c0 === 0x3d && c1 === 0x3d && onlyAsciiBlank(text, start + 2, line.contentEnd)) return '==';
    if (c0 === 0x2d && c1 === 0x2d && onlyAsciiBlank(text, start + 2, line.contentEnd)) return '--';
  }
  if (line.contentEnd - start >= 1) {
    const c0 = text.charCodeAt(start);
    if (c0 === 0x5e && onlyAsciiBlank(text, start + 1, line.contentEnd)) return '^';
    if (c0 === 0x3c && onlyAsciiBlank(text, start + 1, line.contentEnd)) return '<';
  }
  return null;
}

export type BodyStep =
  | { readonly type: 'content'; readonly cell: GridCell }
  | { readonly type: 'skip' };

export type GridParseResult =
  | { readonly kind: 'ordinary' }
  | { readonly kind: 'error'; readonly message: string; readonly category: 'syntax' | 'semantic' }
  | { readonly kind: 'grid'; readonly grid: Grid; readonly steps: BodyStep[]; readonly nodeCount: number };

interface Slot {
  readonly kind: 'content' | 'continuation';
  readonly marker: '^' | '<' | null;
  /** Content lines for a content slot; the marker line for a continuation slot. */
  readonly lines: PhysicalLine[];
}

type Event =
  | { readonly kind: 'separator'; readonly marker: '::' | '==' | '--' }
  | { readonly kind: 'continuation'; readonly marker: '^' | '<'; readonly line: PhysicalLine }
  | { readonly kind: 'content'; readonly lines: PhysicalLine[] };

export function parseGridBody(
  bodyLines: readonly PhysicalLine[],
  text: string,
  annotations: SourceAnnotationBuilder,
): GridParseResult {
  if (bodyLines.length === 0) return { kind: 'ordinary' };

  const partition = partitionBody(bodyLines, text);
  if (!partition.isGrid) return { kind: 'ordinary' };

  const derived = deriveRows(partition.events);
  if ('error' in derived) return { kind: 'error', message: derived.error, category: derived.category };

  const { headerSlots, bodySlots } = derived;
  const allRows = [...headerSlots, ...bodySlots];
  const columns = allRows[0]!.length;
  for (const row of allRows) {
    if (row.length !== columns) return { kind: 'error', message: 'ragged grid', category: 'semantic' };
    for (const slot of row) {
      if (slot.kind === 'content' && slot.lines.length === 0) {
        return { kind: 'error', message: 'empty grid cell', category: 'semantic' };
      }
    }
  }
  const hasHeader = headerSlots.length > 0;
  if (!hasHeader && columns === 1 && bodySlots.length === 1) {
    return { kind: 'error', message: 'headerless 1x1 grid', category: 'semantic' };
  }

  const headerResolution = hasHeader ? resolveRegion(headerSlots, columns) : null;
  if (headerResolution !== null && 'error' in headerResolution) {
    return { kind: 'error', message: headerResolution.error, category: 'semantic' };
  }
  const bodyResolution = resolveRegion(bodySlots, columns);
  if ('error' in bodyResolution) return { kind: 'error', message: bodyResolution.error, category: 'semantic' };

  const headerRows = headerResolution === null ? [] : headerResolution.gridRows;
  const bodyRows = bodyResolution.gridRows;
  const grid: Grid = {
    type: 'grid',
    columns,
    ...(hasHeader ? { header: headerRows as NonEmptyArray<GridRow> } : {}),
    rows: bodyRows as NonEmptyArray<GridRow>,
  };
  const gridStart = bodyLines[0]!.start;
  const gridEnd = bodyLines[bodyLines.length - 1]!.contentEnd;
  annotations.set(grid, gridStart, gridEnd);

  const orderedCells = [
    ...(headerResolution === null ? [] : headerResolution.ordered),
    ...bodyResolution.ordered,
  ];
  for (const { cell, lines } of orderedCells) {
    annotations.set(cell, lines[0]!.start, lines[lines.length - 1]!.contentEnd);
  }
  annotateRows(headerResolution === null ? [] : headerResolution.gridRows, headerSlots, annotations);
  annotateRows(bodyResolution.gridRows, bodySlots, annotations);

  let cellIndex = 0;
  const steps: BodyStep[] = [];
  for (const event of partition.events) {
    if (event.kind === 'content' && event.lines.length > 0) {
      steps.push({ type: 'content', cell: orderedCells[cellIndex]!.cell });
      cellIndex += 1;
    } else {
      steps.push({ type: 'skip' });
    }
  }

  const rowCount = allRows.length;
  const cellCount = orderedCells.length;
  return { kind: 'grid', grid, steps, nodeCount: 1 + rowCount + cellCount };
}

function annotateRows(rows: readonly GridRow[], slots: readonly Slot[][], annotations: SourceAnnotationBuilder): void {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const rowSlots = slots[index]!;
    const first = rowSlots[0]!.lines[0]!;
    const lastSlot = rowSlots[rowSlots.length - 1]!;
    const last = lastSlot.lines[lastSlot.lines.length - 1]!;
    annotations.set(row, first.start, last.contentEnd);
  }
}

interface PartitionResult { readonly isGrid: boolean; readonly events: Event[] }

function partitionBody(bodyLines: readonly PhysicalLine[], text: string): PartitionResult {
  const events: Event[] = [];
  let literal: LiteralRegion | null = null;
  let currentLines: PhysicalLine[] = [];
  let pendingContinuation: '^' | '<' | null = null;
  let pendingContinuationLine: PhysicalLine | null = null;
  let sawTrigger = false;
  let slotOpenedBySeparator = false;
  let lastSeparator: '::' | '==' | '--' | null = null;

  const flushSlot = (includeEmpty = false): void => {
    if (pendingContinuation !== null) {
      events.push({ kind: 'continuation', marker: pendingContinuation, line: pendingContinuationLine! });
      pendingContinuation = null;
      pendingContinuationLine = null;
    } else if (currentLines.length > 0 || includeEmpty) {
      events.push({ kind: 'content', lines: currentLines });
      currentLines = [];
    }
  };
  const demoteContinuation = (): void => {
    if (pendingContinuation !== null) {
      currentLines.push(pendingContinuationLine!);
      pendingContinuation = null;
      pendingContinuationLine = null;
    }
  };

  for (const line of bodyLines) {
    if (literal !== null) {
      if (literal.kind === 'fence') {
        if (codeFenceCloser(text, line, literal.char, literal.length)) literal = null;
      } else if (literal.kind === 'comment') {
        if (commentClosesOnLine(text, line, line.start)) literal = null;
      } else if (inlineCodeStateAfter(text, line.start, line.contentEnd, literal.length) === 0) {
        literal = null;
      }
      demoteContinuation();
      currentLines.push(line);
      continue;
    }
    const fence = codeFenceOpener(text, line);
    if (fence !== null) {
      literal = { kind: 'fence', char: fence.char, length: fence.length };
      demoteContinuation();
      currentLines.push(line);
      continue;
    }
    const commentStart = commentContentStart(text, line);
    if (commentStart >= 0) {
      literal = { kind: 'comment' };
      if (commentClosesOnLine(text, line, commentStart)) literal = null;
      demoteContinuation();
      currentLines.push(line);
      continue;
    }
    // A multi-line inline code span opened on this line keeps a following
    // `::`/`--`/`==` line as content until it closes (§2.7.7, §10.9).
    const codeOpen = inlineCodeStateAfter(text, line.start, line.contentEnd, 0);
    if (codeOpen > 0) {
      literal = { kind: 'code', length: codeOpen };
      demoteContinuation();
      currentLines.push(line);
      continue;
    }
    const marker = gridMarkerKind(text, line);
    if (marker === null) {
      demoteContinuation();
      currentLines.push(line);
      slotOpenedBySeparator = false;
      continue;
    }
    if (marker === '^' || marker === '<') {
      if (currentLines.length === 0 && pendingContinuation === null) {
        pendingContinuation = marker;
        pendingContinuationLine = line;
        slotOpenedBySeparator = false;
      } else {
        demoteContinuation();
        currentLines.push(line);
      }
      continue;
    }
    sawTrigger = true;
    // A structural separator closes a slot even when that slot is empty. The
    // semantic grid validation below must see (and reject) that empty cell.
    // A leading `::` remains the distinct syntax error "empty grid header".
    flushSlot(marker !== '::' || events.length > 0);
    events.push({ kind: 'separator', marker });
    slotOpenedBySeparator = true;
    lastSeparator = marker;
  }
  flushSlot(slotOpenedBySeparator && lastSeparator !== '::');

  return { isGrid: sawTrigger, events };
}

interface DerivedRows { readonly headerSlots: Slot[][]; readonly bodySlots: Slot[][] }
type DerivedResult = { readonly error: string; readonly category: 'syntax' } | DerivedRows;

function deriveRows(events: readonly Event[]): DerivedResult {
  const rows: Slot[][] = [];
  let currentRow: Slot[] = [];
  let headerSeparatorIndex: number | null = null;
  let sawColon = false;
  let headerHasSlot = false;
  let bodyHasSlot = false;

  const pushSlot = (slot: Slot): void => {
    currentRow.push(slot);
    if (headerSeparatorIndex === null) headerHasSlot = true;
    else bodyHasSlot = true;
  };
  const endRow = (): void => {
    rows.push(currentRow);
    currentRow = [];
  };

  for (const event of events) {
    if (event.kind === 'separator') {
      if (event.marker === '::') {
        if (sawColon) return { error: 'duplicate grid header separator', category: 'syntax' };
        sawColon = true;
        endRow();
        headerSeparatorIndex = rows.length;
      } else if (event.marker === '==') {
        endRow();
      }
    } else if (event.kind === 'continuation') {
      pushSlot({ kind: 'continuation', marker: event.marker, lines: [event.line] });
    } else {
      pushSlot({ kind: 'content', marker: null, lines: event.lines });
    }
  }
  endRow();

  const headerSlots = sawColon ? rows.slice(0, headerSeparatorIndex!) : [];
  const bodySlots = sawColon ? rows.slice(headerSeparatorIndex!) : rows;

  if (sawColon) {
    if (!headerHasSlot) return { error: 'empty grid header', category: 'syntax' };
    if (!bodyHasSlot) return { error: 'empty grid body', category: 'syntax' };
  }
  return { headerSlots, bodySlots };
}

interface ResolvedRegion {
  readonly gridRows: GridRow[];
  readonly ordered: Array<{ readonly cell: GridCell; readonly lines: PhysicalLine[] }>;
}

function resolveRegion(rows: readonly Slot[][], columns: number): ResolvedRegion | { readonly error: string } {
  const owner: Array<Array<{ ar: number; ac: number } | null>> = rows.map(() =>
    Array.from({ length: columns }, () => null),
  );
  const anchors = new Map<string, { ar: number; ac: number; cell: GridCell }>();
  const order: Array<{ ar: number; ac: number }> = [];
  const key = (r: number, c: number): string => `${r},${c}`;

  for (let r = 0; r < rows.length; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const slot = rows[r]![c]!;
      if (slot.kind === 'continuation') {
        if (slot.marker === '^') {
          if (r === 0) return { error: 'rowspan in first row' };
          const above = owner[r - 1]![c] ?? null;
          if (above === null) return { error: 'rowspan with missing neighbour' };
          owner[r]![c] = above;
        } else {
          if (c === 0) return { error: 'colspan in first column' };
          const left = owner[r]![c - 1] ?? null;
          if (left === null) return { error: 'colspan with missing neighbour' };
          owner[r]![c] = left;
        }
      } else {
        const cell: GridCell = { type: 'gridCell', column: c + 1, children: [] as unknown as GridCell['children'] };
        anchors.set(key(r, c), { ar: r, ac: c, cell });
        order.push({ ar: r, ac: c });
        owner[r]![c] = { ar: r, ac: c };
      }
    }
  }

  const minR = new Map<string, number>();
  const maxR = new Map<string, number>();
  const minC = new Map<string, number>();
  const maxC = new Map<string, number>();
  const count = new Map<string, number>();
  for (let r = 0; r < rows.length; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const o = owner[r]![c]!;
      const k = key(o.ar, o.ac);
      count.set(k, (count.get(k) ?? 0) + 1);
      minR.set(k, Math.min(minR.get(k) ?? r, r));
      maxR.set(k, Math.max(maxR.get(k) ?? r, r));
      minC.set(k, Math.min(minC.get(k) ?? c, c));
      maxC.set(k, Math.max(maxC.get(k) ?? c, c));
    }
  }
  for (const [k, anchor] of anchors) {
    const area = (maxR.get(k)! - minR.get(k)! + 1) * (maxC.get(k)! - minC.get(k)! + 1);
    if (count.get(k)! !== area) return { error: 'non-rectangular grid span' };
    const rowSpan = maxR.get(k)! - minR.get(k)! + 1;
    const colSpan = maxC.get(k)! - minC.get(k)! + 1;
    if (rowSpan >= 2) anchor.cell.rowSpan = rowSpan;
    if (colSpan >= 2) anchor.cell.colSpan = colSpan;
  }

  const gridRows: GridRow[] = rows.map((_, r) => ({
    type: 'gridRow',
    cells: order.filter((o) => o.ar === r).map((o) => anchors.get(key(o.ar, o.ac))!.cell),
  }));
  const ordered = order.map((o) => ({
    cell: anchors.get(key(o.ar, o.ac))!.cell,
    lines: rows[o.ar]![o.ac]!.lines,
  }));
  return { gridRows, ordered };
}
