import { json } from '@sveltejs/kit';
import { command, ensureStarted, playStream, tonAdresse } from '#lib/server/overtone';

// Wiedergabe anstossen und Fehler in eine Meldung verwandeln, statt die
// Anfrage abstuerzen zu lassen.
async function abspielen(adresse: string, titel: string): Promise<{ ok: boolean; message?: string }> {
	try {
		return await playStream(adresse, titel);
	} catch (fehler) {
		return { ok: false, message: `Wiedergabe nicht moeglich: ${String(fehler)}` };
	}
}
import {
	KLAENGE,
	STIMMEN,
	ansagenListe,
	erzeugeAnsage,
	erzeugeKlang,
	gibt,
	loescheAnsage,
	vorhandeneKlaenge
} from '#lib/server/ton';

// Der Lautsprecher holt die Tondateien bei diesem Dienst ab, nicht bei
// 127.0.0.1. Ereignisempfaenger und Audiodateien teilen die Adresserkennung:
// ein ausdruecklich gesetzter callbackHost behaelt Vorrang.
function adresse(datei: string): string {
	return tonAdresse(datei);
}

function lage() {
	return {
		ok: true,
		stimmen: STIMMEN,
		klaenge: KLAENGE,
		vorhanden: vorhandeneKlaenge(),
		ansagen: ansagenListe()
	};
}

export async function GET() {
	await ensureStarted();
	return json(lage());
}

export async function POST({ request }) {
	await ensureStarted();
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const aktion = String(body.action ?? '');

	switch (aktion) {
		case 'ansage': {
			const erzeugt = await erzeugeAnsage(String(body.text ?? ''), String(body.stimme ?? 'Anna'));
			if (!erzeugt.ok || !erzeugt.datei) {
				return json({ ok: false, message: erzeugt.fehler ?? 'Ansage nicht erzeugt.' }, { status: 400 });
			}
			const laut = Number(body.lautstaerke);
			if (Number.isFinite(laut) && laut > 0) {
				await command('volume', Math.max(1, Math.min(60, laut)));
			}
			const gespielt = await abspielen(adresse(erzeugt.datei), 'Ansage');
			if (!gespielt.ok) {
				return json({ ok: false, message: gespielt.message ?? 'Wiedergabe abgelehnt.' }, { status: 502 });
			}
			return json({ ...lage(), hinweis: 'Ansage laeuft.' });
		}
		case 'klang': {
			// Die Minuten sind die Laufzeit, nicht die Laenge des Bandes: das Band
			// laeuft in Schleife, die Ruhezeit stoppt es.
			const minuten = Math.max(5, Math.min(120, Number(body.minuten ?? 30)));
			const erzeugt = await erzeugeKlang(String(body.name ?? 'regen'));
			if (!erzeugt.ok || !erzeugt.datei) {
				return json({ ok: false, message: erzeugt.fehler ?? 'Klang nicht erzeugt.' }, { status: 400 });
			}
			const laut = Number(body.lautstaerke);
			if (Number.isFinite(laut) && laut > 0) {
				await command('volume', Math.max(1, Math.min(60, laut)));
			}
			const gespielt = await abspielen(adresse(erzeugt.datei), 'Klang');
			if (!gespielt.ok) {
				return json({ ok: false, message: gespielt.message ?? 'Wiedergabe abgelehnt.' }, { status: 502 });
			}
			// In Schleife, damit die Nacht nicht nach dreissig Minuten still wird.
			await command('playmode', 'REPEAT_ONE');
			const ruhe = await command('sleep', minuten);
			return json({
				...lage(),
				hinweis: ruhe.ok
					? `${String(body.name ?? 'Klang')} laeuft und hoert nach ${minuten} Minuten von selbst auf.`
					: 'Klang laeuft, die Ruhezeit konnte nicht gesetzt werden.'
			});
		}
		case 'nochmal': {
			const datei = String(body.datei ?? '');
			if (!gibt(datei)) return json({ ok: false, message: 'Diese Ansage gibt es nicht mehr.' }, { status: 404 });
			const gespielt = await abspielen(adresse(datei), 'Ansage');
			if (!gespielt.ok) {
				return json({ ok: false, message: gespielt.message ?? 'Wiedergabe abgelehnt.' }, { status: 502 });
			}
			return json({ ...lage(), hinweis: 'Ansage laeuft.' });
		}
		case 'loeschen': {
			const weg = loescheAnsage(String(body.datei ?? ''));
			return json({ ...lage(), hinweis: weg ? 'Ansage geloescht.' : 'Ansage war schon weg.' });
		}
		case 'stop': {
			const gestoppt = await command('stop');
			await command('playmode', 'NORMAL');
			return json({ ...lage(), ok: gestoppt.ok, hinweis: gestoppt.ok ? 'Gestoppt.' : 'Stoppen abgelehnt.' });
		}
		default:
			return json({ ok: false, message: 'unbekannte Aktion' }, { status: 400 });
	}
}
