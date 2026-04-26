const CACHE_NAME = "chat-app-v1";

self.addEventListener("install", e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            cache.addAll([
                "/",
                "/index.html",
                "/public/app.js",
                "/public/style.css"
            ])
        )
    );
});

self.addEventListener("fetch", e => {
    e.respondWith(
        caches.match(e.request).then(res =>
            res || fetch(e.request)
        )
    );
});
