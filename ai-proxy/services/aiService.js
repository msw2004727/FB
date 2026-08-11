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
        emitTelemetry({
            request_id: config.requestId || null,
            task: config.task || 'unknown',
            requested_model: modelName || 'minimax',
            provider_model: providerModel,
            streamed: false,
            status: deadline.signal.aborted ? 'aborted' : 'error',
            total_ms: totalMs,
            prompt_chars: String(prompt || '').length,
            error: error?.message || String(error),
        }, config.onTelemetry);
        const detail = error?.message || String(error);
        const wrapped = new Error(`AI模型 ${modelName || 'minimax'} 呼叫失敗: ${detail}`);
        wrapped.cause = error;
        wrapped.code = deadline.signal.aborted ? 'AI_ABORTED' : 'AI_PROVIDER_ERROR';
        throw wrapped;
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
        const stream = await getMinimax().chat.completions.create(body, requestOptions);
        providerRequestId = stream.request_id || stream._request_id || null;

        for await (const chunk of stream) {
            if (deadline.signal.aborted) break;
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
            error: error?.message || String(error),
        }, config.onTelemetry);
        const wrapped = new Error(`AI模型 ${modelName || 'minimax'} 串流失敗: ${error?.message || String(error)}`);
        wrapped.cause = error;
        wrapped.code = deadline.signal.aborted ? 'AI_ABORTED' : 'AI_PROVIDER_ERROR';
        wrapped.partial = textResponse.length > 0;
        throw wrapped;
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
    _internals: {
        minimaxOptions,
    },
};
