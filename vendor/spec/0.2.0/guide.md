# Markanto for Markdown writers

Markanto is Markdown as you know it, with a few things more and a few forms less. Whatever you write in CommonMark or
GitHub's Markdown is, for the most part, already Markanto. This page names only the differences; the
[specification](spec.md) is the full reference.

## What stays the same

Headings with `#`, paragraphs, `*emphasis*` and `**strong**`, `` `code` ``, fenced code blocks, lists with `-`, `*`,
`+` or `1.`, task lists (`- [ ]`, `- [x]`), links and images (`[text](url "title")`, `![alt](picture.jpg)`), quotes
with `>`, pipe tables, `~~strikethrough~~`, `---` as a break, and backslash escapes. A bare `https://` address becomes
a link.

Some accepted forms are written back in one canonical form: `_emphasis_` as `*emphasis*`, `__strong__` as
`**strong**`, `***` as `---`, `~~~` fences as ```` ``` ````. They mean the same.

## Written differently

- **Headings only with `#`.** A line underlined with `===` or `---` is an error, not a heading. A heading is never
  empty.
- **Code only in fences.** Four spaces in front of a line make no code block; the indentation is dropped, with a
  warning.
- **Links only directly.** `[text](https://example.org)` is a link; the reference form `[text][1]` with a line
  `[1]: https://example.org` stays text.
- **No HTML.** `<br>`, `<kbd>`, `<details>` and every other tag are shown as written. The exceptions are a comment,
  `<!-- … -->`, which is never shown, and Markanto's own `<m>`, `<i>` and `<b>` (below).
- **A line break ends the line with `\`.** Two trailing spaces are read as one too and written as `\`.
- **Lists nest by two spaces per level**, under numbered items too:

  ```markdown
  1. First
    still the first, continued
  2. Second
    - a point under it
  ```

  A level is at most one deeper than the line before it.
- **Every line of a quote starts with `>`.** A line without it ends the quote.
- **A table row has as many cells as its header.** A shorter or longer row is an error.
- **`___` on a line of its own opens a container** (below); a break is `---`.

## A few things more

| Write | For |
| --- | --- |
| `H~2~O`, `x^2^` | subscript, superscript |
| `==marked==` | highlighted text |
| `++inserted++`, `~~deleted~~` | an edit: text added, text removed |
| `--outdated--` | text that stays but no longer holds |
| `` $`E = mc^2`$ `` | inline maths (LaTeX) |
| `<m lang=fr>bonjour</m>` | a language, or other metadata, for a part of the text |
| `a<i>b</i>c`, `a<b>b</b>c` | emphasis inside a word |
| `Text.[^1]` and a line `[^1]: The note.` | a footnote; its text is a single paragraph |
| `## Introduction {#intro}` | an id of your own for a heading |

A block of maths is a fence with `math`:

````markdown
```math
a^2 + b^2 = c^2
```
````

A caption follows a picture after a `\`, as one emphasised line:

```markdown
![A harbour at dawn](harbour.jpg)\
*Lisbon, early in the morning*
```

A quote can name its source on the line right after it:

```markdown
> Kill two birds with one stone.
-- proverb
```

A container groups blocks under a type of your choosing and an optional title:

```markdown
::: Note Before you start
Everything in here belongs to the note.
:::
```

A definition list puts each term after `: `, its definition indented below:

```markdown
: Kerning

  The space between two letters.
```

Video, audio, an embedded page and a download are a link in an `<m>`:

```markdown
<m video>[The harbour at dawn](harbour.mp4)</m>

<m download>[The whole text as PDF](text.pdf)</m>
```

An `<m>` may also carry `data-*` attributes. Markanto gives them no meaning of its own: a program that uses Markanto
may, and its documentation names them.

## One form for each meaning

A Markanto formatter writes each document in its one canonical form: `*emphasis*`, `---`, two spaces per list level,
`\` for a line break. Whatever accepted form you write means the same, and formatting twice changes nothing more.
