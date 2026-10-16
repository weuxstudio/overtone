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
	verwaltet.protokoll.length = 0;
});

it.each(['Stop', 'SetButtonLockState', 'SetVolume', 'SetMute'])(
	'eine Ausnahme bei %s unterbricht die übrigen Schutzmaßnahmen nicht',
	async (aktion) => {
		const testOrdner = zuhause();
		konfigSchreiben(testOrdner, { host: '192.168.1.50', uuid: 'RINCON_TEST' });
		vi.resetModules();
		vi.useFakeTimers();
		try {
			const sperre = await import('../src/lib/server/sperre');
			const overtone = await import('../src/lib/server/overtone');
			sperre.schnell(60);
			overtone.state.transportState = 'PLAYING';
			overtone.state.volume = 20;
			verwaltet.setze((ruf) => {
				if (ruf.action === aktion) throw new Error(`${aktion}: Verbindung unterbrochen`);
				return { ok: true, values: {} };
			});

			const ergebnis = await overtone.sperreDurchsetzen();
			expect(ergebnis.ok).toBe(false);
			expect(ergebnis.fehler.join(' ')).toContain(`${aktion}: Verbindung unterbrochen`);
			expect(verwaltet.protokoll.filter(r => !r.action.startsWith('Get')).map((ruf) => ruf.action)).toEqual([
				'Stop', 'SetButtonLockState', 'SetVolume', 'SetMute'
			]);
		} finally {
			vi.useRealTimers();
		}
	}
);

it('ein Stop Fehler während einer bestehenden Sperre verhindert das erneute Stummschalten nicht', async () => {
	const testOrdner = zuhause();
	konfigSchreiben(testOrdner, { host: '192.168.1.50', uuid: 'RINCON_TEST' });
	vi.resetModules();
	vi.useFakeTimers();
	try {
		const sperre = await import('../src/lib/server/sperre');
		const overtone = await import('../src/lib/server/overtone');
		sperre.schnell(60);
		overtone.state.volume = 20;
		verwaltet.setze(() => ({ ok: true, values: {} }));
		await overtone.sperreDurchsetzen();

		overtone.state.transportState = 'PLAYING';
		overtone.state.volume = 30;
		overtone.state.mute = false;
		verwaltet.protokoll.length = 0;
		verwaltet.setze((ruf) => {
			if (ruf.action === 'Stop') throw new Error('AVTransport nicht erreichbar');
			return { ok: true, values: {} };
		});
		const ergebnis = await overtone.sperreDurchsetzen();
		expect(ergebnis.ok).toBe(false);
		expect(overtone.state.volume).toBe(0);
		expect(overtone.state.mute).toBe(true);
		expect(verwaltet.protokoll.filter(r => !r.action.startsWith('Get')).map((ruf) => ruf.action)).toEqual(['Stop', 'SetVolume', 'SetMute']);
	} finally {
		vi.useRealTimers();
	}
});

it.each(['SetButtonLockState', 'SetMute', 'SetVolume'])(
	'eine Ausnahme bei der Freigabe %s verhindert andere Freigaben nicht',
	async (aktion) => {
		const testOrdner = zuhause();
		konfigSchreiben(testOrdner, { host: '192.168.1.50', uuid: 'RINCON_TEST' });
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-16T10:00:00.000Z'));
		try {
			const sperre = await import('../src/lib/server/sperre');
			const overtone = await import('../src/lib/server/overtone');
			sperre.schnell(60);
			overtone.state.volume = 20;
			verwaltet.setze(() => ({ ok: true, values: {} }));
			await overtone.sperreDurchsetzen();

			vi.setSystemTime(new Date('2026-10-16T11:30:00.000Z'));
			verwaltet.protokoll.length = 0;
			verwaltet.setze((ruf) => {
				if (ruf.action === aktion) throw new Error(`${aktion}: Zeitlimit überschritten`);
				return { ok: true, values: {} };
			});
			expect((await overtone.sperreDurchsetzen()).ok).toBe(false);
			expect(verwaltet.protokoll.filter(r => !r.action.startsWith('Get')).map((ruf) => ruf.action)).toEqual([
				'SetButtonLockState', 'SetMute', 'SetVolume'
			]);

			verwaltet.protokoll.length = 0;
			verwaltet.setze(() => ({ ok: true, values: {} }));
			expect((await overtone.sperreDurchsetzen()).ok).toBe(true);
			expect(verwaltet.protokoll.filter(r => !r.action.startsWith('Get')).map((ruf) => ruf.action)).toEqual([aktion]);
		} finally {
			vi.useRealTimers();
		}
	}
);

it('fehlgeschlagene Freigaben werden wiederholt, bestätigte Schritte nicht erneut ausgeführt', async () => {
	const home = zuhause();
	konfigSchreiben(home, { host: '192.168.1.50', uuid: 'RINCON_TEST' });
	vi.resetModules();

	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-10-16T10:00:00.000Z'));
	try {
		// Schnellsperre einrichten: 60 Minuten, Tasten und Stummschaltung.
		const sperre = await import('../src/lib/server/sperre');
		const overtone = await import('../src/lib/server/overtone');
		sperre.schnell(60);
		overtone.state.transportState = 'PLAYING';
		overtone.state.volume = 20;

		verwaltet.setze(() => ({ ok: true, values: {} }));
		const beginn = await overtone.sperreDurchsetzen();
		expect(beginn.ok).toBe(true);
		// Lautstärke wurde vor der Stummschaltung gemerkt.
		const { einstellung } = await import('../src/lib/server/store');
		expect(einstellung('sperre_lautstaerke')).toBe('20');
		expect(verwaltet.protokoll.some((r) => r.action === 'Stop')).toBe(true);
		expect(verwaltet.protokoll.some((r) => r.action === 'SetButtonLockState' && r.args.DesiredButtonLockState === 'On')).toBe(true);
		expect(verwaltet.protokoll.some((r) => r.action === 'SetVolume' && r.args.DesiredVolume === 0)).toBe(true);
		expect(verwaltet.protokoll.some((r) => r.action === 'SetMute' && r.args.DesiredMute === 1)).toBe(true);

		// Sperre endet; die Stummschaltungs-Aufhebung schlägt fehl.
		verwaltet.protokoll.length = 0;
		vi.setSystemTime(new Date('2026-10-16T11:30:00.000Z'));
		verwaltet.setze((ruf) =>
			ruf.action === 'SetMute' && ruf.args.DesiredMute === 0
				? { ok: false, errorCode: 701, values: {} }
				: { ok: true, values: {} }
		);
		const erster = await overtone.sperreDurchsetzen();
		expect(erster.ok).toBe(false);
		expect(erster.fehler.some((f) => f.includes('Stummschaltung'))).toBe(true);
		// Tastensperre wurde aufgehoben, Lautstärke zurückgekommen ...
		expect(verwaltet.protokoll.some((r) => r.action === 'SetButtonLockState' && r.args.DesiredButtonLockState === 'Off')).toBe(true);
		expect(verwaltet.protokoll.some((r) => r.action === 'SetVolume' && r.args.DesiredVolume === 20)).toBe(true);
		expect(einstellung('sperre_lautstaerke')).toBeUndefined();

		// Der nächste Durchlauf wiederholt nur den fehlgeschlagenen Schritt.
		verwaltet.protokoll.length = 0;
		verwaltet.setze((ruf) =>
			ruf.action === 'SetMute' && ruf.args.DesiredMute === 0 ? { ok: true, values: {} } : { ok: true, values: {} }
		);
		const zweiter = await overtone.sperreDurchsetzen();
		expect(zweiter.ok).toBe(true);
		expect(verwaltet.protokoll.some((r) => r.action === 'SetButtonLockState')).toBe(false);
		expect(verwaltet.protokoll.some((r) => r.action === 'SetVolume' && r.args.DesiredVolume === 20)).toBe(false);
		expect(verwaltet.protokoll.some((r) => r.action === 'SetMute' && r.args.DesiredMute === 0)).toBe(true);

		// Auch danach weiter: nichts davon wird erneut ausgeführt.
		verwaltet.protokoll.length = 0;
		await overtone.sperreDurchsetzen();
		expect(verwaltet.protokoll.some((r) => r.action === 'SetMute')).toBe(false);
		expect(verwaltet.protokoll.some((r) => r.action === 'SetButtonLockState')).toBe(false);
	} finally {
		vi.useRealTimers();
	}
});

	it('gleichzeitige Aufrufer warten auf den tatsächlichen Abschluss der Ausführung', async () => {
		const home = zuhause();
		konfigSchreiben(home, { host: '192.168.1.50', uuid: 'RINCON_TEST' });
		vi.resetModules();

		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-16T10:00:00.000Z'));
		try {
			const sperre = await import('../src/lib/server/sperre');
			const overtone = await import('../src/lib/server/overtone');
			sperre.schnell(60);
			overtone.state.transportState = 'PLAYING';
			overtone.state.volume = 20;

			// Stop bewusst verzögern: der zweite Aufrufer kommt an, während der
			// erste noch auf das Gerät wartet.
			const wartende: Array<() => void> = [];
			let offeneAufrufe = 0;
			let ueberlappung = false;
			verwaltet.setze(() => {
				if (offeneAufrufe > 0) ueberlappung = true;
				offeneAufrufe += 1;
				return new Promise((loese) => {
					wartende.push(() => {
						offeneAufrufe -= 1;
						loese({ ok: true, values: {} } as never);
					});
				});
			});
			const erster = overtone.sperreDurchsetzen();
			const zweiter = overtone.sperreDurchsetzen();
			// Keine vorzeitige Erfolgsmeldung: beide warten auf dieselbe
			// Ausfuehrung, sie loesen keine eigenen Stopps ohne Wartezeit aus.
			expect(zweiter).toBe(erster);
			let zweiterFertig = false;
			void zweiter.then(() => {
				zweiterFertig = true;
			});
			for (let i = 0; i < 5; i++) await Promise.resolve();
			expect(zweiterFertig).toBe(false);

			// Der zweite Aufrufer markiert einen Nachlauf; sein eigener Stop
			// wird vom Gerät abgelehnt. Zusammen: ok false, ein Duplikat der
			// Stop-Meldung, keine Überlappung der Gerätewartezeiten.
			verwaltet.setze((ruf) =>
				ruf.action === 'Stop' ? { ok: false, errorCode: 701, values: {} } : { ok: true, values: {} }
			);
			for (const loese of [...wartende]) loese();
			wartende.length = 0;
			const [a, b] = await Promise.all([erster, zweiter]);
			expect(ueberlappung).toBe(false);
			// Beide sehen denselben zusammengeführten Abschluss.
			expect(b).toBe(a);
			expect(a.ok).toBe(false);
			expect(a.fehler.filter((f) => f.includes('gestoppt'))).toHaveLength(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('Scheitern der Tastenfreigabe wird im Folgelauf als einziger Schritt wiederholt', async () => {
		const home = zuhause();
		konfigSchreiben(home, { host: '192.168.1.50', uuid: 'RINCON_TEST' });
		vi.resetModules();

		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-16T10:00:00.000Z'));
		try {
			const sperre = await import('../src/lib/server/sperre');
			const overtone = await import('../src/lib/server/overtone');
			sperre.schnell(60);
			overtone.state.transportState = 'PLAYING';
			overtone.state.volume = 20;

			verwaltet.setze(() => ({ ok: true, values: {} }));
			const beginn = await overtone.sperreDurchsetzen();
			expect(beginn.ok).toBe(true);

			// Sperre endet; die Geräte weigern die Tastenfreigabe.
			verwaltet.protokoll.length = 0;
			vi.setSystemTime(new Date('2026-10-16T11:30:00.000Z'));
			verwaltet.setze((ruf) =>
				ruf.action === 'SetButtonLockState' && ruf.args.DesiredButtonLockState === 'Off'
					? { ok: false, errorCode: 404, values: {} }
					: { ok: true, values: {} }
			);
			const erster = await overtone.sperreDurchsetzen();
			expect(erster.ok).toBe(false);
			expect(erster.fehler.some((f) => f.includes('Tastensperre'))).toBe(true);
			// Die übrigen Schritte laufen trotzdem und bestätigen sich.
			expect(verwaltet.protokoll.some((r) => r.action === 'SetMute' && r.args.DesiredMute === 0)).toBe(true);
			expect(verwaltet.protokoll.some((r) => r.action === 'SetVolume' && r.args.DesiredVolume === 20)).toBe(true);

			// Der Folgelauf wiederholt nur die Tastenfreigabe.
			verwaltet.protokoll.length = 0;
			verwaltet.setze(() => ({ ok: true, values: {} }));
			const zweiter = await overtone.sperreDurchsetzen();
			expect(zweiter.ok).toBe(true);
			expect(verwaltet.protokoll.filter(r => !r.action.startsWith('Get')).map((r) => `${r.action}:${r.args.DesiredButtonLockState ?? ''}`)).toEqual([
				'SetButtonLockState:Off'
			]);
			// Danach bleibt aufgeräumt.
			verwaltet.protokoll.length = 0;
			await overtone.sperreDurchsetzen();
			expect(verwaltet.protokoll).toHaveLength(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('Scheitern der Lautstärkewiederherstellung wird im Folgelauf als einziger Schritt wiederholt', async () => {
		const home = zuhause();
		konfigSchreiben(home, { host: '192.168.1.50', uuid: 'RINCON_TEST' });
		vi.resetModules();

		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-16T10:00:00.000Z'));
		try {
			const sperre = await import('../src/lib/server/sperre');
			const overtone = await import('../src/lib/server/overtone');
			sperre.schnell(60);
			overtone.state.transportState = 'PLAYING';
			overtone.state.volume = 20;

			verwaltet.setze(() => ({ ok: true, values: {} }));
			const beginn = await overtone.sperreDurchsetzen();
			expect(beginn.ok).toBe(true);
			// Erfolgreiche Bestätigungen kommen sofort in den lokalen Zustand.
			expect(overtone.state.volume).toBe(0);
			expect(overtone.state.mute).toBe(true);

			// Sperre endet; der Lautstärkerückversuch wird vom Gerät abgelehnt.
			verwaltet.protokoll.length = 0;
			vi.setSystemTime(new Date('2026-10-16T11:30:00.000Z'));
			verwaltet.setze((ruf) =>
				ruf.action === 'SetVolume' && ruf.args.DesiredVolume === 20
					? { ok: false, errorCode: 701, values: {} }
					: { ok: true, values: {} }
			);
			const erster = await overtone.sperreDurchsetzen();
			expect(erster.ok).toBe(false);
			expect(erster.fehler.some((f) => f.includes('Lautstärke'))).toBe(true);
			expect(verwaltet.protokoll.some((r) => r.action === 'SetButtonLockState' && r.args.DesiredButtonLockState === 'Off')).toBe(true);
			expect(verwaltet.protokoll.some((r) => r.action === 'SetMute' && r.args.DesiredMute === 0)).toBe(true);
			const { einstellung } = await import('../src/lib/server/store');
			expect(einstellung('sperre_lautstaerke')).toBe('20');

			// Der Folgelauf wiederholt nur den Lautstärkerückversuch.
			verwaltet.protokoll.length = 0;
			verwaltet.setze(() => ({ ok: true, values: {} }));
			const zweiter = await overtone.sperreDurchsetzen();
			expect(zweiter.ok).toBe(true);
			expect(verwaltet.protokoll.filter(r => !r.action.startsWith('Get')).map((r) => `${r.action}:${r.args.DesiredVolume ?? ''}`)).toEqual([
				'SetVolume:20'
			]);
			expect(einstellung('sperre_lautstaerke')).toBeUndefined();
			// Der bestätigte Stand ist auch lokal angekommen.
			expect(overtone.state.volume).toBe(20);
		} finally {
			vi.useRealTimers();
		}
	});

async function schutzMitGeraet() {
    const ordner = zuhause(); konfigSchreiben(ordner,{ host: '192.168.1.50', uuid: 'RINCON_TEST' }); vi.resetModules();
    const geraet = { transport: 'PLAYING', volume: 20, mute: false, antworten: true, ignorieren: false };
    verwaltet.setze(r => {
        if (r.action.startsWith('Get') && !geraet.antworten) throw new Error('nicht erreichbar');
        if (!geraet.ignorieren) {
            if (r.action === 'Stop') geraet.transport = 'STOPPED';
            if (r.action === 'SetVolume') geraet.volume = Number(r.args.DesiredVolume);
            if (r.action === 'SetMute') geraet.mute = r.args.DesiredMute === 1;
        }
        const values: Record<string,string> = r.action === 'GetTransportInfo' ? { CurrentTransportState: geraet.transport }
            : r.action === 'GetVolume' ? { CurrentVolume: String(geraet.volume) }
            : r.action === 'GetMute' ? { CurrentMute: geraet.mute ? '1' : '0' } : {};
        return { ok: true, values };
    });
    const sperre = await import('../src/lib/server/sperre'); const overtone = await import('../src/lib/server/overtone');
    overtone.state.volume = 20;
    return { geraet, sperre, overtone };
}

it('angenommene Schreibbefehle bestätigen bei widersprechenden Messwerten keinen Schutz', async () => {
    const { geraet, sperre, overtone } = await schutzMitGeraet(); geraet.ignorieren = true; sperre.schnell(60);
    await overtone.sperreDurchsetzen();
    expect(overtone.aktuellerSperrstatus().geraet).toMatchObject({ zustand: 'abweichend', stopp: 'abweichend', lautstaerke: 'abweichend', stumm: 'abweichend', tasten: 'angenommen' });
});

it('gelesene Zustände bestätigen Schutz, Geräteausfall und veraltete Beobachtungen entwerten ihn', async () => {
    vi.useFakeTimers();
    try {
        const { geraet, sperre, overtone } = await schutzMitGeraet(); sperre.schnell(60); await overtone.sperreDurchsetzen();
        expect(overtone.aktuellerSperrstatus().geraet?.zustand).toBe('bestaetigt');
        vi.advanceTimersByTime(16000); expect(overtone.aktuellerSperrstatus().geraet?.zustand).toBe('ungeprueft');
        await overtone.frischVomGeraet(); expect(overtone.aktuellerSperrstatus().geraet?.zustand).toBe('bestaetigt');
        geraet.antworten = false; await overtone.frischVomGeraet(); expect(overtone.aktuellerSperrstatus().geraet?.zustand).toBe('ungeprueft');
        expect(overtone.state.deviceReachable).toBe(false);
    } finally { vi.useRealTimers(); }
});

it('auslaufende Schutzoptionen werden bei weiterhin wirksamer anderer Sperrzeit freigegeben', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026,9,19,21,0));
    try {
        const { geraet, sperre, overtone } = await schutzMitGeraet();
        const basis = { tage: [1], von: '20:00', bis: '22:00' };
        sperre.anlegen({ ...basis, name: 'Stumm', tasten: false, stumm: true });
        sperre.anlegen({ ...basis, bis: '23:00', name: 'Tasten', tasten: true, stumm: false });
        await overtone.sperreDurchsetzen(); expect(geraet.volume).toBe(0); expect(geraet.mute).toBe(true);
        vi.setSystemTime(new Date(2026,9,19,22,0)); await overtone.sperreDurchsetzen();
        expect(geraet.volume).toBe(20); expect(geraet.mute).toBe(false); expect(sperre.status().gesperrt).toBe(true);
        expect(overtone.aktuellerSperrstatus().geraet?.stopp).toBe('bestaetigt');
    } finally { vi.useRealTimers(); }
});

it('Szenen ohne Sender können während einer vorgesehenen Sperre keine Gerätebefehle ausführen', async () => {
    const { sperre } = await schutzMitGeraet();
    const szenen = await import('../src/lib/server/scenes'); const szene = await szenen.createScene({ name: 'Nur Klang', volume: 30, bass: 4 });
    sperre.schnell(60); verwaltet.protokoll.length = 0;
    expect((await szenen.applyScene(szene.scene!.id)).ok).toBe(false); expect(verwaltet.protokoll).toHaveLength(0);
});
