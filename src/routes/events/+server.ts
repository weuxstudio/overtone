// Server sent events: the user interface gets every change without polling.
import { ensureStarted, addClient, removeClient, state } from '#lib/server/overtone';

export async function GET(): Promise<Response> {
	await ensureStarted();
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();
			const client = {
				write(chunk: string) {
					controller.enqueue(encoder.encode(chunk));
				}
			};
			controller.enqueue(encoder.encode(`data: ${JSON.stringify(state)}\n\n`));
			addClient(client);
			heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(': ping\n\n'));
				} catch {
					/* closed */
				}
			}, 20000);
			return () => {
				if (heartbeat) clearInterval(heartbeat);
				removeClient(client);
			};
		},
		cancel() {
			if (heartbeat) clearInterval(heartbeat);
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
