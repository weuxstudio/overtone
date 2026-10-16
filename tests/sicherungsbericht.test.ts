import { expect, it } from 'vitest';
import { istSicherungsbericht, sicherungsFehlermeldung } from '../src/lib/client/sicherung';

const bericht = {
	ok: true,
	teilweise: false,
	angelegt: { sender: 1, szenen: 2, weckzeiten: 0, sperrzeiten: 0 },
	fehler: [],
	hinweise: ['Vorhandene Senderdefinition bleibt erhalten.'],
	hinweis: 'Wiederhergestellt: 1 Sender, 2 Szenen.'
};

it('akzeptiert vollständige Erfolgsberichte und Berichte über Teilfehler', () => {
	expect(istSicherungsbericht(bericht)).toBe(true);
	expect(istSicherungsbericht({
		...bericht, ok: false, teilweise: true, fehler: ['Eine Weckzeit wurde abgelehnt.']
	})).toBe(true);
});

it.each([
	{ fall: 'Liste', wert: [] },
	{ fall: 'leeres Objekt', wert: {} },
	{ fall: 'Fehler ohne Importbericht', wert: { ok: false, message: 'Fehler' } },
	{ fall: 'unlesbare Antwort', wert: null },
	{ fall: 'Text statt Erfolgswert', wert: { ...bericht, ok: 'true' } },
	{ fall: 'fehlender Teilstatus', wert: { ...bericht, teilweise: undefined } },
	{ fall: 'unvollständige Anzahlen', wert: { ...bericht, angelegt: { sender: 1 } } },
	{ fall: 'negative Anzahl', wert: { ...bericht, angelegt: { ...bericht.angelegt, sender: -1 } } },
	{ fall: 'gebrochene Anzahl', wert: { ...bericht, angelegt: { ...bericht.angelegt, sender: 1.5 } } },
	{ fall: 'unbegrenzte Anzahl', wert: { ...bericht, angelegt: { ...bericht.angelegt, sender: Infinity } } },
	{ fall: 'Fehlerliste mit falschem Typ', wert: { ...bericht, fehler: [5] } },
	{ fall: 'fehlende Hinweise', wert: { ...bericht, hinweise: undefined } },
	{ fall: 'leere Zusammenfassung', wert: { ...bericht, hinweis: ' ' } },
	{ fall: 'Erfolg trotz Fehler', wert: { ...bericht, fehler: ['Fehler'] } },
	{ fall: 'Ablehnung ohne Fehler', wert: { ...bericht, ok: false } },
	{ fall: 'widersprüchlicher Teilstatus', wert: { ...bericht, teilweise: true } }
])('lehnt $fall ab', ({ wert }) => {
	expect(istSicherungsbericht(wert)).toBe(false);
});

it('zeigt nur lesbare Serverfehlermeldungen und verwendet sonst den unbekannten Ausgang', () => {
	const ersatz = 'Ergebnis unbekannt.';
	expect(sicherungsFehlermeldung({ message: 'Keine Sicherung gefunden.' }, ersatz))
		.toBe('Keine Sicherung gefunden.');
	for (const wert of [null, [], {}, { message: '' }, { message: 42 }]) {
		expect(sicherungsFehlermeldung(wert, ersatz)).toBe(ersatz);
	}
});
