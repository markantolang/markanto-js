/**
 * Automatischer Überschriften-Slug (Spec 6.3) — reine, zustandslose
 * Berechnung, getrennt sowohl vom Parser als auch vom Validator gehalten.
 *
 * Grund für ein eigenes Modul statt der Logik in parser.ts (wo sie
 * zunächst lag): parser.ts weist die berechneten Slugs zu, validator.ts
 * muss sie unabhängig gegenprüfen können (Codex-Review, 2026-08-25 — ein
 * validatorgültiger AST mit falschem oder fehlendem `slug` verletzte
 * bislang Gesetz 1 unbemerkt). Zwei unabhängig gepflegte Kopien derselben
 * Traversierung hätten genau das Risiko wieder eingeführt, das der
 * Scope-Spiegelungs-Kommentar hier vorher nur dokumentierte — jetzt gibt
 * es nur noch eine Implementierung, von beiden Seiten importiert.
 */
import { inlinePlainText } from './inline.js';
const SLUG_STRIP_RE = /[^\p{L}0-9]+/gu;
const SLUG_TRIM_RE = /^-+|-+$/g;
/** Spec 6.3: deterministischer Slug-Algorithmus, auf dem markupbereinigten Überschriftentext. */
export function slugifyHeadingText(text) {
    const base = text.toLowerCase().replace(SLUG_STRIP_RE, '-').replace(SLUG_TRIM_RE, '');
    return base === '' ? 'section' : base;
}
/**
 * Berechnet den je Heading erwarteten Slug (Spec 6.3) — Scope identisch mit
 * Heading-ID-Fähigkeit (Spec 6.2: Dokumentebene, unmittelbares
 * Fenced-Container-Kind, Fenced-Container-Kind eines Directive Containers).
 * Liefert eine Map nur der ID-fähigen (= slug-fähigen) Headings auf ihren
 * korrekten, dokumentweit eindeutigen Slug — nicht-fähige Headings tauchen
 * nicht in der Map auf. Reine Funktion, keine Mutation.
 */
export function computeHeadingSlugs(blocks) {
    const result = new Map();
    const used = new Set();
    function claim(base) {
        if (!used.has(base)) {
            used.add(base);
            return base;
        }
        let n = 2;
        while (used.has(`${base}-${n}`))
            n++;
        const candidate = `${base}-${n}`;
        used.add(candidate);
        return candidate;
    }
    function visit(b, eligible) {
        switch (b.type) {
            case 'heading':
                if (eligible)
                    result.set(b, claim(slugifyHeadingText(inlinePlainText(b.children))));
                return;
            case 'quoteRegion':
                // Immer nicht-fähig, unabhängig vom Aufrufer-Scope (spiegelt
                // AGGREGATE_LOCKED('quoteRegion') in validator.ts).
                for (const qb of b.children)
                    visit(qb.block, false);
                return;
            case 'fencedContainer':
                // Immer fähig, unabhängig vom Aufrufer-Scope — walkFencedContainer
                // reicht in validator.ts ebenfalls nie den Aufrufer-Ctx durch.
                for (const c of b.children)
                    visit(c, true);
                return;
            case 'directiveContainer':
                // Nur das unmittelbare Fenced-Container-Kind bleibt fähig.
                for (const c of b.children)
                    visit(c, c.type === 'fencedContainer');
                return;
            case 'list':
                // Headings können hier laut Spec 9.8 ohnehin nicht als Heading
                // parsen (BLOCK_START_HEADING_HR_RE-Unterdrückung in classify());
                // ein verschachtelter Fenced Container überschreibt sich in seinem
                // eigenen case trotzdem wieder auf fähig.
                for (const item of b.items)
                    for (const c of item.children)
                        visit(c, false);
                return;
            default:
                return;
        }
    }
    for (const b of blocks)
        visit(b, true);
    return result;
}
