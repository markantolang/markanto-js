/**
 * Markanto — Inline-Scanner (Spec Kapitel 10).
 *
 * Einziger Links-nach-rechts-Scanner pro physischer Zeile (10.4). Inline-
 * Markup überschreitet nie Zeilengrenzen (10.7) — der Aufrufer (parser.ts)
 * ruft parseInlineLine() separat pro Zeile auf und fügt SoftBreak/HardBreak
 * zwischen den Ergebnissen ein.
 *
 * Implementiert (Prioritäten aus 10.4): 1 Escape, 2 Inline-Code, 3 Inline-
 * Math, 4 Ressourcenmetadaten (im Blockparser), 5 Autolink (geklammert
 * oder nackt), 6 Fußnotenreferenz (`[^id]`, Bezeichner-Kollision mit
 * Ressourcen/Span ausgeschlossen, da beide `[` erst nach `^` scannen —
 * siehe unten), 7/8/10/11 Markdown-Bild/-Link/typisierte Ressource
 * (Ziel-/Attribut-Grammatik in resource.ts, orchestriert hier: Bild/Link
 * inline; Video/Audio/Embed sind reine Blockressourcen und lösen im
 * Fließtext einen Syntaxfehler aus, Spec 4.2.1/4.2.3), 9 HTML-Entity
 *  (benannt gegen die generierte Tabelle in generated/html-entities.ts,
 *  dezimal `&#…;`/hex `&#x…;` — nur semikolon-terminierte Formen erkannt,
 *  siehe dortiger Kommentar; unbekannte/nicht abgeschlossene Folgen bleiben
 *  unverändert Text, Spec 10.8.1; im Strict Mode ist eine Entity nur dann
 *  kanonisch, wenn sie die vom Formatter benötigte Disambiguierungsform ist
 *  — eine numerische W-Entity in exakter dezimaler Normalform unmittelbar
 *  an einem flankenden Markup-Delimiter, siehe
 *  isCanonicalFlankingEntity), 12 Span, 13 Markup-Delimiter (Em/Strong/
 *  Strike/Insert/Mark/Sup/Sub), 14 Text.
 *
 * Auflösung von Delimiter-Läufen bei `*`/`_` (z.B. `**a *b* c**`, `***x***`):
 * Die Spec spezifiziert "längster Match" nur für die Scan-Priorität, nicht
 * explizit, wie ein gemischter Lauf wie `***` beim Schließen aufzuteilen
 * ist. Interpretation hier (konsistent mit dem Beispiel in 10.6, das
 * `**stark und *betont***` als gültig zeigt): Bevorzugt gegen die Länge
 * des aktuellen Stack-Tops schließen, bevor greedy-longest fürs Öffnen
 * versucht wird. Nicht durch einen expliziten Normsatz abgesichert —
 * markiert zur Bestätigung.
 */
import { canonicalDecimalEntity, matchEntity } from './entities.js';
import { InlineSyntaxError } from './errors.js';
import { matchBracketConstruct, matchWrapperConstruct } from './resource.js';
import { rangeFromLines } from './sourceRange.js';
export { InlineSyntaxError } from './errors.js';
const ESCAPABLE = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~');
const DELIM_CHARS = new Set(['*', '_', '~', '+', '=', '^', '-']);
// Zeichen und Mehrzeichen-Präfixe, an denen die Hauptschleife tatsächlich
// eine syntaktische Interpretation versuchen muss. `$`, `!` sowie die nur
// paarweise gültigen Delimiter stoppen einen Plaintext-Lauf ausschließlich
// in ihrer aktionsfähigen Form; `~` und `^` dagegen bereits einzeln.
// Die Regex liegt absichtlich auf Modulebene: Ein parseInlineLine()-Aufruf pro
// kurzer physischer Zeile soll nicht jeweils ein neues Regex-Objekt erzeugen.
// `lastIndex` wird vor jeder Suche gesetzt, daher ist auch die rekursive
// Inline-Verarbeitung von Link-/Span-Labels sicher.
const NEXT_INLINE_SYNTAX_CHAR_RE = /[\\`<&\[*_~^]|\$`|!\[|--|\+\+|==|https?:\/\//g;
const MIN_PLAIN_TEXT_SCAN_LENGTH = 8;
function nextInlineSyntaxCharIndex(line, fromIndex) {
    NEXT_INLINE_SYNTAX_CHAR_RE.lastIndex = fromIndex;
    return NEXT_INLINE_SYNTAX_CHAR_RE.exec(line)?.index ?? line.length;
}
// Exportiert für format.ts: der Formatter muss dieselbe Flankierungslogik
// verwenden, um zu entscheiden, welche literalen Zeichen in Text-Knoten
// beim Serialisieren escaped werden müssen, damit erneutes Parsen nicht
// versehentlich Markup erzeugt (Spec 10.13: "kein unnötiges Escaping, nur
// wo Sonderbedeutung vorliegt").
export function charClass(ch) {
    if (ch === undefined)
        return 'S';
    if (/\s/u.test(ch))
        return 'S';
    if (/[\p{L}\p{N}_]/u.test(ch))
        return 'W';
    return 'P';
}
/**
 * Volles Unicode-Codepoint von `line` unmittelbar VOR Position `i` (als
 * String), oder `undefined` am Zeilenanfang. Zerlegt keine Surrogatpaare:
 * wenn `line[i-1]` eine Low-Surrogate ist, wird das bei `i-2` beginnende
 * Paar geliefert. Nötig, weil die Delimiter-Flanking-Regel (Spec 10.3) auf
 * Codepoints statt UTF-16-Units arbeitet — `charClass(line[i-1])` würde ein
 * Nicht-BMP-Wortzeichen als P-Klasse fehlklassifizieren.
 */
export function codePointBefore(line, i) {
    if (i <= 0)
        return undefined;
    const ch = line[i - 1];
    if (ch >= '\uDC00' && ch <= '\uDFFF') {
        const code = line.codePointAt(i - 2);
        return code === undefined ? ch : String.fromCodePoint(code);
    }
    const code = line.codePointAt(i - 1);
    return code === undefined ? undefined : String.fromCodePoint(code);
}
/** Volles Unicode-Codepoint von `line` ab Position `i` (als String), oder `undefined` am Zeilenende. */
export function codePointAfter(line, i) {
    const code = line.codePointAt(i);
    return code === undefined ? undefined : String.fromCodePoint(code);
}
export function isOpener(prev, next) {
    return next !== 'S' && prev !== 'W';
}
export function isCloser(prev, next) {
    return prev !== 'S' && next !== 'W';
}
const TOKEN_NODE_TYPE = {
    '*': 'em',
    '_': 'em',
    '**': 'strong',
    '__': 'strong',
    '~~': 'strike',
    '--': 'obsolete',
    '++': 'insert',
    '==': 'mark',
    '^': 'sup',
    '~': 'sub',
};
function tokenNodeType(token) {
    const nodeType = TOKEN_NODE_TYPE[token];
    if (nodeType === undefined)
        throw new InlineSyntaxError(`Unbekanntes Delimiter-Token: ${token}`);
    return nodeType;
}
/**
 * Entfernt Schutzleerzeichen, die der Formatter einfügt, wenn Inline-Code-
 * Inhalt am Rand mit einem Backtick beginnt/endet (Spec 10.9) — "diese
 * Schutzleerzeichen gehören nicht zum AST-Inhalt". Bewusste, dokumentierte
 * Restambiguität: ein Inhalt, der schon vor dem Formatieren zufällig mit
 * "<Leerzeichen><Backtick>" beginnt/endet, ist davon nicht unterscheidbar
 * und würde beim erneuten Parsen ebenso normalisiert — dieselbe Art
 * Trade-off wie bei anderen kanonischen Normalisierungen der Spec.
 */
function stripProtectiveSpaces(content) {
    let result = content;
    if (result.startsWith(' `'))
        result = result.slice(1);
    if (result.endsWith('` '))
        result = result.slice(0, -1);
    return result;
}
const URL_AUTOLINK_RE = /^(https?:\/\/[^\s<>]+)$/;
const EMAIL_AUTOLINK_RE = /^[^\s<>@]+@[^\s<>@.]+(\.[^\s<>@.]+)+$/;
const FOOTNOTE_REF_RE = /^\[\^([A-Za-z0-9_-]+)\]/;
const BARE_URL_TRAILING_PUNCTUATION = new Set(['.', ',', ':', ';', '!', '?', "'", '"']);
/**
 * Spec 13.2a: Ein Präfixscan liest zuerst ohne Rückverfolgung den längsten
 * Nicht-Whitespace-Lauf. Satzzeichen und unausgeglichene schließende
 * Klammern werden anschließend ausschließlich durch monotones Kürzen am
 * Laufende entfernt. Damit bleibt der Scanner single-pass/RE2-portabel.
 */
function matchBareUrl(line, start) {
    const prefixLength = line.startsWith('https://', start) ? 8 : line.startsWith('http://', start) ? 7 : 0;
    if (prefixLength === 0 || charClass(codePointBefore(line, start)) === 'W')
        return null;
    let greedyEnd = start + prefixLength;
    while (greedyEnd < line.length && !/\s/u.test(line[greedyEnd]))
        greedyEnd++;
    let end = greedyEnd;
    while (end > start + prefixLength && BARE_URL_TRAILING_PUNCTUATION.has(line[end - 1]))
        end--;
    let opens = 0;
    let closes = 0;
    for (let pos = start; pos < end; pos++) {
        if (line[pos] === '(')
            opens++;
        else if (line[pos] === ')')
            closes++;
    }
    while (end > start + prefixLength && line[end - 1] === ')' && closes > opens) {
        end--;
        closes--;
    }
    // Wie die geklammerte URL-Grammatik verlangt auch die nackte Form
    // mindestens ein Zeichen nach dem Schema-Präfix.
    if (end === start + prefixLength)
        return null;
    return { value: line.slice(start, end), end };
}
// Entity-Erkennung (benannt/dezimal/hex, nur semikolonterminiert, inkl.
// Codepoint-Validierung) liegt in entities.ts — derselbe Baustein wird vom
// Formatter (escapeText) zur Escaping-Entscheidung genutzt, damit Parser und
// Formatter nie auseinanderlaufen (Spec 10.8.1, 10.13).
/**
 * Kontextsensitive Strict-Mode-Prüfung für HTML-Entities (Spec 10.8.1,
 * H1-Lösung, siehe format.ts applyFlankingEntities):
 *
 * Eine Entity ist im Strict Mode nur dann kanonisch, wenn der Formatter
 * selbst genau diese Form für die Delimiter-Flanking-Disambiguierung erzeugt:
 * eine DEZIMALE numerische Entity, die zu genau EINEM WORTZEICHEN (W-Klasse,
 * Spec 10.3) dekodiert und unmittelbar an einen Markup-Delimiter angrenzt,
 * der dadurch flanken kann:
 *
 *   - vor einem Öffner (die Entity-Quellform endet auf ";", also P-Klasse —
 *     "A~~b~~" würde als Literaltext geparst, "&#65;~~b~~" erkennt Strike);
 *   - oder nach einem Schließer ("~~b~~c" würde den Schließer blockieren,
 *     "~~b~~&#99;" nicht).
 * Em/Strong verwenden seit v0.5.2 stattdessen Wrapper-Tags.
 *
 * Ohne diese Ausnahme würde der Strict-Parser die vom Formatter benötigte
 * kanonische Form selbst ablehnen (Gesetz 4, Spec 7.3.1). Alle anderen
 * Entities bleiben nichtkanonisch (der Formatter schriebe direktes Unicode)
 * und werden mit der unveränderten Strict-Meldung abgelehnt — der Strict
 * Mode wird also nicht global abgeschwächt. `_`-Delimiter und benannte/hex-
 * Formen sind bewusst NICHT erlaubt: der Formatter normalisiert sie weg.
 */
function isCanonicalFlankingEntity(line, i, entity) {
    // Genau ein Codepoint, das ein Wortzeichen (W-Klasse, Spec 10.3) ist.
    if ([...entity.value].length !== 1)
        return false;
    if (charClass(entity.value) !== 'W')
        return false;
    // Nur die EXAKTE Formatter-Normalform (entities.ts canonicalDecimalEntity):
    // dezimal, ohne führende Nullen. Hex-, benannte und aufgefüllte
    // Dezimalformen (z.B. "&#065;") werden dadurch abgelehnt — der Formatter
    // schriebe für denselben Codepoint "&#65;".
    const cp = entity.value.codePointAt(0);
    if (entity.raw !== canonicalDecimalEntity(cp))
        return false;
    const entityEnd = i + entity.raw.length;
    const after = line[entityEnd];
    const before = line[i - 1];
    // Vor einem Markup-Öffner: der Lauf nach der Entity flankt (Prev=P aus ";",
    // Next=Nicht-Whitespace) und ist ein gültiges Formatter-Delimiter-Token.
    if (after !== undefined && DELIM_CHARS.has(after) && after !== '^' && after !== '*' && after !== '_') {
        let runLen = 0;
        while (line[entityEnd + runLen] === after)
            runLen++;
        // `*` und `~` haben Ein- und Zweizeichen-Token; verschachtelte
        // Orientierungen können deshalb einen Dreizeichenlauf bilden. `^` ist
        // ausschließlich einlängig, die übrigen Delimiter zweilängig.
        const validLen = after === '*' ? runLen <= 3 : after === '~' ? runLen >= 2 && runLen <= 3 : runLen === 2;
        if (validLen && isOpener('P', charClass(codePointAfter(line, entityEnd + runLen))))
            return true;
    }
    // Nach einem Markup-Schließer: der Lauf VOR der Entity flankt (Prev=Nicht-
    // Whitespace, Next="&" aus der Entity = P-Klasse) und ist ein gültiges
    // Formatter-Delimiter-Token.
    if (before !== undefined && DELIM_CHARS.has(before) && before !== '^' && before !== '*' && before !== '_') {
        let runStart = i - 1;
        while (runStart - 1 >= 0 && line[runStart - 1] === before)
            runStart--;
        const runLen = i - runStart;
        const validLen = before === '*' ? runLen <= 3 : before === '~' ? runLen >= 2 && runLen <= 3 : runLen === 2;
        if (validLen && isCloser(charClass(codePointBefore(line, runStart)), 'P'))
            return true;
    }
    return false;
}
/**
 * Ein Text-Wortzeichen kann in der kanonischen Quelle unmittelbar neben
 * einem Em/Strong-Wrapper selbst als Flanking-Entity stehen, weil auf seiner
 * anderen Seite z.B. Strike/Insert/Mark grenzt. Für die Tag-Kanonik zählt
 * sein dekodierter Wert trotzdem als W-Nachbar.
 */
function canonicalWordEntityEndingAt(line, end) {
    const match = /&#([1-9][0-9]*);$/.exec(line.slice(0, end));
    if (match === null)
        return false;
    const entity = matchEntity(line, end - match[0].length);
    if (entity === null || entity.raw !== match[0])
        return false;
    const cp = entity.value.codePointAt(0);
    return entity.value === String.fromCodePoint(cp)
        && entity.raw === canonicalDecimalEntity(cp)
        && charClass(entity.value) === 'W';
}
function canonicalWordEntityStartingAt(line, start) {
    const entity = matchEntity(line, start);
    if (entity === null || entity.value.length === 0)
        return false;
    const cp = entity.value.codePointAt(0);
    return entity.value === String.fromCodePoint(cp)
        && entity.raw === canonicalDecimalEntity(cp)
        && charClass(entity.value) === 'W';
}
/**
 * Parst genau eine physische Zeile (kein LF darin) zu Inline-Knoten.
 * `strict` steuert die Kanonizitätsprüfung von HTML-Entities (Spec 10.8.1):
 * Die meisten Entities sind im Strict Mode nichtkanonisch, da der Formatter
 * für sie direktes Unicode schriebe — AUSGENOMMEN die von ihm selbst
 * benötigte Delimiter-Flanking-Disambiguierung (numerische W-Entity in
 * exakter dezimaler Normalform an flankendem Markup-Delimiter, siehe
 * isCanonicalFlankingEntity). Alle anderen Inline-Konstrukte sind vom
 * Modus unabhängig.
 *
 * `lineStarts`/`lineNo1`/`startCol0` sind der Positions-Anker: `lineStarts`
 * die Zeilenanfänge des ORIGINAL-Quelltexts (aus ctx.lineStarts,
 * sourceRange.ts), `lineNo1` die 1-basierte Zeilennummer und `startCol0`
 * die 0-basierte Spalte des ERSTEN Zeichens von `line` im Original.
 * Container-Stripping ist nur ein PREFIX, das VOR dem Aufruf entfernt wurde
 * — innerhalb von `line` ist die Abbildung linear: absolute Spalte =
 * startCol0 + lokaler Index. Jeder erzeugte Inline-Knoten trägt damit eine
 * SourceRange (Spec: vom ersten bis unmittelbar nach das letzte
 * Token-Zeichen, halb offen [start, end)).
 */
export function parseInlineLine(line, strict, resolveReference, lineStarts, lineNo1, startCol0, 
// v0.5.3: `\n` (Backslash + Buchstabe `n`) erzeugt einen HardBreak —
// aber NUR dort, wo der Aufrufer `true` übergibt (ausschließlich der
// Heading-Aufruf in parser.ts). Bewusst NICHT global: `n` ist kein
// ESCAPABLE-Zeichen, also war `\n` bisher überall literaler Text
// ("C:\notepad", Diskussionen über Escape-Sequenzen) — eine globale
// Sonderbedeutung hätte genau das gebrochen. Überschriften sind der
// einzige Ort, an dem kein echter Zeilenumbruch möglich ist und daher
// tatsächlich eine neue Notation nötig ist (Spec 10.8: kein unnötiges
// Escaping). Da nur dieser eine Aufrufer die Sonderbedeutung aktiviert,
// ist `\n` dort automatisch auch im Strict Mode kanonisch (der Formatter
// hat keine Alternative) — keine gesonderte Strict-Prüfung nötig.
allowHardBreakEscape = false) {
    const out = [];
    const stack = [];
    let textBuf = '';
    // Quellindex (innerhalb `line`) des ERSTEN Zeichens des aktuellen textBuf —
    // merkt die QUELLSPANNE, nicht die Länge von textBuf (dekodierte Entities
    // und Escapes haben eine andere Länge als ihre Quellform, Spec: Range vom
    // ersten bis unmittelbar nach das letzte Token-Zeichen der Quelle).
    let textBufStartI = -1;
    // Anzahl der am textBuf-Ende tolerierten und entfernten Leerraum-Zeichen
    // (Leerzeichen vor Fußnotenreferenz, Spec 11.7) — beim Flush vom aktuellen
    // Scanindex abzuziehen, damit die Range nicht den wegnormalisierten
    // Leerraum umfasst.
    let textBufEndTrim = 0;
    let i = 0;
    function rangeFor(startI, endI) {
        return rangeFromLines(lineStarts, lineNo1 - 1, startCol0 + startI, lineNo1 - 1, startCol0 + endI);
    }
    function appendText(s) {
        if (textBuf === '' && s !== '') {
            textBufStartI = i;
            textBufEndTrim = 0;
        }
        textBuf += s;
    }
    function flushText() {
        if (textBuf !== '') {
            out.push({ type: 'text', value: textBuf, range: rangeFor(textBufStartI, i - textBufEndTrim) });
            textBuf = '';
        }
        textBufEndTrim = 0;
    }
    function emitNode(node) {
        flushText();
        out.push(node);
    }
    function closeToken(entry, endIndex) {
        flushText(); // Text unmittelbar vor dem Schließer gehört noch zum Inhalt.
        const children = out.slice(entry.startIndex);
        // Ein einzelnes `~` kann innerhalb eines Mehrfachlaufs (~~~) weiterhin
        // über den generischen Stack entstehen. Auch dieser Pfad muss dieselbe
        // v0.5.1-Invariante wie der atomare Normalpfad einhalten; andernfalls
        // würde parse() einen AST liefern, den Validator und Formatter zu Recht
        // ablehnen. Der Parser meldet die mehrdeutige Form deshalb laut.
        if (entry.token === '~') {
            const child = children.length === 1 ? children[0] : undefined;
            if (child?.type !== 'text' || child.value === '' || /\s/u.test(child.value)) {
                throw new InlineSyntaxError('Sub-Inhalt muss atomarer, nichtleerer Text ohne Whitespace sein');
            }
        }
        out.length = entry.startIndex;
        if (children.length === 0)
            throw new InlineSyntaxError('Leerer Token-Inhalt');
        out.push({ type: entry.nodeType, children, range: rangeFor(entry.sourceStartI, endIndex) });
    }
    /**
     * Öffnet ein neues Token. Weist gleichartiges direktes Nesting zurück
     * (Spec 10.6, Fehler 10.7) — z.B. `**a **b** c**`: Strong direkt in
     * Strong verschachtelt, auch wenn die Quelltoken unterschiedlich wären
     * (`_..._` in `*...*` zählt ebenso, da beide zu `em` werden — die Regel
     * bezieht sich auf den resultierenden AST-Knotentyp, nicht die
     * Quellzeichen, siehe ast.ts Validator-Invariante "kein gleichartiges
     * direktes Nesting").
     */
    function openToken(token, sourceStartI) {
        const nodeType = tokenNodeType(token);
        const top = stack[stack.length - 1];
        if (strict && token.includes('_')) {
            const canonicalEmStrong = token === '__' && top?.token === '*' && top.nodeType === 'em';
            if (!canonicalEmStrong) {
                throw new InlineSyntaxError('Unterstrich-Markup ist im Strict Mode nur als unmittelbares Strong-Kind von Em kanonisch (*__…__*)');
            }
        }
        if (top && top.nodeType === nodeType) {
            throw new InlineSyntaxError(`Gleichartiges direktes Nesting nicht zulässig: ${nodeType}`);
        }
        flushText();
        stack.push({ token, nodeType, startIndex: out.length, sourceStartI });
    }
    /**
     * Ein Lauf identischer Zeichen (z.B. "***", "~~~", "==") wird von links
     * konsumiert. Bei jedem Schritt: zuerst prüfen, ob ein Präfix passender
     * Länge den aktuellen Stack-Top schließen kann; sonst greedy-longest für
     * einen neuen Öffner versuchen; sonst als Literaltext übernehmen.
     */
    function processRun(ch, runLen, runStart) {
        const beforeRun = charClass(codePointBefore(line, runStart));
        const afterRun = charClass(codePointAfter(line, runStart + runLen));
        // '-' hat eine Sonderregel (10.11): nur "--" ist ein
        // gültiger Obsolete-Öffner, 3+ Bindestriche (verbreitete ASCII-
        // Ersatzschreibung für den Gedankenstrich in Fließtext) sind nie ein
        // Obsolete-Öffner und bleiben Fließtext.
        if (ch === '-') {
            if (runLen === 2) {
                processFixedLength('--', beforeRun, afterRun, runStart);
                return;
            }
            appendText('-'.repeat(runLen));
            return;
        }
        const allowedLens = ch === '*' || ch === '_' || ch === '~' ? [2, 1] : ch === '^' ? [1] : [2];
        let consumed = 0;
        while (consumed < runLen) {
            const remaining = runLen - consumed;
            const prevCls = consumed === 0 ? beforeRun : 'P';
            let matched = false;
            for (const len of allowedLens) {
                if (remaining < len)
                    continue;
                const nextCls = consumed + len === runLen ? afterRun : 'P';
                const token = ch.repeat(len);
                const top = stack[stack.length - 1];
                if (top && top.token === token && isCloser(prevCls, nextCls)) {
                    closeToken(top, runStart + consumed + len);
                    stack.pop();
                    consumed += len;
                    matched = true;
                    break;
                }
            }
            if (matched)
                continue;
            // Öffnen versucht — anders als beim Schließen NUR die eine
            // längstmögliche Länge an dieser Position, kein Fallback auf eine
            // kürzere Länge bei derselben Startposition. Ein Fallback würde z.B.
            // bei "mc**2" nach gescheitertem Strong-Versuch (Öffner nach
            // Wortzeichen verboten) fälschlich noch einen Em-Öffner aus der
            // zweiten Hälfte desselben Laufs erzeugen — ein Phantom-Token ohne
            // Schließer. Das Spec-Beispiel verlangt hier "kein Markup" (10.3).
            {
                const len = allowedLens.find((l) => remaining >= l);
                if (len !== undefined) {
                    const nextCls = consumed + len === runLen ? afterRun : 'P';
                    if (isOpener(prevCls, nextCls)) {
                        openToken(ch.repeat(len), runStart + consumed);
                        consumed += len;
                        matched = true;
                    }
                }
            }
            if (matched)
                continue;
            // Weder Schließen noch Öffnen war möglich. Ist noch nichts aus diesem
            // Lauf erfolgreich verarbeitet (consumed === 0), bleibt der GESAMTE
            // Rest des Laufs literal, statt zeichenweise weiterzuversuchen — sonst
            // würde z.B. bei "mc**2" nach dem gescheiterten Strong-Versuch das
            // zweite Sternchen isoliert erneut als Em-Öffner geprüft und (da rein
            // formal von Satzzeichen und Wortzeichen flankiert) fälschlich als
            // Öffner ohne Schließer akzeptiert. Ist bereits etwas aus diesem Lauf
            // erfolgreich geschlossen/geöffnet worden (consumed > 0), betrifft
            // das Scheitern nur noch den unmittelbaren Rest — dort reicht die
            // zeichenweise Behandlung.
            if (consumed === 0) {
                appendText(ch.repeat(runLen));
                consumed = runLen;
                break;
            }
            appendText(ch);
            consumed += 1;
        }
    }
    /** Zweizeichen-Token ohne Ein-Zeichen-Form (`--`). */
    function processFixedLength(token, beforeRun, afterRun, runStart) {
        const top = stack[stack.length - 1];
        if (top && top.token === token && isCloser(beforeRun, afterRun)) {
            closeToken(top, runStart + 2);
            stack.pop();
            return;
        }
        if (isOpener(beforeRun, afterRun)) {
            openToken(token, runStart);
            return;
        }
        appendText(token);
    }
    /**
     * Sup/Sub sind seit v0.5.1 atomare Ein-Zeichen-Konstrukte: kein
     * Wortzeichen-Flanking, aber ein nichtleerer, whitespacefreier Inhalt.
     * Innerhalb des Bereichs werden ausschließlich Escapes und Entities als
     * Text dekodiert; andere Markanto-Zeichen bleiben literal und eröffnen
     * kein verschachteltes Markup. Der Scan läuft nur vorwärts bis zum ersten
     * unescapten passenden Delimiter oder Whitespace. Scheitert er, bleibt der
     * Öffner literal — auch im Strict Mode.
     */
    function matchAtomicSupSub(start, delimiter) {
        const first = line[start + 1];
        if (first === undefined || first === delimiter || /\s/u.test(first))
            return null;
        let pos = start + 1;
        let value = '';
        while (pos < line.length) {
            const current = line[pos];
            if (/\s/u.test(current))
                return null;
            if (current === delimiter)
                return { end: pos + 1, value };
            if (current === '\\' && line[pos + 1] !== undefined && ESCAPABLE.has(line[pos + 1])) {
                value += line[pos + 1];
                pos += 2;
                continue;
            }
            if (current === '&') {
                const entity = matchEntity(line, pos);
                if (entity !== null) {
                    if (/\s/u.test(entity.value))
                        return null;
                    if (strict) {
                        throw new InlineSyntaxError('HTML-Entity ist im Strict Mode nicht kanonisch (Formatter schreibt direktes Unicode-Zeichen)');
                    }
                    value += entity.value;
                    pos += entity.raw.length;
                    continue;
                }
            }
            value += current;
            pos++;
        }
        return null;
    }
    while (i < line.length) {
        const ch = line[i];
        // Der häufigste Pfad ist gewöhnliche Prosa. Sie in einem Slice zu
        // übernehmen vermeidet einen appendText()-Aufruf und eine String-
        // Konkatenation pro Zeichen; an Syntaxkandidaten bleibt die bestehende
        // Prioritätslogik unten unverändert zuständig. Für sehr kurze Reste ist
        // die native Regex-Suche teurer als die bestehende Zeichenschleife.
        if (line.length - i >= MIN_PLAIN_TEXT_SCAN_LENGTH) {
            const plainTextEnd = nextInlineSyntaxCharIndex(line, i);
            if (plainTextEnd > i) {
                appendText(line.slice(i, plainTextEnd));
                i = plainTextEnd;
                continue;
            }
        }
        if (ch === '\\') {
            const next = line[i + 1];
            if (next === 'n' && allowHardBreakEscape) {
                emitNode({ type: 'hardBreak', range: rangeFor(i, i + 2) });
                i += 2;
                continue;
            }
            if (next !== undefined && ESCAPABLE.has(next)) {
                appendText(next);
                i += 2;
                continue;
            }
            appendText('\\');
            i += 1;
            continue;
        }
        if (ch === '`') {
            let runLen = 0;
            while (line[i + runLen] === '`')
                runLen++;
            const fence = '`'.repeat(runLen);
            const closeAt = line.indexOf(fence, i + runLen);
            if (closeAt === -1)
                throw new InlineSyntaxError('Inline-Code ohne passenden Backtick-Run');
            emitNode({ type: 'inlineCode', value: stripProtectiveSpaces(line.slice(i + runLen, closeAt)), range: rangeFor(i, closeAt + runLen) });
            i = closeAt + runLen;
            continue;
        }
        if (ch === '$' && line[i + 1] === '`') {
            const closeAt = line.indexOf('`$', i + 2);
            if (closeAt === -1)
                throw new InlineSyntaxError('Inline-Math ohne Abschluss');
            if (closeAt === i + 2)
                throw new InlineSyntaxError('Inline-Math ohne Inhalt (Spec 14.2: kein leerer Inhalt)');
            emitNode({ type: 'inlineMath', value: line.slice(i + 2, closeAt), range: rangeFor(i, closeAt + 2) });
            i = closeAt + 2;
            continue;
        }
        if (ch === 'h') {
            const bareUrl = matchBareUrl(line, i);
            if (bareUrl !== null) {
                if (strict) {
                    throw new InlineSyntaxError('Nackter URL-Autolink ist im Strict Mode nicht kanonisch (Formatter schreibt <URL>)');
                }
                emitNode({ type: 'autolink', kind: 'url', value: bareUrl.value, range: rangeFor(i, bareUrl.end) });
                i = bareUrl.end;
                continue;
            }
        }
        if (ch === '<') {
            const wrapper = matchWrapperConstruct(line, i, (text, contentStart) => parseInlineLine(text, strict, resolveReference, lineStarts, lineNo1, startCol0 + contentStart), resolveReference, strict);
            if (wrapper !== null) {
                if (strict && 'viaReference' in wrapper && wrapper.viaReference === true) {
                    throw new InlineSyntaxError('Referenzlink im Wrapper ist im Strict Mode nicht kanonisch');
                }
                if (wrapper.kind === 'span') {
                    emitNode({ type: 'span', attrs: wrapper.attrs, children: inlineNonEmpty(wrapper.children), range: rangeFor(i, wrapper.end) });
                }
                else if (wrapper.kind === 'em' || wrapper.kind === 'strong') {
                    const previousClass = charClass(codePointBefore(line, i));
                    const nextClass = charClass(codePointAfter(line, wrapper.end));
                    const previousIsWord = previousClass === 'W' || canonicalWordEntityEndingAt(line, i);
                    const nextIsWord = nextClass === 'W' || canonicalWordEntityStartingAt(line, wrapper.end);
                    if (strict && !previousIsWord && !nextIsWord) {
                        throw new InlineSyntaxError(`<${wrapper.kind}> ist hier nicht kanonisch (Formatter schreibt Stern-Delimiter)`);
                    }
                    emitNode({ type: wrapper.kind, children: inlineNonEmpty(wrapper.children), range: rangeFor(i, wrapper.end) });
                }
                else if (wrapper.kind === 'download') {
                    emitNode({
                        type: 'link', href: wrapper.src, ...(wrapper.title !== undefined ? { title: wrapper.title } : {}),
                        download: true, ...(wrapper.attrs !== undefined ? { attrs: wrapper.attrs } : {}),
                        children: wrapper.children ?? [{ type: 'text', value: wrapper.alt }], range: rangeFor(i, wrapper.end),
                    });
                }
                else {
                    throw new InlineSyntaxError(`Typisierte Ressource (${wrapper.kind}) ist im Fließtext nicht zulässig`);
                }
                i = wrapper.end;
                continue;
            }
        }
        if (ch === '<') {
            const closeAt = line.indexOf('>', i + 1);
            if (closeAt !== -1) {
                const inner = line.slice(i + 1, closeAt);
                if (URL_AUTOLINK_RE.test(inner)) {
                    emitNode({ type: 'autolink', kind: 'url', value: inner, range: rangeFor(i, closeAt + 1) });
                    i = closeAt + 1;
                    continue;
                }
                if (EMAIL_AUTOLINK_RE.test(inner)) {
                    emitNode({ type: 'autolink', kind: 'email', value: inner, range: rangeFor(i, closeAt + 1) });
                    i = closeAt + 1;
                    continue;
                }
            }
            appendText(ch);
            i++;
            continue;
        }
        if (ch === '&') {
            const entity = matchEntity(line, i);
            if (entity !== null) {
                if (strict && !isCanonicalFlankingEntity(line, i, entity)) {
                    throw new InlineSyntaxError('HTML-Entity ist im Strict Mode nicht kanonisch (Formatter schreibt direktes Unicode-Zeichen)');
                }
                // Direkt in textBuf, nicht über emitNode/einen eigenen Knotentyp:
                // eine dekodierte Entity eröffnet niemals nachträglich Markup (Spec
                // 10.8.1) — "&#42;" wird zu literalem Text "*", nicht zu einem
                // Emphasis-Delimiter. Der Zeichenstrom wird nach der Dekodierung
                // nicht erneut gescannt.
                appendText(entity.value);
                i += entity.raw.length;
                continue;
            }
            appendText(ch);
            i++;
            continue;
        }
        if (ch === '[' && line[i + 1] === '^') {
            const m = FOOTNOTE_REF_RE.exec(line.slice(i));
            if (m) {
                // Spec 11.7: kein Leerzeichen zwischen Wort und Referenz ("Wort[^1]"
                // nicht "Wort [^1]"). Im Strict Mode ein Nichtkanonizitätsfehler,
                // analog zu Entities/Referenzlinks oben. Im Normalmodus toleriert,
                // aber NICHT im AST behalten (analog zur ≤3-Leerzeichen-Toleranz vor
                // Heading/HR/Zitatpräfix, "toleriert und normalisiert weg") — sonst
                // würde format(parse(...)) das Leerzeichen wieder entfernen und
                // Kanonizitätsgesetz 1 (parse(format(ast)) semantisch gleich ast,
                // Spec 7.3.1) für genau diesen Fall verletzen.
                if (/[ \t]$/.test(textBuf)) {
                    if (strict) {
                        throw new InlineSyntaxError('Leerzeichen vor Fußnotenreferenz ist im Strict Mode nicht kanonisch (Spec 11.7)');
                    }
                    const wsMatch = /[ \t]+$/.exec(textBuf);
                    textBufEndTrim += wsMatch[0].length;
                    textBuf = textBuf.slice(0, -wsMatch[0].length);
                }
                emitNode({ type: 'footnoteReference', identifier: m[1], range: rangeFor(i, i + m[0].length) });
                i += m[0].length;
                continue;
            }
            // Ein fehlgeschlagener Fußnotenversuch bleibt literal, sofern die
            // gesamte Klammerform nicht doch eine gültige Link-/Span-Konstruktion
            // ist (z.B. "[^b^](ziel)" mit Sup im Linklabel). Insbesondere darf das
            // bereits strukturell geprüfte Caret seit v0.4.1 nicht erneut als
            // generischer ^sup^-Öffner gescannt werden. Wir konsumieren nur das
            // eindeutige Präfix; der restliche Text läuft anschließend regulär
            // durch den Scanner. Dadurch bleiben "[^]: …" und "[^1a!]: …"
            // sichtbar, statt einen Sup-Fehler zu erzeugen oder als
            // Referenzdefinition zu verschwinden.
            const bracketFallback = matchBracketConstruct(line, i, (text, labelStart) => parseInlineLine(text, strict, resolveReference, lineStarts, lineNo1, startCol0 + labelStart), resolveReference, strict);
            if (bracketFallback === null) {
                appendText('[^');
                i += 2;
                continue;
            }
        }
        // Priorität vor dem generischen Delimiter-Stack: Ein einzelnes ^ bzw.
        // ein einzelner ~-Lauf ist das atomare v0.5.1-Sup/Sub-Konstrukt. ~~ und
        // längere Tilde-Läufe bleiben beim bestehenden Longest-Match-Pfad.
        if (ch === '^' || (ch === '~' && line[i - 1] !== '~' && line[i + 1] !== '~')) {
            const atomic = matchAtomicSupSub(i, ch);
            if (atomic !== null) {
                emitNode({
                    type: ch === '^' ? 'sup' : 'sub',
                    children: [{ type: 'text', value: atomic.value, range: rangeFor(i + 1, atomic.end - 1) }],
                    range: rangeFor(i, atomic.end),
                });
                i = atomic.end;
                continue;
            }
            appendText(ch);
            i++;
            continue;
        }
        if (ch === '!' || ch === '[') {
            const match = matchBracketConstruct(line, i, (text, labelStart) => parseInlineLine(text, strict, resolveReference, lineStarts, lineNo1, startCol0 + labelStart), resolveReference, strict);
            if (match !== null) {
                // Referenzlink-/-bild-Syntax (Spec 8.2) ist eine rein tolerante
                // Eingabeform ohne eigene kanonische Serialisierung (format()
                // schreibt immer die direkte Klammerform) — im Strict Mode daher
                // ein Nichtkanonizitätsfehler, analog zu dekodierten HTML-Entities
                // und der `{id: …}`-Langform.
                if (strict && match.kind !== 'span' && match.viaReference === true) {
                    throw new InlineSyntaxError('Referenzlink/-bild im Strict Mode nicht kanonisch — nur direkte [text](url)-Form ist kanonisch');
                }
                if (match.kind === 'link') {
                    emitNode({
                        type: 'link',
                        href: match.href,
                        ...(match.title !== undefined ? { title: match.title } : {}),
                        ...(match.download === true ? { download: true } : {}),
                        ...(match.attrs !== undefined ? { attrs: match.attrs } : {}),
                        children: match.children,
                        range: rangeFor(i, match.end),
                    });
                    i = match.end;
                    continue;
                }
                if (match.kind === 'image') {
                    emitNode({
                        type: 'inlineImage',
                        src: match.src,
                        alt: match.alt,
                        ...(match.title !== undefined ? { title: match.title } : {}),
                        ...(match.attrs !== undefined ? { attrs: match.attrs } : {}),
                        range: rangeFor(i, match.end),
                    });
                    i = match.end;
                    continue;
                }
                if (match.kind === 'download') {
                    emitNode({
                        type: 'link', href: match.src, ...(match.title !== undefined ? { title: match.title } : {}),
                        download: true, ...(match.attrs !== undefined ? { attrs: match.attrs } : {}),
                        children: match.children ?? [{ type: 'text', value: match.alt }], range: rangeFor(i, match.end),
                    });
                    i = match.end;
                    continue;
                }
                // video/audio/embed: ausschließlich Blockressourcen (Spec 4.2.1,
                // 4.2.3) — eine typisierte Form im Fließtext ist ein Syntaxfehler.
                // Block-Erkennung (parser.ts, tryMatchResourceLine) ruft
                // matchBracketConstruct() für alleinstehende Ressourcenzeilen
                // separat auf und erreicht diesen Zweig hier nie.
                throw new InlineSyntaxError(`Typisierte Ressource (${match.kind}) ist im Fließtext nicht zulässig`);
            }
            appendText(ch);
            i++;
            continue;
        }
        if (DELIM_CHARS.has(ch)) {
            let runLen = 0;
            while (line[i + runLen] === ch)
                runLen++;
            processRun(ch, runLen, i);
            i += runLen;
            continue;
        }
        appendText(ch);
        i++;
    }
    flushText();
    if (stack.length > 0) {
        const top = stack[stack.length - 1];
        throw new InlineSyntaxError(`Nicht geschlossenes Token: ${top.token}`);
    }
    return out;
}
export function inlineNonEmpty(nodes) {
    if (nodes.length === 0)
        throw new InlineSyntaxError('Leerer Inline-Inhalt');
    return nodes;
}
/**
 * Sichtbarkeitsregel für Inline-Inhalte (Spec 5.3, ast.ts: "Kein Linktext
 * (children leer) → href als Anzeigetext"): Ein Text-Knoten ist sichtbar,
 * wenn er nicht nur aus Leerraum besteht; Breaks sind unsichtbar; Markup,
 * Span und Link sind sichtbar, wenn ihre Kinder sichtbar sind; ein Link mit
 * LEEREN Kindern ist sichtbar, sobald sein href nicht leer ist (die
 * Shortlink-/`[](url)`-Form hat kein Label, aber ein sichtbares Ziel als
 * Anzeigetext). InlineCode/InlineMath/InlineImage/Autolink/FootnoteReference
 * gelten immer als sichtbar.
 *
 * Gemeinsame Regel für den Validator (list-item-empty-Prüfung in validator.ts)
 * und den Formatter (inlinePlainText-Labelfallback) — nicht zweimal gepflegt.
 */
export function hasVisibleInlineContent(nodes) {
    return nodes.some((n) => {
        switch (n.type) {
            case 'text':
                return n.value.trim() !== '';
            case 'softBreak':
            case 'hardBreak':
                return false;
            case 'em':
            case 'strong':
            case 'strike':
            case 'obsolete':
            case 'insert':
            case 'mark':
            case 'sup':
            case 'sub':
            case 'span':
                return hasVisibleInlineContent(n.children);
            case 'link':
                return n.children.length === 0 ? n.href !== '' : hasVisibleInlineContent(n.children);
            default:
                return true; // inlineCode, inlineMath, inlineImage, autolink, footnoteReference
        }
    });
}
/**
 * Flacher, markupbereinigter Text eines Inline-Baums. Ursprünglich für die
 * Spaltenbreitenmessung (Spec 12.4) gebaut, jetzt auch für die
 * Heading-Slug-Ableitung (Spec 6.3) genutzt — gemeinsame Stelle statt
 * zweier unabhängig gepflegter Kopien. Für Knoten ohne unmittelbaren
 * Textinhalt gibt es keine normative Vorgabe, welcher sichtbare Ersatztext
 * zählt — hier gewählt (Codex-Review, 2026-08-18):
 *   - Link: Linktext (children), sonst href als Anzeigetext (spiegelt exakt
 *     die im AST dokumentierte Fallback-Regel "Kein Linktext → href als
 *     Anzeigetext").
 *   - InlineImage: alt-Text, da das einzige textuelle Äquivalent des Bildes.
 *   - Span: transparent, Breite/Text seiner children.
 *   - FootnoteReference: identifier als Platzhalter, da die tatsächliche
 *     Fußnotennummer erst dokumentweit vergeben wird (Spec 11.5).
 */
export function inlinePlainText(children) {
    return children
        .map((child) => {
        switch (child.type) {
            case 'text':
            case 'inlineCode':
            case 'inlineMath':
            case 'autolink':
                return child.value;
            case 'em':
            case 'strong':
            case 'strike':
            case 'obsolete':
            case 'insert':
            case 'mark':
            case 'sup':
            case 'sub':
            case 'span':
                return inlinePlainText(child.children);
            case 'link': {
                return hasVisibleInlineContent(child.children) ? inlinePlainText(child.children) : child.href;
            }
            case 'inlineImage':
                return child.alt;
            case 'footnoteReference':
                return child.identifier;
            case 'softBreak':
            case 'hardBreak':
                // Laut Validator-Invariante nicht in TableCell.children erlaubt;
                // hier nur als defensiver Fallback, kein normativer Fall.
                return ' ';
        }
    })
        .join('');
}
