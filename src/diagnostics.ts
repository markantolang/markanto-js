/**
 * Diagnostics: the type + a constructor + an ordered collector.
 *
 * The machine-facing contract is `{ category, severity }` (docs/IMPLEMENTATION.md
 * §12). `code` and `message` are optional implementation text. `resource` is a
 * category, not a severity; resource exhaustion is an operational result that
 * must never be converted into `syntax` / `semantic` invalidity.
 *
 * `range`, when present, is a `Span` (mandatory `line`/`column`/`offset`) in the
 * coordinate space declared by the parser result that carries the diagnostic —
 * the same public raw space as the source-annotation sidecar. Only `ParseResult`
 * diagnostics carry a `range`; formatter and pure-AST-validator diagnostics
 * point at an AST node, not source, and carry none.
 */

import type { Span } from './source/position.js';

export type DiagnosticCategory =
  | 'syntax'
  | 'semantic'
  | 'resource'
  | 'noncanonical'
  | 'advisory';

export type DiagnosticSeverity = 'error' | 'warning';

export interface Diagnostic {
  readonly category: DiagnosticCategory;
  readonly severity: DiagnosticSeverity;
  /** Optional stable implementation/conformance identifier, e.g. M-SYNTAX-001. */
  readonly code?: string;
  /** Human-readable wording is implementation-defined and non-semantic. */
  readonly message?: string;
  /** Source span in the result's declared coordinate space. `ParseResult` only. */
  readonly range?: Span;
}

export interface DiagnosticInit {
  readonly code?: string;
  readonly message?: string;
  readonly range?: Span;
}

export function diagnostic(
  category: DiagnosticCategory,
  severity: DiagnosticSeverity,
  init: DiagnosticInit = {},
): Diagnostic {
  return {
    category,
    severity,
    ...(init.code !== undefined ? { code: init.code } : {}),
    ...(init.message !== undefined ? { message: init.message } : {}),
    ...(init.range !== undefined ? { range: init.range } : {}),
  };
}

/**
 * Ordered, append-only diagnostic collector. Diagnostics keep the order they
 * were reported in; callers do not sort.
 */
export class DiagnosticSink {
  private readonly items: Diagnostic[] = [];

  push(d: Diagnostic): void {
    this.items.push(d);
  }

  report(
    category: DiagnosticCategory,
    severity: DiagnosticSeverity,
    init?: DiagnosticInit,
  ): void {
    this.items.push(diagnostic(category, severity, init));
  }

  syntaxError(init?: DiagnosticInit): void {
    this.report('syntax', 'error', init);
  }

  semanticError(init?: DiagnosticInit): void {
    this.report('semantic', 'error', init);
  }

  noncanonical(init?: DiagnosticInit): void {
    this.report('noncanonical', 'error', init);
  }

  advisory(init?: DiagnosticInit): void {
    this.report('advisory', 'warning', init);
  }

  resource(init?: DiagnosticInit): void {
    this.report('resource', 'error', init);
  }

  get list(): readonly Diagnostic[] {
    return this.items;
  }

  get length(): number {
    return this.items.length;
  }

  hasErrors(): boolean {
    return this.items.some((d) => d.severity === 'error');
  }

  has(category: DiagnosticCategory): boolean {
    return this.items.some((d) => d.category === category);
  }

  /** Detach the collected diagnostics as a plain frozen array copy. */
  drain(): readonly Diagnostic[] {
    return Object.freeze(this.items.slice());
  }
}
