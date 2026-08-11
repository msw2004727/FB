import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const swSource = readFileSync(new URL('../../../sw.js', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../../../scripts/main.js', import.meta.url), 'utf8');

function createWorkerHarness(client) {
    const handlers = Object.create(null);
    const caches = {
        keys: vi.fn(async () => ['wenjiang-v0.26.0', 'unrelated-cache']),
        delete: vi.fn(async () => true),
        open: vi.fn(async () => ({
            addAll: vi.fn(async () => {}),
            match: vi.fn(async () => null),
            put: vi.fn(async () => {}),
        })),
        match: vi.fn(async () => null),
    };
    const self = {
        registration: { scope: 'https://msw2004727.github.io/FB/' },
        location: { origin: 'https://msw2004727.github.io' },
        clients: {
            claim: vi.fn(async () => {}),
            matchAll: vi.fn(async () => [client]),
        },
        skipWaiting: vi.fn(async () => {}),
        addEventListener(type, handler) { handlers[type] = handler; },
    };

    vm.runInNewContext(swSource, {
        self,
        caches,
        URL,
        Response,
        console,
        fetch: vi.fn(),
        setTimeout(callback) {
            Promise.resolve().then(callback);
            return 1;
        },
    });

    async function activate() {
        let completion;
        handlers.activate({ waitUntil(promise) { completion = promise; } });
        await completion;
    }

    return { activate, caches, handlers, self };
}

describe('Service Worker version handoff', () => {
    it('answers a page-ready probe so a client cannot miss the activation broadcast', () => {
        const client = {
            id: 'client-probe',
            url: 'https://msw2004727.github.io/FB/',
            postMessage: vi.fn(),
        };
        const harness = createWorkerHarness(client);

        harness.handlers.message({
            data: { type: 'WENJIANG_SW_CLIENT_READY', decision: 'page-ready' },
            source: client,
        });

        expect(client.postMessage).toHaveBeenCalledWith({
            type: 'WENJIANG_SW_UPGRADE',
            version: 'v0.27.0',
        });
    });

    it('does not navigate an upgrade-aware client that acknowledges the message', async () => {
        const client = {
            id: 'client-current',
            url: 'https://msw2004727.github.io/FB/index.html',
            navigate: vi.fn(async () => {}),
        };
        const harness = createWorkerHarness(client);
        client.postMessage = vi.fn(() => {
            harness.handlers.message({
                data: { type: 'WENJIANG_SW_CLIENT_READY', clientVersion: 'v0.27.0' },
                source: { id: client.id },
            });
        });

        await harness.activate();

        expect(client.postMessage).toHaveBeenCalledWith({
            type: 'WENJIANG_SW_UPGRADE',
            version: 'v0.27.0',
        });
        expect(client.navigate).not.toHaveBeenCalled();
        expect(harness.caches.delete).toHaveBeenCalledWith('wenjiang-v0.26.0');
        expect(harness.caches.delete).not.toHaveBeenCalledWith('unrelated-cache');
    });

    it('notifies but never force-navigates an unacknowledged v0.26 client', async () => {
        const client = {
            id: 'client-legacy',
            url: 'https://msw2004727.github.io/FB/?scenario=wuxia#chapter',
            postMessage: vi.fn(),
            navigate: vi.fn(async () => {}),
        };
        const harness = createWorkerHarness(client);

        await harness.activate();

        expect(client.postMessage).toHaveBeenCalledWith({
            type: 'WENJIANG_SW_UPGRADE',
            version: 'v0.27.0',
        });
        expect(client.navigate).not.toHaveBeenCalled();
        expect(swSource).not.toContain('.navigate(');
    });

    it('does not message or navigate a same-origin window outside the GitHub Pages scope', async () => {
        const client = {
            id: 'client-other-app',
            url: 'https://msw2004727.github.io/another-app/',
            postMessage: vi.fn(),
            navigate: vi.fn(async () => {}),
        };
        const harness = createWorkerHarness(client);

        await harness.activate();

        expect(client.postMessage).not.toHaveBeenCalled();
        expect(client.navigate).not.toHaveBeenCalled();
    });
});

describe('upgrade-aware page safety contract', () => {
    it('acknowledges before reload and defers for input, paid requests, or offline state', () => {
        const deferredAck = mainSource.indexOf("notifyServiceWorker('deferred'");
        const reload = mainSource.indexOf('window.location.reload()', deferredAck);

        expect(deferredAck).toBeGreaterThan(-1);
        expect(reload).toBeGreaterThan(deferredAck);
        expect(mainSource).toContain('if (gameState.isRequesting) return true');
        expect(mainSource).toContain("document.getElementById('player-input')");
        expect(mainSource).toContain("document.getElementById('intro-name-input')");
        expect(mainSource).toContain("document.getElementById('apikey-input')");
        expect(mainSource).toContain('navigator.onLine === false || hasUnsafeUpgradeState()');
        expect(mainSource).toContain("sessionStorage.getItem(SW_RELOAD_ATTEMPT_KEY) === version");
        expect(mainSource).toContain('markUpgradeAttempt(targetVersion)');
        expect(mainSource).toContain('reloadAlreadyAttempted = hasUpgradeMarker(version)');
        expect(mainSource).toContain("url.searchParams.delete(SW_UPGRADE_MARKER)");
    });
});
