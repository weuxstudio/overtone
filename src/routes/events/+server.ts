// Server sent events: the user interface gets every change without polling.
import { ensureStarted, addClient, removeClient, state } from '#lib/server/overtone';

export async function GET({ request }): Promise<Response> {
	await ensureStarted();
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let abgemeldet = false;
	const encoder = new TextEncoder();

	// Beim Abbruch (Browser schliesst oder Netz weg) muessen der registrierte
	// Browserclient und sein Herzschlag-Zeitgeber entfernt werden, sonst leben
	// beide endlos weiter.
	const abmelden = () => {
		if (abgemeldet) return;
		abgemeldet = true;
		request.signal.removeEventListener('abort', abmelden);
		if (heartbeat) clearInterval(heartbeat);
		heartbeat = undefined;
		if (client) removeClient(client);
	};
	request.signal.addEventListener('abort', abmelden, { once: true });

	let client: { write: (chunk: string) => void } | null = null;
	const stream = new ReadableStream({
		start(controller) {
			client = {
				write(chunk: string) {
					controller.enqueue(encoder.encode(chunk));
				}
			};
			addClient(client);
			heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(': ping\n\n'));
				} catch {
					/* already closed */
				}
			}, 20000);
		},
		cancel() {
			abmelden();
		}
	});
	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
}
