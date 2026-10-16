// Overtone: local control service for a Sonos speaker.
// Keeps one event subscription per service, holds the current state and pushes
// updates to the user interface through server sent events.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { call, unescapeXml } from './sonos';
import { alarmRow, einstellung, loescheEinstellung, setzeEinstellung } from './store';
import { aufraeumen as sperrenAufraeumen, status as sperreStatus, type Sperrstatus } from './sperre';
import { leseStreamDaten } from './icy';

export type OvertoneState = {
	host: string;
	zoneName: string;
	transportState: string;
	volume: number | null;
	mute: boolean;
	trackTitle: string;
	trackURI: string;
	relTime: string;
	duration: string;
	updated: string;
	events: number;
	lastError: string;
	klang: { bass: number | null; treble: number | null; loudness: number | null };
	led: string;
	playMode: string;
	crossfade: number | null;
	laufenderTitel: string;
	cover: string;
	metaQuelle: string;
	sperre: Sperrstatus;
};

const CONFIG_DIR = path.join(os.homedir(), '.overtone');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

type Config = {
	host: string;
	uuid: string;
	callbackHost: string;
	notifyPort: number;
	serviceName: string;
};

function loadConfig(): Config {
	// Left empty on purpose: address and identifier of the speaker belong to the
	// installation, not to the source. Fill them in ~/.overtone/config.json.
	const defaults: Config = {
		host: '',
		uuid: '',
		callbackHost: '',
		notifyPort: 8771,
		serviceName: 'Overtone'
	};
	try {
		const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
		return { ...defaults, ...raw };
	} catch {
		try {
			fs.mkdirSync(CONFIG_DIR, { recursive: true });
			fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaults, null, 2));
		} catch {
			/* read only fallback */
		}
		return defaults;
	}
}

export const config = loadConfig();

export const state: OvertoneState = {
	host: config.host,
	zoneName: '',
	transportState: 'UNKNOWN',
	volume: null,
	mute: false,
	trackTitle: '',
	trackURI: '',
	laufenderTitel: '',
	cover: '',
	metaQuelle: '',
	relTime: '',
	duration: '',
	updated: '',
	events: 0,
	lastError: '',
	klang: { bass: null, treble: null, loudness: null },
	led: '',
	playMode: '',
	crossfade: null,
	sperre: {
		gesperrt: false,
		bis: '',
		name: '',
		tasten: false,
		stumm: false,
		schnell: false,
		freigabeBis: '',
		global: true
	}
};

// ---------------------------------------------------------------- push channel

type Client = { write: (chunk: string) => void };
const clients = new Set<Client>();

export function addClient(client: Client): void {
	clients.add(client);
	client.write(`data: ${JSON.stringify(state)}\n\n`);
}

export function removeClient(client: Client): void {
	clients.delete(client);
}

function broadcast(): void {
	const payload = `data: ${JSON.stringify(state)}\n\n`;
	for (const c of clients) {
		try {
			c.write(payload);
		} catch {
			clients.delete(c);
		}
	}
}

// ------------------------------------------------------------- event handling

// The device often reports a plain file name or address as title for radio
// streams. Then the name from our own station list is the better answer, found
// by the current address. If nothing fits, an empty title beats a file name.
function stationForUri(uri: string, stations: Station[]): Station | undefined {
	if (!uri) return undefined;
	return stations.find((s) => {
		const a = uri.toLowerCase();
		const b = s.url.toLowerCase();
		return a.startsWith(b.slice(0, 40)) || b.startsWith(a.slice(0, 40));
	});
}

function brauchbar(titel: string, uri = ''): boolean {
	if (!titel) return false;
	if (/\.(mp3|aac|m4a|ogg|wav)$/i.test(titel)) return false;
	if (titel.includes('://')) return false;
	// Titles taken from the address itself, for example "mp3-192", are not names.
	if (uri && titel.length >= 3 && uri.toLowerCase().includes(titel.toLowerCase())) return false;
	return true;
}

function waehleTitel(neu: string, alt: string, uri = ''): string {
	if (brauchbar(neu, uri)) return neu;
	const treffer = stationForUri(uri, loadStations());
	if (treffer) return treffer.name;
	return brauchbar(alt, uri) ? alt : '';
}

function readEvent(body: string): Record<string, string> {
	// The NOTIFY body is escaped more than once. Unwrap until real tags appear.
	let text = body;
	for (let i = 0; i < 3; i++) {
		if (/<[A-Za-z]/.test(text) && !text.includes('&lt;TransportState')) break;
		text = unescapeXml(text);
	}
	const out: Record<string, string> = {};
	const re = /(?:<|&lt;)([A-Za-z:]+)\s+val\s*=\s*"([^"]*)"/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		const name = m[1].includes(':') ? m[1].split(':')[1] : m[1];
		out[name] = unescapeXml(m[2]);
	}
	return out;
}

function applyEvent(values: Record<string, string>): void {
	let changed = false;
	if ('TransportState' in values && values.TransportState !== state.transportState) {
		state.transportState = values.TransportState;
		changed = true;
	}
	if ('CurrentTrackURI' in values) state.trackURI = values.CurrentTrackURI;
	if ('CurrentTrackDuration' in values) state.duration = values.CurrentTrackDuration;
	if ('CurrentTrackMetaData' in values) {
		nimmMetadaten(values.CurrentTrackMetaData);
		state.cover = coverAusDaten(values.CurrentTrackMetaData, state.cover);
	}
	if ('CurrentVolume' in values) {
		const v = Number(values.CurrentVolume);
		if (!Number.isNaN(v) && v !== state.volume) {
			state.volume = v;
			changed = true;
		}
	}
	if ('Mute' in values) {
		const m = values.Mute === '1' || values.Mute === 'true';
		if (m !== state.mute) {
			state.mute = m;
			changed = true;
		}
	}
	if ('ZoneName' in values) state.zoneName = values.ZoneName;
	state.updated = new Date().toISOString();
	state.events += 1;
	if (changed || state.events % 5 === 0) broadcast();
	// Waehrend einer Sperre sofort nachfassen, wenn etwas startet.
	if (state.sperre.gesperrt && ['PLAYING', 'PAUSED_PLAYBACK', 'TRANSITIONING'].includes(state.transportState)) {
		void sperreDurchsetzen();
	}
}

// ------------------------------------------------------------------ listener

function callbackAddress(): string {
	if (config.callbackHost) return config.callbackHost;
	const subnet = config.host.split('.').slice(0, 3).join('.') + '.';
	const kandidaten: string[] = [];
	for (const list of Object.values(os.networkInterfaces())) {
		for (const entry of list ?? []) {
			if (entry.family === 'IPv4' && !entry.internal) kandidaten.push(entry.address);
		}
	}
	// The device can only reach us on the same network, never over a VPN address.
	return kandidaten.find((a) => a.startsWith(subnet)) ?? kandidaten[0] ?? '127.0.0.1';
}

async function subscribe(
	service: string,
	eventPath: string,
	myHost: string,
	aboPort: number
): Promise<void> {
	try {
		const res = await fetch(`http://${config.host}:1400${eventPath}`, {
			method: 'SUBSCRIBE',
			headers: {
				CALLBACK: `<http://${myHost}:${aboPort}/notify>`,
				NT: 'upnp:event',
				TIMEOUT: 'Second-1800'
			}
		});
		const sid = res.headers.get('sid') ?? '';
		const timeout = res.headers.get('timeout') ?? '';
		console.log(`[overtone] Abo ${service} ${res.status} ${sid} ${timeout}`);
	} catch (err) {
		console.error('[overtone] Abo fehlgeschlagen', service, String(err));
	}
}

// Coveradresse aus den Metadaten der Box, ueber den eigenen Dienst geholt.
// Laufende Titelangaben aus dem Stream haben Vorrang.
function coverAusDaten(rohMeta: string, bisheriges: string): string {
	if (!rohMeta) return bisheriges;
	const treffer = /albumArtURI[^>]*>([^<]+)</.exec(rohMeta);
	if (!treffer) return bisheriges;
	const adresse = unescapeXml(treffer[1]);
	if (!adresse.startsWith('http')) return bisheriges;
	return `/api/cover?u=${encodeURIComponent(adresse)}`;
}

// Laufende Titelangaben beim Stream selbst holen. Die Box liefert sie fuer
// viele Sender nicht mit, der Stream oft schon.
async function holeLaufendeAngaben(): Promise<void> {
	const uri = state.trackURI;
	if (!uri.startsWith('http')) return;
	if (uri.includes(`://${config.callbackHost}:`) || uri.includes('://127.0.0.1:')) {
		// Eigene Ansagen und Klaenge haben keine laufenden Angaben.
		state.laufenderTitel = '';
		state.metaQuelle = '';
		return;
	}
	const daten = await leseStreamDaten(uri).catch(() => null);
	if (!daten) {
		state.metaQuelle = '';
		return;
	}
	state.laufenderTitel = daten.titel;
	state.metaQuelle = daten.titel ? 'Streamdaten' : '';
	if (daten.cover) state.cover = `/api/cover?u=${encodeURIComponent(daten.cover)}`;
}

async function frischLautstaerke(): Promise<void> {
	try {
		const vol = await call(config.host, 'RenderingControl', 'GetVolume', { InstanceID: 0, Channel: 'Master' });
		const mute = await call(config.host, 'RenderingControl', 'GetMute', { InstanceID: 0, Channel: 'Master' });
		let geaendert = false;
		if (vol.ok) {
			const wert = Number(vol.values.CurrentVolume);
			if (!Number.isNaN(wert) && wert !== state.volume) {
				state.volume = wert;
				geaendert = true;
			}
		}
		if (mute.ok) {
			const stumm = mute.values.CurrentMute === '1';
			if (stumm !== state.mute) {
				state.mute = stumm;
				geaendert = true;
			}
		}
		if (geaendert) broadcast();
	} catch {
		/* Geraet gerade nicht da */
	}
}

// Sonos-eigene Quellen (Spotify Connect, Apple Music, eigene Bibliothek) tragen
// eine Adresse mit dem Praefix x-sonos-. Solche Sitzungen darf man nicht mit
// SetAVTransportURI anfassen, das reisst die laufende Sitzung ab.
function istSonosQuelle(uri: string): boolean {
	return /^x-sonos-/i.test(uri);
}

// Angaben aus den DIDL-Metadaten der Box ziehen.
function ausDidl(roh: string): { titel: string; interpret: string; cover: string; klasse: string } {
	const hol = (muster: RegExp) => {
		const t = muster.exec(roh);
		return t ? unescapeXml(t[1]).trim() : '';
	};
	return {
		titel: hol(/<dc:title>([^<]*)<\/dc:title>/),
		interpret: hol(/<dc:creator>([^<]*)<\/dc:creator>/),
		cover: hol(/<upnp:albumArtURI[^>]*>([^<]*)<\/upnp:albumArtURI>/),
		klasse: hol(/<upnp:class>([^<]*)<\/upnp:class>/)
	};
}

// Titel, Interpret und Cover aus den Metadaten uebernehmen. Bei eigenen Streams
// bleibt es beim Sendernamen, die laufenden Angaben kommen dort aus dem Stream.
function nimmMetadaten(roh: string): void {
	if (!roh) return;
	const d = ausDidl(roh);
	if (!d.titel) return;
	// Eigene Ansagen und Klaenge: die Box meldet nur den Dateinamen.
	if (state.trackURI.includes('/ton/')) {
		const datei = decodeURIComponent(state.trackURI.split('/ton/').pop() ?? '');
		const ohneEndung = datei.replace(/\.mp3$/i, '');
		const teile = ohneEndung.split('-');
		// Ansagen tragen nur einen Zufallswert im Namen, Klaenge einen Klangnamen.
		const art = teile[0] === 'ansage' ? 'Ansage' : teile[0] === 'klang' ? 'Klang' : '';
		const name = teile[0] === 'klang' && teile.length > 1 ? teile[1] : '';
		state.trackTitle = art ? (name ? `${art}: ${name.charAt(0).toUpperCase()}${name.slice(1)}` : art) : '';
		state.laufenderTitel = '';
		state.metaQuelle = '';
		return;
	}
	if (istSonosQuelle(state.trackURI)) {
		state.trackTitle = d.titel;
		if (d.interpret) {
			state.laufenderTitel = `${d.interpret} - ${d.titel}`;
			state.metaQuelle = /spotify/i.test(roh) ? 'Spotify' : 'Bibliothek';
		}
		if (d.cover) state.cover = `/api/cover?u=${encodeURIComponent(d.cover)}`;
		return;
	}
	state.trackTitle = waehleTitel(d.titel, state.trackTitle, state.trackURI);
	if (d.cover && !state.cover) state.cover = `/api/cover?u=${encodeURIComponent(d.cover)}`;
}

// Taktgeber: die Ereignisse der Box sterben bei einer Spotify-Sitzung, danach
// stand der Dienst auf alten Werten und die Bedienung arbeitete auf altem Stand.
// Deshalb alle fuenf Sekunden direkt am Geraet nachsehen.
// Ohne eingetragenen Lautsprecher braucht es keine Abfrage, aber einen Hinweis.
function ohneGeraet(): boolean {
	if (config.host) return false;
	state.lastError =
		'Kein Lautsprecher eingetragen. Adresse in ~/.overtone/config.json unter host eintragen.';
	return true;
}

async function frischVomGeraet(): Promise<void> {
	if (ohneGeraet()) {
		broadcast();
		return;
	}
	try {
		const [trans, pos, vol, mute] = await Promise.all([
			call(config.host, 'AVTransport', 'GetTransportInfo', { InstanceID: 0 }),
			call(config.host, 'AVTransport', 'GetPositionInfo', { InstanceID: 0 }),
			call(config.host, 'RenderingControl', 'GetVolume', { InstanceID: 0, Channel: 'Master' }),
			call(config.host, 'RenderingControl', 'GetMute', { InstanceID: 0, Channel: 'Master' })
		]);
		const vorher = JSON.stringify([
			state.transportState,
			state.trackURI,
			state.trackTitle,
			state.laufenderTitel,
			state.metaQuelle,
			state.cover,
			state.duration,
			state.relTime,
			state.volume,
			state.mute
		]);
		if (trans.ok) {
			const neu = trans.values.CurrentTransportState;
			if (neu && neu !== state.transportState) state.transportState = neu;
		}
		if (pos.ok) {
			if (pos.values.TrackURI) state.trackURI = pos.values.TrackURI;
			state.duration = pos.values.TrackDuration ?? state.duration;
			state.relTime = pos.values.RelTime ?? state.relTime;
			nimmMetadaten(pos.values.TrackMetaData ?? '');
		}
		if (vol.ok) {
			const wert = Number(vol.values.CurrentVolume);
			if (!Number.isNaN(wert)) state.volume = wert;
		}
		if (mute.ok) state.mute = mute.values.CurrentMute === '1';
		const nachher = JSON.stringify([
			state.transportState,
			state.trackURI,
			state.trackTitle,
			state.laufenderTitel,
			state.metaQuelle,
			state.cover,
			state.duration,
			state.relTime,
			state.volume,
			state.mute
		]);
		if (vorher !== nachher) {
			state.updated = new Date().toISOString();
			broadcast();
		}
	} catch {
		/* Geraet gerade nicht erreichbar */
	}
}

async function refreshPosition(): Promise<void> {
	try {
		const info = await call(config.host, 'AVTransport', 'GetPositionInfo', { InstanceID: 0 });
		if (info.ok) {
			state.relTime = info.values.RelTime ?? '';
			state.duration = info.values.TrackDuration ?? state.duration;
			broadcast();
		}
	} catch {
		/* device may be busy */
	}
}

// A running alarm plays from the device queue, so the reported title is a file
// name. The alarm list knows the station, that name is the right one.
async function syncAlarmTitle(): Promise<void> {
	try {
		const props = await call(config.host, 'AVTransport', 'GetRunningAlarmProperties', { InstanceID: 0 });
		const id = Number(props.values.AlarmID ?? 0);
		if (!props.ok || !id) return;
		const row = alarmRow(id);
		const name = loadStations().find((s) => s.id === row?.station_id)?.name ?? row?.label ?? '';
		if (name && state.trackTitle !== name) {
			state.trackTitle = name;
			broadcast();
		}
	} catch {
		/* the device may be busy */
	}
}

async function readDeviceInfo(): Promise<void> {
	try {
		const res = await fetch(`http://${config.host}:1400/xml/device_description.xml`);
		const xml = await res.text();
		const name = xml.match(/<roomName>([^<]*)<\/roomName>/);
		if (name) state.zoneName = name[1];
		const vol = await call(config.host, 'RenderingControl', 'GetVolume', { InstanceID: 0, Channel: 'Master' });
		if (vol.ok) state.volume = Number(vol.values.CurrentVolume);
		const mute = await call(config.host, 'RenderingControl', 'GetMute', { InstanceID: 0, Channel: 'Master' });
		if (mute.ok) state.mute = mute.values.CurrentMute === '1';
		const transport = await call(config.host, 'AVTransport', 'GetTransportInfo', { InstanceID: 0 });
		if (transport.ok) state.transportState = transport.values.CurrentTransportState ?? state.transportState;
		const media = await call(config.host, 'AVTransport', 'GetMediaInfo', { InstanceID: 0 });
		if (media.ok) {
			state.trackURI = media.values.CurrentURI ?? '';
			const rohMeta = media.values.CurrentURIMetaData ?? '';
			const t = rohMeta.match(/<dc:title>([^<]*)<\/dc:title>/);
			state.trackTitle = waehleTitel(t ? unescapeXml(t[1]) : '', state.trackTitle, state.trackURI);
			state.cover = coverAusDaten(rohMeta, state.cover);
		}
		const led = await call(config.host, 'DeviceProperties', 'GetLEDState', {});
		if (led.ok) state.led = led.values.CurrentLEDState ?? state.led;
		const einstellungen = await call(config.host, 'AVTransport', 'GetTransportSettings', { InstanceID: 0 });
		if (einstellungen.ok) {
			state.playMode =
				einstellungen.values.CurrentPlayMode ?? einstellungen.values.PlayMode ?? state.playMode;
		}
		// Das Ueberblenden liefert diese Box nicht in GetTransportSettings,
		// sondern nur ueber einen eigenen Befehl. Am Geraet gemessen 15.10.2026.
		const ueberblenden = await call(config.host, 'AVTransport', 'GetCrossfadeMode', { InstanceID: 0 });
		if (ueberblenden.ok) {
			const cf = ueberblenden.values.CrossfadeMode ?? ueberblenden.values.CurrentCrossfadeMode;
			if (cf !== undefined) state.crossfade = Number(cf);
		}
		const bass = await call(config.host, 'RenderingControl', 'GetBass', { InstanceID: 0, Channel: 'Master' });
		const hoehen = await call(config.host, 'RenderingControl', 'GetTreble', { InstanceID: 0, Channel: 'Master' });
		const loudness = await call(config.host, 'RenderingControl', 'GetLoudness', { InstanceID: 0, Channel: 'Master' });
		state.klang = {
			bass: bass.ok ? Number(bass.values.CurrentBass) : null,
			treble: hoehen.ok ? Number(hoehen.values.CurrentTreble) : null,
			loudness: loudness.ok ? Number(loudness.values.CurrentLoudness) : null
		};
	} catch (err) {
		state.lastError = String(err);
		console.error('[overtone] Zustandsabfrage fehlgeschlagen', String(err));
	}
}

// ------------------------------------------------------------------- startup

type Runtime = { started: boolean; server?: http.Server };

const globalKey = '__overtone_runtime__';
const runtime: Runtime = ((globalThis as Record<string, unknown>)[globalKey] as Runtime) ?? { started: false };
(globalThis as Record<string, unknown>)[globalKey] = runtime;

// ------------------------------------------------------- Kindersicherung

let sperreAktiv = false;
let tastenGesperrt = false;
let startAbgleich = true;

async function setzeTastensperre(an: boolean): Promise<boolean> {
	const r = await call(config.host, 'DeviceProperties', 'SetButtonLockState', {
		DesiredButtonLockState: an ? 'On' : 'Off'
	});
	tastenGesperrt = an && r.ok;
	return r.ok;
}

// Setzt eine laufende Sperre am Geraet durch: Wiedergabe stoppen, Lautstaerke auf
// null, Tasten sperren. Wird zyklisch gerufen, damit auch Spotify, die Sonos App
// oder eine Weckzeit die Sperre nicht aushebeln.
export async function sperreDurchsetzen(): Promise<void> {
	const st = sperreStatus(new Date());
	const host = config.host;
	// Der Sperrzustand geht immer an die Oberflaeche, auch wenn das Geraet
	// gerade nicht antwortet.
	if (state.sperre.gesperrt !== st.gesperrt || state.sperre.freigabeBis !== st.freigabeBis) {
		state.sperre = st;
		broadcast();
	} else {
		state.sperre = st;
	}
	const ruhe = !st.gesperrt && !sperreAktiv && !startAbgleich;
	if (ruhe) {
		sperrenAufraeumen();
		return;
	}
	try {
		if (st.gesperrt) {
			if (!sperreAktiv) {
				// Beginn der Sperre: Lautstaerke merken, damit sie danach zurueckkommt.
				const vorher =
					typeof state.volume === 'number' ? state.volume : Number(einstellung('sperre_lautstaerke') ?? '');
				if (Number.isFinite(vorher) && vorher > 0) setzeEinstellung('sperre_lautstaerke', String(vorher));
				await call(host, 'AVTransport', 'Stop', { InstanceID: 0 });
			} else if (['PLAYING', 'PAUSED_PLAYBACK', 'TRANSITIONING'].includes(state.transportState)) {
				await call(host, 'AVTransport', 'Stop', { InstanceID: 0 });
			}
			if (st.tasten && !tastenGesperrt) await setzeTastensperre(true);
			if (st.stumm) {
				if (state.volume === null || state.volume > 0) {
					await call(host, 'RenderingControl', 'SetVolume', {
						InstanceID: 0,
						Channel: 'Master',
						DesiredVolume: 0
					});
				}
				if (!state.mute) {
					await call(host, 'RenderingControl', 'SetMute', { InstanceID: 0, Channel: 'Master', DesiredMute: 1 });
				}
			}
			sperreAktiv = true;
		} else {
			// Ende der Sperre oder Dienststart ohne Sperre: Geraet wieder freigeben.
			// Gelingt die Freigabe nicht, wird sie beim naechsten Durchlauf wiederholt.
			if (startAbgleich || tastenGesperrt) {
				const ok = await setzeTastensperre(false);
				if (ok) {
					startAbgleich = false;
					tastenGesperrt = false;
				}
			}
			const vorher = Number(einstellung('sperre_lautstaerke') ?? '');
			if (Number.isFinite(vorher) && vorher > 0) {
				await call(host, 'RenderingControl', 'SetMute', { InstanceID: 0, Channel: 'Master', DesiredMute: 0 });
				const r = await call(host, 'RenderingControl', 'SetVolume', {
					InstanceID: 0,
					Channel: 'Master',
					DesiredVolume: vorher
				});
				if (r.ok) loescheEinstellung('sperre_lautstaerke');
			}
			sperreAktiv = false;
		}
		sperrenAufraeumen();
		state.sperre = st;
		await readDeviceInfo();
		broadcast();
	} catch (err) {
		state.lastError = String(err);
		broadcast();
	} finally {
		startAbgleich = false;
	}
}

export async function ensureStarted(): Promise<void> {
	if (runtime.started) return;
	runtime.started = true;

	const myHost = callbackAddress();
	await readDeviceInfo();

	runtime.server = http.createServer((req, res) => {
		if (req.method === 'NOTIFY') {
			let body = '';
			req.on('data', (chunk) => (body += chunk));
			req.on('end', () => {
				try {
					applyEvent(readEvent(body));
				} catch (err) {
					console.error('[overtone] Ereignis unlesbar', String(err));
				}
				res.writeHead(200, { 'Content-Length': '0' });
				res.end();
			});
			return;
		}
		res.writeHead(404, { 'Content-Length': '0' });
		res.end();
	});
	// Haelt ein alter Prozess den Abopuffer, wandern die Ereignisse dorthin und
	// der Zustand hier bleibt stehen. Deshalb den ersten freien Port nehmen und
	// genau den beim Geraet anmelden.
	const aboServer = runtime.server;
	let aboPort = config.notifyPort;
	if (aboServer) {
		for (let versuch = 0; versuch < 6; versuch++) {
			try {
				await new Promise<void>((fertig, schief) => {
					const beiFehler = (err: NodeJS.ErrnoException) => schief(err);
					aboServer.once('error', beiFehler);
					aboServer.listen(config.notifyPort + versuch, '0.0.0.0', () => {
						aboServer.off('error', beiFehler);
						fertig();
					});
				});
				aboPort = config.notifyPort + versuch;
				break;
			} catch (fehler) {
				console.error(`[overtone] Abopuffer Port ${config.notifyPort + versuch} belegt: ${String(fehler)}`);
			}
		}
	}
	console.log(`[overtone] Ereignisempfaenger auf ${myHost}:${aboPort}`);

	// Beim Beenden muss der Ereignisempfaenger mit schliessen. Sonst haelt genau
	// dieser Horcher den Prozess am Leben: der Dienst laeuft nach dem Stoppsignal
	// weiter, ein Neustart bekommt einen Ausweichport und die Ereignisse der Box
	// landen abwechselnd bei beiden Prozessen. Notausstieg nach drei Sekunden,
	// falls noch etwas anderes festhaelt.
	const beimBeenden = () => {
		try {
			runtime.server?.close();
		} catch {
			// Nur loslassen, Fehler dabei sind belanglos.
		}
		setTimeout(() => process.exit(0), 3000).unref();
	};
	process.once('sveltekit:shutdown', beimBeenden);
	process.once('SIGTERM', beimBeenden);
	process.once('SIGINT', beimBeenden);

	const abos: Array<[string, string]> = [
		['AVTransport', '/MediaRenderer/AVTransport/Event'],
		['RenderingControl', '/MediaRenderer/RenderingControl/Event'],
		['ZoneGroupTopology', '/ZoneGroupTopology/Event']
	];
	const abnehmen = () => {
		for (const [service, eventPath] of abos) void subscribe(service, eventPath, myHost, aboPort);
	};
	abnehmen();
	setInterval(abnehmen, 15 * 60 * 1000);
	setInterval(() => {
		void frischVomGeraet();
	}, 5000);
	// Laufende Titelangaben alle zwanzig Sekunden nachsehen, solange gespielt wird.
	setInterval(() => {
		if (state.transportState !== 'PLAYING') return;
		void holeLaufendeAngaben();
	}, 20000);
	// Lautstaerke und Stummschaltung regelmaessig selbst nachlesen. Ein einzelnes
	// altes Ereignis (etwa aus der Zeit der Kindersicherung) hat den Wert sonst
	// dauerhaft festgehalten, waehrend das Geraet laengst anders stand.

	setInterval(() => {
		if (state.transportState === 'PLAYING') void syncAlarmTitle();
	}, 15000);
	setInterval(() => void readDeviceInfo(), 5 * 60 * 1000);
	// Kindersicherung: alle 10 Sekunden nachsehen und ggf. am Geraet durchsetzen.
	void sperreDurchsetzen();
	setInterval(() => void sperreDurchsetzen(), 10000);
}

export async function command(
	action: string,
	value?: string | number | boolean
): Promise<SoapResultBrief> {
	await ensureStarted();
	const laufendeSperre = sperreStatus(new Date());
	if (laufendeSperre.gesperrt) {
		return { ok: false, message: `Kindersicherung: gesperrt bis ${laufendeSperre.bis || 'Fensterende'}` };
	}
	const host = config.host;
	try {
		switch (action) {
			case 'play': {
				// Steht die Wiedergabe, reicht Play allein nicht: die Box bleibt
				// stehen. Dann die Adresse neu setzen und danach starten. Am Geraet
				// gemessen am 15.10.2026.
				if (
					state.transportState === 'STOPPED' &&
					state.trackURI &&
					/^https?:/i.test(state.trackURI) &&
					!istSonosQuelle(state.trackURI)
				) {
					const { didlForHttpAudio } = await import('./sonos');
					await call(host, 'AVTransport', 'SetAVTransportURI', {
						InstanceID: 0,
						CurrentURI: state.trackURI,
						CurrentURIMetaData: didlForHttpAudio(state.trackURI, state.trackTitle || 'Wiedergabe')
					});
				}
				return brief(await call(host, 'AVTransport', 'Play', { InstanceID: 0, Speed: 1 }));
			}
			case 'pause':
				return brief(await call(host, 'AVTransport', 'Pause', { InstanceID: 0 }));
			case 'stop':
				return brief(await call(host, 'AVTransport', 'Stop', { InstanceID: 0 }));
			case 'next':
				return brief(await call(host, 'AVTransport', 'Next', { InstanceID: 0 }));
			case 'previous':
				return brief(await call(host, 'AVTransport', 'Previous', { InstanceID: 0 }));
			case 'volume': {
				const v = Math.max(0, Math.min(100, Number(value ?? 0)));
				const r = await call(host, 'RenderingControl', 'SetVolume', { InstanceID: 0, Channel: 'Master', DesiredVolume: v });
				if (r.ok) state.volume = v;
				return brief(r);
			}
			case 'mute': {
				const on = value === 1 || value === '1' || value === true || value === 'true';
				const r = await call(host, 'RenderingControl', 'SetMute', { InstanceID: 0, Channel: 'Master', DesiredMute: on ? 1 : 0 });
				if (r.ok) state.mute = on;
				return brief(r);
			}
			case 'bass': {
				const v = Math.max(-10, Math.min(10, Number(value ?? 0)));
				const r = await call(host, 'RenderingControl', 'SetBass', {
					InstanceID: 0,
					Channel: 'Master',
					DesiredBass: v
				});
				if (r.ok) state.klang = { ...state.klang, bass: v };
				return brief(r);
			}
			case 'treble': {
				const v = Math.max(-10, Math.min(10, Number(value ?? 0)));
				const r = await call(host, 'RenderingControl', 'SetTreble', {
					InstanceID: 0,
					Channel: 'Master',
					DesiredTreble: v
				});
				if (r.ok) state.klang = { ...state.klang, treble: v };
				return brief(r);
			}
			case 'loudness': {
				const an = value === 1 || value === '1' || value === true || value === 'true';
				const r = await call(host, 'RenderingControl', 'SetLoudness', {
					InstanceID: 0,
					Channel: 'Master',
					DesiredLoudness: an ? 1 : 0
				});
				if (r.ok) state.klang = { ...state.klang, loudness: an ? 1 : 0 };
				return brief(r);
			}
			case 'led': {
				const an = value === 1 || value === '1' || value === true || value === 'true';
				const r = await call(host, 'DeviceProperties', 'SetLEDState', { DesiredLEDState: an ? 'On' : 'Off' });
				if (r.ok) state.led = an ? 'On' : 'Off';
				return brief(r);
			}
			case 'playmode': {
				const erlaubt = ['NORMAL', 'SHUFFLE_NOREPEAT', 'REPEAT_ALL', 'REPEAT_ONE', 'SHUFFLE'];
				const wert = String(value ?? 'NORMAL').toUpperCase();
				if (!erlaubt.includes(wert)) return { ok: false, message: 'unbekannte Wiedergabeart: ' + wert };
				const r = await call(host, 'AVTransport', 'SetPlayMode', { InstanceID: 0, NewPlayMode: wert });
				if (r.ok) state.playMode = wert;
				return brief(r);
			}
			case 'crossfade': {
				const an = value === 1 || value === '1' || value === true || value === 'true';
				const r = await call(host, 'AVTransport', 'SetCrossfadeMode', { InstanceID: 0, NewCrossfadeMode: an ? 1 : 0 });
				if (r.ok) state.crossfade = an ? 1 : 0;
				return brief(r);
			}
			case 'sleep': {
				const v = Number(value ?? 0);
				const r = await call(host, 'AVTransport', 'ConfigureSleepTimer', {
					InstanceID: 0,
					NewSleepTimerDuration: v > 0 ? minutesToClock(v) : ''
				});
				return brief(r);
			}
			default:
				return { ok: false, message: 'unbekannter Befehl: ' + action };
		}
	} catch (err) {
		state.lastError = String(err);
		return { ok: false, message: String(err) };
	} finally {
		setTimeout(() => void readDeviceInfo(), 400);
	}
}

export type SoapResultBrief = { ok: boolean; errorCode?: number; message?: string };

function brief(r: { ok: boolean; errorCode?: number; xml: string }): SoapResultBrief {
	return { ok: r.ok, errorCode: r.errorCode, message: r.ok ? undefined : r.xml.slice(0, 200) };
}

function minutesToClock(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = Math.round(minutes % 60);
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

export type Station = { id: string; name: string; url: string };

const STATIONS_FILE = path.join(CONFIG_DIR, 'stations.json');

// Examples for a fresh installation, replaceable in the app. Kept to widely known
// public streams so the repository carries no private listening list.
const DEFAULT_STATIONS: Station[] = [
	{ id: 'radioparadise', name: 'Radio Paradise', url: 'https://stream.radioparadise.com/mp3-192' },
	{ id: 'groovesalad', name: 'SomaFM Groove Salad', url: 'https://ice1.somafm.com/groovesalad-128-mp3' },
	{ id: 'dlf', name: 'Deutschlandfunk', url: 'https://st01.sslstream.dlf.de/dlf/01/128/mp3/stream.mp3' }
];

export function loadStations(): Station[] {
	try {
		const raw = JSON.parse(fs.readFileSync(STATIONS_FILE, 'utf8'));
		if (Array.isArray(raw) && raw.length) return raw as Station[];
	} catch {
		try {
			fs.mkdirSync(CONFIG_DIR, { recursive: true });
			fs.writeFileSync(STATIONS_FILE, JSON.stringify(DEFAULT_STATIONS, null, 2));
		} catch {
			/* ignore */
		}
	}
	return DEFAULT_STATIONS;
}

// Some stations answer with a redirect. Follow it here so the device gets a
// direct address and does not have to handle redirects itself.
export async function resolveStream(url: string): Promise<string> {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 6000);
		const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
		clearTimeout(timer);
		const finalUrl = res.url || url;
		try {
			await res.body?.cancel();
		} catch {
			/* ignore */
		}
		return finalUrl;
	} catch {
		return url;
	}
}

export async function playStream(url: string, title: string): Promise<SoapResultBrief> {
	await ensureStarted();
	const laufendeSperre = sperreStatus(new Date());
	if (laufendeSperre.gesperrt) {
		return { ok: false, message: `Kindersicherung: gesperrt bis ${laufendeSperre.bis || 'Fensterende'}` };
	}
	const { didlForHttpAudio } = await import('./sonos');
	// Eigene Tondateien liegen hier im Haus, da gibt es nichts aufzuloesen.
	const eigen =
		url.includes(`://${config.callbackHost}:`) || url.includes('://127.0.0.1:') || url.includes('://localhost:');
	const target = eigen ? url : await resolveStream(url);
	const set = await call(config.host, 'AVTransport', 'SetAVTransportURI', {
		InstanceID: 0,
		CurrentURI: target,
		CurrentURIMetaData: didlForHttpAudio(target, title)
	});
	if (!set.ok) return brief(set);
	const play = await call(config.host, 'AVTransport', 'Play', { InstanceID: 0, Speed: 1 });
	state.trackTitle = title;
	state.trackURI = target;
	state.laufenderTitel = '';
	state.cover = '';
	state.metaQuelle = '';
	// Gleich einmal nachsehen, damit die Angaben nicht zwanzig Sekunden brauchen.
	setTimeout(() => void holeLaufendeAngaben(), 2500);
	return brief(play);
}
