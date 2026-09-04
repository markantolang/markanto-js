/**
 * Markanto — Ressourcen-Grammatik (Spec Kapitel 4, 5.4, 5.9).
 *
 * Gemeinsame Bausteine für `[...]`-basierte Inline-Konstrukte (Link, Bild,
 * attributpflichtiger Span und Ressourcen-Discriminator — Scan-Prioritäten aus Spec 10.4) und
 * für die block-eigene Ressourcenzeile in parser.ts (§15.7 `resourceLine`).
 * `inline.ts` orchestriert den Inline-Fall, `parser.ts` den Block-Fall —
 * beide nutzen dieselben Parser-Bausteine hier, damit Ziel-/Attribut-
 * Grammatik nicht zweimal geschrieben wird (genau die Redundanz, die wir
 * in der Spec selbst in §4.3/5.4/15.7 vereinheitlicht haben).
 *
 * Bewusste Vereinfachung: Labels werden ohne verschachtelte `[...]`-Klammern
 * gescannt (nur Escapes und Inline-Code-Spans werden beim Sn Sich der
 * schließenden `]` übersprungen) — konsistent mit "Verschachtelte Links/
 * Bilder im Label sind unzulässig" (Spec 4.2.4), nicht mit beliebig
 * verschachtelbaren literalen Klammern im Label-Text.
 */
import { InlineSyntaxError } from './errors.js';
/** Spec 4.2.4: normativer Grenzwert für verschachtelte runde Klammern im Linkziel. */
export const MAX_LINK_PAREN_DEPTH = 8;
/**
 * Findet das zu `[` an Position `start` passende `]`. Backtick-Code-Spans
 * werden als atomare Einheit übersprungen (ein `]` darin schließt das Label
 * nicht); Escapes werden konsumiert, ohne den Klammerzähler zu beeinflussen.
 * Balancierte `[...]`-Paare im Label werden mitgezählt (Tiefenzähler), damit
 * die äußere schließende `]` korrekt gefunden wird — "Verschachtelte Links/
 * Bilder im Label sind unzulässig" (Spec 4.2.4) ist eine SEMANTISCHE Prüfung
 * auf den geparsten Label-Inhalt (siehe assertNoNestedResource), keine rein
 * syntaktische Ablehnung von `[` im Label: der Rohtext des Labels wird
 * anschließend selbst wieder durch den Inline-Scanner gejagt, der ein
 * `[inner](url)` darin als echten Link erkennt.
 */
export function matchBracketLabel(line, start) {
    let i = start + 1;
    let depth = 0;
    while (i < line.length) {
        const ch = line[i];
        if (ch === '\\' && line[i + 1] !== undefined) {
            i += 2;
            continue;
        }
        if (ch === '`') {
            let runLen = 0;
            while (line[i + runLen] === '`')
                runLen++;
            const fence = '`'.repeat(runLen);
            const closeAt = line.indexOf(fence, i + runLen);
            if (closeAt === -1)
                return null;
            i = closeAt + runLen;
            continue;
        }
        if (ch === '[') {
            depth++;
            i++;
            continue;
        }
        if (ch === ']') {
            if (depth === 0)
                return { raw: line.slice(start + 1, i), end: i + 1 };
            depth--;
            i++;
            continue;
        }
        i++;
    }
    return null;
}
/**
 * Scannt ein Linkziel ab `pos` — `<...>`-Form (kein Tiefenzähler) oder
 * balancierte runde Klammern bis `MAX_LINK_PAREN_DEPTH` (Spec 4.2.4). Von
 * matchDestinationAndTitle (geklammerte Ressourcenform) UND
 * matchReferenceDefinitionTail (Referenzdefinition ohne Klammer, Spec 8.2)
 * gemeinsam genutzt — dieselbe Zielgrammatik, unterschiedlicher äußerer
 * Rahmen. Wirft bei Tiefenüberschreitung oder unterbrochener `<...>`-Form.
 */
function scanDestination(line, pos) {
    let i = pos;
    if (line[i] === '<') {
        const closeAt = line.indexOf('>', i + 1);
        if (closeAt === -1)
            throw new InlineSyntaxError('Linkziel in <...> nicht geschlossen');
        return { destination: line.slice(i + 1, closeAt), end: closeAt + 1 };
    }
    let depth = 0;
    let dest = '';
    while (i < line.length) {
        const ch = line[i];
        if (ch === '\\' && line[i + 1] !== undefined) {
            dest += ch + line[i + 1];
            i += 2;
            continue;
        }
        if (ch === '(') {
            depth++;
            if (depth > MAX_LINK_PAREN_DEPTH) {
                throw new InlineSyntaxError(`Mehr als ${MAX_LINK_PAREN_DEPTH} Ebenen verschachtelter runder Klammern im Linkziel`);
            }
            dest += ch;
            i++;
            continue;
        }
        if (ch === ')') {
            if (depth === 0)
                break;
            depth--;
            dest += ch;
            i++;
            continue;
        }
        // Spec 4.3: balancedDestinationChar = [^ \t\n()] | ... — nur ASCII-
        // Leerzeichen/Tab/LF beenden das Ziel, kein `\s` (der z.B. auch ein
        // geschütztes Leerzeichen U+00A0 träfe und es fälschlich als Trenner
        // statt als Teil des Ziels behandeln würde).
        if (ch === ' ' || ch === '\t' || ch === '\n')
            break;
        dest += ch;
        i++;
    }
    return { destination: dest, end: i };
}
/**
 * Scannt einen optionalen Titel (`"…"`, `'…'` oder `(…)`) ab `pos` — `null`,
 * wenn dort kein Titel-Öffner steht. Von matchDestinationAndTitle UND
 * matchReferenceDefinitionTail gemeinsam genutzt.
 */
function scanTitle(line, pos) {
    const open = line[pos];
    if (open !== '"' && open !== "'" && open !== '(')
        return null;
    const close = open === '(' ? ')' : open;
    let j = pos + 1;
    let t = '';
    let closed = false;
    while (j < line.length) {
        const ch = line[j];
        if (ch === '\\' && line[j + 1] !== undefined) {
            t += line[j + 1];
            j += 2;
            continue;
        }
        if (ch === close) {
            closed = true;
            j++;
            break;
        }
        if (ch === '\n')
            break;
        t += ch;
        j++;
    }
    if (!closed)
        throw new InlineSyntaxError('Linktitel nicht geschlossen');
    return { title: t, end: j };
}
/**
 * Parst `(destination "title")` unmittelbar ab `pos` (muss auf `(` zeigen).
 * Titel optional. Wirft bei Tiefenüberschreitung oder fehlendem Abschluss —
 * an dieser Stelle ist bereits klar, dass ein Ressourcentoken begonnen wurde.
 */
export function matchDestinationAndTitle(line, pos) {
    if (line[pos] !== '(')
        return null;
    let i = pos + 1;
    const dest = scanDestination(line, i);
    i = dest.end;
    while (line[i] === ' ' || line[i] === '\t')
        i++;
    const titleMatch = scanTitle(line, i);
    let title;
    if (titleMatch) {
        title = titleMatch.title;
        i = titleMatch.end;
        while (line[i] === ' ' || line[i] === '\t')
            i++;
    }
    if (line[i] !== ')')
        throw new InlineSyntaxError('Linkziel-Klammer nicht geschlossen');
    i++;
    return { destination: dest.destination, ...(title !== undefined ? { title } : {}), end: i };
}
/**
 * Parst `destination "title"` (ohne umschließende Klammer) ab `pos` bis zum
 * Zeilenende — die Ziel-Grammatik einer Referenzlink-Definition
 * (`[label]: destination "title"`, Spec 8.2, tolerante Eingabeform). Anders
 * als matchDestinationAndTitle: kein schließendes `)` erwartet, dafür MUSS
 * nach optionalem Titel nur noch Leerraum bis Zeilenende folgen — sonst kein
 * Match (die Zeile ist dann keine gültige Referenzdefinition).
 */
export function matchReferenceDefinitionTail(line, pos) {
    if (line[pos] === undefined || line[pos] === ' ' || line[pos] === '\t')
        return null;
    try {
        const dest = scanDestination(line, pos);
        if (dest.destination === '')
            return null;
        let i = dest.end;
        while (line[i] === ' ' || line[i] === '\t')
            i++;
        const titleMatch = i < line.length ? scanTitle(line, i) : null;
        let title;
        if (titleMatch) {
            title = titleMatch.title;
            i = titleMatch.end;
        }
        while (line[i] === ' ' || line[i] === '\t')
            i++;
        // Anders als matchDestinationAndTitle (erwartet ")"): hier muss nach
        // optionalem Titel nur noch Leerraum bis Zeilenende folgen — sonst ist
        // die Zeile keine gültige Referenzdefinition (kein Syntaxfehler, nur
        // kein Match, siehe Funktionskommentar).
        if (i !== line.length)
            return null;
        return { destination: dest.destination, ...(title !== undefined ? { title } : {}), end: i };
    }
    catch {
        // Unterbrochene <...>-Form oder unterbrochener Titel: keine gültige
        // Referenzdefinition (nicht dasselbe "einmal committed, dann Fehler"
        // wie bei matchDestinationAndTitle — ein `[label]:`-Zeilenanfang ist
        // nicht so eindeutig ressourcentypisch wie `[text](`).
        return null;
    }
}
const ATTR_KEY_RE = /^(data-[a-zA-Z][a-zA-Z0-9_-]*|[a-zA-Z][a-zA-Z0-9_-]*)/;
const ATTR_ESCAPE_TARGETS = { '\\': '\\', '"': '"' };
/**
 * Parst die gemeinsame `key=value`-Grammatik in `{…}` (Span) ab `pos`.
 * Bare Werte schließen ASCII-Leerraum sowie `"<>{}` aus; quoted values
 * erlauben alles außer LF und den ausschließlich über `\\"`/`\\\\`
 * erreichbaren reservierten Zeichen. Der Cursor läuft strikt vorwärts.
 */
export function matchAttrsBlock(line, pos) {
    if (line[pos] !== '{')
        return null;
    let i = pos + 1;
    const skipS = () => {
        while (line[i] === ' ' || line[i] === '\t')
            i++;
    };
    skipS();
    if (line[i] === '}')
        return { entries: [], end: i + 1 };
    const entries = [];
    for (;;) {
        skipS();
        const keyMatch = ATTR_KEY_RE.exec(line.slice(i));
        if (!keyMatch)
            throw new InlineSyntaxError('Ungültiger Attributschlüssel');
        const key = keyMatch[1];
        i += key.length;
        skipS();
        if (line[i] !== '=')
            throw new InlineSyntaxError("Attributeintrag ohne '='");
        i++;
        let value;
        if (line[i] === '"') {
            let j = i + 1;
            let v = '';
            while (j < line.length && line[j] !== '"') {
                const ch = line[j];
                if (ch === '\\') {
                    const escaped = ATTR_ESCAPE_TARGETS[line[j + 1] ?? ''];
                    if (escaped === undefined)
                        throw new InlineSyntaxError('Ungültige Escape-Sequenz im Attributwert');
                    v += escaped;
                    j += 2;
                    continue;
                }
                if (ch === '\n')
                    throw new InlineSyntaxError('Zeilenumbruch innerhalb {…} nicht zulässig');
                v += ch;
                j++;
            }
            if (line[j] !== '"')
                throw new InlineSyntaxError('Attributwert (quotedValue) nicht geschlossen');
            value = v;
            i = j + 1;
        }
        else {
            let v = '';
            while (i < line.length && !/[ \t"<>{}]/.test(line[i])) {
                v += line[i];
                i++;
            }
            value = v;
            if (value === '')
                throw new InlineSyntaxError('Leerer Attributwert');
        }
        entries.push({ key, value });
        const beforeSeparator = i;
        skipS();
        if (line[i] === '}') {
            i++;
            break;
        }
        if (i === beforeSeparator)
            throw new InlineSyntaxError("Attributliste: Leerraum oder '}' erwartet");
    }
    return { entries, end: i };
}
/** Baut & validiert Ressourcenmetadaten (Spec 4.2.1, 5.4). */
export function buildResourceAttrs(entries) {
    const seen = new Set();
    const result = {};
    const dataAttrs = {};
    let hasData = false;
    for (const { key, value } of entries) {
        if (key === 'role')
            throw new InlineSyntaxError('role ist in Ressourcenmetadaten nicht zulässig');
        if (seen.has(key))
            throw new InlineSyntaxError(`Doppeltes Attribut: ${key}`);
        seen.add(key);
        if (key === 'preview' || key === 'group' || key === 'lang') {
            result[key] = value;
        }
        else if (key.startsWith('data-')) {
            dataAttrs[key.slice('data-'.length)] = value;
            hasData = true;
        }
        else {
            throw new InlineSyntaxError(`Unzulässiges Ressourcenattribut: ${key}`);
        }
    }
    if (hasData)
        result.dataAttrs = dataAttrs;
    return result;
}
/** Baut & validiert Span-Attribute (Spec 5.4, 5.9: nur lang|data-*). */
export function buildSpanAttrs(entries) {
    const seen = new Set();
    const result = {};
    const dataAttrs = {};
    let hasData = false;
    for (const { key, value } of entries) {
        if (key === 'role')
            throw new InlineSyntaxError('{role: …} ist bei Spans nicht zulässig');
        if (seen.has(key))
            throw new InlineSyntaxError(`Doppeltes Attribut: ${key}`);
        seen.add(key);
        if (key === 'lang') {
            result[key] = value;
        }
        else if (key.startsWith('data-')) {
            dataAttrs[key.slice('data-'.length)] = value;
            hasData = true;
        }
        else {
            throw new InlineSyntaxError(`Unzulässiges Span-Attribut: ${key}`);
        }
    }
    if (hasData)
        result.dataAttrs = dataAttrs;
    return result;
}
/**
 * Spec 4.4/ast.ts: "lokaler Pfad, /pfad, https://, http:// — keine anderen
 * Schemes" für Bild-/Video-/Audio-Ziele (embed verlangt zusätzlich zwingend
 * `https://`, siehe assertValidTypedTarget). Whitelist statt Blockliste —
 * eine Blockliste (früher: nur javascript:/data:/file:/protokollrelativ)
 * lässt jedes nicht explizit genannte Fremdschema (z.B. `ftp://`) klaglos
 * durch; exportiert, damit validator.ts dieselbe Grammatik für
 * programmatisch/aus JSON gebaute ASTs prüfen kann, statt sie ein zweites
 * Mal zu duplizieren (Codex-Review, 2026-08-18: Parser akzeptierte zuvor
 * `[v](ftp://x){type: video}`, `![x](javascript:alert(1))` und
 * `[x](ftp://x){type: image}` klaglos — Bilder durchliefen bislang gar
 * keine Zielvalidierung).
 */
export function isValidMediaTarget(destination) {
    if (destination === '')
        return false;
    if (/^https?:\/\//.test(destination))
        return true;
    if (destination.startsWith('//'))
        return false; // protokollrelativ — kein zulässiges Schema
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(destination))
        return false; // anderes explizites Schema
    return true; // lokaler Pfad, inkl. /pfad, ./pfad, ../pfad, relativ ohne Präfix
}
/** Gilt jetzt einheitlich für Bild, Video, Audio und Embed — siehe isValidMediaTarget. */
function assertValidTypedTarget(type, destination) {
    if (!isValidMediaTarget(destination)) {
        throw new InlineSyntaxError(`Unzulässiges Ziel-Schema für Ressource (${type}): ${destination}`);
    }
    if (type === 'embed' && !destination.startsWith('https://')) {
        throw new InlineSyntaxError('type: embed erfordert ein Ziel, das mit https:// beginnt');
    }
}
/**
 * Normalisiert ein Referenzlink-Label für den Tabellenabgleich (Spec 8.2,
 * angelehnt an CommonMark): Leerraum an den Rändern entfernen, interne
 * Leerraumläufe auf ein Leerzeichen kollabieren, klein schreiben. Kein
 * vollständiges Unicode-Case-Folding (nur `toLowerCase`) — für den weit
 * überwiegenden Fall reiner ASCII-/einfacher-Unicode-Labels ausreichend,
 * volles Case-Folding wäre hier eine nicht angeforderte Übergenauigkeit.
 * Von der Vorab-Scan-Stelle (Tabellenaufbau) UND von matchReferenceTail
 * (Nachschlagen) gemeinsam genutzt, damit beide Seiten identisch normalisieren.
 */
export function normalizeReferenceLabel(label) {
    return label.trim().replace(/\s+/g, ' ').toLowerCase();
}
/**
 * Prüft ab `pos` auf eine Referenzlink-Fortsetzung — volle Form `[label]`,
 * kollabierte Form `[]` (Label = `labelRaw`) oder Shortcut-Form (kein `[...]`
 * mehr, Label = `labelRaw`) — und löst sie über `resolveReference` auf.
 * `null`, wenn keine passende Definition existiert (Aufrufer fällt dann auf
 * literalen Klammertext zurück, kein Syntaxfehler — CommonMarks eigene
 * Toleranz für unaufgelöste Referenzen).
 */
function matchReferenceTail(line, pos, labelRaw, resolveReference) {
    let refKey = labelRaw;
    let end = pos;
    if (line[pos] === '[') {
        const refLabel = matchBracketLabel(line, pos);
        if (refLabel !== null) {
            if (refLabel.raw !== '')
                refKey = refLabel.raw;
            end = refLabel.end;
        }
    }
    const definition = resolveReference(normalizeReferenceLabel(refKey));
    if (definition === undefined)
        return null;
    return { definition, end };
}
/** Spec 4.2.4: verschachtelte Links im Label sind unzulässig; in Bildlabels zusätzlich keine weiteren Bilder. */
function assertNoNestedResource(children, isImageLabel) {
    for (const child of children) {
        if (child.type === 'link')
            throw new InlineSyntaxError('Verschachtelte Links im Label sind unzulässig');
        if (isImageLabel && child.type === 'inlineImage') {
            throw new InlineSyntaxError('Verschachtelte Bilder im Bildlabel sind unzulässig');
        }
        // ast.ts-Validator-Invariante "Kein Link/Autolink/FootnoteReference in
        // Link.children" — gilt nicht fürs Bildlabel (das ohnehin zu reinem
        // Alttext abgeflacht wird, siehe flattenToPlainText).
        if (!isImageLabel && child.type === 'autolink') {
            throw new InlineSyntaxError('Autolinks im Linklabel sind unzulässig');
        }
        if (!isImageLabel && child.type === 'footnoteReference') {
            throw new InlineSyntaxError('Fußnotenreferenzen im Linklabel sind unzulässig');
        }
        if ('children' in child && Array.isArray(child.children)) {
            assertNoNestedResource(child.children, isImageLabel);
        }
    }
}
/** Spec 4.2.4: Bildlabel wird nach Inline-Regeln gelesen und dann zu reinem Text abgeflacht. */
function flattenToPlainText(children) {
    let out = '';
    for (const child of children) {
        switch (child.type) {
            case 'text':
            case 'inlineCode':
            case 'inlineMath':
            case 'autolink':
                out += child.value;
                break;
            case 'softBreak':
            case 'hardBreak':
                out += ' ';
                break;
            case 'footnoteReference':
                // Kein Bildlabel-Verbot für Fußnotenreferenzen (anders als Link/
                // Bild, siehe assertNoNestedResource) — literale Textform statt
                // stillem Wegfall beim Abflachen, sonst ginge Information verloren.
                out += `[^${child.identifier}]`;
                break;
            default:
                if ('children' in child && Array.isArray(child.children)) {
                    out += flattenToPlainText(child.children);
                }
        }
    }
    return out;
}
function resourceAttrsOrUndefined(built) {
    const { preview, group, lang, dataAttrs } = built;
    if (preview === undefined && group === undefined && lang === undefined && dataAttrs === undefined) {
        return undefined;
    }
    return {
        ...(preview !== undefined ? { preview } : {}),
        ...(group !== undefined ? { group } : {}),
        ...(lang !== undefined ? { lang } : {}),
        ...(dataAttrs !== undefined ? { dataAttrs } : {}),
    };
}
function spanAttrsOrUndefined(built) {
    const { lang, dataAttrs } = built;
    if (lang === undefined && dataAttrs === undefined)
        return undefined;
    return {
        ...(lang !== undefined ? { lang } : {}),
        ...(dataAttrs !== undefined ? { dataAttrs } : {}),
    };
}
/**
 * Orchestriert das Scannen eines `[...]`/`![...]`-Konstrukts ab `start`
 * (Position von `[` oder `!`). Liefert `null`, wenn an dieser Stelle kein
 * gültiges Konstrukt beginnt — der Aufrufer behandelt `!`/`[` dann als
 * Literalzeichen und scannt ab der nächsten Position weiter (kein Fehler:
 * ein isoliertes `[...]` ohne Ziel/Attribute ist gewöhnlicher Text).
 * Echte Syntaxfehler (kaputtes Ziel, kaputter Attributblock, verbotene
 * Verschachtelung, widersprüchlicher `type`) werden geworfen, sobald klar
 * ist, dass ein Ressourcentoken begonnen wurde.
 *
 * `parseLabelInline(text, labelStart)` wird injiziert statt direkt
 * `parseInlineLine` zu importieren, um einen zirkulären Modul-Import zwischen
 * inline.ts und resource.ts zu vermeiden (inline.ts orchestriert den Aufruf
 * hierher). `labelStart` ist die Position (Index in `line`), an der `text`
 * beginnt — der Aufrufer braucht sie als Positions-Anker für die
 * SourceRanges der Label-Kind-Knoten.
 * `resolveReference` löst Referenzlink-Labels (Spec 8.2, tolerante
 * Eingabeform) gegen die vom Aufrufer aus einem Vorab-Scan aufgebaute
 * Tabelle auf — `undefined`, wenn keine Definition existiert.
 */
export function matchBracketConstruct(line, start, parseLabelInline, resolveReference, strict = false) {
    const isImage = line[start] === '!';
    const bracketStart = isImage ? start + 1 : start;
    if (line[bracketStart] !== '[')
        return null;
    const label = matchBracketLabel(line, bracketStart);
    if (label === null)
        return null;
    const labelStart = bracketStart + 1;
    let pos = label.end;
    if (isImage) {
        const dt = matchDestinationAndTitle(line, pos);
        if (dt !== null) {
            pos = dt.end;
            const labelChildren = parseLabelInline(label.raw, labelStart);
            assertNoNestedResource(labelChildren, true);
            assertValidTypedTarget('image', dt.destination);
            return {
                kind: 'image',
                src: dt.destination,
                alt: flattenToPlainText(labelChildren),
                ...(dt.title !== undefined ? { title: dt.title } : {}),
                end: pos,
            };
        }
        // Kein `(...)` nach dem Label — Referenzbild-Formen (volle/kollabierte/
        // Shortcut-Form, Spec 8.2) statt eines typisierten Attributblocks: `{...}`
        // gibt es bei Referenzformen nicht (nur bei der direkten Klammerform).
        const ref = matchReferenceTail(line, pos, label.raw, resolveReference);
        if (ref === null)
            return null;
        const labelChildren = parseLabelInline(label.raw, labelStart);
        assertNoNestedResource(labelChildren, true);
        assertValidTypedTarget('image', ref.definition.destination);
        return {
            kind: 'image',
            src: ref.definition.destination,
            alt: flattenToPlainText(labelChildren),
            ...(ref.definition.title !== undefined ? { title: ref.definition.title } : {}),
            end: ref.end,
            viaReference: true,
        };
    }
    const after = line[pos];
    if (after === '(') {
        const dt = matchDestinationAndTitle(line, pos);
        if (dt === null)
            throw new InlineSyntaxError('Linkziel-Klammer nicht geschlossen');
        pos = dt.end;
        const labelChildren = parseLabelInline(label.raw, labelStart);
        assertNoNestedResource(labelChildren, false);
        return {
            kind: 'link',
            href: dt.destination,
            ...(dt.title !== undefined ? { title: dt.title } : {}),
            children: labelChildren,
            end: pos,
        };
    }
    const ref = matchReferenceTail(line, pos, label.raw, resolveReference);
    if (ref !== null) {
        const labelChildren = parseLabelInline(label.raw, labelStart);
        assertNoNestedResource(labelChildren, false);
        return {
            kind: 'link',
            href: ref.definition.destination,
            ...(ref.definition.title !== undefined ? { title: ref.definition.title } : {}),
            children: labelChildren,
            end: ref.end,
            viaReference: true,
        };
    }
    return null;
}
/** Liest einen v0.5-Wrapper-Öffner ohne Backtracking. */
function matchWrapperOpen(line, start) {
    if (line[start] !== '<')
        return null;
    // First-Match-Scanner: `em` muss zwingend vor seinem Präfix `e` stehen.
    const candidates = ['strong', 'au', 'em', 'm', 'f', 'v', 'e'];
    const tag = candidates.find((candidate) => line.startsWith(candidate, start + 1));
    if (tag === undefined)
        return null;
    let i = start + 1 + tag.length;
    if (line[i] !== '>' && line[i] !== ' ' && line[i] !== '\t')
        return null;
    if ((tag === 'em' || tag === 'strong') && line[i] !== '>') {
        throw new InlineSyntaxError(`<${tag}> erlaubt keine Attribute`);
    }
    if (line[i] === '>') {
        if (tag === 'm' || tag === 'f')
            throw new InlineSyntaxError(`<${tag}> benötigt mindestens ein Attribut`);
        return { tag, entries: [], contentStart: i + 1 };
    }
    let quote = false;
    let escaped = false;
    let end = -1;
    for (let j = i; j < line.length; j++) {
        const ch = line[j];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === '\\' && quote) {
            escaped = true;
            continue;
        }
        if (ch === '"') {
            quote = !quote;
            continue;
        }
        if (ch === '>' && !quote) {
            end = j;
            break;
        }
    }
    if (end === -1)
        throw new InlineSyntaxError(`<${tag} …> nicht geschlossen`);
    const parsed = matchAttrsBlock(`{${line.slice(i, end)}}`, 0);
    if (parsed === null)
        throw new InlineSyntaxError(`Ungültige Attribute an <${tag}>`);
    if ((tag === 'm' || tag === 'f') && parsed.entries.length === 0)
        throw new InlineSyntaxError(`<${tag}> benötigt mindestens ein Attribut`);
    return { tag, entries: parsed.entries, contentStart: end + 1 };
}
/**
 * Findet den zum Öffner gehörenden gleichnamigen Schließer in einem
 * links-nach-rechts laufenden, tiefenzählenden Scan. Die Namensgrenze folgt
 * derselben Regel wie matchWrapperOpen; dadurch zählt z.B. `<embed>` nicht
 * als verschachteltes `<em>` bzw. `<e>`.
 */
function findMatchingWrapperCloser(line, contentStart, tag) {
    const opener = `<${tag}`;
    const closer = `</${tag}>`;
    let depth = 1;
    let i = contentStart;
    while (i < line.length) {
        if (line.startsWith(closer, i)) {
            depth--;
            if (depth === 0)
                return i;
            i += closer.length;
            continue;
        }
        if (line.startsWith(opener, i)) {
            const boundary = line[i + opener.length];
            if (boundary === '>' || boundary === ' ' || boundary === '\t') {
                depth++;
                i += opener.length;
                continue;
            }
        }
        i++;
    }
    return -1;
}
/**
 * v0.5-Wrapper auf einer logischen Inline-Sequenz. Der passende vollständige
 * Closer ist Teil desselben atomaren Tokens; ein `</>` wird nie akzeptiert.
 */
export function matchWrapperConstruct(line, start, parseContentInline, resolveReference, strict = false) {
    const open = matchWrapperOpen(line, start);
    if (open === null)
        return null;
    const closer = `</${open.tag}>`;
    const closeAt = findMatchingWrapperCloser(line, open.contentStart, open.tag);
    if (closeAt === -1)
        throw new InlineSyntaxError(`Wrapper <${open.tag}> nicht geschlossen`);
    const content = line.slice(open.contentStart, closeAt);
    const end = closeAt + closer.length;
    if (open.tag === 'em' || open.tag === 'strong') {
        if (content === '')
            throw new InlineSyntaxError(`Leerer <${open.tag}>-Inhalt`);
        const children = parseContentInline(content, open.contentStart);
        if (children.length === 0)
            throw new InlineSyntaxError(`Leerer <${open.tag}>-Inhalt`);
        return { kind: open.tag, children, end };
    }
    if (open.tag === 'm') {
        if (content === '')
            throw new InlineSyntaxError('Leerer Span-Inhalt');
        const attrs = spanAttrsOrUndefined(buildSpanAttrs(open.entries));
        if (attrs === undefined)
            throw new InlineSyntaxError('Span benötigt mindestens ein Attribut');
        const children = parseContentInline(content, open.contentStart);
        if (children.length === 0)
            throw new InlineSyntaxError('Leerer Span-Inhalt');
        if (attrs.dataAttrs?.type === 'download') {
            const link = matchBracketConstruct(content, 0, (text, labelStart) => parseContentInline(text, open.contentStart + labelStart), resolveReference, strict);
            if (link === null || link.kind !== 'link' || link.end !== content.length) {
                throw new InlineSyntaxError('<m data-type=download> muss genau einen Markdown-Link enthalten');
            }
            if (!isValidMediaTarget(link.href))
                throw new InlineSyntaxError(`Unzulässiges Ziel-Schema für Download: ${link.href}`);
            if (!hasVisibleInlineContentForResource(link.children))
                throw new InlineSyntaxError('Download-Linktext darf nicht leer sein');
            return {
                kind: 'download', src: link.href, alt: flattenToPlainText(link.children), children: link.children,
                ...(link.title !== undefined ? { title: link.title } : {}), attrs, end,
                ...(link.viaReference === true ? { viaReference: true } : {}),
            };
        }
        return { kind: 'span', attrs, children, end };
    }
    const resource = matchBracketConstruct(content, 0, (text, labelStart) => parseContentInline(text, open.contentStart + labelStart), resolveReference, strict);
    const built = resourceAttrsOrUndefined(buildResourceAttrs(open.entries));
    if (open.tag === 'f') {
        if (resource === null || resource.kind !== 'image' || resource.end !== content.length) {
            throw new InlineSyntaxError('<f> muss genau ein Markdown-Bild enthalten');
        }
        if (built?.preview !== undefined || built?.lang !== undefined) {
            throw new InlineSyntaxError('preview/lang sind bei Bildern nicht zulässig');
        }
        assertValidTypedTarget('image', resource.src);
        return {
            kind: 'image', src: resource.src, alt: resource.alt,
            ...(resource.title !== undefined ? { title: resource.title } : {}),
            ...(built !== undefined ? { attrs: built } : {}), end,
            ...(resource.viaReference === true ? { viaReference: true } : {}),
        };
    }
    if (resource === null || resource.kind !== 'link' || resource.end !== content.length) {
        throw new InlineSyntaxError(`<${open.tag}> muss genau einen Markdown-Link enthalten`);
    }
    const kind = open.tag === 'v' ? 'video' : open.tag === 'au' ? 'audio' : 'embed';
    const alt = flattenToPlainText(resource.children);
    if (alt.trim() === '')
        throw new InlineSyntaxError(`Alt-Text ist bei ${kind} erforderlich`);
    assertValidTypedTarget(kind, resource.href);
    return {
        kind, src: resource.href, alt,
        ...(resource.title !== undefined ? { title: resource.title } : {}),
        ...(built !== undefined ? { attrs: built } : {}), end,
        ...(resource.viaReference === true ? { viaReference: true } : {}),
    };
}
function hasVisibleInlineContentForResource(children) {
    return children.some((child) => child.type !== 'text' || child.value.trim() !== '');
}
