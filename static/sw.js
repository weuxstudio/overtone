// Minimal service worker. It only makes the page installable and keeps a copy
// of the shell for offline use. Live data is never cached.
const CACHE = 'overtone-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-180.png'];

self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => undefined));
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
	);
	self.clients.claim();
});

self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
	if (url.pathname.startsWith('/api') || url.pathname.startsWith('/events')) return;
	event.respondWith(
		fetch(event.request)
			.then((res) => {
				const kopie = res.clone();
				caches.open(CACHE).then((c) => c.put(event.request, kopie)).catch(() => undefined);
				return res;
			})
			.catch(() => caches.match(event.request).then((hit) => hit ?? caches.match('/')))
	);
});
