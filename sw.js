// sw.js — Service Worker for 文字冒險故事 PWA
const CACHE_PREFIX = 'wenjiang-';
const APP_VERSION = 'v0.27.0';
const CACHE_NAME = `${CACHE_PREFIX}${APP_VERSION}`;
const UPGRADE_MESSAGE = 'WENJIANG_SW_UPGRADE';
const CLIENT_READY_MESSAGE = 'WENJIANG_SW_CLIENT_READY';

function isAppWindow(client) {
    try {
        const clientUrl = new URL(client.url);
        const scopeUrl = new URL(self.registration.scope);
        return clientUrl.origin === scopeUrl.origin
            && clientUrl.pathname.startsWith(scopeUrl.pathname);
    } catch {
        return false;
    }
}

async function coordinateClientUpgrade() {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    for (const client of windows) {
        if (!isAppWindow(client)) continue;
        client.postMessage({ type: UPGRADE_MESSAGE, version: APP_VERSION });
    }

    // Never navigate clients from activate. An older page may be in a paid SSE
    // request or contain an unsent draft. Upgrade-aware pages choose their own
    // safe reload point; v0.26 needs the Pages-first rollout compatibility gate.
}

self.addEventListener('message', (event) => {
    if (event.data?.type !== CLIENT_READY_MESSAGE || !event.source?.id) return;
    if (
        ['page-ready', 'controller-changed', 'registered'].includes(event.data?.decision)
        && isAppWindow(event.source)
    ) {
        event.source.postMessage({ type: UPGRADE_MESSAGE, version: APP_VERSION });
    }
});

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
    './client/scenarios/scenarios.js',
    './styles/base.css',
    './styles/game.css',
    './styles/components.css',
    './styles/modals_feedback.css',
    './styles/modals_interaction.css',
    './styles/modals_location.css',
    './styles/gmPanel.css',
    './styles/modals_info.css',
    './styles/themes/school.css',
    './styles/themes/mecha.css',
    './styles/themes/animal.css',
    './styles/themes/modern.css',
    './styles/themes/hero.css',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './favicon.ico',
];

// 安裝：快取靜態資源
self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        // 核心資源任一下載失敗就保留上一版 SW，避免安裝一個不完整的離線版本。
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(STATIC_ASSETS);
        await self.skipWaiting();
    })());
});

// 啟用：清除舊快取
self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
                .map((key) => caches.delete(key))
        );
        await self.clients.claim();
        await coordinateClientUpgrade();
    })());
});

// 攔截請求
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 非 GET、AI Proxy 與第三方資源永遠走網路且不進 App cache。
    if (event.request.method !== 'GET' || url.pathname.includes('/ai/') || url.origin !== self.location.origin) {
        return;
    }

    // 文件採 network-first，確保有網路時能取得最新 shell；離線才回到目前 scope 的 index。
    if (event.request.mode === 'navigate') {
        event.respondWith((async () => {
            try {
                const response = await fetch(event.request);
                if (response.ok) {
                    const cache = await caches.open(CACHE_NAME);
                    await cache.put(new URL('./index.html', self.registration.scope).href, response.clone());
                }
                return response;
            } catch {
                const fallbackUrl = new URL('./index.html', self.registration.scope).href;
                return (await caches.match(fallbackUrl)) || new Response('離線模式：首頁尚未完成快取。', {
                    status: 503,
                    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
                });
            }
        })());
        return;
    }

    // 靜態資源：目前版本的 precache 優先，找不到時才走網路。
    event.respondWith(
        (async () => {
            // Cache Storage is origin-wide, so only consult this app/version.
            const cache = await caches.open(CACHE_NAME);
            const cached = await cache.match(event.request);
            if (cached) return cached;
            const network = fetch(event.request).then(async (response) => {
                if (response.ok) {
                    await cache.put(event.request, response.clone());
                }
                return response;
            });
            try {
                return await network;
            } catch {
                return new Response('離線模式：此資源暫時無法使用。', {
                    status: 503,
                    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
                });
            }
        })()
    );
});
