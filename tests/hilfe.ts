// Gemeinsame Testunterlage: temporäre Dateien in einer simulierten Benutzerablage, damit produktive
// Laufzeitdaten (~/.overtone) nicht angetastet werden. Gerätekommunikation,
// Netzadresse, Zeitgeber und Ereignisverbindung werden simuliert.
import fs from 'node:fs';
import { vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';

export type Rufen = {
	host: string;
	service: string;
	action: string;
	args: Record<string, string | number>;
};

// Neue Benutzerablage simulieren: Datenbank, Konfiguration und Sicherungsordner landen
// alle in diesen Zug schon nach Hause geschickten Verzeichnis.
export function zuhause(): string {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'overtone-'));
	vi.spyOn(os, 'homedir').mockReturnValue(home);
	return home;
}

export function konfigSchreiben(
	home: string,
	konfig: Partial<{ host: string; uuid: string; callbackHost: string; notifyPort: number; serviceName: string }>
): void {
	const ordner = path.join(home, '.overtone');
	fs.mkdirSync(ordner, { recursive: true });
	fs.writeFileSync(
		path.join(ordner, 'config.json'),
		JSON.stringify({ notifyPort: 8771, serviceName: 'Overtone', ...konfig }, null, 1)
	);
}

export function zuHausePfad(home: string, ...teile: string[]): string {
	return path.join(home, '.overtone', ...teile);
}

// Senderliste dauerhaft vorlegen, wie sie die App verwalten würde.
export function stationenSchreiben(
	home: string,
	stationen: Array<{ id: string; name: string; url: string }>
): void {
	const ordner = path.join(home, '.overtone');
	fs.mkdirSync(ordner, { recursive: true });
	fs.writeFileSync(path.join(ordner, 'stations.json'), JSON.stringify(stationen, null, 1));
}

export function stationenLesen(home: string): Array<{ id: string; name: string; url: string }> {
	try {
		return JSON.parse(fs.readFileSync(path.join(home, '.overtone', 'stations.json'), 'utf8'));
	} catch {
		return [];
	}
}

// Die Geräteliste kommt doppelt escapte Alarme, so liest das echte parsing sie.
export function alarmListenXml(alarms: Array<Record<string, string | number>>): string {
	const innen = alarms
		.map((a) => Object.entries(a).map(([k, v]) => `${k}=&quot;${String(v)}&quot;`).join(' '))
		.join('&gt;&lt;Alarm ');
	return `<CurrentAlarmList>&lt;Alarm ${innen}/&gt;</CurrentAlarmList>`;
}

export function xmlMitListe(liste: string): { ok: boolean; xml: string; values: Record<string, string> } {
	return {
		ok: true,
		values: {},
		xml: `<?xml version="1.0"?><s:Envelope><s:Body><u:ListAlarmsResponse>${liste}</u:ListAlarmsResponse></s:Body></s:Envelope>`
	};
}
