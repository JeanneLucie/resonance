// Service worker minimal : suffisant pour rendre Risuona installable
// (critère technique des navigateurs), avec un petit confort hors-ligne
// pour la coquille de l'application. Les données (morceaux, profils)
// viennent toujours du réseau — on ne met en cache que les fichiers
// statiques (HTML, CSS, JS, icônes), jamais les morceaux audio ni les
// réponses de l'API.

const CACHE_NAME = 'resonance-shell-v26';
const SHELL_FILES = [
  '/',
  '/style.css',
  '/app.js',
  '/qrcode.js',
  '/cover.js',
  '/manifest.json',
  '/cgu.html',
  '/roadmap.html',
  '/guide.html',
  '/guide-sacem.html',
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

// Notification push reçue (nouveau morceau chez un artiste suivi) :
// affiche une notification système, même si Risuona n'est pas ouvert dans
// un onglet. Le corps du message est toujours envoyé en clair par le
// serveur (voir notifyFollowersOfNewTrack dans server.js) : rien de
// personnel n'y transite au-delà du titre du morceau et du nom d'artiste,
// déjà publics sur le site.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = {};
  }
  const title = data.title || 'Risuona';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Clic sur la notification : ouvre (ou ramène au premier plan) l'onglet
// Risuona déjà ouvert, sinon en ouvre un nouveau sur le morceau concerné.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
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
