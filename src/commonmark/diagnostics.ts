export type ImportDiagnosticCategory =
  | 'normalised'
  | 'resolved'
  | 'source-structure-loss'
  | 'semantic-degradation'
  | 'content-dropped'
  | 'unrepresentable';

export interface ImportLocation {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

export interface ImportDiagnostic {
  readonly category: ImportDiagnosticCategory;
  readonly message: string;
  readonly location: ImportLocation;
}

export interface MdastPoint {
  readonly line: number;
  readonly column: number;
  readonly offset?: number;
}

export interface MdastPosition { readonly start: MdastPoint }

export class DiagnosticCollector {
  readonly #items: Array<ImportDiagnostic & { readonly sequence: number }> = [];
  readonly #project: (point: MdastPoint) => ImportLocation;

  constructor(project: (point: MdastPoint) => ImportLocation = (point) => ({
    line: point.line, column: point.column, offset: point.offset ?? 0,
  })) {
    this.#project = project;
  }

  add(category: ImportDiagnosticCategory, message: string, position?: MdastPosition): void {
    const point = position?.start;
    this.#items.push({
      category,
      message,
      location: point === undefined ? { line: 1, column: 1, offset: 0 } : this.#project(point),
      sequence: this.#items.length,
    });
  }

  ordered(): readonly ImportDiagnostic[] {
    return [...this.#items]
      .sort((left, right) => left.location.offset - right.location.offset || left.sequence - right.sequence)
      .map(({ category, message, location }) => ({ category, message, location }));
  }
}
