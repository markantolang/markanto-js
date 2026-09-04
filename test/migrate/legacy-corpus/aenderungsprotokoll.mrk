# Änderungsprotokoll {#aenderungen}

Dieses Protokoll hält die wichtigsten Änderungen an Markanto fest. Das
Format orientiert sich an [Keep a Changelog](https://keepachangelog.com),
die Versionsnummern folgen [Semantic Versioning](https://semver.org).

## 0.2.0 — 2026-08-18 {#v0-2-0}

Diese Fassung schließt die Spezifikation v0.2.0 ab und erweitert den
Referenzparser um Fußnoten, HTML-Entities und die `raw-html`-Vorbereitung.

### Hinzugefügt {#v0-2-0-hinzugefuegt}

- Fußnoten mit kanonischer Reihenfolge am Dokumentende
- HTML-Entity-Dekodierung gegen die vollständige HTML5-Tabelle
- Referenzlinks als tolerante Eingabeform (`[text][label]`)

### Behoben {#v0-2-0-behoben}

- Ziele mit geschütztem Leerzeichen brachen den Link-Parse fälschlich ab
- Der Formatter escapet Blockanfänge nach Entity-Dekodierung jetzt korrekt

## 0.1.0 — 2026-06-01 {#v0-1-0}

Erster interner Stand mit Kernparser und ersten Tabellen.

### Bekannte Einschränkungen {#v0-1-0-einschraenkungen}

- [ ] Fußnoten noch nicht implementiert
- [ ] Kein Strict Mode
- [x] Basis-Tabellen (GFM) umgesetzt

## Planung {#planung}

Die nächsten Schritte sind im [Manifest](../docs/markanto-manifest-v0.2.0.md "Markanto Manifest") beschrieben. Ausstehend sind insbesondere:

- die `raw-html`-Extension,
- der Validator für Ganzdokument-Prüfungen,
- die Fixture- und Korpus-Pflege.
