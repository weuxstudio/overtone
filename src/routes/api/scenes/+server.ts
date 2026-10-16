import { json } from '@sveltejs/kit';
import { applyScene, createScene, deleteScene, listScenes, renameScene } from '#lib/server/scenes';
import { loadStations } from '#lib/server/overtone';

export function GET(): Response {
	return json({ scenes: listScenes(), stations: loadStations() });
}

export async function POST({ request }: { request: Request }): Promise<Response> {
	const body = await request.json().catch(() => ({}));
	const action = String(body.action ?? '');
	let result: { ok: boolean; message?: string } = { ok: false, message: 'unbekannte Aktion' };
	switch (action) {
		case 'create':
			result = await createScene({
				name: String(body.name ?? ''),
				stationId: body.stationId,
				volume: body.volume,
				fromCurrent: Boolean(body.fromCurrent)
			});
			break;
		case 'apply':
			result = await applyScene(Number(body.id));
			break;
		case 'rename':
			result = renameScene(Number(body.id), String(body.name ?? ''));
			break;
		case 'delete':
			result = deleteScene(Number(body.id));
			break;
	}
	return json({ ...result, scenes: listScenes() }, { status: result.ok ? 200 : 502 });
}
