// Wiederherstellung aus einer Sicherungsdatei.
// Struktur und Werte werden vor der ersten Aenderung geprueft, neue Sender
// zuerst gespeichert, damit anschließend angelegte Szenen und Weckzeiten ihre
// Sender finden. Einzelne Geraetefehler werden gesammelt, unabhaengige
// Eintraege werden weiter verarbeitet. Die Wiederherstellung startet keine
// Wiedergabe; eine weiterhin geltende Kindersicherung wird abschliessend
// unmittelbar durchgesetzt.

import { createAlarm, listAlarms, alarmStoerung, alarmKennung } from './alarms';
import { randomUUID } from 'node:crypto';
import type { Bereich, Vorschau, Vorschauzeile, Importoptionen, Importentscheidungen, Einzelergebnis } from '../sicherung';
import { sceneRows, sceneRow, insertScene, herkunftLesen, registriereHerkunft, zuordnen, importSchritt, protokolliere, signatur, datenSignatur, transaktion } from './store';
import {
	klangSetzen,
	loadStations,
	saveStations,
	sperreDurchsetzen,
} from './overtone';

import { anlegen, setzeGlobal, sperreGlobal, fensterListe, zeitPruefen } from './sperre';

export type Bericht = {
	ok: boolean;
	status: 200;
	angelegt: { sender: number; szenen: number; weckzeiten: number; sperrzeiten: number };
	fehler: string[];
	hinweise: string[];
	teilweise: boolean;
	hinweis: string;
	ergebnisse: Einzelergebnis[];
};

export type Ungueltig = { status: 400; message: string; fehler: string[] };

function istUngueltig(eintrag: unknown): eintrag is Ungueltig {
	return (
		typeof eintrag === 'object' &&
		eintrag !== null &&
		(eintrag as { status?: unknown }).status === 400 &&
		Array.isArray((eintrag as Ungueltig).fehler)
	);
}

type SenderRoh = Record<string, unknown>;
type Struktur = {
	sender: SenderRoh[];
	szenen: SenderRoh[];
	weckzeiten: SenderRoh[];
	sperrzeiten: SenderRoh[];
	sperreGlobal: boolean | null;
	klang: { bass: number | null; treble: number | null; loudness: number | null } | null;
	wiedergabeart: string | null;
};

const WIEDERHOLUNGEN = ['ONCE', 'DAILY', 'WEEKDAYS', 'WEEKENDS'];
const WIEDERGAABEARTEN = ['NORMAL', 'SHUFFLE_NOREPEAT', 'REPEAT_ALL', 'REPEAT_ONE', 'SHUFFLE'];
const TAGE = [1, 2, 3, 4, 5, 6, 7];

function istUhrzeit(wert: unknown): boolean {
	// Nur gueltige Tageszeiten zweistellig im Format HH:MM.
	const treffer = /^(\d{2}):(\d{2})$/.exec(typeof wert === 'string' ? wert : '');
	if (!treffer) return false;
	const h = Number(treffer[1]);
	const m = Number(treffer[2]);
	return h <= 23 && m <= 59;
}

function tolleListe(roh: unknown, feld: string, unplausibel: string[]): SenderRoh[] {
	if (roh === undefined || roh === null) return [];
	if (!Array.isArray(roh)) {
		unplausibel.push(`"${feld}" ist keine Liste.`);
		return [];
	}
	return roh as SenderRoh[];
}

// Struktur und Werte komplett vor der ersten Aenderung pruefen: Ungueltige
// Eingaben liefern eine Zusammenfassung und fuehren zu nichts.
function strukturPruefen(roh: unknown): Struktur | Ungueltig {
	const unplausibel: string[] = [];
	if (typeof roh !== 'object' || roh === null || Array.isArray(roh)) {
		return { status: 400, message: 'Sicherung ist kein Objekt.', fehler: ['inhalt ist kein Objekt.'] };
	}
	const quelle = roh as SenderRoh;
	if (quelle.version !== undefined && quelle.version !== 2) unplausibel.push('Unbekannte Sicherungsversion.');
	const struktur: Struktur = {
		sender: tolleListe(quelle.sender, 'sender', unplausibel),
		szenen: tolleListe(quelle.szenen, 'szenen', unplausibel),
		weckzeiten: tolleListe(quelle.weckzeiten, 'weckzeiten', unplausibel),
		sperrzeiten: tolleListe(quelle.sperrzeiten, 'sperrzeiten', unplausibel),
		sperreGlobal: typeof quelle.sperreGlobal === 'boolean' ? quelle.sperreGlobal : null,
		klang: null,
		wiedergabeart: null
	};

	const senderKennungen = new Set<string>();
	struktur.sender.forEach((s, i) => {
		const feld = `sender[${i}]`;
		if (typeof s !== 'object' || s === null) {
			unplausibel.push(`${feld} ist kein Objekt.`);
			return;
		}
		if (typeof s.id === 'string') {
			if (senderKennungen.has(s.id.trim())) unplausibel.push(`${feld}: Doppelte Senderkennung.`);
			senderKennungen.add(s.id.trim());
		}
		for (const k of ['id', 'name', 'url']) {
			if (typeof (s as SenderRoh)[k] !== 'string' || !String((s as SenderRoh)[k]).trim()) {
				unplausibel.push(`${feld}.${k} fehlt oder ist kein Text.`);
			}
		}
	});

	struktur.szenen.forEach((s, i) => {
		const feld = `szenen[${i}]`;
		if (typeof s !== 'object' || s === null) {
			unplausibel.push(`${feld} ist kein Objekt.`);
			return;
		}
		if (typeof (s as SenderRoh).name !== 'string' || !String((s as SenderRoh).name).trim()) {
			unplausibel.push(`${feld}.name fehlt oder ist kein Text.`);
		}
		for (const k of ['volume', 'bass', 'treble', 'loudness']) {
			const wert = (s as SenderRoh)[k];
			if (wert !== undefined && wert !== null && (typeof wert !== 'number' || !Number.isFinite(wert))) {
				unplausibel.push(`${feld}.${k} ist keine Zahl.`);
			} else if (typeof wert === 'number') {
				if ((k === 'volume' && (wert < 0 || wert > 60)) || ((k === 'bass' || k === 'treble') && (wert < -10 || wert > 10)) || (k === 'loudness' && ![0,1].includes(wert))) unplausibel.push(`${feld}.${k} liegt außerhalb des gültigen Bereichs.`);
			}
		}
	});

	struktur.weckzeiten.forEach((w, i) => {
		const feld = `weckzeiten[${i}]`;
		if (typeof w !== 'object' || w === null) {
			unplausibel.push(`${feld} ist kein Objekt.`);
			return;
		}
		if (typeof (w as SenderRoh).time !== 'string' || !/^(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(String(w.time))) {
			unplausibel.push(`${feld}.time fehlt oder ist kein Text.`);
		}
		const wiederholung = (w as SenderRoh).recurrence;
		if (wiederholung !== undefined && wiederholung !== null && !WIEDERHOLUNGEN.includes(String(wiederholung).toUpperCase())) {
			unplausibel.push(`${feld}.recurrence ${String(wiederholung)} ist ungueltig.`);
		}
		const laut = (w as SenderRoh).volume;
		if (laut !== undefined && (typeof laut !== 'number' || Number.isNaN(laut) || laut < 0 || laut > 60)) {
			unplausibel.push(`${feld}.volume ${JSON.stringify(laut)} ist keine Zahl zwischen 0 und 60.`);
		}
		if (w.duration !== undefined && (typeof w.duration !== 'string' || !/^\d{2}:[0-5]\d:[0-5]\d$/.test(w.duration))) unplausibel.push(`${feld}.duration ist ungültig.`);
		const aktiv = (w as SenderRoh).enabled;
		if (aktiv !== undefined && aktiv !== null && typeof aktiv !== 'boolean') {
			unplausibel.push(`${feld}.enabled ist kein Aktivierungswert.`);
		}
	});

	struktur.sperrzeiten.forEach((s, i) => {
		const feld = `sperrzeiten[${i}]`;
		if (typeof s !== 'object' || s === null) {
			unplausibel.push(`${feld} ist kein Objekt.`);
			return;
		}
		// Schnellsperren sind vergaenglich und werden nicht uebernommen.
		if ((s as SenderRoh).einmalBis || (s as SenderRoh).einmal_bis) return;
		if (typeof (s as SenderRoh).name !== 'string' || !String((s as SenderRoh).name).trim()) {
			unplausibel.push(`${feld}.name fehlt oder ist kein Text.`);
		}
		// Vorhandene Werte muessen gueltig sein, ungueltige werden nicht
		// stillschweigend konvertiert. Fehlende Felder behalten die Standards
		// der Sperrzeitanlage: keine Wochentage, 20:00 bis 06:30, Schalter an.
		const tage = (s as SenderRoh).tage;
		if (tage !== undefined && tage !== null && !Array.isArray(tage)) {
			unplausibel.push(`${feld}.tage ist keine Liste.`);
		}
		if (
			Array.isArray(tage) &&
			!tage.every((t) => Number.isInteger(t) && TAGE.includes(t as number))
		) {
			unplausibel.push(`${feld}.tage enthält keine ganzen Zahlen zwischen 1 und 7.`);
		}
		for (const uhrzeit of ['von', 'bis'] as const) {
			const wert = (s as SenderRoh)[uhrzeit];
			if (wert !== undefined && wert !== null && !istUhrzeit(wert)) {
				unplausibel.push(`${feld}.${uhrzeit} ${JSON.stringify(wert)} ist keine Uhrzeit HH:MM.`);
			}
		}
		for (const schalter of ['aktiv', 'tasten', 'stumm'] as const) {
			const wert = (s as SenderRoh)[schalter];
			if (wert !== undefined && wert !== null && typeof wert !== 'boolean') {
				unplausibel.push(`${feld}.${schalter} ist kein An-/Aus-Wert.`);
			}
		}
	});

	const klang = quelle.klang;
	if (klang !== undefined && klang !== null) {
		if (typeof klang !== 'object' || Array.isArray(klang)) {
			unplausibel.push('"klang" ist kein Objekt.');
		} else {
			const rohKlang = klang as SenderRoh;
			const lesbar = (n: string): number | null => {
				const wert = rohKlang[n];
				if (wert === undefined || wert === null) return null;
				if (typeof wert !== 'number' || Number.isNaN(wert) || wert < -10 || wert > 10) {
					unplausibel.push(`klang.${n} ist keine Zahl zwischen -10 und 10.`);
					return null;
				}
				return wert;
			};
			struktur.klang = { bass: lesbar('bass'), treble: lesbar('treble'), loudness: lesbar('loudness') };
		}
	}

	const art = quelle.wiedergabeart;
	if (art !== undefined && art !== null) {
		if (typeof art !== 'string' || !WIEDERGAABEARTEN.includes(String(art).toUpperCase())) {
			unplausibel.push(`wiedergabeart ${String(art)} ist ungueltig.`);
		} else {
			struktur.wiedergabeart = String(art).toUpperCase();
		}
	}

	if (quelle.version === 2) {
        for (const art of ['sender', 'szenen', 'weckzeiten', 'sperrzeiten'] as const) {
            const gesehen = new Set<string>();
            for (const eintrag of struktur[art]) {
                const quellen = eintrag?.herkunft;
                if (!Array.isArray(quellen) || !quellen.length || quellen.length > 256 || !quellen.every(q => typeof q === 'string' && q.length > 0 && q.length <= 256 && !q.startsWith('alt:'))) { unplausibel.push(`${art}: Herkunft fehlt oder ist ungültig.`); continue; }
                for (const q of quellen) { if (gesehen.has(q)) unplausibel.push(`${art}: Doppelte Herkunft.`); gesehen.add(q); }
            }
        }
    }
    if (unplausibel.length) {
		return { status: 400, message: 'Ungültige Sicherung, nichts wurde geändert.', fehler: unplausibel };
	}
	return struktur;
}


type Bestand = Record<Bereich, Array<Record<string, any>>>;
type Fehler = { status: 400 | 409 | 503; message: string; fehler?: string[]; vorschau?: Vorschau };
type Zeile = Vorschauzeile & { roh: SenderRoh; quellen: string[] };
const ARTEN: Bereich[] = ['sender', 'szenen', 'weckzeiten', 'sperrzeiten'];

async function bestand(alarme: boolean): Promise<Bestand> {
    const weckzeiten = alarme ? await listAlarms() : [];
    if (alarme && alarmStoerung()) throw new Error(alarmStoerung());
    return { sender: loadStations(true), szenen: sceneRows(), weckzeiten, sperrzeiten: fensterListe().filter(f => !f.einmalBis) };
}
function lokalFuer(art: Bereich, wert: Record<string, any>): string { return art === 'weckzeiten' ? alarmKennung(wert.id) : String(wert.id); }
function name(art: Bereich, wert: Record<string, any>): string {
    if (art === 'weckzeiten') return `${wert.time ?? ''}${wert.label ? ` (${wert.label})` : ''}`;
    return String(wert.name ?? wert.label ?? wert.time ?? wert.id ?? art);
}
function quellenFuer(roh: SenderRoh, art: Bereich, index: number, datei: string): string[] {
    return Array.isArray(roh.herkunft) ? roh.herkunft as string[] : [`alt:${datei}:${art}:${index}`];
}
function zeilenErstellen(struktur: Struktur, roh: unknown, stand: Bestand): Zeile[] {
    const datei = signatur(roh);
    const zeilen: Zeile[] = [];
    for (const art of ARTEN) struktur[art].forEach((eintrag, index) => {
        if (art === 'sperrzeiten' && (eintrag.einmalBis || eintrag.einmal_bis)) return;
        const quellen = quellenFuer(eintrag, art, index, datei);
        const metadaten = quellen.map(q => herkunftLesen(art,q)).filter(r => !!r);
        // Sender files can retain their imported lineage across a database write interruption.
        const eingebettet = art === 'sender' ? stand.sender.find(s => s.herkunft?.some((q: string) => quellen.includes(q))) : undefined;
        const vorhanden = metadaten.length ? stand[art].find(r => lokalFuer(art,r) === metadaten[0].lokal) : eingebettet;
        const offen = quellen.map(q => importSchritt(art,q)).some(r => r?.zustand === 'offen');
        let zustand: Zeile['zustand'] = 'neu';
        let text = 'Wird neu übernommen.';
        if (offen && !vorhanden && art === 'weckzeiten') { zustand = 'ungeklaert'; text = 'Eine frühere Übernahme ist ungeklärt. Gerätebestand prüfen und zuordnen oder ausdrücklich als nicht angelegt bestätigen.'; }
        else if (metadaten.some(m => m.geloescht)) { zustand = 'geloescht'; text = 'Bewusst gelöscht. Bleibt gelöscht.'; }
        else if (metadaten.some(m => m.lokal !== metadaten[0].lokal)) { zustand = 'konflikt'; text = 'Die Herkunft verweist auf unterschiedliche Einträge. Zuordnung klären.'; }
        else if (vorhanden) {
            if (metadaten.some(m => m.basis !== datenSignatur(art, vorhanden))) { zustand = 'konflikt'; text = 'Der Bestand wurde außerhalb der erfassten Änderungen verändert. Vor der Übernahme klären.'; }
            else { zustand = metadaten.some(m => m.geaendert) ? 'geaendert' : 'vorhanden'; text = 'Vorhandener Eintrag bleibt unverändert.'; }
        } else if (metadaten.length) { zustand = 'konflikt'; text = 'Der zugeordnete Eintrag fehlt. Eine externe Löschung oder Änderung muss geklärt werden.'; }
        else if (!(roh as SenderRoh).version || stand[art].some(r => art === 'sender' ? r.id === eintrag.id : name(art,r) === name(art,eintrag))) {
            zustand = 'konflikt'; text = 'Die Herkunft ist unbekannt. Als neuen Eintrag übernehmen, einem vorhandenen zuordnen oder überspringen.';
        }
        if (art === 'sperrzeiten') {
            try { zeitPruefen(String(eintrag.von ?? '20:00'), String(eintrag.bis ?? '06:30'), (eintrag.tage ?? []) as number[]); }
            catch (e) { zustand = 'ungueltig'; text = e instanceof Error ? e.message : String(e); }
        }
        zeilen.push({ schluessel: signatur([art, quellen]), art, name: name(art,eintrag), zustand, text, roh: eintrag, quellen,
            ziele: stand[art].map(r => ({ id: lokalFuer(art,r), name: `${name(art,r)} (Nr. ${r.id})` })) });
    });
    return zeilen;
}
function vorschauAus(zeilen: Zeile[], roh: unknown, stand: Bestand): Vorschau {
    return { ok: true, vorschau: true, alt: (roh as SenderRoh).version !== 2,
        token: signatur({ roh, stand, zeitplan: sperreGlobal(), zuordnung: zeilen.map(z => [z.schluessel,z.zustand,z.quellen.map(q => [herkunftLesen(z.art,q),importSchritt(z.art,q)])]) }),
        eintraege: zeilen.map(({ roh: _r, quellen: _q, ...z }) => z) };
}
export async function vorpruefen(roh: unknown): Promise<(Vorschau & { status: 200 }) | Fehler> {
    const struktur = strukturPruefen(roh);
    if (istUngueltig(struktur)) return struktur;
    try {
        const stand = await bestand(struktur.weckzeiten.length > 0);
        return { status: 200, ...vorschauAus(zeilenErstellen(struktur,roh,stand),roh,stand) };
    } catch (e) { return { status: 503, message: `Vorprüfung nicht möglich: ${e instanceof Error ? e.message : String(e)}` }; }
}

let importLaeuft = false;
export async function wiederherstellen(roh: unknown, token?: string, optionen: Importoptionen = {}, entscheidungen: Importentscheidungen = {}): Promise<Bericht | Fehler> {
    const struktur = strukturPruefen(roh);
    if (istUngueltig(struktur)) return struktur;
    if (importLaeuft) return { status: 409, message: 'Eine Wiederherstellung läuft bereits. Anschließend erneut vorprüfen.' };
    importLaeuft = true;
    try { return await anwenden(struktur, roh, token, optionen, entscheidungen); }
    catch (e) { return { status: 503, message: `Ergebnis möglicherweise unvollständig. Importstand erneut prüfen. ${e instanceof Error ? e.message : String(e)}` }; }
    finally { importLaeuft = false; }
}
async function anwenden(struktur: Struktur, roh: unknown, token: string | undefined, optionen: Importoptionen, entscheidungen: Importentscheidungen): Promise<Bericht | Fehler> {
    const stand = await bestand(struktur.weckzeiten.length > 0);
    const zeilen = zeilenErstellen(struktur, roh, stand);
    const vorschau = vorschauAus(zeilen, roh, stand);
    if (!token || token !== vorschau.token) return { status: 409, message: 'Vor der Übernahme den aktuellen Bestand prüfen.', vorschau };
    for (const z of zeilen) {
        const wahl = entscheidungen[z.schluessel];
        if (wahl !== undefined && !['neu', 'ueberspringen', ...z.ziele.map(t => `zuordnen:${t.id}`)].includes(wahl)) return { status: 400, message: 'Ungültige Konfliktentscheidung.' };
        if (['konflikt','ungeklaert','ungueltig'].includes(z.zustand) && !wahl) return { status: 409, message: `Entscheidung erforderlich: ${z.name}`, vorschau };
        if (z.zustand === 'ungueltig' && wahl !== 'ueberspringen') return { status: 400, message: `Ungültige Sperrzeit zuerst korrigieren oder überspringen: ${z.name}` };
        if (['vorhanden','geaendert','geloescht'].includes(z.zustand) && wahl && wahl !== 'ueberspringen') return { status: 400, message: 'Vorhandene und bewusst gelöschte Einträge bleiben erhalten.' };
    }
    const angelegt = { sender: 0, szenen: 0, weckzeiten: 0, sperrzeiten: 0 };
    const fehler: string[] = [], hinweise: string[] = [], ergebnisse: Einzelergebnis[] = [];
    const senderZuordnung = new Map<string,string>();
    for (const z of zeilen) {
        const wahl = entscheidungen[z.schluessel];
        const metadaten = z.quellen.map(q => herkunftLesen(z.art,q)).find(m => m && !m.geloescht);
        const eingebettet = z.art === 'sender' ? stand.sender.find(s => s.herkunft?.some((q: string) => z.quellen.includes(q))) : undefined;
        const ziel = wahl?.startsWith('zuordnen:') ? wahl.slice(9) : metadaten?.lokal ?? eingebettet?.id;
        if (z.art === 'sender' && ziel && stand.sender.some(s => s.id === ziel)) senderZuordnung.set(String(z.roh.id),ziel);
        const meldung = (zustand: Einzelergebnis['zustand'], text: string) => {
            ergebnisse.push({ art: z.art, name: z.name, zustand, text });
            if (zustand === 'fehlgeschlagen' || zustand === 'ungeklaert') fehler.push(`${{sender:'Sender',szenen:'Szene',weckzeiten:'Weckzeit',sperrzeiten:'Sperrzeit'}[z.art]} ${z.name}: ${text}`);
            else if (zustand === 'uebersprungen') hinweise.push(`${z.name}: ${text}`);
        };
        if (wahl?.startsWith('zuordnen:')) {
            const aktuell = stand[z.art].find(r => lokalFuer(z.art,r) === ziel)!;
            transaktion(() => { zuordnen(z.art,z.quellen,ziel!,aktuell); for (const q of z.quellen) protokolliere(z.art,q,'bestaetigt',[],ziel); });
            meldung('uebersprungen','Dem vorhandenen Eintrag zugeordnet. Dieser bleibt unverändert.'); continue;
        }
        if (wahl === 'ueberspringen' && z.zustand === 'ungeklaert') { meldung('ungeklaert','Frühere Übernahme bleibt ungeklärt. Nicht erneut ausgeführt.'); continue; }
        if (wahl === 'ueberspringen' || ['vorhanden','geaendert','geloescht'].includes(z.zustand)) {
            if (eingebettet && !metadaten) transaktion(() => { zuordnen(z.art,z.quellen,eingebettet.id,eingebettet); for (const q of z.quellen) protokolliere(z.art,q,'bestaetigt',[],eingebettet.id); });
            meldung('uebersprungen',z.text); continue; }
        if (z.zustand === 'ungeklaert' && wahl !== 'neu') { meldung('ungeklaert', z.text); continue; }
        // A new attempt after an unclear result is an explicit decision after a fresh device read.
        const vorher = z.art === 'weckzeiten' ? stand.weckzeiten : [];
        for (const q of z.quellen) protokolliere(z.art,q,'offen',vorher);
        let geraeteaufruf = false;
        try {
            const e = z.roh;
            const senderId = String(e.stationId ?? e.station_id ?? '');
            const bezug = senderZuordnung.get(senderId) ?? (!struktur.sender.some(s => s.id === senderId) ? senderId : '');
            if (senderId && (!bezug || !loadStations().some(s => s.id === bezug))) throw new Error('Sender unbekannt oder nicht zugeordnet.');
            let id: string | number;
            let wert: unknown;
            if (z.art === 'sender') {
                id = String(e.id);
                if (loadStations().some(s => s.id === id)) id = `import-${randomUUID()}`;
                const sender = { id, name: String(e.name), url: String(e.url), herkunft: z.quellen };
                saveStations([...loadStations(),sender]); wert = sender;
                senderZuordnung.set(String(e.id),id);
            } else if (z.art === 'szenen') {
                id = transaktion(() => {
                    const neu = insertScene({ name: String(e.name), station_id: bezug || null, url: typeof e.url === 'string' ? e.url : null, title: typeof e.title === 'string' ? e.title : null,
                        volume: typeof e.volume === 'number' ? e.volume : null, bass: typeof e.bass === 'number' ? e.bass : null, treble: typeof e.treble === 'number' ? e.treble : null,
                        loudness: typeof e.loudness === 'number' ? e.loudness : null, play_mode: typeof (e.playMode ?? e.play_mode) === 'string' ? String(e.playMode ?? e.play_mode) : null, position: sceneRows().length });
                    zuordnen(z.art,z.quellen,neu,sceneRow(neu));
                    for (const q of z.quellen) protokolliere(z.art,q,'bestaetigt',[],neu);
                    return neu;
                }); wert = sceneRow(id);
            } else if (z.art === 'sperrzeiten') {
                id = transaktion(() => {
                    const neu = anlegen({ name: String(e.name), tage: e.tage as number[], von: e.von as string, bis: e.bis as string,
                        tasten: e.tasten !== false, stumm: e.stumm !== false, aktiv: optionen.aktivieren === true && e.aktiv !== false });
                    const row = fensterListe().find(f => f.id === neu);
                    zuordnen(z.art,z.quellen,neu,row);
                    for (const q of z.quellen) protokolliere(z.art,q,'bestaetigt',[],neu);
                    return neu;
                }); wert = fensterListe().find(f => f.id === id);
            } else {
                geraeteaufruf = true;
                const r = await createAlarm({ time: String(e.time), recurrence: e.recurrence as string | undefined, duration: e.duration as string | undefined,
                    stationId: bezug, volume: e.volume as number | undefined, label: e.label as string | undefined,
                    enabled: optionen.aktivieren === true && e.enabled !== false }, z.quellen);
                if (!r.ok || r.id === undefined) {
                    if (!r.ungeklaert) for (const q of z.quellen) protokolliere(z.art,q,'fehlgeschlagen');
                    meldung(r.ungeklaert ? 'ungeklaert' : 'fehlgeschlagen', r.message ?? 'Gerät hat abgelehnt.'); continue;
                }
                id = r.id;
            }
            if (z.art !== 'weckzeiten') transaktion(() => { zuordnen(z.art,z.quellen,id,wert); for (const q of z.quellen) protokolliere(z.art,q,'bestaetigt',[],id); });
            angelegt[z.art]++; meldung('uebernommen','Übernommen.');
        } catch (e) {
            if (!geraeteaufruf) for (const q of z.quellen) protokolliere(z.art,q,'fehlgeschlagen');
            meldung(geraeteaufruf ? 'ungeklaert' : 'fehlgeschlagen', geraeteaufruf ? 'Die Geräteantwort fehlt. Die Weckzeit kann bereits angelegt sein. Vor einem weiteren Versuch den Gerätebestand prüfen.' : e instanceof Error ? e.message : String(e));
        }
    }
    const geraeteschritt = async (titel: string, aktion: () => Promise<{ ok: boolean; message?: string }>) => {
        try { const r = await aktion(); if (!r.ok) fehler.push(`${titel}: ${r.message ?? 'abgelehnt'}`); }
        catch (e) { fehler.push(`${titel}: ${String(e)}`); }
    };
    if (optionen.klang && struktur.klang) for (const aktion of ['bass','treble','loudness'] as const) {
        const wert = struktur.klang[aktion]; if (wert !== null) await geraeteschritt(`Klang ${aktion}`, () => klangSetzen(aktion,wert));
    }
    if (optionen.wiedergabeart && struktur.wiedergabeart) await geraeteschritt('Wiedergabeart', () => klangSetzen('playmode',struktur.wiedergabeart!));
    if (optionen.zeitplan && struktur.sperreGlobal !== null) setzeGlobal(struktur.sperreGlobal);
    try { const r = await sperreDurchsetzen(); fehler.push(...r.fehler.map(f => `Kindersicherung: ${f}`)); } catch (e) { fehler.push(`Kindersicherung: ${String(e)}`); }
    return { status: 200, ok: !fehler.length, teilweise: !!fehler.length, angelegt, fehler, hinweise, ergebnisse,
        hinweis: `Übernommen: ${angelegt.sender} Sender, ${angelegt.szenen} ${angelegt.szenen === 1 ? 'Szene' : 'Szenen'}, ${angelegt.weckzeiten} ${angelegt.weckzeiten === 1 ? 'Weckzeit' : 'Weckzeiten'}, ${angelegt.sperrzeiten} ${angelegt.sperrzeiten === 1 ? 'Sperrzeit' : 'Sperrzeiten'}. Übersprungen: ${ergebnisse.filter(e => e.zustand === 'uebersprungen').length}. Ungeklärt: ${ergebnisse.filter(e => e.zustand === 'ungeklaert').length}.` };
}

export async function sicherungsInhalt(): Promise<Record<string,unknown>> {
    const stand = await bestand(true);
    return { version: 2, erstellt: new Date().toISOString(),
        ...Object.fromEntries(ARTEN.map(art => [art,stand[art].map(e => ({ ...e, herkunft: registriereHerkunft(art,lokalFuer(art,e),e).filter(q => !q.startsWith('alt:')) }))])) };
}
