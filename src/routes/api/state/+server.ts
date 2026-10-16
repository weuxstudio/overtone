import { json } from '@sveltejs/kit';
import { ensureStarted, state, config, aktuellerSperrstatus } from '#lib/server/overtone';

export async function GET(): Promise<Response> {
	await ensureStarted();
	return json({ ...state, sperre: aktuellerSperrstatus(), device: config.host, uuid: config.uuid });
}
