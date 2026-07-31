export const LLM_DEFAULTS = {
    maxTokens: 16000,
    apiMaxTokens: 16384,
    temperature: 0.7,
    maxRetries: 3,
    // 与 OpenAI SDK 默认值一致（10 分钟）。不能用 0——OpenAI SDK v6 中 timeout: 0 会触发 setTimeout(abort, 0) 立即超时 + 重试，导致请求必定失败
    timeout: 600000,
} as const;

export type LLMDefaultsType = {
    maxTokens: number;
    apiMaxTokens: number;
    temperature: number;
    maxRetries: number;
    timeout: number;
};
