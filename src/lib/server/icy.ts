// Laufende Titelangaben aus dem Stream selbst lesen.
// Die Box liefert fuer viele Sender keine laufenden Daten mit, der Stream oft schon.
// Gelesen wird nur der erste Metadatenblock, danach wird die Verbindung geschlossen.

import net from 'node:net';
import tls from 'node:tls';

export type StreamDaten = { titel: string; cover: string; name: string };

export function leseStreamDaten(url: string, zeitlimit = 8000): Promise<StreamDaten | null> {
	return new Promise((fertig) => {
		let adresse: URL;
		try {
			adresse = new URL(url);
		} catch {
			fertig(null);
			return;
		}
		if (adresse.protocol !== 'http:' && adresse.protocol !== 'https:') {
			fertig(null);
			return;
		}

		const sicher = adresse.protocol === 'https:';
		const port = Number(adresse.port || (sicher ? 443 : 80));
		const pfad = `${adresse.pathname}${adresse.search}`;
		let gemeldet = false;
		let puffer = Buffer.alloc(0);
		let kopfEnde = -1;
		let abstand = 0;

		const steckdose = sicher
			? tls.connect({ host: adresse.hostname, port, servername: adresse.hostname })
			: net.connect({ host: adresse.hostname, port });
		steckdose.setTimeout(zeitlimit);

		const schluss = (wert: StreamDaten | null) => {
			if (gemeldet) return;
			gemeldet = true;
			try {
				steckdose.destroy();
			} catch {
				/* schon zu */
			}
			fertig(wert);
		};

		steckdose.on('timeout', () => schluss(null));
		steckdose.on('error', () => schluss(null));
		steckdose.on('close', () => schluss(null));

		steckdose.on('connect', () => {
			steckdose.write(
				`GET ${pfad} HTTP/1.0\r\nHost: ${adresse.hostname}\r\nUser-Agent: Overtone/1.2\r\nIcy-MetaData: 1\r\nConnection: close\r\n\r\n`
			);
		});

		steckdose.on('data', (stueck: Buffer) => {
			puffer = Buffer.concat([puffer, stueck]);
			if (puffer.length > 1024 * 1024) {
				schluss(null);
				return;
			}
			if (kopfEnde < 0) {
				const stelle = puffer.indexOf('\r\n\r\n');
				if (stelle < 0) return;
				kopfEnde = stelle + 4;
				const kopf = puffer.subarray(0, stelle).toString('latin1');
				const treffer = /icy-metaint:\s*(\d+)/i.exec(kopf);
				if (!treffer || Number(treffer[1]) <= 0) {
					// Der Stream liefert keine laufenden Angaben.
					schluss(null);
					return;
				}
				abstand = Number(treffer[1]);
			}
			const blockstart = kopfEnde + abstand;
			if (puffer.length < blockstart + 1) return;
			const laenge = puffer[blockstart] * 16;
			if (laenge === 0) return;
			if (puffer.length < blockstart + 1 + laenge) return;

			const roh = puffer.subarray(blockstart + 1, blockstart + 1 + laenge).toString('utf8');
			const felder: Record<string, string> = {};
			for (const teil of roh.split(';')) {
				const treffer = /^\s*([A-Za-z]+)\s*=\s*'(.*)'\s*$/.exec(teil);
				if (treffer) felder[treffer[1].toLowerCase()] = treffer[2].trim();
			}
			const titel = felder.streamtitle ?? '';
			const anzeige = felder.streamurl ?? '';
			// Nur echte Bildadressen uebernehmen, StreamUrl wird nicht immer fuer Bilder benutzt.
			const cover = /\.(jpe?g|png|webp|gif)(\?|$)/i.test(anzeige) ? anzeige : '';
			schluss({ titel, cover, name: felder.icyname ?? '' });
		});
	});
}
