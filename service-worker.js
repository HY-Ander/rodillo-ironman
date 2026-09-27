// service-worker.js — cachea los archivos estáticos para que la app instalada
// abra al instante. No cachea datos de sesión (eso vive en IndexedDB, no aquí).

const CACHE_NAME = 'rodillo-ironman-v3';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './ftms.js',
  './heartrate.js',
  './storage.js',
  './workouts.js',
  './manifest.json',
  './chart.umd.min.js',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Red primero (para que las actualizaciones lleguen solas), caché si no hay conexión.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' }) // siempre pregunta al servidor si hay versión nueva
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((c) => c.put(event.request, copy)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
