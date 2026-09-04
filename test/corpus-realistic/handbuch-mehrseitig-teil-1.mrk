# Installationshandbuch {#installation}

Dieses Handbuch führt Sie durch die Installation und Ersteinrichtung von
Markanto. Es ist der erste Teil einer zweiteiligen Reihe; der zweite Teil
behandelt Konfiguration und Fehlerbehebung und ist unter
[konfiguration](/konfiguration) zu finden.

## Inhalt {#inhalt}

- [voraussetzungen](/voraussetzungen)
- [schritt-1](/schritt-1)
- [schritt-2](/schritt-2)
- [funktionen](/funktionen)

## Voraussetzungen {#voraussetzungen}

Bevor Sie beginnen, prüfen Sie die folgenden Punkte:

- Eine aktuelle Laufzeitumgebung ([Bun](https://bun.sh) ab Version 1.0)
- Ein Terminal mit UTF-8-Unterstützung
- Schreibrechte im Zielverzeichnis

Markanto selbst bringt keine Laufzeit-Abhängigkeiten mit; der Parser ist
bewusst *dependency-frei* gehalten.[^runtime]

## Installation {#schritt-1}

Der Einstieg ist ein Einzeiler:

```sh
bun add markanto
```

Anschließend steht die Bibliothek unter `markanto` zur Verfügung. Der
Aufruf läuft über die drei Kernfunktionen `parse`, `format` und
`check`.[^kernfunktionen]

## Erster Test {#schritt-2}

Ein minimaler Rundlauf sieht so aus:

```ts
import { parse, format } from "markanto";

const ast = parse("# Titel");
const out = format(ast);
```

Die Ausgabe ist kanonisch: genau eine gültige Darstellung pro Bedeutung.
Details dazu stehen im [Manifest](../docs/markanto-manifest-v0.2.0.md "Markanto Manifest").

## Funktionsumfang im Überblick {#funktionen}

::: grid
Parser
--
Liest vertrautes Markdown tolerant und modelliert es streng in einem
eindeutigen AST.
==
Formatter
--
Serialisiert den AST kanonisch — genau eine gültige Darstellung pro
Bedeutung.
==
Validator
--
Prüft den AST auf semantische Gültigkeit und (optional) Kanonizität.
:::

## Nächste Schritte

Die weiteren Einstellungen — Zeilenumbruch-Modus, Tiefenlimits, Strict
Mode — beschreibt der zweite Teil unter [optionen](/optionen).

[^runtime]: Der Parser hängt ausschließlich von der Sprache ab, nicht von externen Paketen.
[^kernfunktionen]: `parse` liest, `format` normalisiert, `check` diagnostiziert.
