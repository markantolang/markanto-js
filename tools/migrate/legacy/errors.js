/**
 * Geworfen bei strict:true + errorRecovery:false (Spec 7.6: "Parse-Abbruch
 * statt ErrorBlock"). Mit errorRecovery:true (Default) wird stattdessen ein
 * ErrorBlock erzeugt und der Parser fährt fort — siehe ast.ts, ErrorBlock.
 */
export class MarkantoSyntaxError extends Error {
    reason;
    line;
    constructor(reason, line) {
        super(`${reason} (Zeile ${line})`);
        this.name = 'MarkantoSyntaxError';
        this.reason = reason;
        this.line = line;
    }
}
/** Geworfen von parseInlineLine()/resource.ts bei ungültiger Inline-Syntax innerhalb einer Zeile. */
export class InlineSyntaxError extends Error {
    constructor(reason) {
        super(reason);
        this.name = 'InlineSyntaxError';
    }
}
