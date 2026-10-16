import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { json } from '@sveltejs/kit';
import { loadStations, state } from '#lib/server/overtone';
import { createAlarm, listAlarms } from '#lib/server/alarms';
import { createScene, listScenes, readPlayMode, readSound } from '#lib/server/scenes';
import { anlegen, fensterListe, setzeGlobal, sperreGlobal } from '#lib/server/sperre';

const ORDNER = path.join(os.homedir(), '.overtone', 'sicherungen');

type Inhalt = {
	erstellt: string;
	sender: unknown[];
	szenen: ReturnType<typeof listScenes>;
	weckzeiten: Awaited<ReturnType<typeof listAlarms>>;
	sperrzeiten: ReturnType<typeof fensterListe>;
	sperreGlobal: boolean;
	klang: { bass: number | null; treble: number | null; loudness: number | null } | null;
	wiedergabeart: string | null;
};

function stempel(): string {
	const d = new Date();
	const z = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

// Alles, was in diesem Dienst entstanden ist, als eine Datei. Das Geraet selbst
// wird nur gelesen, nie beschrieben.
async function sammeln(): Promise<Inhalt> {
	return {
		erstellt: new Date().toISOString(),
		sender: (loadStations() as unknown[]) ?? [],
		szenen: listScenes(),
		weckzeiten: await listAlarms().catch(() => []),
		sperrzeiten: fensterListe(),
		sperreGlobal: sperreGlobal(),
		klang: await readSound().catch(() => null),
		wiedergabeart: await readPlayMode().catch(() => null)
	};
}

function neuesteDatei(): string | null {
	try {
		const dateien = fs
			.readdirSync(ORDNER)
			.filter((d) => d.endsWith('.json'))
			.sort();
		return dateien.length ? path.join(ORDNER, dateien[dateien.length - 1]) : null;
	} catch {
		return null;
	}
}

export async function GET({ url }) {
	const inhalt = await sammeln();
	fs.mkdirSync(ORDNER, { recursive: true });
	const datei = path.join(ORDNER, `overtone-${stempel()}.json`);
	fs.writeFileSync(datei, JSON.stringify(inhalt, null, 1), 'utf8');
	const kurz = url.searchParams.get('kurz') === '1';
	const lage = {
		ok: true,
		datei,
		erstellt: inhalt.erstellt,
		anzahl: {
			sender: inhalt.sender.length,
			szenen: inhalt.szenen.length,
			weckzeiten: inhalt.weckzeiten.length,
			sperrzeiten: inhalt.sperrzeiten.length
		},
		hinweis: `Sicherung geschrieben: ${path.basename(datei)}`
	};
	return json(kurz ? { ok: true, ...lage.anzahl } : lage);
}

export async function POST({ request }) {
	const body = (await request.json().catch(() => ({}))) as {
		action?: string;
		datei?: string;
		inhalt?: Partial<Inhalt>;
	};
	const aktion = String(body.action ?? 'wiederherstellen');

	if (aktion !== 'wiederherstellen') {
		return json({ ok: false, message: 'unbekannte Aktion' }, { status: 400 });
	}

	let inhalt = body.inhalt as Inhalt | undefined;
	if (!inhalt) {
		const datei = body.datei ? path.join(ORDNER, path.basename(String(body.datei))) : neuesteDatei();
		if (!datei || !fs.existsSync(datei)) {
			return json({ ok: false, message: 'Keine Sicherung gefunden.' }, { status: 404 });
		}
		try {
			inhalt = JSON.parse(fs.readFileSync(datei, 'utf8')) as Inhalt;
		} catch (fehler) {
			return json({ ok: false, message: `Sicherung nicht lesbar: ${fehler}` }, { status: 400 });
		}
	}

	const angelegt = { szenen: 0, weckzeiten: 0, sperrzeiten: 0 };
	const fehler: string[] = [];

	for (const sz of inhalt.szenen ?? []) {
		// Gespeicherte Sicherungen tragen die Feldnamen der Datenbank
		// (station_id, play_mode), die Eingabe erwartet stationId und playMode.
		// Deshalb beide Schreibweisen lesen, sonst geht der Sender verloren.
		const roh = sz as unknown as Record<string, unknown>;
		const sender = String(roh.stationId ?? roh.station_id ?? '');
		const art = String(roh.playMode ?? roh.play_mode ?? '');
		const r = await createScene({
			name: sz.name,
			...(sender ? { stationId: sender } : {}),
			...(typeof sz.volume === 'number' ? { volume: sz.volume } : {}),
			...(typeof sz.bass === 'number' ? { bass: sz.bass } : {}),
			...(typeof sz.treble === 'number' ? { treble: sz.treble } : {}),
			...(typeof sz.loudness === 'number' ? { loudness: sz.loudness } : {}),
			...(art ? { playMode: art } : {})
		});
		if (r.ok) angelegt.szenen += 1;
		else fehler.push(`Szene ${sz.name}: ${r.message ?? 'abgelehnt'}`);
	}

	for (const w of inhalt.weckzeiten ?? []) {
		const r = await createAlarm({
			time: w.time,
			...(w.recurrence ? { recurrence: w.recurrence } : {}),
			...(typeof w.volume === 'number' ? { volume: w.volume } : {}),
			...(w.stationId ? { stationId: w.stationId } : {}),
			...(w.duration ? { duration: w.duration } : {}),
			...(w.label ? { label: w.label } : {})
		});
		if (r.ok) angelegt.weckzeiten += 1;
		else fehler.push(`Weckzeit ${w.time}: ${r.message ?? 'abgelehnt'}`);
	}

	for (const s of inhalt.sperrzeiten ?? []) {
		if (s.einmalBis) continue; // Schnellsperren sind vergaenglich
		anlegen({ name: s.name, tage: s.tage, von: s.von, bis: s.bis, tasten: s.tasten, stumm: s.stumm });
		angelegt.sperrzeiten += 1;
	}

	if (typeof inhalt.sperreGlobal === 'boolean') setzeGlobal(inhalt.sperreGlobal);
	state.lastError = '';

	return json({
		ok: true,
		angelegt,
		fehler,
		hinweis: `Wiederhergestellt: ${angelegt.szenen} Szenen, ${angelegt.weckzeiten} Weckzeiten, ${angelegt.sperrzeiten} Sperrzeiten.`
	});
}
