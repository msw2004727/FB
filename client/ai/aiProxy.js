// client/ai/aiProxy.js
// AI Proxy client: short-lived BYOK, anti-abuse sessions, SSE, cancellation.

import { getStoredApiKey } from '../../scripts/aiModelPreference.js';

const PROXY_URL_KEY = 'wenjiang_ai_proxy_url';
const SESSION_KEY_PREFIX = 'fb_ai_proxy_session_';
const SESSION_REFRESH_SKEW_MS = 30_000;
const SESSION_ERROR_CODES = new Set(['SESSION_REQUIRED', 'SESSION_INVALID', 'SESSION_EXPIRED']);
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;

const _sessionCache = new Map();
const _sessionPromises = new Map();
const _sessionUnsupportedUntil = new Map();

function detectDefaultProxyUrl() {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3001';
    return 'https://wenjiang-ai-proxy-322557520154.us-central1.run.app';
}

function getProxyUrl() {
    try {
        return localStorage.getItem(PROXY_URL_KEY) || detectDefaultProxyUrl();
    } catch (_) {
        return detectDefaultProxyUrl();
    }
}

function getUserApiKey(model) {
    if (!model) return null;
    // The shared credential store uses sessionStorage when available and an
    // in-memory fallback when browser storage is restricted. It never reads
    // long-lived localStorage credentials.
    return getStoredApiKey(model);
}

function sessionStorageKey(proxyBase) {
    return `${SESSION_KEY_PREFIX}${encodeURIComponent(proxyBase)}`;
}

function isUsableSession(session) {
    if (!session?.token || !session?.expiresAt) return false;
    const expiresAt = Date.parse(session.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt - SESSION_REFRESH_SKEW_MS > Date.now();
}

function loadSession(proxyBase) {
    const memoryValue = _sessionCache.get(proxyBase);
    if (isUsableSession(memoryValue)) return memoryValue;
    try {
        const parsed = JSON.parse(sessionStorage.getItem(sessionStorageKey(proxyBase)) || 'null');
        if (isUsableSession(parsed)) {
            _sessionCache.set(proxyBase, parsed);
            return parsed;
        }
        sessionStorage.removeItem(sessionStorageKey(proxyBase));
    } catch {
        try { sessionStorage.removeItem(sessionStorageKey(proxyBase)); } catch (_) { /* ignore */ }
    }
    _sessionCache.delete(proxyBase);
    return null;
}

function storeSession(proxyBase, session) {
    _sessionCache.set(proxyBase, session);
    try { sessionStorage.setItem(sessionStorageKey(proxyBase), JSON.stringify(session)); } catch (_) { /* memory cache remains */ }
}

function clearSession(proxyBase) {
    _sessionCache.delete(proxyBase);
    try { sessionStorage.removeItem(sessionStorageKey(proxyBase)); } catch (_) { /* ignore */ }
}

function hasLeadingZeroBits(bytes, difficulty) {
    let remaining = Math.max(0, Number(difficulty) || 0);
    for (const byte of bytes) {
        if (remaining <= 0) return true;
        if (remaining >= 8) {
            if (byte !== 0) return false;
            remaining -= 8;
            continue;
        }
        return (byte >>> (8 - remaining)) === 0;
    }
    return remaining <= 0;
}

async function solveProofOfWork(token, difficulty, signal) {
    if (!globalThis.crypto?.subtle) throw new Error('此瀏覽器不支援安全的 session 驗證。');
    const encoder = new TextEncoder();
    const maxDifficulty = 24;
    const requestedDifficulty = Number(difficulty);
    if (!Number.isInteger(requestedDifficulty) || requestedDifficulty < 0 || requestedDifficulty > maxDifficulty) {
        throw new Error('Session challenge 難度不在允許範圍');
    }
    const bits = requestedDifficulty;

    for (let solution = 0; ; solution++) {
        if (signal?.aborted) throw signal.reason || new DOMException('已取消', 'AbortError');
        const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(`${token}.${solution}`));
        if (hasLeadingZeroBits(new Uint8Array(digest), bits)) return String(solution);
        if (solution > 0 && solution % 500 === 0) {
            // Keep the page responsive on lower-powered mobile devices.
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
}

async function requestNewSession(proxyBase, signal) {
    const challengeResponse = await fetch(`${proxyBase}/session/challenge`, {
        method: 'GET',
        cache: 'no-store',
        signal,
    });

    // Backward compatibility with old/local proxy deployments that do not yet
    // expose the anti-abuse session endpoints.
    if (challengeResponse.status === 404 || challengeResponse.status === 405) {
        _sessionUnsupportedUntil.set(proxyBase, Date.now() + 5 * 60_000);
        return null;
    }
    if (!challengeResponse.ok) throw new Error(`Session challenge 失敗 (${challengeResponse.status})`);

    const challengePayload = await challengeResponse.json();
    const challenge = challengePayload?.challenge;
    if (!challengePayload?.success || !challenge?.token || challenge.algorithm !== 'sha256') {
        throw new Error('Session challenge 格式不正確');
    }
    if (Date.parse(challenge.expiresAt) <= Date.now()) throw new Error('Session challenge 已過期');

    const solution = await solveProofOfWork(challenge.token, challenge.difficulty, signal);
    const sessionResponse = await fetch(`${proxyBase}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: challenge.token, solution }),
        cache: 'no-store',
        signal,
    });
    if (!sessionResponse.ok) throw new Error(`Session 建立失敗 (${sessionResponse.status})`);
    const sessionPayload = await sessionResponse.json();
    const session = sessionPayload?.session;
    if (!sessionPayload?.success || !isUsableSession(session)) throw new Error('Session 回應格式不正確');
    storeSession(proxyBase, session);
    return session;
}

async function ensureSession(proxyBase, signal, forceRefresh = false) {
    if (!forceRefresh) {
        const cached = loadSession(proxyBase);
        if (cached) return cached;
        if ((_sessionUnsupportedUntil.get(proxyBase) || 0) > Date.now()) return null;
    } else {
        clearSession(proxyBase);
        _sessionUnsupportedUntil.delete(proxyBase);
    }

    if (_sessionPromises.has(proxyBase)) return _sessionPromises.get(proxyBase);
    const promise = requestNewSession(proxyBase, signal).finally(() => _sessionPromises.delete(proxyBase));
    _sessionPromises.set(proxyBase, promise);
    return promise;
}

async function readSessionErrorCode(response) {
    if (response.status !== 401) return null;
    try {
        const body = await response.clone().json();
        return body?.code || body?.error?.code || null;
    } catch {
        return null;
    }
}

async function fetchWithSession(proxyBase, path, init, signal, allowSessionRetry = true) {
    const session = await ensureSession(proxyBase, signal);
    const headers = new Headers(init.headers || {});
    if (session?.token) headers.set(session.header || 'X-FB-Session', session.token);
    let response = await fetch(`${proxyBase}${path}`, { ...init, headers, signal });

    const errorCode = await readSessionErrorCode(response);
    if (allowSessionRetry && SESSION_ERROR_CODES.has(errorCode)) {
        const refreshed = await ensureSession(proxyBase, signal, true);
        const retryHeaders = new Headers(init.headers || {});
        if (refreshed?.token) retryHeaders.set(refreshed.header || 'X-FB-Session', refreshed.token);
        response = await fetch(`${proxyBase}${path}`, { ...init, headers: retryHeaders, signal });
    }
    return response;
}

function createRequestSignal(externalSignal, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const onAbort = () => controller.abort(externalSignal?.reason || new DOMException('已取消', 'AbortError'));
    if (externalSignal?.aborted) onAbort();
    else externalSignal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(
        () => controller.abort(new DOMException('AI 請求逾時', 'TimeoutError')),
        Math.max(5_000, Math.min(120_000, Number(timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS))
    );
    return {
        signal: controller.signal,
        cleanup() {
            clearTimeout(timer);
            externalSignal?.removeEventListener('abort', onAbort);
        },
    };
}

async function throwProxyError(response, fallback) {
    const errorText = await response.text();
    let errorMessage = fallback;
    try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorJson.error || errorJson.message || errorText;
    } catch {
        if (errorText) errorMessage = errorText;
    }
    throw new Error(`AI Proxy 錯誤 (${response.status}): ${errorMessage}`);
}

async function parseEventStream(response, onStoryDelta) {
    if (!response.body?.getReader) throw new Error('此瀏覽器不支援串流回應。');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventName = 'message';
    let dataLines = [];
    let finalPayload = null;

    const dispatch = async () => {
        if (dataLines.length === 0) {
            eventName = 'message';
            return;
        }
        const rawData = dataLines.join('\n');
        dataLines = [];
        let payload;
        try { payload = JSON.parse(rawData); } catch { payload = { text: rawData }; }
        if (eventName === 'story_delta' && payload.text) await onStoryDelta?.(payload.text);
        else if (eventName === 'result') finalPayload = payload;
        else if (eventName === 'error') {
            const error = new Error(payload.error || 'AI 串流失敗');
            error.code = payload.code;
            throw error;
        }
        eventName = 'message';
    };

    try {
        while (true) {
            const { value, done } = await reader.read();
            buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
            const lines = buffer.split(/\r?\n/);
            buffer = done ? '' : lines.pop();
            for (const line of lines) {
                if (line === '') await dispatch();
                else if (line.startsWith('event:')) eventName = line.slice(6).trim();
                else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
            }
            if (done) {
                if (buffer?.startsWith('data:')) dataLines.push(buffer.slice(5).trimStart());
                await dispatch();
                break;
            }
        }
    } catch (error) {
        await reader.cancel(error).catch(() => {});
        throw error;
    } finally {
        reader.releaseLock();
    }

    if (!finalPayload?.success) throw new Error(finalPayload?.error || 'AI 串流未回傳最終結果');
    return finalPayload.data;
}

function emitStoryDelta(text, callback) {
    if (!text) return;
    try { callback?.(text); } catch (_) { /* UI callback must not abort the stream */ }
    try {
        window.dispatchEvent(new CustomEvent('wenjiang:story-delta', { detail: { text } }));
    } catch (_) { /* non-browser tests */ }
}

export function setProxyUrl(url) {
    localStorage.setItem(PROXY_URL_KEY, url);
}

/**
 * @param {string} task AI task name
 * @param {string|null} model Explicit model, or null to use server task routing
 * @param {object} context Game context
 * @param {{stream?: boolean, onStoryDelta?: Function, signal?: AbortSignal, timeoutMs?: number}} options
 */
export async function generate(task, model, context, options = {}) {
    const resolvedModel = model ? String(model).trim().toLowerCase() : null;
    const apiKey = getUserApiKey(resolvedModel);
    const proxyBase = getProxyUrl();
    const shouldStream = options.stream ?? (task === 'story');
    const request = createRequestSignal(options.signal, options.timeoutMs);
    const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // Keep the request body on the strict /ai/generate allowlist. Streaming is
    // negotiated only through Accept, and an omitted model lets server task
    // routing choose its configured default.
    const body = { task, context };
    if (resolvedModel) body.model = resolvedModel;
    if (apiKey) body.apiKey = apiKey;

    try {
        const response = await fetchWithSession(proxyBase, '/ai/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: shouldStream ? 'text/event-stream' : 'application/json',
                'X-Request-ID': requestId,
            },
            body: JSON.stringify(body),
        }, request.signal);

        if (!response.ok) await throwProxyError(response, 'AI 生成失敗');
        const contentType = response.headers.get('content-type') || '';
        if (shouldStream && contentType.includes('text/event-stream')) {
            return await parseEventStream(response, text => emitStoryDelta(text, options.onStoryDelta));
        }

        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'AI 生成失敗');
        return data.data;
    } finally {
        request.cleanup();
    }
}

export async function generateImage(prompt, options = {}) {
    const proxyBase = getProxyUrl();
    const request = createRequestSignal(options.signal, options.timeoutMs || 90_000);
    try {
        const response = await fetchWithSession(proxyBase, '/ai/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
        }, request.signal);
        if (!response.ok) await throwProxyError(response, '圖片生成失敗');
        const data = await response.json();
        if (!data.success) throw new Error(data.error || '圖片生成失敗');
        return data;
    } finally {
        request.cleanup();
    }
}

export async function checkConnection() {
    const request = createRequestSignal(null, 5_000);
    try {
        const response = await fetch(`${getProxyUrl()}/health`, { method: 'GET', signal: request.signal });
        return response.ok;
    } catch {
        return false;
    } finally {
        request.cleanup();
    }
}

const aiProxy = { generate, generateImage, checkConnection, setProxyUrl, getProxyUrl };
export default aiProxy;
