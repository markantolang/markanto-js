# Versioned language data

`html-named-character-references-v0.1.0.json` is the exact normative named
HTML character-reference mapping for Markanto 0.1.0. Keys exclude `&` and `;`;
source recognition uses `&NAME;`. The accompanying metadata records its hash
and provenance. Implementations may compile this data into a more efficient
representation, but accepted names and decoded Unicode strings must be
identical.

`unicode-classes-v0.1.0.json` is the normative Unicode 15.1.0 range table for
Markanto's W/S character classes. `word` contains `General_Category=L*` or
`Nd`, plus U+005F LOW LINE; `whitespace` contains `White_Space=Yes`. The pinned
UCD inputs and their SHA-256 metadata live in `unicode-15.1.0/`; regenerate the
table with `node scripts/gen-unicode-tables.mjs`. Implementations may compile
the ranges into another representation, but classification must be identical.
