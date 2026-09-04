/**
 * Minimal ambient type for the vendored Markanto v0.5.3 parser. The migration
 * transform consumes the returned v0.4.0 Document structurally (see
 * `LegacyNode` in `from-v053.ts`), so the full legacy AST types are not needed.
 */
export declare function parse(
  source: string,
  options?: { readonly errorRecovery?: boolean; readonly strict?: boolean },
): {
  readonly type: 'document';
  readonly children: readonly unknown[];
  readonly footnotes?: readonly unknown[];
  readonly meta?: { readonly lang?: string };
};
