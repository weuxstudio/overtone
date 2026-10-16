import { beforeEach, expect, it, vi } from 'vitest';
import { konfigSchreiben, zuhause, type Rufen } from './hilfe';

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
		escapeXml: (wert: string) => String(wert),
		unescapeXml: (wert: string) => String(wert),
		didlForHttpAudio: (url: string, titel: string) => `<DIDL><res>${url}</res><dc:title>${titel}</dc:title></DIDL>`
	};
});

import { verwaltet } from '../src/lib/server/sonos';

beforeEach(() => {
	vi.resetModules();
	verwaltet.protokoll.length = 0;
});

it('Ereignisverbindung: eine gültige Nachricht bestätigt Kontakt, unabhängig vom Ereigniszähler', async () => {
	const home = zuhause();
	konfigSchreiben(home, { host: '192.168.1.50', uuid: 'RINCON_TEST' });
	vi.resetModules();
	const overtone = await import('../src/lib/server/overtone');

	// Noch ungeprüfter Zustand.
	expect(overtone.state.deviceReachable).toBeNull();
	expect(overtone.state.events).toBe(0);

	// Ereigniszähler steht auf null, die Nachricht ist trotzdem an.
	overtone.applyEvent({ TransportState: 'PLAYING' });
	expect(overtone.state.deviceReachable).toBe(true);
	expect(overtone.state.transportState).toBe('PLAYING');
});

it('Geräteabgleich meldet Ausfall und Erholung ausdrücklich, Statuswechsel wird übertragen', async () => {
	const home = zuhause();
	konfigSchreiben(home, { host: '192.168.1.50', uuid: 'RINCON_TEST' });
	vi.resetModules();
	const overtone = await import('../src/lib/server/overtone');

	// Die Verbindungsanzeige liest die Nachrichten mit.
	const nachrichten: string[] = [];
	overtone.addClient({ write: (chunk) => nachrichten.push(chunk) });

	// Gerät antwortet nicht: Ausfall (null -> false) wird gemeldet.
	verwaltet.setze(() => {
		throw new Error('kein geraet');
	});
	await overtone.frischVomGeraet();
	expect(overtone.state.deviceReachable).toBe(false);
	expect(nachrichten.some((n) => n.includes('"deviceReachable":false'))).toBe(true);

	// Gerät erholt: false -> true, ebenfalls ausdrücklich übermittelt.
	verwaltet.setze((ruf) => {
		if (ruf.action === 'GetTransportInfo') return { ok: true, values: { CurrentTransportState: 'PLAYING' } };
		if (ruf.action === 'GetPositionInfo') return { ok: true, values: { TrackURI: 'https://x.example.org/a' } };
		return { ok: true, values: { CurrentVolume: '11', CurrentMute: '0' } };
	});
	await overtone.frischVomGeraet();
	expect(overtone.state.deviceReachable).toBe(true);
	expect(nachrichten.some((n) => n.includes('"deviceReachable":true'))).toBe(true);

	// Stabile Verbindung erzeugt keine Dauerprüfung im Takt: im unveränderten
	// [%5-Fall] sendet der Abgleich nichts, der Zustand bleibt erreicht.
	await overtone.frischVomGeraet();
	expect(overtone.state.deviceReachable).toBe(true);
});

it('/api/state lädt denselben Erreichbarkeitszustand', async () => {
	const home = zuhause();
	konfigSchreiben(home, { host: '192.168.1.50', uuid: 'RINCON_TEST' });
	vi.resetModules();
	const overtone = await import('../src/lib/server/overtone');
	verwaltet.setze(() => {
		throw new Error('kein geraet');
	});
	await overtone.frischVomGeraet();
	// state ist dieselbe Quelle: jeder Abnehmer (state und events) sieht die
	// Kennzeichnung.
	expect(overtone.state.deviceReachable).toBe(false);
	expect(JSON.parse(JSON.stringify(overtone.state)).deviceReachable).toBe(false);
});
