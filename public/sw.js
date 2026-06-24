// Service Worker — TSN Ativos / BidPro
// Gerencia push notifications e cache offline básico

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

// Recebe push do servidor
self.addEventListener('push', e => {
  if (!e.data) return;

  let payload;
  try { payload = e.data.json(); } catch { payload = { title: 'TSN Ativos', body: e.data.text() }; }

  const { title = 'TSN Ativos', body = '', icon, badge, url, tag, data } = payload;

  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: icon || '/logo.svg',
      badge: badge || '/favicon.svg',
      tag: tag || 'tsn-notificacao',
      data: { url: url || '/', ...data },
      vibrate: [200, 100, 200],
      requireInteraction: false,
    })
  );
});

// Clique na notificação → abre/foca o app na URL correta
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Se já tem aba aberta, foca e navega
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.postMessage({ type: 'NAVIGATE', url });
          return;
        }
      }
      // Senão abre nova aba
      return self.clients.openWindow(self.location.origin + url);
    })
  );
});
