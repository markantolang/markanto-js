# fixtures/

Handkuratierte, realistische Markanto-/Markdown-Dokumente — Breite
alltäglicher Verwendung, nicht Tiefe von Grenzfällen (das ist `corpus/`s
Aufgabe). Gedacht für Dokumente, die typische Konstrukte kombiniert zeigen:
Grid, Fußnoten, Math, typisierte Ressourcen, Legacy-Import-Kandidaten.

## Beispieldokumente

| Datei | Kombinierte Konstrukte |
|-------|------------------------|
| [`reisebericht-mit-galerie.mrk`](reisebericht-mit-galerie.mrk) | Heading mit Block-ID, einleitender Absatz mit Emphasis und Link (mit Titel), ein `:::urlaub-2025`-Container als Bildergalerie (mehrere Blockbilder mit Captions, Container-Block-ID), Video-Block mit Caption und `preview`, Fußnote, Zitat, geordnete Liste |
| [`technische-doku.mrk`](technische-doku.mrk) | Mehrere Headings mit Block-IDs (Deep-Linking), GFM-Tabelle mit Ausrichtung, Code-Fence mit Sprache, Inline-Code, Link mit Titel, Zitat mit verschachtelter Liste |
| [`wissenschaftlicher-artikel.mrk`](wissenschaftlicher-artikel.mrk) | Inline-Math, Math-Block, mehrere Fußnoten als Quellenangaben (Referenzreihenfolge im Text weicht von der Definitionsreihenfolge ab — die Nummerierung folgt der ersten Referenz), Ergebnistabelle |
| [`rezept-mit-medien.mrk`](rezept-mit-medien.mrk) | Geordnete Liste als Zubereitungsschritte, Taskmarker-Einkaufsliste, Audio-Block und Video-Block (jeweils mit Caption), Blockbild mit sinnvollem vs. dekorativem (leerem) Alt-Text, Span mit `lang`-Attribut |
| [`referenzlinks-und-fussnoten.mrk`](referenzlinks-und-fussnoten.mrk) | Referenzlinks in voller `[Text][label]`, kollabierter `[Text][]` und Shortcut-`[Text]`-Form gegen eine gemeinsame Definitionsliste, `[/id]`-Kurzlink, mehrere Fußnoten |
| [`legacy-import-commonmark-stil.mrk`](legacy-import-commonmark-stil.mrk) | Legacy-Import-Kandidat: ausschließlich CommonMark/GFM-kompatible Konstrukte (Headings, Absätze, Listen, Zitate, Tabelle, Code-Fence, Links, Bild) — kein Grid, keine typisierten Medien, keine Fußnoten, keine Block-IDs |
| [`handbuch-mehrseitig-teil-1.mrk`](handbuch-mehrseitig-teil-1.mrk) | Teil 1 eines zweiteiligen Handbuchs: Inhaltsverzeichnis-Liste aus `[/id]`-Kurzlinks, mehrstufige Headings mit Block-IDs, `:::grid` als Feature-Überblick, Code-Fences, Fußnoten, gegenseitige Querverweise auf Teil 2 |
| [`handbuch-mehrseitig-teil-2.mrk`](handbuch-mehrseitig-teil-2.mrk) | Teil 2 des Handbuchs: GFM-Tabelle mit Ausrichtung, Zitat mit verschachtelter Liste, Fußnote, `[/id]`-Kurzlinks zurück auf Teil 1 |
| [`konferenz-programm.mrk`](konferenz-programm.mrk) | `:::grid` als mehrspaltiger Zeitplan (mehrere Zeilen/Spalten über `:--`/`:==`), Video-Block mit Caption und `preview`, Tabelle als Referentenübersicht, Spans mit `lang`-Attribut für fremdsprachige Vortragstitel |
| [`forschungsbericht-lang.mrk`](forschungsbericht-lang.mrk) | Längerer Fachtext: mehrere Fußnoten (auch mehrfach referenziert, Definitionsreihenfolge weicht von erster Referenz ab), mehrere Math-Blöcke und Inline-Math gemischt, Ergebnistabelle mit allen drei Ausrichtungen, Zitat mit verschachtelter Liste |
| [`produktkatalog-mit-galerien.mrk`](produktkatalog-mit-galerien.mrk) | Mehrere Produkte mit je eigener Bildergalerie (`:::leuchte-*`-Container), Preistabelle, Audio-Block als Barrierefreiheits-Beschreibung, Referenzlinks auf eine gemeinsame Händlerliste am Dokumentende |
| [`import-aus-bestehendem-blog.mrk`](import-aus-bestehendem-blog.mrk) | Zweiter Legacy-Import-Kandidat mit typischen Import-Grenzfällen: Tabelle ohne äußere Pipes, verschachtelte Listen mit Aufgaben-Markern, Zitat — ohne Markanto-exklusive Konstrukte |
| [`glossar-mit-querverweisen.mrk`](glossar-mit-querverweisen.mrk) | Glossar: Heading mit Block-ID pro Begriff, Spans mit `title`-Attribut als Tooltip, `[/id]`-Kurzlinks zwischen verwandten Begriffen, ein benannter Fenced Container (`:::hinweis`) als Hervorhebungsbox, Inline-Math |
| [`aenderungsprotokoll.mrk`](aenderungsprotokoll.mrk) | Changelog: Versions-Headings mit Block-IDs, datierte Einträge, Listen, Aufgaben-Marker, Inline-Code, Emphasis, Links mit Titel |
