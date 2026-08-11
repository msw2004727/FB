// services/aiService.js
// AI provider adapter: deadlines, cancellation, bounded retries, streaming, and telemetry.

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { OpenAI } = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

const LANG_SYSTEM_RULE = '【語言鐵律】你的所有回應文字（包括 JSON 欄位值）必須全程使用「繁體中文」。嚴格禁止簡體中文字元。允許少量 emoji 來增強氣氛與情緒。';
const DEFAULT_TIMEOUT_MS = numberInRange(process.env.AI_TIMEOUT_MS, 30_000, 5_000, 120_000);
const DEFAULT_MAX_RETRIES = numberInRange(process.env.AI_MAX_RETRIES, 0, 0, 1);
const DEFAULT_MAX_COMPLETION_TOKENS = numberInRange(process.env.AI_MAX_COMPLETION_TOKENS, 2048, 256, 4096);

let _minimaxClient = null;
const MINIMAX_QUOTA_CODES = new Set(['1008', '2056']);

function numberInRange(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function getMinimax() {
    if (!_minimaxClient) {
        _minimaxClient = new OpenAI({
            apiKey: process.env.MINIMAX_API_KEY,
            baseURL: process.env.MINIMAX_BASE_URL || 'https://api.minimax.io/v1',
            timeout: DEFAULT_TIMEOUT_MS,
            maxRetries: DEFAULT_MAX_RETRIES,
        });
    }
    return _minimaxClient;
}

function createOpenAIClient(apiKey) {
    return new OpenAI({ apiKey, timeout: DEFAULT_TIMEOUT_MS, maxRetries: DEFAULT_MAX_RETRIES });
}

function createDeepSeekClient(apiKey) {
    return new OpenAI({
        apiKey,
        baseURL: 'https://api.deepseek.com/v1',
        timeout: DEFAULT_TIMEOUT_MS,
        maxRetries: DEFAULT_MAX_RETRIES,
    });
}

function createGrokClient(apiKey) {
    return new OpenAI({
        apiKey,
        baseURL: 'https://api.x.ai/v1',
        timeout: DEFAULT_TIMEOUT_MS,
        maxRetries: DEFAULT_MAX_RETRIES,
    });
}

function createAnthropicClient(apiKey) {
    return new Anthropic({ apiKey, timeout: DEFAULT_TIMEOUT_MS, maxRetries: DEFAULT_MAX_RETRIES });
}

function createGeminiModel(apiKey, modelName, isJsonExpected) {
    const genAI = new GoogleGenerativeAI(apiKey);
    return genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: LANG_SYSTEM_RULE,
        generationConfig: isJsonExpected ? { responseMimeType: 'application/json' } : undefined,
    });
}

function createDeadlineSignal(externalSignal, timeoutMs) {
    const controller = new AbortController();
    const deadline = numberInRange(timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 120_000);
    const onExternalAbort = () => controller.abort(externalSignal?.reason || new Error('上游已取消 AI 請求'));

    if (externalSignal?.aborted) onExternalAbort();
    else externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

    const timer = setTimeout(() => controller.abort(new Error(`AI 請求超過 ${deadline}ms`)), deadline);
    timer.unref?.();

    return {
        signal: controller.signal,
        timeoutMs: deadline,
        cleanup() {
            clearTimeout(timer);
            externalSignal?.removeEventListener('abort', onExternalAbort);
        },
    };
}

function normalizeUsage(rawUsage) {
    if (!rawUsage) return null;
    const input = rawUsage.prompt_tokens ?? rawUsage.input_tokens ?? rawUsage.promptTokenCount ?? 0;
    const output = rawUsage.completion_tokens ?? rawUsage.output_tokens ?? rawUsage.candidatesTokenCount ?? 0;
    const total = rawUsage.total_tokens ?? rawUsage.totalTokenCount ?? (input + output);
    const cached = rawUsage.prompt_tokens_details?.cached_tokens
        ?? rawUsage.cache_read_input_tokens
        ?? rawUsage.cachedContentTokenCount
        ?? 0;
    const reasoning = rawUsage.completion_tokens_details?.reasoning_tokens
        ?? rawUsage.reasoning_tokens
        ?? rawUsage.thoughtsTokenCount
        ?? 0;
    return {
        input_tokens: Number(input) || 0,
        output_tokens: Number(output) || 0,
        total_tokens: Number(total) || 0,
        cached_tokens: Number(cached) || 0,
        reasoning_tokens: Number(reasoning) || 0,
    };
}

function emitTelemetry(event, callback) {
    const payload = {
        type: 'ai_telemetry',
        timestamp: new Date().toISOString(),
        ...event,
    };
    console.log(JSON.stringify(payload));
    try { callback?.(payload); } catch (_) { /* telemetry must never break gameplay */ }
}

const PROVIDER_ERROR_MESSAGES = Object.freeze({
    PROVIDER_QUOTA_EXHAUSTED: 'AI 供應額度目前已用完或受限。請在 AI 模型選單改用自備 API Key（BYOK），或更換有效金鑰後再試。',
    BYOK_QUOTA_EXHAUSTED: '你的自備 API Key 額度已用完或受限。請至供應商後台確認額度，或更換有效金鑰後再試。',
    PROVIDER_RESPONSE_REJECTED: 'AI 服務目前無法接受此請求，請稍後再試或改用自備 API Key（BYOK）。',
    AI_ABORTED: 'AI 請求已取消或逾時。',
    AI_PROVIDER_ERROR: 'AI 服務暫時無法完成請求，請稍後再試。',
});

function providerErrorMetadata(error) {
    const candidates = [
        error,
        error?.error,
        error?.raw,
        error?.raw?.error,
        error?.raw?.base_resp,
        error?.body,
        error?.body?.error,
        error?.body?.base_resp,
        error?.response,
        error?.response?.data,
        error?.response?.data?.error,
        error?.response?.data?.base_resp,
        error?.base_resp,
        error?.cause,
        error?.cause?.error,
        error?.cause?.base_resp,
    ].filter(Boolean);
    const statuses = candidates
        .map(candidate => Number(candidate?.status ?? candidate?.statusCode))
        .filter(Number.isFinite);
    const codes = candidates
        .flatMap(candidate => [
            candidate?.code,
            candidate?.error_code,
            candidate?.type,
            candidate?.status_code,
            candidate?.base_resp?.status_code,
        ])
        .filter(value => value !== undefined && value !== null)
        .map(String);
    return { status: statuses[0] || null, codes };
}

/**
 * Convert provider SDK failures into a small public contract. Never copy the
 * provider's message into this error: SSE errors are sent after headers have
 * already been committed and therefore cannot rely on Express' 5xx redaction.
 */
function normalizeProviderError(error, options = {}) {
    if (error?.isPublicProviderError) {
        if (options.partial) error.partial = true;
        return error;
    }

    const metadata = providerErrorMetadata(error);
    const aborted = Boolean(options.aborted);
    const providerRejected = Boolean(error?.isMinimaxBaseResponseError);
    const quotaExhausted = metadata.status === 429
        || metadata.codes.some(code => MINIMAX_QUOTA_CODES.has(code));
    const code = aborted
        ? 'AI_ABORTED'
        : (quotaExhausted
            ? 'PROVIDER_QUOTA_EXHAUSTED'
            : (providerRejected ? 'PROVIDER_RESPONSE_REJECTED' : 'AI_PROVIDER_ERROR'));
    const status = aborted ? 408 : ((quotaExhausted || providerRejected) ? 503 : 502);
    const message = quotaExhausted && options.hasUserApiKey
        ? PROVIDER_ERROR_MESSAGES.BYOK_QUOTA_EXHAUSTED
        : PROVIDER_ERROR_MESSAGES[code];
    const normalized = new Error(message);
    normalized.name = 'AIProviderError';
    normalized.code = code;
    normalized.status = status;
    normalized.retryable = code === 'AI_PROVIDER_ERROR' && !options.partial;
    normalized.partial = Boolean(options.partial);
    normalized.providerStatus = metadata.status;
    normalized.isPublicProviderError = true;
    normalized.cause = error;
    return normalized;
}

function minimaxBaseResponseCode(payload) {
    const value = payload?.base_resp?.status_code ?? payload?.status_code;
    if (value === undefined || value === null || value === '') return null;
    return String(value);
}

function assertMinimaxResponseSucceeded(payload) {
    const code = minimaxBaseResponseCode(payload);
    if (code === null || code === '0') return;
    const providerError = new Error('MiniMax returned a non-success base response');
    providerError.status_code = code;
    providerError.base_resp = payload?.base_resp;
    providerError.raw = payload;
    providerError.isMinimaxBaseResponseError = true;
    throw providerError;
}

function createMinimaxStreamProtocolError(payload = null) {
    const providerError = new Error('MiniMax returned a non-SSE response to a streaming request');
    providerError.status_code = minimaxBaseResponseCode(payload);
    providerError.base_resp = payload?.base_resp;
    providerError.raw = payload;
    providerError.isMinimaxBaseResponseError = true;
    return providerError;
}

async function inspectMinimaxStreamResponse(streamRequest) {
    // OpenAI's APIPromise does not parse or consume the body when asResponse()
    // is used. Inspect a clone before handing the original response to its SSE
    // parser, because MiniMax can return HTTP 200 application/json errors for a
    // stream request and the SDK then yields no chunks.
    if (typeof streamRequest?.asResponse !== 'function') return;
    const response = await streamRequest.asResponse();
    const mediaType = String(response.headers.get('content-type') || '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
    if (mediaType === 'text/event-stream') return;

    let payload = null;
    if (mediaType === 'application/json' || mediaType.endsWith('+json')) {
        try { payload = await response.clone().json(); } catch (_) { /* reject below */ }
    }
    if (payload) assertMinimaxResponseSucceeded(payload);
    throw createMinimaxStreamProtocolError(payload);
}

function setMinimaxClientForTests(client) {
    _minimaxClient = client || null;
}

function publicProviderErrorPayload(error, requestId) {
    if (!error?.isPublicProviderError) return null;
    return {
        success: false,
        code: error.code,
        error: error.message,
        request_id: requestId,
        retryable: Boolean(error.retryable),
        status: error.status,
    };
}

function providerRequestOptions(config, signal, timeoutMs) {
    return {
        signal,
        timeout: timeoutMs,
        maxRetries: numberInRange(config.maxRetries, DEFAULT_MAX_RETRIES, 0, 1),
    };
}

function commonOpenAIOptions(prompt, isJsonExpected) {
    const options = {
        messages: [
            { role: 'system', content: LANG_SYSTEM_RULE },
            { role: 'user', content: prompt },
        ],
    };
    if (isJsonExpected) options.response_format = { type: 'json_object' };
    return options;
}

function minimaxOptions(prompt, _isJsonExpected, config = {}) {
    const model = process.env.MINIMAX_MODEL || 'MiniMax-M2.7';
    const options = {
        // MiniMax documents response_format as MiniMax-Text-01-only. M2.x/M3
        // JSON is enforced by the prompt contract and validated after parsing.
        ...commonOpenAIOptions(prompt, false),
        model,
        max_completion_tokens: numberInRange(
            config.maxCompletionTokens,
            DEFAULT_MAX_COMPLETION_TOKENS,
            256,
            4096
        ),
        // Separating reasoning prevents <think> text from being exposed to the browser stream.
        reasoning_split: true,
    };
    // M3 is opt-in. M2.x remains the default until production canaries pass.
    if (/^MiniMax-M3(?:$|-)/i.test(model) && process.env.MINIMAX_DISABLE_THINKING === 'true') {
        options.thinking = { type: 'disabled' };
    }
    return options;
}

function stripThinking(text) {
    return String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

async function executeNonStreaming(modelName, prompt, isJsonExpected, config, userApiKey, signal, timeoutMs) {
    const requestOptions = providerRequestOptions(config, signal, timeoutMs);
    const normalizedModel = String(modelName || 'minimax').trim().toLowerCase();

    switch (normalizedModel) {
        case 'openai':
        case 'gpt5.4': {
            const key = userApiKey || process.env.OPENAI_API_KEY;
            if (!key) throw new Error('缺少 OpenAI API Key，請在前端設定頁面填寫。');
            const body = {
                ...commonOpenAIOptions(prompt, isJsonExpected),
                model: 'gpt-5.4-mini',
                max_completion_tokens: numberInRange(config.maxCompletionTokens, DEFAULT_MAX_COMPLETION_TOKENS, 256, 4096),
            };
            const result = await createOpenAIClient(key).chat.completions.create(body, requestOptions);
            return {
                text: result.choices?.[0]?.message?.content || '',
                providerModel: result.model || body.model,
                usage: normalizeUsage(result.usage),
                providerRequestId: result._request_id || null,
            };
        }
        case 'deepseek': {
            const key = userApiKey || process.env.DEEPSEEK_API_KEY;
            if (!key) throw new Error('缺少 DeepSeek API Key，請在前端設定頁面填寫。');
            const body = {
                ...commonOpenAIOptions(prompt, isJsonExpected),
                model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
                max_tokens: numberInRange(config.maxCompletionTokens, DEFAULT_MAX_COMPLETION_TOKENS, 256, 4096),
            };
            const result = await createDeepSeekClient(key).chat.completions.create(body, requestOptions);
            return {
                text: result.choices?.[0]?.message?.content || '',
                providerModel: result.model || body.model,
                usage: normalizeUsage(result.usage),
                providerRequestId: result._request_id || null,
            };
        }
        case 'grok': {
            const key = userApiKey || process.env.GROK_API_KEY;
            if (!key) throw new Error('缺少 Grok API Key，請在前端設定頁面填寫。');
            const body = {
                ...commonOpenAIOptions(prompt, isJsonExpected),
                model: process.env.GROK_MODEL || 'grok-4.20',
                max_tokens: numberInRange(config.maxCompletionTokens, DEFAULT_MAX_COMPLETION_TOKENS, 256, 4096),
            };
            const result = await createGrokClient(key).chat.completions.create(body, requestOptions);
            return {
                text: result.choices?.[0]?.message?.content || '',
                providerModel: result.model || body.model,
                usage: normalizeUsage(result.usage),
                providerRequestId: result._request_id || null,
            };
        }
        case 'gemini':
        case 'gemma': {
            const key = userApiKey || process.env.GOOGLE_API_KEY;
            if (!key) throw new Error('缺少 Google API Key，請在前端設定頁面填寫。');
            const providerModel = normalizedModel === 'gemma'
                ? (process.env.GEMMA_MODEL || 'gemma-4-31b-it')
                : (process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview');
            const model = createGeminiModel(key, providerModel, isJsonExpected);
            const result = await model.generateContent(prompt, { signal });
            const response = await result.response;
            return {
                text: response.text(),
                providerModel,
                usage: normalizeUsage(response.usageMetadata),
                providerRequestId: null,
            };
        }
        case 'cluade':
        case 'claude': {
            const key = userApiKey || process.env.ANTHROPIC_API_KEY;
            if (!key) throw new Error('缺少 Anthropic Claude API Key，請在前端設定頁面填寫。');
            const body = {
                model: process.env.CLAUDE_MODEL || 'claude-opus-4-6',
                max_tokens: numberInRange(config.maxCompletionTokens, DEFAULT_MAX_COMPLETION_TOKENS, 256, 4096),
                system: isJsonExpected
                    ? `${LANG_SYSTEM_RULE}\n\n回應必須是單一有效 JSON 物件，不可加入其他文字。`
                    : LANG_SYSTEM_RULE,
                messages: [{ role: 'user', content: prompt }],
            };
            const result = await createAnthropicClient(key).messages.create(body, requestOptions);
            return {
                text: result.content?.find(block => block.type === 'text')?.text || '',
                providerModel: result.model || body.model,
                usage: normalizeUsage(result.usage),
                providerRequestId: result._request_id || null,
            };
        }
        case 'minimax':
        default: {
            if (normalizedModel !== 'minimax') {
                console.warn(`[AI 調度中心] 未知模型 '${modelName}'，為相容舊客戶端改用 minimax`);
            }
            if (!process.env.MINIMAX_API_KEY) throw new Error('伺服器缺少 MiniMax API Key。');
            const body = minimaxOptions(prompt, isJsonExpected, config);
            const result = await getMinimax().chat.completions.create(body, requestOptions);
            assertMinimaxResponseSucceeded(result);
            return {
                text: stripThinking(result.choices?.[0]?.message?.content || ''),
                providerModel: result.model || body.model,
                usage: normalizeUsage(result.usage),
                providerRequestId: result._request_id || null,
            };
        }
    }
}

async function callAI(modelName, prompt, isJsonExpected = false, retryConfig = {}, userApiKey = null) {
    const config = retryConfig && typeof retryConfig === 'object' ? retryConfig : {};
    const startedAt = Date.now();
    const deadline = createDeadlineSignal(config.signal, config.timeoutMs);
    let providerModel = null;

    try {
        const result = await executeNonStreaming(
            modelName,
            prompt,
            isJsonExpected,
            config,
            userApiKey,
            deadline.signal,
            deadline.timeoutMs
        );
        providerModel = result.providerModel;
        const totalMs = Date.now() - startedAt;
        emitTelemetry({
            request_id: config.requestId || null,
            task: config.task || 'unknown',
            requested_model: modelName || 'minimax',
            provider_model: providerModel,
            streamed: false,
            status: 'ok',
            ttft_ms: totalMs,
            total_ms: totalMs,
            prompt_chars: String(prompt || '').length,
            usage: result.usage,
            provider_request_id: result.providerRequestId,
        }, config.onTelemetry);
        return result.text;
    } catch (error) {
        const totalMs = Date.now() - startedAt;
        const normalizedError = normalizeProviderError(error, {
            aborted: deadline.signal.aborted,
            hasUserApiKey: Boolean(userApiKey),
        });
        emitTelemetry({
            request_id: config.requestId || null,
            task: config.task || 'unknown',
            requested_model: modelName || 'minimax',
            provider_model: providerModel,
            streamed: false,
            status: deadline.signal.aborted ? 'aborted' : 'error',
            total_ms: totalMs,
            prompt_chars: String(prompt || '').length,
            error_code: normalizedError.code,
            provider_status: normalizedError.providerStatus,
        }, config.onTelemetry);
        throw normalizedError;
    } finally {
        deadline.cleanup();
    }
}

/**
 * Stream MiniMax content. Other providers deliberately fall back to one bounded
 * non-streaming call so existing BYOK providers remain safe and compatible.
 */
async function streamAI(modelName, prompt, isJsonExpected = false, retryConfig = {}, userApiKey = null, onDelta = null) {
    const config = retryConfig && typeof retryConfig === 'object' ? retryConfig : {};
    const normalizedModel = String(modelName || 'minimax').trim().toLowerCase();
    if (normalizedModel !== 'minimax') {
        const text = await callAI(modelName, prompt, isJsonExpected, config, userApiKey);
        await onDelta?.(text);
        return { text, streamed: false };
    }

    const startedAt = Date.now();
    const deadline = createDeadlineSignal(config.signal, config.timeoutMs);
    const body = {
        ...minimaxOptions(prompt, isJsonExpected, config),
        stream: true,
        stream_options: { include_usage: true },
    };
    const requestOptions = providerRequestOptions(config, deadline.signal, deadline.timeoutMs);
    let textResponse = '';
    let ttftMs = null;
    let usage = null;
    let providerModel = body.model;
    let providerRequestId = null;

    try {
        if (!process.env.MINIMAX_API_KEY) throw new Error('伺服器缺少 MiniMax API Key。');
        const streamRequest = getMinimax().chat.completions.create(body, requestOptions);
        await inspectMinimaxStreamResponse(streamRequest);
        const stream = await streamRequest;
        assertMinimaxResponseSucceeded(stream);
        providerRequestId = stream.request_id || stream._request_id || null;

        for await (const chunk of stream) {
            if (deadline.signal.aborted) break;
            assertMinimaxResponseSucceeded(chunk);
            providerModel = chunk.model || providerModel;
            if (chunk.usage) usage = normalizeUsage(chunk.usage);
            const content = chunk.choices?.[0]?.delta?.content;
            if (!content) continue;

            // Some compatible endpoints send cumulative text instead of deltas.
            const delta = content.startsWith(textResponse) ? content.slice(textResponse.length) : content;
            if (!delta) continue;
            if (ttftMs === null) ttftMs = Date.now() - startedAt;
            textResponse += delta;
            await onDelta?.(delta);
        }

        if (deadline.signal.aborted) throw deadline.signal.reason || new Error('AI 串流已取消');
        const cleanedText = stripThinking(textResponse);
        const totalMs = Date.now() - startedAt;
        emitTelemetry({
            request_id: config.requestId || null,
            task: config.task || 'unknown',
            requested_model: modelName || 'minimax',
            provider_model: providerModel,
            streamed: true,
            status: 'ok',
            ttft_ms: ttftMs ?? totalMs,
            total_ms: totalMs,
            prompt_chars: String(prompt || '').length,
            usage,
            provider_request_id: providerRequestId,
        }, config.onTelemetry);
        return { text: cleanedText, streamed: true };
    } catch (error) {
        const totalMs = Date.now() - startedAt;
        const normalizedError = normalizeProviderError(error, {
            aborted: deadline.signal.aborted,
            partial: textResponse.length > 0,
            hasUserApiKey: Boolean(userApiKey),
        });
        emitTelemetry({
            request_id: config.requestId || null,
            task: config.task || 'unknown',
            requested_model: modelName || 'minimax',
            provider_model: providerModel,
            streamed: true,
            status: deadline.signal.aborted ? 'aborted' : 'error',
            ttft_ms: ttftMs,
            total_ms: totalMs,
            prompt_chars: String(prompt || '').length,
            usage,
            error_code: normalizedError.code,
            provider_status: normalizedError.providerStatus,
        }, config.onTelemetry);
        throw normalizedError;
    } finally {
        deadline.cleanup();
    }
}

async function getAIGeneratedImage(prompt) {
    try {
        const key = process.env.OPENAI_API_KEY;
        if (!key) return null;
        const client = createOpenAIClient(key);
        const response = await client.images.generate({
            model: 'dall-e-3',
            prompt,
            n: 1,
            size: '1024x1024',
            quality: 'hd',
            style: 'vivid',
        }, { timeout: 60_000, maxRetries: 0 });
        return response.data?.[0]?.url || null;
    } catch (error) {
        console.error('[AI 畫師] 圖片生成失敗:', error.message);
        return null;
    }
}

function parseJsonResponse(text) {
    let cleaned = stripThinking(text);
    cleaned = cleaned.replace(/^```json\s*|```\s*$/g, '').trim();
    return JSON.parse(cleaned);
}

module.exports = {
    callAI,
    streamAI,
    getAIGeneratedImage,
    parseJsonResponse,
    stripThinking,
    normalizeUsage,
    normalizeProviderError,
    publicProviderErrorPayload,
    _internals: {
        minimaxOptions,
        normalizeProviderError,
        publicProviderErrorPayload,
        assertMinimaxResponseSucceeded,
        inspectMinimaxStreamResponse,
        setMinimaxClientForTests,
    },
};
