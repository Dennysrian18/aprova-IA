/* ════════════════ Aprova IA — Service Worker ════════════════
   PWA instalável + offline. Estratégias:
   - Navegação (HTML): network-first → cai para o index.html em cache (offline).
   - Estáticos same-origin + CDNs (React/Babel/unpkg): stale-while-revalidate.
   - IA proxy / APIs externas: sempre rede (nunca cacheia respostas dinâmicas).
   Bump CACHE_VERSION a cada deploy para invalidar o cache antigo.            */
const CACHE_VERSION = 'aprova-v1';
const CORE = [
  './',
  'index.html',
  'manifest.json',
  'icon.svg',
];
/* Origens dinâmicas que NÃO devem ser cacheadas (respostas da IA, APIs). */
const NO_CACHE_HOSTS = ['mentor-ia.dennysrian18.workers.dev', 'generativelanguage.googleapis.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // addAll falha tudo se um item falhar → adiciona um a um tolerando erros
    await Promise.all(CORE.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isNoCache(url) {
  try { return NO_CACHE_HOSTS.some((h) => url.hostname.endsWith(h)); }
  catch (e) { return false; }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                 // só GET
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (isNoCache(url)) return;                        // deixa a rede resolver (IA/API)

  // Navegações (abrir o app): network-first, fallback offline p/ index em cache
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_VERSION);
        cache.put('index.html', fresh.clone()).catch(() => {});
        return fresh;
      } catch (e) {
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match('index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Demais GETs (estáticos + CDNs): stale-while-revalidate
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
