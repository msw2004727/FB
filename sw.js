// sw.js — Service Worker for 文字冒險故事 PWA
const CACHE_NAME = 'wenjiang-v0.13';

// 靜態資源快取列表（使用相對路徑，相容 GitHub Pages 子目錄部署）
const STATIC_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './scripts/main.js',
    './scripts/gameLoop.js',
    './scripts/api.js',
    './scripts/gameState.js',
    './scripts/uiUpdater.js',
    './scripts/dom.js',
    './scripts/tips.js',
    './scripts/config.js',
    './scripts/aiModelPreference.js',
    './scripts/gmManager.js',
    './scripts/timeEffects.js',
    './client/db/clientDB.js',
    './client/db/schema.js',
    './client/db/storageManager.js',
    './client/engine/gameEngine.js',
    './client/engine/stateManager.js',
    './client/engine/contextBuilder.js',
    './client/ai/aiProxy.js',
    './client/utils/gameUtils.js',
    './client/utils/exportImport.js',
];

// 安裝：快取靜態資源
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch((err) => {
                console.warn('[SW] 部分資源快取失敗，繼續安裝:', err);
            });
        })
    );
    self.skipWaiting();
});

// 啟用：清除舊快取
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// 攔截請求
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // AI Proxy 請求：永遠走網路（不快取）
    if (url.pathname.startsWith('/ai/') || url.hostname !== self.location.hostname) {
        event.respondWith(fetch(event.request));
        return;
    }

    // 靜態資源：Cache First, Network Fallback
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((response) => {
                // 只快取成功的同源 GET 請求
                if (response.ok && event.request.method === 'GET') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return response;
            });
        }).catch(() => {
            // 離線回退
            if (event.request.destination === 'document') {
                return caches.match('/index.html');
            }
            return new Response('離線模式：此資源暫時無法使用。', {
                status: 503,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
        })
    );
});
