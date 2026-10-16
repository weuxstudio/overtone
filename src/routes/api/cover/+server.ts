import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { error } from '@sveltejs/kit';

// Coverbilder holt der Rechner, nicht der Browser: die Adressen sind teils nur
// im eigenen Netz erreichbar, teils unverschluesselt, was eine verschluesselte
// Seite nicht laden darf. Hier laeuft alles ueber dieselbe Herkunft.
const LAGER = path.join(os.homedir(), '.overtone', 'cache', 'cover');
const HALTBAR = 30 * 60 * 1000;

function endung(typ: string): string {
	if (typ.includes('png')) return 'png';
	if (typ.includes('webp')) return 'webp';
	if (typ.includes('gif')) return 'gif';
	return 'jpg';
}

export async function GET({ url, fetch }) {
	const ziel = url.searchParams.get('u') ?? '';
	let adresse: URL;
	try {
		adresse = new URL(ziel);
	} catch {
		throw error(400, 'keine Adresse');
	}
	if (adresse.protocol !== 'http:' && adresse.protocol !== 'https:') {
		throw error(400, 'nur http und https');
	}

	fs.mkdirSync(LAGER, { recursive: true });
	const kennung = crypto.createHash('sha1').update(adresse.toString()).digest('hex').slice(0, 20);

	for (const art of ['jpg', 'png', 'webp', 'gif']) {
		const pfad = path.join(LAGER, `${kennung}.${art}`);
		if (!fs.existsSync(pfad)) continue;
		const alter = Date.now() - fs.statSync(pfad).mtimeMs;
		if (alter < HALTBAR) {
			const typ = art === 'jpg' ? 'image/jpeg' : `image/${art}`;
			return new Response(new Uint8Array(fs.readFileSync(pfad)), {
				headers: { 'Content-Type': typ, 'Cache-Control': 'public, max-age=1800' }
			});
		}
	}

	try {
		const antwort = await fetch(adresse.toString(), { signal: AbortSignal.timeout(8000) });
		if (!antwort.ok) throw error(502, `Bild kam nicht: ${antwort.status}`);
		const typ = antwort.headers.get('content-type') ?? '';
		if (!typ.startsWith('image/')) throw error(502, 'keine Bilddaten');
		const daten = Buffer.from(await antwort.arrayBuffer());
		if (daten.length < 100 || daten.length > 4 * 1024 * 1024) throw error(502, 'Bildgroesse unpassend');
		const pfad = path.join(LAGER, `${kennung}.${endung(typ)}`);
		fs.writeFileSync(pfad, daten);
		return new Response(new Uint8Array(daten), {
			headers: { 'Content-Type': typ, 'Cache-Control': 'public, max-age=1800' }
		});
	} catch (fehler) {
		if (fehler && typeof fehler === 'object' && 'status' in fehler) throw fehler;
		throw error(502, `Bild nicht ladbar: ${String(fehler)}`);
	}
}
