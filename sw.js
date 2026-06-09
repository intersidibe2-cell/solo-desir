const CACHE = 'solo-v4';
self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/','/solo.html','/css/landing.css','/css/solo.css','/js/solo.js'])));
    self.skipWaiting();
});
self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
    self.clients.claim();
});
self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET') return;
    if (e.request.url.includes('/api/')) return fetch(e.request);
    e.respondWith(caches.match(e.request).then(r => {
        const fetchPromise = fetch(e.request).then(resp => {
            if (resp.ok) { const clone = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); }
            return resp;
        });
        return r || fetchPromise;
    }));
});
