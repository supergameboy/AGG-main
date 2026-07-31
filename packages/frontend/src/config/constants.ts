export const FRONTEND_TIMEOUTS = {
    // LLM_REQUEST: 300000,
    LLM_REQUEST: 0, // 超时已禁用
    // WS_EVENT_WAIT: 10000,
    WS_EVENT_WAIT: 0, // 超时已禁用
    AI_POLL_INTERVAL: 2000,
    AI_POLL_MAX_ATTEMPTS: 60,
} as const;

export const FRONTEND_DEFAULTS = {
    // INIT_TIMEOUT: 300,
    INIT_TIMEOUT: 0, // 超时已禁用
    SAVE_MESSAGE_DURATION: 3000,
} as const;
