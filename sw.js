const CACHE = 'solo-v13';
self.addEventListener('install', function(e) {
    e.waitUntil(caches.open(CACHE).then(function(c) { return c.addAll(['/','/solo.html','/css/landing.css','/css/solo.css','/js/solo.js']); }));
    self.skipWaiting();
});
self.addEventListener('activate', function(e) {
    e.waitUntil(caches.keys().then(function(keys) { return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); })); }));
    self.clients.claim();
});
self.addEventListener('fetch', function(e) {
    if (e.request.method !== 'GET') return;
    if (e.request.url.includes('/api/')) return;
    e.respondWith(
        caches.match(e.request).then(function(cached) {
            var fetchPromise = fetch(e.request).then(function(resp) {
                if (resp && resp.ok) { var clone = resp.clone(); caches.open(CACHE).then(function(c) { c.put(e.request, clone); }); }
                return resp;
            }).catch(function() { return cached; });
            return cached || fetchPromise;
        })
    );
});
