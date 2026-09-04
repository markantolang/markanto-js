/**
 * Markanto — SourceRange-Hilfsfunktionen (Spec: docs/markanto-ast-v0.2.0.ts,
 * `SourcePoint`/`SourceRange`). Reine, isoliert testbare Bausteine für das
 * Position-Tracking in parser.ts (Block-Ebene, Phase 1 — Inline-Knoten folgen
 * in einer eigenen Übergabe).
 *
 * Wichtig: `parser.ts` selbst splittet Zeilen mit
 * `source.split(/\r\n|\r|\n/)` — das verwirft die Information, ob eine Zeile
 * mit `\r\n` (2 Zeichen) oder `\n`/`\r` (1 Zeichen) endete. Für exakte
 * Offsets reicht das nicht, daher scannt `computeLineStarts` selbst über den
 * ORIGINAL-Quellstring (RegExp mit `g`-Flag, `match.index + match[0].length`
 * als Start der nächsten Zeile), statt aus dem bereits gesplitteten
 * Zeilenarray zurückzurechnen.
 *
 * Ranges sind halb offen: `[start, end)`. Für Blöcke schließt `end` das
 * ID-Suffix, den Öffner und den Schließer ein (Spec) — der Endpunkt ist die
 * Zeile UNMITTELBAR nach dem letzten vom Block konsumierten Inhalt.
 * `rangeToLineOrEnd` behandelt zentral den Dateiende-Sonderfall: existiert
 * die "nächste Zeile" nicht (letzte Zeile ohne abschließenden
 * Zeilenumbruch), ist `end` das Ende des Quelltexts statt des Anfangs einer
 * nicht existierenden Zeile.
 */
/** Absoluter Zeichen-Offset (UTF-16 Code Units) des Zeilenanfangs jeder Zeile in `source`. */
export function computeLineStarts(source) {
    const starts = [0];
    const re = /\r\n|\r|\n/g;
    let m;
    while ((m = re.exec(source)) !== null) {
        starts.push(m.index + m[0].length);
    }
    return starts;
}
/** Wandelt (0-basierter Zeilenindex, 0-basierte Spalte) in einen SourcePoint. */
export function pointAt(lineStarts, lineIndex0, column0) {
    return { offset: lineStarts[lineIndex0] + column0, line: lineIndex0 + 1, column: column0 + 1 };
}
/** Baupunkt für die meisten Aufrufstellen: von (Zeile, Spalte) bis (Zeile, Spalte), exklusiv. */
export function rangeFromLines(lineStarts, startLine0, startCol0, endLine0, endCol0) {
    return {
        start: pointAt(lineStarts, startLine0, startCol0),
        end: pointAt(lineStarts, endLine0, endCol0),
    };
}
/**
 * Wie `rangeFromLines`, behandelt aber zentral den Dateiende-Sonderfall:
 * zeigt `endLine0` über die letzte Zeile hinaus (kein abschließender
 * Zeilenumbruch), ist `end` das Ende des Quelltexts — ein Punkt auf der
 * letzten Zeile nach deren letztem Zeichen — statt eines Punktes auf einer
 * nicht existierenden Zeile. EINE zentrale Stelle statt 16 Wiederholungen.
 */
export function rangeToLineOrEnd(lineStarts, source, startLine0, startCol0, endLine0, endCol0) {
    if (endLine0 < lineStarts.length) {
        return rangeFromLines(lineStarts, startLine0, startCol0, endLine0, endCol0);
    }
    const lastLineStart = lineStarts[lineStarts.length - 1];
    return {
        start: pointAt(lineStarts, startLine0, startCol0),
        end: {
            offset: source.length,
            line: lineStarts.length,
            column: source.length - lastLineStart + 1,
        },
    };
}
