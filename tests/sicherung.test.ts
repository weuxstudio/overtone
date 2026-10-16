import fs from 'node:fs';
import path from 'node:path';
import { expect, vi, it, beforeEach } from 'vitest';
import {
	alarmListenXml,
	xmlMitListe,
	konfigSchreiben,
	stationenLesen,
	stationenSchreiben,
	zuhause,
	zuHausePfad,
	type Rufen
} from './hilfe';

vi.mock('@sveltejs/kit', () => ({
	json: (daten: unknown, init?: { status?: number }) => ({
		daten,
		status: init?.status ?? 200
	})
}));

// Simulierte Geraetekommunikation: Antworten pro Aktion, dazu Protokoll.
vi.mock('../src/lib/server/sonos', () => {
	let antwort: (ruf: Rufen) => { ok: boolean; errorCode?: number; xml?: string; values?: Record<string, string> } = () => ({
		ok: true,
		values: {}
	});
	const verwaltet = {
		protokoll: [] as Rufen[],
		setze(alsNaechstes: typeof antwort) {
			antwort = alsNaechstes;
		}
	};
	return {
		verwaltet,
		call: (host: string, service: string, action: string, args: Record<string, string | number> = {}) => {
			const ruf: Rufen = { host, service, action, args: { ...args } };
			verwaltet.protokoll.push(ruf);
			const r = antwort(ruf);
			if (action === 'ListAlarms' && r.ok && !r.xml) return { ...r, xml: '<CurrentAlarmList></CurrentAlarmList>' };
			return r;
		},
		escapeXml: (wert: string) => String(wert).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
		unescapeXml: (wert: string) =>
			String(wert).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'),
		didlForHttpAudio: (url: string, titel: string) => `<DIDL><res>${url}</res><dc:title>${titel}</dc:title></DIDL>`
	};
});

import { verwaltet } from '../src/lib/server/sonos';
import type { StoreModul } from './typen';

// Netzwerk bleibt aus: jedes echte fetch schlägt sofort fehl, der Rest
// läuft über die simulierte SOAP-Schicht.
vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('netz unterbrochen'); }));

// Simulierte Geraetekommunikation: Antworten pro Aktion, dazu Protokoll.
beforeEach(() => {
	verwaltet.protokoll.length = 0;
});

async function vorbereitung(): Promise<{ home: string; store: StoreModul }> {
	const home = zuhause();
	konfigSchreiben(home, {
		host: '192.168.1.50',
		uuid: 'RINCON_TEST',
		callbackHost: '192.168.1.10'
	});
	vi.resetModules();
	const store = (await import('../src/lib/server/store')) as unknown as StoreModul;
	return { home, store };
}

function postDirekt(anfrage: unknown): Promise<{ daten: Record<string, any>; status: number }> {
	return import('../src/routes/api/sicherung/+server').then((route) =>
		route.POST({
			request: new Request('http://localhost:8770/api/sicherung', {
				method: 'POST',
				body: JSON.stringify(anfrage)
			})
		}) as unknown as Promise<{ daten: Record<string, any>; status: number }>
	);
}

// Diese bestehenden Fälle wählen die Übernahme und Aktivierung ausdrücklich.
// Neue Ablaufprüfungen verwenden die direkte Schnittstelle ohne diese Auswahl.
async function post(anfrage: unknown): Promise<{ daten: Record<string, any>; status: number }> {
    const r = await postDirekt(anfrage);
    if (r.status !== 409 || !r.daten.vorschau) return r;
    const body = anfrage as Record<string,any>;
    const entscheidungen = Object.fromEntries(r.daten.vorschau.eintraege.filter((e: any) => ['konflikt','ungeklaert','ungueltig'].includes(e.zustand)).map((e: any) => {
        const sender = body.inhalt?.sender?.find((s: any) => s.name === e.name);
        const ziel = e.art === 'sender' && sender ? e.ziele.find((z: any) => z.id === sender.id) : undefined;
        return [e.schluessel, e.zustand === 'ungueltig' ? 'ueberspringen' : ziel ? `zuordnen:${ziel.id}` : 'neu'];
    }));
    return postDirekt({ ...body, token: r.daten.vorschau.token, entscheidungen,
        optionen: { klang: true, wiedergabeart: true, zeitplan: true, aktivieren: true } });
}

// Roher Anfragetext fuer Faelle, die das JSON-Parsen selbst scheitern lassen.
function postRoh(body: string): Promise<{ daten: Record<string, any>; status: number }> {
	return import('../src/routes/api/sicherung/+server').then((route) =>
		route.POST({
			request: new Request('http://localhost:8770/api/sicherung', { method: 'POST', body })
		}) as unknown as Promise<{ daten: Record<string, any>; status: number }>
	);
}

const SICHERUNG = {
	erstellt: '2026-10-15T09:00:00.000Z',
	sender: [
		{ id: 'neu-sender', name: 'Neu Sender', url: 'https://neu.example.org/stream' },
		{ id: 'radio-alt', name: 'Anders Schreibweise', url: 'https://extra.example.org/stream' }
	],
	szenen: [
		{ name: 'Abend', station_id: 'neu-sender', play_mode: 'REPEAT_ONE', volume: 12 },
		{ name: 'Morgen', stationId: 'radio-alt' }
	],
	weckzeiten: [
		{ id: 7, time: '07:05:00', recurrence: 'WEEKDAYS', volume: 0, stationId: 'neu-sender', enabled: false, label: 'Spielzeit' },
		{ id: 8, time: '08:00:00', recurrence: 'DAILY', volume: 15, stationId: 'neu-sender' }
	],
	sperrzeiten: [
		{ id: 1, name: 'Nacht', tage: [1, 2], von: '20:00', bis: '06:30', aktiv: true, tasten: true, stumm: true, einmalBis: '' }
	],
	sperreGlobal: true,
	klang: { bass: -3, treble: 5, loudness: 0 },
	wiedergabeart: 'REPEAT_ALL'
};

it('fehlende und falsche PIN verhindern jede Änderung, auch ausserhalb einer aktiven Sperre', async () => {
	const { home } = await vorbereitung();
	const sperre = await import('../src/lib/server/sperre');
	sperre.pinSetzen('1234');
	verwaltet.setze(() => ({ ok: true, values: {} }));
	const anfang = verwaltet.protokoll.length;

	const ohnePin = await post({ action: 'wiederherstellen', inhalt: SICHERUNG });
	expect(ohnePin.status).toBe(403);
	const falschePin = await post({ action: 'wiederherstellen', pin: '9999', inhalt: SICHERUNG });
	expect(falschePin.status).toBe(403);

	// Nichts geaendert: kein einziger Geraetebefehl, keine Datensaetze, keine
	// Senderdatei.
	expect(verwaltet.protokoll).toHaveLength(anfang);
	const store = (await import('../src/lib/server/store')) as unknown as StoreModul;
	expect(store.alarmRows()).toHaveLength(0);
	expect(fs.existsSync(zuHausePfad(home, 'stations.json'))).toBe(false);
	expect((await import('../src/lib/server/sperre')).fensterListe()).toHaveLength(0);
});

it('Wiederherstellung nimmt Sender zuerst auf, erhält Werte und liest alte Schreibweisen', async () => {
	const { home, store } = await vorbereitung();
	stationenSchreiben(home, [{ id: 'radio-alt', name: 'Alter Sender', url: 'https://alt.example.org/stream' }]);
	verwaltet.setze((ruf) => {
		if (ruf.action === 'CreateAlarm') return { ok: true, values: { AssignedID: String(200 + verwaltet.protokoll.length) } };
		return { ok: true, values: {} };
	});

	const bericht = (await post({ action: 'wiederherstellen', inhalt: SICHERUNG })) as { daten: Record<string, any>; status: number };
	expect(bericht.status).toBe(200);
	expect(bericht.daten.ok).toBe(true);
	expect(bericht.daten.teilweise).toBe(false);
	expect(bericht.daten.fehler).toEqual([]);
	expect(bericht.daten.angelegt).toEqual({ sender: 1, szenen: 2, weckzeiten: 2, sperrzeiten: 1 });

	// Neue Sender zuerst gespeichert ...
	expect(stationenLesen(home).map((s) => s.id)).toContain('neu-sender');
	// ... gleiche Kennung mit abweichenden Daten bleibt in der vorhandenen
	// Definition, der Konflikt erzeugt einen Hinweis.
	expect(stationenLesen(home).find((s) => s.id === 'radio-alt')?.url).toBe('https://alt.example.org/stream');
	expect(bericht.daten.ergebnisse.some((e: any) => e.art === 'sender' && e.zustand === 'uebersprungen')).toBe(true);

	// Szenen aus beiden Schreibweisen (station_id und stationId).
	const szeneAbend = store.sceneRows().find((s) => s.name === 'Abend');
	expect(szeneAbend?.station_id).toBe('neu-sender');
	expect(szeneAbend?.play_mode).toBe('REPEAT_ONE');
	const szeneMorgen = store.sceneRows().find((s) => s.name === 'Morgen');
	expect(szeneMorgen?.station_id).toBe('radio-alt');

	// Deaktivierte Weckzeit und Lautstärke null bleiben erhalten, fehlendes
	// Aktivierungsfeld erhält den bisherigen Standard true.
	const zeilen = store.alarmRows();
	expect(zeilen.find((z) => z.time === '07:05:00')?.enabled).toBe(0);
	expect(zeilen.find((z) => z.time === '07:05:00')?.volume).toBe(0);
	expect(zeilen.find((z) => z.time === '08:00:00')?.enabled).toBe(1);

	// Stabile Senderadresse am Gerät, keine Wiedergabe gestartet.
	const erzeugt = verwaltet.protokoll.filter((r) => r.action === 'CreateAlarm');
	expect(erzeugt).toHaveLength(2);
	expect(erzeugt[0].args.Enabled).toBe(0);
	expect(erzeugt[0].args.Volume).toBe(0);
	expect(erzeugt[0].args.RoomUUID).toBe('RINCON_TEST');
	expect(erzeugt.every((r) => r.args.ProgramURI === 'https://neu.example.org/stream')).toBe(true);
	expect(verwaltet.protokoll.some((r) => r.action === 'Play')).toBe(false);

	// Klang und Wiedergabeart werden wiederhergestellt, ausgeschaltete
	// Loudness bleibt aus.
	const befehle = verwaltet.protokoll.filter((r) =>
		['SetBass', 'SetTreble', 'SetLoudness', 'SetPlayMode'].includes(r.action)
	);
	expect(befehle.find((r) => r.action === 'SetBass')?.args.DesiredBass).toBe(-3);
	expect(befehle.find((r) => r.action === 'SetTreble')?.args.DesiredTreble).toBe(5);
	expect(befehle.find((r) => r.action === 'SetLoudness')?.args.DesiredLoudness).toBe(0);
	expect(befehle.find((r) => r.action === 'SetPlayMode')?.args.NewPlayMode).toBe('REPEAT_ALL');
});

it('ungültige Struktur und Werte liefern 400, bevor irgendetwas geändert wird', async () => {
	await vorbereitung();
	verwaltet.setze(() => ({ ok: true, values: {} }));
	const anfang = verwaltet.protokoll.length;

	const bericht = (await post({
		action: 'wiederherstellen',
		inhalt: {
			...SICHERUNG,
			weckzeiten: [{ time: '07:00', volume: 'laut' }, { time: '08:00', volume: 90 }],
			szenen: [{ name: ' ' }],
			sender: [{ id: 'x', name: 'x', url: '' }]
		}
	})) as { daten: Record<string, any>; status: number };
	expect(bericht.status).toBe(400);
	expect(bericht.daten.ok).toBe(false);
	expect(bericht.daten.message).toContain('Ungültige');
	expect(bericht.daten.fehler.some((f: string) => f.includes('weckzeiten[0]'))).toBe(true);
	expect(bericht.daten.fehler.some((f: string) => f.includes('90'))).toBe(true);
	// Nichts wurde geändert.
	expect(verwaltet.protokoll).toHaveLength(anfang);
});

it('Geräteablehnungen erzeugen sichtbare Teilberichte und erhalten betroffene lokale Datensätze', async () => {
	const { home, store } = await vorbereitung();
	stationenSchreiben(home, [{ id: 'dlf2', name: 'Radiostation', url: 'https://dlf2.example.org/stream' }]);
	verwaltet.setze((ruf) =>
		ruf.action === 'CreateAlarm' ? { ok: false, errorCode: 402, values: {} } : { ok: true, values: {} }
	);

	const bericht = (await post({
		action: 'wiederherstellen',
		inhalt: {
			sender: [],
			szenen: [{ name: 'Abend' }, { name: 'Morgen' }],
			weckzeiten: [{ time: '09:00:00', stationId: 'dlf2', label: 'Früh' }],
			sperrzeiten: []
		}
	})) as { daten: Record<string, any>; status: number };
	expect(bericht.status).toBe(200);
	expect(bericht.daten.ok).toBe(false);
	expect(bericht.daten.teilweise).toBe(true);
	expect(bericht.daten.angelegt.weckzeiten).toBe(0);
	expect(bericht.daten.angelegt.szenen).toBe(2);
	expect(bericht.daten.fehler.some((f: string) => f.startsWith('Weckzeit 09:00:00'))).toBe(true);

	// Die betroffenen lokalen Datensätze blieben unberührt.
	expect(store.alarmRows()).toHaveLength(0);
	// Der Abschlussabgleich lief trotzdem.
	expect(verwaltet.protokoll.some((r) => r.action === 'SetButtonLockState')).toBe(true);
});

it('falsche Sender und unbekannte Kennungen sammeln sich, ohne die übrigen Einträge zu stoppen', async () => {
	await vorbereitung();
	const sperre = await import('../src/lib/server/sperre');
	sperre.pinSetzen('2468');
	verwaltet.setze(() => ({ ok: true, values: {} }));

	const bericht = (await post({
		action: 'wiederherstellen',
		pin: '2468',
		inhalt: {
			szenen: [{ name: 'Nur Name' }],
			weckzeiten: [{ time: '6:30', volume: 7, stationId: 'unbekannter-sender' }],
			sperrzeiten: [],
			sender: []
		}
	})) as { daten: Record<string, any>; status: number };
	expect(bericht.status).toBe(200);
	expect(bericht.daten.angelegt.szenen).toBe(1);
	expect(bericht.daten.angelegt.weckzeiten).toBe(0);
	expect(bericht.daten.fehler.some((f: string) => f.includes('Weckzeit') && f.includes('unbekannt'))).toBe(true);
	expect(bericht.daten.teilweise).toBe(true);
});

it('Sicherung mit PIN liest alles: alte Einträge aus einem vollständigen Backup', async () => {
	const { home, store } = await vorbereitung();
	stationenSchreiben(home, [{ id: 'alt', name: 'Alt', url: 'https://alt.example.org/alt' }]);
	verwaltet.setze((ruf) => (ruf.action === 'ListAlarms' ? xmlMitListe(alarmListenXml([])) : ruf.action === 'CreateAlarm' ? { ok: true, values: { AssignedID: String(300 + verwaltet.protokoll.length) } } : { ok: true, values: {} }));
	const sperre = await import('../src/lib/server/sperre');
	sperre.pinSetzen('1111');

	const bericht = (await post({
		action: 'wiederherstellen',
		pin: '1111',
		inhalt: {
			sender: [{ id: 'alt', name: 'Alt', url: 'https://alt.example.org/alt' }],
			szenen: [],
			weckzeiten: [{ time: '07:00:00', volume: 3, stationId: 'alt' }],
			sperrzeiten: []
		}
	})) as { daten: Record<string, any>; status: number };
	expect(bericht.status).toBe(200);
	expect(bericht.daten.ok).toBe(true);
	expect(store.alarmRows()).toHaveLength(1);
	expect(stationenLesen(home)).toHaveLength(1);
});

it('Aktivierungszustand von Sperrzeiten übernimmt ausdrücklich und bildet den Sperrstatus ab', async () => {
	await vorbereitung();
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-10-16T10:00:00.000Z'));
	try {
		verwaltet.setze((ruf) => (ruf.action === 'ListAlarms' ? xmlMitListe(alarmListenXml([])) : { ok: true, values: {} }));
		const sperre = await import('../src/lib/server/sperre');

		const bericht = (await post({
			action: 'wiederherstellen',
			inhalt: {
				sender: [],
				szenen: [],
				weckzeiten: [],
				sperrzeiten: [
					{ name: 'Ausgeschaltet', tage: [1, 2, 3, 4, 5, 6, 7], von: '00:00', bis: '23:59', aktiv: false, tasten: true, stumm: true },
					{ name: 'Ohne Feld', tage: [1, 2, 3, 4, 5, 6, 7], von: '00:00', bis: '23:59', tasten: true, stumm: true }
				]
			}
		})) as { daten: Record<string, any>; status: number };
		expect(bericht.status).toBe(200);
		expect(bericht.daten.ok).toBe(true);
		expect(bericht.daten.fehler).toEqual([]);

		const zeilen = sperre.fensterListe();
		// Vorhandenes aktiv false bleibt erhalten ...
		const aus = zeilen.find((z) => z.name === 'Ausgeschaltet');
		expect(aus?.aktiv).toBe(false);
		// ... fehlendes Feld erhaelt den bisherigen Standard an.
		const an = zeilen.find((z) => z.name === 'Ohne Feld');
		expect(an?.aktiv).toBe(true);

		// Der Sperrstatus folgt dem Aktivierungszustand: nur 'Ohne Feld' sperrt.
		const st = sperre.status();
		expect(st.gesperrt).toBe(true);
		expect(st.name).toBe('Ohne Feld');
	} finally {
		vi.useRealTimers();
	}
});

it('ungültige Sperrzeiten werden vor jeder Änderung vollständig abgelehnt', async () => {
	await vorbereitung();
	const anfang = verwaltet.protokoll.length;

	const bericht = (await post({
		action: 'wiederherstellen',
		inhalt: {
			sender: [],
			szenen: [],
			weckzeiten: [],
			sperrzeiten: [
				{ name: 'Tag Acht', tage: [1, 8], von: '20:00', bis: '06:30' },
				{ name: 'Krumme Minute', tage: [1], von: '20:5', bis: '06:30' },
				{ name: 'Stunde Fünfundzwanzig', tage: [1], von: '25:00' },
				{ name: 'Textschalter', tage: [1], tasten: 'ja', aktiv: 'wahr', stumm: true }
			]
		}
	})) as { daten: Record<string, any>; status: number };
	expect(bericht.status).toBe(400);
	expect(bericht.daten.ok).toBe(false);
	expect(bericht.daten.fehler.some((f: string) => f.includes('sperrzeiten[0].tage'))).toBe(true);
	expect(bericht.daten.fehler.some((f: string) => f.includes('sperrzeiten[1].von'))).toBe(true);
	expect(bericht.daten.fehler.some((f: string) => f.includes('sperrzeiten[2].von'))).toBe(true);
	expect(bericht.daten.fehler.some((f: string) => f.includes('sperrzeiten[3].tasten'))).toBe(true);
	expect(bericht.daten.fehler.some((f: string) => f.includes('sperrzeiten[3].aktiv'))).toBe(true);

	// Nichts geändert und nichts konvertiert.
	expect(verwaltet.protokoll).toHaveLength(anfang);
	expect((await import('../src/lib/server/sperre')).fensterListe()).toHaveLength(0);
});

it('gesperrter Import setzt Klang und Wiedergabeart am Gerät, aber keine Wiedergabe und keine Lautstärke', async () => {
	await vorbereitung();
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-10-16T10:00:00.000Z'));
	try {
		const sperre = await import('../src/lib/server/sperre');
		sperre.schnell(60);
		sperre.pinSetzen('1423');
		verwaltet.setze((ruf) => (ruf.action === 'ListAlarms' ? xmlMitListe(alarmListenXml([])) : { ok: true, values: {} }));

		// Ohne gültigen Code keinerlei Geraetebefehl.
		const abgelehnt = await post({ action: 'wiederherstellen', pin: '0000', inhalt: { klang: { bass: 4 } } });
		expect(abgelehnt.status).toBe(403);
		expect(verwaltet.protokoll.some((r) => r.action === 'SetBass')).toBe(false);

		// Gültiger Code: Klang landet trotz Sperre am Gerät.
		const bericht = (await post({
			action: 'wiederherstellen',
			pin: '1423',
			inhalt: {
				sender: [],
				szenen: [],
				weckzeiten: [],
				sperrzeiten: [],
				klang: { bass: 4, treble: -2, loudness: 1 },
				wiedergabeart: 'SHUFFLE'
			}
		})) as { daten: Record<string, any>; status: number };
		expect(bericht.status).toBe(200);
		const befehle = verwaltet.protokoll.filter((r) =>
			['SetBass', 'SetTreble', 'SetLoudness', 'SetPlayMode'].includes(r.action)
		);
		expect(befehle.find((r) => r.action === 'SetBass')?.args.DesiredBass).toBe(4);
		expect(befehle.find((r) => r.action === 'SetTreble')?.args.DesiredTreble).toBe(-2);
		expect(befehle.find((r) => r.action === 'SetLoudness')?.args.DesiredLoudness).toBe(1);
		expect(befehle.find((r) => r.action === 'SetPlayMode')?.args.NewPlayMode).toBe('SHUFFLE');
		// Keine Wiedergabe, keine Lautstärke über null, trotzdem Steuerung am Gerät.
		expect(verwaltet.protokoll.some((r) => r.action === 'Play')).toBe(false);
		expect(verwaltet.protokoll.some((r) => r.action === 'SetVolume' && Number(r.args.DesiredVolume) > 0)).toBe(false);

		// Geräteablehnungen laufen in den Bericht.
		verwaltet.setze((ruf) =>
			ruf.action === 'SetBass' ? { ok: false, errorCode: 501, values: {} } : { ok: true, values: {} }
		);
		const abgelehntAmGeraet = (await post({
			action: 'wiederherstellen',
			pin: '1423',
			inhalt: { sender: [], szenen: [], weckzeiten: [], sperrzeiten: [], klang: { bass: 5 } }
		})) as { daten: Record<string, any>; status: number };
		expect(abgelehntAmGeraet.status).toBe(200);
		expect(abgelehntAmGeraet.daten.teilweise).toBe(true);
		expect(abgelehntAmGeraet.daten.fehler.some((f: string) => f.startsWith('Klang bass'))).toBe(true);
	} finally {
		vi.useRealTimers();
	}
});

it.each([[], [null], [{ name: 'Keine Sicherung' }]].map((inhalt) => ({ inhalt })))(
	'eine gespeicherte Liste $inhalt wird ohne Änderungen als Sicherung abgelehnt',
	async ({ inhalt }) => {
		const { home: testOrdner, store } = await vorbereitung();
		const sicherungsOrdner = path.join(testOrdner, '.overtone', 'sicherungen');
		fs.mkdirSync(sicherungsOrdner, { recursive: true });
		fs.writeFileSync(path.join(sicherungsOrdner, 'ungueltig.json'), JSON.stringify(inhalt));
		const antwort = await post({ datei: 'ungueltig.json' });
		expect(antwort.status).toBe(400);
		expect(antwort.daten.ok).toBe(false);
		expect(verwaltet.protokoll).toHaveLength(0);
		expect(store.alarmRows()).toHaveLength(0);
		expect(store.sceneRows()).toHaveLength(0);
		expect((await import('../src/lib/server/sperre')).fensterListe()).toHaveLength(0);
		expect(fs.existsSync(zuHausePfad(testOrdner, 'stations.json'))).toBe(false);
	}
);

it('fehlgeleitete Anfragen bekommen HTTP 400 und berühren die jüngste Sicherung nicht', async () => {
	const { home, store } = await vorbereitung();
	// Eine vorhandene Sicherung macht den Rückgriff auf die jüngste Datei greifbar.
	const ordner = path.join(home, '.overtone', 'sicherungen');
	fs.mkdirSync(ordner, { recursive: true });
	fs.writeFileSync(
		path.join(ordner, 'overtone-20260101-000001.json'),
		JSON.stringify({
			erstellt: '2026-01-01T00:00:00.000Z',
			sender: [{ id: 'alt', name: 'Alt', url: 'https://alt.example.org/stream' }],
			szenen: [],
			weckzeiten: [{ time: '07:00:00', volume: 3, stationId: 'alt' }],
			sperrzeiten: []
		}),
		'utf8'
	);
	verwaltet.setze((ruf) => (ruf.action === 'ListAlarms' ? xmlMitListe(alarmListenXml([])) : ruf.action === 'CreateAlarm' ? { ok: true, values: { AssignedID: '77' } } : { ok: true, values: {} }));

	// Unlesbares JSON.
	const kaputt = await postRoh('kein-json');
	expect(kaputt.status).toBe(400);

	// Null, Listen und einfache Werte als Hauptwert.
	for (const anders of [null, [], 5, 'text']) {
		const r = await post(anders);
		expect(r.status).toBe(400);
		expect(String(r.daten.message)).toContain('Objekt');
	}

	// Optionale Felder in falschen Typen.
	expect((await post({ action: 5 })).status).toBe(400);
	expect((await post({ datei: [] })).status).toBe(400);
	expect((await post({ pin: true })).status).toBe(400);

	// Ausdrücklich vorhandenes, ungültiges inhalt löst den Rückgriff auf die
	// jüngste Sicherung ausdrücklich nicht aus.
	for (const schadLabel of [null, [], 'text', 5]) {
		const r = await post({ inhalt: schadLabel });
		expect(r.status).toBe(400);
	}

	// Nichts geändert: kein Import, keine Datensätze, keine Senderdatei.
	expect(verwaltet.protokoll.some((r) => r.action === 'CreateAlarm')).toBe(false);
	expect(store.alarmRows()).toHaveLength(0);
	expect(fs.existsSync(zuHausePfad(home, 'stations.json'))).toBe(false);

	// Ein gültiges leeres Objekt wählt weiterhin die jüngste Sicherung.
	const rueckgriff = await post({});
	expect(rueckgriff.status).toBe(200);
	expect(store.alarmRows().some((z) => z.time === '07:00:00')).toBe(true);
	expect(stationenLesen(home).map((s) => s.id)).toContain('alt');
});

function simuliereWeckzeiten() {
    const liste: Array<Record<string,string | number>> = [];
    let nummer = 100;
    let verlust = false;
    let ablehnen = false;
    verwaltet.setze(r => {
        if (r.action === 'ListAlarms') return xmlMitListe(alarmListenXml(liste));
        if (r.action === 'CreateAlarm') {
            if (ablehnen) return { ok: false, errorCode: 501, values: {} };
            const id = ++nummer;
            liste.push({ ID: id, StartTime: String(r.args.StartLocalTime), Duration: String(r.args.Duration), Recurrence: String(r.args.Recurrence), Enabled: r.args.Enabled, Volume: r.args.Volume, ProgramURI: String(r.args.ProgramURI) });
            if (verlust) throw new Error('Antwort nach erfolgreicher Anlage verloren');
            return { ok: true, values: { AssignedID: String(id) } };
        }
        return { ok: true, values: {} };
    });
    return { liste, verliereAntwort: () => { verlust = true; }, ablehnen: (wert: boolean) => { ablehnen = wert; } };
}
function neueSicherung() {
    return { version: 2, erstellt: '2026-10-16T10:00:00Z',
        sender: [{ id: 'sender-a', name: 'Sender A', url: 'https://radio.example/stream', herkunft: ['ursprung-sender'] }],
        szenen: [{ id: 1, name: 'Szene A', station_id: 'sender-a', volume: 15, herkunft: ['ursprung-szene'] }],
        weckzeiten: [{ id: 1, time: '07:00:00', stationId: 'sender-a', enabled: true, herkunft: ['ursprung-weckzeit'] }],
        sperrzeiten: [{ id: 1, name: 'Nacht A', tage: [1,2,3,4,5,6,7], von: '20:00', bis: '06:00', aktiv: true, herkunft: ['ursprung-sperrzeit'] }],
        klang: { bass: 4 }, wiedergabeart: 'SHUFFLE', sperreGlobal: false };
}
async function vorschau(quelle: unknown) {
    const r = await postDirekt({ action: 'vorpruefen', inhalt: quelle });
    expect(r.status).toBe(200); expect(r.daten.vorschau).toBe(true);
    return r.daten;
}
async function uebernehmen(quelle: unknown, vor?: Record<string,any>, entscheidungen: Record<string,string> = {}, optionen = {}) {
    const plan = vor ?? await vorschau(quelle);
    return postDirekt({ action: 'wiederherstellen', inhalt: quelle, token: plan.token, entscheidungen, optionen });
}

it('Vorprüfung verändert weder Einträge noch Senderdatei und sendet keine Schreibbefehle', async () => {
    const { home, store } = await vorbereitung(); simuliereWeckzeiten();
    const plan = await vorschau(neueSicherung());
    expect(plan.eintraege).toHaveLength(4);
    expect(store.sceneRows()).toHaveLength(0); expect(store.alarmRows()).toHaveLength(0); expect(store.sperrRows()).toHaveLength(0);
    expect(fs.existsSync(zuHausePfad(home,'stations.json'))).toBe(false);
    expect(verwaltet.protokoll.every(r => r.action === 'ListAlarms')).toBe(true);
    expect((await import('../src/lib/server/store')).store().prepare('SELECT COUNT(*) n FROM importe').get()).toEqual({ n: 0 });
});

it('Anwendung ohne aktuelle Vorprüfung ändert keine Einträge', async () => {
    const { store } = await vorbereitung(); simuliereWeckzeiten();
    expect((await postDirekt({ inhalt: neueSicherung() })).status).toBe(409);
    expect(store.sceneRows()).toHaveLength(0);
    expect(verwaltet.protokoll.some(r => r.action === 'CreateAlarm')).toBe(false);
});

it('neue Zeitpläne bleiben standardmäßig aus und Einstellungen unverändert', async () => {
    const { store } = await vorbereitung(); const geraet = simuliereWeckzeiten();
    const sperre = await import('../src/lib/server/sperre'); sperre.setzeGlobal(true);
    const r = await uebernehmen(neueSicherung()); expect(r.status).toBe(200); expect(r.daten.ok).toBe(true);
    expect(geraet.liste[0].Enabled).toBe(0); expect(store.sperrRows()[0].aktiv).toBe(0); expect(sperre.sperreGlobal()).toBe(true);
    expect(verwaltet.protokoll.some(r => ['SetBass','SetTreble','SetLoudness','SetPlayMode'].includes(r.action))).toBe(false);
});

it('Herkunft verhindert Duplikate über mehrere Sicherungen und nach einem Neustart', async () => {
    const { store } = await vorbereitung(); const geraet = simuliereWeckzeiten(); const quelle = neueSicherung();
    expect((await uebernehmen(quelle)).daten.angelegt).toEqual({ sender: 1, szenen: 1, weckzeiten: 1, sperrzeiten: 1 });
    vi.resetModules();
    const erneut = await uebernehmen({ ...quelle, erstellt: '2026-10-17T10:00:00Z' });
    expect(erneut.status).toBe(200); expect(erneut.daten.angelegt).toEqual({ sender: 0, szenen: 0, weckzeiten: 0, sperrzeiten: 0 });
    expect(geraet.liste).toHaveLength(1); expect(store.sceneRows()).toHaveLength(1); expect(store.sperrRows()).toHaveLength(1);
});

it('lokal geänderte Szenen und bewusst gelöschte Sperrzeiten bleiben nach Neustart erhalten', async () => {
    const { store } = await vorbereitung(); simuliereWeckzeiten(); const quelle = neueSicherung(); await uebernehmen(quelle);
    const speicher = await import('../src/lib/server/store');
    speicher.updateSceneRow(store.sceneRows()[0].id,{ name: 'Lokal geändert' });
    speicher.deleteSperreRow(store.sperrRows()[0].id);
    vi.resetModules();
    const plan = await vorschau(quelle);
    expect(plan.eintraege.find((e: any) => e.art === 'szenen').zustand).toBe('geaendert');
    expect(plan.eintraege.find((e: any) => e.art === 'sperrzeiten').zustand).toBe('geloescht');
    await uebernehmen(quelle,plan);
    expect(store.sceneRows()[0].name).toBe('Lokal geändert'); expect(store.sperrRows()).toHaveLength(0);
});

it('externe Dateiänderungen und fehlende Geräteweckzeiten benötigen eine Konfliktentscheidung', async () => {
    const { home } = await vorbereitung(); const geraet = simuliereWeckzeiten(); const quelle = neueSicherung(); await uebernehmen(quelle);
    const sender = stationenLesen(home); sender.find(s => s.id === 'sender-a')!.url = 'https://extern.example/stream'; stationenSchreiben(home,sender);
    geraet.liste.length = 0;
    const plan = await vorschau(quelle);
    expect(plan.eintraege.find((e: any) => e.art === 'sender').zustand).toBe('konflikt');
    expect(plan.eintraege.find((e: any) => e.art === 'weckzeiten').zustand).toBe('konflikt');
    expect((await uebernehmen(quelle,plan)).status).toBe(409);
    expect(geraet.liste).toHaveLength(0);
});

it('veraltete Vorschau wird vor Änderungen abgewiesen', async () => {
    const { store } = await vorbereitung(); simuliereWeckzeiten(); const quelle = neueSicherung();
    const plan = await vorschau(quelle);
    const s = await import('../src/lib/server/store'); s.insertScene({ name: 'Zwischenzeitlich', station_id: null, url: null, title: null, volume: null, bass: null, treble: null, loudness: null, play_mode: null, position: 0 });
    expect((await uebernehmen(quelle,plan)).status).toBe(409);
    expect(store.sceneRows()).toHaveLength(1); expect(store.alarmRows()).toHaveLength(0);
});

it('verlorene Geräteantwort bleibt nach Neustart ungeklärt und wird nicht automatisch wiederholt', async () => {
    const { store } = await vorbereitung(); const geraet = simuliereWeckzeiten(); geraet.verliereAntwort(); const quelle = neueSicherung();
    const r = await uebernehmen(quelle);
    expect(r.daten.ergebnisse.find((e: any) => e.art === 'weckzeiten').zustand).toBe('ungeklaert');
    expect(store.sceneRows()).toHaveLength(1); expect(geraet.liste).toHaveLength(1);
    vi.resetModules();
    const plan = await vorschau(quelle); const offen = plan.eintraege.find((e: any) => e.art === 'weckzeiten');
    expect(offen.zustand).toBe('ungeklaert');
    expect((await uebernehmen(quelle,plan)).status).toBe(409); expect(geraet.liste).toHaveLength(1);
    const zugeordnet = await uebernehmen(quelle,plan,{ [offen.schluessel]: `zuordnen:${(await import('../src/lib/server/alarms')).alarmKennung(geraet.liste[0].ID)}` });
    expect(zugeordnet.status).toBe(200); expect(geraet.liste).toHaveLength(1);
    expect((await vorschau(quelle)).eintraege.find((e: any) => e.art === 'weckzeiten').zustand).toBe('vorhanden');
});

it('eindeutige Geräteablehnung lässt sich erneut versuchen und bestätigt angelegte Teile bleiben einmalig', async () => {
    await vorbereitung(); const geraet = simuliereWeckzeiten(); geraet.ablehnen(true); const quelle = neueSicherung();
    expect((await uebernehmen(quelle)).daten.angelegt.weckzeiten).toBe(0);
    geraet.ablehnen(false);
    const r = await uebernehmen(quelle);
    expect(r.daten.angelegt).toEqual({ sender: 0, szenen: 0, weckzeiten: 1, sperrzeiten: 0 }); expect(geraet.liste).toHaveLength(1);
});

it('alte Sicherungen benötigen eine ausdrückliche Auswahl und behalten ihre Zuordnung bei Wiederholung', async () => {
    const { store } = await vorbereitung(); simuliereWeckzeiten();
    const quelle = { szenen: [{ name: 'Alte Szene' }] };
    const plan = await vorschau(quelle); expect(plan.alt).toBe(true);
    expect((await uebernehmen(quelle,plan)).status).toBe(409);
    const r = await uebernehmen(quelle,plan,{ [plan.eintraege[0].schluessel]: 'neu' }); expect(r.daten.angelegt.szenen).toBe(1);
    expect((await uebernehmen(JSON.parse(JSON.stringify(quelle,null,4)))).daten.angelegt.szenen).toBe(0);
    expect(store.sceneRows()).toHaveLength(1);
});

it('Exporte erhalten Herkunft über weitere Exporte und einen Neustart', async () => {
    await vorbereitung(); simuliereWeckzeiten(); await uebernehmen(neueSicherung());
    const modul = await import('../src/lib/server/wiederherstellung');
    const a = await modul.sicherungsInhalt() as any;
    vi.resetModules();
    const b = await (await import('../src/lib/server/wiederherstellung')).sicherungsInhalt() as any;
    expect(a.version).toBe(2); expect(a.szenen[0].herkunft).toContain('ursprung-szene'); expect(b.szenen[0].herkunft).toEqual(a.szenen[0].herkunft);
    expect(b.weckzeiten[0].herkunft).toContain('ursprung-weckzeit');
});

it.each([{ version: 3 }, { version: 2, szenen: [{ name: 'Ohne Herkunft' }] }, { version: 2, szenen: [{ name: 'A', herkunft: ['gleich'] }, { name: 'B', herkunft: ['gleich'] }] }])('unbekanntes Format oder unbrauchbare Herkunft wird vor Änderungen abgelehnt: %j', async quelle => {
    const { store } = await vorbereitung(); simuliereWeckzeiten();
    expect((await postDirekt({ action: 'vorpruefen', inhalt: quelle })).status).toBe(400);
    expect(store.sceneRows()).toHaveLength(0); expect(verwaltet.protokoll).toHaveLength(0);
});

it('bewusst übersprungene ungeklärte Geräteanlage bleibt als ungeklärt ausgewiesen', async () => {
    await vorbereitung(); const geraet = simuliereWeckzeiten(); geraet.verliereAntwort(); const quelle = neueSicherung(); await uebernehmen(quelle);
    const plan = await vorschau(quelle); const offen = plan.eintraege.find((e: any) => e.zustand === 'ungeklaert');
    const r = await uebernehmen(quelle,plan,{ [offen.schluessel]: 'ueberspringen' });
    expect(r.daten.ok).toBe(false); expect(r.daten.ergebnisse.find((e: any) => e.art === 'weckzeiten').zustand).toBe('ungeklaert'); expect(geraet.liste).toHaveLength(1);
});

it('beschädigte externe Senderdateien verhindern die Vorprüfung ohne Überschreiben', async () => {
    const { home } = await vorbereitung(); simuliereWeckzeiten();
    const datei = zuHausePfad(home,'stations.json'); fs.writeFileSync(datei,'unvollständige manuelle Änderung');
    expect((await postDirekt({ action: 'vorpruefen', inhalt: neueSicherung() })).status).toBe(503);
    expect(fs.readFileSync(datei,'utf8')).toBe('unvollständige manuelle Änderung');
});

it('gleiche Gerätenummer eines anderen Lautsprechers wird nicht als bekannte Herkunft behandelt', async () => {
    const { home } = await vorbereitung(); simuliereWeckzeiten(); const quelle = neueSicherung(); await uebernehmen(quelle);
    konfigSchreiben(home,{ host: '192.168.1.51', uuid: 'RINCON_ANDERS' }); vi.resetModules();
    const plan = await vorschau(quelle);
    expect(plan.eintraege.find((e: any) => e.art === 'weckzeiten').zustand).toBe('konflikt');
});

it('Datei mit gespeicherter Senderherkunft lässt sich nach unterbrochener Metadatenspeicherung zuordnen', async () => {
    const { home } = await vorbereitung(); simuliereWeckzeiten(); const quelle = neueSicherung();
    const speicher = await import('../src/lib/server/store');
    speicher.protokolliere('sender','ursprung-sender','offen');
    fs.writeFileSync(zuHausePfad(home,'stations.json'),JSON.stringify(quelle.sender));
    const plan = await vorschau(quelle);
    expect(plan.eintraege.find((e: any) => e.art === 'sender').zustand).toBe('vorhanden');
    const r = await uebernehmen(quelle,plan); expect(r.daten.angelegt.sender).toBe(0);
    expect(speicher.herkunftLesen('sender','ursprung-sender')?.lokal).toBe('sender-a');
    expect(speicher.importSchritt('sender','ursprung-sender')?.zustand).toBe('bestaetigt');
});

it('gleiche numerische Szenenkennung einer anderen Herkunft bleibt ein eigenständiger Eintrag', async () => {
    const { store } = await vorbereitung(); simuliereWeckzeiten();
    const quelle = neueSicherung(); quelle.weckzeiten = []; await uebernehmen(quelle);
    const andere = { version: 2, szenen: [{ id: 1, name: 'Andere Szene', herkunft: ['andere-installation'] }] };
    const r = await uebernehmen(andere); expect(r.daten.angelegt.szenen).toBe(1); expect(store.sceneRows()).toHaveLength(2);
});

it('historische Zuordnung eines vorhandenen Eintrags erhält beim Export eine gültige neue Herkunft', async () => {
    await vorbereitung(); simuliereWeckzeiten();
    const s = await import('../src/lib/server/store');
    const id = s.insertScene({ name: 'Vorhanden', station_id: null, url: null, title: null, volume: null, bass: null, treble: null, loudness: null, play_mode: null, position: 0 });
    s.store().prepare('DELETE FROM herkunft').run();
    const quelle = { szenen: [{ name: 'Vorhanden' }] }; const plan = await vorschau(quelle);
    await uebernehmen(quelle,plan,{ [plan.eintraege[0].schluessel]: `zuordnen:${id}` });
    const exportiert = await (await import('../src/lib/server/wiederherstellung')).sicherungsInhalt() as any;
    expect(exportiert.szenen[0].herkunft.length).toBeGreaterThan(0);
    expect(exportiert.szenen[0].herkunft.every((q: string) => !q.startsWith('alt:'))).toBe(true);
    expect((await postDirekt({ action: 'vorpruefen', inhalt: exportiert })).status).toBe(200);
});

it('gleichzeitige Wiederherstellungen senden keinen zweiten Geräteanlagebefehl', async () => {
    await vorbereitung();
    let gestartet!: () => void;
    const beginn = new Promise<void>(r => { gestartet = r; });
    let fortsetzen!: (r: any) => void;
    const antwort = new Promise(r => { fortsetzen = r; });
    verwaltet.setze(r => {
        if (r.action === 'ListAlarms') return xmlMitListe(alarmListenXml([]));
        if (r.action === 'CreateAlarm') { gestartet(); return antwort as never; }
        return { ok: true, values: {} };
    });
    const quelle = neueSicherung(); const plan = await vorschau(quelle);
    const erster = uebernehmen(quelle,plan); await beginn;
    expect((await postDirekt({ inhalt: quelle, token: plan.token })).status).toBe(409);
    fortsetzen({ ok: true, values: { AssignedID: '101' } }); expect((await erster).status).toBe(200);
    expect(verwaltet.protokoll.filter(r => r.action === 'CreateAlarm')).toHaveLength(1);
});

it('eine vor einer lokalen Transaktion unterbrochene Übernahme lässt sich ohne Duplikate fortsetzen', async () => {
    const { store } = await vorbereitung(); simuliereWeckzeiten();
    const quelle = { version: 2, szenen: [{ name: 'Noch nicht angelegt', herkunft: ['offene-lokale-szene'] }] };
    (await import('../src/lib/server/store')).protokolliere('szenen','offene-lokale-szene','offen'); vi.resetModules();
    const plan = await vorschau(quelle); expect(plan.eintraege[0].zustand).toBe('neu');
    expect((await uebernehmen(quelle,plan)).daten.angelegt.szenen).toBe(1);
    expect((await uebernehmen(quelle)).daten.angelegt.szenen).toBe(0); expect(store.sceneRows()).toHaveLength(1);
});

it.each([
    { sender: [{ id: 'gleich', name: 'A', url: 'https://a.example' }, { id: 'gleich', name: 'B', url: 'https://b.example' }] },
    { szenen: [{ name: 'Zu laut', volume: 500 }] },
    { szenen: [{ name: 'Ungültiger Klang', bass: 11 }] },
    { szenen: [{ name: 'Ungültiger Schalter', loudness: 2 }] }
])('mehrdeutige Senderbezüge und ungültige Szenenwerte werden vor Änderungen abgelehnt: %j', async quelle => {
    const { store } = await vorbereitung(); simuliereWeckzeiten();
    expect((await postDirekt({ action: 'vorpruefen', inhalt: quelle })).status).toBe(400);
    expect(store.sceneRows()).toHaveLength(0); expect(verwaltet.protokoll).toHaveLength(0);
});
