// Service Worker — BidPro Brasil (PWA)
// Faz DUAS coisas: (1) push notifications (já em produção) e (2) cache de app-shell
// para o app ser instalável e abrir offline (Etapa 1 do PWA).
//
// Estratégia de cache (runtime, SEM precache-manifest → não depende de plugin/build):
//   • Navegações (abrir o app): NETWORK-FIRST → sempre pega a versão nova quando online;
//     offline cai no index.html em cache. Como o app usa HashRouter, uma só página (/)
//     serve TODAS as rotas (#/...).
//   • Assets do mesmo domínio (js/css/img com hash no nome): STALE-WHILE-REVALIDATE →
//     abre instantâneo do cache e atualiza em segundo plano.
//   • /api/*, Supabase, fontes, analytics e QUALQUER cross-origin: passam direto (nunca
//     cacheados) — dados sempre ao vivo, nada de resposta velha.
// Atualização: skipWaiting + clients.claim + limpeza de caches antigos por versão → o
// deploy novo (push p/ main) chega ao PWA instalado na próxima abertura, sem app store.

const CACHE = 'bidpro-shell-v1';
const SHELL = '/';

self.addEventListener('install', e => {
  self.skipWaiting();
  // Pré-cacheia o shell (best-effort — nunca falha a instalação).
  e.waitUntil(
    caches.open(CACHE).then(c => c.add(SHELL)).catch(() => {})
  );
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Remove caches de versões anteriores (evita servir shell velho após deploy).
    const nomes = await caches.keys();
    await Promise.all(nomes.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

// Permite ao app forçar a ativação de um SW novo (fluxo de "atualizar agora").
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // só GET
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // cross-origin (Supabase/fontes/CDN/gtag) → rede
  if (url.pathname.startsWith('/api/')) return;     // API → sempre ao vivo

  // Navegação (abrir/recarregar o app) → network-first, fallback ao shell em cache (offline).
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const c = await caches.open(CACHE);
        c.put(SHELL, fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        return (await caches.match(SHELL)) || (await caches.match(req)) || Response.error();
      }
    })());
    return;
  }

  // Assets do mesmo domínio → stale-while-revalidate.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const rede = fetch(req).then(resp => {
      if (resp && resp.ok && (resp.type === 'basic' || resp.type === 'default')) {
        cache.put(req, resp.clone()).catch(() => {});
      }
      return resp;
    }).catch(() => null);
    return cached || (await rede) || Response.error();
  })());
});

// ── Push notifications (inalterado) ──
self.addEventListener('push', e => {
  if (!e.data) return;

  let payload;
  try { payload = e.data.json(); } catch { payload = { title: 'BidPro Brasil', body: e.data.text() }; }

  const { title = 'BidPro Brasil', body = '', icon, badge, url, tag, data } = payload;

  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: icon || '/favicon-192.png',
      badge: badge || '/favicon.svg',
      tag: tag || 'bidpro-notificacao',
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
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.postMessage({ type: 'NAVIGATE', url });
          return;
        }
      }
      return self.clients.openWindow(self.location.origin + url);
    })
  );
});
