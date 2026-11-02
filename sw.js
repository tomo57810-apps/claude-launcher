// ランチャー専用アプリ(別アプリ)のサービスワーカー。アプリとして入れられる条件を満たすための、通すだけのもの(保存はしない)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => { if (e.request.method === 'GET' && new URL(e.request.url).origin === location.origin) e.respondWith(fetch(e.request, { cache: 'no-cache' })); });
