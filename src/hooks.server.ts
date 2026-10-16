// Start the control service once when the server boots.
import { ensureStarted } from '#lib/server/overtone';

export async function init(): Promise<void> {
	await ensureStarted();
}
