// Ansagen und Klaenge: lokal erzeugt, ueber den Dienst ausgeliefert.
// Ansagen kommen aus `say`, Klaenge berechnet ffmpeg aus Rauschen. Kein Konto, keine Wolke.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const STIMMEN = [
	{ name: 'Anna', text: 'ruhig und klar' },
	{ name: 'Sandy', text: 'freundlich, weich' },
	{ name: 'Shelley', text: 'leicht' },
	{ name: 'Eddy', text: 'maennlich, freundlich' },
	{ name: 'Reed', text: 'maennlich, ruhig' },
	{ name: 'Rocko', text: 'maennlich, kraeftig' },
	{ name: 'Flo', text: 'jung' },
	{ name: 'Grandma', text: 'aeltere Stimme' },
	{ name: 'Grandpa', text: 'aeltere Stimme, maennlich' }
];

export type Klangart = { name: string; titel: string; text: string };

// Ein Band je Klang, das auf dem Geraet in Schleife laeuft. Zehn Minuten
// reichen dafuer: die Datei bleibt klein und ist in Sekunden berechnet.
export const BANDLAENGE = 600;

export const KLAENGE: Klangart[] = [
	{ name: 'regen', titel: 'Regen', text: 'gleichmaessig am Fenster' },
	{ name: 'meer', titel: 'Meer', text: 'Wellen, langsam anschwellend' },
	{ name: 'rauschen', titel: 'Rauschen', text: 'tief, wie im Zug' },
	{ name: 'nacht', titel: 'Nacht', text: 'Grillen und leiser Wind' }
];

const ORDNER = path.join(os.homedir(), '.overtone', 'ton');
const INDEX = path.join(ORDNER, 'index.json');

function ffmpegPfad(): string {
	for (const kandidat of ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg']) {
		try {
			if (kandidat === 'ffmpeg' || fs.existsSync(kandidat)) return kandidat;
		} catch {
			/* weiter suchen */
		}
	}
	return 'ffmpeg';
}

function lauf(befehl: string, argumente: string[]): Promise<{ ok: boolean; fehler: string }> {
	return new Promise((fertig) => {
		const kind = spawn(befehl, argumente);
		let fehler = '';
		kind.stderr.on('data', (d: unknown) => (fehler += String(d)));
		kind.on('error', (e: unknown) => fertig({ ok: false, fehler: String(e) }));
		kind.on('close', (code: number) => fertig({ ok: code === 0, fehler: fehler.slice(-400) }));
	});
}

function ordnerAnlegen(): void {
	fs.mkdirSync(ORDNER, { recursive: true });
}

function leseIndex(): Record<string, { text: string; stimme: string; erstellt: string }> {
	try {
		return JSON.parse(fs.readFileSync(INDEX, 'utf8')) as Record<
			string,
			{ text: string; stimme: string; erstellt: string }
		>;
	} catch {
		return {};
	}
}

function schreibeIndex(daten: Record<string, { text: string; stimme: string; erstellt: string }>): void {
	ordnerAnlegen();
	fs.writeFileSync(INDEX, JSON.stringify(daten, null, 1), 'utf8');
}

export function pfad(datei: string): string {
	return path.join(ORDNER, path.basename(datei));
}

export function gibt(datei: string): boolean {
	return fs.existsSync(pfad(datei));
}

export function ansagenListe(): { datei: string; text: string; stimme: string; erstellt: string }[] {
	const index = leseIndex();
	return Object.entries(index)
		.map(([datei, wert]) => ({ datei, ...wert }))
		.filter((e) => gibt(e.datei))
		.sort((a, b) => (a.erstellt < b.erstellt ? 1 : -1))
		.slice(0, 12);
}

// Text sprechen und als MP3 ablegen. Gleicher Text und gleiche Stimme ergeben
// dieselbe Datei, dann wird nur noch ausgeliefert.
export async function erzeugeAnsage(
	text: string,
	stimme: string
): Promise<{ ok: boolean; datei?: string; fehler?: string }> {
	const rein = text.trim().slice(0, 600);
	if (!rein) return { ok: false, fehler: 'Kein Text eingegeben.' };
	if (!STIMMEN.some((s) => s.name === stimme)) stimme = 'Anna';
	ordnerAnlegen();
	const kurz = crypto.createHash('sha1').update(`${stimme}|${rein}`).digest('hex').slice(0, 12);
	const datei = `ansage-${kurz}.mp3`;
	const ziel = pfad(datei);
	if (fs.existsSync(ziel)) return { ok: true, datei };

	const roh = path.join(ORDNER, `roh-${kurz}.aiff`);
	const sprechen = await lauf('/usr/bin/say', ['-v', stimme, '-o', roh, rein]);
	if (!sprechen.ok) return { ok: false, fehler: `say: ${sprechen.fehler}` };

	// Etwas langsamer und in gleichmaessiger Lautstaerke, damit es auf dem
	// Lautsprecher nicht spitz klingt.
	const wandeln = await lauf(ffmpegPfad(), [
		'-y',
		'-loglevel',
		'error',
		'-i',
		roh,
		'-af',
		'loudnorm=I=-16:TP=-1.5:LRA=11',
		'-ac',
		'1',
		'-ar',
		'44100',
		'-b:a',
		'96k',
		ziel
	]);
	fs.rmSync(roh, { force: true });
	if (!wandeln.ok) return { ok: false, fehler: `ffmpeg: ${wandeln.fehler}` };

	const index = leseIndex();
	index[datei] = { text: rein, stimme, erstellt: new Date().toISOString() };
	schreibeIndex(index);
	return { ok: true, datei };
}

// Klaenge aus Rauschen berechnen. Jede Art hat ihr eigenes Filterbild.
function klangFilter(name: string): string {
	// Pegel fest eingestellt statt loudnorm: loudnorm rechnet zweimal durch die
	// ganze Datei und machte aus Sekunden Minuten.
	switch (name) {
		case 'regen':
			return 'highpass=f=450,lowpass=f=7500,tremolo=f=0.21:d=0.12,volume=1.5,afade=t=in:d=4';
		case 'meer':
			return 'lowpass=f=1400,highpass=f=90,tremolo=f=0.12:d=0.85,volume=1.7,afade=t=in:d=5';
		case 'nacht':
			return 'highpass=f=2600,lowpass=f=9000,tremolo=f=7.5:d=0.9,volume=0.9,afade=t=in:d=5';
		default:
			return 'lowpass=f=3000,highpass=f=40,volume=1.6,afade=t=in:d=4';
	}
}

function klangQuelle(name: string): string {
	if (name === 'regen') return 'anoisesrc=color=white:amplitude=0.55';
	if (name === 'meer') return 'anoisesrc=color=brown:amplitude=0.9';
	if (name === 'nacht') return 'anoisesrc=color=pink:amplitude=0.7';
	return 'anoisesrc=color=brown:amplitude=0.8';
}

export function klangDatei(name: string): string {
	return `klang-${name}.mp3`;
}

export function klangVorhanden(name: string): boolean {
	return fs.existsSync(pfad(klangDatei(name)));
}

export async function erzeugeKlang(
	name: string
): Promise<{ ok: boolean; datei?: string; sekunden?: number; fehler?: string }> {
	const art = KLAENGE.find((k) => k.name === name);
	if (!art) return { ok: false, fehler: 'Unbekannter Klang.' };
	ordnerAnlegen();
	const datei = klangDatei(art.name);
	const ziel = pfad(datei);
	if (fs.existsSync(ziel)) return { ok: true, datei, sekunden: BANDLAENGE };

	const erzeugen = await lauf(ffmpegPfad(), [
		'-y',
		'-loglevel',
		'error',
		'-f',
		'lavfi',
		'-i',
		`${klangQuelle(art.name)}:sample_rate=44100:duration=${BANDLAENGE}`,
		'-af',
		klangFilter(art.name),
		'-ac',
		'1',
		'-ar',
		'44100',
		'-b:a',
		'80k',
		ziel
	]);
	if (!erzeugen.ok) return { ok: false, fehler: `ffmpeg: ${erzeugen.fehler}` };
	return { ok: true, datei, sekunden: BANDLAENGE };
}

export function loescheAnsage(datei: string): boolean {
	const ziel = pfad(datei);
	try {
		fs.rmSync(ziel, { force: true });
	} catch {
		return false;
	}
	const index = leseIndex();
	delete index[path.basename(datei)];
	schreibeIndex(index);
	return true;
}

export function vorhandeneKlaenge(): { name: string; titel: string; datei: string }[] {
	return KLAENGE.filter((art) => fs.existsSync(pfad(klangDatei(art.name)))).map((art) => ({
		name: art.name,
		titel: art.titel,
		datei: klangDatei(art.name)
	}));
}
