const CACHE = 'solo-v34';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', function(e) {
    e.waitUntil(caches.open(CACHE).then(function(c) {
        return c.addAll(['/offline.html']);
    }));
    self.skipWaiting();
});

self.addEventListener('activate', function(e) {
    e.waitUntil(caches.keys().then(function(keys) {
        return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
    }));
    self.clients.claim();
});

self.addEventListener('fetch', function(e) {
    if (e.request.method !== 'GET') return;

    // API: network first
    if (e.request.url.includes('/api/')) {
        e.respondWith(
            fetch(e.request).then(function(resp) {
                if (resp && resp.ok) {
                    var clone = resp.clone();
                    caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
                }
                return resp;
            }).catch(function() {
                return caches.match(e.request);
            })
        );
        return;
    }

    // HTML/CSS/JS: network first, immediate update
    if (e.request.url.match(/\.(html|css|js)$/) || e.request.destination === 'document') {
        e.respondWith(
            fetch(e.request).then(function(resp) {
                if (resp && resp.ok) {
                    var clone = resp.clone();
                    caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
                }
                return resp;
            }).catch(function() {
                return caches.match(e.request).then(function(cached) {
                    return cached || caches.match(OFFLINE_URL);
                });
            })
        );
        return;
    }

    // Images/fonts/json: cache first, network update
    e.respondWith(
        caches.match(e.request).then(function(cached) {
            var fetchPromise = fetch(e.request).then(function(resp) {
                if (resp && resp.ok) {
                    var clone = resp.clone();
                    caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
                }
                return resp;
            });
            return cached || fetchPromise;
        })
    );
});
