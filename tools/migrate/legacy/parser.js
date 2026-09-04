/**
 * Markanto — Kernparser.
 *
 * Implementiert: Absätze, ATX-Headings, HR, Code-/Math-Fence (Spec 2.1,
 * 2.2, 2.4, 15.7); Listen — einfache und strukturierte Listenelemente mit
 * verschachtelten Unterlisten (Spec 9.2–9.9, 9.11–9.13 teilweise); Zitate
 * mit Blattblöcken und verschachtelten Listen (Spec 3.1–3.11, 3.14–3.17);
 * Zitat als strukturiertes Listenelement-Kind sowie die nicht-rekursive
 * List→Zitat→List-Interaktion inkl. `maxMixedContainerDepth` (Spec 3.12,
 * 9.10); Inline-Grammatik — Escaping, Inline-Code, Inline-Math, Autolink,
 * Em/Strong/Strike/Insert/Mark/Sup/Sub inkl. Delimiter-Flanking, Nesting-
 * Validierung, Hard-/SoftBreak-Erkennung und HTML-Entity-Dekodierung
 * (benannt gegen die vollständige generierte HTML5-Tabelle, dezimal/hex,
 * Spec Kapitel 10 inkl. 10.8.1, siehe inline.ts für Details und
 * dokumentierte Interpretationsentscheidungen);
 * Tabellen — GFM-Pipe-Syntax, Ausrichtung, Ein-Zeilen-Lookahead, als
 * Kind-Block in Listenelementen und Zitaten (Spec Kapitel 12); Ressourcen —
 * Markdown-Link/-Bild, Block-Ressourcen über `<f>`/`<v>`/`<au>`/`<e>`,
 * Attribute direkt am Wrapper, Caption-Postfix und `<m>`-Spans,
 * als Kind-Block in Listenelementen und Zitaten (Spec Kapitel 4, 5.1,
 * 5.3, 5.4, 5.9 — siehe resource.ts für die
 * geteilte Ziel-/Attribut-Grammatik und dokumentierte
 * Interpretationsentscheidungen); Directive/Fenced Container — beide
 * Register mit optionalem Titel, unmittelbare Fenced-Kinder ausschließlich
 * in Directive Containern (Spec 2.6, 2.7); Fußnoten — Inline-Referenz
 * (`[^id]`) und Blockdefinition
 * (`[^id]: Text`, ausschließlich auf Dokumentebene, Spec 11.3), kanonische
 * Reihenfolge in `Document.footnotes` (referenziert zuerst nach erstem
 * Auftreten, dann unreferenziert alphabetisch — Spec 11.5, 11.7; siehe
 * `orderFootnoteDefinitions`/`collectFootnoteReferenceOrder`). Bewusst NICHT
 * geprüft: "Referenz ohne Definition"/"Definition ohne Referenz" (Spec
 * 11.3) sind referenzielle Ganzdokument-Prüfungen, an den Validator
 * delegiert (siehe validator.ts) statt lokal im Parser erzwungen.
 *
 * Priorität 13b (Spec 15.1: "reservierter Blockintroducer mit ungültiger
 * Grammatik → ErrorBlock", z.B. `:::1abc`, `##Heading`, `-  Punkt`) ist
 * ausschließlich im Strict Mode ein Fehler (Maintainer-Entscheidung,
 * nachträglich zur Spec-Formulierung geklärt: die Spec nennt diese
 * Einschränkung explizit nur für nichtkanonische Zitatpräfixe, wollte sie
 * aber nach Rücksprache einheitlich auf alle 13b-Fälle anwenden). Im
 * normalen Modus verhält sich Markanto hier wie CommonMark: eine Zeile, die
 * nicht sauber auf eine Konstruktion passt, wird ohne Fehlermeldung zu
 * gewöhnlichem Absatztext — kein Sonderfall, keine Erkennung. Betroffen:
 * RESERVED_CONTAINER_INTRODUCER_RE (`:::name`/`... name`, Bezeichner beginnt
 * nicht mit Buchstabe),
 * RESERVED_HEADING_RE (`#{2,6}` ohne Leerzeichen — bewusst NICHT ab einem
 * einzelnen `#`, um Fließtext wie Hashtags nicht zu treffen), RESERVED_LIST_RE
 * (Listenmarker gefolgt von 2+ statt genau einem Leerzeichen — bewusst NICHT
 * ganz ohne Leerzeichen, das sieht nie wie ein beabsichtigter Marker aus).
 * Diese Muster sind bewusst eng gefasst ("scharfe Grenzen"), um im
 * Strict Mode keinen harmlosen Fließtext fälschlich abzulehnen.
 *
 * Bekannte Lücke: Zwei oder mehr ASCII-Leerzeichen vor LF im Strict Mode
 *   (dort nicht als HardBreak zulässig, Spec 10.7) werden aktuell nicht
 *   explizit als Syntaxfehler zurückgewiesen, sondern als literaler
 *   Absatzinhalt mit SoftBreak übernommen — vermutlich nicht kanonisch,
 *   nicht abschließend gegen die Spec geprüft.
 *
 * Quelle der Wahrheit: ../../docs/markanto-spec-v0.5.3.md.
 */
import { MarkantoSyntaxError } from './errors.js';
import { InlineSyntaxError, inlineNonEmpty, parseInlineLine } from './inline.js';
import { computeHeadingSlugs } from './heading-slug.js';
import { matchBracketConstruct, matchBracketLabel, matchReferenceDefinitionTail, matchWrapperConstruct, normalizeReferenceLabel, } from './resource.js';
import { computeLineStarts, rangeFromLines, rangeToLineOrEnd } from './sourceRange.js';
const BLOCK_ID = '[A-Za-z0-9_-]+';
const INLINE_SUFFIX_RE = new RegExp(`^(.*) \\{#(${BLOCK_ID})\\}$`);
const STANDALONE_SUFFIX_RE = new RegExp(`^\\{#(${BLOCK_ID})\\}$`);
/** Interner Transport für Strict-Inlinefehler aus der typisierten Listenstruktur. */
class StrictListInlineError extends Error {
    rawContent;
    lineNo;
    next;
    constructor(message, rawContent, lineNo, next) {
        super(message);
        this.rawContent = rawContent;
        this.lineNo = lineNo;
        this.next = next;
        this.name = 'StrictListInlineError';
    }
}
// Bis zu 3 führende ASCII-Leerzeichen toleriert (Maintainer-Entscheidung,
// analog zu CommonMarks eigener Grenze — "noch nicht eingerückt genug für
// Code"; empirisch über compat/ gefunden, siehe AGENTS.md). Kein Capture-
// Group für die Leerzeichen selbst, damit die Gruppenindices von HEADING_RE
// (Hashes/Text) an beiden Verwendungsstellen unverändert bleiben. Im
// Strict Mode nicht kanonisch — siehe Verwendungsstellen (isCanonical-
// Prüfung nach demselben Muster wie bei HR).
const HEADING_RE = /^ {0,3}(#{1,6}) (.*)$/;
// Spec 15.2: "nach mindestens einem Leerzeichen dürfen schließende # folgen"
// — erkennt einen abschließenden #-Lauf, dem echter Whitespace vorausgeht
// (Titel + Leerzeichen + Läufe von #, z.B. "Titel ##" -> "Titel"). Ein
// unmittelbar an den Titel anschließendes # ("Titel###") gilt NICHT als
// Closing-Sequence (fehlender Trenner) und bleibt literal.
const HEADING_CLOSING_HASH_RE = /^(.*?)[ \t]+(#+)[ \t]*$/;
// Titelloser Fall (z.B. "### ###" -> Inhalt nach dem Marker ist nur "###",
// ohne jedes interne Leerzeichen): Maintainer-Entscheidung (2026-08-18,
// analog zu CommonMark) — das PFLICHT-Leerzeichen zwischen Marker und
// Inhalt zählt bereits als das "mindestens eine Leerzeichen" vor der
// Closing-Sequence, es braucht kein zusätzliches internes Leerzeichen.
// Ergebnis ist leerer Inhalt -> Spec 15.2.3.
const HEADING_ONLY_HASHES_RE = /^#+[ \t]*$/;
/**
 * Entfernt eine abschließende #-Sequenz aus `raw` (Spec 15.2), falls
 * vorhanden. `raw` ist der Heading-Inhalt NACH dem Pflicht-Leerzeichen,
 * garantiert nicht leer und beginnt nicht mit Leerraum (siehe Aufrufstellen
 * in classify()/der Konstruktionsstelle, die das vorher ausschließen).
 * Liefert `raw` unverändert zurück, wenn keine Closing-Sequence erkannt
 * wird — Aufrufer prüfen `result !== raw`, um zu erkennen, ob eine
 * Closing-Sequence vorlag (relevant für die Strict-Mode-Ablehnung).
 */
function stripHeadingClosingHashes(raw) {
    const m = HEADING_CLOSING_HASH_RE.exec(raw);
    if (m)
        return m[1];
    if (HEADING_ONLY_HASHES_RE.test(raw))
        return '';
    return raw;
}
// Spec 2.2, formale Regel für den Inhalt vor einem optionalen ID-Suffix.
const HR_CONTENT_RE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,})$/;
const FENCE_OPEN_RE = /^(`{3,}|~{3,})(.*)$/;
const INFOSTRING_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
// Spec 9.3/9.3.1/9.18.1: Marker, gefolgt von genau einem Leerzeichen. Inhalt
// darf nicht mit einem weiteren Leerzeichen beginnen ([^ ].*). Das fünfte
// Alternativglied (:) ist der Definitionslisten-Marker (9.18.1) — kein
// toleranter Modus, anders als bei */+ und N).
const LIST_MARKER_RE = /^( *)(?:([-*+])|([0-9]+)([.)])|(:)) ([^ ].*)$/;
const TASK_MARKER_RE = /^\[([ xX])\] ([^ ].*)$/;
function resolveOptions(options) {
    return {
        lineBreaks: options.lineBreaks ?? 'soft',
        ...(options.lang !== undefined ? { lang: options.lang } : {}),
        strict: options.strict ?? false,
        errorRecovery: options.errorRecovery ?? true,
        maxQuoteDepth: options.maxQuoteDepth ?? 8,
        maxListDepth: options.maxListDepth ?? 8,
        maxMixedContainerDepth: options.maxMixedContainerDepth ?? 4,
    };
}
/**
 * Vorab-Scan über die rohen Dokumentzeilen (Spec 8.2): sammelt
 * `[label]: destination "title"`-Definitionszeilen VOR dem eigentlichen
 * Parse-Durchlauf, da eine Referenzlink-Auflösung (anders als Fußnoten, die
 * nur einen Bezeichner referenzieren und erst am Ende auflösen) ein
 * konkretes `Link.href` benötigt, sobald `[text][label]` inline gescannt
 * wird — ein nachträglicher Auflösungsschritt existiert im AST nicht. Nur
 * Zeilen ab Spaltenposition 0 der Rohquelle zählen (kein Präfix-Abzug für
 * Zitat/Liste) — analog zu Fußnotendefinitionen, die ausschließlich auf
 * Dokumentebene gültig sind (Spec 11.3), nur hier über Zeilenposition statt
 * über containersAllowed erzwungen. Bei mehrfacher Definition desselben
 * (normalisierten) Labels gewinnt die erste (CommonMark-Konvention) — kein
 * Fehler.
 */
function scanReferenceDefinitions(lines) {
    const table = new Map();
    for (const line of lines) {
        if (line[0] !== '[')
            continue;
        if (line[1] === '^')
            continue; // Fußnoten-Territorium, siehe classify()
        const label = matchBracketLabel(line, 0);
        if (label === null || label.raw.trim() === '')
            continue;
        if (line[label.end] !== ':')
            continue;
        let i = label.end + 1;
        while (line[i] === ' ' || line[i] === '\t')
            i++;
        const tail = matchReferenceDefinitionTail(line, i);
        if (tail === null)
            continue;
        const key = normalizeReferenceLabel(label.raw);
        if (table.has(key))
            continue;
        table.set(key, { destination: tail.destination, ...(tail.title !== undefined ? { title: tail.title } : {}) });
    }
    return table;
}
function isBlank(line) {
    return /^[ \t]*$/.test(line);
}
/**
 * Trennt ein optionales einzeiliges `{#id}`-Suffix ab (Heading, HR — Spec
 * 5.1). Die frühere `{id: id}`-Langform wird in v0.4 nicht mehr erkannt.
 */
function stripInlineSuffix(line, _strict) {
    const m = INLINE_SUFFIX_RE.exec(line);
    if (m)
        return { content: m[1], id: m[2] };
    return { content: line };
}
/**
 * Konsumiert eine unmittelbar folgende eigenständige `{#id}`-Zeile, falls
 * vorhanden. Die frühere `{id: id}`-Langform ist entfernt.
 */
function consumeStandaloneSuffix(lines, i, _strict) {
    const line = lines[i];
    if (line === undefined)
        return { next: i };
    const m = STANDALONE_SUFFIX_RE.exec(line);
    if (m)
        return { id: m[1], next: i + 1 };
    return { next: i };
}
function matchListMarker(line) {
    const m = LIST_MARKER_RE.exec(line);
    if (!m)
        return null;
    const indent = m[1].length;
    const rest = m[6];
    if (m[2] !== undefined) {
        return { indent, kind: 'unordered', bullet: m[2], numHasLeadingZero: false, rest };
    }
    if (m[5] !== undefined) {
        return { indent, kind: 'definition', numHasLeadingZero: false, rest };
    }
    const numStr = m[3];
    const num = Number.parseInt(numStr, 10);
    return {
        indent,
        kind: 'ordered',
        num,
        numHasLeadingZero: numStr !== String(num),
        delim: m[4],
        rest,
    };
}
function extractTask(rest) {
    const m = TASK_MARKER_RE.exec(rest);
    if (!m)
        return { content: rest };
    const marker = m[1];
    return { task: marker === ' ' ? 'open' : 'done', content: m[2] };
}
function leadingSpaces(line) {
    let n = 0;
    while (line[n] === ' ')
        n++;
    return n;
}
/**
 * Bis zu 3 führende ASCII-Leerzeichen vor dem ersten `>` werden toleriert
 * (Maintainer-Entscheidung, analog zu Heading/HR — siehe HEADING_RE-
 * Kommentar). Gilt nur für den Zeilenanfang, nicht zwischen verschachtelten
 * `>`-Zeichen. Im Strict Mode nicht kanonisch — Prüfung in parseQuoteRegion
 * (dort werden alle Zeilen der Region ohnehin gemeinsam betrachtet).
 * Bewusste Lücke, unverändert gegenüber vorher: andere nichtkanonische
 * Zitatpräfix-Formen (`>>` ohne Leerzeichen, `>Text` ohne Leerzeichen nach
 * `>`) werden hier weiterhin in JEDEM Modus toleriert — das ist ein
 * separater, vorbestehender Punkt, nicht Teil dieser Änderung.
 */
function parseQuotePrefix(line) {
    let i = 0;
    let leadingSpace = 0;
    while (leadingSpace < 3 && line[i] === ' ') {
        i++;
        leadingSpace++;
    }
    if (line[i] !== '>')
        return { depth: 0, content: line, leadingSpace: 0 };
    let depth = 0;
    while (line[i] === '>') {
        depth++;
        i++;
        if (line[i] === ' ')
            i++;
    }
    return { depth, content: line.slice(i), leadingSpace };
}
/**
 * Zerlegt eine Tabellenzeile in Zell-Rohtexte (Spec 12.2, 12.5): Aufteilung
 * an unescapten `|` außerhalb von Inline-Code-Spans (Ressourcentoken als
 * atomare Einheit ist hier noch nicht relevant, da Ressourcen nicht
 * implementiert sind). Ein optionales führendes/abschließendes `|`
 * entspricht keiner eigenen Zelle.
 *
 * Liefert zusätzlich die 0-basierte Startspalte jeder Zelle im
 * |-getrennten String (für grobe TableCell-SourceRanges; "Spalten anhand
 * der Position im |-getrennten String, grob reicht — exakte Spalten
 * innerhalb einer Zeile sind nicht kritisch, Zeilenebene schon").
 */
function splitTableRow(line) {
    const cells = [];
    const columns = [];
    let current = '';
    let currentStart = 0;
    let i = 0;
    while (i < line.length) {
        const ch = line[i];
        if (ch === '\\' && line[i + 1] !== undefined) {
            current += ch + line[i + 1];
            i += 2;
            continue;
        }
        if (ch === '`') {
            let runLen = 0;
            while (line[i + runLen] === '`')
                runLen++;
            const fence = '`'.repeat(runLen);
            const closeAt = line.indexOf(fence, i + runLen);
            if (closeAt === -1) {
                current += fence;
                i += runLen;
                continue;
            }
            current += line.slice(i, closeAt + runLen);
            i = closeAt + runLen;
            continue;
        }
        if (ch === '|') {
            cells.push(current);
            columns.push(currentStart);
            current = '';
            currentStart = i + 1;
            i++;
            continue;
        }
        current += ch;
        i++;
    }
    cells.push(current);
    columns.push(currentStart);
    if (cells.length >= 2 && cells[0] === '') {
        cells.shift();
        columns.shift();
    }
    if (cells.length >= 1 && cells[cells.length - 1] === '') {
        cells.pop();
        columns.pop();
    }
    return { cells, columns };
}
const DELIM_CELL_RE = /^:?-+:?$/;
/** Prüft, ob `line` eine gültige Trennzeile ist, und liefert die Ausrichtung pro Spalte (Spec 12.2, 12.4). */
function matchDelimiterRow(line) {
    const { cells } = splitTableRow(line);
    if (cells.length === 0)
        return null;
    const alignments = [];
    for (const raw of cells) {
        const cell = raw.trim();
        if (!DELIM_CELL_RE.test(cell))
            return null;
        const left = cell.startsWith(':');
        const right = cell.endsWith(':');
        alignments.push(left && right ? 'center' : left ? 'left' : right ? 'right' : 'default');
    }
    return alignments;
}
/**
 * Ein-Zeilen-Lookahead (Spec 12.3): erst die Trennzeile in Zeile 2
 * bestätigt den Tabellenblock. Eine Kopfzeile ohne `|` wird nicht als
 * Tabellenkandidat geprüft — sonst wäre z.B. "Text\n---" (Absatz gefolgt
 * von HR) mit einer einspaltigen Tabelle ohne Pipe-Zeichen mehrdeutig.
 */
function tryMatchTableStart(lines, i) {
    const headerLine = lines[i];
    if (headerLine === undefined || !headerLine.includes('|'))
        return null;
    const delimLine = lines[i + 1];
    if (delimLine === undefined)
        return null;
    const alignments = matchDelimiterRow(delimLine);
    if (alignments === null)
        return null;
    const { cells: headerCells, columns: headerColumns } = splitTableRow(headerLine);
    if (headerCells.length !== alignments.length)
        return null;
    return { headerCells, headerColumns, alignments };
}
const ATTRIBUTION_RE = /^-- (.+)$/;
/**
 * Prüft, ob `line` VOLLSTÄNDIG (allein auf ihrer logischen Zeile, Spec
 * 4.2.3) eine direkte Markdown-Ressource ist, die zu einem Blockknoten wird
 * (Bild immer; Link nur mit Ressourcen-Discriminator, siehe 15.7). Ein
 * gewöhnlicher Link oder Span bleibt Absatzinhalt (`null`). Ein während des
 * Versuchs geworfener Syntaxfehler wird hier bewusst geschluckt: dieselbe
 * Zeile durchläuft bei fehlendem Block-Match anschließend den normalen
 * Absatzpfad, wo `parseInlineLine` denselben Fehler erneut (und diesmal
 * sichtbar als ErrorBlock) wirft — kein stiller Fehlerverlust.
 */
function tryMatchResourceLine(line, strict, resolveReference, lineStarts, lineNo1, startCol0) {
    const ending = /^(.*?)([ \t]*)\\$/.exec(line);
    const resourceText = ending?.[1] ?? line;
    if (resourceText[0] !== '[' && resourceText[0] !== '!')
        return null;
    try {
        const match = matchBracketConstruct(resourceText, 0, (text, labelStart) => parseInlineLine(text, strict, resolveReference, lineStarts, lineNo1, startCol0 + labelStart), resolveReference, strict);
        if (match === null || match.end !== resourceText.length)
            return null;
        if (match.kind === 'link' || match.kind === 'span')
            return null;
        // Referenzbild im Strict Mode nicht kanonisch (siehe resource.ts,
        // LinkResult.viaReference) — geworfen innerhalb des try, damit derselbe
        // Fehler beim anschließenden Absatz-Fallback erneut sichtbar wird
        // (siehe Funktionskommentar).
        if (strict && match.viaReference === true)
            throw new InlineSyntaxError('Referenzbild im Strict Mode nicht kanonisch');
        return {
            ...match,
            ...(ending !== null ? { hardBreak: true } : {}),
            ...(strict && ending !== null && ending[2] !== '' ? { noncanonicalHardBreakSpacing: true } : {}),
        };
    }
    catch {
        return null;
    }
}
/** v0.5-Wrapper als ein- oder zweizeilige Blockressource. */
function tryMatchWrapperResourceLine(lines, index, strict, resolveReference, lineStarts, lineNo1, startCol0) {
    const first = lines[index];
    if (!/^<(?:f|v|au|e)(?:[ >])/.test(first))
        return null;
    const parseOne = (source) => {
        const match = matchWrapperConstruct(source, 0, (text, contentStart) => parseInlineLine(text, strict, resolveReference, lineStarts, lineNo1, startCol0 + contentStart), resolveReference, strict);
        if (match === null || match.end !== source.length)
            return null;
        if (!('src' in match))
            return null;
        return match;
    };
    try {
        const direct = parseOne(first);
        if (direct !== null)
            return { media: direct, consumed: 1 };
    }
    catch (error) {
        if (!first.endsWith('\\'))
            throw error;
    }
    if (!first.endsWith('\\'))
        return null;
    const next = lines[index + 1];
    if (next === undefined)
        return null;
    const bareCloser = /^<\/(f|v|au|e)>$/.exec(next);
    if (bareCloser !== null) {
        const openTag = /^<(f|v|au|e)(?:[ >])/.exec(first)?.[1];
        if (openTag !== bareCloser[1])
            throw new InlineSyntaxError(`Wrapper <${openTag}> mit unpassendem ${next} geschlossen`);
        const media = parseOne(first.slice(0, -1) + next);
        return media === null ? null : { media, consumed: 2 };
    }
    const closer = /^(\*.*\*)(<\/(f|v|au|e)>)$/.exec(next);
    if (closer === null)
        return null;
    const openTag = /^<(f|v|au|e)(?:[ >])/.exec(first)?.[1];
    if (openTag !== closer[3])
        throw new InlineSyntaxError(`Wrapper <${openTag}> mit unpassendem ${closer[2]} geschlossen`);
    const withoutBreak = first.slice(0, -1) + closer[2];
    const media = parseOne(withoutBreak);
    if (media === null)
        return null;
    const parsedCaption = parseInlineLine(closer[1], strict, resolveReference, lineStarts, lineNo1 + 1, startCol0);
    if (parsedCaption.length !== 1 || parsedCaption[0]?.type !== 'em')
        return null;
    return { media, caption: parsedCaption[0].children, consumed: 2 };
}
/** Baut den passenden Blockknoten aus einem `tryMatchResourceLine`-Treffer (Spec 4.4). */
function buildResourceBlock(match) {
    const attrs = match.attrs !== undefined ? { attrs: match.attrs } : {};
    const title = match.title !== undefined ? { title: match.title } : {};
    if (match.kind === 'image')
        return { type: 'imageBlock', src: match.src, alt: match.alt, ...title, ...attrs };
    if (match.kind === 'video')
        return { type: 'videoBlock', src: match.src, alt: match.alt, ...title, ...attrs };
    if (match.kind === 'audio')
        return { type: 'audioBlock', src: match.src, alt: match.alt, ...title, ...attrs };
    if (match.kind === 'embed')
        return { type: 'embedBlock', url: match.src, alt: match.alt, ...title, ...attrs };
    // 'download' erreicht diese Funktion nie: Der Block-Matcher (tryMatchResourceLine)
    // kennt nur f|v|au|e — Download ist seit v0.5.0 ausschließlich inline über
    // <m data-type=download> möglich (Spec 4.4). DownloadBlock bleibt als AST-Typ
    // erhalten (validator.ts/format.ts weisen ihn explizit zurück), wird aber vom
    // Parser nicht mehr erzeugt.
    throw new Error(`buildResourceBlock: unerwartete Ressourcenart "${match.kind}"`);
}
const DIRECTIVE_HEAD_RE = /^([A-Za-z][A-Za-z0-9_-]*)(?:: (.*\S))?[ \t]*$/;
const DIRECTIVE_FENCE_RE = /^(_{3,})[ \t]*$/;
const CONTAINER_OPEN_RE = /^:::[ \t]+([A-Za-z][A-Za-z0-9_-]*)(?:: (.*\S))?[ \t]*$|^:::([A-Za-z][A-Za-z0-9_-]*)(?:: (.*\S))?[ \t]*$|^:::[ \t]*$/;
const CONTAINER_CLOSE_RE = /^:::[ \t]*$/;
const RESERVED_CONTAINER_INTRODUCER_RE = /^:::/;
// Priorität 13b, Spec 15.1: "##Heading" — zwei bis sechs `#` OHNE
// nachfolgendes Leerzeichen. Bewusst NICHT ab einem einzelnen `#` (kollidiert
// sonst mit Hashtag-artigem Fließtext wie "#hashtag" oder "#5 Bestseller")
// und bewusst NICHT ab sieben `#` (das ist Priorität 8b — "sieben oder mehr
// `#`" —, hier nicht implementiert; das Muster unten trifft solche Zeilen
// wegen des Backtrackings über alle Längen 2..6 ohnehin nie, da nach jeder
// Länge erneut ein `#` folgt). Bis zu 3 führende Leerzeichen toleriert,
// konsistent mit HEADING_RE (Maintainer-Entscheidung zur Leerraum-Toleranz).
const RESERVED_HEADING_RE = /^ {0,3}#{2,6}[^#\s]/;
// Priorität 13b: "-  Punkt" — Listenmarker (kanonisch `-`, tolerant `*`/`+`,
// geordnet `N.`/`N)`, definition `:` — Spec 9.18.1) gefolgt von ZWEI ODER
// MEHR Leerzeichen statt genau einem. Bewusst NICHT ohne jedes Leerzeichen
// ("-Text") — das sieht nie wie ein beabsichtigter Marker aus und bleibt
// immer gewöhnlicher Text.
const RESERVED_LIST_RE = /^( *)(?:[-*+]|[0-9]+[.)]|:)  +[^ \t]/;
// Spec 11.2 gibt exakt ein Leerzeichen an; 15.7s footnoteDefBlock-Produktion
// verwendet die allgemeine S-Produktion ([ \t]+, Spec 5.4) — hier wie an
// anderer Stelle im tolerant gelesenen Grammatikteil die weitere Fassung.
const FOOTNOTE_DEF_RE = /^\[\^([A-Za-z0-9_-]+)\]:[ \t]+(.+)$/;
/**
 * Container-Titel werden ohne Quellquotierung gespeichert. Nur eine den
 * gesamten Rest umschließende Form mit unescaptem Schluss-`"` gilt als
 * quotiert; andernfalls bleibt der Rest einschließlich Anführungszeichen
 * gewöhnlicher unquotierter Titeltext (Spec 2.7).
 */
function parseContainerTitle(raw) {
    if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2)
        return raw;
    let slashCount = 0;
    for (let i = raw.length - 2; i >= 0 && raw[i] === '\\'; i--)
        slashCount++;
    if (slashCount % 2 === 1)
        return raw;
    const inner = raw.slice(1, -1);
    let out = '';
    for (let i = 0; i < inner.length; i++) {
        if (inner[i] === '\\' && (inner[i + 1] === '\\' || inner[i + 1] === '"')) {
            out += inner[i + 1];
            i++;
        }
        else {
            out += inner[i];
        }
    }
    return out;
}
function formatCanonicalContainerTitleValue(title) {
    if (!title.includes(':'))
        return title;
    return `"${title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
function matchDirectiveStart(lines, i, strict) {
    const head = lines[i];
    const fence = lines[i + 1];
    if (head === undefined || fence === undefined)
        return null;
    const hm = DIRECTIVE_HEAD_RE.exec(head);
    const fm = DIRECTIVE_FENCE_RE.exec(fence);
    if (hm === null || fm === null)
        return null;
    const title = hm[2] !== undefined ? parseContainerTitle(hm[2]) : undefined;
    if (title === '')
        return null;
    const canonicalError = strict && title !== undefined && hm[2] !== formatCanonicalContainerTitleValue(title)
        ? 'Nicht-kanonischer Directive-Container-Titel im Strict-Modus'
        : undefined;
    return { name: hm[1], ...(title !== undefined ? { title } : {}), fenceLength: fm[1].length, ...(canonicalError !== undefined ? { canonicalError } : {}) };
}
/**
 * Klassifiziert eine physische Zeile als Blockanfang. Wird sowohl im
 * Hauptdispatch als auch beim Sammeln von Absatzzeilen verwendet, damit
 * beide dieselbe Vorstellung von "eindeutiger Blockanfang" (Spec 2.5) haben.
 */
function classify(line, strict) {
    if (isBlank(line))
        return { kind: 'blank' };
    const { depth } = parseQuotePrefix(line);
    if (depth >= 1)
        return { kind: 'quote' };
    const containerMatch = CONTAINER_OPEN_RE.exec(line);
    if (containerMatch) {
        const rawName = containerMatch[1] ?? containerMatch[3];
        const rawTitle = containerMatch[2] ?? containerMatch[4];
        const title = rawTitle !== undefined ? parseContainerTitle(rawTitle) : undefined;
        if (title === '')
            return { kind: 'reservedMarkerError', reason: 'Container-Titel darf nicht leer sein' };
        if (strict && containerMatch[3] !== undefined)
            return { kind: 'reservedMarkerError', reason: 'Leerzeichen nach ::: fehlt im Strict Mode' };
        if (strict && title !== undefined && rawTitle !== formatCanonicalContainerTitleValue(title)) {
            return { kind: 'reservedMarkerError', reason: 'Nichtkanonische Container-Titelquotierung' };
        }
        return title === undefined
            ? { kind: 'fencedContainerOpen', name: rawName ?? null }
            : { kind: 'fencedContainerOpen', name: rawName ?? null, title };
    }
    // Reservierter Blockintroducer mit ungültiger Grammatik (Spec 15.1,
    // Priorität 13b) — z.B. ":::1abc" (Bezeichner beginnt nicht mit Buchstabe).
    // Nur im Strict Mode ein Fehler (Maintainer-Entscheidung, siehe unten bei
    // RESERVED_HEADING_RE/RESERVED_LIST_RE für die volle Begründung): im
    // normalen Modus verhält sich Markanto hier wie CommonMark — was nicht
    // sauber auf eine Konstruktion passt, bleibt kommentarlos Fließtext.
    if (strict && RESERVED_CONTAINER_INTRODUCER_RE.test(line)) {
        return { kind: 'reservedMarkerError', reason: 'Ungültiger Container-Bezeichner' };
    }
    // Fußnotendefinition (Spec 11.2, 15.1 Priorität 10). Syntaktisch immer
    // erkannt — der Hauptdispatch entscheidet kontextabhängig (nur auf
    // Dokumentebene, Spec 11.3), ob daraus eine echte Definition wird oder
    // die Zeile (z.B. innerhalb einer Liste) als gewöhnlicher Absatz mit
    // Inline-Fußnotenreferenz weiterverarbeitet wird.
    const footnoteDefMatch = FOOTNOTE_DEF_RE.exec(line);
    if (footnoteDefMatch)
        return { kind: 'footnoteDef', identifier: footnoteDefMatch[1], text: footnoteDefMatch[2] };
    // Referenzlink-Definition (Spec 8.2, tolerante Eingabeform), syntaktisch
    // immer erkannt — analog zu footnoteDef entscheidet der Hauptdispatch
    // kontextabhängig (nur auf Dokumentebene), ob daraus eine echte
    // Definition wird oder die Zeile als gewöhnlicher Absatz weiterverarbeitet
    // wird (dort ist "[label]:" ohnehin bereits inert, siehe resource.ts).
    // Label beginnt mit "^": bleibt Fußnoten-Territorium (Priorität 9 geht
    // Priorität 9b vor, Spec 15.1) und wird NIE als Referenzlink-Definition
    // gelesen — unabhängig davon, ob die konkrete Form die Fußnoten-Grammatik
    // selbst erfüllt. Bugfix 2026-08-25: "[^]:" (leeres Fußnoten-Label, von
    // HMD als anonyme Marginalie genutzt) erfüllte FOOTNOTE_DEF_RE nicht
    // (verlangt mindestens ein Zeichen), fiel durch und traf zufällig exakt
    // die Referenzlink-Grammatik — die Zeile wurde als nie verwendete
    // Referenzdefinition gelesen und dadurch spurlos aus der Ausgabe entfernt
    // (kein Fehler, kein Text, keine Fußnote). Jetzt: fällt stattdessen auf
    // gewöhnlichen Absatztext zurück, sichtbar statt spurlos.
    if (line[0] === '[' && line[1] !== '^') {
        const refLabel = matchBracketLabel(line, 0);
        if (refLabel !== null && refLabel.raw.trim() !== '' && line[refLabel.end] === ':') {
            let ri = refLabel.end + 1;
            while (line[ri] === ' ' || line[ri] === '\t')
                ri++;
            if (matchReferenceDefinitionTail(line, ri) !== null)
                return { kind: 'referenceDef' };
        }
    }
    const { content: headingContent } = stripInlineSuffix(line, strict);
    if (HEADING_RE.test(headingContent)) {
        const m = HEADING_RE.exec(headingContent);
        const headingRaw = m[2];
        // Spec 15.2.3: leerer Inhalt (auch nur-Leerraum) ist IMMER ein
        // Syntaxfehler, unabhängig vom Modus — keine Strict-Mode-Einschränkung
        // im Fehlerfall-Katalog, anders als bei Priorität 13b unten.
        if (headingRaw.trim() === '') {
            return { kind: 'reservedMarkerError', reason: 'Leerer Heading-Inhalt (Spec 15.2.3)' };
        }
        // Spec 15.2.4: zwei oder mehr Leerzeichen nach dem Marker sind immer
        // ein Syntaxfehler — headingRaw beginnt bei genau einem Pflicht-
        // Leerzeichen im Marker; ein weiteres führendes Leerzeichen hier
        // bedeutet insgesamt zwei oder mehr.
        if (headingRaw.startsWith(' ') || headingRaw.startsWith('\t')) {
            return { kind: 'reservedMarkerError', reason: 'Zwei oder mehr Leerzeichen nach Heading-Marker (Spec 15.2.4)' };
        }
        const headingStripped = stripHeadingClosingHashes(headingRaw);
        // Spec 15.2: "Im Strict Mode sind schließende # nicht zulässig" — anders
        // als 15.2.3/15.2.4 ausdrücklich strict-mode-spezifisch formuliert.
        if (strict && headingStripped !== headingRaw) {
            return { kind: 'reservedMarkerError', reason: 'Schließende # sind im Strict Mode nicht zulässig (Spec 15.2)' };
        }
        if (headingStripped.trim() === '') {
            return { kind: 'reservedMarkerError', reason: 'Leerer Heading-Inhalt nach Entfernen der schließenden # (Spec 15.2.3)' };
        }
        return { kind: 'heading' };
    }
    // Priorität 13b, nur im Strict Mode (Maintainer-Entscheidung: außerhalb
    // von Strict Mode verhält sich Markanto wie CommonMark — eine Zeile, die
    // nicht sauber auf eine Konstruktion passt, bleibt ohne Fehlermeldung
    // gewöhnlicher Absatztext; "##Heading" ohne Leerzeichen ist im normalen
    // Modus also einfach ein Absatz, der mit "##Heading" beginnt). Die enge
    // Fassung des Musters (siehe RESERVED_HEADING_RE-Kommentar oben) hält
    // auch im Strict Mode Fließtext wie "#hashtag" davon fern, fälschlich als
    // reservierter, ungültiger Blockintroducer erkannt zu werden.
    if (strict && RESERVED_HEADING_RE.test(headingContent)) {
        return { kind: 'reservedMarkerError', reason: 'Heading-Marker ohne Leerzeichen (reserviert)' };
    }
    const { content: hrContent } = stripInlineSuffix(line, strict);
    if (HR_CONTENT_RE.test(hrContent))
        return { kind: 'hr' };
    const fenceMatch = FENCE_OPEN_RE.exec(line);
    if (fenceMatch) {
        const fenceChars = fenceMatch[1];
        const fenceChar = fenceChars[0];
        let rest = fenceMatch[2].replace(/[ \t]+$/, '');
        let hadSpace = false;
        if (rest.startsWith(' ') || rest.startsWith('\t')) {
            hadSpace = true;
            rest = rest.slice(1);
        }
        if (rest === '') {
            return { kind: 'fenceOpen', fenceChar, openLen: fenceChars.length, hadSpace };
        }
        if (INFOSTRING_RE.test(rest)) {
            return { kind: 'fenceOpen', fenceChar, openLen: fenceChars.length, info: rest, hadSpace };
        }
        // Fence-Zeichen, aber kein gültiger Infostring: kein erkannter Blockanfang.
    }
    if (line.startsWith('<!--'))
        return { kind: 'commentOpen' };
    const marker = matchListMarker(line);
    if (marker)
        return { kind: 'listMarker', marker };
    // Priorität 13b, nur im Strict Mode (siehe Begründung bei
    // RESERVED_HEADING_RE oben) — z.B. "-  Punkt" (zwei statt einem
    // Leerzeichen). "-Text" (gar kein Leerzeichen) sieht dagegen nie wie ein
    // beabsichtigter Marker aus und bleibt immer gewöhnlicher Text.
    if (strict && RESERVED_LIST_RE.test(line)) {
        return { kind: 'reservedMarkerError', reason: 'Listenmarker mit ungültigem Leerraum (reserviert)' };
    }
    // Heading/HR haben ausschließlich einzeiliges {#id}-Suffix (Spec 5.1,
    // "Kanonische Regel pro Blockklasse") — keine mehrzeilige Alternativform.
    // Eine {#id}-Zeile direkt nach einem Heading/HR ist deshalb kein gültiges
    // Suffix für diesen Block, sondern verwaist (Fehler unten).
    const orphan = STANDALONE_SUFFIX_RE.exec(line);
    if (orphan)
        return { kind: 'orphanSuffix', id: orphan[1] };
    return { kind: 'other' };
}
/**
 * Erkennt einen Zeilenumbruch-Marker am Ende einer NICHT-letzten Zeile
 * eines mehrzeiligen Inline-Inhalts (Spec 10.7, 10.8): ein abschließender
 * unescapter Backslash — oder tolerant zwei oder mehr ASCII-Leerzeichen —
 * erzwingt einen HardBreak unabhängig vom `lineBreaks`-Modus. `Text\\`
 * (gerade Anzahl Backslashes) ist kein Marker: der letzte Backslash ist
 * escaped (löst zu einem literalen `\` auf), der Zeilenumbruch bleibt
 * modusabhängig. `Text\ ` (Leerzeichen nach dem Backslash) ist ungültig.
 */
function detectLineEnding(line, strict) {
    const wsMatch = /[ \t]+$/.exec(line);
    const beforeTrailingWs = wsMatch ? line.slice(0, line.length - wsMatch[0].length) : line;
    if (beforeTrailingWs.endsWith('\\')) {
        let bsCount = 0;
        while (beforeTrailingWs[beforeTrailingWs.length - 1 - bsCount] === '\\')
            bsCount++;
        if (bsCount % 2 === 1) {
            if (wsMatch)
                throw new InlineSyntaxError('Leerzeichen nach abschließendem Backslash nicht zulässig');
            const withoutBackslash = beforeTrailingWs.slice(0, beforeTrailingWs.length - 1);
            return { content: withoutBackslash.replace(/[ \t]+$/, ''), forceHard: true };
        }
    }
    if (!strict && wsMatch && wsMatch[0].length >= 2) {
        return { content: beforeTrailingWs, forceHard: true };
    }
    return { content: line, forceHard: false };
}
/**
 * ast.ts-Invariante: "Kein FootnoteReference rekursiv in FootnoteDefinition"
 * (Spec 11.3: "Inhalt: Inline-only ... keine weiteren Fußnoten").
 */
function assertNoFootnoteReference(nodes) {
    for (const n of nodes) {
        if (n.type === 'footnoteReference') {
            throw new InlineSyntaxError('Fußnotenreferenz innerhalb einer Fußnotendefinition ist unzulässig');
        }
        if ('children' in n && Array.isArray(n.children)) {
            assertNoFootnoteReference(n.children);
        }
    }
}
/**
 * Absatz-/Heading-Zeilen zu Inline-Kindern. Jede physische Zeile wird
 * EINZELN inline-gescannt (Spec 10.7: Inline-Markup überschreitet keine
 * Zeilengrenze) und über SoftBreak/HardBreak verbunden — Hart je nach
 * `forceHard`-Marker der vorherigen Zeile oder projektweitem `lineBreaks`.
 *
 * `lineNos`/`columnOffsets` sind parallel zu `lines` (siehe parseBlocks''
 * columnOffsets): die 1-basierte Zeilennummer bzw. 0-basierte
 * Original-Spalte des ERSTEN Zeichens jeder Zeile nach Container-Stripping
 * — der Positions-Anker für die SourceRanges aller erzeugten Inline-Knoten.
 * Die Break-Range (Soft-/HardBreak, in der Quelle nur das unsichtbare
 * Zeilenende zwischen zwei physischen Zeilen) läuft vom Ende der vorherigen
 * Zeile (nach ggf. abgeschnittenem Hard-Break-Marker) bis zum Anfang der
 * nächsten Zeile nach dem Strip.
 */
function linesToInline(lines, lineNos, columnOffsets, ctx) {
    // `<m …>`, `<em>` und `<strong>` dürfen als absatzweite Wrapper mehrere
    // physische Zeilen umschließen. Die inneren Zeilen werden weiterhin einzeln durch den
    // normalen Scanner geschickt, sodass Markup selbst nie eine Zeilengrenze
    // überschreitet und der Wrapper keinen zweiten Parserpfad eröffnet.
    if (lines.length > 1) {
        const joined = lines.join('\n');
        const wholeParagraphWrapper = /^<m[ \t]/.test(joined) && joined.endsWith('</m>')
            || joined.startsWith('<em>') && joined.endsWith('</em>')
            || joined.startsWith('<strong>') && joined.endsWith('</strong>');
        if (wholeParagraphWrapper) {
            const wrapper = matchWrapperConstruct(joined, 0, (content) => {
                const contentLines = content.split('\n');
                const children = [];
                for (let idx = 0; idx < contentLines.length; idx++) {
                    if (idx > 0)
                        children.push({ type: ctx.options.lineBreaks === 'hard' ? 'hardBreak' : 'softBreak' });
                    const physicalLine = idx === 0 ? lineNos[0] : lineNos[idx];
                    const col = idx === 0 ? lines[0].indexOf('>') + 1 + columnOffsets[0] : columnOffsets[idx];
                    const parsed = parseInlineLine(contentLines[idx], ctx.options.strict, ctx.resolveReference, ctx.lineStarts, physicalLine, col);
                    children.push(...parsed);
                }
                return children;
            }, ctx.resolveReference, ctx.options.strict);
            if (wrapper !== null && wrapper.kind === 'span' && wrapper.end === joined.length) {
                return [{ type: 'span', attrs: wrapper.attrs, children: inlineNonEmpty(wrapper.children) }];
            }
            if (wrapper !== null && (wrapper.kind === 'em' || wrapper.kind === 'strong') && wrapper.end === joined.length) {
                return [{ type: wrapper.kind, children: inlineNonEmpty(wrapper.children) }];
            }
        }
    }
    const out = [];
    let pendingForceHard = false;
    let prevContentLength = 0;
    lines.forEach((raw, idx) => {
        const lineNo1 = lineNos[idx];
        const col0 = columnOffsets[idx];
        if (idx > 0) {
            out.push({
                type: pendingForceHard || ctx.options.lineBreaks === 'hard' ? 'hardBreak' : 'softBreak',
                range: rangeFromLines(ctx.lineStarts, lineNos[idx - 1] - 1, columnOffsets[idx - 1] + prevContentLength, lineNo1 - 1, col0),
            });
        }
        const isLast = idx === lines.length - 1;
        const { content, forceHard } = isLast ? { content: raw, forceHard: false } : detectLineEnding(raw, ctx.options.strict);
        pendingForceHard = forceHard;
        prevContentLength = content.length;
        // Eine Unterstrich-Fence besitzt nur zusammen mit einer unmittelbar
        // vorausgehenden, gültigen Direktiv-Kopfzeile Blockbedeutung. Im
        // Absatzpfad muss sie deshalb atomar als Text behandelt werden; der
        // allgemeine Inline-Scanner würde `___` andernfalls als ungeschlossenes
        // `__strong__` fehlinterpretieren.
        if (DIRECTIVE_FENCE_RE.test(content)) {
            out.push({
                type: 'text',
                value: content,
                range: rangeFromLines(ctx.lineStarts, lineNo1 - 1, col0, lineNo1 - 1, col0 + content.length),
            });
        }
        else {
            out.push(...parseInlineLine(content, ctx.options.strict, ctx.resolveReference, ctx.lineStarts, lineNo1, col0));
        }
    });
    if (out.length === 0)
        throw new InlineSyntaxError('Leerer Inline-Inhalt');
    return out;
}
/**
 * Parst eine Zeilenfolge zu Blöcken. Wird auf Dokumentebene, rekursiv für
 * den Inhalt einer Zitatebene (Spec 3.9) und rekursiv für den strukturierten
 * Kind-Bereich eines Listenelements (Spec 9.8) aufgerufen. Zeilennummern
 * (für Fehlermeldungen) sind relativ zu `lineOffset`.
 *
 * @param columnOffsets Parallel zu `lines`: wie viele Zeichen der ORIGINALEN
 *   Dateizeile pro Eintrag beim Strip abgeschnitten wurden (Zitatpräfixe,
 *   Listen-Marker/Einrückung). Damit sind die berechneten Spalten/Offsets
 *   der Kind-Blöcke echte Datei-Spalten statt relativ zum gestrippten Inhalt
 *   (Phase-7-Korrektur der zuvor dokumentierten Ungenauigkeit, Spec
 *   4.2.3/7.3.1). Auf Dokumentebene und für nicht gestrippte Inhalte
 *   (Container-Body) ist es ein Null-Array.
 * @param listLevel Ebene, auf der eine hier neu gefundene Liste beginnt.
 *   1 für Dokumentebene und Zitatinhalt (reine Listentiefe setzt dort neu
 *   auf, siehe maxListDepth-Reset bei einer dazwischenliegenden Quote
 *   Region); level+1 für den strukturierten Kind-Bereich eines
 *   Listenelements (dieselbe Listenkette läuft weiter).
 * @param quotePosition Gesetzt, wenn dieser Aufruf den Inhalt EINER
 *   Zitatebene verarbeitet (Spec 9.10): Eine hier gefundene Liste erhält
 *   NEU berechnete MixedInfo aus der Position dieser Zitatregion.
 * @param listItemRegion Gesetzt, wenn dieser Aufruf den strukturierten
 *   Kind-Bereich eines Listenelements verarbeitet (Spec 9.8/3.12): Eine
 *   hier gefundene Liste übernimmt `listMixed` UNVERÄNDERT (Liste-in-Liste
 *   verlängert die Wechselkette nicht); eine hier gefundene Zitatregion
 *   erhält NEU berechnete MixedInfo aus der Position der umgebenden Liste.
 * @param containerContext Unterscheidet Dokumentwurzel, terminalen Fenced-
 *   Inhalt und Directive-Inhalt. Nur letzterer darf unmittelbare Fenced-
 *   Container als Kinder erkennen (Spec 2.7.4).
 */
function parseBlocks(lines, ctx, lineOffset, listLevel = 1, quotePosition, listItemRegion, containerContext = 'root', columnOffsets) {
    const colOf = (idx) => columnOffsets?.[idx] ?? 0;
    const atUnnestedBlockLevel = quotePosition === undefined && listItemRegion === undefined;
    const directiveContainersAllowed = atUnnestedBlockLevel && containerContext === 'root';
    const fencedContainersAllowed = atUnnestedBlockLevel && containerContext !== 'fenced';
    const documentOnlyBlocksAllowed = atUnnestedBlockLevel && containerContext === 'root';
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const lineNo = lineOffset + i + 1;
        const directiveStart = matchDirectiveStart(lines, i, ctx.options.strict);
        if (directiveStart !== null) {
            if (directiveStart.canonicalError !== undefined) {
                blocks.push(ctx.reportError(directiveStart.canonicalError, `${line}\n${lines[i + 1]}`, lineNo, colOf(i)));
                i += 2;
                continue;
            }
            if (!directiveContainersAllowed) {
                blocks.push(ctx.reportError('Directive Container ist hier nicht zulässig', `${line}\n${lines[i + 1]}`, lineNo, colOf(i)));
                i += 2;
                continue;
            }
            const { block, next } = parseDirectiveContainer(lines, i, ctx, lineOffset, directiveStart.name, directiveStart.title, directiveStart.fenceLength, colOf(i));
            blocks.push(block);
            i = next;
            continue;
        }
        const c = classify(line, ctx.options.strict);
        if (c.kind === 'blank') {
            i++;
            continue;
        }
        if (c.kind === 'fencedContainerOpen') {
            if (!fencedContainersAllowed) {
                blocks.push(ctx.reportError('Fenced Container ist hier nicht zulässig', line, lineNo, colOf(i)));
                i++;
                continue;
            }
            const { block, next } = parseFencedContainer(lines, i, ctx, lineOffset, c.name, c.title, colOf(i));
            blocks.push(block);
            i = next;
            continue;
        }
        if (c.kind === 'reservedMarkerError') {
            blocks.push(ctx.reportError(c.reason, line, lineNo, colOf(i)));
            i++;
            continue;
        }
        // Fußnotendefinitionen sind ausschließlich auf Dokumentebene gültig
        // (Spec 11.3) — kein footnoteDefBlock in containerContentBlock/
        // QuoteContentBlock/ListItemBlock (Spec 15.7). Außerhalb dieses
        // Kontexts KEIN continue: die Zeile fällt durch zum Absatz-Fallback
        // unten, wo "[^id]" ganz normal als Inline-Fußnotenreferenz gescannt
        // wird (kein Fehler, nur keine Definition).
        if (c.kind === 'footnoteDef' && documentOnlyBlocksAllowed) {
            if (ctx.footnoteDefs.some((d) => d.identifier === c.identifier)) {
                blocks.push(ctx.reportError(`Doppelte Fußnotendefinition: ${c.identifier}`, line, lineNo, colOf(i)));
                i++;
                continue;
            }
            try {
                // c.text ist der Suffix der Definitionszeile NACH `[^id]:` + [ \t]+
                // — sein Original-Start ist die Zeilenspalte um die Länge des
                // konsumierten Präfixes verschoben.
                const textStartCol0 = colOf(i) + (line.length - c.text.length);
                const children = parseInlineLine(c.text, ctx.options.strict, ctx.resolveReference, ctx.lineStarts, lineNo, textStartCol0);
                assertNoFootnoteReference(children);
                const def = {
                    type: 'footnoteDefinition',
                    identifier: c.identifier,
                    children: inlineNonEmpty(children),
                };
                const { id, next } = consumeStandaloneSuffix(lines, i + 1, ctx.options.strict);
                if (id !== undefined)
                    def.id = id;
                def.range = rangeToLineOrEnd(ctx.lineStarts, ctx.source, lineNo - 1, colOf(i), lineOffset + next, 0);
                ctx.footnoteDefs.push(def);
                i = next;
            }
            catch (e) {
                if (!(e instanceof InlineSyntaxError))
                    throw e;
                blocks.push(ctx.reportError(e.message, line, lineNo, colOf(i)));
                i++;
            }
            continue;
        }
        // Referenzlink-Definitionen (Spec 8.2, tolerante Eingabeform) sind —
        // analog zu Fußnotendefinitionen — ausschließlich auf Dokumentebene
        // gültig: die Vorab-Scan-Tabelle (ctx.resolveReference, aufgebaut in
        // parse() über scanReferenceDefinitions) erfasst ohnehin nur Zeilen ab
        // Spaltenposition 0 der Rohquelle, verschachtelte "[label]: url"-Zeilen
        // (innerhalb Zitat/Liste) landen dort nie. Außerhalb von
        // documentOnlyBlocksAllowed fällt die Zeile daher zum Absatz-Fallback durch —
        // sonst würde eine syntaktisch gültig aussehende, aber nie registrierte
        // Definition fälschlich stillschweigend verschluckt. Kein Fehler bei
        // mehrfachem Vorkommen desselben Labels (CommonMark-Konvention: erste
        // Definition gewinnt, siehe scanReferenceDefinitions) — jede
        // syntaktisch gültige Definitionszeile wird hier verschluckt, unabhängig
        // davon, ob sie die gewinnende ist.
        if (c.kind === 'referenceDef' && documentOnlyBlocksAllowed) {
            // Wie die Verwendungsstelle (tryMatchResourceLine/inline.ts) ist auch
            // die Definitionszeile selbst im Strict Mode nicht kanonisch — es
            // gibt keine kanonische Serialisierung für eine stehengebliebene,
            // unbenutzte oder benutzte Referenzdefinition (kein AST-Knoten dafür).
            if (ctx.options.strict) {
                blocks.push(ctx.reportError('Referenzlink-Definition im Strict Mode nicht kanonisch', line, lineNo, colOf(i)));
                i++;
                continue;
            }
            i++;
            continue;
        }
        // Heading/HR sind kein gültiger ListItemBlock (Spec 9.8; AST-Typ
        // ListItemBlock enthält weder Heading noch HorizontalRule, anders als
        // QuoteContentBlock). Innerhalb eines strukturierten Kind-Bereichs
        // fallen sie daher auf gewöhnlichen Absatztext zurück statt als
        // eigener Blocktyp erkannt zu werden.
        if (c.kind === 'heading' && listItemRegion === undefined) {
            const { content, id } = stripInlineSuffix(line, ctx.options.strict);
            // Bis zu 3 führende Leerzeichen sind nur im Normalmodus toleriert
            // (HEADING_RE-Kommentar) — im Strict Mode nicht kanonisch, analog zur
            // isCanonical-Prüfung bei HR unten.
            if (ctx.options.strict && content.startsWith(' ')) {
                blocks.push(ctx.reportError('Führende Leerzeichen vor Heading im Strict Mode nicht kanonisch', line, lineNo, colOf(i)));
                i++;
                continue;
            }
            const m = HEADING_RE.exec(content);
            const level = m[1].length;
            // classify() hat für c.kind === 'heading' bereits sichergestellt:
            // nicht leer, kein zusätzliches Leerzeichen nach dem Marker, und
            // (im Strict Mode) keine schließende #-Sequenz — hier nur noch
            // dieselbe Closing-Hash-Entfernung wie dort (Spec 15.2).
            const text = stripHeadingClosingHashes(m[2]).trim();
            try {
                // text ist ein (ggf. endgekürztes) Präfix von m[2], das selbst bis
                // zum Ende von `content` reicht — sein Original-Start in der Zeile
                // ist die Spalte von `content` um die Offset-Länge von m[2] verschoben.
                const textStartCol0 = colOf(i) + (content.length - m[2].length);
                const heading = {
                    type: 'heading',
                    level,
                    children: parseInlineLine(text, ctx.options.strict, ctx.resolveReference, ctx.lineStarts, lineNo, textStartCol0, true),
                    ...(id !== undefined ? { id } : {}),
                    range: rangeToLineOrEnd(ctx.lineStarts, ctx.source, lineNo - 1, colOf(i), lineNo, 0),
                };
                blocks.push(heading);
            }
            catch (e) {
                if (!(e instanceof InlineSyntaxError))
                    throw e;
                blocks.push(ctx.reportError(e.message, line, lineNo, colOf(i)));
            }
            i++;
            continue;
        }
        if (c.kind === 'hr' && listItemRegion === undefined) {
            const { content, id } = stripInlineSuffix(line, ctx.options.strict);
            const isCanonical = content === '---';
            if (ctx.options.strict && !isCanonical) {
                blocks.push(ctx.reportError('Nicht-kanonische horizontale Linie im Strict Mode', line, lineNo, colOf(i)));
            }
            else {
                const hr = {
                    type: 'horizontalRule',
                    ...(id !== undefined ? { id } : {}),
                    range: rangeToLineOrEnd(ctx.lineStarts, ctx.source, lineNo - 1, colOf(i), lineNo, 0),
                };
                blocks.push(hr);
            }
            i++;
            continue;
        }
        if (c.kind === 'fenceOpen') {
            const openLineNo = lineNo;
            const { fenceChar, openLen, info, hadSpace } = c;
            const contentLines = [];
            let closeLen = null;
            let j = i + 1;
            for (; j < lines.length; j++) {
                const candidate = lines[j];
                const closeRe = fenceChar === '`' ? /^(`+)[ \t]*$/ : /^(~+)[ \t]*$/;
                const closeMatch = closeRe.exec(candidate);
                if (closeMatch && closeMatch[1].length >= openLen) {
                    closeLen = closeMatch[1].length;
                    break;
                }
                contentLines.push(candidate);
            }
            if (closeLen === null) {
                const rawContent = lines.slice(i, lines.length).join('\n');
                blocks.push(ctx.reportError('Code-Fence nicht geschlossen', rawContent, openLineNo, colOf(i)));
                i = lines.length;
                continue;
            }
            const rawContent = lines.slice(i, j + 1).join('\n');
            const value = contentLines.join('\n');
            if (info === 'math') {
                const violation = fenceChar === '~'
                    ? 'Tilde-Fence im Strict Mode'
                    : hadSpace
                        ? 'Leerzeichen vor Infostring im Strict Mode'
                        : undefined;
                if (ctx.options.strict && violation !== undefined) {
                    blocks.push(ctx.reportError(`Nicht-kanonische Math-Fence: ${violation}`, rawContent, openLineNo, colOf(i)));
                }
                else {
                    const mathBlock = { type: 'mathBlock', value };
                    const { id, next } = consumeStandaloneSuffix(lines, j + 1, ctx.options.strict);
                    if (id !== undefined)
                        mathBlock.id = id;
                    mathBlock.range = rangeToLineOrEnd(ctx.lineStarts, ctx.source, openLineNo - 1, colOf(i), lineOffset + next, 0);
                    blocks.push(mathBlock);
                    i = next;
                    continue;
                }
                i = j + 1;
                continue;
            }
            const violation = fenceChar === '~'
                ? 'Tilde-Fence im Strict Mode'
                : hadSpace
                    ? 'Leerzeichen vor Infostring im Strict Mode'
                    : undefined;
            if (ctx.options.strict && violation !== undefined) {
                blocks.push(ctx.reportError(`Nicht-kanonische Code-Fence: ${violation}`, rawContent, openLineNo, colOf(i)));
                i = j + 1;
                continue;
            }
            const codeBlock = { type: 'codeBlock', value };
            if (info !== undefined)
                codeBlock.lang = info;
            const { id, next } = consumeStandaloneSuffix(lines, j + 1, ctx.options.strict);
            if (id !== undefined)
                codeBlock.id = id;
            codeBlock.range = rangeToLineOrEnd(ctx.lineStarts, ctx.source, openLineNo - 1, colOf(i), lineOffset + next, 0);
            blocks.push(codeBlock);
            i = next;
            continue;
        }
        if (c.kind === 'commentOpen') {
            const openLineNo = lineNo;
            const firstLine = line;
            let closeLineIdx = -1;
            let closeCharIdx = -1;
            const firstIdx = firstLine.indexOf('-->', 4);
            if (firstIdx !== -1) {
                closeLineIdx = i;
                closeCharIdx = firstIdx;
            }
            else {
                for (let j = i + 1; j < lines.length; j++) {
                    const idx = lines[j].indexOf('-->');
                    if (idx !== -1) {
                        closeLineIdx = j;
                        closeCharIdx = idx;
                        break;
                    }
                }
            }
            if (closeLineIdx === -1) {
                const rawContent = lines.slice(i, lines.length).join('\n');
                blocks.push(ctx.reportError('HTML-Kommentar nicht geschlossen', rawContent, openLineNo, colOf(i)));
                i = lines.length;
                continue;
            }
            const trailing = lines[closeLineIdx].slice(closeCharIdx + 3);
            if (!/^[ \t]*$/.test(trailing)) {
                const rawContent = lines.slice(i, closeLineIdx + 1).join('\n');
                blocks.push(ctx.reportError('Unerwarteter Inhalt nach Kommentar-Schließer', rawContent, openLineNo, colOf(i)));
                i = closeLineIdx + 1;
                continue;
            }
            const value = closeLineIdx === i
                ? firstLine.slice(4, closeCharIdx)
                : [firstLine.slice(4), ...lines.slice(i + 1, closeLineIdx), lines[closeLineIdx].slice(0, closeCharIdx)].join('\n');
            const commentBlock = { type: 'commentBlock', value };
            commentBlock.range = rangeToLineOrEnd(ctx.lineStarts, ctx.source, openLineNo - 1, colOf(i), lineOffset + closeLineIdx + 1, 0);
            blocks.push(commentBlock);
            i = closeLineIdx + 1;
            continue;
        }
        if (c.kind === 'quote') {
            if (listItemRegion !== undefined) {
                const base = listItemRegion.listMixed;
                if (base?.nonRecursive) {
                    blocks.push(ctx.reportError('Rekursiver Container in nicht-rekursiver Liste nicht zulässig', line, lineNo, colOf(i)));
                    i++;
                    continue;
                }
                const newDepth = (base?.mixedDepth ?? 1) + 1;
                if (newDepth > ctx.options.maxMixedContainerDepth) {
                    blocks.push(ctx.reportError(`Überschreitung von maxMixedContainerDepth (${ctx.options.maxMixedContainerDepth})`, line, lineNo, colOf(i)));
                    i++;
                    continue;
                }
                const { block, trailingError, next } = parseQuoteRegion(lines, i, ctx, lineOffset, colOf(i), { mixedDepth: newDepth, nonRecursive: true });
                blocks.push(block);
                if (trailingError !== undefined)
                    blocks.push(trailingError);
                i = next;
                continue;
            }
            const { block, trailingError, next } = parseQuoteRegion(lines, i, ctx, lineOffset, colOf(i));
            blocks.push(block);
            if (trailingError !== undefined)
                blocks.push(trailingError);
            i = next;
            continue;
        }
        if (c.kind === 'listMarker') {
            if (c.marker.indent !== 0) {
                // Liste beginnt nicht auf der hier erwarteten Ebene (z.B.
                // versehentlich eingerückter Marker ohne umgebende Struktur) — kein
                // erkannter Blockanfang auf dieser Ebene, an Absatzsammlung
                // durchreichen.
            }
            else {
                let mixedForThisList;
                if (quotePosition !== undefined) {
                    const newDepth = quotePosition.mixedDepth + 1;
                    if (newDepth > ctx.options.maxMixedContainerDepth) {
                        blocks.push(ctx.reportError(`Überschreitung von maxMixedContainerDepth (${ctx.options.maxMixedContainerDepth})`, line, lineNo, colOf(i)));
                        i++;
                        continue;
                    }
                    mixedForThisList = { mixedDepth: newDepth, nonRecursive: quotePosition.nonRecursive };
                }
                else if (listItemRegion !== undefined) {
                    if (listItemRegion.listMixed?.nonRecursive) {
                        blocks.push(ctx.reportError('Rekursiver Container in nicht-rekursiver Liste nicht zulässig', line, lineNo, colOf(i)));
                        i++;
                        continue;
                    }
                    mixedForThisList = listItemRegion.listMixed;
                }
                // maxListDepth gilt unabhängig vom Erreichungsweg — sonst ließe sich
                // die Grenze durch ausschließlich strukturierte (leerzeilengetrennte,
                // Spec 9.8) statt unmittelbarer (Fast-Path, Spec 9.7) Verschachtelung
                // umgehen. Der Fast-Path prüft das bereits selbst (siehe unten in
                // parseList); hier greift derselbe Schwellenwert für den Fall, dass
                // parseBlocks() mit bereits erhöhtem listLevel aufgerufen wird
                // (Bugfix 2026-08-25, direkte Folge der Einrückungskorrektur oben —
                // vorher konnte dieser Pfad mangels funktionierender Verschachtelung
                // gar nicht erst tief genug werden, um die Grenze zu testen).
                if (listLevel > ctx.options.maxListDepth) {
                    blocks.push(ctx.reportError(`Überschreitung von maxListDepth (${ctx.options.maxListDepth})`, line, lineNo, colOf(i)));
                    i++;
                    continue;
                }
                try {
                    // Strukturierter Kind-Bereich eines Listenelements (listItemRegion
                    // gesetzt): `lines` sind bereits um den contIndent der äußeren
                    // Liste gestrippt — eine hier neu gefundene Liste beginnt bei
                    // Einrückung 0, auch wenn ihre Listentiefe (listLevel) weiterläuft
                    // (Bugfix 2026-08-25: vorher erwartete parseList() fälschlich
                    // dieselbe — nicht existente — Einrückung wie listLevel, jedes
                    // Element der Unterliste wurde als "Leere Liste" abgelehnt).
                    const indentLevel = listItemRegion !== undefined ? 1 : listLevel;
                    const { list, next } = parseList(lines, i, listLevel, ctx, lineOffset, colOf(i), mixedForThisList, indentLevel);
                    blocks.push(list);
                    i = next;
                }
                catch (e) {
                    if (!(e instanceof StrictListInlineError))
                        throw e;
                    blocks.push(ctx.reportError(e.message, e.rawContent, e.lineNo, colOf(i)));
                    i = e.next;
                }
                continue;
            }
        }
        if (c.kind === 'orphanSuffix') {
            blocks.push(ctx.reportError('Block-ID-Suffix ohne vorausgehenden Block', line, lineNo, colOf(i)));
            i++;
            continue;
        }
        let wrapperMatch;
        try {
            wrapperMatch = tryMatchWrapperResourceLine(lines, i, ctx.options.strict, ctx.resolveReference, ctx.lineStarts, lineNo, colOf(i));
        }
        catch (error) {
            if (!(error instanceof InlineSyntaxError))
                throw error;
            blocks.push(ctx.reportError(error.message, line, lineNo, colOf(i)));
            i++;
            continue;
        }
        if (wrapperMatch !== null) {
            const block = buildResourceBlock(wrapperMatch.media);
            if (wrapperMatch.caption !== undefined)
                block.caption = wrapperMatch.caption;
            let next = i + wrapperMatch.consumed;
            const { id, next: afterSuffix } = consumeStandaloneSuffix(lines, next, ctx.options.strict);
            if (id !== undefined)
                block.id = id;
            block.range = rangeToLineOrEnd(ctx.lineStarts, ctx.source, lineNo - 1, colOf(i), lineOffset + afterSuffix, 0);
            blocks.push(block);
            i = afterSuffix;
            continue;
        }
        const resourceMatch = tryMatchResourceLine(line, ctx.options.strict, ctx.resolveReference, ctx.lineStarts, lineNo, colOf(i));
        if (resourceMatch !== null) {
            if (resourceMatch.noncanonicalHardBreakSpacing === true) {
                blocks.push(ctx.reportError('Leerzeichen vor Hard Break im Strict-Modus nicht kanonisch', line, lineNo, colOf(i)));
                i++;
                continue;
            }
            const block = buildResourceBlock(resourceMatch);
            let next = i + 1;
            let captionFound = false;
            if (resourceMatch.hardBreak === true) {
                const captionCandidate = lines[next];
                if (captionCandidate !== undefined) {
                    try {
                        const parsed = parseInlineLine(captionCandidate, ctx.options.strict, ctx.resolveReference, ctx.lineStarts, lineOffset + next + 1, colOf(next));
                        if (parsed.length === 1 && parsed[0]?.type === 'em') {
                            block.caption = parsed[0].children;
                            captionFound = true;
                            next++;
                        }
                    }
                    catch {
                        // Kein Retry und kein konsumierter Input: eine syntaktisch nicht
                        // vollständige Emphasis-Zeile ist schlicht keine Caption. Die
                        // typabhängige Folgeentscheidung steht unmittelbar darunter.
                    }
                }
                // Seit v0.5.0 ist dieser Pfad nur noch für Bilder erreichbar;
                // ein Hard Break ohne Caption ist wirkungslos.
            }
            const { id, next: afterSuffix } = consumeStandaloneSuffix(lines, next, ctx.options.strict);
            if (id !== undefined)
                block.id = id;
            block.range = rangeToLineOrEnd(ctx.lineStarts, ctx.source, lineNo - 1, colOf(i), lineOffset + afterSuffix, 0);
            blocks.push(block);
            i = afterSuffix;
            continue;
        }
        const tableStart = tryMatchTableStart(lines, i);
        if (tableStart !== null) {
            const { table, next } = parseTable(lines, i, tableStart, ctx, lineOffset, colOf(i));
            blocks.push(table);
            i = next;
            continue;
        }
        // Absatz: sammle aufeinanderfolgende "other"-Zeilen (inkl. fehlplatzierter
        // Listenmarker mit indent !== 0, siehe oben), bis eine eindeutig andere
        // Blockart beginnt — dazu zählt auch eine Tabelle (Ein-Zeilen-Lookahead)
        // und eine alleinstehende Blockressource (Spec 4.2.3).
        const paraLines = [line];
        // Parallele Positions-Anker für jede Absatzzeile (linesToInline).
        const paraLineNos = [lineNo];
        const paraColOffsets = [colOf(i)];
        let k = i + 1;
        while (k < lines.length) {
            const next = classify(lines[k], ctx.options.strict);
            if (next.kind === 'other') {
                if (matchDirectiveStart(lines, k, ctx.options.strict) !== null)
                    break;
                if (tryMatchTableStart(lines, k) !== null)
                    break;
                if (/^<(?:v|au|e|d)(?:[ >])/.test(lines[k]))
                    break;
                if (tryMatchResourceLine(lines[k], ctx.options.strict, ctx.resolveReference, ctx.lineStarts, lineOffset + k + 1, colOf(k)) !== null)
                    break;
                paraLines.push(lines[k]);
                paraLineNos.push(lineOffset + k + 1);
                paraColOffsets.push(colOf(k));
                k++;
                continue;
            }
            if (next.kind === 'listMarker' && next.marker.indent !== 0) {
                paraLines.push(lines[k]);
                paraLineNos.push(lineOffset + k + 1);
                paraColOffsets.push(colOf(k));
                k++;
                continue;
            }
            break;
        }
        const { id, next } = consumeStandaloneSuffix(lines, k, ctx.options.strict);
        try {
            const paragraph = { type: 'paragraph', children: linesToInline(paraLines, paraLineNos, paraColOffsets, ctx) };
            if (id !== undefined)
                paragraph.id = id;
            paragraph.range = rangeToLineOrEnd(ctx.lineStarts, ctx.source, lineNo - 1, colOf(i), lineOffset + next, 0);
            blocks.push(paragraph);
        }
        catch (e) {
            if (!(e instanceof InlineSyntaxError))
                throw e;
            blocks.push(ctx.reportError(e.message, paraLines.join('\n'), lineNo, colOf(i)));
        }
        i = next;
    }
    return blocks;
}
/**
 * Erste Zeile ab `from`, die `predicate` erfüllt — Zeilen innerhalb einer
 * offenen Code-/Math-Fence werden dabei übersprungen (Spec 10.8: Fences sind
 * literale Kontexte, in denen reservierte Marker wie `:::`/`... <`
 * keine Sonderbedeutung haben). `-1`, wenn keine solche Zeile existiert.
 */
function findLineOutsideFence(lines, from, predicate) {
    let fenceChar = null;
    let fenceLen = 0;
    for (let i = from; i < lines.length; i++) {
        const l = lines[i];
        if (fenceChar !== null) {
            const closeRe = fenceChar === '`' ? /^(`+)[ \t]*$/ : /^(~+)[ \t]*$/;
            const closeMatch = closeRe.exec(l);
            if (closeMatch && closeMatch[1].length >= fenceLen)
                fenceChar = null;
            continue;
        }
        const openMatch = FENCE_OPEN_RE.exec(l);
        if (openMatch) {
            fenceChar = openMatch[1][0];
            fenceLen = openMatch[1].length;
            continue;
        }
        if (predicate(l))
            return i;
    }
    return -1;
}
/**
 * Fenced Container (Spec 2.7.2): benannt oder anonym, optional mit Titel.
 * Sein Inhalt wird terminal geparst, also ohne weitere Markanto-Container.
 */
function parseFencedContainer(lines, startIndex, ctx, lineOffset, name, title, startCol = 0) {
    const startLineNo = lineOffset + startIndex + 1;
    const closeIdx = findLineOutsideFence(lines, startIndex + 1, (l) => CONTAINER_CLOSE_RE.test(l));
    if (closeIdx === -1) {
        const rawContent = lines.slice(startIndex, lines.length).join('\n');
        return { block: ctx.reportError('Fenced Container nicht geschlossen', rawContent, startLineNo, startCol), next: lines.length };
    }
    const rawContent = lines.slice(startIndex, closeIdx + 1).join('\n');
    const contentLines = lines.slice(startIndex + 1, closeIdx);
    const childBlocks = parseBlocks(contentLines, ctx, lineOffset + startIndex + 1, 1, undefined, undefined, 'fenced');
    if (childBlocks.length === 0) {
        return { block: ctx.reportError('Leerer Fenced Container', rawContent, startLineNo, startCol), next: closeIdx + 1 };
    }
    const container = {
        type: 'fencedContainer',
        form: 'fenced',
        name,
        children: childBlocks,
    };
    if (title !== undefined)
        container.title = title;
    const { id, next: afterSuffix } = consumeStandaloneSuffix(lines, closeIdx + 1, ctx.options.strict);
    if (id !== undefined)
        container.id = id;
    container.range = rangeToLineOrEnd(ctx.lineStarts, ctx.source, lineOffset + startIndex, startCol, lineOffset + afterSuffix, 0);
    return { block: container, next: afterSuffix };
}
/**
 * Sucht den Schließer eines Directive Containers. Code-/Math-Fences sind
 * literal. Ein Fenced-Öffner auf Inhalts-Basislinie öffnet genau ein
 * unmittelbares Kind; dessen eigener `:::`-Schließer muss vor `... <`
 * erscheinen (Spec 2.7.4).
 */
function findDirectiveClose(lines, from) {
    let fenceChar = null;
    let fenceLen = 0;
    let inFencedChild = false;
    for (let i = from; i < lines.length; i++) {
        const line = lines[i];
        if (fenceChar !== null) {
            const closeRe = fenceChar === '`' ? /^(`+)[ \t]*$/ : /^(~+)[ \t]*$/;
            const closeMatch = closeRe.exec(line);
            if (closeMatch && closeMatch[1].length >= fenceLen)
                fenceChar = null;
            continue;
        }
        const literalOpen = FENCE_OPEN_RE.exec(line);
        if (literalOpen) {
            fenceChar = literalOpen[1][0];
            fenceLen = literalOpen[1].length;
            continue;
        }
        if (inFencedChild) {
            if (CONTAINER_CLOSE_RE.test(line))
                inFencedChild = false;
            else if (DIRECTIVE_FENCE_RE.test(line))
                return { closeIdx: i, unclosedFencedChild: true };
            continue;
        }
        if (DIRECTIVE_FENCE_RE.test(line))
            return { closeIdx: i, unclosedFencedChild: false };
        if (CONTAINER_OPEN_RE.test(line))
            inFencedChild = true;
    }
    return null;
}
function parseDirectiveContainer(lines, startIndex, ctx, lineOffset, name, title, fenceLength, startCol = 0) {
    const startLineNo = lineOffset + startIndex + 1;
    const close = findDirectiveClose(lines, startIndex + 2);
    if (close === null) {
        const rawContent = lines.slice(startIndex, lines.length).join('\n');
        return { block: ctx.reportError('Directive Container nicht geschlossen', rawContent, startLineNo, startCol), next: lines.length };
    }
    const { closeIdx } = close;
    const rawContent = lines.slice(startIndex, closeIdx + 1).join('\n');
    if (close.unclosedFencedChild) {
        return {
            block: ctx.reportError('Fenced-Container-Kind vor Directive-Schließer nicht geschlossen', rawContent, startLineNo, startCol),
            next: closeIdx + 1,
        };
    }
    const contentLines = lines.slice(startIndex + 2, closeIdx);
    const childBlocks = parseBlocks(contentLines, ctx, lineOffset + startIndex + 2, 1, undefined, undefined, 'directive');
    if (childBlocks.length === 0) {
        return { block: ctx.reportError('Leerer Directive Container', rawContent, startLineNo, startCol), next: closeIdx + 1 };
    }
    const directive = {
        type: 'directiveContainer',
        form: 'directive',
        name,
        ...(fenceLength > 3 ? { fenceLength } : {}),
        children: childBlocks,
    };
    if (title !== undefined)
        directive.title = title;
    const { id, next: afterSuffix } = consumeStandaloneSuffix(lines, closeIdx + 1, ctx.options.strict);
    if (id !== undefined)
        directive.id = id;
    directive.range = rangeToLineOrEnd(ctx.lineStarts, ctx.source, lineOffset + startIndex, startCol, lineOffset + afterSuffix, 0);
    return { block: directive, next: afterSuffix };
}
/**
 * Zitatregion (Spec 3.1–3.17). Flaches AST-Modell: die Region sammelt eine
 * zusammenhängende Folge von QuoteBlock{level, block}. Zeilen werden in
 * maximale gleichtiefe Läufe partitioniert; jeder Lauf wird — nach
 * Präfixentfernung — rekursiv über parseBlocks geparst (Spec 3.9, 3.14).
 *
 * @param startCol Spalte (0-basiert) der ersten Zitatzeile in der Datei —
 *   für den Range-Anfang der Region, wenn die Region selbst in einem
 *   gestrippten Kontext steht (Zitat in Liste).
 * @param ownPosition Gesetzt, wenn diese Region als strukturiertes
 *   Listenelement-Kind gefunden wurde (Spec 3.12) — ihre eigene Position in
 *   der Wechselkette. Jede direkt in ihrem Inhalt gefundene Liste ist dann
 *   nicht-rekursiv (Spec 9.10, wörtlich: "Befindet sich die Quote Region
 *   bereits in einem Listenelement, ist jede darin enthaltene Liste
 *   nicht-rekursiv").
 */
function parseQuoteRegion(lines, startIndex, ctx, lineOffset, startCol = 0, ownPosition) {
    const startLineNo = lineOffset + startIndex + 1;
    let end = startIndex;
    while (end < lines.length && parseQuotePrefix(lines[end]).depth >= 1)
        end++;
    const regionLines = lines.slice(startIndex, end);
    const rawContent = regionLines.join('\n');
    const parsed = regionLines.map((l) => parseQuotePrefix(l));
    if (ctx.options.strict && parsed.some((p) => p.leadingSpace > 0)) {
        return {
            block: ctx.reportError('Führende Leerzeichen vor Zitatpräfix im Strict Mode nicht kanonisch', rawContent, startLineNo, startCol),
            next: end,
        };
    }
    let prevDepth = 0;
    let firstNonEmptySeen = false;
    let maxDepthSeen = 0;
    for (const p of parsed) {
        maxDepthSeen = Math.max(maxDepthSeen, p.depth);
        const isEmpty = p.content.trim() === '';
        if (!firstNonEmptySeen) {
            if (p.depth !== 1) {
                return {
                    block: ctx.reportError('Zitat beginnt auf Tiefe größer 1', rawContent, startLineNo, startCol),
                    next: end,
                };
            }
            if (!isEmpty)
                firstNonEmptySeen = true;
            prevDepth = 1;
            continue;
        }
        if (isEmpty) {
            if (p.depth > prevDepth) {
                return {
                    block: ctx.reportError('Tiefere leere Zitatzeile eröffnet neue Ebene', rawContent, startLineNo, startCol),
                    next: end,
                };
            }
            continue;
        }
        if (p.depth > prevDepth + 1) {
            return {
                block: ctx.reportError('Ebenensprung nach oben um mehr als eine Ebene', rawContent, startLineNo, startCol),
                next: end,
            };
        }
        prevDepth = p.depth;
    }
    if (maxDepthSeen > ctx.options.maxQuoteDepth) {
        return {
            block: ctx.reportError(`Überschreitung von maxQuoteDepth (${ctx.options.maxQuoteDepth})`, rawContent, startLineNo, startCol),
            next: end,
        };
    }
    const quoteBlocks = [];
    let idx = 0;
    while (idx < parsed.length) {
        const runStart = idx; // ursprünglicher Index innerhalb parsed — vor dem Lauf
        const runDepth = parsed[idx].depth;
        const runLines = [];
        const runColOffsets = [];
        while (idx < parsed.length && parsed[idx].depth === runDepth) {
            runLines.push(parsed[idx].content);
            // Phase-7-Offset-Mapping: so viele Zeichen wurden vom Original
            // gestrippt (Präfix "> " je Ebene, optional inkl. tolerierter
            // führender Leerzeichen) PLUS der Start-Spalte der Region selbst
            // (wenn die Region in einem Listen-/Zitatkontext steht) — die
            // Kind-Blöcke dieser Zeilen bekommen damit echte Datei-Spalten statt
            // relativer Spalten. runColOffsets bleibt exakt parallel zu runLines.
            runColOffsets.push(startCol + (regionLines[idx].length - parsed[idx].content.length));
            idx++;
        }
        // Jede Liste DIREKT im Inhalt EINER Zitatregion zählt in die
        // Wechselkette hinein, auch wenn diese Zitatregion selbst nicht als
        // Listenelement-Kind getriggert wurde (Herleitung Spec 7.6: die
        // Zitat-zuerst-Kette QuoteRegion(1)→List(2)→QuoteRegion(3)→List(4)
        // erreicht Tiefe 4 nur, wenn bereits List(2) — obwohl QuoteRegion(1)
        // untriggert ist — mitgezählt wird). Default-Position 1 für eine
        // nicht getriggerte Region.
        const quotePosition = ownPosition ?? { mixedDepth: 1, nonRecursive: false };
        // WICHTIG (Review-Folgerunde 2, Phase A): der rekursive Aufruf braucht
        // den ABSOLUTEN Zeilenoffset des Laufbeginns — die vor dem Lauf bereits
        // konsumierten Zitatzeilen (runStart) müssen aufgeschlagen werden.
        // Vorher wurde für JEDEN Lauf lineOffset + startIndex (die erste
        // Regionzeile) verwendet: innere Blöcke späterer Läufe wurden auf die
        // erste Zeile verortet, mit zueinander inkonsistenten offset/line/column.
        const subBlocks = parseBlocks(runLines, ctx, lineOffset + startIndex + runStart, 1, quotePosition, undefined, 'root', runColOffsets);
        for (const b of subBlocks) {
            quoteBlocks.push({ level: runDepth, block: b });
        }
    }
    if (quoteBlocks.length === 0) {
        return { block: ctx.reportError('Leeres Zitat', rawContent, startLineNo, startCol), next: end };
    }
    const region = { type: 'quoteRegion', children: quoteBlocks };
    let next = end;
    const attributionMatch = ATTRIBUTION_RE.exec(lines[next] ?? '');
    if (attributionMatch !== null) {
        const attributionSource = attributionMatch[1];
        if (attributionSource.endsWith('\\') || / {2,}$/.test(attributionSource)) {
            region.range = rangeToLineOrEnd(ctx.lineStarts, ctx.source, lineOffset + startIndex, startCol, lineOffset + end, 0);
            return {
                block: region,
                trailingError: ctx.reportError('Break in Zitatattribution nicht zulässig', lines[next], lineOffset + next + 1, startCol),
                next: next + 1,
            };
        }
        try {
            const attribution = inlineNonEmpty(parseInlineLine(attributionSource, ctx.options.strict, ctx.resolveReference, ctx.lineStarts, lineOffset + next + 1, startCol + 3));
            region.attribution = attribution;
            next++;
        }
        catch (e) {
            if (!(e instanceof InlineSyntaxError))
                throw e;
            region.range = rangeToLineOrEnd(ctx.lineStarts, ctx.source, lineOffset + startIndex, startCol, lineOffset + end, 0);
            return {
                block: region,
                trailingError: ctx.reportError(e.message, lines[next], lineOffset + next + 1, startCol),
                next: next + 1,
            };
        }
    }
    const { id, next: afterSuffix } = consumeStandaloneSuffix(lines, next, ctx.options.strict);
    if (id !== undefined)
        region.id = id;
    region.range = rangeToLineOrEnd(ctx.lineStarts, ctx.source, lineOffset + startIndex, startCol, lineOffset + afterSuffix, 0);
    return { block: region, next: afterSuffix };
}
/**
 * Liste mit optionalen verschachtelten Unterlisten (Spec 9.2–9.9) und
 * strukturierten Listenelementen (9.8: weitere Blockelemente nach einer
 * Leerzeile — Absätze, Quote Regions, Code-/Math-Fences, Unterlisten;
 * Tabellen und Block-Medien fehlen noch, da diese Blocktypen selbst noch
 * nicht implementiert sind).
 *
 * @param startCol Spalte (0-basiert) des Listenmarkers in der Datei — für
 *   den Range-Anfang der Liste, wenn sie in einem gestrippten Kontext
 *   steht (Liste in Quote).
 * @param mixed Gesetzt, wenn diese Liste selbst Teil einer List↔QuoteRegion-
 *   Wechselkette ist (Spec 9.10) — siehe MixedInfo-Dokumentation. `undefined`
 *   für eine gewöhnliche, nicht in eine Quote Region eingebettete Liste.
 */
/**
 * @param level Tiefe für maxListDepth/mixed-Buchhaltung — reine Zählung,
 *   NICHT zwingend die Einrückungs-Baseline (siehe indentLevel).
 * @param indentLevel Ebene, aus der `markerIndent`/`contIndent` (die
 *   tatsächlich erwartete Zeicheneinrückung IN `lines`) berechnet wird.
 *   Bei unveränderten, absoluten `lines` (Fast-Path-Unterliste, Dokument-
 *   ebene, Zitatinhalt) ist das dasselbe wie `level`. Für den
 *   strukturierten Kind-Bereich eines Listenelements sind `lines` dagegen
 *   bereits um `contIndent` der äußeren Liste gestrippt (siehe
 *   parseBlocks-Aufrufer) — die neu gefundene Liste beginnt dort bei
 *   Einrückung 0, obwohl ihre reine Listentiefe (`level`) weiterläuft.
 *   Default `level` (bisheriges Verhalten), damit nur der eine betroffene
 *   Aufrufer (parseBlocks, `listItemRegion !== undefined`) abweichen muss.
 */
function parseList(lines, startIndex, level, ctx, lineOffset, startCol = 0, mixed, indentLevel = level) {
    const startLineNo = lineOffset + startIndex + 1;
    const markerIndent = 2 * (indentLevel - 1);
    const contIndent = 2 * indentLevel;
    const items = [];
    let kind = null;
    let firstNum;
    let expectedNext;
    let i = startIndex;
    while (i < lines.length) {
        const line = lines[i];
        if (isBlank(line))
            break;
        const marker = matchListMarker(line);
        if (!marker || marker.indent !== markerIndent)
            break;
        if (kind === null)
            kind = marker.kind;
        else if (kind !== marker.kind)
            break; // Wechsel des Listentyps -> neuer Listenknoten (9.3.1)
        // `contIndent` (2 pro Ebene) ist die KANONISCHE Einrückung — genau das,
        // was der Formatter schreibt. `hangIndent` ist die zusätzlich tolerierte
        // CommonMark-Hängeeinrückung dieses Markers: die Spalte, an der der
        // Marker-Inhalt beginnt (`-` → contIndent; `1. `/`10. ` → breiter).
        // Spec 9.6: "Der normale Parser akzeptiert jede eindeutige Einrückung ab
        // dem erforderlichen Inhaltsbeginn; der Formatter normalisiert sie."
        const hangIndent = Math.max(contIndent, line.length - marker.rest.length);
        // Spec 9.4: "Der Strict Mode akzeptiert ausschließlich die kanonische
        // Einrückung." Eindeutig nicht-kanonische Unterlistenmarker werden im
        // Strict Mode als Fehler gemeldet. Bei Fließtext ist zusätzliche
        // Einrückung dagegen nicht von führendem Text-Whitespace unterscheidbar
        // und bleibt deshalb erhalten (siehe Fortsetzungs-/Textkind-Pfade).
        const NONCANONICAL_INDENT = 'Nicht-kanonische Listen-Einrückung im Strict Mode (Spec 9.4)';
        // Ende einer zusammenhängenden Kind-Region ab `from`: spannt Leerzeilen
        // (9.8/9.9), endet an der ersten nicht-leeren Zeile mit Einrückung
        // < `childIndent` oder am Dateiende. Für die Hängeeinrückungs- und
        // Strict-Fehlerpfade, damit mehrzeilige Regionen VOLLSTÄNDIG konsumiert
        // werden (nicht nur die erste Zeile — sonst zerfällt die Liste).
        const childRegionEnd = (from, childIndent) => {
            let e = from;
            while (e < lines.length) {
                if (isBlank(lines[e])) {
                    e++;
                    continue;
                }
                if (leadingSpaces(lines[e]) >= childIndent) {
                    e++;
                    continue;
                }
                break;
            }
            return e;
        };
        // Taskmarker nur für ungeordnet/geordnet (Spec 9.3.2, 9.18.1) — bei
        // Definitionslisten bleibt ein führendes "[ ] "/"[x] " Teil des Begriffs.
        const { task, content } = marker.kind === 'definition' ? { task: undefined, content: marker.rest } : extractTask(marker.rest);
        const paraLines = [content];
        const paraLineNos = [lineOffset + i + 1];
        // Phase-7-Offset-Mapping: ABSOLUTE Datei-Spalten der Absatz-Kind-Zeilen
        // — erste Zeile: startCol + Marker-Länge; Fortsetzungszeilen:
        // startCol + contIndent (sie sind um contIndent eingerückt).
        const paraColOffsets = [startCol + (line.length - content.length)];
        let j = i + 1;
        let forbiddenDirective;
        // Auch die Markerzeile selbst kann die Direktiv-Kopfzeile enthalten.
        // ListItem.children verlangt jedoch einen Paragraph als erstes Kind;
        // deshalb bleibt diese Kopfzeile darin erhalten und der bestätigende
        // Fence wird zusätzlich als lokaler Kontextfehler gemeldet.
        if (j < lines.length && leadingSpaces(lines[j]) >= contIndent) {
            const strippedFence = lines[j].slice(contIndent);
            if (matchDirectiveStart([content, strippedFence], 0, ctx.options.strict) !== null) {
                forbiddenDirective = {
                    rawContent: `${content}\n${strippedFence}`,
                    lineNo: lineOffset + i + 1,
                    column: paraColOffsets[0],
                    next: j + 1,
                };
            }
        }
        while (j < lines.length) {
            if (forbiddenDirective !== undefined)
                break;
            const candidate = lines[j];
            if (isBlank(candidate))
                break;
            if (leadingSpaces(candidate) < contIndent)
                break;
            // IMMER exakt um `contIndent` strippen. Der Formatter schreibt die
            // Fortsetzungseinrückung kanonisch als `contIndent` (Spec 9.6); ein
            // führendes Leerzeichen IM Textknoten (`Text(" x")`) ist gültiger,
            // validatorunauffälliger AST-Inhalt und muss erhalten bleiben. Nach
            // `contIndent + " x"` wäre die Zeile visuell 3 Leerzeichen breit —
            // dasselbe wie hangIndent für `1. `. Würde man dann `hangIndent`
            // strippen, ginge das Textleerzeichen verloren → Gesetz-1-Verstoß
            // (Codex-Review Runde 2). Eine breitere Autoren-Hängeeinrückung
            // (`1. A\n   x` mit 0 Textleerzeichen) ergibt dadurch `Text(" x")`
            // statt `Text("x")` — im Rendering unsichtbar, roundtrip-stabil.
            const stripped = candidate.slice(contIndent);
            if (matchListMarker(stripped) !== null)
                break; // gehört zur Unterlisten-Prüfung unten
            const following = lines[j + 1];
            if (following !== undefined && leadingSpaces(following) >= contIndent) {
                const strippedFollowing = following.slice(contIndent);
                if (matchDirectiveStart([stripped, strippedFollowing], 0, ctx.options.strict) !== null) {
                    forbiddenDirective = {
                        rawContent: `${stripped}\n${strippedFollowing}`,
                        lineNo: lineOffset + j + 1,
                        column: startCol + contIndent,
                        next: j + 2,
                    };
                    break;
                }
            }
            paraLines.push(stripped);
            paraLineNos.push(lineOffset + j + 1);
            paraColOffsets.push(startCol + contIndent);
            j++;
        }
        // ListItem.children ist typisiert als [Paragraph, ...], nicht
        // [Paragraph | ErrorBlock, ...] — anders als bei Absätzen auf
        // Dokumentebene kann ein Inline-Syntaxfehler hier nicht als ErrorBlock
        // an dieser Position dargestellt werden. Im toleranten Modus bleibt der
        // historische Fallback auf einen literalen Text-Knoten erhalten. Strict
        // transportiert den Fehler dagegen nach parseBlocks, das den betroffenen
        // Listeneintrag als ErrorBlock auf Dokumentebene darstellt.
        let paragraph;
        try {
            paragraph = { type: 'paragraph', children: linesToInline(paraLines, paraLineNos, paraColOffsets, ctx) };
        }
        catch (e) {
            if (!(e instanceof InlineSyntaxError))
                throw e;
            if (ctx.options.strict) {
                throw new StrictListInlineError(e.message, lines.slice(i, j).join('\n'), lineOffset + i + 1, j);
            }
            if (!ctx.options.errorRecovery)
                throw new MarkantoSyntaxError(e.message, lineOffset + i + 1);
            paragraph = { type: 'paragraph', children: [{ type: 'text', value: paraLines.join('\n') }] };
        }
        // Erstes Listenelement-Kind ist der Absatz — eigener Range von der
        // Markerzeile (Inhaltsspalte) bis nach der letzten Absatzzeile.
        paragraph.range = rangeToLineOrEnd(ctx.lineStarts, ctx.source, lineOffset + i, paraColOffsets[0], lineOffset + j, 0);
        const children = [paragraph];
        if (forbiddenDirective !== undefined) {
            children.push(ctx.reportError('Directive Container ist hier nicht zulässig', forbiddenDirective.rawContent, forbiddenDirective.lineNo, forbiddenDirective.column));
            j = forbiddenDirective.next;
        }
        // (a) Unmittelbar folgende Unterliste ohne Leerzeile — Teil der
        // einfachen Liste (9.7), keine eigene Wechselketten-Stufe (Liste-in-
        // Liste verlängert die Kette nicht, `mixed` wird unverändert vererbt).
        if (j < lines.length && !isBlank(lines[j])) {
            const nextIndent = leadingSpaces(lines[j]);
            const subMarker = matchListMarker(lines[j]);
            if (subMarker && nextIndent === contIndent) {
                // ── Kanonische Einrückung: unverändertes Verhalten ──────────────
                if (mixed?.nonRecursive) {
                    // rawContent relativ (ohne contIndent) speichern — konsistent mit
                    // dem strukturierten Pfad in parseBlocks, wo die Zeile bereits
                    // gestrippt vorliegt. Der Formatter rückt ErrorBlock-Inhalt in
                    // Listen einheitlich um childIndent ein (siehe format.ts).
                    children.push(ctx.reportError('Rekursiver Container in nicht-rekursiver Liste nicht zulässig', lines[j].slice(contIndent), lineOffset + j + 1, contIndent));
                    j++;
                }
                else if (level + 1 > ctx.options.maxListDepth) {
                    // Zeile konsumieren, nicht nur melden — sonst "leakt" sie zurück
                    // zur aufrufenden Ebene und wird dort (fälschlich) neu interpretiert.
                    const rawContent = lines[j].slice(contIndent);
                    children.push(ctx.reportError(`Überschreitung von maxListDepth (${ctx.options.maxListDepth})`, rawContent, lineOffset + j + 1, contIndent));
                    j++;
                }
                else {
                    // Fast-Path-Unterliste: dieselben (rohen) lines, der erste Marker
                    // steht an Spalte startCol + contIndent — startCol bleibt die
                    // Spalte des Zeilenanfangs dieser lines, NICHT contIndent (der
                    // Einrückungsteil steckt bereits in den Marker-/Inhaltsbreiten).
                    const { list: subList, next: subNext } = parseList(lines, j, level + 1, ctx, lineOffset, startCol, mixed);
                    children.push(subList);
                    j = subNext;
                }
            }
            else if (subMarker && nextIndent > contIndent && nextIndent <= hangIndent) {
                // ── CommonMark-Hängeeinrückung: ein Unterlisten-MARKER an der
                // Inhaltsspalte eines breiten Markers (`1. ` → Spalte 3) statt an der
                // kanonischen 2-Leerzeichen-Leiter. Der Marker ist eindeutig (die
                // Marker-Grammatik verlangt genau ein Leerzeichen) — anders als bei
                // reinem Fließtext gibt es hier keine „führendes Textleerzeichen vs.
                // Einrückung"-Mehrdeutigkeit, deshalb ist dies der EINZIGE
                // Fortsetzungs-/Kind-Fall, den der Strict Mode als nicht kanonisch
                // ablehnt (Spec 9.4). Non-strict: vollständige Region strippen und wie
                // strukturierte Kind-Blöcke parsen (gleiche AST-Form wie der
                // Fast-Path; Formatter normalisiert auf contIndent, Spec 9.6). ──────
                const end = childRegionEnd(j, nextIndent);
                const regionLines = lines.slice(j, end).map((l) => (isBlank(l) ? '' : l.slice(nextIndent)));
                const regionCols = lines.slice(j, end).map((l) => (isBlank(l) ? 0 : startCol + nextIndent));
                if (ctx.options.strict) {
                    children.push(ctx.reportError(NONCANONICAL_INDENT, regionLines.join('\n'), lineOffset + j + 1, nextIndent));
                }
                else if (mixed?.nonRecursive) {
                    children.push(ctx.reportError('Rekursiver Container in nicht-rekursiver Liste nicht zulässig', regionLines.join('\n'), lineOffset + j + 1, nextIndent));
                }
                else if (level + 1 > ctx.options.maxListDepth) {
                    children.push(ctx.reportError(`Überschreitung von maxListDepth (${ctx.options.maxListDepth})`, regionLines.join('\n'), lineOffset + j + 1, nextIndent));
                }
                else {
                    const childBlocks = parseBlocks(regionLines, ctx, lineOffset + j, level + 1, undefined, {
                        ...(mixed !== undefined ? { listMixed: mixed } : {}),
                    }, 'root', regionCols);
                    children.push(...childBlocks);
                }
                j = end;
            }
            else if (nextIndent > markerIndent && (!subMarker || nextIndent !== markerIndent)) {
                // Tiefer eingerückt, aber weder gültige Fortsetzung (oben bereits
                // konsumiert) noch gültiger Unterlisten-Beginn auf genau einer
                // Ebene tiefer. Wenn der innere `if` greift, ist `lines[j]` immer ein
                // MARKER an `nextIndent > hangIndent` (Fließtext an dieser Tiefe
                // hätte die Absatzschleife oben konsumiert): im Strict Mode ist jeder
                // nicht-kanonisch eingerückte Marker ein 9.4-Fehler, non-strict ein
                // Ebenensprung / uneindeutige Einrückung. Die GANZE über-eingerückte
                // Region wird konsumiert, aber nur der Lauf auf DIESER Einrückung.
                if (nextIndent > hangIndent) {
                    const end = childRegionEnd(j, nextIndent);
                    const rawContent = lines.slice(j, end).map((l) => (isBlank(l) ? '' : l.slice(Math.min(nextIndent, contIndent)))).join('\n');
                    children.push(ctx.reportError(ctx.options.strict ? NONCANONICAL_INDENT : 'Ebenensprung um mehr als eine Ebene oder uneindeutige Einrückung', rawContent, lineOffset + j + 1, contIndent));
                    j = end;
                }
            }
        }
        // (b) Strukturierte Kind-Blöcke nach Leerzeile(n) — Spec 9.8/9.9. Nur
        // Marker dürfen unmittelbar (ohne Leerzeile) folgen (Fall a); jeder
        // andere Blocktyp braucht mindestens eine Leerzeile davor.
        let structStart = j;
        let sawBlank = false;
        while (structStart < lines.length && isBlank(lines[structStart])) {
            structStart++;
            sawBlank = true;
        }
        if (sawBlank && structStart < lines.length) {
            const structIndent = leadingSpaces(lines[structStart]);
            const structMarker = matchListMarker(lines[structStart]);
            // `structIndent < contIndent`: kein Kind-Block — Geschwister-Marker
            // oder Listenende; j unverändert, die äußere Schleife entscheidet.
            if (structIndent < contIndent) {
                // kein Kind-Block — Geschwister-Marker oder Listenende; j unverändert.
            }
            else if (structMarker && structIndent > contIndent) {
                // Unterlisten-/verschachtelter Listen-MARKER als Kind-Block an
                // nicht-kanonischer Einrückung (`1. A` ⏎⏎ `   - B`). Ein Marker ist
                // eindeutig (Grammatik: genau ein Leerzeichen) — keine „führendes
                // Textleerzeichen vs. Einrückung"-Mehrdeutigkeit —, daher gibt es
                // hier eine echte nicht-kanonische Form.
                const end = childRegionEnd(j, structIndent);
                if (ctx.options.strict || structIndent > hangIndent) {
                    // Strict: JEDE nicht-kanonische Marker-Einrückung ist ein
                    // 9.4-Fehler, auch oberhalb von hangIndent (ein Marker ist immer
                    // eindeutig). Non-strict: nur > hangIndent → Ebenensprung /
                    // uneindeutige Einrückung.
                    const raw = lines.slice(structStart, end).map((l) => (isBlank(l) ? '' : l.slice(Math.min(structIndent, contIndent)))).join('\n');
                    const msg = ctx.options.strict
                        ? NONCANONICAL_INDENT
                        : 'Ebenensprung um mehr als eine Ebene oder uneindeutige Einrückung';
                    children.push(ctx.reportError(msg, raw, lineOffset + structStart + 1, contIndent));
                }
                else {
                    // Hängeeinrückung (contIndent < structIndent <= hangIndent),
                    // non-strict: markerbasiert strippen und als Kind-Blöcke parsen.
                    const regionLines = lines.slice(j, end).map((l) => (isBlank(l) ? '' : l.slice(structIndent)));
                    const regionColOffsets = lines.slice(j, end).map((l) => (isBlank(l) ? 0 : startCol + structIndent));
                    const childBlocks = parseBlocks(regionLines, ctx, lineOffset + j, level + 1, undefined, {
                        ...(mixed !== undefined ? { listMixed: mixed } : {}),
                    }, 'root', regionColOffsets);
                    children.push(...childBlocks);
                }
                j = end;
            }
            else {
                // Textkind (kein Marker) an BELIEBIGER Einrückung >= contIndent —
                // ODER ein kanonischer Marker (structIndent === contIndent, landet
                // beim contIndent-Strip auf Spalte 0). IMMER exakt um `contIndent`
                // strippen; führende Textleerzeichen (auch mehrere) bleiben dadurch
                // im ersten Textknoten erhalten. KEINE obere Grenze, KEIN Fehler,
                // KEINE Strict-Sonderbehandlung: jede Einrückung >= contIndent ist
                // die kanonische Serialisierung IRGENDEINES validatorgültigen AST
                // mit führenden Textleerzeichen (Codex-Review Runde 2/3). Der
                // Formatter schreibt `contIndent + Textinhalt` zurück → Reparse
                // strippt `contIndent` → identischer Textknoten (Gesetz 1).
                const end = childRegionEnd(j, contIndent);
                const regionLines = lines.slice(j, end).map((l) => (isBlank(l) ? '' : l.slice(contIndent)));
                // Phase-7-Offset-Mapping: jede gestrippte Kind-Zeile ist um contIndent
                // eingerückt (absolut: startCol + contIndent); die Kind-Blöcke
                // bekommen damit echte Datei-Spalten.
                const regionColOffsets = lines.slice(j, end).map((l) => (isBlank(l) ? 0 : startCol + contIndent));
                const childBlocks = parseBlocks(regionLines, ctx, lineOffset + j, level + 1, undefined, {
                    ...(mixed !== undefined ? { listMixed: mixed } : {}),
                }, 'root', regionColOffsets);
                children.push(...childBlocks);
                j = end;
            }
        }
        const item = { type: 'listItem', children };
        if (task !== undefined)
            item.task = task;
        // Range: von der Markerzeile (i, innerhalb dieser Iteration noch
        // unverändert) bis NACH dem letzten Kind-Block (j).
        item.range = rangeToLineOrEnd(ctx.lineStarts, ctx.source, lineOffset + i, startCol + marker.indent, lineOffset + j, 0);
        if (kind === 'ordered') {
            const num = marker.num;
            if (items.length === 0) {
                firstNum = num;
                expectedNext = num + 1;
            }
            else {
                if (num !== expectedNext)
                    item.value = num;
                expectedNext = num + 1;
            }
        }
        items.push(item);
        i = j;
    }
    if (items.length === 0) {
        // Sollte durch den Aufrufer (nur bei erkanntem Marker aufgerufen) nicht
        // erreichbar sein; defensiver Fallback.
        return {
            list: ctx.reportError('Leere Liste', lines[startIndex] ?? '', startLineNo, startCol),
            next: startIndex + 1,
        };
    }
    const list = { type: 'list', kind: kind, items: items };
    if (kind === 'ordered' && firstNum !== undefined && firstNum !== 1)
        list.start = firstNum;
    // Block-ID-Suffix (Spec 5.1, 6.2: "Liste (gesamt)" ist ID-fähig) nur für
    // die ÄUSSERSTE Liste konsumieren, nicht für eine verschachtelte
    // Unterliste — level > 1 bedeutet hier immer "dieselbe Listenkette läuft
    // weiter" (siehe parseBlocks-Dokumentation zu listLevel), egal ob über
    // den Fast-Path (unmittelbarer Sub-Marker) oder den strukturierten Pfad
    // (Kind-Bereich eines Listenelements) erreicht. Eine verschachtelte Liste
    // liegt im Aggregat-Scope der äußeren Liste und ist laut Validator
    // (isIdRequired/AGGREGATE_LOCKED) ohnehin nicht ID-fähig.
    // Der Listen-Range beginnt am ersten MARKER (Spalte startCol + markerIndent).
    if (level === 1) {
        const { id, next } = consumeStandaloneSuffix(lines, i, ctx.options.strict);
        if (id !== undefined)
            list.id = id;
        list.range = rangeToLineOrEnd(ctx.lineStarts, ctx.source, lineOffset + startIndex, startCol + markerIndent, lineOffset + next, 0);
        return { list, next };
    }
    list.range = rangeToLineOrEnd(ctx.lineStarts, ctx.source, lineOffset + startIndex, startCol + markerIndent, lineOffset + i, 0);
    return { list, next: i };
}
/**
 * Tabelle (Spec 12.1–12.5). Kopf- und Trennzeile sind durch den Aufrufer
 * (`tryMatchTableStart`) bereits bestätigt. Sammelt Body-Zeilen, solange sie
 * wie Tabellenzeilen aussehen (mindestens ein `|`) und keinen eindeutig
 * anderen Blockanfang bilden; eine abweichende Spaltenanzahl ist ein
 * Syntaxfehler für die GESAMTE Tabelle (12.3: "Abweichungen sind
 * Syntaxfehler"), nicht nur ein Tabellenende.
 */
function parseTable(lines, startIndex, start, ctx, lineOffset, startCol = 0) {
    const columnCount = start.alignments.length;
    let j = startIndex + 2;
    const bodyRowsCells = [];
    const bodyRowColumns = [];
    while (j < lines.length) {
        const line = lines[j];
        if (isBlank(line))
            break;
        if (!line.includes('|'))
            break;
        const c = classify(line, ctx.options.strict);
        if (c.kind !== 'other' && !(c.kind === 'listMarker' && c.marker.indent !== 0))
            break;
        const { cells, columns } = splitTableRow(line);
        if (cells.length !== columnCount) {
            const rawContent = lines.slice(startIndex, j + 1).join('\n');
            return {
                table: ctx.reportError('Tabellenzeile mit abweichender Spaltenanzahl', rawContent, lineOffset + j + 1),
                next: j + 1,
            };
        }
        bodyRowsCells.push(cells);
        bodyRowColumns.push(columns);
        j++;
    }
    function buildRow(cells, columns, rowLine0, rawLine) {
        const tableCells = cells.map((raw, ci) => {
            const trimmed = raw.trim();
            let cell;
            if (trimmed === '') {
                cell = { type: 'tableCell', children: [] };
            }
            else {
                try {
                    // trimmed beginnt nach dem führenden Trim von raw — sein
                    // Original-Start ist die Zellspalte (startCol + columns[ci]) um
                    // den führenden Trim-Versatz verschoben.
                    const textStartCol0 = startCol + columns[ci] + (raw.length - raw.trimStart().length);
                    cell = { type: 'tableCell', children: parseInlineLine(trimmed, ctx.options.strict, ctx.resolveReference, ctx.lineStarts, rowLine0 + 1, textStartCol0) };
                }
                catch (e) {
                    if (!(e instanceof InlineSyntaxError))
                        throw e;
                    // TableCell.children: Inline[] hat keinen ErrorBlock-Platz (wie bei
                    // ListItem.children[0]) — Fallback auf literalen Text.
                    if (!ctx.options.errorRecovery)
                        throw new MarkantoSyntaxError(e.message, lineOffset + startIndex + 1);
                    cell = { type: 'tableCell', children: [{ type: 'text', value: trimmed }] };
                }
            }
            // Grobe Zell-Range innerhalb der Zeile (Spec 4.2.3: Spalten grob).
            // columns[] sind relativ zur (ggf. gestrippten) Zeile — startCol ist
            // die echte Datei-Spalte des Zeilenanfangs (Phase-7-Offset-Mapping).
            const nextStart = columns[ci + 1];
            cell.range = rangeFromLines(ctx.lineStarts, rowLine0, startCol + columns[ci], rowLine0, startCol + (nextStart !== undefined ? nextStart - 1 : rawLine.length));
            return cell;
        });
        const row = { type: 'tableRow', cells: tableCells };
        row.range = rangeToLineOrEnd(ctx.lineStarts, ctx.source, rowLine0, startCol, rowLine0 + 1, 0);
        return row;
    }
    const table = {
        type: 'table',
        alignments: start.alignments,
        head: buildRow(start.headerCells, start.headerColumns, lineOffset + startIndex, lines[startIndex]),
        body: bodyRowsCells.map((cells, rowIdx) => buildRow(cells, bodyRowColumns[rowIdx], lineOffset + startIndex + 2 + rowIdx, lines[startIndex + 2 + rowIdx])),
    };
    const { id, next } = consumeStandaloneSuffix(lines, j, ctx.options.strict);
    if (id !== undefined)
        table.id = id;
    table.range = rangeToLineOrEnd(ctx.lineStarts, ctx.source, lineOffset + startIndex, startCol, lineOffset + next, 0);
    return { table, next };
}
function visitInlineForFootnoteRefs(nodes, order, seen) {
    for (const n of nodes) {
        if (n.type === 'footnoteReference') {
            if (!seen.has(n.identifier)) {
                seen.add(n.identifier);
                order.push(n.identifier);
            }
            continue;
        }
        if ('children' in n && Array.isArray(n.children)) {
            visitInlineForFootnoteRefs(n.children, order, seen);
        }
    }
}
/**
 * Weist jeder laut Spec 6.2 ID-fähigen Heading den in `heading-slug.ts`
 * berechneten, dokumentweit eindeutigen `slug` zu (Spec 6.3) — getrennt vom
 * permanenten `id`-System (6.1/6.2). Reine Zuweisung, keine eigene
 * Traversierungslogik mehr hier: `computeHeadingSlugs` ist dieselbe
 * Implementierung, die auch `validator.ts` zur Gegenprüfung nutzt (Codex-
 * Review, 2026-08-25 — zwei unabhängige Kopien hätten auseinanderdriften
 * können).
 */
export function assignHeadingSlugs(blocks) {
    for (const [heading, slug] of computeHeadingSlugs(blocks))
        heading.slug = slug;
}
/**
 * Sammelt alle FootnoteReference-Bezeichner im Dokument in Lesereihenfolge
 * ihres ersten Auftretens (Spec 11.5: "Nummerierung ... in der Reihenfolge
 * des ersten Auftretens im Text"). Rekursiver Abstieg durch alle Block-
 * Container-Formen — Referenzen dürfen laut Spec 11.3 innerhalb von Zitaten,
 * Listen und Fenced Containers stehen, Fußnotendefinitionen selbst enthalten
 * laut ast.ts-Invariante keine (rekursiven) Referenzen und werden daher
 * hier nicht durchsucht.
 */
function collectFootnoteReferenceOrder(blocks) {
    const order = [];
    const seen = new Set();
    function visitBlock(b) {
        switch (b.type) {
            case 'heading':
            case 'paragraph':
                visitInlineForFootnoteRefs(b.children, order, seen);
                break;
            case 'quoteRegion':
                for (const qb of b.children)
                    visitBlock(qb.block);
                break;
            case 'list':
                for (const item of b.items)
                    for (const c of item.children)
                        visitBlock(c);
                break;
            case 'table': {
                for (const row of [b.head, ...b.body]) {
                    for (const cell of row.cells)
                        visitInlineForFootnoteRefs(cell.children, order, seen);
                }
                break;
            }
            case 'fencedContainer':
            case 'directiveContainer':
                for (const c of b.children)
                    visitBlock(c);
                break;
            default:
                // horizontalRule, codeBlock, mathBlock, image/video/audio/embedBlock
                // (alt/caption sind Plaintext, kein Inline[]), errorBlock: kein
                // Inline-Inhalt zu durchsuchen.
                break;
        }
    }
    for (const b of blocks)
        visitBlock(b);
    return order;
}
/**
 * Kanonische Reihenfolge von Document.footnotes (ast.ts-Feldkommentar,
 * Spec 11.7): 1. referenzierte Definitionen in Reihenfolge ihrer ersten
 * Referenz im Text, 2. unreferenzierte Definitionen alphabetisch nach
 * Bezeichner am Ende. Das ist eine AST-Invariante (nicht erst eine
 * Formatter-Serialisierungsentscheidung) — die Quellreihenfolge, in der
 * Definitionen im Text standen, ist semantisch nicht bedeutsam (Spec 11.3:
 * Definitionen dürfen an beliebiger Stelle stehen).
 */
function orderFootnoteDefinitions(defs, referenceOrder) {
    const byIdentifier = new Map(defs.map((d) => [d.identifier, d]));
    const referenced = [];
    for (const id of referenceOrder) {
        const d = byIdentifier.get(id);
        if (d !== undefined)
            referenced.push(d);
    }
    const referencedIds = new Set(referenced.map((d) => d.identifier));
    const unreferenced = defs.filter((d) => !referencedIds.has(d.identifier)).sort((a, b) => a.identifier.localeCompare(b.identifier));
    return [...referenced, ...unreferenced];
}
export function parse(source, rawOptions = {}) {
    const options = resolveOptions(rawOptions);
    const lines = source.split(/\r\n|\r|\n/);
    const referenceDefs = scanReferenceDefinitions(lines);
    const lineStarts = computeLineStarts(source);
    const ctx = {
        options,
        reportError(reason, rawContent, lineNo, col = 0) {
            if (!options.errorRecovery)
                throw new MarkantoSyntaxError(reason, lineNo);
            // Grobe Range für ErrorBlocks (Spec: SourceRange ist von der
            // semantischen Gleichheit ausgenommen): von der Fehlerzeile bis nach
            // der letzten von rawContent umfassten Zeile — rawContent ist je nach
            // Aufrufstelle ein- oder mehrzeilig und uneinheitlich entstanden,
            // daher bewusst ohne Präzisionsanspruch. `col` ist die echte
            // Datei-Spalte der Fehlerzeile (0-basiert), ggf. inkl. Strip-Offset.
            const lineCount = rawContent.split('\n').length;
            return {
                type: 'errorBlock',
                reason,
                rawContent,
                range: rangeToLineOrEnd(lineStarts, source, lineNo - 1, col, lineNo - 1 + lineCount, 0),
            };
        },
        footnoteDefs: [],
        resolveReference: (label) => referenceDefs.get(label),
        lineStarts,
        source,
    };
    const blocks = parseBlocks(lines, ctx, 0);
    assignHeadingSlugs(blocks);
    const referenceOrder = collectFootnoteReferenceOrder(blocks);
    return {
        type: 'document',
        children: blocks,
        meta: {
            encoding: 'utf-8',
            lineBreakMode: options.lineBreaks,
            ...(options.lang !== undefined ? { lang: options.lang } : {}),
        },
        footnotes: orderFootnoteDefinitions(ctx.footnoteDefs, referenceOrder),
    };
}
