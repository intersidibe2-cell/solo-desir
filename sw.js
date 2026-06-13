const CACHE = 'solo-v15';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', function(e) {
    e.waitUntil(caches.open(CACHE).then(function(c) {
        return c.addAll(['/', '/solo.html', '/css/landing.css', '/css/solo.css', '/js/solo.js', '/js/i18n.js', '/lang/fr.json', '/lang/en.json', '/lang/ar.json']);
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

    // API requests: network first, cache fallback
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

    // Static assets: cache first, network fallback
    e.respondWith(
        caches.match(e.request).then(function(cached) {
            var fetchPromise = fetch(e.request).then(function(resp) {
                if (resp && resp.ok) {
                    var clone = resp.clone();
                    caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
                }
                return resp;
            }).catch(function() {
                // Offline fallback for HTML pages
                if (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html')) {
                    return caches.match(OFFLINE_URL);
                }
                return cached;
            });
            return cached || fetchPromise;
        })
    );
});
