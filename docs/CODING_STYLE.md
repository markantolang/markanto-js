# Coding Style

- Optimize for the next maintainer, not minimum line count.
- Prefer explicit names over abbreviations.
- Functions should normally do one parser operation and have visible cursor flow.
- Keep state local; avoid mutable module globals.
- Prefer `switch` on discriminated unions and exhaustive `never` checks.
- Avoid inheritance for AST/parser behavior.
- Avoid generic frameworks around tiny grammar operations.
- Avoid regex when a five-line scanner is clearer.
- Never hide cursor movement inside surprising getters/coercions.
- Keep allocation visible in hot scanner paths; optimize only after profiling.
- Comments explain grammar rationale/invariants, not obvious code mechanics.
- Error messages are implementation text; diagnostic category/severity are the
  Core machine-facing contract. A diagnostic `code`, once introduced for a
  conformance condition, is stable within that tool's compatibility line but is
  not required on every diagnostic before the catalogue exists.
