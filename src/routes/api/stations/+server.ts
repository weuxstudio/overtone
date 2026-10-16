import { json } from '@sveltejs/kit';
import { loadStations, playStream } from '#lib/server/overtone';

export async function GET(): Promise<Response> {
	return json(loadStations());
}

export async function POST({ request }: { request: Request }): Promise<Response> {
	const body = await request.json().catch(() => ({}));
	const stations = loadStations();
	const station = stations.find((s) => s.id === body.id) ??
		(body.url ? { id: 'custom', name: String(body.name ?? 'Eigene Adresse'), url: String(body.url) } : undefined);
	if (!station) return json({ ok: false, message: 'Sender unbekannt' }, { status: 400 });
	const result = await playStream(station.url, station.name);
	return json(result, { status: result.ok ? 200 : 502 });
}
