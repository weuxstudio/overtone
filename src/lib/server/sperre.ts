// Kindersicherung: Sperrzeiten, Code und Zustand.
// Sperren liegen lokal in der Ablage, die Durchsetzung am Geraet macht overtone.ts.

import crypto from 'node:crypto';
import {
	deleteSperreRow,
	einstellung,
	insertSperre,
	loescheEinstellung,
	setzeEinstellung,
	sperrRow,
	sperrRows,
	updateSperre,
	type SperrRow
} from './store';

export type Sperrfenster = {
	id: number;
	name: string;
	tage: number[];
	von: string;
	bis: string;
	aktiv: boolean;
	tasten: boolean;
	stumm: boolean;
	einmalBis: string;
};

export type Sperrstatus = {
	gesperrt: boolean;
	bis: string;
	name: string;
	tasten: boolean;
	stumm: boolean;
	schnell: boolean;
	freigabeBis: string;
	global: boolean;
};

export const TAGESTEXT = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
export const TAGKUERZEL = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const OHNE_SPERRE: Sperrstatus = {
	gesperrt: false,
	bis: '',
	name: '',
	tasten: false,
	stumm: false,
	schnell: false,
	freigabeBis: '',
	global: true
};

function minuten(text: string): number {
	const [h, m] = String(text || '0:0').split(':');
	return (Number(h) || 0) * 60 + (Number(m) || 0);
}

function uhr(min: number): string {
	const m = ((Math.round(min) % 1440) + 1440) % 1440;
	return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function fensterAus(row: SperrRow): Sperrfenster {
	return {
		id: row.id,
		name: row.name,
		tage: row.tage
			? row.tage
					.split(',')
					.map((t) => Number(t))
					.filter((t) => t >= 1 && t <= 7)
			: [],
		von: row.von,
		bis: row.bis,
		aktiv: !!row.aktiv,
		tasten: !!row.tasten,
		stumm: !!row.stumm,
		einmalBis: row.einmal_bis
	};
}

export function fensterListe(): Sperrfenster[] {
	return sperrRows().map(fensterAus);
}

export function sperreGlobal(): boolean {
	return einstellung('sperre_an') !== '0';
}

export function setzeGlobal(an: boolean): void {
	setzeEinstellung('sperre_an', an ? '1' : '0');
	if (an) freigabeBeenden();
}

// Trifft dieses Fenster jetzt zu? Ueber Mitternacht gehoert der Teil nach
// Mitternacht zum Vortag, deshalb wird dort der Wochentag zurueckgerechnet.
export function trifft(row: SperrRow, jetzt: Date): boolean {
	if (!row.aktiv) return false;
	const einmalEnde = row.einmal_bis ? Date.parse(row.einmal_bis) : NaN;
	if (!Number.isNaN(einmalEnde)) return jetzt.getTime() < einmalEnde;
	if (!row.tage) return false;
	const tage = row.tage.split(',').map(Number).filter(Boolean);
	if (!tage.length) return false;
	const jetztMin = jetzt.getHours() * 60 + jetzt.getMinutes();
	const von = minuten(row.von);
	const bis = minuten(row.bis);
	if (von === bis) return false;
	const tag = ((jetzt.getDay() + 6) % 7) + 1;
	if (von < bis) return tage.includes(tag) && jetztMin >= von && jetztMin < bis;
	if (jetztMin >= von) return tage.includes(tag);
	if (jetztMin < bis) return tage.includes(tag === 1 ? 7 : tag - 1);
	return false;
}

export function status(jetzt = new Date()): Sperrstatus {
	if (!sperreGlobal()) return { ...OHNE_SPERRE, global: false };
	const freigabe = einstellung('sperre_freigabe_bis');
	const freigabeEnde = freigabe ? Date.parse(freigabe) : NaN;
	const freigabeLaeuft = !Number.isNaN(freigabeEnde) && jetzt.getTime() < freigabeEnde;
	for (const row of sperrRows()) {
		if (!trifft(row, jetzt)) continue;
		if (freigabeLaeuft) return { ...OHNE_SPERRE, freigabeBis: freigabe ?? '' };
		const bis = row.einmal_bis ? row.einmal_bis : uhr(minuten(row.bis));
		return {
			gesperrt: true,
			bis,
			name: row.name || 'Sperrzeit',
			tasten: !!row.tasten,
			stumm: !!row.stumm,
			schnell: !!row.einmal_bis,
			freigabeBis: '',
			global: true
		};
	}
	return freigabeLaeuft ? { ...OHNE_SPERRE, freigabeBis: freigabe ?? '' } : { ...OHNE_SPERRE };
}

export function anlegen(daten: {
	name?: string;
	tage?: number[];
	von?: string;
	bis?: string;
	aktiv?: boolean;
	tasten?: boolean;
	stumm?: boolean;
}): number {
	freigabeBeenden();
	return insertSperre({
		name: (daten.name ?? '').trim() || 'Sperrzeit',
		tage: (daten.tage ?? []).slice().sort((a, b) => a - b).join(','),
		von: daten.von ?? '20:00',
		bis: daten.bis ?? '06:30',
		aktiv: daten.aktiv === false ? 0 : 1,
		tasten: daten.tasten === false ? 0 : 1,
		stumm: daten.stumm === false ? 0 : 1,
		einmal_bis: ''
	});
}

// Eine neue Sperre hebt eine laufende Freigabe auf, sonst waere sie still wirkungslos.
function freigabeBeenden(): void {
	if (einstellung('sperre_freigabe_bis')) loescheEinstellung('sperre_freigabe_bis');
}

export function aendern(id: number, daten: Partial<Sperrfenster>): void {
	const satz: Partial<SperrRow> = {};
	if (daten.name !== undefined) satz.name = String(daten.name).trim() || 'Sperrzeit';
	if (daten.tage !== undefined) satz.tage = daten.tage.slice().sort((a, b) => a - b).join(',');
	if (daten.von !== undefined) satz.von = daten.von;
	if (daten.bis !== undefined) satz.bis = daten.bis;
	if (daten.aktiv !== undefined) satz.aktiv = daten.aktiv ? 1 : 0;
	if (daten.tasten !== undefined) satz.tasten = daten.tasten ? 1 : 0;
	if (daten.stumm !== undefined) satz.stumm = daten.stumm ? 1 : 0;
	if (!sperrRow(id)) return;
	updateSperre(id, satz);
}

export function loeschen(id: number): void {
	deleteSperreRow(id);
}

// Schnellsperre: ein Fenster ohne Wochentage, das nur bis zu einem Zeitpunkt gilt.
export function schnell(minutenLaufzeit: number, tasten = true, stumm = true): number {
	const bis = new Date(Date.now() + Math.max(1, Math.round(minutenLaufzeit)) * 60000).toISOString();
	freigabeBeenden();
	return insertSperre({
		name: 'Schnellsperre',
		tage: '',
		von: '',
		bis: '',
		aktiv: 1,
		tasten: tasten ? 1 : 0,
		stumm: stumm ? 1 : 0,
		einmal_bis: bis
	});
}

// Abgelaufene Schnellsperren wegraeumen.
export function aufraeumen(jetzt = new Date()): number {
	let weg = 0;
	for (const row of sperrRows()) {
		if (!row.einmal_bis) continue;
		const ende = Date.parse(row.einmal_bis);
		if (!Number.isNaN(ende) && ende <= jetzt.getTime()) {
			deleteSperreRow(row.id);
			weg += 1;
		}
	}
	return weg;
}

export function schnellBis(): string | undefined {
	return sperrRows()
		.filter((r) => r.einmal_bis)
		.map((r) => r.einmal_bis)
		.sort()
		.pop();
}

// ------------------------------------------------------------------ Code

export function pinGesetzt(): boolean {
	return !!einstellung('sperre_pin');
}

export function pinSetzen(pin: string): void {
	const salt = crypto.randomBytes(16).toString('hex');
	const hash = crypto.scryptSync(pin, salt, 32).toString('hex');
	setzeEinstellung('sperre_pin', `${salt}:${hash}`);
}

export function pinPasst(pin: string): boolean {
	const gespeichert = einstellung('sperre_pin');
	if (!gespeichert) return true; // ohne Code ist alles erlaubt
	const [salt, hash] = gespeichert.split(':');
	if (!salt || !hash) return false;
	const probe = crypto.scryptSync(String(pin ?? ''), salt, 32);
	const soll = Buffer.from(hash, 'hex');
	return probe.length === soll.length && crypto.timingSafeEqual(probe, soll);
}

export function freigeben(minutenLaufzeit: number): string {
	const bis = new Date(Date.now() + Math.max(1, Math.round(minutenLaufzeit)) * 60000).toISOString();
	setzeEinstellung('sperre_freigabe_bis', bis);
	return bis;
}

export function freigabeAufheben(): void {
	loescheEinstellung('sperre_freigabe_bis');
}
