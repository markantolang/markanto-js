export type MigrationDiagnosticCategory =
  | 'mapped' // a construct was rewritten to its 0.1.0 form
  | 'dropped' // an obsolete field/node with no 0.1.0 meaning was removed
  | 'unrepresentable' // no canonical 0.1.0 form; preserved locally or removed
  | 'review'; // a meaning-changing rewrite a human must confirm

export interface MigrationLocation {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

export interface MigrationDiagnostic {
  readonly category: MigrationDiagnosticCategory;
  readonly message: string;
  readonly location: MigrationLocation;
}

/** The `{ start: { offset, line, column } }` shape of a legacy AST `range`. */
export interface LegacyRange {
  readonly start: { readonly offset: number; readonly line: number; readonly column: number };
}

export class DiagnosticCollector {
  readonly #items: Array<MigrationDiagnostic & { readonly sequence: number }> = [];

  add(category: MigrationDiagnosticCategory, message: string, range?: LegacyRange): void {
    const point = range?.start;
    this.#items.push({
      category,
      message,
      location: point === undefined
        ? { line: 1, column: 1, offset: 0 }
        : { line: point.line, column: point.column, offset: point.offset },
      sequence: this.#items.length,
    });
  }

  ordered(): readonly MigrationDiagnostic[] {
    return [...this.#items]
      .sort((left, right) => left.location.offset - right.location.offset || left.sequence - right.sequence)
      .map(({ category, message, location }) => ({ category, message, location }));
  }
}
