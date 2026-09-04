import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

import { format, parse } from '../index.js';
import { DiagnosticCollector, type ImportDiagnostic, type ImportLocation, type MdastPoint } from './diagnostics.js';
import { documentFromMdast } from './from-mdast.js';

export type { ImportDiagnostic, ImportDiagnosticCategory } from './diagnostics.js';

export interface ImportOptions {
  /** how to handle raw HTML blocks and raw inline HTML; default 'drop' */
  readonly rawHtml?: 'drop' | 'escape';
}

export interface ImportResult {
  readonly markanto: string;
  readonly diagnostics: readonly ImportDiagnostic[];
}

export function importCommonMark(source: string, options: ImportOptions = {}): ImportResult {
  const transport = normalizeTransport(source);
  const root = fromMarkdown(transport.source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const diagnostics = new DiagnosticCollector((point) => transport.project(point));
  const document = documentFromMdast(root, transport.source, { rawHtml: options.rawHtml ?? 'drop' }, diagnostics);
  const formatted = format(document);
  if (formatted.status === 'ok' && canonicalOutput(formatted.source)) {
    return { markanto: formatted.source, diagnostics: diagnostics.ordered() };
  }
  // Core is deliberately frozen for this phase. If an otherwise valid mdast
  // combination has no byte-stable Core surface, removal is the only
  // non-guessing recovery allowed by the import contract.
  diagnostics.add('unrepresentable', 'document contains a CommonMark combination with no canonical Markanto form and was dropped');
  const empty = format({ type: 'document', children: [], footnotes: [] });
  return { markanto: empty.status === 'ok' ? empty.source : '\n', diagnostics: diagnostics.ordered() };
}

function canonicalOutput(source: string): boolean {
  const parsed = parse(source, { strict: true });
  if (parsed.status !== 'ok') return false;
  const reformatted = format(parsed.document);
  return reformatted.status === 'ok' && reformatted.source === source;
}

interface NormalizedTransport {
  readonly source: string;
  readonly project: (point: MdastPoint) => ImportLocation;
}

function normalizeTransport(raw: string): NormalizedTransport {
  let normalized = '';
  const rawOffsets: number[] = [];
  let rawIndex = raw.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (rawIndex < raw.length) {
    rawOffsets.push(rawIndex);
    const code = raw.charCodeAt(rawIndex);
    if (code === 0x0d) {
      normalized += '\n';
      rawIndex += raw.charCodeAt(rawIndex + 1) === 0x0a ? 2 : 1;
    } else {
      normalized += raw[rawIndex]!;
      rawIndex += 1;
    }
  }
  rawOffsets.push(rawIndex);
  return {
    source: normalized,
    project(point): ImportLocation {
      const offset = rawOffsets[point.offset ?? 0] ?? rawIndex;
      const prefix = raw.slice(0, offset);
      const lines = prefix.split(/\r\n|\r|\n/u);
      return { line: lines.length, column: [...(lines.at(-1) ?? '')].length + 1, offset };
    },
  };
}
