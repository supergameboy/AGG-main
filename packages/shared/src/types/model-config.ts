export type ProviderType = 'openai' | 'gemini' | 'deepseek' | 'glm' | 'kimi' | 'anthropic' | 'qwen' | 'ernie' | 'spark' | 'siliconflow' | 'github-copilot' | 'custom';

export type ApiFormat = 'openai' | 'anthropic';

export interface ApiKeyEntry {
  key: string;
  label: string;
  priority: number;
  /**
   * per-key 限流配置（M9 LLMRequestDispatcher TokenBucket 配置源）
   * 缺省时 dispatcher 使用 DEFAULT_TOKEN_BUCKET_CONFIG
   * （capacity=5, refillRatePerSec=1, maxConcurrent=3）
   * 设计文档: solution-design-20260726-llm-request-dispatcher-L2L3-细化设计.md §9.2
   */
  rateLimit?: {
    capacity: number;
    refillRatePerSec: number;
    maxConcurrent: number;
  };
}

export interface ModelProvider {
  id: string;
  providerType: ProviderType;
  name: string;
  baseUrl: string;
  apiFormat: ApiFormat;
  apiKeys: ApiKeyEntry[];
  defaultModel: string;
  maxTokens: number;
  enabled: boolean;
  extraConfig?: {
    thinking?: {
      enabled: boolean;
      /** pi 6 级思考级别（M5 v1.2 D5.3；off = 请求级真正关闭思考） */
      effort?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    };
    /**
     * 模型元数据 DB 覆盖（M2-2，管理员热修正通道）。
     * 结构与 @ai-rpg/ai 的 ModelMetadata 字段级对齐；shared 不能反向依赖 ai 包，
     * 故此处为结构声明（字段全可选，字段级合并语义由 H 层 resolveModelMetadata 保证）。
     * 非法值（负 contextWindow 等）由 H 层 sanitize 忽略并 warn，不在此校验。
     */
    metadata?: {
      name?: string;
      contextWindow?: number;
      maxOutputTokens?: number;
      cost?: {
        input?: number;
        output?: number;
        cacheRead?: number;
        cacheWrite?: number;
      };
      compat?: {
        supportsPromptCache?: boolean;
        supportsThinkingEffort?: boolean;
        supportsTools?: boolean;
        supportsImages?: boolean;
        maxToolCallIdLength?: number;
        toolCallIdPattern?: string;
        promptCacheConvention?: 'inclusive' | 'exclusive';
      };
    };
  } & Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  /**
   * 配置版本号（单调递增，provider_config_changed 事件契约）
   * M9 迁移009新增（DB DEFAULT 0），每次 updateProvider/deleteProvider 时 version = version + 1
   * 设计文档: solution-design-20260726-llm-request-dispatcher-L2L3-细化设计.md §12.1
   */
  version: number;
}

export interface ModelConfigDefaults {
  id: string;
  defaultProviderId: string | null;
  defaultModel: string | null;
  fastProviderId: string | null;
  fastModel: string | null;
  updatedAt: number;
}

export interface ProviderPreset {
  providerType: ProviderType;
  displayName: string;
  openaiBaseUrl: string | null;
  anthropicBaseUrl: string | null;
  recommendedFormat: ApiFormat;
  models: string[];
  supportsOpenai: boolean;
  supportsAnthropic: boolean;
  supportsThinking?: boolean;
  /**
   * OAuth 托管型 Provider（M2-B3）：apiKey 由 OAuth 流程产出并在运行时解析，
   * 前端据此切换表单形态（隐藏 key 编辑器，显示 OAuth 登录区块）
   */
  oauthManaged?: boolean;
}
