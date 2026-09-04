# Glossar {#glossar}

Kurze Erläuterungen zu den wichtigsten Begriffen. Begriffserklärungen in
Klammern erscheinen beim Überfahren als Tooltip: etwa
<m data-title="Eindeutigkeit der Darstellung einer Bedeutung">Kanonizität</m>.

## Kanonizität {#kanonizitaet}

Die Eigenschaft eines Formats, genau eine gültige Darstellung pro
Bedeutung zu besitzen. Eng verwandt mit dem Begriff [idempotenz](/idempotenz).

::: hinweis
Kanonizität ist eine stärkere Forderung als bloße
<m data-title="Ein wiederholter Vorgang verändert das Ergebnis nicht mehr">Idempotenz</m>:
Ein Formatter kann idempotent sein, ohne kanonisch zu sein.
:::

## Idempotenz {#idempotenz}

Die Eigenschaft einer Abbildung $`f`$, dass $`f(f(x)) = f(x)`$ gilt.
Im Zusammenhang mit Formatierern beschreibt sie, dass ein erneuter
Durchlauf das Ergebnis nicht verändert. Siehe auch [kanonizitaet](/kanonizitaet).

## Roundtrip {#roundtrip}

Ein Durchlauf vom Quelltext zum
<m data-title="Abstract Syntax Tree — abstrakter Syntaxbaum">AST</m> und zurück.
Die Bedingung `parse(format(ast)) ≡ ast` heißt Roundtrip-Gesetz und ist
eine der zentralen Garantien des Formats. Vgl. [idempotenz](/idempotenz).

## Normalform {#normalform}

Die kanonische Darstellung eines Dokuments. Alle tolerierten
Schreibweisen desselben Inhalts konvergieren auf dieselbe Normalform —
siehe [kanonizitaet](/kanonizitaet).

## Strict Mode {#strict-mode}

Ein Parsermodus, der ausschließlich die kanonische Form akzeptiert. Der
Begriff ist ein Spezialfall des allgemeineren [normalform](/normalform)-Konzepts.
