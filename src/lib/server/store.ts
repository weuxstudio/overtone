// Local storage for alarms and scenes. Uses the built in SQLite of Node so the
// service keeps working without any extra dependency or service.

import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DIR = path.join(os.homedir(), '.overtone');
const FILE = path.join(DIR, 'overtone.db');

let handle: DatabaseSync | null = null;

export function store(): DatabaseSync {
	if (handle) return handle;
	fs.mkdirSync(DIR, { recursive: true });
	handle = new DatabaseSync(FILE);
	handle.exec(`
		PRAGMA journal_mode = WAL;
		CREATE TABLE IF NOT EXISTS alarms (
			id INTEGER PRIMARY KEY,
			time TEXT NOT NULL,
			duration TEXT NOT NULL,
			recurrence TEXT NOT NULL,
			enabled INTEGER NOT NULL DEFAULT 1,
			station_id TEXT,
			volume INTEGER NOT NULL DEFAULT 10,
			label TEXT
		);
		CREATE TABLE IF NOT EXISTS scenes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			station_id TEXT,
			url TEXT,
			title TEXT,
			volume INTEGER,
			bass INTEGER,
			treble INTEGER,
			loudness INTEGER,
			play_mode TEXT,
			position INTEGER NOT NULL DEFAULT 0
		);
		CREATE TABLE IF NOT EXISTS sperren (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL DEFAULT 'Sperrzeit',
			tage TEXT NOT NULL DEFAULT '',
			von TEXT NOT NULL DEFAULT '20:00',
			bis TEXT NOT NULL DEFAULT '06:30',
			aktiv INTEGER NOT NULL DEFAULT 1,
			tasten INTEGER NOT NULL DEFAULT 1,
			stumm INTEGER NOT NULL DEFAULT 1,
			einmal_bis TEXT NOT NULL DEFAULT ''
		);
		CREATE TABLE IF NOT EXISTS herkunft (
            art TEXT NOT NULL, quelle TEXT NOT NULL, lokal TEXT NOT NULL,
            basis TEXT NOT NULL, geloescht INTEGER NOT NULL DEFAULT 0,
            geaendert INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (art, quelle)
        );
        CREATE TABLE IF NOT EXISTS importe (
            art TEXT NOT NULL, quelle TEXT NOT NULL, zustand TEXT NOT NULL,
            vorher TEXT NOT NULL DEFAULT '[]', lokal TEXT, PRIMARY KEY (art, quelle)
        );
        CREATE TABLE IF NOT EXISTS einstellungen (
			schluessel TEXT PRIMARY KEY,
			wert TEXT NOT NULL
		);
	`);
	return handle;
}

export type SperrRow = {
	id: number;
	name: string;
	tage: string;
	von: string;
	bis: string;
	aktiv: number;
	tasten: number;
	stumm: number;
	einmal_bis: string;
};

export type AlarmRow = {
	id: number;
	time: string;
	duration: string;
	recurrence: string;
	enabled: number;
	station_id: string | null;
	volume: number;
	label: string | null;
};

export type SceneRow = {
	id: number;
	name: string;
	station_id: string | null;
	url: string | null;
	title: string | null;
	volume: number | null;
	bass: number | null;
	treble: number | null;
	loudness: number | null;
	play_mode: string | null;
	position: number;
};

export function saveAlarm(row: AlarmRow): void {
	store()
		.prepare(
			`INSERT INTO alarms (id, time, duration, recurrence, enabled, station_id, volume, label)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET time = excluded.time, duration = excluded.duration,
			 recurrence = excluded.recurrence, enabled = excluded.enabled,
			 station_id = excluded.station_id, volume = excluded.volume, label = excluded.label`
		)
		.run(row.id, row.time, row.duration, row.recurrence, row.enabled, row.station_id, row.volume, row.label);
}

export function deleteAlarmRow(id: number, kennung: string | number = id): void {
	transaktion(() => { loeschvermerk('weckzeiten', kennung); store().prepare('DELETE FROM alarms WHERE id = ?').run(id); });
}

export function alarmRows(): AlarmRow[] {
	return store().prepare('SELECT * FROM alarms ORDER BY time').all() as unknown as AlarmRow[];
}

export function alarmRow(id: number): AlarmRow | undefined {
	return store().prepare('SELECT * FROM alarms WHERE id = ?').get(id) as unknown as AlarmRow | undefined;
}

export function sceneRows(): SceneRow[] {
	return store().prepare('SELECT * FROM scenes ORDER BY position, id').all() as unknown as SceneRow[];
}

export function sceneRow(id: number): SceneRow | undefined {
	return store().prepare('SELECT * FROM scenes WHERE id = ?').get(id) as unknown as SceneRow | undefined;
}

export function insertScene(row: Omit<SceneRow, 'id'>): number {
	const info = store()
		.prepare(
			`INSERT INTO scenes (name, station_id, url, title, volume, bass, treble, loudness, play_mode, position)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(row.name, row.station_id, row.url, row.title, row.volume, row.bass, row.treble, row.loudness, row.play_mode, row.position);
	const id = Number(info.lastInsertRowid);
	registriereHerkunft('szenen', id, sceneRow(id));
	return id;
}

export function updateSceneRow(id: number, row: Partial<Omit<SceneRow, 'id'>>): void {
	const current = sceneRow(id);
	if (!current) return;
	const next = { ...current, ...row };
	store()
		.prepare(
			`UPDATE scenes SET name = ?, station_id = ?, url = ?, title = ?, volume = ?, bass = ?, treble = ?,
			 loudness = ?, play_mode = ?, position = ? WHERE id = ?`
		)
		.run(next.name, next.station_id, next.url, next.title, next.volume, next.bass, next.treble, next.loudness, next.play_mode, next.position, id);
	pflegeHerkunft('szenen', id, sceneRow(id));
}

export function deleteSceneRow(id: number): void {
	transaktion(() => { loeschvermerk('szenen', id); store().prepare('DELETE FROM scenes WHERE id = ?').run(id); });
}

// ------------------------------------------------------- Kindersicherung

export function sperrRows(): SperrRow[] {
	return store().prepare('SELECT * FROM sperren ORDER BY id').all() as unknown as SperrRow[];
}

export function sperrRow(id: number): SperrRow | undefined {
	return store().prepare('SELECT * FROM sperren WHERE id = ?').get(id) as unknown as SperrRow | undefined;
}

export function insertSperre(row: Omit<SperrRow, 'id'>): number {
	const info = store()
		.prepare(
			`INSERT INTO sperren (name, tage, von, bis, aktiv, tasten, stumm, einmal_bis)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(row.name, row.tage, row.von, row.bis, row.aktiv, row.tasten, row.stumm, row.einmal_bis);
	const id = Number(info.lastInsertRowid);
	if (!row.einmal_bis) registriereHerkunft('sperrzeiten', id, sperrRow(id));
	return id;
}

export function updateSperre(id: number, row: Partial<Omit<SperrRow, 'id'>>): void {
	const current = sperrRow(id);
	if (!current) return;
	const next = { ...current, ...row };
	store()
		.prepare(
			`UPDATE sperren SET name = ?, tage = ?, von = ?, bis = ?, aktiv = ?, tasten = ?, stumm = ?,
			 einmal_bis = ? WHERE id = ?`
		)
		.run(next.name, next.tage, next.von, next.bis, next.aktiv, next.tasten, next.stumm, next.einmal_bis, id);
	if (!next.einmal_bis) pflegeHerkunft('sperrzeiten', id, sperrRow(id));
}

export function deleteSperreRow(id: number): void {
	transaktion(() => {
		if (!sperrRow(id)?.einmal_bis) loeschvermerk('sperrzeiten', id);
		store().prepare('DELETE FROM sperren WHERE id = ?').run(id);
	});
}

export function einstellung(schluessel: string): string | undefined {
	const row = store().prepare('SELECT wert FROM einstellungen WHERE schluessel = ?').get(schluessel) as
		| { wert: string }
		| undefined;
	return row?.wert;
}

export function setzeEinstellung(schluessel: string, wert: string): void {
	store()
		.prepare(
			`INSERT INTO einstellungen (schluessel, wert) VALUES (?, ?)
			 ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert`
		)
		.run(schluessel, wert);
}

export function loescheEinstellung(schluessel: string): void {
	store().prepare('DELETE FROM einstellungen WHERE schluessel = ?').run(schluessel);
}


export type Herkunftsart = 'sender' | 'szenen' | 'weckzeiten' | 'sperrzeiten';
export type Herkunft = { art: Herkunftsart; quelle: string; lokal: string; basis: string; geloescht: number; geaendert: number };
export type Importschritt = { art: Herkunftsart; quelle: string; zustand: 'offen' | 'bestaetigt' | 'fehlgeschlagen'; vorher: string; lokal: string | null };

function sortiert(wert: unknown): unknown {
    if (Array.isArray(wert)) return wert.map(sortiert);
    if (wert && typeof wert === 'object') return Object.fromEntries(Object.entries(wert).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => [k, sortiert(v)]));
    return wert;
}
export function signatur(wert: unknown): string {
    return createHash('sha256').update(JSON.stringify(sortiert(wert)) ?? 'null').digest('hex');
}
// Only domain values, never presentation names or local database identifiers.
export function vergleichswerte(art: Herkunftsart, roh: unknown): Record<string, unknown> {
    const r = (roh ?? {}) as Record<string, any>;
    if (art === 'sender') return { name: r.name, url: r.url };
    if (art === 'szenen') return { name: r.name, station: r.station_id ?? r.stationId ?? '', url: r.url ?? null, title: r.title ?? null, volume: r.volume ?? null, bass: r.bass ?? null, treble: r.treble ?? null, loudness: r.loudness ?? null, play_mode: r.play_mode ?? r.playMode ?? null };
    if (art === 'weckzeiten') return { time: r.time, duration: r.duration || '00:30:00', recurrence: r.recurrence || 'ONCE', enabled: !!r.enabled, volume: r.volume ?? 10, uri: r.uri ?? '', label: r.label ?? '' };
    return { name: r.name, tage: typeof r.tage === 'string' ? r.tage.split(',').filter(Boolean).map(Number).sort() : [...(r.tage ?? [])].sort(), von: r.von ?? '20:00', bis: r.bis ?? '06:30', aktiv: !!r.aktiv, tasten: r.tasten !== false && r.tasten !== 0, stumm: r.stumm !== false && r.stumm !== 0 };
}
export function datenSignatur(art: Herkunftsart, wert: unknown): string { return signatur(vergleichswerte(art, wert)); }
export function herkunftListe(art: Herkunftsart, lokal: string | number): Herkunft[] {
    return store().prepare('SELECT * FROM herkunft WHERE art = ? AND lokal = ? AND geloescht = 0 ORDER BY rowid').all(art, String(lokal)) as unknown as Herkunft[];
}
export function herkunftLesen(art: Herkunftsart, quelle: string): Herkunft | undefined {
    return store().prepare('SELECT * FROM herkunft WHERE art = ? AND quelle = ?').get(art, quelle) as Herkunft | undefined;
}
export function zuordnen(art: Herkunftsart, quellen: string[], lokal: string | number, wert: unknown): void {
    for (const quelle of quellen) store().prepare(`INSERT INTO herkunft (art, quelle, lokal, basis) VALUES (?, ?, ?, ?)
        ON CONFLICT(art, quelle) DO UPDATE SET lokal = excluded.lokal, basis = excluded.basis, geloescht = 0, geaendert = 0`).run(art, quelle, String(lokal), datenSignatur(art, wert));
}
export function registriereHerkunft(art: Herkunftsart, lokal: string | number, wert: unknown): string[] {
    let rows = herkunftListe(art, lokal);
    if (!rows.some(r => !r.quelle.startsWith('alt:'))) { zuordnen(art, [randomUUID()], lokal, wert); rows = herkunftListe(art, lokal); }
    return rows.map(r => r.quelle);
}
export function pflegeHerkunft(art: Herkunftsart, lokal: string | number, wert: unknown): void {
    registriereHerkunft(art, lokal, wert);
    store().prepare('UPDATE herkunft SET basis = ?, geaendert = 1 WHERE art = ? AND lokal = ? AND geloescht = 0').run(datenSignatur(art, wert), art, String(lokal));
}
export function loeschvermerk(art: Herkunftsart, lokal: string | number): void {
    store().prepare('UPDATE herkunft SET geloescht = 1 WHERE art = ? AND lokal = ?').run(art, String(lokal));
}
export function importSchritt(art: Herkunftsart, quelle: string): Importschritt | undefined {
    return store().prepare('SELECT * FROM importe WHERE art = ? AND quelle = ?').get(art, quelle) as Importschritt | undefined;
}
export function protokolliere(art: Herkunftsart, quelle: string, zustand: Importschritt['zustand'], vorher: unknown = [], lokal?: string | number): void {
    store().prepare(`INSERT INTO importe (art, quelle, zustand, vorher, lokal) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(art, quelle) DO UPDATE SET zustand = excluded.zustand, vorher = excluded.vorher, lokal = excluded.lokal`).run(art, quelle, zustand, JSON.stringify(vorher), lokal === undefined ? null : String(lokal));
}
export function transaktion<T>(aktion: () => T): T {
    const db = store(); db.exec('BEGIN IMMEDIATE');
    try { const wert = aktion(); db.exec('COMMIT'); return wert; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
}
