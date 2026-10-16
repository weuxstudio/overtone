// Alarms live in the device itself, so they ring even when this service is off.
// We only keep a copy for the names and the chosen station.
// Measured on 96.0: StartLocalTime must be HH:MM:SS, a full date is rejected
// with error 402, and Recurrence only knows ONCE, DAILY, WEEKDAYS, WEEKENDS.

import { call, didlForHttpAudio, unescapeXml } from './sonos';
import { config, loadStations, resolveStream } from './overtone';
import { alarmRow, alarmRows, deleteAlarmRow, saveAlarm, type AlarmRow } from './store';

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
	if (!r.ok) return [];
	// The device answers with a list that is escaped once more, and the single
	// entries are written with &quot; as quote. Parsing the escaped text is the
	// only safe way: addresses inside carry slashes, ampersands and quotes.
	const block = r.xml.match(/<CurrentAlarmList>([\s\S]*?)<\/CurrentAlarmList>/);
	if (!block) return [];
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

function stationFor(stationId?: string | null, uri?: string) {
	const list = loadStations();
	if (stationId) {
		const hit = list.find((s) => s.id === stationId);
		if (hit) return hit;
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
			const station = stationFor(row?.station_id, a.ProgramURI);
			return {
				id,
				time: a.StartTime ?? '',
				duration: a.Duration ?? '',
				recurrence: a.Recurrence ?? 'ONCE',
				enabled: a.Enabled === '1',
				volume: Number(a.Volume ?? row?.volume ?? 10),
				stationId: station?.id ?? row?.station_id ?? '',
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
): Promise<{ ok: boolean; id?: number; message?: string }> {
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
	if (!neueId) return { ok: false, message: 'keine Nummer zurueckgegeben' };
	return { ok: true, id: neueId };
}

export async function createAlarm(input: AlarmInput): Promise<{ ok: boolean; message?: string }> {
	const zeit = clock(input.time);
	const station = stationFor(input.stationId);
	if (!station) return { ok: false, message: 'Sender unbekannt' };
	// The stable station address is stored, not the resolved one: resolved
	// addresses often carry a token that expires before the alarm rings.
	const volumen = Math.min(60, Math.max(0, Number(input.volume ?? 10)));
	const antwort = await writeAlarm(null, {
		time: zeit,
		duration: input.duration ?? '00:30:00',
		recurrence: (RECURRENCE as readonly string[]).includes(input.recurrence ?? '')
			? String(input.recurrence)
			: 'ONCE',
		enabled: true,
		uri: station.url,
		metadata: didlForHttpAudio(station.url, station.name),
		volume: volumen
	});
	if (!antwort.ok || !antwort.id) return { ok: false, message: antwort.message };
	saveAlarm({
		id: antwort.id,
		time: zeit,
		duration: input.duration ?? '00:30:00',
		recurrence: String(input.recurrence ?? 'ONCE'),
		enabled: 1,
		station_id: station.id,
		volume: volumen,
		label: input.label ?? station.name
	});
	return { ok: true };
}

export async function updateAlarm(id: number, input: Partial<AlarmInput>): Promise<{ ok: boolean; message?: string }> {
	const geraet = await deviceAlarmById(id);
	if (!geraet) return { ok: false, message: 'Weckzeit gibt es am Geraet nicht mehr' };
	const row = alarmRow(id);
	const station = stationFor(input.stationId ?? row?.station_id, geraet.ProgramURI);
	if (!station) return { ok: false, message: 'Sender unbekannt' };
	const ziel = await resolveStream(station.url);
	const zeit = input.time ? clock(input.time) : (geraet.StartTime ?? '07:00:00');
	const dauer = input.duration ?? geraet.Duration ?? '00:30:00';
	const wiederholung = input.recurrence ?? geraet.Recurrence ?? 'ONCE';
	const volumen = Math.min(60, Math.max(0, Number(input.volume ?? geraet.Volume ?? 10)));
	const antwort = await writeAlarm(id, {
		time: zeit,
		duration: dauer,
		recurrence: wiederholung,
		enabled: geraet.Enabled === '1',
		uri: ziel,
		metadata: didlForHttpAudio(ziel, station.name),
		volume: volumen
	});
	if (!antwort.ok) return { ok: false, message: antwort.message };
	saveAlarm({
		id,
		time: zeit,
		duration: dauer,
		recurrence: wiederholung,
		enabled: geraet.Enabled === '1' ? 1 : 0,
		station_id: station.id,
		volume: volumen,
		label: input.label ?? row?.label ?? station.name
	});
	return { ok: true };
}

export async function setAlarmEnabled(id: number, an: boolean): Promise<{ ok: boolean; message?: string }> {
	const geraet = await deviceAlarmById(id);
	if (!geraet) return { ok: false, message: 'Weckzeit gibt es am Geraet nicht mehr' };
	const row = alarmRow(id);
	const station = stationFor(row?.station_id, geraet.ProgramURI);
	const ziel = station ? await resolveStream(station.url) : '';
	const antwort = await writeAlarm(id, {
		time: geraet.StartTime ?? '07:00:00',
		duration: geraet.Duration ?? '00:30:00',
		recurrence: geraet.Recurrence ?? 'ONCE',
		enabled: an,
		uri: ziel || geraet.ProgramURI || '',
		metadata: station ? didlForHttpAudio(ziel, station.name) : (geraet.ProgramMetaData ?? ''),
		volume: Number(geraet.Volume ?? 10)
	});
	if (!antwort.ok) return { ok: false, message: antwort.message };
	if (row) saveAlarm({ ...row, enabled: an ? 1 : 0 });
	return { ok: true };
}

export async function deleteAlarm(id: number): Promise<{ ok: boolean; message?: string }> {
	const res = await call(config.host, 'AlarmClock', 'DestroyAlarm', { ID: id });
	deleteAlarmRow(id);
	if (!res.ok) return { ok: false, message: `Geraet hat abgelehnt (${res.errorCode ?? 'ohne Code'})` };
	return { ok: true };
}
