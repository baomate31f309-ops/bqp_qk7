const CACHE_NAME = 'qt-pwa-v1';
const APP_SHELL = [
	'/',
	'/index.html',
	'/dashboard.html',
	'/gui-giao-an.html',
	'/quan-ly.html',
	'/danh-muc.html',
	'/mau-word.html',
	'/navigation.html',
	'/style.css',
	'/app.js',
	'/manifest.webmanifest',
	'/app-icon.svg',
	'/Vietnam_Ministry_of_National_Defence_emblem.svg.webp',
	'/offline.html'
];

self.addEventListener('install', event => {
	event.waitUntil(
		caches.open(CACHE_NAME)
			.then(cache => cache.addAll(APP_SHELL))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', event => {
	event.waitUntil(
		caches.keys()
			.then(keys => Promise.all(keys
				.filter(key => key.startsWith('qt-pwa-') && key !== CACHE_NAME)
				.map(key => caches.delete(key))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', event => {
	const request = event.request;
	const url = new URL(request.url);
	if (request.method !== 'GET' || url.origin !== self.location.origin ||
		url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

	const isAppShellRequest = url.pathname === '/' || APP_SHELL.includes(url.pathname);
	if (!isAppShellRequest) return;

	event.respondWith((async () => {
		const cache = await caches.open(CACHE_NAME);
		try {
			const response = await fetch(request);
			if (response.ok) await cache.put(request, response.clone());
			return response;
		} catch (error) {
			const cached = await cache.match(request, { ignoreSearch: true });
			if (cached) return cached;
			if (request.mode === 'navigate') {
				const offline = await cache.match('/offline.html');
				if (offline) return offline;
			}
			throw error;
		}
	})());
});
