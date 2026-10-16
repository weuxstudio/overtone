import { json } from '@sveltejs/kit';
import { command } from '#lib/server/overtone';

export async function POST({ request }: { request: Request }): Promise<Response> {
	const body = await request.json().catch(() => ({}));
	const action = String(body.action ?? '');
	if (!action) return json({ ok: false, message: 'action fehlt' }, { status: 400 });
	const result = await command(action, body.value);
	return json(result, { status: result.ok ? 200 : 502 });
}
