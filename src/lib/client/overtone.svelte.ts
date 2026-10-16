// Gemeinsamer Zustand der Overtone Oberflaeche.
// Eine Ereignisverbindung, eine Quelle der Wahrheit, alle Seiten lesen daraus.

export type TransportZustand = {
	zoneName: string;
	transportState: string;
	volume: number | null;
	mute: boolean;
	trackTitle: string;
	trackURI: string;
	relTime: string;
	duration: string;
	events: number;
	// Erreichbarkeit des Lautsprechers vom Dienst aus; null heisst noch ungeprueft.
	deviceReachable: boolean | null;
	device: string;
	host: string;
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

export type Sperrfenster = {
	id: number;
	name: string;
	tage: number[];
	von: string;
	bis: string;
	aktiv: boolean;
	tasten: boolean;
	stumm: boolean;
	einmalBis: string;
};

import { schutzText } from '../schutz';
import type { Sperrstatus } from '../schutz';
export type { Sperrstatus } from '../schutz';

export type Sender = { id: string; name: string; url: string };
export type Szene = {
	id: number;
	name: string;
	stationId: string | null;
	stationName: string;
	volume: number | null;
};
export type Weckzeit = {
	id: number;
	time: string;
	recurrence: string;
	enabled: boolean;
	volume: number;
	stationId: string;
	stationName: string;
	label: string;
};
export type Meldung = {
	id: number;
	art: 'fehler' | 'hinweis';
	text: string;
	detail?: string;
	wiederholen?: () => void;
};

export const ZUSTANDSTEXT: Record<string, string> = {
	PLAYING: 'Wiedergabe läuft',
	PAUSED_PLAYBACK: 'Pause',
	STOPPED: 'Gestoppt',
	TRANSITIONING: 'Wechsel läuft',
	NO_MEDIA_PRESENT: 'nichts geladen',
	UNKNOWN: 'unbekannt'
};

export const WIEDERHOLUNGSTEXT: Record<string, string> = {
	ONCE: 'einmalig',
	DAILY: 'täglich',
	WEEKDAYS: 'werktags',
	WEEKENDS: 'am Wochenende'
};

export const WIEDERGABEARTEN: { wert: string; name: string; text: string }[] = [
	{ wert: 'NORMAL', name: 'Normal', text: 'der Reihe nach' },
	{ wert: 'SHUFFLE_NOREPEAT', name: 'Zufall', text: 'gemischt' },
	{ wert: 'REPEAT_ALL', name: 'Wiederholen', text: 'alles, immer wieder' },
	{ wert: 'SHUFFLE', name: 'Zufall und wiederholen', text: 'gemischt, immer weiter' }
];

export function wiedergabeName(wert: string): string {
	return WIEDERGABEARTEN.find((w) => w.wert === wert)?.name ?? 'noch unbekannt';
}

export const STUNDEN = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
export const MINUTEN = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

const RUHEZEITEN = [15, 30, 45, 60, 90];

export const RUHEZEIT_AUSWAHL = RUHEZEITEN;

class Overtone {
	zustand = $state<TransportZustand>({
		zoneName: 'Overtone',
		transportState: 'UNKNOWN',
		volume: null,
		mute: false,
		trackTitle: '',
		trackURI: '',
		relTime: '',
		duration: '',
		events: 0,
		deviceReachable: null,
		device: '',
		host: '',
		lastError: '',
		klang: { bass: null, treble: null, loudness: null },
		led: '',
		playMode: '',
		crossfade: null,
		laufenderTitel: '',
		cover: '',
		metaQuelle: '',
		sperre: {
			gesperrt: false,
			bis: '',
			name: '',
			tasten: false,
			stumm: false,
			schnell: false,
			freigabeBis: '',
			global: true,
			fenster: []
		}
	});

	stations = $state<Sender[]>([]);
	szenen = $state<Szene[]>([]);
	weckzeiten = $state<Weckzeit[]>([]);
	meldungen = $state<Meldung[]>([]);
	bereit = $state(false);
	startend = $state<string | null>(null);
	zuletzt = $state<{ id: string; name: string } | null>(null);
	zieht = $state(false);
	lautstaerke = $state(0);
	fenster = $state<Sperrfenster[]>([]);
	pinGesetzt = $state(false);
	sperreGlobal = $state(true);
	pinAnforderung = $state<{ zweck: 'freigeben' | 'aendern'; titel: string; text: string; minuten: number } | null>(
		null
	);

	#quelle: EventSource | null = null;
	#startZeitgeber: ReturnType<typeof setTimeout> | null = null;
	#zaehler = 0;
	#kontaktGemeldet = false;

	get laeuft() {
		return this.zustand.transportState === 'PLAYING';
	}

	get verbunden() {
		return this.bereit && this.zustand.deviceReachable === true;
	}

	get gesperrt() {
		return !!this.zustand.sperre?.gesperrt;
	}

	get sperrtext() {
		const sp = this.zustand.sperre;
		if (!sp?.gesperrt) return '';
        const bis = new Date(sp.bis).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        return `Sperre vorgesehen. Nächster Wechsel ${bis}`;
    }

    get schutztext() { return schutzText(this.zustand.sperre, this.bereit ? this.zustand.deviceReachable : false); }

	get freigabeText() {
		const bis = this.zustand.sperre?.freigabeBis;
		if (!bis) return '';
		return `Freigabe bis ${new Date(bis).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
	}

	get verbindungsText() {
		// Erreichbarkeitsschicht: erst der Dienstkontakt der Oberflaeche (die
		// Ereignisverbindung), dann der Status, den der Dienst am Geraet sieht
		// (deviceReachable). Allgemeine Fehlermeldungen sind hier kein Massstab.
		if (!this.bereit) return 'nicht erreichbar';
		if (this.zustand.deviceReachable === false) return 'nicht erreichbar';
		if (this.zustand.deviceReachable === null) return 'verbinde ...';
		return 'verbunden';
	}

	get zustandstext() {
		return ZUSTANDSTEXT[this.zustand.transportState] ?? this.zustand.transportState;
	}

	get laufenderSender() {
		const uri = this.zustand.trackURI;
		if (!uri) return undefined;
		return this.stations.find(
			(st) => uri.startsWith(st.url.slice(0, 40)) || st.url.startsWith(uri.slice(0, 40))
		);
	}

	start() {
		if (this.#quelle) return;
		const quelle = new EventSource('/events');
		quelle.onmessage = (e) => {
			const neu = JSON.parse(e.data);
			this.zustand = { ...this.zustand, ...neu };
			// Jede gueltige Zustandsnachricht bestaetigt den Dienstkontakt,
			// unabhaengig vom Ereigniszaehler. Kommt die Verbindung wieder an,
			// wird eine spaetere Unterbrechung erneut gemeldet.
			if (!this.bereit) this.#kontaktGemeldet = false;
			this.bereit = true;
			if (!this.zieht && typeof neu.volume === 'number') this.lautstaerke = neu.volume;
			// Wiedergabe laeuft angekommen: Wartezustand am Knopf aufloesen.
			if (this.laeuft && this.startend) {
				this.startend = null;
				if (this.#startZeitgeber) clearTimeout(this.#startZeitgeber);
			}
		};
		quelle.onerror = () => {
			// Der Verbindungsabbruch setzt den Dienstkontakt zurueck. Melden nur
			// beim Wechsel von verbunden zu weg, danach wieder re-armiert.
			if (this.bereit) this.bereit = false;
			if (this.#kontaktGemeldet) return;
			this.#kontaktGemeldet = true;
			this.melde('Die Verbindung zum Dienst ist unterbrochen.');
		};
		this.#quelle = quelle;
		void this.ladeSender();
		void this.ladeWeckzeiten();
		void this.ladeSzenen();
		void this.ladeSperre();
		try {
			const g = localStorage.getItem('overtone-zuletzt');
			if (g) this.zuletzt = JSON.parse(g);
		} catch {
			/* Zugriff kann gesperrt sein */
		}
	}

	async ladeSender() {
		try {
			const res = await fetch('/api/stations');
			this.stations = (await res.json()) as Sender[];
		} catch {
			this.melde('Die Senderliste kam nicht an.');
		}
	}

	weckStoerung = $state('');

	async ladeWeckzeiten() {
		const daten = await this.hole('/api/alarms');
		if (daten && Array.isArray(daten.alarms)) this.weckzeiten = daten.alarms as Weckzeit[];
		this.weckStoerung = typeof daten?.stoerung === 'string' ? daten.stoerung : '';
	}

	async ladeSzenen() {
		const daten = await this.hole('/api/scenes');
		if (daten && Array.isArray(daten.scenes)) this.szenen = daten.scenes as Szene[];
	}

	async ladeSperre() {
		const daten = await this.hole('/api/sperre');
		if (!daten) return;
		if (daten.status) this.zustand = { ...this.zustand, sperre: daten.status as Sperrstatus };
		if (Array.isArray(daten.fenster)) this.fenster = daten.fenster as Sperrfenster[];
		this.pinGesetzt = !!daten.pinGesetzt;
		this.sperreGlobal = daten.global !== false;
	}

	async sperreAktion(
		body: Record<string, unknown>,
		pin?: string
	): Promise<Record<string, unknown> | null> {
		const antwort = await this.sendeAnfrage('/api/sperre', { ...body, pin });
		if (!antwort) return null;
		if (antwort.status) this.zustand = { ...this.zustand, sperre: antwort.status as Sperrstatus };
		if (Array.isArray(antwort.fenster)) this.fenster = antwort.fenster as Sperrfenster[];
		if (antwort.pinGesetzt !== undefined) this.pinGesetzt = !!antwort.pinGesetzt;
		if (antwort.global !== undefined) this.sperreGlobal = antwort.global !== false;
		if (typeof antwort.hinweis === 'string') this.hinweis(antwort.hinweis);
		return antwort;
	}

	// Solange gesperrt ist, brauchen Aenderungen den Code.
	pinAnfordern(zweck: 'freigeben' | 'aendern', titel: string, text: string, minuten = 30) {
		if (!this.gesperrt || !this.pinGesetzt) return false;
		this.pinAnforderung = { zweck, titel, text, minuten };
		return true;
	}

	// ---------- Meldungen ----------

	melde(text: string, detail?: string, wiederholen?: () => void) {
		this.#zaehler += 1;
		this.meldungen = [...this.meldungen, { id: this.#zaehler, art: 'fehler', text, detail, wiederholen }];
	}

	hinweis(text: string) {
		this.#zaehler += 1;
		const id = this.#zaehler;
		this.meldungen = [...this.meldungen, { id, art: 'hinweis', text }];
		setTimeout(() => this.schliesse(id), 6000);
	}

	schliesse(id: number) {
		this.meldungen = this.meldungen.filter((m) => m.id !== id);
	}

	// ---------- Anfragen ----------

	// Geraeteantworten werden zu Saetzen, die man lesen kann.
	#fehlerSatz(rohtext: string): { text: string; detail?: string } {
		const code = rohtext.match(/(?:errorCode>|Fehler\s*)(\d{3})/);
		if (code) {
			const nummer = code[1];
			const bekannt: Record<string, string> = {
				'402': 'Der Lautsprecher hat die Angabe nicht akzeptiert.',
				'500': 'Der Lautsprecher meldet einen internen Fehler.',
				'701': 'Der Lautsprecher ist gerade nicht erreichbar.',
				'714': 'Dieser Sender antwortet nicht.',
				'716': 'Der Zugang zu diesem Sender ist gesperrt.'
			};
			return {
				text: `${bekannt[nummer] ?? 'Der Lautsprecher hat den Befehl abgelehnt.'} Fehler ${nummer}.`,
				detail: rohtext
			};
		}
		if (/Name fehlt/i.test(rohtext)) return { text: 'Bitte einen Namen eingeben.' };
		if (/Sender unbekannt/i.test(rohtext)) return { text: 'Diesen Sender kenne ich nicht.' };
		if (/fetch failed|Failed to fetch|ECONN|EHOST|ETIMEDOUT|socket hang up/i.test(rohtext)) {
			return { text: 'Der Lautsprecher antwortet nicht. Ist er eingeschaltet und im Netz?', detail: rohtext };
		}
		if (/nicht erreichbar/i.test(rohtext)) {
			return { text: 'Der Lautsprecher ist nicht erreichbar.', detail: rohtext };
		}
		return { text: rohtext.slice(0, 160), detail: rohtext };
	}

	async hole(pfad: string): Promise<Record<string, unknown> | null> {
		try {
			const res = await fetch(pfad);
			return (await res.json()) as Record<string, unknown>;
		} catch (err) {
			this.dienstWeg(err);
			return null;
		}
	}

	async sendeAnfrage(
		pfad: string,
		daten: Record<string, unknown>,
		beiErfolg?: (d: Record<string, unknown>) => void
	): Promise<Record<string, unknown> | null> {
		try {
			const res = await fetch(pfad, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(daten)
			});
			const antwort = (await res.json().catch(() => ({}))) as Record<string, unknown>;
			if (!antwort.ok) {
				const satz = this.#fehlerSatz(String(antwort.message ?? 'Der Dienst hat den Befehl abgelehnt.'));
				this.melde(satz.text, satz.detail);
				return null;
			}
			beiErfolg?.(antwort);
			return antwort;
		} catch (err) {
			this.dienstWeg(err);
			return null;
		}
	}

	// Der Dienst selbst ist nicht erreichbar, nicht das Geraet.
	dienstWeg(err: unknown) {
		this.melde('Der Dienst antwortet nicht. Läuft er auf dem Rechner?', String(err));
	}

	// ---------- Befehle ----------

	async befehl(action: string, value?: string | number) {
		if (this.gesperrt) {
			this.melde(`${this.sperrtext}. Bedienung ist während der Sperre aus.`);
			return;
		}
		await this.sendeAnfrage('/api/command', { action, value });
	}

	async stummUmschalten() {
		await this.befehl('mute', this.zustand.mute ? 0 : 1);
	}

	async ruhe(minuten: number) {
		await this.befehl('sleep', minuten);
		this.hinweis(minuten > 0 ? `Ruhe in ${minuten} Minuten gesetzt.` : 'Ruhe aufgehoben.');
	}

	async setzeLautstaerke(wert: number) {
		this.lautstaerke = wert;
		await this.befehl('volume', wert);
	}

	async sende(id: string) {
		if (this.gesperrt) {
			this.melde(`${this.sperrtext}. Bedienung ist während der Sperre aus.`);
			return;
		}
		this.startend = id;
		const name = this.stations.find((st) => st.id === id)?.name ?? 'Sender';
		const antwort = await this.sendeAnfrage(
			'/api/stations',
			{ id },
			() => {
				this.zuletzt = { id, name };
				try {
					localStorage.setItem('overtone-zuletzt', JSON.stringify({ id, name }));
				} catch {
					/* Zugriff kann gesperrt sein */
				}
			}
		);
		if (!antwort) {
			this.startend = null;
			return;
		}
		// Ein Sender, der nicht anspringt, muss das sagen duerfen.
		if (this.#startZeitgeber) clearTimeout(this.#startZeitgeber);
		this.#startZeitgeber = setTimeout(() => {
			if (this.startend === id && !this.laeuft) {
				this.melde(`Der Sender ${name} antwortet nicht.`, undefined, () => void this.sende(id));
				this.startend = null;
			}
		}, 9000);
	}

	async alarmAktion(body: Record<string, unknown>) {
		return this.sendeAnfrage('/api/alarms', body, (d) => {
			if (Array.isArray(d.alarms)) this.weckzeiten = d.alarms as Weckzeit[];
		});
	}

	async szenenAktion(body: Record<string, unknown>) {
		return this.sendeAnfrage('/api/scenes', body, (d) => {
			if (Array.isArray(d.scenes)) this.szenen = d.scenes as Szene[];
		});
	}

	async szeneAnwenden(sz: Szene) {
		if (this.gesperrt) {
			this.melde(`${this.sperrtext}. Bedienung ist während der Sperre aus.`);
			return;
		}
		this.startend = 'szene-' + sz.id;
		await this.szenenAktion({ action: 'apply', id: sz.id });
		this.startend = null;
	}

	// ---------- Ansagen und Klaenge ----------

	ton = $state<{
		stimmen: { name: string; text: string }[];
		klaenge: { name: string; titel: string; text: string; minuten: number }[];
		vorhanden: { name: string; titel: string; datei: string; minuten: number }[];
		ansagen: { datei: string; text: string; stimme: string; erstellt: string }[];
	}>({ stimmen: [], klaenge: [], vorhanden: [], ansagen: [] });

	tonLaeuft = $state(false);

	#uebernimmTon(d: Record<string, unknown>) {
		if (Array.isArray(d.stimmen)) this.ton.stimmen = d.stimmen as typeof this.ton.stimmen;
		if (Array.isArray(d.klaenge)) this.ton.klaenge = d.klaenge as typeof this.ton.klaenge;
		if (Array.isArray(d.vorhanden)) this.ton.vorhanden = d.vorhanden as typeof this.ton.vorhanden;
		if (Array.isArray(d.ansagen)) this.ton.ansagen = d.ansagen as typeof this.ton.ansagen;
	}

	async ladeTon() {
		const antwort = await this.hole('/api/ton');
		if (antwort) this.#uebernimmTon(antwort);
	}

	async tonAktion(daten: Record<string, unknown>) {
		if (this.gesperrt) {
			this.melde(`${this.sperrtext}. Ansagen und Klaenge sind während der Sperre aus.`);
			return;
		}
		this.tonLaeuft = true;
		try {
			await this.sendeAnfrage('/api/ton', daten, (d) => {
				this.#uebernimmTon(d);
				if (d.hinweis) this.hinweis(String(d.hinweis));
			});
		} finally {
			this.tonLaeuft = false;
		}
	}
}

export const overtone = new Overtone();
