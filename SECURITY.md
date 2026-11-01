# Security

## Reporting a vulnerability

Report a vulnerability privately, through GitHub: the repository's **Security** tab, **Report a vulnerability**.
Please do not open a public issue for it. A report is answered within a week; a fix and an advisory follow, crediting
the reporter unless they ask not to be named.

## What the parser guards

A Markanto document may come from a source you do not control:

- parsing and formatting run nothing a document says; there is no raw HTML and no plugin;
- no input crashes the parser or the formatter, or makes parsing take far more than linear time;
- `format` keeps the meaning: `parse(format(ast))` gives the same semantic tree.

A way around any of these is a vulnerability.

Outside this boundary: what a renderer does with the tree. A destination is recorded as written, `javascript:` too;
checking it is the renderer's job (spec §8.1).

## Supported versions

Fixes go into the latest release.
