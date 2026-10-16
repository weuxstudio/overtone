// Alarms live in the device itself, so they ring even when this service is off.
// We only keep a copy for the names and the chosen station.
// Measured on 96.0: StartLocalTime must be HH:MM:SS, a full date is rejected
// with error 402, and Recurrence only knows ONCE, DAILY, WEEKDAYS, WEEKENDS.

import { call, didlForHttpAudio, unescapeXml } from './sonos';
import { config, loadStations } from './overtone';
import { alarmRow, alarmRows, deleteAlarmRow, saveAlarm, type AlarmRow, registriereHerkunft, pflegeHerkunft, zuordnen, protokolliere, transaktion } from './store';

export function alarmKennung(id: number | string): string { return `${config.uuid || config.host}/${id}`; }

export const RECURRENCE = ['ONCE', 'DAILY', 'WEEKDAYS', 'WEEKENDS'] as const;
export type Recurrence = (typeof RECURRENCE)[number];

export type Alarm = {
	id: number;
	time: string;
	duration: string;
	recurrence: string;
	enabled: boolean;
	volume: number;
	stationId: string;
	stationName: string;
	title: string;
	uri: string;
	label: string;
};

export type AlarmInput = {
	time: string;
	recurrence?: string;
	volume?: number;
	stationId?: string;
	duration?: string;
	label?: string;
	// Ohne Angabe bleiben neu angelegte Weckzeiten wie bisher aktiviert.
	enabled?: boolean;
};

function clock(value: string): string {
	// Accept 6:30 as well as 06:30 and 06:30:00.
	const parts = String(value).trim().split(':');
	if (parts.length < 2) return '07:00:00';
	const h = String(Math.min(23, Math.max(0, Number(parts[0]) || 0))).padStart(2, '0');
	const m = String(Math.min(59, Math.max(0, Number(parts[1]) || 0))).padStart(2, '0');
	return `${h}:${m}:00`;
}

// The device list is fetched through the shared SOAP client.

let stoerung = '';

// Ist die Box aus, wirft der Aufruf. Dann bleibt die Liste leer und die
// Stoerung wird gemeldet, statt einen Fehler 500 zu erzeugen.
export function alarmStoerung(): string {
	return stoerung;
}

async function fetchAlarmList(): Promise<Array<Record<string, string>>> {
	let r: Awaited<ReturnType<typeof call>>;
	try {
		r = await call(config.host, 'AlarmClock', 'ListAlarms', {});
		stoerung = '';
	} catch {
		stoerung = 'Der Lautsprecher antwortet nicht. Ist er eingeschaltet und im Netz?';
		return [];
	}
	if (!r.ok) { stoerung = 'Weckzeiten konnten nicht gelesen werden.'; return []; }
	// The device answers with a list that is escaped once more, and the single
	// entries are written with &quot; as quote. Parsing the escaped text is the
	// only safe way: addresses inside carry slashes, ampersands and quotes.
	const block = (r.xml ?? '').match(/<CurrentAlarmList>([\s\S]*?)<\/CurrentAlarmList>/);
	if (!block) { stoerung = 'Die Weckzeitenantwort ist unvollständig.'; return []; }
	const out: Array<Record<string, string>> = [];
	for (const teil of block[1].split('&lt;Alarm ').slice(1)) {
		const ecke = teil.indexOf('/&gt;');
		const kante = teil.indexOf('&gt;');
		const ende = ecke >= 0 && (kante < 0 || ecke < kante) ? ecke : kante;
		const kopf = ende >= 0 ? teil.slice(0, ende) : teil;
		const felder: Record<string, string> = {};
		const attr = /([A-Za-z]+)=&quot;([\s\S]*?)&quot;/g;
		let a: RegExpExecArray | null;
		while ((a = attr.exec(kopf))) felder[a[1]] = unescapeXml(a[2]);
		if (Object.keys(felder).length) out.push(felder);
	}
	return out;
}

function stationFor(stationId?: string | null, uri?: string, streng = false) {
	const list = loadStations();
	if (stationId) {
		const hit = list.find((s) => s.id === stationId);
		if (hit && (!streng || !uri || uri.startsWith(hit.url.slice(0,40)))) return hit;
	}
	if (uri) {
		const hit = list.find((s) => uri.startsWith(s.url.slice(0, 40)));
		if (hit) return hit;
	}
	return undefined;
}

export async function listAlarms(): Promise<Alarm[]> {
	const geraet = await fetchAlarmList();
	const bekannt = new Map(alarmRows().map((row) => [row.id, row]));
	return geraet
		.map((a) => {
			const id = Number(a.ID ?? 0);
			const row = bekannt.get(id);
			const station = stationFor(row?.station_id, a.ProgramURI, true);
			return {
				id,
				time: a.StartTime ?? '',
				duration: a.Duration ?? '',
				recurrence: a.Recurrence ?? 'ONCE',
				enabled: a.Enabled === '1',
				volume: Number(a.Volume ?? row?.volume ?? 10),
				stationId: station?.id ?? (!a.ProgramURI ? row?.station_id : '') ?? '',
				stationName: station?.name ?? '',
				title: station?.name ?? row?.label ?? '',
				uri: a.ProgramURI ?? '',
				label: row?.label ?? ''
			};
		})
		.sort((x, y) => x.time.localeCompare(y.time));
}

async function deviceAlarmById(id: number): Promise<Record<string, string> | undefined> {
	const alle = await fetchAlarmList();
	return alle.find((a) => Number(a.ID ?? 0) === id);
}

async function writeAlarm(
	id: number | null,
	values: {
		time: string;
		duration: string;
		recurrence: string;
		enabled: boolean;
		uri: string;
		metadata: string;
		volume: number;
	}
): Promise<{ ok: boolean; id?: number; message?: string; ungeklaert?: boolean }> {
	const basis: Record<string, string | number> = {
		StartLocalTime: values.time,
		Duration: values.duration,
		Recurrence: values.recurrence,
		Enabled: values.enabled ? 1 : 0,
		RoomUUID: config.uuid,
		ProgramURI: values.uri,
		ProgramMetaData: values.metadata,
		PlayMode: 'NORMAL',
		Volume: values.volume,
		IncludeLinkedZones: 0
	};
	const res =
		id === null
			? await call(config.host, 'AlarmClock', 'CreateAlarm', basis)
			: await call(config.host, 'AlarmClock', 'UpdateAlarm', { ID: id, ...basis });
	if (!res.ok) {
		return { ok: false, message: `Geraet hat abgelehnt (${res.errorCode ?? 'ohne Code'})` };
	}
	const neueId = id ?? Number(res.values.AssignedID ?? 0);
	if (!neueId) return { ok: false, message: 'Keine Gerätenummer erhalten. Ergebnis ungeklärt.', ungeklaert: true };
	return { ok: true, id: neueId };
}

export async function createAlarm(input: AlarmInput, quellen: string[] = []): Promise<{ ok: boolean; id?: number; message?: string; ungeklaert?: boolean }> {
	const zeit = clock(input.time);
	const station = stationFor(input.stationId);
	if (!station) return { ok: false, message: 'Sender unbekannt' };
	// The stable station address is stored, not the resolved one: resolved
	// addresses often carry a token that expires before the alarm rings.
	const aktiviert = input.enabled === undefined || !!input.enabled;
	const volumen = input.volume === undefined || input.volume === null ? 10 : Math.min(60, Math.max(0, Number(input.volume)));
	const antwort = await writeAlarm(null, {
		time: zeit,
		duration: input.duration ?? '00:30:00',
		recurrence: (RECURRENCE as readonly string[]).includes(input.recurrence ?? '')
			? String(input.recurrence)
			: 'ONCE',
		enabled: aktiviert,
		uri: station.url,
		metadata: didlForHttpAudio(station.url, station.name),
		volume: volumen
	});
	if (!antwort.ok || !antwort.id) return { ok: false, message: antwort.message, ungeklaert: antwort.ungeklaert };
	transaktion(() => {
	saveAlarm({
		id: antwort.id!,
		time: zeit,
		duration: input.duration ?? '00:30:00',
		recurrence: String(input.recurrence ?? 'ONCE'),
		enabled: aktiviert ? 1 : 0,
		station_id: station.id,
		volume: volumen,
		label: input.label ?? station.name
	});
    const werte = { ...alarmRow(antwort.id!), enabled: aktiviert, uri: station.url };
    registriereHerkunft('weckzeiten', alarmKennung(antwort.id!), werte);
    if (quellen.length) {
        zuordnen('weckzeiten', quellen, alarmKennung(antwort.id!), werte);
        for (const quelle of quellen) protokolliere('weckzeiten', quelle, 'bestaetigt', [], alarmKennung(antwort.id!));
    }
    });
    return { ok: true, id: antwort.id };
}

export async function updateAlarm(id: number, input: Partial<AlarmInput>): Promise<{ ok: boolean; message?: string }> {
	const geraet = await deviceAlarmById(id);
	if (!geraet) return { ok: false, message: 'Weckzeit gibt es am Geraet nicht mehr' };
	const row = alarmRow(id);
	const station = stationFor(input.stationId ?? row?.station_id, geraet.ProgramURI);
	// Auch beim Bearbeiten gilt die stabile Senderadresse, nicht die
	// aufgeloeste Adresse: aufgeloeste Adressen tragen oft ein Token, das
	// ablaeuft, bevor der Wecker klingelt.
	// Zählt der Sender hier nicht mehr, bleiben die vorhandene Geräteadresse
	// und ihre Metadaten unangetastet.
	const zeit = input.time ? clock(input.time) : (geraet.StartTime ?? '07:00:00');
	const dauer = input.duration ?? geraet.Duration ?? '00:30:00';
	const wiederholung = input.recurrence ?? geraet.Recurrence ?? 'ONCE';
	const volumen = Math.min(60, Math.max(0, Number(input.volume ?? geraet.Volume ?? 10)));
	const antwort = await writeAlarm(id, {
		time: zeit,
		duration: dauer,
		recurrence: wiederholung,
		enabled: geraet.Enabled === '1',
		uri: station ? station.url : (geraet.ProgramURI ?? ''),
		metadata: station
			? didlForHttpAudio(station.url, station.name)
			: (geraet.ProgramMetaData ?? ''),
		volume: volumen
	});
	if (!antwort.ok) return { ok: false, message: antwort.message };
	saveAlarm({
		id,
		time: zeit,
		duration: dauer,
		recurrence: wiederholung,
		enabled: geraet.Enabled === '1' ? 1 : 0,
		station_id: station?.id ?? row?.station_id ?? '',
		volume: volumen,
		label: input.label ?? row?.label ?? (station?.name ?? '')
	});
	pflegeHerkunft('weckzeiten', alarmKennung(id), { ...alarmRow(id), enabled: geraet.Enabled === '1', uri: station?.url ?? geraet.ProgramURI ?? '' });
	return { ok: true };
}

export async function setAlarmEnabled(id: number, an: boolean): Promise<{ ok: boolean; message?: string }> {
	const geraet = await deviceAlarmById(id);
	if (!geraet) return { ok: false, message: 'Weckzeit gibt es am Geraet nicht mehr' };
	const row = alarmRow(id);
	const station = stationFor(row?.station_id, geraet.ProgramURI);
	const antwort = await writeAlarm(id, {
		time: geraet.StartTime ?? '07:00:00',
		duration: geraet.Duration ?? '00:30:00',
		recurrence: geraet.Recurrence ?? 'ONCE',
		enabled: an,
		// Umschalten tastet die gespeicherte Adresse nicht an: stabile
		// Senderadresse bleibt, ein unbekannter Sender behaelt die
		// vorhandene Geräteadresse samt Metadaten.
		uri: station ? station.url : (geraet.ProgramURI ?? ''),
		metadata: station
			? didlForHttpAudio(station.url, station.name)
			: (geraet.ProgramMetaData ?? ''),
		volume: Number(geraet.Volume ?? 10)
	});
	if (!antwort.ok) return { ok: false, message: antwort.message };
	if (row) saveAlarm({ ...row, enabled: an ? 1 : 0 });
	pflegeHerkunft('weckzeiten', alarmKennung(id), { ...row, time: geraet.StartTime, duration: geraet.Duration, recurrence: geraet.Recurrence, volume: Number(geraet.Volume ?? 10), enabled: an, uri: station?.url ?? geraet.ProgramURI ?? '' });
	return { ok: true };
}

export async function deleteAlarm(id: number): Promise<{ ok: boolean; message?: string }> {
	const res = await call(config.host, 'AlarmClock', 'DestroyAlarm', { ID: id });
	// Der lokale Datensatz geht erst weg, wenn der Lautsprecher die Löschung
	// bestätigt hat.
	if (!res.ok) return { ok: false, message: `Geraet hat abgelehnt (${res.errorCode ?? 'ohne Code'})` };
	deleteAlarmRow(id, alarmKennung(id));
	return { ok: true };
}
