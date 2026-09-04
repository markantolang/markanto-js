# Markanto — Specification

Version: 0.1.0
Status: frozen — the normative specification for the Markanto 0.1.0 language
line. It does not change; later versions may evolve the language, and there
is no 1.0 compatibility freeze yet.
Language: English (normative edition).

---

Markanto is a Markdown variant that reads familiar Markdown tolerantly,
models it in a strict semantic AST, and serialises it canonically. Meaning
must travel with the document: external parser profiles must not change the
semantic interpretation of otherwise identical source text.

This document is normative for Markanto 0.1.0. Historical design notes and
pre-0.1 experiments are non-normative.

## Reserved wrapper tags

Markanto reserves exactly **three** wrapper tags. They are Markanto syntax,
not a general raw-HTML passthrough.

| Tag | Role | Semantic mapping |
| --- | --- | --- |
| `<m>` | metadata/resource wrapper | metadata span, image metadata, video, audio, embed, download |
| `<i>` | emphasis fallback | `Em` |
| `<b>` | strong-emphasis fallback | `Strong` |

The mnemonic **MIB** names the complete reserved wrapper vocabulary:
`<m>`, `<i>`, `<b>`.

`<i>` and `<b>` are serialization escape hatches, not replacements for
ordinary Markdown emphasis. Canonical output uses `*em*` and `**strong**`
whenever those forms round-trip safely.

## 1. Core principles

- **Read tolerantly, model strictly, serialise canonically.** Normal mode may
  accept explicitly documented, unambiguous Markdown variants; strict mode
  accepts only canonical Markanto.
- **Meaning travels with the file.** No external parser option may change the
  semantic AST of identical Markanto source.
- A line-oriented state machine is the parser model.
- Blank lines carry mandatory semantics only where they separate paragraphs
  or embedded block sequences. An unambiguously marked block start may
  follow without a preceding blank line in normal mode; the formatter
  restores canonical separation.
- Explicit over implicit: no lazy continuation except where explicitly
  defined.
- The canonical form is part of the language: the formatter produces one
  representation for a given semantic AST, except where the source register
  itself is semantic (notably lined vs. fenced containers).
- No inline HTML and no raw HTML. The three reserved MIB wrappers are
  self-contained Markanto constructs and do not open an HTML passthrough.
- Presentation-specific source attributes such as `style`, `class`, `width`,
  and `height` are not Markanto Core semantics.
- Conceptual integrity is a guiding principle.
- **Recommended file extension: `.md`.**

### 1.1 Normative Markdown baseline

Markanto 0.1.0 uses **CommonMark 0.31.2 (2024-01-28)** as its normative
Markdown baseline for Markdown constructs that this specification retains.
The baseline is fixed to that version; a later CommonMark release does not
silently change Markanto 0.1.0.

Normative reference: <https://spec.commonmark.org/0.31.2/>.

Where Markanto defines different recognition, validation, semantics, AST
mapping, or canonicalisation rules, **this specification takes precedence**.
The Markanto block and inline inventories are closed: a CommonMark construct
is not automatically part of Markanto merely because it exists in the
baseline. CommonMark supplies the underlying grammar only where Markanto
explicitly retains or delegates to that construct, notably direct Markdown
links and images and their destination/title syntax.

This makes Markanto a deliberate delta over a stable Markdown baseline rather
than a copy of the complete CommonMark grammar.

For explicitly retained GitHub Flavored Markdown extensions, Markanto 0.1.0
uses **GFM 0.29-gfm (2019-04-06)** as a fixed extension baseline. This applies
only where Markanto explicitly retains a GFM extension, notably pipe tables and
task-list markers; GFM does not replace the CommonMark 0.31.2 baseline above.
A later GFM release likewise does not silently change Markanto 0.1.0.

Normative GFM reference: <https://github.github.io/gfm/>.

For Core operations whose result depends on Unicode character properties or
normalisation data, Markanto 0.1.0 fixes **Unicode 15.1.0**. A conforming
implementation must not let a newer or older runtime Unicode database silently
change Core recognition, NFC-normalised AST values, or canonical output.

### 1.2 Principal CommonMark/GFM delta

The following table is normative but not exhaustive; the detailed Markanto
chapters remain authoritative. Entries marked GFM refer specifically to the
fixed 0.29-gfm extension baseline. `docs/COMMONMARK_DIVERGENCE.md` is the
expanded, non-normative companion: it pairs every row below with the
conformance-harness expectation and must be updated in the same change as this
table.

| Baseline construct | Markanto 0.1.0 |
| --- | --- |
| tabs | retained as literal / inline content; the CommonMark contextual tab expansion is narrowed — tabs are not permitted in list / container structural indentation |
| backslash escapes | retained in ordinary inline content and in the delegated direct-link destination / title and fence-info fields; literal contexts keep the backslash (see 10.4, 10.5.1) |
| ATX headings | retained; Markanto canonical rules apply; an empty heading is a syntax error |
| Setext headings | not recognised — a committed `text\n===` / `text\n---` candidate is a diagnostic; the import path (16) may convert one to ATX |
| thematic breaks | retained, but `_` form excluded; `---` canonical; malformed delimiter-looking paragraph text follows the normal-mode literal-delimiter fallback rule |
| indented code blocks | excluded; fenced code blocks only; a 4-space-indented line is not an indented-code construct. When a new block's first line carries four or more leading spaces — the surface CommonMark reads as indented code — normal mode keeps the prose and drops the indentation, but emits an **advisory** diagnostic so the discarded surface is not silent; strict mode rejects it as noncanonical. The import path (16) rewrites real indented code to a fenced block |
| fenced code blocks | retained with Markanto canonicalisation |
| HTML blocks / raw inline HTML | excluded |
| HTML comments | retained only as the dedicated `CommentBlock` syntax in 2.4.1; visible text after `-->` on the closing line is a syntax error |
| block quotes | retained with explicit prefix on every belonging line; lazy continuation excluded |
| CommonMark lists | retained with Markanto list, indentation, and recursion rules |
| GFM task-list markers | retained with Markanto canonicalisation |
| GFM pipe tables | retained with Markanto table and canonicalisation rules |
| GFM strikethrough | retained as `Deletion`; `~~…~~` may preserve a `SoftBreak` in multiline-capable block content, but not a `HardBreak` |
| inline links/images | retained; label/alt may preserve a `SoftBreak` in multiline-capable block content, while destination/title remain line-local; the other Markanto context restrictions continue to apply |
| reference-style links/images and link-reference definitions | excluded from recognition; `[text][label]`, `[text][]`, `[text]`, and a `[label]: target` line are ordinary text, never an error and never silently promoted to a link; only direct parenthesised forms are canonical; the CommonMark import path (16) resolves them |
| emphasis/strong | retained but Markanto delimiter and canonical fallback rules apply |
| multiline inline constructs | partly retained: `Em` / `Strong` (including `<i>`/`<b>`), generic `<m>`, direct-link label/image alt, and `Deletion` preserve `SoftBreak`; inline-code line endings collapse to spaces. `HardBreak`, single-line owning contexts, `Obsolete` / `Insert` / `Mark`, and `Sup` / `Sub` remain excluded |
| hard/soft breaks | retained with Markanto's single semantic line-break model and canonical trailing `\\` hard break |
| autolinks | replaced/extended by chapter 13 |

A CommonMark import operation (chapter 16) is a distinct pipeline stage, not a
Markanto parser mode. It may accept baseline constructs that ordinary Markanto
parsing does not recognise — lazy continuation, reference-style links and their
definitions, Setext headings, indented code, `_` thematic breaks — and rewrite
them into representable canonical Markanto or report a conversion diagnostic. The
Markanto parser itself never performs this resolution: a construct that Markanto
does not recognise is either ordinary text (where that is harmless, such as an
unresolved `[text][label]`) or a diagnostic, never a silent reinterpretation.

### 1.3 Evolution and extension invariants

The following rules protect the long-term meaning of stored Markanto source:

- Container `TYPE` is **opaque author vocabulary**. Core assigns no semantics
  to a spelling merely because it is commonly used, and a future Markanto
  version must not retroactively reserve an existing valid TYPE spelling to
  change the meaning of old documents.
- `data-*` attributes are application/private annotations. They **must not be
  required to recover Markanto Core meaning**. A document remains Core-
  interpretable when an implementation does not understand a particular
  `data-*` annotation.
- Core validity must not depend on mutable external registries. In particular,
  `lang` is validated for well-formed BCP 47 syntax; registry knowledge may
  produce tooling warnings but not Core syntax errors. Language tags are
  ASCII-lowercased before semantic AST storage and comparison, yielding one
  registry-independent canonical spelling.
- Source ranges, diagnostics, parser-recovery records, renderer hints, and
  similar implementation metadata are non-semantic annotations. They are
  ignored when comparing semantic ASTs.

### 1.4 EBNF metasyntax

The grammar fragments in this specification use the following ISO 14977-style
metasyntax throughout:

```text
"…"       literal
A , B     sequence
A | B     alternative
[ A ]     optional
{ A }     zero or more repetitions
( A )     grouping
(* … *)   comment
```

Where the comma between sequence elements is omitted for readability, a
sequence is still meant. Braces denote repetition only, never alternatives.

Example:

````ebnf
backtickFence = "```", { "`" };
tildeFence    = "~~~", { "~" };
````

Both productions mean at least three, followed by any number of further
identical fence characters.

## 2. Block elements

### 2.1 Headings

ATX syntax only. Setext headings are not permitted. A heading occupies one
physical source line and contains non-empty inline content without line breaks.

Normal mode retains the CommonMark 0.31.2 ATX surface where it is representable
in Markanto: zero to three leading ASCII spaces are accepted and removed, and
an optional CommonMark closing `#` sequence is accepted and removed. Strict
mode and canonical output use no leading indentation and no closing `#`
sequence. Unlike CommonMark, an empty ATX heading (for example `##` or
`## ##`) is invalid because `Heading.children` is non-empty in the semantic
AST. The opening marker consists of one to six `#` characters followed by at
least one ASCII space before the first content character.

```text
# Level 1
## Level 2
### Level 3
```

There is no heading-specific `\\n` escape. Visual wrapping is renderer or
editor behaviour, not heading syntax.

An equals-only line is rejected as a Setext attempt only when it continues an
in-progress paragraph; standalone (including after a blank line) it is literal
paragraph text.

### 2.2 Thematic break (HR)

The canonical form is `---` on its own line. Optionally followed by exactly
one space and an ID suffix `{#id}`.

```text
---
--- {#divider-01}
```

In normal parser mode the classic CommonMark forms are accepted:

- at least three identical characters from `-` or `*`,
- optional ASCII spaces or tabs between the characters,
- in normal mode, optional ASCII spaces or tabs after the last character,
- any number more than three characters,
- no other content except an optional ID suffix.

```text
---
------
- - -
- - - - -
***
* * * *
```

Formally, for the content before an optional ID suffix:

```regex
^(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,})$
```

All characters must be identical; mixed forms such as `-*-` are invalid.
Trailing ASCII whitespace is permitted only in normal mode and is removed.
In strict mode only `---` or `--- {#id}` is valid. The formatter normalises
every accepted form to `---`. Setext headings are not permitted, so `---` is
not ambiguous.

**`_` is not an HR character:** a run of
underscores (`___` etc.) is no longer recognised as a thematic break — the
character is now exclusively the fence of the quiet lined container
(2.7.1). `_` thus has no double meaning within Markanto. It was rarely used
as an HR character anyway; `-` (canonical) and `*` cover the need
completely.

### 2.3 Lists

Unordered lists canonically use `-`. `*` and `+` are accepted in normal
parser mode and normalised to `-`; in strict mode they are not permitted.

Ordered lists canonically use a decimal number followed by `.` and exactly
one space, e.g. `1. Item`. The alternative Markdown form `1)` is accepted in
normal parser mode and normalised to `1.`. The actual start and follow-on
numbers are preserved.

GFM-compatible task markers `[ ]`, `[x]`, and tolerantly `[X]` are permitted
as an optional property of a list item; `[X]` is normalised to `[x]`.

Lists use a canonical simple form but may, in clearly delimited cases,
contain block elements. Lists and quote regions may recursively contain one
another according to their ordinary block grammar; the language defines no
small fixed nesting-depth limit.

Full specification: see section 9.

### 2.4 Code fence

Canonically, backtick fences with at least three backticks are used. The
formatter chooses a fence length longer than any contiguous backtick
sequence occurring in the content.

In normal parser mode, longer backtick fences and tilde fences of at least
three characters are also accepted. Zero to three leading ASCII spaces before
the opener/closer are accepted as the retained CommonMark surface and removed
by canonical formatting. Tilde fences are always normalised to a sufficiently
long backtick form. Opener and closer use the same character; the closer is at
least as long as the opener.

Markanto deliberately narrows the CommonMark info string to either nothing or
**one non-empty whitespace-free language token** immediately following the
opening fence. Additional whitespace-separated info-string fields are syntax
errors; they are not discarded. The token `math` denotes `MathBlock` rather
than `CodeBlock`. For backtick fences the language token may not contain a
backtick: a ```` ``` ````-prefixed line whose remainder contains a backtick is
therefore **not** a code fence at all — it is ordinary paragraph content whose
leading run opens an inline code span (10.4), as in CommonMark. This backtick
test covers the whole remainder of the line and takes precedence over the
one-token rule above, so a backtick anywhere after the opening run makes the
line inline content rather than a multi-field-info-string syntax error.
Canonical output writes the language token immediately after the fence with no
intervening space.
Fence-line indentation is syntactic tolerance only: it does not strip or
rebase indentation from literal content lines. After outer list/quote/container
structural prefixes are removed, `CodeBlock.value` stores content bytes exactly
as specified below.

In strict mode, only backtick fences in the formatter-produced **shortest
safe length** are valid: at least three backticks, and exactly as many as
needed so the fence is longer than any contiguous backtick run in the
content. Tilde fences and arbitrarily overlong backtick fences are not
canonical in strict mode.

`CodeBlock.value` stores the literal content between the opener and closer,
after removal of the fence lines themselves. The physical line terminator
immediately preceding the closing fence is **structural** and is not part of
`value`. Earlier line terminators between content lines remain part of the
value. Thus ```` ```js\nconst x = 1;\n``` ```` has semantic value
`"const x = 1;"`, not `"const x = 1;\n"`. A trailing LF in `value` therefore
represents an actual final blank content line, not the separator before the
closing fence.

````text
```javascript
const value = 42;
```
````

#### 2.4.1 HTML comment

`<!-- … -->` is recognised as a standalone fenced literal — content literal,
no inline parsing, never visible output:

```markdown
Text before.

<!-- Draft, not finished yet.
Second draft paragraph. -->

Text after.
```

This is not a raw-HTML passthrough in the sense of 8.2: the comment content
is never rendered, regardless of the renderer — hence no need for a
renderer-policy mechanism (`reject`/`escape`/`sanitize`/`trusted`) of the
kind that otherwise motivates rejecting raw HTML as a block. Deliberately
**not** a general raw-HTML escape hatch: only the exact marker `<!--`/`-->`
is recognised, no other HTML constructs.

Rules:

- Normal mode accepts zero to three leading ASCII spaces before `<!--`;
  canonical output and strict mode place the opener at column 0.
- Opener `<!--`, may continue with content on the same line.
- Closer `-->` may be on the same line as the opener or a later line; after
  it, only optional whitespace is permitted on that line — no visible
  content after the closer on the same line (no `<!-- x --> text`; that
  would be a syntax error, and `text` would not be recognised as its own
  block; Markanto's block model has no mixed lines).
- Content between opener and closer is literal, including line breaks — no
  inline parsing, no escaping. It is stored as a semantic `CommentBlock.value`
  exactly as the character sequence between the markers. Because the first
  literal `-->` closes the construct and no escape exists, a valid semantic
  `CommentBlock.value` itself never contains `-->`.
- Canonical serialisation writes `<!--` + that exact value + `-->`; it adds or
  removes no whitespace or line breaks inside the comment. Comments are thus
  renderer-invisible but round-trip-preserved semantic source nodes.
- Unclosed comments produce a syntax error, as with code/math fences (2.4).
- No block ID — an invisible block has no meaningful link target.
- Permitted everywhere code/math fences are permitted (document level, quote
  regions, structured list items, lined/fenced containers).

Motivation: Markdown otherwise has no comment syntax. `<!-- … -->` is the
universally known, cross-platform convention for it — not a neologism
authors would have to learn.

### 2.5 Blank lines, semantic separation, and local syntax boundaries

Blank lines are mandatory in Markanto only where they carry meaning. In
particular they separate two paragraphs, or, after the introductory
paragraph of a structured list item, open a further child block.

Before an unambiguously marked block start, a blank line is optional in
normal parser mode. The current leaf block ends there through a **local
syntax boundary**. In the canonical form the formatter places exactly one
blank line between sibling blocks unless a more specific rule applies.

More precisely:

- Two consecutive text lines with no recognisable block marker belong to the
  same paragraph. Two paragraphs require a blank line.
- Unambiguous block starts such as heading, HR, code/math fence, list,
  quote, fenced container, block media, and confirmed table may follow a
  previous block directly in normal mode.
- In strict mode, exactly one canonical blank line is required between
  sibling blocks, except at document boundaries, within a coherent list
  sequence, within a fence, or before an immediate `{#id}` suffix.
- A blank line closes the current leaf block. It never closes a fenced
  container; that ends only at its closer.
- An unprefixed blank line ends a quote region. An empty line within the
  quote carries the full quote prefix.
- Within a structured list item, a blank line is required when a further
  paragraph or another child block of the same item follows the
  introductory paragraph.
- Several consecutive blank lines are semantically equivalent to one in
  normal mode; the formatter normalises them.
- An immediate block-ID suffix `{#id}` must never be separated from its
  block by a blank line.

Examples:

```text
Paragraph.
# Heading
```

is valid in normal mode and canonically becomes:

```text
Paragraph.

# Heading
```

By contrast:

```text
First line.
Second line.
```

denotes a single paragraph. Two paragraphs still require a blank line.

### 2.6 Structural taxonomy

Markanto distinguishes six categories of block construct:

| Category | Examples | Closer |
| --- | --- | --- |
| **Lined container** | `Exkurs` + `___`, anonymous `___` | `___` |
| **Fenced container** | `::: Warning`, `::: Warning Read this` | `:::` |
| **Prefix container** | block quote `> …` | first line without required quote prefix |
| **Fenced literal** | code/math fence, `<!--` | matching fence, `-->` |
| **Implicit container** | list | indentation or local syntax boundary |
| **Leaf block** | paragraph, heading | blank line or unambiguous marked block start |

Container nesting is deliberately asymmetric: lined containers may have
fenced containers as direct children; no other Markanto-container nesting is
permitted. Quote/list interactions are defined by their respective chapters.

### 2.7 Containers

Markanto provides two normative container forms, **lined** and **fenced**. Their
`form` is semantic and is preserved by canonical serialization. The terms
**quiet register** and **loud register** describe the authoring rationale only;
they are not grammar terms and confer no independent semantics.

#### 2.7.1 Lined container

A typed lined container consists of a header line immediately followed by an
underscore fence. The first whitespace-free token is `TYPE`; the remainder
of the header after one ASCII space is the optional `TITLE`.

```text
Exkurs
___

Content
___
```

```text
Exkurs Es geht um Sprache
___

Content
___
```

An anonymous lined container has no header line:

```text
___

Content
___
```

In canonical form, the lined opener is followed by exactly **one blank line**
before the first content block. For a typed lined container, the opener is the
two-line `TYPE [TITLE]` + `___` construct; for an anonymous lined container it
is the opening `___` line itself. The blank line is **surface syntax only** and
does not create a paragraph or other semantic-AST node.

Normal mode also accepts a missing blank line after a lined opener and
canonicalises it by inserting one. Strict mode requires the canonical blank
line. More than one blank line at this position is semantically equivalent in
normal mode but canonicalises to exactly one.

Recognition of a typed lined container uses exactly one logical line of lookahead:
a candidate header becomes a lined header only when the immediately
following logical line is a valid lined fence. A candidate header must not
itself begin with a recognised block-level introducer on the current logical
baseline (for example an ATX heading, list/quote marker, fenced container,
code/math fence, thematic break, table/footnote structure, or standalone block
resource). Such a line keeps its ordinary block meaning even when followed by
`___`.

The same restriction is a semantic representability condition. A valid
`lined` container AST must have a canonical `TYPE [TITLE]` header which remains
a lined-header candidate under this test. The formatter rejects a lined
container whose composed canonical header would instead begin another
recognised block construct.

#### 2.7.2 Fenced container

A fenced container places its optional header on the opener:

```text
::: Exkurs
Content
:::
```

```text
::: Exkurs Es geht um Sprache
Content
:::
```

Anonymous form:

```text
:::
Content
:::
```

#### 2.7.3 Fence grammar and baseline

Both container fence characters use runs of **three or more** characters in
normal input:

```ebnf
linedFence = "_", "_", "_", { "_" } ;
fencedFence    = ":", ":", ":", { ":" } ;
```

An opening fence establishes its run length `n >= 3`. A closing fence of the
same character closes that container only when it begins on the same logical
content baseline and has run length `m >= n`. A shorter run does not close the
container. This rule applies to both lined and fenced containers.

Canonical output always uses exactly three characters for both opener and closer:
`___` and `:::`. For a lined opener, canonical output additionally emits exactly
one blank line after the opening fence before the first content block. Fence
length and opener spacing are surface properties and are not stored in the
semantic AST.

A fence begins exactly on the current logical content baseline. Markanto does
not add CommonMark-style 0–3-space tolerance to container fences. Outer list,
quote, or container indentation is resolved before fence recognition.

A lined fence requires an uninterrupted candidate run of unescaped `_`.
Escaping any underscore in the candidate prevents fence recognition. Thus
all of the following produce literal `___` rather than a lined fence:

```text
\\___
_\\__
__\\_
```

This follows from the ordinary character escape rule; no special block-wide
escape is introduced.

#### 2.7.4 TYPE

`TYPE` is the first non-empty whitespace-free token of a non-empty container
header. It is Unicode and case-sensitive. The parser normalises `TYPE` to
Unicode NFC; no transliteration, ASCII projection, case folding, or global
Unicode normalisation is performed.

`TYPE` may contain any Unicode scalar value except:

- Unicode whitespace,
- control characters,
- `<` or `>`,
- `[` or `]`,
- `{` or `}`,
- `|`,
- `\`,
- `` ` ``.

These exclusions deliberately keep Markdown's strongest structural characters
out of the author-defined TYPE token, including the inline-code delimiter. Quotation marks remain ordinary TYPE
characters. Container headers are parsed before inline escaping; inline
backslash escaping is not applied to `TITLE`. A backslash cannot occur in
`TYPE` at all.

Examples:

```text
Exkurs
TL;DR
RFC:9110
Q&A
C++
Überblick
Résumé
日本語
注意:重要
```

#### 2.7.5 TITLE

`TITLE` is the non-empty literal remainder of a non-empty header after `TYPE`
and one ASCII space. A title therefore exists only together with a `TYPE`;
`TITLE` without `TYPE` is not a representable semantic state. There is no title
separator and no title-specific quoting or escaping syntax. Quotation marks and
colons are ordinary title characters and remain part of the title.

Canonical header spacing is exactly one ASCII space between the fenced opener
and `TYPE`, and exactly one ASCII space between `TYPE` and `TITLE` when a
title exists. A lined header has no fence prefix.

#### 2.7.6 Containment

Containment depends on `form`, never on `TYPE`:

```text
Lined → Fenced    allowed, direct child only
Lined → Lined     forbidden
Fenced → Lined    forbidden
Fenced → Fenced   forbidden
```

A Markanto container may occur only as a direct child of the document, except
for the single containment relation `Lined → Fenced` shown above. A container
therefore may not be a descendant of a list item, quote region, grid cell,
footnote definition, or any other block structure. The permitted fenced child
of a lined container must itself be a direct child of that lined container;
intervening block structure does not inherit the exception.

A lined container may contain multiple fenced-container siblings. Ordinary
Markdown blocks may occur in either container form. No TYPE receives special
nesting privileges. Both container forms must contain at least one block. An
empty container is recognised container syntax but violates the non-empty
semantic-AST invariant and is therefore a **semantic error**. A purely empty
structural wrapper carries no Core meaning and is not representable in a valid
semantic AST.

A fenced child counts as a direct child only when its opener begins on the
lined-container content baseline after outer structural prefixes have been
resolved. The child must close with its own matching fenced closer before
the surrounding lined container closes.

#### 2.7.7 Grid composition inside fenced containers

A fenced container may use a compact two-dimensional **Grid** composition.
Grid syntax exists only inside fenced containers; it is not recognised in lined
containers or at document level. This is an intentional exception to graceful
degradation: the fenced form is already explicit Markanto syntax and may
therefore host denser Markanto-specific structure.

The five structural marker lines are:

```text
::    header/body separator
==    row separator
--    column separator
^     rowspan continuation
<     colspan continuation
```

The marker vocabulary follows a deliberate visual weight hierarchy:

```text
:::   outer fenced-container boundary    3 characters
::    major internal boundary            2 characters
== -- grid subdivision                   2 characters
^  <  cell continuation                  1 character
```

This **3:2:1** progression is design rationale, not a numeric grammar rule.
Structural depth is reflected by decreasing syntactic weight.

A fenced container begins with its body classification **undecided**. A forward
structural scan observes complete logical lines on the container content baseline,
outside literal/code/math/comment regions. Those regions include a still-open
inline code span (10.9): once a backtick run opens a span that a later line has
not yet closed, an intervening physical `::`, `--`, or `==` line is span content,
not a Grid marker. The first `::`, `--`, or `==` marker outside every such region
commits the fenced body to Grid interpretation; if no such marker occurs before the
matching outer closer, the body is ordinary fenced-container content. `^` and `<`
alone never trigger Grid recognition. The scan tracks these regions in one forward
pass; it does not parse a slice twice.

This is deferred commitment, not general parser backtracking. Before the decision,
an implementation may retain uncommitted source slices / cell candidates, but it
must not deeply parse the same slice as two competing constructs. Once a Grid
trigger occurs, the complete fenced body — including source before the trigger — is
partitioned by the Grid subgrammar and each resulting ordinary cell body is block
parsed once. A pre-trigger line containing only `^` or `<` therefore becomes a
continuation only when its **complete resolved cell** consists solely of that marker;
otherwise it remains ordinary cell content.

`::` may occur at most once. It ends the optional Grid header and begins the body.
The rows before and after it are resolved as two independent span geometries: a
rowspan may exist wholly inside the header or wholly inside the body, but may never
cross the `::` boundary. A Grid created only by `::` is valid; the trivial case is a
1x1 header plus a 1x1 body. Both regions must contain at least one row when `::` is
present.

A headerless one-column, one-body-row value is **not** a semantic Grid: it would
require none of the three Grid-trigger markers and therefore has no canonical Grid
surface distinct from ordinary fenced-container content. Consequently every valid
headerless Grid has either `columns > 1` or more than one body row.

`--` ends the current cell and begins the next column in the same row. `==` ends
the current cell and begins the first column of the next row. Thus:

```text
::: Vergleich
Alpha
--
Beta
==
Gamma
--
Delta
:::
```

represents a two-column, two-row Grid.
A header may use the same row, column, and continuation syntax as the body:

```text
::: Vergleich
Name
--
Plattform
::
Bun
--
Linux
==
Node.js
--
Linux
:::
```

Here `::` is a structural Grid marker rather than a general-purpose section
separator. It is recognised only at the direct Grid baseline; an identical line
inside code, math, comments, or other literal regions remains content.

Grid cells contain one or more ordinary
container blocks; they are not restricted to inline-only table-cell content. A
Grid cell may therefore contain paragraphs, headings, lists, block resources,
quotes, tables, code, and other ordinary non-container blocks permitted in a
fenced container. A Grid cell may not contain a Markanto container or another
Grid.

Every parsed row must have the same logical number of slots. An ordinary cell
slot contains one or more blocks. A continuation slot contains exactly one
continuation marker and no other semantic content:

- `^` assigns the current slot to the same anchor cell as the slot immediately
  above it. It therefore extends that anchor's **rowspan**. It is invalid in the
  first row or when no resolvable slot exists directly above.
- `<` assigns the current slot to the same anchor cell as the slot immediately
  to its left. It therefore extends that anchor's **colspan**. It is invalid in
  the first column or when no resolvable slot exists directly to the left.

Continuation resolution proceeds in row-major order. Every logical slot resolves
to exactly one anchor cell. The complete set of slots assigned to an anchor must
form one filled axis-aligned rectangle; L-shaped, disconnected, overlapping, or
otherwise non-rectangular spans are semantic errors. This permits combined
rowspan/colspan without adding numeric source syntax.

For example, a cell spanning two rows and two columns may be written canonically
as:

```text
::: Feature
One cell
--
<
==
^
--
^
:::
```

When a continuation slot could be expressed either as `^` or `<` because both
neighbours already resolve to the same anchor, canonical serialization chooses
`^`. This gives every valid semantic Grid exactly one canonical surface form.

The separator and continuation markers are surface syntax only. The semantic AST
stores rectangular cell geometry (`column`, `rowSpan`, `colSpan`) rather than the
marker lines themselves. Omitted span fields mean `1`; canonical semantic ASTs do
not store `rowSpan: 1` or `colSpan: 1`.

#### 2.7.8 Semantic model

```text
Container {
  form: "lined" | "fenced"
  containerType: string | null
  title: string | null
  children: NonEmptyArray<Block | Grid>
  id?: BlockId
}

Grid {
  columns: positive integer
  header?: NonEmptyArray<GridRow>
  rows: NonEmptyArray<GridRow>       // body rows, or all rows when no header exists
}

GridRow {
  cells: Array<GridCell>
}

GridCell {
  column: positive integer       // one-based anchor column
  rowSpan?: integer >= 2
  colSpan?: integer >= 2
  children: NonEmptyArray<ordinary container block>
}
```

A `Grid` may occur only as the sole child of a fenced container. Lined containers
never contain a Grid directly. `header` is present if and only if the source Grid
contains `::`; header and body span geometry are independent and no anchor may span
across their boundary. A valid Grid is canonically triggerable: `header` is present,
or `columns > 1`, or the body has more than one row. `fenceLength`, Grid
separator/continuation marker spelling, HTML element names, CSS classes,
`data-container`, and quiet/loud presentation vocabulary are not Core AST semantics. An HTML renderer may, for example, expose the
type as `data-container="Überblick"`; that is a renderer convention, not Markanto
source syntax.

## 3. Quote syntax

### 3.1 Purpose

This specification defines a Markdown-compatible, fully line-local,
deterministically parsable syntax for block quotes.

A block quote uses the greater-than sign `>` as a prefix on **every**
belonging source line. Markanto adopts the ordinary Markdown base form but
forgoes lazy continuation lines and other implicit membership rules.

The syntax specifically avoids:

- a proprietary quote closer,
- unmarked continuation lines,
- implicitly continued quote paragraphs,
- ambiguous indentation rules,
- backtracking to determine quote membership.

### 3.2 Base form

```text
> Text of the first quote level.
> Continuation of the same paragraph.
```

Multiple paragraphs within the same quote are separated by an empty quote
line:

```text
> First paragraph.
>
> Second paragraph.
```

A line without a quote prefix ends the block quote. There is no explicit
closer.

### 3.3 Canonical quote prefix

Each quote level is canonically expressed by the string `> `.

| Depth | Prefix | Example |
| ---: | --- | --- |
| 1 | `> ` | `> Text` |
| 2 | `> > ` | `> > Text` |
| 3 | `> > > ` | `> > > Text` |

Formally:

```ebnf
quoteLine           = outerIndent? (nonEmptyQuoteLine | emptyQuoteLine)
nonEmptyQuoteLine   = quotePrefix content
emptyQuoteLine      = ">" (" >")*
quoteUnit           = ">" " "
quotePrefix         = quoteUnit+
```

`emptyQuoteLine` covers the canonical empty quote lines `>`, `> >`,
`> > >`, etc. Non-empty quote lines use exactly one ASCII space after
each `>`.

The depth equals the number of `>` characters in the prefix.

Canonically there is exactly one ASCII space after each `>`. The compact
Markdown form `>> Text` or `>>> Text` may be accepted in normal parser mode
but is normalised to `> > Text` or `> > > Text` respectively. In strict mode
only the canonical form is valid.

### 3.4 Start and end of a quote

A block quote begins at a line with a valid quote prefix of depth 1.

```text
> Start of the quote.
```

A document or container block may not begin directly at depth 2 or greater:

```text
> > Invalid start at depth 2.
```

The quote ends before the first line that carries no valid quote prefix at
the same outer structural level.

```text
> Quote.

Normal paragraph.
```

The empty source line without a prefix does not belong to the quote. An
empty line **within** the quote does carry the prefix:

```text
> First paragraph.
>
> Second paragraph.
```

### 3.5 Empty quote lines

A line that has no content after removal of the canonical quote prefix is an
empty quote line.

```text
>
> >
> > >
```

It separates leaf blocks at its quote level but does not automatically end
all outer quote levels.

A lone `>` is therefore **never a closer**. It represents an empty quote
line at depth 1.

Canonically an empty quote line contains no trailing space. Lexical analysis
therefore distinguishes both canonical forms:

```regex
^>$
^(> )+[^\r\n]*$
```

The formatter serialises empty prefixes without a trailing space:

```text
>
> >
> > >
```

### 3.6 Quote levels

The quote level of each line is fully determined by its prefix.

```text
> Level 1.
> > Level 2.
> > > Level 3.
> > Level 2 again.
> Level 1 again.
```

The depth may rise by at most one relative to the previous non-empty quote
line:

```text
nextDepth <= previousDepth + 1
```

Valid:

```text
> Level 1.
> > Level 2.
> > > Level 3.
```

Invalid:

```text
> Level 1.
> > > Level 3.
```

When going back, multiple levels may be closed at once.

### 3.7 No lazy continuation

Every non-empty source line belonging to a block quote carries its full
quote prefix.

Valid:

```text
> This is a longer paragraph,
> continued on the next source line.
```

Invalid:

```text
> This is a longer paragraph,
continued without a marker.
```

The second line does not belong to the quote in Markanto. If it follows
without a separating blank line, it begins a new block outside the quote or
produces an error there per the general block grammar.

CommonMark lazy continuation may be recognised only during an explicit
CommonMark import through a preceding CommonMark parser, and then converted
into canonical Markanto syntax.

### 3.8 Paragraph and block boundaries

After removal of the quote prefix, the normal Markanto rules for leaf blocks
apply.

Directly consecutive text lines at the same quote level form the same
paragraph:

```text
> First line,
> second line.
```

An empty quote line separates paragraphs:

```text
> First paragraph.
>
> Second paragraph.
```

A change of quote level ends the current leaf block and begins a new block
at the given depth.

### 3.9 Processing order

Quote prefixes are processed from the outside in:

```text
outer indentation
→ determine quote prefix and quote level
→ remove quote prefix
→ hand the remaining line to the normal block parser
```

Lists, tables, code fences, and other block elements therefore need no
special rules for unmarked follow-on lines.

### 3.10 Other block elements

A block quote may contain the ordinary block elements of the language,
provided every belonging source line carries the full quote prefix.

Neither lined nor fenced containers remain permitted within block quotes
(see 2.6).

#### 3.10.1 Heading

```text
> > ## Heading at quote level 2
```

After removal of `> > `, the rest is parsed as a normal heading.

#### 3.10.2 List

```text
> > - First list item
> > - Second list item
> >   - Sub-item
```

After removal of the quote prefix, the normal list grammar from chapter 9 is
applied.

#### 3.10.3 Code fence

````text
> > ```javascript
> > const value = 42;
> > ```
````

The quote layer first removes the prefix `> > ` from each line. Only then
does the block parser recognise the opening fence, the literal content, and
the closing fence.

The quote prefix is not part of the code content.

#### 3.10.4 Table

```text
> | A | B |
> |---|---|
> | 1 | 2 |
```

After removal of the prefix, the table is parsed per chapter 12.

#### 3.10.5 Block media

```text
> <m video>[Video](film.mp4)\
> *Recording of the experiment*</m>
```

The resource line is recognised as an ordinary block-media node after
removal of the quote prefix. Every physical line still carries the full
quote prefix — the hard break lies within the (prefixed) resource line, so
the quote region is not interrupted by an unprefixed blank line.

### 3.11 Lists within a quote

Lists may be nested normally within a block quote:

```text
> - First item
>   - Sub-item
>     - Further level
```

Quote depth and list depth are independent:

- the number of `>` characters determines the quote level,
- the indentation after removal of the quote prefix determines the list
  depth.

Lists within quotes use the same recursive list grammar regardless of whether
the quote itself occurs inside a list item. Resource exhaustion is an
implementation concern rather than a language-level nesting error.

### 3.12 Quotes within lists

A quote may occur as a block element in a structured list item:

```text
- Statement

  > Justification.
  >
  > - Nested item A
  > - Nested item B
```

The canonical order on each line is:

```text
list indentation → quote prefix → block content
```

Before quote processing, the list parser removes the child base indentation.
The quote layer then processes the full quote prefix of each line.

### 3.13 No standalone nested quote regions

Multiple quote levels are not modelled by separately opened or closed quote
containers, but exclusively by the prefix depth of each line.

```text
> Level 1
> > Level 2
> > > Level 3
```

Semantically the levels correspond to nested `<blockquote>` elements.
Syntactically the membership of each line remains fully local.

### 3.14 Semantic model

Parser internals may represent quote structure in any convenient form, including
a flat sequence of source lines with absolute depth. After line-by-line prefix
removal, the cleaned lines are handed per depth to the block parser.

The **normative semantic AST** represents each contiguous quote region as a
flat, non-empty sequence of `QuoteBlock` records carrying absolute levels:

```text
QuoteRegion [
  QuoteBlock { level: 1, block: Paragraph }
  QuoteBlock { level: 2, block: Paragraph }
  QuoteBlock { level: 3, block: Paragraph }
  QuoteBlock { level: 1, block: Paragraph }
]
```

The renderer derives the nested HTML tree from this.

A `QuoteRegion` covers a contiguous sequence of quote lines. It has no
syntactic closer.

### 3.15 Parser model

The syntax is parsable with a linear line-by-line state machine.

#### 3.15.1 Recognition

At document level a quote begins at a valid prefix of depth 1.

For each following line the parser determines:

1. outer base indentation,
2. quote prefix depth,
3. remaining content after removal of the prefix.

A line without a valid quote prefix ends the current `QuoteRegion` before
that line.

#### 3.15.2 Prefix normalisation

In normal parser mode, unambiguous Markdown variants are accepted:

```text
>> Text
>>> Text
>Text
```

They are canonically serialised as:

```text
> > Text
> > > Text
> Text
```

The tolerated form must not create ambiguity with outer list indentation or
other block introducers. In strict mode only canonical prefixes are
permitted.

#### 3.15.3 Line handover

After removal of the quote prefix, each cleaned line together with its
absolute depth is handed to an ordinary block parser.

Multi-line block elements are not consumed as a special case by the quote
parser. Instead every physical source line must first pass through the quote
layer.

#### 3.15.4 Level validation

For each new non-empty quote line:

```text
nextDepth <= previousDepth + 1
```

The first non-empty line of a `QuoteRegion` must have depth 1.

Empty quote lines may state a depth at most equal to the currently open
depth. They may not open a new deeper level.

### 3.16 Error cases

| No. | Description | Example |
| --- | --- | --- |
| 3.1 | Quote begins at depth greater than 1 | `> > Level 2.` |
| 3.2 | Upward level jump greater than 1 | `> L1.\n> > > L3.` |
| 3.3 | Missing space in canonical form (strict mode) | `>Text` |
| 3.4 | Compact prefix in strict mode | `>> Text` |
| 3.5 | Unmarked continuation line as intended quote content | `> Line.\nContinuation.` |
| 3.6 | Deeper empty quote line opens a new level | `> Text\n> >` |
| 3.7 | Container within a quote | `> ::: Warning` or `> Exkurs` followed by `> ___` |
| 3.8 | Quote prefix missing on a line of a code fence | ```` > ```js\ncode\n> ``` ```` |
| 3.9 | Tab within the canonical prefix | `>\tText` |

A line without a quote prefix is not itself a quote syntax error; it ends
the `QuoteRegion`. An error arises only if an already-begun multi-line block
element becomes incomplete as a result, e.g. a code fence without a prefixed
closer.

### 3.17 Attribution line

A `QuoteRegion` may be followed immediately by exactly one attribution line
— a structured source credit:

```text
> Kill two birds with one stone.
-- proverb
```

The attribution is recognised as a context-dependent postfix, structurally
following the same base pattern as the caption for block media (4.5) — a
reserved marker that requires an immediately preceding, exactly-once
structure. Unlike the caption (a hard break `\` + a full
emphasis line, no marker string of its own), the attribution remains its own
literal line marker `-- ` (two ASCII hyphens, one space) — both mechanisms
stay unambiguously distinguishable through their different carrier syntax:

1. The previous logical line must be the last line of a `QuoteRegion`.
2. If the `QuoteRegion` itself is a structured block of a list item (3.12),
  the attribution line must carry the same list indentation as the
  `QuoteRegion` — it thereby stays associated with the same list item
  rather than ending it (see example below).
3. There must be no blank line between the `QuoteRegion` and the attribution
  line.
4. The attribution line itself carries **no** quote prefix (`>`) — that
  structurally distinguishes it from the quote content and is exactly what
  ends the `QuoteRegion` at that point (3.4).
5. The attribution line begins, after any list indentation per rule 2,
  exactly with `-- ` (two ASCII hyphens, one space).
6. Exactly one attribution line is permitted.
7. Without an immediately preceding `QuoteRegion`, `-- Text` is treated as
  ordinary paragraph content — analogous to rule 6 for captions.

Attribution content is parsed inline content, as with `Paragraph`/`Heading`
— non-empty, single-line, without `HardBreak`/`SoftBreak` (analogous to
`TableCell`, chapter 12). Authors can thereby italicise a work title or link
to a source:

```text
> A quote.
-- *Goethe*, from [Faust](https://example.org/faust)
```

The attribution is part of the same `QuoteRegion` — not its own block node,
no ID of its own — and is serialised canonically without a blank line
directly after the last quote line. This follows from the node model rather
than being an exception to sibling-block separation: the
attribution is not a sibling block, it is part of the same node.

**Interaction with list items (3.12):** an attribution line within a list
item is permitted, provided it carries the same list indentation as the
associated `QuoteRegion` (rule 2) — it then stays part of the same list
item, exactly like other structured blocks after a quote (9.8):

```text
- Item

  > Quote.
  -- Author
```

Without this indentation the list ends there as usual, and `-- Author`
becomes ordinary text outside the list (rule 7).

### 3.18 Canonical formatting

- Every belonging source line carries the full quote prefix.
- Each level is serialised as `> `.
- There is therefore exactly one ASCII space between levels.
- Empty quote lines are written as `>`, `> >`, `> > >` without a trailing
  space.
- No lazy continuation.
- No tabs in the prefix or in structural indentation.
- No proprietary closing line.
- No upward level jumps by more than one.
- The first block begins at depth 1.
- Multi-line block elements carry the full quote prefix on every physical
  line.

### 3.19 Full example

````text
> Quote level 1
> and continuation.
>
> > Level 2.
> >
> > - First list item
> > - Second list item
> >   - Sub-item
> >
> > > Level 3
> > > and continuation.
> > >
> > > ```javascript
> > > console.log("Quote at level 3");
> > > ```
> >
> > Level 2 again.
>
> Level 1 again.
````

### 3.20 Conversion to CommonMark/GFM

The canonical Markanto quote syntax is already largely CommonMark-compatible.

```text
> First level
> and continuation.
>
> > Second level.
>
> First level again.
```

On export no structural changes are generally required. Markanto-specific
contained block elements are converted per their respective export rules.

Since Markanto produces no lazy continuation and every source line is fully
prefixed, the export is deterministic.

### 3.21 Import from CommonMark/GFM

On import, CommonMark/GFM is first converted into an AST with a
standards-conforming parser.

The nested block-quote tree is then serialised into canonical Markanto lines:

- every physical line gets the full prefix for its depth,
- `>>` is serialised as `> >`,
- lazy continuation lines are explicitly prefixed,
- empty quote lines are emitted with their full depth,
- impermissible fenced containers are moved out or reported as an import
  diagnostic,
- list/quote recursion is preserved subject only to the ordinary structural grammar;

A direct Markanto parse attempt reconstructs no CommonMark lazy
continuation. That normalisation is the job of the explicit CommonMark
import path.

### 3.22 Open extension points

Not part of this version — no parsed syntax of its own, no AST field, no
validation:

- attributes on individual quote levels.

Source credits / quote captions are fully specified as the attribution line (3.17, `QuoteRegion.attribution`,
including parser, validator, and formatter). Epigraphs and pull quotes also
need no dedicated syntax and are already expressible through existing
mechanisms (lined or fenced container as deliberately manual
duplication, see 2.7).

**Part of this version:**

- IDs for the entire contiguous `QuoteRegion` via `{#id}` on the immediately
  following line,
- contained leaf blocks receive no IDs of their own within a `QuoteRegion`.

Since the `QuoteRegion` has no closer, its ID follows immediately after its
last quote line (or after the attribution line, if present) with no blank
line. Order when both are present: attribution line first (content), block-ID
suffix after (metadata) — analogous to the existing "content before
metadata" rule for other multi-line blocks:

```text
> Quote.
-- Author
{#quote-01}
```

Without an attribution line it remains as before:

```text
> Quote.
{#quote-01}
```

## 4. Resources and the `<m>` wrapper

### 4.1 Principle

Native Markdown continues to identify links and images:

```text
[Link](target)
![Alt](image.jpg)
```

Markanto uses `<m>` only when additional semantics or metadata are required,
or when the resource kind is not expressible by native Markdown alone.

The optional resource discriminator is a dedicated grammar slot, not an
attribute:

```ebnf
mOpen = "<m", [ S, mKind ], { S, attribute }, ">" ;
mKind = "video" | "audio" | "embed" | "download" ;
S     = " " ;
```

All four kinds are lowercase-only in normal and strict mode. If present,
`mKind` must be the first token after `<m>`; it may not occur among
attributes.

### 4.2 Generic metadata span

A kindless `<m>` around ordinary inline content is an inline metadata span
and requires at least one attribute:

```text
<m lang=de>Text</m>
<m data-role=term>Text</m>
```

`<m>Text</m>` is invalid because it adds no semantics.

The `<m` opener through its closing `>` and every attribute are confined to
one physical line. In multiline-capable block content, the ordinary inline
content between that opener and the exact `</m>` closer may contain
`SoftBreak`; it may not cross a `HardBreak`, blank line, or block boundary.

### 4.3 Images

The Markdown image marker remains the resource discriminator:

```text
![Alt](image.jpg)
```

A kindless `<m>` may attach image metadata:

```text
<m group=trip lang=de>![Alt](image.jpg)</m>
```

The image may be inline or block according to its structural position.
Explicit `mKind` plus an image is a type conflict and is invalid:

```text
<m video>![Alt](image.jpg)</m>
```

### 4.4 Typed resources

Video, audio, embed, and download use one Markdown link as their primary
content:

```text
<m video>[Video](film.mp4)</m>
<m audio>[Audio](sound.mp3)</m>
<m embed>[Demo](https://example.org)</m>
<m download>[Whitepaper](paper.pdf)</m>
```

Rules:

- `video`, `audio`, and `embed` are block-only.
- `download` may be inline or block according to structural position.
- Each typed wrapper contains exactly one Markdown link as its primary
  resource.
- Free ordinary text is invalid inside a typed resource except for the
  defined block caption.
- The parser does not reinterpret mismatched content heuristically.
- An inline/block-capable resource is a **block resource** exactly when, after
  removal of outer structural prefixes, its primary resource occupies the
  complete logical line apart from its optional `<m>` wrapper and an optional
  immediately following caption as defined in 4.5. Otherwise it is inline.
- Consequently a valid `Paragraph` never consists solely of a single
  `InlineImage`, or a single `Link` with `download: true`, or the kindless /
  typed `<m>` wrapper form of either: that state is representable in neither
  normal-mode parsing (it would be recognised as the block node) nor a valid
  semantic AST. The block node (`ImageBlock` / `DownloadBlock`) is used instead.
- An embed target must satisfy the security requirements of the renderer or
  host application; Core resource typing itself does not infer kinds from
  file extensions.

### 4.5 Captions

Captions exist only for block resources. The canonical carrier is an
explicit Markdown hard break (`\`) after the primary resource, followed by
one complete emphasis line:

```text
![Alt](image.jpg)\
*Caption*
```

A bare block image therefore does not require `<m>` merely to carry a
caption. With metadata:

```text
<m group=trip>![Alt](image.jpg)\
*Caption*</m>
```

Typed block resource:

```text
<m video>[Talk](talk.mp4)\
*Recorded at the **2026** conference*</m>
```

The caption is one inline sequence. The outer `*...*` delimiters are the
**caption carrier** and are not represented as an `Em` node. Their enclosed
content is parsed with the ordinary inline grammar, so nested emphasis, strong
emphasis, code, and links remain available. Soft breaks, hard breaks, and block
elements inside the caption are not permitted. Inline resources have no
caption.

The hard break is mandatory; a merely adjacent emphasis line is not treated
as a caption.

### 4.6 Resource attribute matrix

Core attributes are intentionally small:

| Context | Core attributes | Extensions |
| --- | --- | --- |
| generic kindless `<m>` | `lang` | `data-*` |
| image in kindless `<m>` | `group`, `lang` | `data-*` |
| `video` / `audio` / `embed` | `group`, `lang`, `preview` | `data-*` |
| `download` | `lang` | `data-*` |

Unknown bare attributes are errors. Private or experimental metadata must use
`data-*`, preserving the bare namespace for future Markanto Core additions.

Presentation-oriented names including `style`, `class`, `width`, `height`,
`size`, `profile`, `autoplay`, `srcset`, and `sizes` are not Core attributes.
If an application needs private metadata with such meaning it may use a
`data-*` name, subject to its own profile.

`lang` annotates the natural language of the wrapped content or resource. Its
value must be a **well-formed BCP 47 language tag**. Core validation is
syntactic and does not depend on the current contents of the IANA Language
Subtag Registry; registry-aware tooling may issue non-Core warnings. Before
semantic AST storage and comparison, the complete tag is ASCII-lowercased
(`de-DE` → `de-de`, `zh-Hant-TW` → `zh-hant-tw`). Canonical serialization uses
that lowercase spelling. The annotation does not change parsing semantics.

`group` is an opaque document-local group identifier for logically related
resources. Its value is normalised to Unicode NFC before AST storage and
comparison. Equal NFC-normalised values denote membership in the same group;
Core assigns no ordering, layout, or presentation semantics to the group.

`preview` denotes a resource target / URI string, not free descriptive text.
Its value uses the same destination semantics and validation as a Markdown
link/image destination.

### 4.7 Attribute grammar

```ebnf
attribute   = key, "=", value ;
key         = coreKey | dataKey ;
coreKey     = "group" | "lang" | "preview" ;
dataKey     = "data-", name ;
name        = nameStart, { nameChar } ;
nameStart   = ASCII_LOWER ;
nameChar    = ASCII_LOWER | DIGIT | "_" | "-" ;
value       = bareValue | quotedValue ;
bareValue   = bareChar, { bareChar } ;
quotedValue = '"', { quotedChar | escape }, '"' ;
escape      = '\\"' | '\\\\' ;
bareChar    = ? any Unicode scalar except whitespace, '"', "'", '\\', '<', '>' ? ;
quotedChar  = ? any Unicode scalar except '"', '\\', CR, LF ? ;
```

A bare value is non-empty and may contain any character except Unicode
whitespace, `"`, `'`, `\`, `<`, or `>`. Quoted values may not span physical
lines. Complex values use double quotes:

```text
lang=en
group=trip-2026
preview=poster.jpg
data-ref=RFC:9110
data-url=https://example.org/x
data-label="My custom value"
preview="images/poster large.jpg"
```

Single-quoted values are not supported. Inside a double-quoted value only
`\"` and `\\` are escapes. HTML entities are not an attribute escape
mechanism.

An empty string is written explicitly as `key=""`; `key=` is invalid.
Duplicate attribute keys are always an error, even if their values are
identical. `data-*` names are lowercase-only in both normal and strict mode;
case variants are not tolerated aliases. The `data-*` namespace carries
application annotations only and must never be necessary to reconstruct Core
semantics.

Canonical opener order is:

1. `mKind`, if present;
2. bare Core attributes sorted by ascending ASCII byte order of the key;
3. `data-*` attributes sorted by ascending ASCII byte order of the full key.

Because all attribute keys are ASCII, this ordering is equivalent to ascending
Unicode scalar-value order and is independent of locale/collation settings.

Normal mode accepts any order among valid unique attributes; the formatter
normalises it. Strict mode accepts only canonical order. The formatter removes
unnecessary quotes and adds quotes exactly where the bare-value grammar
requires them.

### 4.8 CommonMark/GFM degradation

MIB wrappers are chosen so their contents remain visible in generic Markdown
processors that preserve or ignore unknown inline tags. A Markanto parser
must nevertheless treat them as Markanto syntax, not raw HTML. Degradation is
not semantic equivalence: notably `<i>`/`<b>` may degrade with HTML-style
semantics while Markanto maps them to `Em`/`Strong` and an HTML renderer
emits semantic `<em>`/`<strong>`.

## 5. Block IDs — suffix syntax

### 5.1 Block suffix `{#identifier}`

Block IDs are assigned as a suffix immediately after the block — with no
blank line in between. There are no block prefixes.

**Single-line blocks — heading and HR** — ID on the same line (canonical):

```text
## Introduction {#introduction}

--- {#divider-01}
```

**All other blocks** — ID on the immediately following line (canonical):

```text
A short paragraph.
{#abc1234}
```

**Multi-line blocks** — ID on its own immediately following line after the
block ends (canonical):

````text
A paragraph that runs across
several lines.
{#def5678}

```javascript
const x = 1;
```
{#code-01}

::: warning
Content.
:::
{#note-01}

Exkurs All about language
___

Content.

___
{#aside-01}

> Quote.
{#quote-01}
````

**Canonical rule per block class:**

- Heading, HR → suffix on the same line: `## Title {#id}`, `--- {#id}`
- All other blocks (paragraph, code fence, lined container, fenced
  container, resource block, quote region, list, table, footnote
  definition) → suffix on its own immediately following line
- `{#identifier}` after a blank line → syntax error

**Placement / addressability rule:** ID eligibility belongs to the nearest
structural ownership boundary. ID-capable blocks that are direct children of the
document or direct ordinary children of a lined/fenced container may carry their
own IDs; a direct fenced child of a lined container may likewise carry its own
container ID. Once content is inside a list item, a `QuoteRegion`, or a Grid cell,
contained blocks do **not** carry independent IDs, including nested lists, quotes,
tables, paragraphs, code blocks, or resources at deeper positions. The owning
list/quote/container remains the addressable structural unit. Table cells are
inline-only and never carry block IDs. `CommentBlock` and `Grid` have no block-ID
field of their own.

This rule is semantic, not merely formatter style: an AST that stores an ID on a
block in a non-addressable contained position is invalid.

### 5.1.1 Canonical block-ID syntax

The canonical block-ID syntax is:

```text
{#identifier}
```

It defines exclusively the ID of the immediately preceding block. Block
suffixes are restricted to exactly this one ID.

The previously tolerated explicit long form `{id: identifier}` is **not
supported** — not even in normal mode. Only
`{#identifier}` exists. It is not migrated to `{id=identifier}`; the long
form is removed with no replacement, since it offered no additional
semantics over the already compact, unambiguous `{#id}` form.

Further keys or combinations are not permitted in block suffixes:

```text
{#conclusion data-status=draft}  → syntax error
{lang=en}                        → syntax error
{id: conclusion}                 → syntax error (removed long form)
```

Block identity and general inline/resource attributes thus stay clearly
separate.

### 5.2 Identifier format

```regex
`{#identifier}` — identifier: `[A-Za-z0-9_-]+`
```

- Alphanumeric, `-` and `_` permitted
- No spaces
- Case-sensitive
- Manual IDs: meaningful identifiers (`introduction`, `conclusion`)

### 5.3 Block ID and shortlink — shortlink removed

The shortlink `[/identifier]` is **not supported**.
Instead of

```md
[/conclusion]
```

a direct Markdown fragment link is used:

```md
[Conclusion](#conclusion)
```

Rationale: Markdown and URI fragment syntax already express this semantics
fully; the shortlink was only an abbreviation, produced additional scanner,
escape, and disambiguation logic, and degraded poorly in foreign Markdown
renderers (visible square brackets instead of a link). All parser, formatter,
scanner, escape, AST, and test specifics for `[/...]` are removed.

Definition and reference thus remain unambiguous through different syntax:

- `{#identifier}` immediately after an ID-capable block → **durable block ID / anchor definition**
- `{#identifier}` at the end of a heading or HR line → **durable block ID / anchor definition**
- `[Text](#identifier)` → **direct reference to that document anchor**

For a fragment destination of the exact form `#identifier`, `identifier` uses
the same `[A-Za-z0-9_-]+` grammar as block IDs. The destination is stored
literally as `Link.href`. When a block with that explicit ID exists in the
same document, the fragment denotes that block. A missing target does not make
the Markdown link syntactically invalid; validation tooling may report an
unresolved internal anchor as a warning.

This Core anchor mechanism is distinct from symbolic `$identifier` destinations
(10.5): `#identifier` is an ordinary concrete URI fragment whose target is an
explicit document ID, whereas `$identifier` is an opaque symbol whose resolution
is application/tooling policy.

**Identifier regex for block IDs:** `^\{#[A-Za-z0-9_-]+\}$` — no spaces, no
additional content.

### 5.4 Shared attribute grammar

The normative `<m>` attribute grammar, namespace policy, value quoting,
duplicate handling, and canonical ordering are defined in 4.6–4.7. Block-ID
syntax does not reuse `<m>` attributes; `{#identifier}` remains its own
compact suffix grammar.

## 6. Block IDs — format

### 6.1 Core semantics

Explicit block IDs are durable document semantics. Their syntax, uniqueness,
preservation, and attachment to supported block nodes are part of Markanto
Core.

The canonical explicit suffix remains:

```text
{#identifier}
```

where the surrounding block grammar defines the permitted attachment point.
An ID must be unique within the document.

### 6.2 Generation and adoption

Markanto Core does **not** prescribe a random-ID algorithm, epoch, timestamp
layout, bit width, or command-line workflow. Reference tooling may generate
or adopt IDs, but generated IDs are ordinary explicit block IDs once written
into the document.

A conforming formatter preserves explicit IDs. A conforming parser does not
generate IDs as a side effect of parsing.

### 6.3 Heading anchors

Automatic heading slugs are renderer/tooling behaviour, not Core semantics.
When a durable anchor must travel with the document, use an explicit block ID
such as:

```text
## Introduction {#introduction}
```

## 7. Parser and canonicalisation

### 7.1 Line breaks

Markanto has one Markdown-compatible semantic line-break model. A normal
physical line break inside a paragraph is a soft break. An explicit trailing
backslash produces `HardBreak`. Two or more trailing ASCII spaces are
accepted as a hard break in normal mode and normalised to the trailing
backslash form.

There is no semantic `lineBreaks` / `line-breaks` parser option. Applications
may offer editing or import transformations, but identical Markanto source
must parse to identical line-break semantics.

### 7.2 Accepted syntax vs. canonical serialisation

Normal mode accepts only explicitly documented tolerant forms. Strict mode
accepts exactly canonical Markanto. Formatting an accepted document produces
canonical source.

The following laws apply:

1. **Semantic round-trip:** parsing formatted AST output reproduces the same
  semantic AST.
2. **Formatter idempotence:** formatting canonical output again is byte-stable.
3. **Normal-form convergence:** all tolerated surfaces for the same AST
  converge on the same canonical surface, except semantic surface choices
  represented in the AST such as container `form`.
4. **Recognisability:** canonical output is valid strict input.

### 7.3 Parser phases and logical lines

Normative order:

1. read the physical line;
2. determine current container, list, and quote context;
3. remove structural indentation and quote prefixes belonging to that context;
4. expose a logical line while preserving source positions;
5. recognise the leaf/block construct;
6. parse inline content where applicable;
7. validate semantics separately from canonicity.

This ordering defines the **logical content baseline** used by container
fence recognition. Fenced-container Grid recognition uses the explicit deferred
commitment rule of 2.7.7: the outer fenced body may be structurally classified
before its ordinary block/cell slices are deeply parsed. That one deferred
classification is part of fenced-container recognition and is not permission for
general parser rewind/backtracking.

### 7.4 File format and whitespace

- UTF-8 without BOM is canonical. Normal mode accepts one initial UTF-8 BOM
  and removes it before parsing; strict mode rejects a BOM as
  `noncanonical`/`error`.
- LF is canonical. Normal mode normalises CRLF to LF before syntax parsing;
  strict mode rejects CRLF as `noncanonical`/`error`. A lone CR is invalid in
  both modes.
- Tabs are not permitted as structural indentation. Tabs may occur as literal
  running-text characters where the inline grammar permits them.
- Canonical output ends in exactly one LF — with no exception for the empty
  document, whose canonical surface is a single LF (`"\n"`). Normal mode accepts
  input that ends in no LF or in several consecutive trailing LFs and normalises
  the terminal newline to exactly one; strict mode rejects a missing or repeated
  terminal LF as `noncanonical`/`error`. Trailing blank lines before end of
  input are terminal-newline surface, not empty paragraphs, and carry no
  semantic AST node.
- Trailing structural whitespace is removed except where it would change
  semantics; canonical hard breaks use `\\`, not trailing spaces.

### 7.5 Error recovery and resource limits

Syntax errors, semantic validation errors, non-canonicity, and implementation
resource exhaustion are distinct conditions. A parser may recover to report
multiple diagnostics, but recovery must not silently reinterpret invalid
Markanto as another valid semantic construct.

Implementations **must** impose safe resource limits. Concrete limits such as
maximum frame count, token length, node/work budget, matrix size, or document size
are implementation or reference-tool policy, not language validity rules. Reaching
such a limit is resource exhaustion, not proof that the source is syntactically or
semantically invalid.

Parser, semantic validator, canonical formatter, semantic equality, and other
source-controlled AST traversals must preserve this distinction. An operation that
stops solely because its declared budget is exhausted reports a `resource` result
(or an error diagnostic whose category is `resource`); it must not report `invalid`
on that basis. Round-trip/canonicalisation laws quantify over operations that
complete within their declared resource budgets. Implementations should use
explicit frames/stacks rather than relying on source-controlled call-stack depth.

### 7.6 Validator profiles

A validator may expose operational profiles such as normal vs. strict input,
but profiles may not change Core meaning. Strictness controls accepted
surface forms, not the semantic interpretation of an otherwise accepted
construct.

### 7.7 Normative semantic AST contract

Markanto's canonicalisation laws refer to a **semantic AST**, not to a
particular parser's internal representation. The companion TypeScript schema `src/ast.ts` is the machine-readable reference
shape for that semantic model. The TypeScript structure is intentionally not
a substitute for semantic validation: a structurally constructible object is a
**valid semantic AST** only when it also satisfies every invariant in this
specification and `docs/INVARIANTS.md`.

Conformance distinguishes three layers:

1. **semantic AST** — normative document meaning; its nodes contain no source
  ranges/offsets;
2. **source annotations** — optional parser/tooling sidecar metadata, including
  ranges whose offset unit is implementation/API policy, never semantic fields;
3. **recovery/tooling data** — diagnostics and `ErrorBlock`-like recovery
  records for invalid input, never nodes of the semantic AST of a valid
  document.

Implementations may use arbitrary internal parser stacks, temporary nodes, or
more convenient data structures. Before semantic comparison or canonical
formatting they must project valid input to the normative semantic AST. A
formatter MUST reject an invalid semantic AST rather than emit ambiguous or
unparseable Markanto, and MUST NOT trim, pad, or otherwise alter a semantic
value to make it serialisable. In particular, validity includes
context-sensitive and serialisability constraints such as: no soft/hard breaks
anywhere inside a single-line context; no nested `Link` inside link label
content; no `-->` in `CommentBlock.value`; non-empty single-line
`InlineMath.value` without the literal closing sequence `` `$ ``; `Sup.value`
without `^`; `Sub.value` without `~`; context-correct resource attribute sets;
exact table row widths; normalised ordered-list `start`/`value` fields;
representable container TYPE/TITLE and Grid states; context-correct block-ID
placement; and non-empty container children.

**Inline edge whitespace.** The inline sequence of a `Paragraph`, a `Heading`,
or a `TableCell` MUST NOT begin or end with a `Text` node whose value carries
leading or trailing Unicode whitespace respectively, and no `Text` immediately
before a `SoftBreak` / `HardBreak` (in any context) ends with Unicode
whitespace, nor does a `Text` immediately after one begin with it. Normal-mode
parsing strips exactly this whitespace and there is no canonical surface that
would restore it, so a differently-shaped AST is not a valid semantic document.
Interior whitespace is unaffected — a whitespace-only `Text` between two
non-`Text` inline nodes on one logical line (`*a* *b*` → `Em, Text(" "), Em`)
is valid and canonical. A `FootnoteDefinition` and a `QuoteRegion` attribution
keep the whitespace that follows their `]: ` / `-- ` marker verbatim (§11.7,
§3.17): only their nested sequences and break-adjacent positions are
constrained, not the outer edge.

`CommentBlock` is part of that semantic AST even though renderers emit no
visible content for it. This is required so parsing and formatting do not lose
source comments.

### 7.8 Diagnostic taxonomy

Conforming tooling should describe each diagnostic with two independent axes:
a stable **category** and a **severity**. Exact human-readable wording is
implementation-defined; machine-readable diagnostic codes should remain stable
within a tool's compatibility line.

| Category | Meaning |
| --- | --- |
| `syntax` | source cannot be recognised as valid Markanto syntax |
| `semantic` | recognised syntax violates an AST/context invariant |
| `resource` | implementation safety/resource limit reached; not proof of syntax invalidity |
| `noncanonical` | valid normal-mode Markanto that strict mode/canonical output rejects |
| `advisory` | valid Markanto with noteworthy non-Core/tooling information |

Severity is orthogonal:

| Severity | Meaning |
| --- | --- |
| `error` | the requested operation/profile cannot accept or complete the input |
| `warning` | the input remains acceptable for the requested operation/profile |

For example, non-canonical normal-mode input may be `noncanonical`/`warning`,
while the same surface checked as strict input may be `noncanonical`/`error`.
An unreferenced footnote or registry-aware language-tag advice is typically
`advisory`/`warning`. Resource exhaustion is `resource` and normally `error`,
but it is never evidence that the document is syntactically invalid.

Neither category nor severity becomes document semantics or is stored in the
semantic AST.

## 8. Scope boundaries and extension policy

### 8.1 Core vs. tooling

The language specification defines syntax, semantic AST meaning, validation,
and canonical serialization. CLI command names, automatic ID generation,
automatic heading slugs, renderer libraries, theme conventions, and concrete
resource-budget defaults belong to reference tooling or renderer documents.

### 8.2 Deliberate non-features

Markanto 0.1.0 deliberately does not provide:

- raw HTML passthrough;
- Setext headings;
- presentation-specific Core attributes such as `style` or `class`;
- heuristic resource typing by file extension;
- recursive Markanto container nesting;
- semantic parser modes that change meaning without changing source;
- canonical table padding based on display-width heuristics.

### 8.3 Extension namespace

The `data-*` namespace on `<m>` is reserved for application/private
annotations. Unknown bare `<m>` attributes are errors so that future Core
attributes can be added without silently changing the meaning of old source.
`data-*` names are lowercase-only, and no `data-*` value may be required to
recover Markanto Core meaning. Applications that need indispensable private
semantics need an explicit external profile or a future dedicated extension
mechanism rather than hiding language semantics in `data-*`.

## 9. List syntax

### 9.1 Purpose

This specification defines a deterministically parsable, largely
Markdown-compatible syntax for unordered and ordered lists, including
GFM-compatible task markers.

The common case remains a **simple list**: a list item contains inline
content, continuation lines, and optionally sub-lists. For technical
documentation and structured texts, a list item may additionally contain
unambiguously indented block elements. This form is called a **structured
list**.

Lists and quote regions may recursively contain one another according to the
ordinary structured-list and quote grammars. Markanto defines no special
`List → Quote → List` termination rule and no small fixed nesting-depth limit.

### 9.2 Base forms

Simple list:

```text
- First item
- Second item
  - Sub-item
- Third item
```

Structured list item:

````text
- Installation:

  ```sh
  npm install @markantolang/parser
  ```

- Justification:

  > A quote.
````

Recursive mixed nesting remains ordinary syntax:

```text
- Outer item

  > Context.
  >
  > - Inner item
  >   - Nested list
  >
  >   > Nested quote.
```

Such nesting remains subject to the same list/quote ownership and indentation
rules as anywhere else. Lined and fenced containers remain forbidden inside
list items and quote regions by the independent container-containment rules.

### 9.3 List markers

Canonically only `-` followed by exactly one ASCII space.

In normal parser mode, `*` and `+` are additionally accepted and normalised
to `-` by the formatter. In strict mode they are syntax errors.

Accepted input pattern:

```regex
^( *)([-*+]) ([^ ].*)$
```

Canonical pattern:

```regex
^( *)- ([^ ].*)$
```

Still invalid:

```text
-Item
-  Item
*
```

### 9.3.1 Ordered lists

Canonically the marker consists of a decimal number, a dot, and exactly one
ASCII space:

```text
1. First item
2. Second item
  1. Sub-item
```

In normal parser mode `1)` is also accepted and normalised to `1.`. The
numeric values are not blanket-rewritten to `1.`: the start number and
visible follow-on numbers are preserved. A switch between unordered and
ordered list opens a new list node at the same indentation level.

```regex
^( *)([0-9]+)([.)]) ([^ ].*)$
```

In strict mode only `.` is permitted as the delimiter. Leading zeros are not
canonical and are removed (`01.` → `1.`); the value must be an integer in
the inclusive range **0..999,999,999** (at most nine decimal digits after
normalisation).

The semantic AST stores ordered numbering in one normalized form. `List.start` is
permitted only on ordered lists and is present exactly when the first visible
marker is not `1`; `start: 1` is therefore invalid semantic AST. The first
`ListItem` never stores `value`, because its visible number is already represented
by `List.start` (or the implicit default 1). For every later item, let `expected` be
one greater than the preceding item's actual visible number. `ListItem.value` is
present **if and only if** the item's visible marker differs from `expected`; after
such a deviation, following implicit numbering continues from that actual value.
`start` and `value` never occur on unordered or definition lists.

### 9.3.2 Task markers

Immediately after a valid list marker there may be a task marker:

```text
- [ ] open
- [x] done
1. [ ] ordered task
```

`[ ]`, `[x]`, and, in normal mode, `[X]` are accepted; the formatter writes
`[ ]` or `[x]`. The task marker is followed by exactly one space and
non-empty inline content. The task status is an optional property of the
`ListItem`, not a list type of its own; mixed normal and task items are
permitted. Task markers are also permitted in ordered/unordered sub-lists. They are **not**
recognised as task syntax on definition-list items: after the definition marker
`: `, a leading `[ ]`, `[x]`, or `[X]` is ordinary term inline content. Thus no
valid definition-list `ListItem` carries `task`. Interactivity is renderer /
application territory.

### 9.4 List levels and indentation

The canonical indentation is exactly **2 ASCII spaces per level**.

| Indentation | Level |
| --- | ---: |
| 0 spaces | 1 |
| 2 spaces | 2 |
| 4 spaces | 3 |
| 2n spaces | n+1 |

Normal mode **must** also accept an indentation surface that CommonMark 0.31.2 deterministically assigns to the same already-open list item or to its one-level-deeper child, provided that assignment does not introduce an indented code block (which Markanto excludes) and does not violate Markanto's level-rise rule. No implementation-defined additional indentation aliases are permitted. The formatter projects every such accepted surface to two spaces per semantic level. Strict mode accepts only canonical indentation. Tabs are not permitted as indentation.

### 9.5 Level changes

The list level may rise by at most one level relative to the immediately
preceding item. When going back, levels may be skipped.

```text
- Level 1
  - Level 2
    - Level 3
- Level 1 again
```

A jump from level 1 directly to level 3 is a syntax error.

### 9.6 Inline content and continuation lines

Every list item begins with at least one inline content. An item consisting
only of a marker is impermissible.

An inline paragraph may run across several physical lines. The canonical
continuation indentation is `(level - 1) * 2 + 2` spaces.

```text
- A longer item,
  continuing here.
  - A sub-item,
    likewise continuing.
```

Normal mode accepts a continuation indentation exactly when CommonMark 0.31.2
would deterministically attach that physical line to the same already-open
list item and the line does not become an indented code block. The formatter
normalises the continuation to the canonical content baseline. A continuation
line opens no new paragraph and no new block element.

### 9.7 Simple lists

A simple list contains per item:

- exactly one inline paragraph,
- any number of continuation lines of this paragraph,
- optionally immediately following sub-lists.

It contains no blank line and no other block elements. This is the preferred
and fastest parsing form.

### 9.8 Structured list items

A list item becomes structured as soon as at least one indented block
element follows its introductory inline paragraph. Permitted are:

- further paragraphs,
- quote regions,
- fenced literals including code and math fences,
- tables,
- block media,
- sub-lists.

Neither lined nor fenced containers are permitted within list items;
they belong outside the list.

A subordinate block element must canonically be indented two spaces further
than the marker of the associated list item. Its full content, including the
closer, keeps this base indentation.

````text
- Example:

  A second paragraph.

  > Quote.

  ```js
  console.log('ok');
  ```
````

A blank line closes the current leaf block, not automatically the list item.
The list item stays open if the next non-empty line unambiguously belongs to
its child indentation. Otherwise the list ends. At most one line of
lookahead is required for this; backtracking is not necessary.

### 9.9 List end and siblings

Without a blank line, a list marker at the same level begins a new sibling
item.

A blank line takes the list out of the simple form (9.7); it does **not** end
the list. The next non-empty line is then considered:

- child indentation of the current item → a further block element of the
  same item (the list is now structured),
- list marker at an open list level → a new item of the **same** list,
- lesser or foreign indentation → list ended.

Because there is no tight/loose distinction (9.14, 9.15), a blank line between
items carries no meaning: the canonical form of a list is always tight
(`- a` then `- b` on the next line), and a blank-line-separated run of
same-level markers is a tolerated normal-mode surface that strict mode rejects
as noncanonical. The bullet character (`-` / `+` / `*`) is likewise not
semantic (9.3). One consequence: two adjacent lists of the same kind with
nothing between them have **no** distinct canonical surface — they are one
list. A different-kind list (ordered vs. unordered), or any intervening block,
separates them.

Several blank lines are semantically equivalent to one.

### 9.10 Lists and quote regions

Quote regions may occur as block elements in structured list items. Every
quote line carries its full quote prefix after the child base indentation.
Before the quote parser is invoked, the child base indentation of the list
item is subtracted from each line.

Quote regions may in turn contain lists, and those lists may contain further
quote regions or sub-lists according to the ordinary grammar. After removal
of the full quote prefix, the normal list grammar is applied without a special
`List → Quote → List` termination rule.

For example:

```text
- Outer

  > Context.
  >
  > - Inner
  >   - Deeper list
  >
  >   > Deeper quote.
```

There is no language-level numeric maximum for list depth, quote depth, or
mixed list/quote depth. Implementations enforce resource limits separately as
described in 7.5 and 9.11. Reaching such a limit is resource exhaustion, not a
syntax error.

The independent Markanto-container rule still applies: lined and fenced
containers may not occur inside list items or quote regions.

### 9.11 Resource depth

The grammar does not define a small fixed maximum list or quote depth.
Implementations must enforce safe resource limits as described in 7.5.
Exhausting an implementation limit is not a syntax error.

### 9.12 Parser model

Lists are processed with a linear stack parser.

For each non-empty line, at most the following characteristics are
determined:

1. indentation,
2. list marker,
3. block start token after subtraction of the base indentation,
4. current container position.

The stack contains exclusively open lists, list items, and, where
applicable, a subordinate block parser. Indentation less than the current
base closes stack entries until the line can be assigned again.

#### 9.12.0 Linearity contract

For all list and inline subparsers:

- A monotonic cursor moves forward only.
- A successful subparser returns AST nodes and an end position.
- Already-consumed characters are not re-examined by a competing full
  parser.
- Lookahead is local and bounded; it serves only to select an unambiguously
  recognisable construct. Tables use at most one already-normalised logical
  line of lookahead.
- Balanced parentheses in classic link targets are processed with a depth
  counter. Implementations apply safe resource limits per 7.5; exhausting such
  a limit is resource exhaustion, not a syntax error.
- There is no backtracking search over several complete parse variants.

The parse effort thus stays linear in the input length, apart from
constant-bounded safety checks. More exotic CommonMark edge cases are
processed via the AST-based import path.

#### 9.12.1 Fast path

As long as no blank line and no indented block start token occurs, the list
is parsed as a simple list. This path needs no lookahead and no general
block recognition.

#### 9.12.2 Structured path

After a blank line or a recognised child-block start token, only the current
list item switches to structured mode. The parser delegates the block to the
existing block parser with a fixed base indentation.

#### 9.12.3 Recursive mixed nesting

Lists and quote regions use the same ordinary parsers at every permitted
recursive level. Implementations should use explicit stacks/frames rather than
source-controlled call-stack recursion where practical, and must apply the
resource policy from 7.5. No parser path may reinterpret resource exhaustion as
a syntax error.

### 9.13 Error cases

| No. | Description |
| --- | --- |
| 9.1 | No or more than one space after the marker |
| 9.2 | Empty list item |
| 9.3 | Ambiguous or, in strict mode, non-canonical indentation |
| 9.4 | Upward level jump by more than one level |
| 9.5 | Tab in the indentation |
| 9.6 | Non-indented block element within a list item |
| 9.7 | Lined or fenced container within a list item |

### 9.14 Canonical formatting

- unordered lists use `-` exclusively,
- ordered lists use the actual decimal number followed by `.`,
- task markers optionally follow the unordered or ordered list marker,
- exactly one ASCII space after the marker,
- exactly two spaces per list level,
- exactly two additional spaces for child blocks,
- no tabs,
- simple lists without blank lines,
- structured items with exactly one blank line between sibling blocks,
- no semantic distinction between tight and loose lists,
- no upward level jump by more than one level; decreases may skip levels.

### 9.15 HTML model

Unordered simple and structured lists are rendered as `<ul>` with `<li>`;
ordered lists as `<ol>` with `<li>`. A structured `<li>` may contain the
specified block elements. CommonMark's tight/loose distinction is not
adopted; the renderer follows the AST only.

For an ordered list, the first visible number determines the start value. If
it is not `1`, the renderer sets `start` on the `<ol>`. If a later visible
number deviates from the expected sequential number, the renderer sets
`value` on the relevant `<li>`. Sequential numbers need no `value`.

```html
<ol start="3">
  <li>A</li>
  <li value="7">B</li>
  <li>C</li>
</ol>
```

### 9.16 Import from CommonMark/GFM

Import is AST-based.

Normalised:

- `*` and `+` → `-`,
- any valid list indentation → two spaces per level,
- lazy continuation → explicit continuation line,
- tight/loose lists → uniform Markanto list model.

Lists with supported block elements and recursive list/quote structure are
importable losslessly, subject only to the ordinary Markanto structural rules.

### 9.17 Export to CommonMark/GFM

Simple and structured lists can be serialised directly as CommonMark/GFM.
The export uses `-` and four spaces for complex child blocks where this is
required for maximum CommonMark compatibility.

### 9.18 Definition lists

Definition lists are a third variant of the list mechanism defined in this
chapter — not a node type of its own, but a `List` with `kind: 'definition'`.
All rules defined in 9.4–9.12 (indentation, level changes, continuation
lines, structured items, nesting with quote regions, resource limits, parser model)
apply unchanged. Only the marker, terminology, and HTML model differ.

Motivation and origin: broad ecosystem consensus (PHP Markdown Extra,
MultiMarkdown, kramdown, Pandoc, djot) alongside a non-neutral prior status
— `Term\n: Definition` (the older HMD/PHP-Markdown-Extra pattern,
deliberately not adopted here) silently merged into a paragraph before this
addition, or was wrongly read as a caption after an image. Markanto adopts
djot's prefix form instead, which fits structurally into the existing
`ListItem` model (`children: [Paragraph, ...ListItemBlock[]]` — the first
child is already the introductory paragraph, exactly the role of the term).

#### 9.18.1 Marker and base form

Canonically `: ` (colon, exactly one ASCII space) — analogous to `- ` and
`N. `, with no tolerant alias mode:

```regex
^( *): ([^ ].*)$
```

```text
: Apple

  A fruit with a core.

: Orange

  A citrus fruit.
```

The first child of a `ListItem` with `kind: 'definition'` (the introductory
`Paragraph`) is semantically the **term**; all further children
(`children.slice(1)`) are the **definition**. As with simple and structured
list items generally: a term with no follow-on block is a simple list item,
with an indented definition it becomes structured (9.7/9.8).

The HMD/PHP-Markdown-Extra pattern `Term\n: Definition` (term on its own
line, colon only on the following line) is **not** supported — only the
prefix form, where marker and term are on the same line.

#### 9.18.2 Multiple terms per definition

Consecutive `: ` items without a definition of their own (no follow-on
block) are combined into a term group; the next item **with** a definition
closes the group:

```text
: HTML
: HyperText Markup Language

  A markup language for web pages.
```

No AST field of its own for this grouping — `ListItem.children` stays
unchanged per item (`[Paragraph]` without follow-on blocks for term-less
intermediate items). The grouping is a derivation rule of the HTML export:
consecutive items without a follow-on block belong to the term group of the
next item with a follow-on block (9.18.6). Rationale: the HTML5 content
model for `<dl>` explicitly sanctions "zero or more groups each consisting
of one or more `dt` elements followed by one or more `dd` elements".

#### 9.18.3 Nesting and marker-kind change

Nesting follows the existing chapter-9 rules with no special rule (9.10, 9.11) — a definition list may occur, like any other list, in a structured list item or a quote region, and its definitions may in turn contain lists (including further definition lists), bounded by resource-limit policy from 7.5.

A change of marker kind at the same indentation level (a `: ` item
immediately followed by a `- ` or `N. ` item without a blank line, or vice
versa) opens — analogous to the unordered↔ordered switch (9.3.1) — a new
`List` node, not an error.

#### 9.18.4 Caption collision

Definition-list markers and resource captions are structurally disjoint. A
definition begins with `: ` in list position; a block-resource caption is
recognised only after an immediately preceding resource hard break and a full
emphasis line (4.5). No special collision rule is required.

#### 9.18.5 Error cases

| No. | Description |
| --- | --- |
| 9.18.1 | No or more than one space after `:` |
| 9.18.2 | Marker-kind change (`:` ↔ `-`/`N.`) at the same level → new `List` node, not an error (see 9.18.3) |

All further syntax/error cases from 9.13 (indentation, level jump, tab,
non-permitted child blocks) apply unchanged to definition lists. Resource
exhaustion remains implementation policy per 7.5 and 9.11.

#### 9.18.6 Canonical formatting

As 9.14, with one addition: definition lists use `: ` exclusively, no
tolerant mode.

#### 9.18.7 HTML model

```html
<dl>
  <dt>Apple</dt>
  <dd><p>A fruit with a core.</p></dd>
</dl>
```

Multiple terms before a shared definition (9.18.2) render as multiple `<dt>`
before the `<dd>`(s):

```html
<dl>
  <dt>HTML</dt>
  <dt>HyperText Markup Language</dt>
  <dd><p>A markup language for web pages.</p></dd>
</dl>
```

As with lists (9.15), the renderer follows the AST only, no tight/loose
distinction.

**Term without a definition, when no later grouping applies:** a `ListItem`
without a follow-on block is valid per 9.18.1 — also as the last or only
item of the list, where the grouping rule from 9.18.2 does not apply (it
only resolves terms followed by an item WITH a definition). Such an item
renders as a `<dt>` **without** a `<dd>`:

```html
<dl>
  <dt>Apple</dt>
  <dd><p>A fruit.</p></dd>
  <dt>Orange</dt>
</dl>
```

Deliberately no synthetic empty `<dd></dd>`: the renderer invents no content
not requested in the source. This deviates from WHATWG's formal content-model
reading for `<dl>` but matches common practice — browsers and other tools
render an incomplete `<dt>`/`<dd>` pair without complaint.

#### 9.18.8 Import/export

CommonMark/GFM have no definition lists — no lossless import/export path
from/to plain CommonMark. The older HMD/PHP-Markdown-Extra pattern
`Term\n: Definition` is not an automatic 1:1 import (9.18.1) and would need
its own transformation rule, not specified here.

## 10. Inline grammar

### 10.1 Purpose

This specification defines the complete inline grammar of the language: token
recognition, delimiter rules, priority, nesting, escaping, and error
handling.

### 10.2 Token overview

| Syntax | Status | Semantic node |
| --- | --- | --- |
| `*…*` | canonical when round-trip-safe | `Em` |
| `_…_` | tolerated Markdown variant | `Em` |
| `**…**` | canonical when round-trip-safe | `Strong` |
| `__…__` | tolerated Markdown variant | `Strong` |
| `<i>…</i>` | Markanto fallback | `Em` |
| `<b>…</b>` | Markanto fallback | `Strong` |
| `` `…` `` | canonical | `Code` |
| `~~…~~` | canonical | `Deletion` |
| `--…--` | canonical Markanto extension | `Obsolete` |
| `++…++` | canonical insertion | `Insert` |
| `==…==` | canonical mark/highlight | `Mark` |
| `^…^` | canonical superscript | `Sup` |
| `~…~` | canonical subscript | `Sub` |
| `<m …>…</m>` | structured Markanto wrapper | see section 4 |

`<i>` and `<b>` are attribute-free and lowercase-only.

`Deletion` and `Obsolete` are deliberately distinct semantics, not aliases for a
single visual strikethrough. `~~…~~` means content deleted/removed by an editorial
revision and renders semantically as HTML `<del>`. `--…--` means content retained
in the document but no longer accurate or relevant and renders semantically as
HTML `<s>`. Parsing and canonical formatting never convert one node into the other.

### 10.3 Base rule: delimiter recognition

A token delimiter (opener or closer) is generally valid per the following
rules. The decisive distinction is not whitespace vs. non-whitespace, but
**word character vs. punctuation** — so `(*emphasised*)`, `(_emphasised_)`,
and `„**strong**"` work correctly. **Exception:** the single-character
sup/sub delimiters `^` and `~` use the Pandoc-style rule defined
separately below, without word-character flanking. The structured tag
alternatives `<i>`/`<b>` are not delimiters and are not subject to
this flanking rule; they deliberately enable **intra-word** emphasis
(`a<i>b</i>c`), which `*`/`_` cannot express. In multiline-capable block
content, `Em` and `Strong` may contain a `SoftBreak` at nested depth, whether
their surface is a delimiter pair or `<i>`/`<b>`. They never contain a
`HardBreak`, and their owning context may impose the stricter single-line rule.

Character classes:

- **W** (word character): code points whose Unicode 15.1.0
  `General_Category` is a letter (`L*`) or decimal digit (`Nd`), plus U+005F
  LOW LINE (`_`). “Digit” here means `Nd` only, not `Nl` or `No`.
- **S** (whitespace / line start/end): code points with the Unicode 15.1.0
  `White_Space` property, plus line start and line end.
- **P** (punctuation for delimiter recognition): every other code point. This
  class therefore also includes marks (`M*`), symbols (`S*`), format
  characters, and non-decimal numbers (`Nl`/`No`).

**Opener** — delimiter `D` at position `i` is a valid opener if:

1. The character *after* `D` is not S (no whitespace, not line end).
2. The character *before* `D` is S or P — **not** W. (Prevents `mc**2` as a
  strong opener.)

**Closer** — delimiter `D` at position `i` is a valid closer if:

1. The character *before* `D` is not S (no whitespace, not line start).
2. The character *after* `D` is S or P — **not** W. (Prevents `mc**2` as a
  strong closer.)
3. A matching opener exists.
4. The content between opener and closer is not empty.

Formally:

```
charClass(c):
  if c is Unicode15.1.White_Space or LineStart or LineEnd → S
  if c.General_Category is L* or Nd, or c is U+005F       → W
  else                                                     → P

isOpener(D, i):
  charClass(nextChar(i + |D|)) ≠ S   // not followed by whitespace
  AND charClass(prevChar(i)) ≠ W     // not immediately after a word character

isCloser(D, i):
  charClass(prevChar(i)) ≠ S         // not preceded by whitespace
  AND charClass(nextChar(i + |D|)) ≠ W  // not immediately before a word character
  AND matchingOpener exists
  AND content between opener and closer is not empty

isSupSubOpener(D, i):                 // D = "^" or a single "~"
  charClass(nextChar(i + 1)) ≠ S

isSupSubCloser(D, i):
  charClass(prevChar(i)) ≠ S
  AND matching atomic opener exists
  AND content between opener and closer is not empty
  AND content contains no UnicodeWhitespace
```

Examples:

```text
*em*            → Em      (opener: S before, W after ✓; closer: W before, S after ✓)
(*em*)          → Em      (opener: P before ✓; closer: P after ✓)
„*em*"          → Em      (opener: P before ✓; closer: P after ✓)
mc**2           → no Strong (opener: W before ✗)
x~y~            → Sub     (no word-character flanking for a single `~`)
mc^2^           → Sup     (no word-character flanking for `^`)
**strong**      → Strong  ✓
* no Em *       → no Em (opener: S after ✗)
```

### 10.4 Lexical scanner

At each inline position the scanner applies deterministic longest/specific
recognition for **opening** candidates. Structural constructs are recognised before
ordinary text. While delimiter nodes are open, closing is stack-aware: if the
current position can close the delimiter on top of the open-delimiter stack, that
closer is consumed before considering a longer competing delimiter at the same
position. This preserves proper nesting without backtracking. For example,
`***x***` opens `Strong` then `Em`, and closes `Em` then `Strong`; it yields
`Strong(Em("x"))`. The analogous mid-line `~~~q~~~` path closes the atomic `Sub`
before `Deletion` (a line-start `~~~` run is a block fence instead — see 10.11).
A candidate closer may never close through an unmatched inner node.

Relevant priority classes include:

1. escapes and code spans;
2. complete Markdown links/images and autolinks;
3. MIB wrappers `<m>`, `<i>`, `<b>`;
4. footnote references and other bracketed structured forms;
5. defined multi-character inline delimiters;
6. single-character emphasis/sup/sub delimiters;
7. ordinary text.

MIB tag names and closers are exact lowercase. `<i>` and `<b>` accept no
attributes. `<m>` uses the grammar in 4.7. Unknown `<...>` constructs are not
raw HTML and remain subject to Markanto's ordinary text/error rules.

### 10.5 Structured tokens — delimitation

Markdown links and images are recognised atomically before delimiter parsing
inside their labels. Their label/alt content is then parsed according to the
inline grammar permitted for that construct.

```markdown
[*emphasised link*](https://example.org "My site")
![An *important* image](image.jpg "View")
```

Direct link destinations include two deliberately distinct internal forms. A
**concrete document anchor** uses the ordinary URI-fragment form `#identifier`,
where `identifier` follows the block-ID grammar `[A-Za-z0-9_-]+` from 5.2. It
therefore pairs directly with an explicit `{#identifier}` block ID as defined
in 5.3.

A **symbolic internal target** uses `$identifier`, with the same identifier
grammar. The dollar sign and identifier are preserved literally in `Link.href`;
Core does not rewrite or resolve the symbol. This keeps tool-oriented internal
references such as Hadley-style links valid without reintroducing Markdown
reference-link definitions:

```markdown
[Introduction](#intro)
[$id]($id)
[$section-2]($section-2)
```

Both are still **direct Markdown link destinations** and are therefore unrelated
to the excluded reference-style forms `[text][id]` and `[id]: target`. Concrete
`#identifier` fragments use ordinary document-anchor semantics; applications may
resolve symbolic `$identifier` destinations against block IDs or another
application-level symbol table. Neither resolution mechanism changes the
Markanto AST.

The MIB opener prefixes `<m`, `<i`, and `<b` are recognised before general
autolink handling. A wrapper opener is confirmed only by the complete wrapper
grammar: exact lowercase tag name, required boundary, and (for `<m>`) valid
kind/attribute syntax. Normal autolinks such as `<https://example.org>` and
`<user@example.org>` remain distinct.

`<i>` and `<b>` accept no attributes. `<m>` uses the grammar and context rules
of chapter 4. Unknown tag-like text does not enable raw HTML.

#### 10.5.1 Direct link and image domain

A direct Markdown link or image is an atomic token whose label / alt may cross
a `SoftBreak` in multiline-capable block content. The committing `](` and the
complete destination / optional title remain on one physical line. Label / alt
content never contains a `HardBreak`, and it contains **no nested `Link`, no `Autolink`, and no
`FootnoteReference`** at any depth — each would produce a nested anchor. A
nested `InlineImage` is permitted (the classic linked-image form
`[![alt](src)](href)` — an image is not an anchor). A `[…]` or `![…]` whose
closing `](…)` is not found before the containing block ends is a syntax error
(10.12, error 10.1). An empty link label (`[](dest)`) is error 10.3; an empty image
alt (`![](src)`) is valid.

A label bracket immediately followed by `(` **commits** to direct link / image
recognition: from a `](` (or `![…](`) on, the parenthesised group must be a
well-formed destination and optional title as defined below. A malformed group
— an unescaped space or line break in a bare destination, unbalanced
parentheses, a title that is neither `"…"`, `'…'`, nor `(…)`, or any other
deviation from the grammar — is a syntax error (10.12, error 10.1), **not** a
literal-text fallback. This is intentionally stricter than CommonMark, which
reparses such a sequence as plain text. A `]` that is **not** immediately
followed by `(` never commits and stays literal.

Destination and title are parsed with the CommonMark 0.31.2 grammar: the
destination is the angle form `<…>` or the bare form (non-space, non-control
characters with balanced or backslash-escaped parentheses); a title is
`"…"`, `'…'`, or `(…)`. Backslash escapes and entity / numeric character
references are resolved inside the destination and the title exactly as
CommonMark 0.31.2 resolves them there, **after** the token structure has been
established (10.4) and subject to the same scalar/control filter as text
(§10.8.1): a reference whose decoded value would fall outside the permitted
domain stays literal. The semantic `href` / `src` / `title` strings hold the
**unescaped, reference-decoded** value and must contain no CR, no LF, and no
other C0 or C1 control character (U+0000–U+001F, U+007F–U+009F) except tab; a
value outside that domain is invalid semantic AST. An **empty** destination is
permitted (`[label]()` and `[label](<>)` both yield an empty `href` / `src`);
`#identifier` and `$identifier` destinations (§5.3) are ordinary bare
destinations, stored verbatim.

Canonical serialisation:

- an **empty** destination is written as the angle form `<>`;
- a non-empty destination is written **bare** when it contains no `<` and no
  Unicode whitespace character — ASCII space, tab, and every other character
  with the Unicode `White_Space` property — and its parentheses are balanced;
  otherwise it is written in the angle form `<…>`. A destination value may
  legally contain a tab (it is the one C0/C1 character the domain admits) or
  another Unicode whitespace character; because the bare-destination scanner
  stops at every whitespace character, such a value has a canonical surface
  only in the angle form, where the scanner reads through to the closing `>`;
- a backslash escapes the minimum needed: in the bare form an unbalanced `)` or
  `(` and a literal `\`; in the angle form a literal `<`, `>`, or `\`; in either
  form an `&` **only** when it begins a sequence that would be decoded as an
  entity or numeric character reference on re-parse (a bare `&` not followed by
  such a reference is written unescaped);
- a `title`, when present, is written as `"…"` (double quotes,
  `\"` and `\\` escaped, and `&` escaped under the same reference-only rule)
  with one ASCII space before the opening quote. An empty-string title is valid
  and canonical (`[x](u "")`); it is a distinct AST state from an absent title.

### 10.6 Nesting and emphasis fallback

Inline nodes nest only where their individual grammars permit it; crossing
or overlapping delimiters are invalid.

`<i>...</i>` and `<b>...</b>` map directly to the existing `Em` and `Strong`
semantic nodes. They are serialization fallbacks: the formatter uses
`*...*` / `**...**` whenever that delimiter form is unambiguous and
round-trip-safe, and retains/emits `<i>` / `<b>` only when needed to preserve
the AST.

Parser input may therefore contain:

```text
<i>simple</i>
```

while canonical output is normally:

```text
*simple*
```

The HTML renderer maps `Em` and `Strong` semantically to `<em>` and
`<strong>` regardless of which Markanto source surface produced the node.
Generic Markdown degradation of `<i>`/`<b>` is intentionally not identical
to Markanto's semantic renderer mapping.

Wrapper containment is explicit: `<i>` and `<b>` may contain ordinary inline
content and may contain each other where the resulting `Em`/`Strong` AST is
valid; kindless inline `<m>` may contain ordinary inline content including
`<i>`/`<b>`. Typed resource `<m>` contains exactly its primary Markdown link
and, for block resources, the optional caption from 4.5; it may not contain
other MIB wrappers around or beside that primary resource.

### 10.7 Line breaks

In multiline-capable block content, `Em`, `Strong`, `Deletion`, kindless
`MetadataSpan`, and direct-link label / image-alt content may cross a normal
paragraph line ending and preserve it as `SoftBreak`. Inline-code line endings
instead collapse to one ASCII space (§10.9). `Obsolete`, `Insert`, `Mark`,
`Sup`, and `Sub` remain line-local. A trailing backslash produces `HardBreak`
and is canonical; no inline construct in the multiline subset may cross it.
Two or more trailing ASCII spaces before LF are accepted as a hard break in
normal mode and normalised to `\`.

Spaces before the trailing backslash are tolerantly permitted but removed;
no space is permitted after the backslash.

A trailing backslash — or two or more trailing ASCII spaces, normalised to the
backslash form — is a `HardBreak` carrier **only** when the line has
non-whitespace content before it **and** is followed by another non-blank line
of the same paragraph. Otherwise the backslash is a **literal backslash** in
that line's text and the trailing spaces are trivia and are removed.
Consequently a `HardBreak`, like a `SoftBreak`, is never the first or last
inline child of a `Paragraph`, and two break nodes are never adjacent.

There is no alternate project-wide hard-line-break semantic mode.

### 10.8 Escaping

A backslash followed by escapable ASCII punctuation neutralises the immediate
following character and produces that literal character:

```text
! " # $ % & ' ( ) * + , - . / : ; < = > ? @ [ \ ] ^ _ ` { | } ~
```

The escape is local to exactly one character. Block recognition observes
escaped characters before deciding whether a marker run is structural. In
particular, any escaped `_` within a candidate `___` run prevents lined
fence recognition, so `\___`, `_\__`, and `__\_` all produce literal
`___`.

A backslash before a character outside the escapable set remains a literal
backslash. There is no heading-specific `\n` escape. `\\` produces a
literal backslash.

The formatter inserts escapes only where needed to preserve the semantic AST.
When one escape is sufficient to neutralise a multi-character structural marker
run, canonical serialization escapes the **leftmost character whose escaping is
sufficient to prevent that structural recognition**. Thus `\___` is canonical
for a literal baseline `___`; `_\__` and `__\_` are tolerated normal-mode
surfaces for the same literal text but are noncanonical in strict mode. The same
leftmost-effective rule applies to other multi-character structural sequences,
**including a delimiter that would otherwise open a paired construct**: canonical
output escapes the fewest leftmost characters that stop the recognition.

- `*x*` → `\*x*` (not `\*x\*`): with the opener neutralised the trailing `*` is
  an unmatched delimiter and resolves to literal text.
- `--x--` → `\--x--`, `++x++` → `\++x++`, `==x==` → `\==x==`: a single `-` / `+`
  / `=` is not a delimiter, so neutralising one character of the opener is
  enough.
- `_x_` / `__x__` → `\_x_` / `\__x__`: `_` is a word character, so the trailing
  underscore cannot flank and re-open.
- `**x**` → `\*\*x**` and `~~x~~` → `\~\~x~~`: **both** characters of the opener
  are escaped. A lone `*` left after `\*` can still re-open by flanking, and a
  lone `~` is itself the subscript delimiter (`~x~`) — it would pair with a
  later `~` in the value or with the opener of an adjacent `Sub` / `Deletion`.

This holds regardless of how the literal text arose (a source escape, or an
entity that decoded to a delimiter character): the semantic AST carries no
entity/escape provenance, so a given `Text` value has exactly one canonical
surface.

### 10.8.1 HTML entities

Named, decimal, and hexadecimal HTML entities are recognised in normal text.
For named references, Markanto 0.1.0's exact normative mapping is committed as
`data/html-named-character-references-v0.1.0.json`; keys are entity names
without `&`/`;`, and source recognition uses `&NAME;`. Implementations may
compile that mapping into another representation but must accept exactly the
same names and decoded Unicode strings. Runtime HTML parsers or a mutable
network registry are not normative. Decimal/hexadecimal references do not
depend on that table.
The AST stores the decoded Unicode character. Canonical output prefers direct
Unicode unless an entity or escape is required for unambiguous serialization.

Structure is recognised before entity decoding. A decoded entity never
retroactively opens Markanto markup.

A numeric reference is `&#` followed by one to seven decimal digits and `;`,
or `&#x` / `&#X` followed by one to six hexadecimal digits and `;`. Any other
spelling (no digits, too many digits, a missing `;`) is not a numeric reference
and stays literal text.

An entity — named or numeric — is decoded **only if** its decoded string is
composed of valid Unicode scalar values (no lone surrogate, nothing above
U+10FFFF) and contains **no C0 or C1 control character** (U+0000–U+001F,
U+007F–U+009F) **except tab** (U+0009). Otherwise it is **not** recognised as an
entity: its source characters remain literal text, exactly as an unknown entity
name does, **with no diagnostic**, and its literal form is canonical. This is
the one qualification to "accept exactly the same names and decoded strings"
above. In the committed table it affects only `&NewLine;`; among numeric
references it covers `&#0;`, surrogates, out-of-range values, and CR/LF
(`&#10;`, `&#13;` and their hexadecimal spellings). `&Tab;` (→ tab) and
`&#x1F600;` (→ an emoji) decode normally. Consistent with
structure-before-decoding, a decoded entity never becomes a physical
`SoftBreak` or `HardBreak`.

### 10.9 Inline code with variable backtick delimiters

Inline code is begun by an opener of one or more immediately consecutive
backticks and closed by a backtick run of **the same length** before the
containing block ends.

````text
`inline code`
``code with ` backtick``
```code with `` two backticks```
````

Formal model:

```ebnf
inlineCode    = backtickRun codeContent backtickRun
backtickRun   = "`" { "`" }
codeContent   = codeChar, { codeChar }
codeChar      = ? any character before the containing block boundary ?

(* Semantic condition: opener and closer must have exactly the same run length. *)
```

Rules:

- Opener and closer have exactly the same number of backticks.
- Content is non-empty; an empty `InlineCode.value` is not canonically representable.
- The content may contain shorter or longer backtick runs, as long as no run
  is recognised as exactly a matching closer.
- The content is treated verbatim — no token recognition and no backslash
  escaping.
- A physical line ending inside inline code is accepted only when it is a
  `SoftBreak` of the same open block, and collapses to one ASCII space in
  `InlineCode.value`; canonical output is therefore always one line.
- An opener without a matching closer of the same length is a syntax error.
- The scanner first determines the length of the opening run and then
  searches left to right for the next run of exactly the same length.
- The formatter chooses the **shortest** backtick run longer than any
  contiguous backtick run occurring in the content; at least one backtick.
- Boundary spaces use a reversible protection rule so every valid
  `InlineCode.value` has a unique canonical representation. If, after zero or
  more leading ASCII spaces in the AST value, the next character is a
  backtick, the formatter prepends **one additional protective ASCII space**.
  The symmetric rule applies at the end: if the last non-space boundary
  character after zero or more trailing ASCII spaces is a backtick, one
  additional protective ASCII space is appended.
- When parsing a code span, after locating the matching delimiter run, the
  parser removes exactly one leading protective ASCII space if the interior
  begins with one or more ASCII spaces followed by a backtick; it removes
  exactly one trailing protective ASCII space under the symmetric condition.
  No other boundary whitespace is removed.
- Consequently real leading/trailing spaces remain semantic. For example AST
  values `` `code` `` and ``  `code`  `` serialize with one and three boundary
  spaces respectively inside the delimiter pair and parse back distinctly.

Examples of the canonical choice:

````text
AST content: code
Canonical:   `code`

AST content: code with ` backtick
Canonical:   ``code with ` backtick``

AST content: `code`
Canonical:   `` `code` ``

AST content:  `code`  (one real leading and trailing space)
Canonical:   ``  `code`  ``

AST content: two backticks (``)
Canonical:   ``` `` ```
````

### 10.10 Unclosed tokens

For `*`, `_`, `~~`, `--`, `++`, and `==`, an opener not closed by its permitted
boundary becomes ordinary literal `Text` in normal mode. At the boundary the
scanner resolves unmatched delimiter-stack entries left-to-right; consumed
input is not reconsidered and no backtracking occurs. For the multiline subset
in §10.7 the boundary is the containing block boundary; for line-local tokens
and single-line owning contexts it is the physical line end. The formatter
escapes any resulting literal opener, and strict mode rejects the original
unescaped surface as noncanonical.

Other committed tokens — including inline code, inline math, direct-link
groups, and MIB wrappers — remain syntax errors when unclosed.

**Exception:** a single `^` or `~` for which the atomic sup/sub
scan finds no valid partner with non-empty, whitespace-free content is
treated as ordinary literal text — even in strict mode. This concerns e.g.
`~/.bashrc`, `5~10`, `Ctrl ^C`, and `a ~ b`. Longest-match precedence checks
`~~` before this single-`~` exception; an unmatched `~~` uses the paired-
delimiter fallback above.

### 10.11 Underscore, hyphen, caret, and tilde

The em/strong wrappers from 10.6 change no meaning of these delimiter runs.
They are an additional, attribute-free surface only for the existing
`Em`/`Strong` nodes and become canonical in particular where a star delimiter
would not round-trip because of word-character flanking. In multiline-capable
block content they may span a `SoftBreak` under §10.7; their owning context and
the `HardBreak` rule remain authoritative.

`_…_` and `__…__` are accepted in normal parser mode with their classic
Markdown semantics:

- `_em_` → `Em` → canonical `*em*`
- `__strong__` → `Strong` → canonical `**strong**`

For underscores, the CommonMark flanking rules apply. In particular,
underscores within alphanumeric words open or close no markup:

```text
snake_case       → literal text
Version_2        → literal text
_em_             → Emphasis
__strong__       → Strong
```

In strict mode `_em_` and `__strong__` are not permitted, with exactly one
exception: `__…__` is canonical as an immediate `Strong` child of an `Em`
written with `*…*`, so that `Em → Strong` can be serialised unambiguously as
`*__…__*`. `Strong → Em` is still written as `***…***`.

**Special case em dash:** `--` is a valid `Obsolete` opener (`<s>`, 10.2)
only if the preceding and the immediately following character are not `-`.
Three or more consecutive hyphens (a common ASCII substitute for the em dash
in running text, e.g. "this is --- I think --- my opinion") are never a
struck opener and stay running text — otherwise every such em-dash pair
would otherwise look like paired-delimiter syntax.

**Special case caret — superscript:** `^sup^` is an atomically
scanned single-character token. Opener and closer are subject only to the
whitespace condition from 10.3, not to word-character flanking: `mc^2^`,
`10^6^`, and `1^st^` are therefore superscript. The content is non-empty, contains no `^`,
contains no Unicode whitespace at all, and is stored as plain text; nested
inline markup is not recognised within it. If the scanner finds no such
partner, the single `^` stays literal, even in strict mode. The double token
`^^…^^` is not part of Markanto; runs of
multiple carets have no double form of their own and are checked as a
sequence of single characters. `^` still does not collide with
`[^identifier]`, because the footnote reference is checked before this atomic scan
(10.4, 11.4).

**Special case tilde — subscript vs. strikethrough:** a single
`~sub~` follows the same atomic, word-character-independent, whitespace-free
content rule as caret and its value contains no `~`: `H~2~O` becomes subscript, `~/.bashrc` and `a ~ b`
stay literal. `~~deleted~~` by contrast stays fully within the general
word-character flanking and unmatched-delimiter fallback rule. The scanner rule "longest
match wins" still checks `~~` first at a position with at least two tildes.
Block recognition wins over inline (15.1): a line whose logical content **begins**
with a run of three or more tildes is a block code/math fence (2.4) — with or
without a following language token, and an unclosed one is a syntax error, never
an inline fallback. The inline `~~~q~~~` path applies only **within** paragraph
text (`p ~~~q~~~ r`), where the stack-aware longest/specific mechanism yields
`Deletion` wrapping an atomic `Sub`. The atomic content rule still applies to the
sub child there: `p ~~~a b~~~ r` is a syntax error and may not produce a
validator-invalid sub node.

`.` alone has no inline meaning; subscript uses `~sub~` and is not tolerated (see chapter head).

### 10.12 Error cases

| No. | Description | Example |
| --- | --- | --- |
| 10.1 | Unclosed committed non-delimiter token, or an unescaped unmatched paired delimiter in strict mode (10.10) | `` `no end `` / `*no end` (strict) |
| 10.2 | Overlapping tokens | `**a *b** c*` |
| 10.3 | Empty token content | `****` (closed directly) |
| 10.4 | Inline code without a matching backtick run | ``` ``no end` ``` |
| 10.5 | *(removed — `\q` is treated as a literal backslash, not an error, see 10.15)* |  |
| 10.6 | Token crosses a forbidden boundary (`HardBreak`, block end, or single-line owner) | `# *Line 1` followed by `Line 2*` |
| 10.7 | Same-kind direct nesting | `**a **b** c**` |
| 10.9 | Unclosed insertion | `++no end` |

### 10.13 Canonical formatting

- Prefer `*...*` for `Em` and `**...**` for `Strong` whenever they round-trip
  safely.
- Use `<i>...</i>` and `<b>...</b>` only when the star form cannot preserve
  the AST unambiguously.
- Tolerated `_..._` / `__...__` input normalises to the preferred canonical
  surface subject to the same round-trip rule.
- `Deletion` serializes as `~~...~~`; `Obsolete` serializes as `--...--`.
- Canonical hard breaks use a trailing `\\`.
- Escapes are emitted only where required, using the leftmost-effective rule of 10.8.

### 10.14 Conversion to CommonMark/GFM

Core Markdown delimiter surfaces degrade directly. `<i>`/`<b>` are retained
as HTML-like unknown/native inline tags by many Markdown processors and keep
their contents visible, but their generic HTML semantics (`i`/`b`) are not
identical to Markanto's semantic `Em`/`Strong` mapping. A semantic exporter
should therefore convert the AST to `<em>`/`<strong>` or safe Markdown
emphasis rather than relying on literal MIB fallback tags.

### 10.15 Inline design constraints

The inline grammar intentionally favours ordinary Markdown first, with MIB
fallbacks only where canonical round-trip requires them. Raw HTML is not an
escape hatch.

## 11. Footnotes

### 11.1 Purpose

Footnotes allow notes and source credits that do not interrupt the reading
flow. The content of a footnote is exclusively inline — no blocks, no lists,
no containers.

### 11.2 Syntax

**Reference in the text:**

```text
This is a sentence with a footnote.[^1]
Or with a descriptive identifier.[^source]
```

**Definition:**

```text
[^1]: The footnote text as inline content.
[^source]: Inline markup is permitted: *italic*, **bold**, `code`.
```

Formally:

```regex
Reference:  \[\^([a-zA-Z0-9_-]+)\]
Definition: ^\[\^([a-zA-Z0-9_-]+)\]: (.+)$
```

### 11.3 Rules

- Identifiers consist of letters, digits, `-`, and `_`. No spaces.
- Identifiers are case-sensitive: `[^Source]` ≠ `[^source]`.
- Several references to the same identifier are permitted — the definition
  appears only once in the output.
- Exactly one definition per identifier is permitted. A second definition of
  the same case-sensitive identifier is recognised syntax but a **semantic
  error**; neither first-wins nor last-wins resolution exists.
- Definitions stand at the end of the document or directly after the
  paragraph that references them — the formatter normalises to the end of
  the document.
- A reference without a definition is a **semantic error**: the reference
  token is syntactically valid but the document-level relation is incomplete.
- A definition without a reference produces a warning (not an error).
- Content: inline-only. No blocks, no lists, no further footnotes.
- Footnotes may be referenced within quote regions, lists, and fenced
  containers. The definition always stands at document level.

### 11.4 Collision freedom

Collision freedom relies on scanner priority (10.4): the structured footnote
reference `[^…]` is recognised before generic `^` delimiter handling. Only
when the complete footnote-reference pattern fails does the scanner fall back
to ordinary inline parsing.

### 11.5 Numbering

Numbering in the output is in order of first occurrence in the text —
regardless of the identifier. The identifier is for the author, the number
for the reader.

### 11.6 Example

```text
Markanto[^markanto] is a semantic authoring superset of Markdown.

It was created by Michael Kortstiege[^mko].

[^markanto]: A semantic authoring superset of Markdown.
[^mko]: Creator and maintainer.
```

### 11.7 Canonical formatting

- Reference directly on the word, no space before it: `sentence.[^1]` not
  `sentence. [^1]`. In normal mode, ASCII whitespace immediately before a
  footnote reference is tolerated source trivia and is discarded before the
  semantic AST is built; both spellings therefore produce the same AST.
- Definitions at the end of the document — order:
  1. Referenced definitions: in order of their first reference in the text
  2. Unreferenced definitions: ascending lexicographic order by Unicode scalar value of the identifier. Because identifiers are ASCII-only this is exactly ASCII byte order; they remain at the end and produce a validator warning.
- Exactly one space after the colon in the definition.

`Document.footnotes` is itself in this canonical order. A differently ordered
array is not a valid semantic AST; the formatter does not reorder or repair it,
and semantic equality does not special-case footnote order.

### 11.8 Conversion to CommonMark/GFM

Footnotes are supported by GitHub (a GitHub extension) but are not part of
the formal GFM specification. Export to GitHub Markdown: structurally
lossless — inline markup in the footnote content (`*em*`, `==mark==` etc.)
is converted to CommonMark equivalents. CommonMark (without an extension)
has no footnotes; export as a superscript number with an anchor link.

### 11.9 Import from CommonMark/GFM

GitHub footnotes can be imported directly. Multi-line footnote definitions
with block elements are normalised to inline — not lossless if block
elements are present.

---

## 12. Tables

### 12.1 Purpose

Tables present tabular data with rows and columns. Cell contents are inline-only
— no blocks, lists, containers, or Grid geometry. Markanto 0.1.0 deliberately
keeps pipe tables close to the GFM model: table cells have **no rowspan or
colspan syntax**. Markanto's `^` / `<` span metaphor belongs exclusively to the
explicit fenced Grid subgrammar (§2.7.7).

### 12.2 Syntax

GFM 0.29 pipe-table syntax is the lexical baseline, with the stricter Markanto
row-shape and tokenisation rules below:

```text
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |
```

**Alignment** via a colon in the separator line:

```text
| Left     | Centre    | Right  |
|:---------|:---------:|-------:|
| Text     | Text      | Text   |
```

### 12.3 Rules

- The separator line (`|---|---|`) is mandatory — it separates the header
  from the body.
- After row tokenisation, the header, separator, and every body row must have
  exactly the same **cell count**. Markanto does not use GFM's body-row
  padding/truncation behaviour; a short or long body row is a syntax error.
- Leading and trailing `|` are optional but canonically present.
- Cell contents permit ordinary single-line inline markup. A cell whose complete
  trimmed content is `^` or `<` is ordinary literal/inline input; neither token
  has table-span semantics in 0.1.0.
- Row tokenisation scans left to right. A pipe is a column delimiter only
  when it is not backslash-escaped and is not inside a complete atomic inline
  token already recognised by the inline scanner. Complete inline-code spans,
  direct Markdown links/images, autolinks, and MIB wrappers are atomic for this
  purpose. `\|` contributes a literal pipe to cell inline input rather than a
  column boundary.
- Blank lines before and after the table are optional in normal parser mode,
  provided the table start and end are unambiguous through the separator
  line, context identity, and local syntax boundaries. In strict mode and in
  canonical output there is exactly one blank line before and after the table,
  except at document, container, or immediate ID boundaries.
- No nested tables.
- Table confirmation happens with exactly one logical line of lookahead: only
  the separator line in line 2 confirms the table block.
- A candidate first table line is considered only after outer structural
  quote/list/footnote openers at the same logical baseline have been ruled out.
  A line already recognised as one of those structural openers cannot be
  reinterpreted as a table header because its next line resembles a separator.
- Header and separator line must have the same context identity after removal
  of their already-established outer list and quote prefixes. If that structural
  context differs, no table arises.
- The one-line confirmation buffer operates after the outer structure layer and
  before leaf-block dispatch; it causes no input rewind.

The semantic table model is positional and contains no span geometry:

```text
Table {
  alignments: NonEmptyArray<Alignment>
  head: TableRow
  body: Array<TableRow>
}

TableRow {
  cells: Array<TableCell>       // length == alignments.length
}

TableCell {
  children: Array<InlineWithoutBreak>
}
```

### 12.4 Canonical formatting

Canonical tables use compact GFM-style cells without display-width padding:

```text
| Name | Value | Unit |
| --- | ---: | --- |
| Width | 100 | px |
| Height | 50 | px |
```

Rules:

- leading and trailing `|` are canonical;
- one ASCII space separates each cell's content from its surrounding pipes;
- separator cells use the shortest canonical marker that preserves alignment:
  `---`, `:---`, `---:`, or `:---:`;
- cell contents are serialized by the ordinary inline formatter;
- cell contents are not padded to equal visual width;
- canonical serialization therefore does not depend on grapheme-width,
  terminal-width, font, locale, or `Intl.Segmenter` heuristics.

### 12.5 Collision freedom

`|` as a column delimiter does not split a complete atomic inline token listed
in 12.3. This is a deliberate Markanto delta from raw GFM row splitting and is
part of the deterministic table tokenizer. Escaped `\|` is likewise never a
column delimiter.

`^` and `<` intentionally have no special table-cell role; authors who need
merged cells use fenced Grid syntax. This keeps ordinary pipe tables graceful
and prevents a familiar GFM surface from silently acquiring layout semantics.

### 12.6 Conversion to CommonMark/GFM

Structurally lossless for the table shape itself. Markanto is stricter than GFM
about body-row cell counts and has its own atomic row tokenizer, so not every GFM
table source is directly valid Markanto. Markanto-specific inline semantics in
cells are converted by their ordinary inline export rules.

### 12.7 Import from CommonMark/GFM

Import accepts GFM tables that can be represented with a uniform Markanto column
count; GFM body-row padding/truncation must be made explicit during the import
transformation or reported as a conversion diagnostic. Import is an AST
conversion path, not additional tolerance in the normal Markanto parser. The
formatter normalises to canonical compact formatting with leading/trailing `|`
and no display-width padding.

---

## 13. Autolinks

### 13.1 Purpose

Autolinks make bare URLs and email addresses in running text clickable — a
short form for a direct Markdown link without its own link text. AST node:
`Autolink { kind: 'url' }` or `Autolink { kind: 'email' }`. The
parser recognises URL autolinks in two surface forms — bracketed (13.2) and
bare (13.2a) — both producing the same `Autolink { kind: 'url' }` node;
email autolinks remain valid only in the bracketed form.

### 13.2 Syntax (bracketed)

```text
<https://example.org>
<https://example.org/path?query=value>
<user@example.org>
```

Formally:

```regex
<(https?://[^\s<>]+)>
<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>
```

### 13.2a Syntax (bare)

```text
More on this at https://example.org/path.
Details (see https://example.org/spec#chapter-13) in the appendix.
```

Recognition: the literal `http://` or `https://` at an opener position valid
per 10.3 (character before S or P, not W) triggers the scan. Markanto's opener
rule is its own; it does **not** claim to import the complete GFM extended-
autolink recognition grammar. The scanner greedily reads the longest
contiguous run containing neither Unicode whitespace, `<`, nor `>`, then applies the
GFM 0.29 **extended autolink path validation** rules:

1. **Trailing punctuation:** repeatedly split off trailing `?`, `!`, `.`, `,`,
  `:`, `*`, `_`, or `~` characters.
2. **Parentheses:** if the remaining run ends in `)` and contains more `)` than
  `(` overall, split unmatched trailing `)` characters until the counts no
  longer have an excess closing parenthesis.
3. **Entity-like semicolon:** if the remaining run ends in `;` and the suffix
  immediately before it is `&` followed by one or more ASCII alphanumeric
  characters, split off that complete `&name;` suffix. A semicolon not in this
  entity-like shape remains part of the URL.

These operations are deterministic post-processing of the greedily-read token;
they require no competing parse/backtracking.

After all trailing-punctuation processing, the remaining value is validated
again against the bracketed URL body `https?://[^\s<>]+`. If it does not match,
the triggered candidate is a syntax error rather than literal-text fallback;
otherwise a formatter could not reproduce that literal `http://`/`https://`
prefix without changing its semantics. Bare and bracketed URL forms thus
produce exactly the same canonically representable value domain.

```text
(see https://example.org/path)   → autolink "https://example.org/path", ")" stays text
More: https://example.org.       → autolink "https://example.org", "." stays text
https://example.org/a(b)         → autolink "https://example.org/a(b)" — parentheses balanced, nothing trimmed
https://example.org/a(b))        → autolink "https://example.org/a(b)", last ")" stays text
```

No link text, no title — as with the bracketed form. Bare email autolinks
(email addresses without `<…>`) do **not** exist — email autolinks remain
valid only in the form 13.2 (higher false-positive risk with mere
`word@word.tld` recognition in running text, e.g. in code examples or
handles).

### 13.3 Rules

- Autolinks are inline elements — they stand in running text.
- The URL or email address is treated literally — no inline markup within.
  This also applies to the bare form: reserved characters such as `_`, `~`,
  `-`, `:`, `/` within a recognised bare URL are not interpreted as markup.
- No link text possible — use `[Link text](URL "Title")` for that.
- Only `https://` and `http://` as URL schemes — no `ftp://`, `mailto:`,
  etc. Applies to both surface forms.
- Email addresses are rendered as a `mailto:` link; bracketed form only
  (13.2), no bare recognition.
- Spaces within the `<…>` are not permitted.
- Bare URLs (13.2a) are additionally subject to trailing-punctuation
  trimming; whitespace ends the run in any case.
- Literal display without linking (recognised automatically neither
  bracketed nor bare): use an inline-code span (`` `http://example.org` ``)
  — code spans have higher scanner priority (10.4) and prevent
  any further inline recognition.

### 13.4 Distinction from the direct Markdown link

|  | Autolink | Markdown link |
| --- | --- | --- |
| Link text | no | yes |
| Title | no | yes |
| Inline markup in the text | no | yes |
| Writing effort | minimal | explicit |

Autolinks are the short form for bare URLs; the full form is the direct
Markdown link.

### 13.5 Canonical formatting

- Autolinks always with `<` and `>` — no bare URLs without delimiters. This
  also applies: the bare form (13.2a) is pure **parser
  tolerance** on reading, never canonical output.
  `format(parse("See https://example.org."))` produces
  `See <https://example.org>.` — the same "read tolerantly, write
  canonically" principle as for other tolerated forms in this specification
  (core principle 1).
- No spaces between `<` and the URL.

### 13.6 Conversion to CommonMark/GFM

Direct export — CommonMark and GFM support the same `<URL>` syntax.

### 13.7 Import from CommonMark/GFM

Direct import. Bare URLs (the GFM autolink extension) are already recognised
natively by the regular parser (13.2a) — no import-specific
special handling needed. The canonical formatting normalises as always to
`<URL>` (13.5), regardless of whether the source was imported or hand-written.

---

## 14. Mathematics

### 14.1 Purpose

Mathematical expressions are written in LaTeX syntax and displayed by a
renderer. Markanto adopts the `` $`…`$ `` syntax
introduced by GitLab and confirmed by GitHub — it prevents collisions with
dollar signs in running text. AST-semantically, `InlineMath` or `MathBlock`
arises.

### 14.2 Inline math

```text
This holds for $`E = mc^2`$ in physics.
The Pythagorean theorem: $`a^2 + b^2 = c^2`$.
```

Formally: `` $`…`$ `` — the backtick span protects the LaTeX content
literally (no inline markup parsing), `$` is the semantic signal to the
renderer.

**Rules:**

- Content is treated literally — no escaping, no inline markup.
- No space between `$` and `` ` ``.
- Not across line boundaries.
- No empty content.
- The literal closing sequence `` `$ `` cannot occur inside `InlineMath.value`;
  the first such sequence closes the construct and no inline-math escape exists.

### 14.3 Block math

````text
```math
\left( \sum_{k=1}^n a_k b_k \right)^2
\leq
\left( \sum_{k=1}^n a_k^2 \right) \left( \sum_{k=1}^n b_k^2 \right)
```
````

```` ```math ```` is a canonical code-fence info string — the same mechanism as
```` ```javascript ````, but with math rendering instead of syntax highlighting.
No container of its own needed.

**Rules:**

- Content is literal — no parsing.
- `MathBlock.value` follows the same fenced-literal newline rule as
  `CodeBlock.value` (2.4): the physical LF immediately preceding the closing
  fence is structural and excluded from the semantic value; earlier LFs
  between content lines are preserved.
- The renderer processes the content directly.
- Multi-line expressions are permitted.

### 14.4 Collision freedom

`$` alone in running text (prices, shell variables) is not a math trigger —
only `` $` `` opens inline math. This is the decisive advantage over `$…$`:
`$100` and `$PATH` are never math.

### 14.5 Rendering

The choice of mathematics rendering library is outside Markanto Core. A
renderer may use KaTeX, MathJax, native math support, or another implementation
without changing the document AST.

### 14.6 Conversion to CommonMark/GFM

GitHub supports both syntaxes (a GitHub extension, not formal GFM) — export
is lossless. CommonMark without an extension: no math support, export as a
code block.

---

## 15. Summary block grammar

This chapter collects recognition rules already defined normatively in the
preceding chapters. It does not introduce additional semantics.

### 15.1 Block recognition priority

On each logical content baseline, a parser recognises structurally specific
blocks before falling back to paragraph text. The relevant order is:

1. active literal/fenced closer belonging to the current context;
2. blank line;
3. a legal context-dependent postfix for the just-completed construct, including
  quote attribution, block-resource caption, or block ID where permitted;
4. confirmed lined container (anonymous `___` or header + lookahead);
5. fenced container `:::`;
6. code/math fence or HTML comment construct;
7. ATX heading;
8. thematic break;
9. quote/list/footnote structural openers;
10. confirmed table (only when step 9 did not already claim the first line);
11. standalone block resource;
12. paragraph.

Escapes are accounted for before a candidate marker run is accepted as a
container fence. Table and typed-lined confirmation each use at most one
logical line of lookahead. A later table separator never retroactively overrides
a structural opener recognised at step 8. A line that is the active closer for the current
container/literal context cannot simultaneously serve as lookahead confirmation
for a nested typed lined container or any competing opener.

### 15.2 Container summary

```ebnf
linedFence = "_", "_", "_", { "_" } ;
fencedFence    = ":", ":", ":", { ":" } ;

linedHead  = TYPE, [ " ", TITLE ] ;
fencedOpen     = fencedFence, [ " ", TYPE, [ " ", TITLE ] ] ;
```

Canonical opener and closer fence length is exactly three. In normal mode an
opener run of length `n >= 3` is closed only by a same-character run of length
`m >= n` on the same logical baseline. A canonical lined opener is followed
by exactly one blank line before its first content block; normal mode accepts
zero or multiple blank lines there and normalises them to one, while strict mode
requires exactly one. `TYPE` is NFC-normalised and excludes Unicode whitespace,
control characters, `<`, `>`, `[`, `]`, `{`, `}`, `|`, `\`, and `` ` ``.
`TITLE` is a non-empty literal remainder after one ASCII space and exists only when `TYPE` exists.

Lined recognition:

```text
[linedHead LF]
linedFence LF
[blank-line(s) in normal mode; exactly one in canonical form]
content
linedFence LF
```

The header is optional only for the anonymous form and, when present, is
confirmed by the immediately following lined fence. The closer begins on
the same logical content baseline as its opener. A lined container may contain any number of fenced containers as direct children,
freely mixed with ordinary direct content; no deeper Markanto-container nesting is
permitted.

Fenced recognition:

```text
fencedOpen LF
content
fencedFence LF
```

A fenced container may not contain another Markanto container. Both forms
contain at least one block; empty containers are invalid.

### 15.3 Resource summary

```ebnf
mKind = "video" | "audio" | "embed" | "download" ;
mOpen = "<m", [ " ", mKind ], { " ", attribute }, ">" ;
```

Context rules:

- kindless `<m attrs>Text</m>` is inline and requires at least one attribute;
- image identity comes from `![...](...)`; kindless `<m>` may add image
  metadata;
- `video`, `audio`, and `embed` are block-only and contain exactly one
  Markdown link as primary content;
- `download` contains exactly one Markdown link and may be inline or block;
- inline/block-capable resources are block resources exactly when the primary
  resource occupies the complete logical line apart from its optional wrapper
  and caption;
- a block resource may carry one caption: trailing `\`, LF, then one full
  emphasis line whose outer emphasis delimiters are syntax-only caption
  carriers;
- typed-content mismatches are errors, never heuristic reinterpretations.

### 15.4 Attribute summary

```ebnf
attribute   = key, "=", value ;
value       = bareValue | quotedValue ;
quotedValue = '"', { quotedChar | '\\"' | '\\\\' }, '"' ;
```

Bare values are non-empty and exclude Unicode whitespace, `"`, `'`, `\`, `<`,
and `>`. Empty string is `""`. Duplicate keys are errors. Unknown bare keys
are errors; application annotations use lowercase-only `data-*` names and
cannot carry indispensable Core meaning.

Canonical opener order: kind, Core attributes sorted by ascending ASCII byte
order of the key, then `data-*` attributes sorted by ascending ASCII byte order
of the full key.

### 15.5 Canonicalisation summary

- containers: fences canonicalise to exactly three characters;
- lined/fenced `form` is preserved as semantic authorial register;
- `*...*` / `**...**` are preferred over `<i>` / `<b>` whenever safe;
- hard breaks canonicalise to trailing `\`;
- tables use compact unpadded GFM-style serialization and have no cell-span semantics;
- structural escapes use the leftmost-effective canonical position;
- explicit block IDs are preserved;
- generated IDs, automatic slugs, renderer theme hooks, and concrete parser
  resource budgets are outside Core.

## 16. CommonMark/GFM import

### 16.1 Status

CommonMark/GFM import is **reference tooling, not Core** (8.1). It is a
one-directional pipeline stage that runs *before* the Markanto parser:
it consumes CommonMark 0.31.2 / GFM 0.29-gfm source and emits canonical
Markanto source text, together with a list of conversion diagnostics. It never
runs as a parser mode and never changes the Markanto AST of source that the
Markanto parser already accepts.

The per-construct subsections 3.21, 9.16, 11.9, and 13.7 are normative for the
individual transforms; this chapter states the shared contract.

### 16.2 Pipeline

1. Parse the input with a standards-conforming CommonMark/GFM parser into a
  CommonMark AST.
2. Apply the construct transforms below.
3. Serialise the result as canonical Markanto source (the same canonical form
  the Markanto formatter would produce).
4. Return that source plus an ordered list of conversion diagnostics.

The output is plain Markanto source. Re-parsing it with the Markanto parser in
strict mode must succeed and must be byte-stable under the formatter.

### 16.3 Construct transforms

| CommonMark/GFM input | Import result |
| --- | --- |
| reference link/image `[text][label]`, `[text][]`, `[text]` + `[label]: dest "title"` | resolved to the direct form `[text](dest "title")` / `![alt](dest "title")` with a `resolved` diagnostic, and the definition line dropped. An unresolved reference is indistinguishable from ordinary bracket text after standards-conforming CommonMark parsing (it is not a link node); it is left as its literal text with no diagnostic, matching CommonMark. A definition line with no matching reference is dropped with a `dropped` diagnostic. |
| lazy continuation inside a block quote | every belonging physical line receives the full explicit quote prefix (3.21) |
| Setext heading | converted to the equivalent ATX heading |
| indented code block | converted to a fenced code block |
| `_`-form thematic break | converted to `---` |
| `***`/`___` mixed or padded thematic break | converted to `---` |
| trailing-space hard break | converted to the canonical trailing `\` |
| CRLF / lone CR / BOM | normalised to LF / removed |
| raw HTML block or raw inline HTML | not representable; emitted as a diagnostic and either dropped or escaped as literal text per import option |
| autolink / bare URL | mapped to chapter 13 forms |

Any construct with no representable canonical Markanto form produces a
diagnostic rather than a guessed rewrite.

### 16.4 Diagnostics

Import diagnostics are a separate taxonomy from parser/validator diagnostics
(7.8). Each carries a source location in the *input*, a category
(`resolved`, `dropped`, `escaped`, `unrepresentable`), and a human-readable
message. Import diagnostics never make the resulting Markanto source invalid;
they describe what the transform did.
