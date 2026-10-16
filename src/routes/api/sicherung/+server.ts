import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { json } from '@sveltejs/kit';
import { readPlayMode, readSound } from '#lib/server/scenes';
import { pinGesetzt, pinPasst, sperreGlobal } from '#lib/server/sperre';
import { wiederherstellen, vorpruefen, sicherungsInhalt } from '#lib/server/wiederherstellung';

const ORDNER = path.join(os.homedir(), '.overtone', 'sicherungen');


function stempel(): string {
	const d = new Date();
	const z = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

// Alles, was in diesem Dienst entstanden ist, als eine Datei. Das Geraet selbst
// wird nur gelesen, nie beschrieben.
async function sammeln(): Promise<Record<string, unknown>> {
    return { ...await sicherungsInhalt(), sperreGlobal: sperreGlobal(),
        klang: await readSound().catch(() => null), wiedergabeart: await readPlayMode().catch(() => null) };
}

function neuesteDatei(): string | null {
	try {
		const dateien = fs
			.readdirSync(ORDNER)
			.filter((d) => d.endsWith('.json'))
			.sort();
		return dateien.length ? path.join(ORDNER, dateien[dateien.length - 1]) : null;
	} catch {
		return null;
	}
}

export async function GET({ url }) {
	let inhalt: Awaited<ReturnType<typeof sammeln>>;
	try { inhalt = await sammeln(); } catch (e) { return json({ ok: false, message: `Sicherung konnte nicht vollständig gelesen werden: ${String(e)}` }, { status: 503 }); }
	fs.mkdirSync(ORDNER, { recursive: true });
	const datei = path.join(ORDNER, `overtone-${stempel()}.json`);
	fs.writeFileSync(datei, JSON.stringify(inhalt, null, 1), 'utf8');
	const kurz = url.searchParams.get('kurz') === '1';
	const lage = {
		ok: true,
		datei,
		erstellt: inhalt.erstellt,
		anzahl: {
			sender: (inhalt.sender as unknown[]).length,
			szenen: (inhalt.szenen as unknown[]).length,
			weckzeiten: (inhalt.weckzeiten as unknown[]).length,
			sperrzeiten: (inhalt.sperrzeiten as unknown[]).length
		},
		hinweis: `Sicherung geschrieben: ${path.basename(datei)}`
	};
	return json(kurz ? { ok: true, ...lage.anzahl } : lage);
}

export async function POST({ request }) {
	let roh: unknown;
	try {
		roh = await request.json();
	} catch {
		return json({ ok: false, message: 'Anfrage ist kein gültiges JSON.' }, { status: 400 });
	}
	// Null, Listen und einfache Werte sind keine Anfragen; verstaendlich
	// ablehnen statt sie wie eine leere Anfrage zu behandeln.
	if (typeof roh !== 'object' || roh === null || Array.isArray(roh)) {
		return json({ ok: false, message: 'Anfrage muss ein Objekt sein.' }, { status: 400 });
	}
	const body = roh as Record<string, unknown>;
	// Optionale Anfragefelder werden vor ihrer Verwendung auf den Typ geprueft.
	for (const feld of ['action', 'datei', 'pin', 'token'] as const) {
		if (body[feld] !== undefined && typeof body[feld] !== 'string') {
			return json({ ok: false, message: `"${feld}" ist kein Text.` }, { status: 400 });
		}
	}
	const aktion = body.action === undefined ? 'wiederherstellen' : (body.action as string);

	if (!['wiederherstellen','vorpruefen'].includes(aktion)) {
		return json({ ok: false, message: 'unbekannte Aktion' }, { status: 400 });
	}

	// Ein ausdruecklich vorhandenes, ungueltiges inhalt darf nicht rueckwaerts
	// auf die juengste Sicherung ausweichen.
	if (body.inhalt !== undefined) {
		if (typeof body.inhalt !== 'object' || body.inhalt === null || Array.isArray(body.inhalt)) {
			return json({ ok: false, message: '"inhalt" ist kein Objekt.' }, { status: 400 });
		}
	}

	// Die PIN kommt vor saemtlichen Schreibvorgaengen und Geraetebefehlen:
	// fehlend oder falsch heisst 403 und keinerlei Aenderung.
	if (pinGesetzt() && !pinPasst(String(body.pin ?? ''))) {
		return json({ ok: false, message: 'Falscher oder fehlender Code.' }, { status: 403 });
	}

	let quellDatei = '';
	let inhalt: unknown = body.inhalt;
	if (!inhalt) {
		// Pfadanteile trennt path.basename ab; ein leeres Anfrageobjekt waehlt
		// so weiterhin die juengste Sicherung.
		const datei = body.datei ? path.join(ORDNER, path.basename(String(body.datei))) : neuesteDatei();
		if (!datei || !fs.existsSync(datei)) {
			return json({ ok: false, message: 'Keine Sicherung gefunden.' }, { status: 404 });
		}
		quellDatei = datei;
		try {
			inhalt = JSON.parse(fs.readFileSync(datei, 'utf8')) as unknown;
		} catch (fehler) {
			return json({ ok: false, message: `Sicherung nicht lesbar: ${fehler}` }, { status: 400 });
		}
	}

    for (const feld of ['optionen','entscheidungen'] as const) {
        const wert = body[feld];
        if (wert !== undefined && (!wert || typeof wert !== 'object' || Array.isArray(wert))) return json({ ok: false, message: `${feld} muss ein Objekt sein.` }, { status: 400 });
    }
    const optionen = (body.optionen ?? {}) as Record<string, unknown>;
    if (Object.entries(optionen).some(([k,v]) => !['klang','wiedergabeart','zeitplan','aktivieren'].includes(k) || typeof v !== 'boolean')) return json({ ok: false, message: 'Ungültige Auswahl.' }, { status: 400 });
    const entscheidungen = (body.entscheidungen ?? {}) as Record<string, string>;
    if (Object.values(entscheidungen).some(v => typeof v !== 'string')) return json({ ok: false, message: 'Ungültige Konfliktentscheidung.' }, { status: 400 });
    const bericht = aktion === 'vorpruefen' ? await vorpruefen(inhalt) : await wiederherstellen(inhalt, body.token as string | undefined, optionen, entscheidungen);
    const { status: httpStatus, ...daten } = bericht;
    return json({ ok: httpStatus === 200, ...daten, ...(quellDatei ? { datei: path.basename(quellDatei) } : {}) }, { status: httpStatus });
}
