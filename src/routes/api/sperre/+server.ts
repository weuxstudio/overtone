import { json } from '@sveltejs/kit';
import { sperreDurchsetzen, state, aktuellerSperrstatus } from '#lib/server/overtone';
import {
	aendern,
	anlegen,
	fensterListe,
	freigeben,
	freigabeAufheben,
	loeschen,
	pinGesetzt,
	pinPasst,
	pinSetzen,
	schnell,
	setzeGlobal,
	sperreGlobal,
	status
} from '#lib/server/sperre';

function lage() {
	return {
		ok: true,
		status: aktuellerSperrstatus(),
		fenster: fensterListe(),
		pinGesetzt: pinGesetzt(),
		global: sperreGlobal()
	};
}

export async function GET() {
	return json(lage());
}

export async function POST({ request }) {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const aktion = String(body.action ?? '');
	const laufend = status(new Date());

	// Solange eine Sperre laeuft, brauchen Aenderungen den Code. Sonst koennte
	// jedes Kind den Zeitplan einfach umschreiben.
	const geschuetzt = ['create', 'update', 'delete', 'schnell', 'global', 'pin', 'freigabeAufheben'];
	if (geschuetzt.includes(aktion) && laufend.gesperrt && pinGesetzt() && !pinPasst(String(body.pin ?? ''))) {
		return json({ ok: false, message: 'Falscher Code.' }, { status: 403 });
	}

	try {
	switch (aktion) {
		case 'create': {
			const id = anlegen({
				name: String(body.name ?? ''),
				tage: Array.isArray(body.tage) ? body.tage.map((t) => Number(t)) : [],
				von: String(body.von ?? '20:00'),
				bis: String(body.bis ?? '06:30'),
				tasten: body.tasten !== false,
				stumm: body.stumm !== false
			});
			await sperreDurchsetzen();
			return json({ ...lage(), id });
		}
		case 'update': {
			const id = Number(body.id);
			aendern(id, {
				...(body.name !== undefined ? { name: String(body.name) } : {}),
				...(Array.isArray(body.tage) ? { tage: body.tage.map((t) => Number(t)) } : {}),
				...(body.von !== undefined ? { von: String(body.von) } : {}),
				...(body.bis !== undefined ? { bis: String(body.bis) } : {}),
				...(body.aktiv !== undefined ? { aktiv: Boolean(body.aktiv) } : {}),
				...(body.tasten !== undefined ? { tasten: Boolean(body.tasten) } : {}),
				...(body.stumm !== undefined ? { stumm: Boolean(body.stumm) } : {})
			});
			await sperreDurchsetzen();
			return json(lage());
		}
		case 'delete': {
			loeschen(Number(body.id));
			await sperreDurchsetzen();
			return json(lage());
		}
		case 'schnell': {
			const minuten = Math.max(1, Math.min(600, Number(body.minuten ?? 60)));
			schnell(minuten, body.tasten !== false, body.stumm !== false);
			await sperreDurchsetzen();
			return json({ ...lage(), hinweis: `Schnellsperre für ${minuten} Minuten vorgesehen.` });
		}
		case 'freigeben': {
			if (laufend.gesperrt && pinGesetzt() && !pinPasst(String(body.pin ?? ''))) {
				return json({ ok: false, message: 'Falscher Code.' }, { status: 403 });
			}
			const bis = freigeben(Number(body.minuten ?? 30));
			await sperreDurchsetzen();
			return json({ ...lage(), ok: true, freigabeBis: bis, hinweis: 'Freigabe gesetzt.' });
		}
		case 'freigabeAufheben': {
			freigabeAufheben();
			await sperreDurchsetzen();
			return json(lage());
		}
		case 'global': {
			setzeGlobal(Boolean(body.an));
			await sperreDurchsetzen();
			return json(lage());
		}
		case 'pin': {
			const neu = String(body.neu ?? '');
			if (!/^\d{4}$/.test(neu)) return json({ ok: false, message: 'Vier Ziffern nötig.' }, { status: 400 });
			if (pinGesetzt() && !pinPasst(String(body.alt ?? ''))) {
				return json({ ok: false, message: 'Falscher Code.' }, { status: 403 });
			}
			pinSetzen(neu);
			return json({ ...lage(), hinweis: 'Code gespeichert.' });
		}
		case 'status':
			return json(lage());
		default:
			return json({ ok: false, message: 'unbekannte Aktion', ...state.sperre }, { status: 400 });
	}
	} catch (fehler) {
		return json({ ok: false, message: fehler instanceof Error ? fehler.message : String(fehler) }, { status: 400 });
	}
}
