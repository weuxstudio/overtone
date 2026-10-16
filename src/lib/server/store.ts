// Local storage for alarms and scenes. Uses the built in SQLite of Node so the
// service keeps working without any extra dependency or service.

import fs from 'node:fs';
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

export function deleteAlarmRow(id: number): void {
	store().prepare('DELETE FROM alarms WHERE id = ?').run(id);
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
	return Number(info.lastInsertRowid);
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
}

export function deleteSceneRow(id: number): void {
	store().prepare('DELETE FROM scenes WHERE id = ?').run(id);
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
	return Number(info.lastInsertRowid);
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
}

export function deleteSperreRow(id: number): void {
	store().prepare('DELETE FROM sperren WHERE id = ?').run(id);
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
