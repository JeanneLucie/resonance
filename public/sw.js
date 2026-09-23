// Service worker minimal : suffisant pour rendre Résonance installable
// (critère technique des navigateurs), avec un petit confort hors-ligne
// pour la coquille de l'application. Les données (morceaux, profils)
// viennent toujours du réseau — on ne met en cache que les fichiers
// statiques (HTML, CSS, JS, icônes), jamais les morceaux audio ni les
// réponses de l'API.

const CACHE_NAME = 'resonance-shell-v13';
const SHELL_FILES = [
  '/',
  '/style.css',
  '/app.js',
  '/qrcode.js',
  '/manifest.json',
  '/cgu.html',
  '/roadmap.html',
  '/guide.html',
  '/locales/fr.json',
  '/locales/en.json',
  '/locales/es.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ne jamais intercepter les appels API ou les fichiers audio uploadés :
  // ils doivent toujours venir du réseau, en direct.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
