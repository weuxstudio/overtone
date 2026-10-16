// Scenes are one tap settings: a station, a volume, the sound and the play mode.
// They are stored locally, the device only gets the resulting commands.

import { call } from './sonos';
import { config, loadStations, playStream, state } from './overtone';
import { deleteSceneRow, insertScene, sceneRow, sceneRows, updateSceneRow, type SceneRow } from './store';

export type Scene = SceneRow & { stationName: string };

function mitNamen(rows: SceneRow[]): Scene[] {
	const sender = loadStations();
	return rows.map((row) => ({
		...row,
		stationName: sender.find((s) => s.id === row.station_id)?.name ?? row.title ?? ''
	}));
}

export function listScenes(): Scene[] {
	return mitNamen(sceneRows());
}

export async function readSound(): Promise<{ bass: number | null; treble: number | null; loudness: number | null }> {
	const bass = await call(config.host, 'RenderingControl', 'GetBass', { InstanceID: 0, Channel: 'Master' });
	const treble = await call(config.host, 'RenderingControl', 'GetTreble', { InstanceID: 0, Channel: 'Master' });
	const loudness = await call(config.host, 'RenderingControl', 'GetLoudness', { InstanceID: 0, Channel: 'Master' });
	return {
		bass: bass.ok ? Number(bass.values.CurrentBass) : null,
		treble: treble.ok ? Number(treble.values.CurrentTreble) : null,
		loudness: loudness.ok ? Number(loudness.values.CurrentLoudness) : null
	};
}

export async function readPlayMode(): Promise<string | null> {
	const res = await call(config.host, 'AVTransport', 'GetTransportSettings', { InstanceID: 0 });
	return res.ok ? (res.values.PlayMode ?? null) : null;
}

export type SceneInput = {
	name: string;
	stationId?: string;
	volume?: number;
	bass?: number;
	treble?: number;
	loudness?: number;
	playMode?: string;
	fromCurrent?: boolean;
};

export async function createScene(input: SceneInput): Promise<{ ok: boolean; scene?: Scene; message?: string }> {
	const name = (input.name ?? '').trim();
	if (!name) return { ok: false, message: 'Name fehlt' };
	const sender = loadStations();

	let stationId = input.stationId ?? '';
	let volumen = input.volume ?? null;
	let bass = input.bass ?? null;
	let treble = input.treble ?? null;
	let loudness = input.loudness ?? null;
	let playMode = input.playMode ?? null;
	let title = '';

	if (input.fromCurrent) {
		// Take what is playing right now, so one tap can capture the moment.
		const treffer = sender.find((s) => state.trackURI && state.trackURI.startsWith(s.url.slice(0, 40)));
		stationId = treffer?.id ?? stationId;
		title = treffer?.name ?? state.trackTitle;
		volumen = state.volume;
		const klang = await readSound();
		bass = klang.bass;
		treble = klang.treble;
		loudness = klang.loudness;
		playMode = await readPlayMode();
	} else {
		title = sender.find((s) => s.id === stationId)?.name ?? '';
	}

	const id = insertScene({
		name,
		station_id: stationId || null,
		url: null,
		title: title || null,
		volume: volumen,
		bass,
		treble,
		loudness,
		play_mode: playMode,
		position: sceneRows().length
	});
	return { ok: true, scene: mitNamen([sceneRow(id) as SceneRow])[0] };
}

export async function applyScene(id: number): Promise<{ ok: boolean; message?: string }> {
	const row = sceneRow(id);
	if (!row) return { ok: false, message: 'Szene gibt es nicht' };
	const sender = loadStations().find((s) => s.id === row.station_id);

	if (sender) {
		const start = await playStream(sender.url, sender.name);
		if (!start.ok) return { ok: false, message: start.message ?? 'Sender nicht gestartet' };
	}
	if (typeof row.volume === 'number') {
		await call(config.host, 'RenderingControl', 'SetVolume', { InstanceID: 0, Channel: 'Master', DesiredVolume: row.volume });
		state.volume = row.volume;
	}
	if (typeof row.bass === 'number') {
		await call(config.host, 'RenderingControl', 'SetBass', { InstanceID: 0, Channel: 'Master', DesiredBass: row.bass });
	}
	if (typeof row.treble === 'number') {
		await call(config.host, 'RenderingControl', 'SetTreble', { InstanceID: 0, Channel: 'Master', DesiredTreble: row.treble });
	}
	if (typeof row.loudness === 'number') {
		await call(config.host, 'RenderingControl', 'SetLoudness', { InstanceID: 0, Channel: 'Master', DesiredLoudness: row.loudness });
	}
	if (row.play_mode) {
		await call(config.host, 'AVTransport', 'SetPlayMode', { InstanceID: 0, NewPlayMode: row.play_mode });
	}
	return { ok: true };
}

export function renameScene(id: number, name: string): { ok: boolean; message?: string } {
	const sauber = (name ?? '').trim();
	if (!sauber) return { ok: false, message: 'Name fehlt' };
	updateSceneRow(id, { name: sauber });
	return { ok: true };
}

export function deleteScene(id: number): { ok: boolean } {
	deleteSceneRow(id);
	return { ok: true };
}
