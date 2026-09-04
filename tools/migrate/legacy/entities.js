/**
 * Markanto — geteilte HTML-Entity-Erkennung (Spec 10.8.1).
 *
 * Einzige Implementierung der Frage "beginnt an dieser Position eine gültige,
 * semikolonterminierte HTML5-Entity?" — von inline.ts (Parser: Dekodierung zu
 * Text) UND format.ts (Formatter: entscheidet, ob ein literales `&` escaped
 * werden muss) gemeinsam genutzt. Bewusst KEINE zweite, verkürzte Regex im
 * Formatter: Parser und Formatter müssen exakt dieselbe Erkennung verwenden,
 * sonst escapet der Formatter `&` in Sequenzen, die der Parser gar nicht
 * dekodieren würde (unnötiges Escaping, Spec 10.13) — oder umgekehrt verpasst
 * er einen echten Dekodierungsfall und verletzt Kanonizitätsgesetz 1.
 *
 * Abfrage-Entscheidungen (eine Funktion, eine Position):
 *   - beginnt hier eine gültige semikolonterminierte HTML5-Named-Entity?
 *   - beginnt hier eine gültige dezimale numerische Entity (`&#…;`)?
 *   - beginnt hier eine gültige hexadezimale Entity (`&#x…;`)?
 *   - ist der Codepoint gültig (nicht 0, keine Surrogat-Hälfte, <= U+10FFFF)?
 *
 * Hex wird vor dezimal geprüft, da `&#x41;` sonst am "x" scheitern und
 * fälschlich als (nicht passende) dezimale Form gälte.
 *
 * Ein numerischer Codepoint außerhalb des gültigen Unicode-Bereichs oder auf
 * einer Surrogat-Hälfte gilt als ungültig — die HTML5-Legacy-Ersetzungstabelle
 * für historische Falscheingaben (z.B. Windows-1252-Remapping für 0x80–0x9F)
 * wird bewusst NICHT nachgebildet: Markanto ist ein neues Format ohne
 * Altlast-HTML, kanonische Eingaben brauchen sie nie (dokumentierte
 * Vereinfachung, übernommen aus dem ursprünglichen inline.ts-Kommentar).
 */
import { HTML_ENTITIES } from './generated/html-entities.js';
const HEX_ENTITY_RE = /^&#[xX]([0-9A-Fa-f]+);/;
const DECIMAL_ENTITY_RE = /^&#([0-9]+);/;
const NAMED_ENTITY_RE = /^&([A-Za-z][A-Za-z0-9]*);/;
const MAX_CODEPOINT = 0x10ffff;
/**
 * Kanonische dezimale Entity-Normalform für einen Codepoint (Spec 10.8.1,
 * H1-Disambiguierung): `&#NN;` ohne führende Nullen. Gemeinsamer Baustein
 * von Formatter (schreibt ausschließlich diese Form) und Strict-Parser
 * (akzeptiert ausschließlich diese Form in Flanking-Position), damit beide
 * nie auseinanderlaufen können. Bewusst in diesem neutralen Modul statt in
 * format.ts — inline.ts und format.ts dürfen einander nicht zyklisch
 * importieren.
 */
export function canonicalDecimalEntity(cp) {
    return `&#${cp};`;
}
function isValidCodepoint(cp) {
    return cp > 0 && cp <= MAX_CODEPOINT && !(cp >= 0xd800 && cp <= 0xdfff);
}
/**
 * Entscheidet an Position `i` von `line` (muss auf `&` zeigen), ob hier eine
 * gültige, semikolonterminierte HTML5-Entity beginnt. Liefert die wörtliche
 * Quellform und den dekodierten Wert, sonst `null` — unbekannte Namen,
 * ungültige Codepoints und nicht abgeschlossene Folgen sind kein Match (sie
 * bleiben beim Parsen unverändert Text, Spec 10.8.1).
 */
export function matchEntity(line, i) {
    const rest = line.slice(i);
    const hex = HEX_ENTITY_RE.exec(rest);
    if (hex) {
        const cp = Number.parseInt(hex[1], 16);
        if (isValidCodepoint(cp))
            return { raw: hex[0], value: String.fromCodePoint(cp) };
        return null;
    }
    const dec = DECIMAL_ENTITY_RE.exec(rest);
    if (dec) {
        const cp = Number.parseInt(dec[1], 10);
        if (isValidCodepoint(cp))
            return { raw: dec[0], value: String.fromCodePoint(cp) };
        return null;
    }
    const named = NAMED_ENTITY_RE.exec(rest);
    if (named) {
        const value = HTML_ENTITIES[named[1]];
        if (value !== undefined)
            return { raw: named[0], value };
        return null;
    }
    return null;
}
