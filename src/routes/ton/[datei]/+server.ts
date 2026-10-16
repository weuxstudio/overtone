import fs from 'node:fs';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { pfad } from '#lib/server/ton';

// Liefert die erzeugten Tondateien an den Lautsprecher aus. Der Empfaenger
// fragt oft mit Bereichsangaben, deshalb werden sie beantwortet.
export function GET({ params, request }) {
	const name = String(params.datei ?? '');
	const datei = pfad(name);
	if (!/^[a-z0-9.-]+\.mp3$/i.test(name) || !fs.existsSync(datei)) {
		throw error(404, 'Ton nicht gefunden');
	}

	const groesse = fs.statSync(datei).size;
	const kopf = {
		'Content-Type': 'audio/mpeg',
		'Accept-Ranges': 'bytes',
		'Cache-Control': 'public, max-age=3600'
	};

	// In Stuecken ausliefern, damit auch eine Stunde Klang nicht im Arbeitsspeicher landet.
	const bereich = request.headers.get('range');
	if (bereich) {
		const treffer = bereich.match(/bytes=(\d*)-(\d*)/);
		const von = treffer && treffer[1] ? Number(treffer[1]) : 0;
		const bis = treffer && treffer[2] ? Math.min(Number(treffer[2]), groesse - 1) : groesse - 1;
		if (von >= groesse || von > bis) {
			return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${groesse}` } });
		}
		const laenge = bis - von + 1;
		const stueck = Readable.toWeb(fs.createReadStream(datei, { start: von, end: bis }));
		return new Response(stueck as ReadableStream, {
			status: 206,
			headers: {
				...kopf,
				'Content-Range': `bytes ${von}-${bis}/${groesse}`,
				'Content-Length': String(laenge)
			}
		});
	}

	const ganz = Readable.toWeb(fs.createReadStream(datei));
	return new Response(ganz as ReadableStream, {
		status: 200,
		headers: { ...kopf, 'Content-Length': String(groesse) }
	});
}
