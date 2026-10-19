// Bump this value whenever any app file changes, then deploy all files together.
// A release is cached in full before it can replace the previous offline copy.
const CACHE_VERSION = '2026-10-18.8';
const APP_SCOPE = self.registration.scope;
const CACHE_PREFIX = `picky:${APP_SCOPE}:`;
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const SHELL_FILES = [
    'index.html',
    'styles.css',
    'app.js',
    'navigation.js',
    'party-rules.js',
    'party-mode.js',
    'party.css',
    'tournament-mode.js',
    'tournament.css',
    'dice-renderer.js',
    'assets/dice/models.json',
    'pwa.js',
    'color-palette.js',
    'manifest.json',
    'PickyNB.png',
    'images/picky-toon.png',
    'images/favicon-96x96.png',
    'images/favicon.svg',
    'images/favicon.ico',
    'images/apple-touch-icon.png',
    'images/web-app-manifest-192x192.png',
    'images/web-app-manifest-512x512.png'
];
const SHELL_URL = new URL('index.html', APP_SCOPE).href;
const SHELL_URLS = new Set(SHELL_FILES.map(file => new URL(file, APP_SCOPE).href));

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(
            SHELL_FILES.map(file => new Request(new URL(file, APP_SCOPE), { cache: 'reload' }))
        ))
    );
    // Do not skip waiting: an update takes over after the existing app windows
    // close, so downloading a release never interrupts an active game.
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames
            .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
            .map(name => caches.delete(name)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    if (!url.href.startsWith(APP_SCOPE)) return;
    url.search = '';
    url.hash = '';

    // Navigation always uses the installed shell immediately. Checking for an
    // updated worker happens separately and never holds up opening the app.
    const cacheKey = event.request.mode === 'navigate' ? SHELL_URL : url.href;
    if (!SHELL_URLS.has(cacheKey)) return;

    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        return await cache.match(cacheKey) || fetch(event.request);
    })());
});
