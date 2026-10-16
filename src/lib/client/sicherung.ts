import type { Vorschau, Einzelergebnis } from '../sicherung';
export type Sicherungsbericht = {
	ok: boolean;
	teilweise: boolean;
	angelegt: { sender: number; szenen: number; weckzeiten: number; sperrzeiten: number };
	fehler: string[];
	hinweise: string[];
	hinweis: string;
	ergebnisse?: Einzelergebnis[];
};

export const WIEDERHERSTELLUNG_UNGEKLAERT =
	'Das Ergebnis der Wiederherstellung ist unbekannt. Vor einem erneuten Versuch den aktuellen Stand prüfen.';

function istObjekt(wert: unknown): wert is Record<string, unknown> {
	return typeof wert === 'object' && wert !== null && !Array.isArray(wert);
}

export function sicherungsFehlermeldung(wert: unknown, ersatz: string): string {
	return istObjekt(wert) && typeof wert.message === 'string' && wert.message.trim()
		? wert.message
		: ersatz;
}

// Nur ein vollstaendiger, widerspruchsfreier Importbericht bestaetigt den Ausgang.
export function istSicherungsbericht(wert: unknown): wert is Sicherungsbericht {
	if (
		!istObjekt(wert) ||
		typeof wert.ok !== 'boolean' ||
		typeof wert.teilweise !== 'boolean' ||
		typeof wert.hinweis !== 'string' ||
		!wert.hinweis.trim() ||
		!istObjekt(wert.angelegt) ||
		!Array.isArray(wert.fehler) ||
		!wert.fehler.every((eintrag) => typeof eintrag === 'string') ||
		!Array.isArray(wert.hinweise) ||
		!wert.hinweise.every((eintrag) => typeof eintrag === 'string')
	) return false;

	for (const bereich of ['sender', 'szenen', 'weckzeiten', 'sperrzeiten']) {
		const anzahl = wert.angelegt[bereich];
		if (typeof anzahl !== 'number' || !Number.isSafeInteger(anzahl) || anzahl < 0) return false;
	}

    if (wert.ergebnisse !== undefined && (!Array.isArray(wert.ergebnisse) || !wert.ergebnisse.every(e => istObjekt(e) && ['sender','szenen','weckzeiten','sperrzeiten'].includes(String(e.art)) && ['uebernommen','uebersprungen','fehlgeschlagen','ungeklaert'].includes(String(e.zustand)) && typeof e.name === 'string' && typeof e.text === 'string'))) return false;
	const hatFehler = wert.fehler.length > 0;
	return wert.ok === !hatFehler && wert.teilweise === hatFehler;
}

export function istVorschau(wert: unknown): wert is Vorschau {
    return istObjekt(wert) && wert.ok === true && wert.vorschau === true && typeof wert.token === 'string' && /^[a-f0-9]{64}$/.test(wert.token) && typeof wert.alt === 'boolean' && Array.isArray(wert.eintraege) && wert.eintraege.every(e =>
        istObjekt(e) && typeof e.schluessel === 'string' && typeof e.name === 'string' && typeof e.text === 'string' &&
        ['sender','szenen','weckzeiten','sperrzeiten'].includes(String(e.art)) && ['neu','vorhanden','geaendert','geloescht','konflikt','ungeklaert','ungueltig'].includes(String(e.zustand)) &&
        Array.isArray(e.ziele) && e.ziele.every(z => istObjekt(z) && typeof z.id === 'string' && typeof z.name === 'string'));
}
