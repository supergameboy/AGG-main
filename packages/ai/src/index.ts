/**
 * @ai-rpg/ai — LLM 独立包入口
 *
 * 设计目标（详见 docs/design/fractal-design-20260626-backend-decoupling-refactor/模块A）：
 * - 纯函数，零状态
 * - 零业务依赖（不依赖 agents/、game-systems/、services/ 的任何模块）
 * - 给定 model + context 返回 stream
 * - 被 Agent 核心通过接口调用
 *
 * P1-S3：从 packages/backend/src/llm/ 完整迁移而来
 */

// ===== 类型契约（LLMClient/Provider 层）=====
// 注意：types.ts 的 ChatOptions/LLMResponse/StreamChunk 是 LLMClient 层类型，
// 与 LLMService.ts 的同名类型（LLMService 层）定义不同，此处用 as 重命名导出避免冲突
export type {
  LLMConfig,
  LLMProvider,
  ToolDefinition,
  ToolCallResult,
  LLMClient,
} from './types.js';
export type { ChatOptions as LLMClientChatOptions } from './types.js';
export type { LLMResponse as LLMClientResponse } from './types.js';
export type { StreamChunk as LLMClientStreamChunk } from './types.js';

// ===== 流式事件体系（M1：12 种 LLMStreamEvent + EventStream）=====
export { EventStream } from './event-stream.js';
export type {
  LLMStreamEvent,
  LLMStreamStartEvent,
  LLMStreamDoneEvent,
  LLMStreamErrorEvent,
  LLMStreamTextStartEvent,
  LLMStreamTextDeltaEvent,
  LLMStreamTextEndEvent,
  LLMStreamThinkingStartEvent,
  LLMStreamThinkingDeltaEvent,
  LLMStreamThinkingEndEvent,
  LLMStreamToolCallStartEvent,
  LLMStreamToolCallDeltaEvent,
  LLMStreamToolCallEndEvent,
  LLMStreamPartial,
  LLMStreamFinalMessage,
  LLMStreamToolCall,
  LLMStreamUsage,
  LLMStreamErrorInfo,
  LLMFinishReason,
  LLMStreamEventStream,
} from './types.js';

// ===== 端口接口（M1：度量出口 + 模型配置存储）=====
export { NullLLMMetricsSink } from './types.js';
export type {
  ILLMMetricsSink,
  LLMCallMetricsPayload,
  IModelConfigStore,
  ModelProviderStoreRow,
  ModelConfigDefaultsStoreRow,
} from './types.js';

// ===== 默认值 =====
export { LLM_DEFAULTS } from './defaults.js';

// ===== 错误体系（简化版，不依赖 AppError/ErrorCode） =====
export {
  LLMError,
  LLMInvalidApiKeyError,
  LLMModelUnavailableError,
  LLMTokenLimitExceededError,
  LLMContentFilteredError,
  LLMTimeoutError,
  LLMNetworkError,
  LLMProviderLoadError,
} from './errors.js';

// ===== 智能重试 =====
export { SmartRetry, smartRetry } from './retry/smart-retry.js';
export type {
  LLMErrorCategory,
  ClassifiedError,
  RetryStrategy,
  SmartRetryConfig,
} from './retry/smart-retry.js';

// ===== 流式事件组装（M1：StreamChunk → LLMStreamEvent）=====
export { StreamEventAssembler } from './stream.js';

// ===== Provider 体系 =====
export { BaseProvider } from './providers/BaseProvider.js';
export { providerFactory } from './providers/providerFactory.js';
export {
  registerProvider,
  getProviderFactory,
  hasProvider,
  listProviderTypes,
  clearProviderRegistry,
  unregisterProviders,
  getProviderSourceId,
} from './provider-registry.js';
export type { ProviderFactoryFn } from './provider-registry.js';
export {
  PROVIDER_PRESETS,
  getPreset,
  getBaseUrlForFormat,
} from './providers/providerPresets.js';

// M2-1：Provider 类不再从包入口导出——导出即 eager 加载全部 Provider 模块，
// 违背 lazy loading 目标（register-builtins 已全部改 lazy 工厂）。
// 包内测试经相对路径直接 import 具体 Provider 类。

// ===== M2-1 Lazy Loading（LazyProviderProxy + lazy 工厂） =====
export { LazyProviderProxy, createLazyProviderFactory } from './utils/lazy-provider.js';
export type {
  ProviderConstructor,
  ProviderModuleLoader,
  LazyProviderOptions,
} from './utils/lazy-provider.js';

// ===== M2-2 Model 元数据（静态表 + DB override + 成本计算） =====
export {
  resolveModelMetadata,
  getBuiltinModelMetadata,
  listBuiltinModelMetadata,
  calculateCost,
} from './model-metadata.js';
export type {
  ModelCost,
  ModelCompat,
  ModelMetadata,
  ModelUsage,
  ModelCostBreakdown,
} from './model-metadata.js';

// ===== M2-3 transform-messages（跨 Provider toolCall ID 归一化） =====
export { normalizeToolCallIds } from './utils/transform-messages.js';
export type {
  ToolCallIdTarget,
  ToolCallIdCarrier,
  NormalizeToolCallIdsResult,
} from './utils/transform-messages.js';

// ===== M2-4 OAuth（B3 起内置 github-copilot，经 oauth-registry 模块加载登记） =====
export { OAuthCredentialService, gitHubCopilotOAuthProvider } from './oauth/index.js';
export {
  registerOAuthProvider,
  getOAuthProvider,
  listOAuthProviders,
  unregisterOAuthProvider,
  resetOAuthProviders,
  pollDeviceCodeFlow,
  LOGIN_CANCELLED_MESSAGE,
} from './oauth/index.js';
export type {
  OAuthCredentials,
  OAuthDeviceCodeInfo,
  OAuthAuthUrlInfo,
  OAuthLoginSession,
  OAuthPollResult,
  OAuthProviderInterface,
  IOAuthCredentialStore,
  DeviceCodePollResult,
  PollDeviceCodeFlowOptions,
} from './oauth/index.js';

// ===== M2-5 图像 Provider（接口先行 B2：仅注册中心 + 入口，0 Provider 实现） =====
// 预期管理（R2）：同 M2-4——generateImages 对未注册 api 抛清晰 Error 是预期行为；
// 首个实现随 ImageGenService 重设计立项交付（B3）。
export {
  registerImagesApiProvider,
  getImagesApiProvider,
  listImagesApiProviders,
  unregisterImagesApiProviders,
  generateImages,
} from './images-api-registry.js';
export type {
  ImagesModel,
  ImagesContext,
  ImagesOptions,
  GeneratedImage,
  AssistantImages,
  ImagesApiProvider,
} from './images-types.js';

// ===== 辅助工具（供 backend 复用） =====
export { normalizeKeys } from './utils/normalize-keys.js';
export { encrypt, decrypt, isEncrypted } from './utils/crypto.js';

// ===== LLM Services（P1-S4：从 backend/services/ 迁移） =====
// LLMService 层类型（含 loggingMetadata 等扩展字段，与 types.ts 的 LLMClient 层类型不同）
export { LLMService } from './LLMService.js';
export type {
  LLMMessageExtended,
  LLMResponse,
  ChatOptions,
  LLMCallLoggingMetadata,
  LLMServiceOptions,
} from './LLMService.js';

export { ModelConfigService, OAUTH_PLACEHOLDER_KEY } from './ModelConfigService.js';

// M1: LLMMetricsService 已迁移到 E 层（packages/backend/src/services/llm-metrics/）。
// H 层仅保留 ILLMMetricsSink 端口（见上方"端口接口"导出），度量查询属于业务职责。

export {
  EmbeddingProvider,
  FallbackEmbeddingProvider,
  ApiEmbeddingProvider,
  createEmbeddingProvider,
  cosineSimilarity,
} from './EmbeddingProvider.js';
export type { EmbeddingConfig } from './EmbeddingProvider.js';
