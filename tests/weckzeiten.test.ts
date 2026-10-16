import { beforeEach, expect, it, vi } from 'vitest';
import { alarmListenXml, xmlMitListe, konfigSchreiben, stationenSchreiben, zuhause, type Rufen } from './hilfe';

vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('netz unterbrochen'); }));

vi.mock('../src/lib/server/sonos', () => {
	let antwort: (ruf: Rufen) => { ok: boolean; errorCode?: number; values?: Record<string, string>; xml?: string } = () => ({
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
			return antwort(ruf);
		},
		escapeXml: (wert: string) => String(wert).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
		unescapeXml: (wert: string) =>
			String(wert).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'),
		didlForHttpAudio: (url: string, titel: string) => `<DIDL><res>${url}</res><dc:title>${titel}</dc:title></DIDL>`
	};
});

import { verwaltet } from '../src/lib/server/sonos';

beforeEach(() => {
	verwaltet.protokoll.length = 0;
});

type StoreAls = {
	alarmRows(): Array<{ id: number; enabled: number; volume: number; station_id: string | null }>;
};

const STABLE = 'https://stabil.example.org/radio';
const GELOESEST = 'https://aufgeloest.example.org/token-123?x=1';

async function alarmImGerat(): Promise<void> {
	verwaltet.setze((ruf) => {
		if (ruf.action === 'ListAlarms') {
			return xmlMitListe(
				alarmListenXml([
					{ ID: 7, StartTime: '07:00:00', Duration: '00:30:00', Recurrence: 'DAILY', Enabled: '1', Volume: '10', ProgramURI: 'https://weird.example.org/xyz', ProgramMetaData: 'OLDMETA' }
				])
			);
		}
		return { ok: true, values: { AssignedID: '55' } };
	});
}

it('Anlegen, Bearbeiten und Umschalten tragen die stabile Senderadresse', async () => {
	const home = zuhause();
	konfigSchreiben(home, { host: '192.168.1.50', uuid: 'RINCON_TEST' });
	stationenSchreiben(home, [{ id: 'meinsender', name: 'Mein Sender', url: STABLE }]);
	vi.resetModules();
	const alarms = await import('../src/lib/server/alarms');

	// Anlegen
	await alarmImGerat();
	const anlegen = await alarms.createAlarm({
		time: '07:15',
		stationId: 'meinsender',
		enabled: false,
		volume: 0
	});
	expect(anlegen.ok).toBe(true);
	const schreib = verwaltet.protokoll.filter((r) => r.action === 'CreateAlarm');
	expect(schreib).toHaveLength(1);
	expect(schreib[0].args.ProgramURI).toBe(STABLE);
	expect(schreib[0].args.Enabled).toBe(0);
	expect(schreib[0].args.Volume).toBe(0);
	const store = (await import('../src/lib/server/store')) as unknown as StoreAls;
	expect(store.alarmRows().find((z) => z.id === 55)?.enabled).toBe(0);
	expect(store.alarmRows().find((z) => z.id === 55)?.volume).toBe(0);

	// Bearbeiten: die Adresse im Gerät wird nicht von der aufgelösten
	// Adresse überschrieben, sondern mit der stabilen ersetzt.
	verwaltet.protokoll.length = 0;
	const aendern = await alarms.updateAlarm(7, { time: '08:30', stationId: 'meinsender' });
	expect(aendern.ok).toBe(true);
	const Update = verwaltet.protokoll.find((r) => r.action === 'UpdateAlarm');
	expect(Update?.args.ProgramURI).toBe(STABLE);

	// Umschalten (Deaktivieren): Senderadresse bleibt, Lautstärke unverändert.
	verwaltet.protokoll.length = 0;
	const aus = await alarms.setAlarmEnabled(7, false);
	expect(aus.ok).toBe(true);
	const abschalten = verwaltet.protokoll.find((r) => r.action === 'UpdateAlarm');
	expect(abschalten?.args.ProgramURI).toBe(STABLE);
	expect(abschalten?.args.Enabled).toBe(0);
	expect(abschalten?.args.Volume).toBe(10);
});

it('unbekannte Sender behalten Geräteadresse und Metadaten', async () => {
	const home = zuhause();
	konfigSchreiben(home, { host: '192.168.1.50', uuid: 'RINCON_TEST' });
	stationenSchreiben(home, [{ id: 'meinsender', name: 'Mein Sender', url: STABLE }]);
	vi.resetModules();
	const alarms = await import('../src/lib/server/alarms');
	await alarmImGerat();

	// Alarm 7 zeigt auf eine Adresse, die keinem Sender entspricht, und hat
	// eigenen Metadaten: beim Umschalten bleibt beides bestehen.
	const aus = await alarms.setAlarmEnabled(7, false);
	expect(aus.ok).toBe(true);
	const abschalten = verwaltet.protokoll.find((r) => r.action === 'UpdateAlarm');
	expect(abschalten?.args.ProgramURI).toBe('https://weird.example.org/xyz');
	expect(abschalten?.args.ProgramMetaData).toBe('OLDMETA');

	verwaltet.protokoll.length = 0;
	// Ohne Senderangabe beim Bearbeiten ebenfalls.
	const behalten = await alarms.updateAlarm(7, { time: '09:45' });
	expect(behalten.ok).toBe(true);
	const geaendert = verwaltet.protokoll.find((r) => r.action === 'UpdateAlarm');
	expect(geaendert?.args.ProgramURI).toBe('https://weird.example.org/xyz');
	expect(geaendert?.args.ProgramMetaData).toBe('OLDMETA');
});

it('lokale Datensätze gehen erst weg, wenn der Lautsprecher die Löschung bestätigt', async () => {
	const home = zuhause();
	konfigSchreiben(home, { host: '192.168.1.50', uuid: 'RINCON_TEST' });
	vi.resetModules();
	const alarms = await import('../src/lib/server/alarms');
	const store = (await import('../src/lib/server/store')) as unknown as StoreAls;

	// Lokalen Datensatz anlegen (wie nach einer bestätigten Weckzeit).
	const alarmRow = await import('../src/lib/server/store');
	alarmRow.saveAlarm({ id: 7, time: '07:00:00', duration: '00:30:00', recurrence: 'DAILY', enabled: 1, station_id: 'a', volume: 10, label: 'A' });
	await alarmImGerat();

	const hinweg = await alarms.deleteAlarm(7);
	expect(hinweg.ok).toBe(true);
	expect(store.alarmRows().find((z) => z.id === 7)).toBeUndefined();

	// Gerät lehnt ab: der Datensatz bleibt bestehen.
	alarmRow.saveAlarm({ id: 8, time: '08:00:00', duration: '00:30:00', recurrence: 'ONCE', enabled: 1, station_id: 'b', volume: 11, label: 'B' });
	verwaltet.setze((ruf) =>
		ruf.action === 'ListAlarms'
			? xmlMitListe(alarmListenXml([ { ID: 8, StartTime: '08:00:00', Recurrence: 'ONCE', Enabled: '1', Volume: '11', ProgramURI: 'https://x.example.org' } ]))
			: { ok: false, errorCode: 402, values: {} }
	);
	const verweigert = await alarms.deleteAlarm(8);
	expect(verweigert.ok).toBe(false);
	expect(store.alarmRows().find((z) => z.id === 8)?.enabled).toBe(1);
});
