import { json } from '@sveltejs/kit';
import { ensureStarted, state, config } from '#lib/server/overtone';

export async function GET(): Promise<Response> {
	await ensureStarted();
	return json({ ...state, device: config.host, uuid: config.uuid });
}
