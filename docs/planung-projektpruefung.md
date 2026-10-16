# Plan für den aktuellen Projektstand

Stand: 16. Oktober 2026. Die fachlichen Einzelentscheidungen und der vollständige Plan wurden als gemeinsames Verständnis bestätigt. Die sechs Arbeitspakete sind umgesetzt und geprüft. Dieses Dokument enthält die vereinbarten Anforderungen und ihren Umsetzungsnachweis.

## Zweck und Umfang

Der Plan konkretisiert die Prüfung des aktuellen Projektstands von Overtone. Er umfasst wiederholbare Wiederherstellung, zeitliche Kindersicherung, bestätigte Gerätezustände und die Grenzen des vorgesehenen Betriebs.

Fachliche Begriffe stehen im [Glossar](../GLOSSARY.md). Die grundlegenden Entscheidungen sind in [ADR 0001](adr/0001-betrieb-im-privaten-netz.md) und [ADR 0002](adr/0002-ergaenzende-wiederherstellung.md) festgehalten.

## Vereinbartes Verhalten

### Wiederherstellung

1. Vorhandene Einträge bleiben erhalten. Ursprüngliche Einträge werden auch über mehrere neue Sicherungen hinweg wiedererkannt.
2. Lokale Änderungen und bewusste Löschungen nach einem Import bleiben bei weiteren Importen erhalten. Übersprungene Einträge erscheinen im Ergebnis.
3. Änderungen außerhalb von Overtone werden vor einer Übernahme geklärt. Ein fehlender Geräteeintrag wird nicht automatisch als bewusste Löschung oder als Auftrag zur Neuanlage eingeordnet.
4. Alte Sicherungen ohne Herkunftskennung bleiben über eine Vorschau nutzbar. Unklare Zuordnungen benötigen eine ausdrückliche Entscheidung.
5. Klang, Wiedergabeart und Zeitplanschalter werden nur nach ausdrücklicher Auswahl übernommen.
6. Neue Weckzeiten und Sperrzeiten bleiben standardmäßig deaktiviert. Die Übernahme ihrer gespeicherten Aktivierung erfordert eine ausdrückliche Auswahl.
7. Bestätigte Teilerfolge bleiben erhalten. Unabhängige Einträge werden auch nach einem einzelnen Fehler weiterverarbeitet.
8. Übernommene, übersprungene, fehlgeschlagene und ungeklärte Einträge werden getrennt ausgewiesen. Ungeklärte Geräteanlagen werden vor einer Wiederholung geprüft.

### Zeitliche Kindersicherung

1. Alle gleichzeitig wirksamen Sperrzeiten führen ihre Schutzoptionen zusammen. Wiedergabestopp bleibt die gemeinsame Grundmaßnahme.
2. Eine neue Schnellsperre wirkt unabhängig vom regulären Zeitplan und beendet eine laufende Freigabe. Der Zustand des Zeitplanschalters bleibt dabei erhalten.
3. Änderungen am regulären Zeitplan einschließlich seines Schalters beenden eine laufende Freigabe nicht vorzeitig. Das reguläre Ende und das ausdrückliche Beenden einer Freigabe bleiben möglich.
4. Der bisherige globale Schalter wird in der Oberfläche als Schalter für den regulären Zeitplan bezeichnet. Nach Ablauf einer Schnellsperre entscheidet wieder der unveränderte reguläre Zeitplan, sofern keine weitere Schnellsperre gilt.
5. Reguläre Sperrzeiten mit gleicher Anfangszeit und Endzeit werden abgelehnt. Vorhandene solche Einträge werden zur Korrektur kenntlich gemacht und nicht stillschweigend in ganztägige Sperren umgedeutet.
6. Die Anzeige benennt die beteiligten Sperrzeiten. Das Ende eines einzelnen Fensters darf nicht als vollständige Freigabe dargestellt werden, wenn weitere Fenster wirksam bleiben.

### Gerätestatus und Betrieb

1. Vorgesehener Schutz und bestätigter Gerätezustand sind getrennte Angaben.
2. Wiedergabestopp, Lautstärke und Stummschaltung werden entsprechend den angeforderten Schutzoptionen am Gerät geprüft. Ein erfolgreicher Schreibbefehl allein bestätigt diese Zustände nicht.
3. Bei der Tastensperre wird vorerst nur die Annahme des Befehls ausgewiesen. Daraus wird keine gelesene Zustandsbestätigung abgeleitet.
4. Geräteausfälle und widersprechende Messwerte machen eine frühere Bestätigung ungültig. Zeitpunkt und Aktualität der letzten Prüfung müssen erkennbar bleiben.
5. Overtone bleibt für ein vertrauenswürdiges Heimnetz und ein privates VPN bestimmt. Die zeitliche Kindersicherung setzt einen laufenden Dienst voraus.

## Umsetzung in sechs Arbeitspaketen

### 1. Herkunft und lokale Entscheidungen dauerhaft speichern

Neue Sicherungen erhalten eine Formatversion und stabile Herkunftskennungen für Sender, Szenen, Weckzeiten und reguläre Sperrzeiten. Vorhandene Einträge erhalten ihre Herkunft einmalig. Diese bleibt bei Änderungen, Exporten und weiteren Wiederherstellungen erhalten; gleiche numerische Kennungen aus verschiedenen Installationen gelten nicht als Identitätsnachweis.

Eine dauerhafte Zuordnung verbindet die Herkunft mit dem jeweiligen lokalen Eintrag. Bewusste Löschungen über Overtone bleiben als Löschvermerk erhalten. Automatisch abgelaufene Schnellsperren und außerhalb von Overtone fehlende Einträge werden davon unterschieden. Mehrdeutige Zuordnungen werden nicht allein aus gleichen Namen oder Inhalten abgeleitet.

Betroffene Dateien: `src/lib/server/store.ts`, `src/lib/server/overtone.ts`, `src/lib/server/scenes.ts`, `src/lib/server/alarms.ts`, `src/lib/server/sperre.ts` und `src/routes/api/sicherung/+server.ts`.

Abnahme: Herkunft bleibt nach Neustart und mehrfachem Export stabil. Einträge mit gleicher Nummer aus verschiedenen Installationen werden nicht verwechselt. Lokale Änderungen und Löschvermerke bleiben erhalten.

### 2. Wiederherstellung mit dauerhaften Zwischenständen ausführen

Jede geplante Übernahme erhält vor ihrer Ausführung einen gespeicherten Zwischenstand. Der Ablauf unterscheidet bestätigte Übernahmen, Überspringen, eindeutige Fehler und ungeklärte Ergebnisse. Ein Neustart oder erneuter Import setzt anhand dieses Zustands fort.

Für Weckzeiten wird vor dem Geräteaufruf die beabsichtigte Anlage samt vorher bekanntem Gerätebestand festgehalten. Geht die Antwort nach einer möglichen Anlage verloren, wird der Vorgang als ungeklärt geführt. Ein erneuter Versuch sendet keinen weiteren Anlagebefehl, bevor der Gerätebestand geprüft und eine verlässliche Zuordnung oder ausdrückliche Klärung erfolgt ist.

Bestätigte Teilerfolge werden nicht zurückgenommen. Unabhängige Einträge können weiterlaufen. Senderdatei, Datenbank und Lautsprecher werden als getrennte Speicher behandelt; das Protokoll muss auch einen Abbruch zwischen deren Änderungen abbilden.

Betroffene Dateien: `src/lib/server/wiederherstellung.ts`, `src/lib/server/alarms.ts`, `src/lib/server/store.ts` und die Senderpersistenz in `src/lib/server/overtone.ts`.

Abnahme: Wiederholungen nach Teilfehlern und Neustarts erzeugen keine zusätzlichen Einträge. Ein simulierter erfolgreicher Geräteaufruf mit verlorener Antwort wird sichtbar als ungeklärt behandelt und nicht blind wiederholt.

### 3. Vorprüfung, Auswahl und Ergebnisdarstellung ergänzen

Vorprüfung und Anwendung werden getrennte Vorgänge. Die Vorprüfung verändert keine Nutzdaten. Sie zeigt neue, bereits vorhandene, lokal geänderte, bewusst gelöschte, extern abweichende und unklare Einträge. Einstellungen und die Aktivierung neuer Zeitpläne sind standardmäßig abgewählt.

Alte Sicherungen werden anhand ihres geprüften Inhalts und einer normalisierten Dateisignatur wiedererkannt. Frühere ausdrückliche Zuordnungen bleiben gespeichert. Eine andere alte Sicherung darf nicht allein wegen gleicher Eintragsnummern automatisch zugeordnet werden. Offene Konflikte müssen vor ihrer Übernahme aufgelöst oder ausdrücklich übersprungen werden.

Vor der Anwendung werden die Auswahl, die erforderliche PIN und der aktuelle Bestand erneut geprüft. Eine inzwischen veraltete Vorschau muss aktualisiert werden. Eine unlesbare oder verlorene Antwort bleibt ein ungeklärtes Ergebnis; der Dialog ermöglicht die Prüfung des gespeicherten Importstands.

Betroffene Dateien: `src/routes/api/sicherung/+server.ts`, `src/lib/server/wiederherstellung.ts`, `src/lib/client/sicherung.ts` und `src/routes/mehr/+page.svelte`.

Abnahme: Vorprüfungen schreiben keine Nutzdaten. Ein unverändert wiederholter Import überspringt bereits behandelte Einträge. Ohne ausdrückliche Auswahl werden weder Geräteeinstellungen geändert noch neue Zeitpläne aktiviert. Alte Sicherungen bleiben mit nachvollziehbarer Konfliktklärung nutzbar.

### 4. Sperrzeiten und Ausnahmen konsistent auswerten

Die Auswertung berücksichtigt eine laufende Freigabe und sammelt anschließend alle wirksamen Schnellsperren sowie die aktivierten regulären Sperrzeiten. Reguläre Fenster werden nur bei eingeschaltetem Zeitplan berücksichtigt. Die Schutzoptionen der verbleibenden Fenster werden zusammengeführt.

Die Anlage einer Schnellsperre beendet die Freigabe vor der Auswertung. Neue oder bearbeitete reguläre Sperrzeiten und Änderungen am Zeitplanschalter erhalten eine laufende Freigabe. Der Status liefert die wirksamen Fenster und ihre zeitlichen Grenzen, damit die Oberfläche keine vorzeitige vollständige Freigabe ankündigt.

Gleiche Anfangszeit und Endzeit werden im Formular und auf dem Server abgelehnt. Alte wirkungslose Fenster werden bei Bearbeitung und Import zur Korrektur angezeigt. Diese Eingabeprüfung gilt auch für direkte Anfragen an die Schnittstelle.

Betroffene Dateien: `src/lib/server/sperre.ts`, `src/routes/api/sperre/+server.ts`, `src/routes/sperre/+page.svelte` und die Wiederherstellungsprüfung.

Abnahme: Die Reihenfolge der Datensätze beeinflusst die Schutzoptionen nicht. Schnellsperren wirken bei ausgeschaltetem regulärem Zeitplan. Nach ihrem Ablauf gilt dessen vorheriger Zustand. Änderungen am regulären Zeitplan erhalten die Freigabe. Gleiche Anfangszeit und Endzeit werden verständlich abgelehnt.

### 5. Gerätebestätigung und Anzeigen vereinheitlichen

Der Laufzeitzustand unterscheidet die Schutzvorgabe, ausstehende Schritte, beobachtete Gerätezustände, angenommene Tastenbefehle und Fehler. Erfolgreich gelesene Zustände bestätigen ausschließlich die zugehörigen Schutzmaßnahmen. Fehlende Erreichbarkeit, widersprechende Messwerte und veraltete Beobachtungen dürfen keine aktuelle Schutzbestätigung ergeben.

Sperrseite, Startseite, Layout und Importdialog verwenden dieselben Statusbegriffe. Schnittstellen und Ereigniskanal übertragen dieselbe Zustandsstruktur. Die vorgesehene Sperre begrenzt die Bedienung durch Overtone weiterhin auch dann, wenn ihre Anwendung am Gerät noch aussteht.

Unabhängige Schutzschritte und ausstehende Freigabeschritte bleiben nach Fehlern wiederholbar. Die bereits vorhandene gemeinsame Ausführung gleichzeitiger Abgleichanforderungen bleibt erhalten.

Betroffene Dateien: `src/lib/server/overtone.ts`, `src/routes/api/sperre/+server.ts`, `src/routes/api/state/+server.ts`, `src/routes/events/+server.ts`, `src/lib/client/overtone.svelte.ts`, `src/routes/sperre/+page.svelte`, `src/routes/+page.svelte`, `src/routes/+layout.svelte` und `src/routes/mehr/+page.svelte`.

Abnahme: Ein angenommener Schreibbefehl mit widersprechendem Lesewert ergibt keine bestätigte Schutzmaßnahme. Ein Geräteausfall entwertet die frühere Bestätigung. Tastensperre und gelesene Gerätezustände werden sprachlich unterschieden. Schnittstellen und Oberfläche zeigen denselben Stand.

### 6. Nachweise und Betriebsdokumentation abschließen

Die bestehenden Tests für Wiederherstellung, Weckzeiten, Freigabe, Berichte und Verbindung werden um die neuen Regeln ergänzt. Eine eigene Prüfung der Zeitfensterauswertung deckt Überlappungen, Schnellsperren, Freigaben und Zeitgrenzen ab. Zeitgeber und Geräteantworten werden kontrolliert simuliert.

Die Prüfungen verwenden temporäre Daten und ein simuliertes Gerät. Zusätzlich werden Vorschau, Konfliktentscheidung, Auswahlfelder, Teilberichte und Gerätefehler im Browser geprüft. Die README erläutert den laufenden Dienst als Schutzvoraussetzung und den Unterschied zwischen regulärem Zeitplan und Schnellsperre.

Abschließende Befehle: `npm test`, `npm run check` und `npm run build`. Diese Prüfungen wurden nach der Umsetzung erfolgreich ausgeführt.

## Fortgeltende Grundregeln

Die PIN wird vor geschützten Änderungen geprüft. Strukturell ungültige Sicherungen werden vor Nutzdatenänderungen abgelehnt. Senderbezüge müssen vor der Anlage abhängiger Einträge aufgelöst werden.

Reguläre Sperrzeiten verwenden weiterhin die lokale Zeitzone des Dienstprozesses. Ein Fenster über Mitternacht gehört in seinem Abschnitt nach Mitternacht zum ausgewählten Vortag. Der Beginn ist eingeschlossen, das Ende ausgeschlossen.

Weckzeiten bleiben auf dem Lautsprecher gespeichert. Wiederholte Geräteabgleiche sind keine garantierte maximale Reaktionszeit. Bei beendetem Dienst erfolgt keine zeitliche Durchsetzung oder Freigabe durch Overtone.

## Wesentliche Grenzen

Alte Sicherungen erlauben nicht in jedem Fall eine eindeutige Herkunftszuordnung. Solche Fälle benötigen eine sichtbare Entscheidung. Auch ein nachträglich gefundener, inhaltlich identischer Gerätewecker beweist allein nicht seine Zugehörigkeit zu einem unterbrochenen Import.

Der Plan sieht keinen vollständigen Rücksprung über Datenbank, Senderdatei und Lautsprecher hinweg vor. Stattdessen bleiben bestätigte Ergebnisse und ungeklärte Zwischenstände dauerhaft nachvollziehbar. Die allgemeine Zugangsgrenze bleibt das vertrauenswürdige private Netz.


## Umsetzungsnachweis vom 16. Oktober 2026

| Arbeitspaket | Ergebnis |
| --- | --- |
| Herkunft und lokale Entscheidungen | Sicherungsformat 2, dauerhafte Herkunftszuordnung, gerätebezogene Weckzeitkennung und Löschvermerke sind integriert. Exporte erhalten ihre Herkunft auch nach einem Neustart. |
| Dauerhafte Zwischenstände | Importvorgänge protokollieren offene und bestätigte Schritte. Eine verlorene Weckzeitantwort bleibt ungeklärt und verhindert eine automatische erneute Anlage. Gleichzeitige Wiederherstellungen werden begrenzt. |
| Vorprüfung und Ergebnisdarstellung | Vorschau, Konfliktentscheidungen, Dateiauswahl, abgewählte Zusatzoptionen und getrennte Ergebnisarten sind in Schnittstelle und Oberfläche integriert. Veraltete Vorschauen werden vor Änderungen abgewiesen. |
| Sperrauswertung | Überlappende Fenster vereinigen ihre Schutzoptionen. Schnellsperren sind unabhängig vom regulären Zeitplan. Reguläre Änderungen erhalten eine Freigabe. Gleiche Anfangszeit und Endzeit werden abgelehnt. |
| Gerätebestätigung | Gelesene Zustände sind von Schutzvorgaben und angenommenen Tastenbefehlen getrennt. Ausfälle und veraltete Beobachtungen entwerten die Bestätigung. Nicht mehr angeforderte Schutzoptionen werden auch bei weiterlaufenden Sperrzeiten freigegeben. |
| Nachweise und Dokumentation | Testsuite, Browserprüfung und README sind ergänzt. |

### Automatisierte Prüfungen

1. `npm test`: 92 erfolgreiche Tests in sieben Testdateien.
2. `npm run check`: keine Fehler und keine Warnungen.
3. `npm run build`: Produktionsbuild erfolgreich.
4. `git diff --check`: keine Formatierungsfehler.

Die Tests prüfen insbesondere wiederholte Importe über verschiedene Sicherungen, lokale Änderungen und Löschungen, Neustarts, externe Abweichungen, unterbrochene Schreibvorgänge, verlorene Geräteantworten, Herkunftskollisionen und gleichzeitige Wiederherstellungen. Die Geräteprüfung deckt widersprechende Messwerte, veraltete Beobachtungen und Geräteausfälle ab.

### Browserprüfung

Die Prüfung erfolgte mit einer temporären Ablage und einem simulierten Lautsprecher. Der Produktionsbuild wurde hierfür ausschließlich lokal gestartet.

1. Die Vorschau zeigt neue Einträge und standardmäßig abgewählte Zusatzoptionen.
2. Ein wiederholter Import übernimmt keine zusätzlichen Einträge und nennt die übersprungenen Einträge im Bericht.
3. Nach einem Dienstneustart werden die vorhandenen Herkunftszuordnungen wiedererkannt.
4. Eine externe Änderung zwischen Vorschau und Anwendung erzeugt eine aktualisierte Vorschau mit gesperrter Übernahme bis zur Entscheidung.
5. Eine verlorene Geräteantwort erscheint als ungeklärte Übernahme. Eine Wiederholung bleibt bis zur Klärung gesperrt.
6. Eine Schnellsperre wirkt bei ausgeschaltetem regulärem Zeitplan. Die Anzeige unterscheidet gelesenen Geräteschutz und angenommenen Tastenbefehl.
7. Bei simuliertem Geräteausfall verschwindet die vorherige Schutzbestätigung.

Die Testdienste wurden anschließend beendet. Die Prüfung verwendete keine reale Sonos Hardware. Die Tastensperre bleibt entsprechend der vereinbarten Grenze eine Befehlsbestätigung.
