const LOCAL_PREVIEW_FLAG_KEY = 'fb_local_preview_mock_enabled';
const LOCAL_PREVIEW_TOKEN = 'local-preview-mock-token';
const LOCAL_PREVIEW_USERNAME = '本地測試俠客';

function inBrowser() {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function isLoopbackHost(hostname) {
    return hostname === '127.0.0.1' || hostname === 'localhost';
}

function readSearchParam(params, ...keys) {
    for (const key of keys) {
        const value = params.get(key);
        if (value !== null) return value;
    }
    return null;
}

function safeLocalStorageGet(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function safeLocalStorageSet(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Ignore storage failures in preview helpers.
    }
}

function safeLocalStorageRemove(key) {
    try {
        localStorage.removeItem(key);
    } catch {
        // Ignore storage failures in preview helpers.
    }
}

export function isLocalPreviewMockEnabled() {
    if (!inBrowser()) return false;

    const { hostname, pathname, search } = window.location;
    if (!isLoopbackHost(hostname)) return false;

    const params = new URLSearchParams(search);
    const explicit = readSearchParam(params, 'previewMock', 'mockApi', 'mock');

    if (explicit === '0' || explicit === 'false' || explicit === 'off') {
        safeLocalStorageRemove(LOCAL_PREVIEW_FLAG_KEY);
        return false;
    }

    if (explicit === '1' || explicit === 'true' || explicit === 'on') {
        safeLocalStorageSet(LOCAL_PREVIEW_FLAG_KEY, '1');
        return true;
    }

    if (safeLocalStorageGet(LOCAL_PREVIEW_FLAG_KEY) === '1') {
        return true;
    }

    // Convenience auto-enable for localhost game-page preview.
    const likelyGamePage =
        pathname.endsWith('/index.html') ||
        pathname.endsWith('/map.html') ||
        pathname.endsWith('/relations.html') ||
        pathname === '/' ||
        pathname === '';
    if (likelyGamePage) {
        safeLocalStorageSet(LOCAL_PREVIEW_FLAG_KEY, '1');
        return true;
    }

    return false;
}

export function ensureLocalPreviewAuthSession() {
    if (!isLocalPreviewMockEnabled()) return;

    if (!safeLocalStorageGet('jwt_token')) {
        safeLocalStorageSet('jwt_token', LOCAL_PREVIEW_TOKEN);
    }
    if (!safeLocalStorageGet('username')) {
        safeLocalStorageSet('username', LOCAL_PREVIEW_USERNAME);
    }
}

export function getLocalPreviewIdentity() {
    return {
        token: LOCAL_PREVIEW_TOKEN,
        username: LOCAL_PREVIEW_USERNAME
    };
}
