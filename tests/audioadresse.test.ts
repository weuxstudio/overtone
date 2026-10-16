import { beforeEach, expect, it, vi } from 'vitest';
import { konfigSchreiben, zuhause } from './hilfe';

// Die erkannten Netzadressen werden simuliert: eine private VPN-Adresse und
// eine im Netz des Lautsprechers.
const netz = vi.hoisted(() => ({ adressen: [] as string[] }));
vi.mock('node:os', async (importEcht) => {
	const echt = await importEcht<typeof import('node:os')>();
	const simuliert = () => ({
		en0: netz.adressen.map((address, index) => ({ family: 'IPv4', address, internal: false, mac: '', index: index + 1 }))
	});
	return {
		...echt,
		networkInterfaces: simuliert,
		default: { ...echt, networkInterfaces: simuliert }
	};
});

it('ausdrücklich gesetzter callbackHost behält Vorrang; eigene Angaben gelten als lokal', async () => {
	vi.resetModules();
	netz.adressen = ['10.8.0.5', '192.168.1.10'];
	const home = zuhause();
	konfigSchreiben(home, { host: '192.168.1.50', callbackHost: '192.168.1.10', notifyPort: 8779 });
	const overtone = await import('../src/lib/server/overtone');

	expect(overtone.callbackAddress()).toBe('192.168.1.10');

	// Ereignisempfänger und Audiodateien teilen diese Adresse.
	const adresse = overtone.tonAdresse('ansage-12cd34ef.mp3');
	expect(adresse).toBe('http://192.168.1.10:8770/ton/ansage-12cd34ef.mp3');

	// Eigene Tondateien zählen lokal, fremde Streams nicht.
	expect(overtone.istEigeneAdresse(adresse)).toBe(true);
	expect(overtone.istEigeneAdresse('http://127.0.0.1:8770/ton/klang-regen.mp3')).toBe(true);
	expect(overtone.istEigeneAdresse('http://localhost:8770/ton/klang-meer.mp3')).toBe(true);
	expect(overtone.istEigeneAdresse('https://stream.radioparadise.com/mp3-192')).toBe(false);
});

it('ohne callbackHost wird die Netzadresse automatisch erkannt, eigene Tondateien trotzdem lokal', async () => {
	vi.resetModules();
	netz.adressen = ['10.8.0.5', '192.168.1.10'];
	const home = zuhause();
	konfigSchreiben(home, { host: '192.168.1.50', callbackHost: '' });
	const overtone = await import('../src/lib/server/overtone');

	// Erkannt wird die Adresse im Netz des Lautsprechers, niemals die
	// VPN-Adresse.
	expect(overtone.callbackAddress()).toBe('192.168.1.10');
	const adresse = overtone.tonAdresse('klang-regen-12cd34ef.mp3');
	expect(adresse).toBe('http://192.168.1.10:8770/ton/klang-regen-12cd34ef.mp3');

	// Auch bei automatisch erkannter Adresse gilt die eigene Audiodatei
	// als lokal und wird nicht als fremder Stream behandelt.
	expect(overtone.istEigeneAdresse(adresse)).toBe(true);
	expect(overtone.istEigeneAdresse('https://stream.radioparadise.com/mp3-192')).toBe(false);
});
