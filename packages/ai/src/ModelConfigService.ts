import { createChildLogger } from './utils/logger.js';
import { getErrorMessage } from './utils/error.js';
import { createHash, randomUUID } from 'crypto';
import type { ModelProvider, ModelConfigDefaults } from '@ai-rpg/shared';
import type { EventBus, ProviderConfigChangedPayload } from '@ai-rpg/shared/messaging';
import { providerFactory } from './providers/providerFactory.js';
import { getOAuthProvider, type OAuthCredentialService } from './oauth/index.js';
import type {
  LLMClient,
  LLMConfig,
  IModelConfigStore,
  ModelProviderStoreRow,
  ModelConfigDefaultsStoreRow,
} from './types.js';
import { encrypt, decrypt, isEncrypted } from './utils/crypto.js';

/**
 * OAuth 托管型 Provider 的占位 key（M2-B3 D8）：
 * model_providers.api_keys 恒为 1 个该占位 entry，仅用于 tracker 初始化与限流配置承载；
 * 真实 key 永远来自 OAuthCredentialService 运行时解析，不落 model_providers 表（单一数据源）。
 */
export const OAUTH_PLACEHOLDER_KEY = '__oauth_managed__';

/** client 缓存 key 第四段：apiKey 指纹（D3），token 刷新后指纹变化即产出新 client */
function apiKeyFingerprint(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 8);
}

function maskApiKey(key: string): string {
  if (!key || key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

function rowToProvider(row: ModelProviderStoreRow, maskKeys = true): ModelProvider {
  const apiKeys: Array<{ key: string; label: string; priority: number }> = JSON.parse(row.api_keys || '[]');
  const decryptedKeys = apiKeys.map(k => ({
    ...k,
    key: isEncrypted(k.key) ? decrypt(k.key) : k.key,
  }));
  return {
    id: row.id,
    providerType: row.provider_type as ModelProvider['providerType'],
    name: row.name,
    baseUrl: row.base_url,
    apiFormat: row.api_format as ModelProvider['apiFormat'],
    apiKeys: maskKeys
      ? decryptedKeys.map(k => ({ ...k, key: maskApiKey(k.key) }))
      : decryptedKeys,
    defaultModel: row.default_model,
    maxTokens: row.max_tokens || 8192,
    enabled: !!row.enabled,
    extraConfig: row.extra_config ? JSON.parse(row.extra_config) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version ?? 0,
  };
}

function rowToDefaults(row: ModelConfigDefaultsStoreRow): ModelConfigDefaults {
  return {
    id: row.id,
    defaultProviderId: row.default_provider_id,
    defaultModel: row.default_model,
    fastProviderId: row.fast_provider_id ?? null,
    fastModel: row.fast_model ?? null,
    updatedAt: row.updated_at,
  };
}

/**
 * 模型配置服务（M1 依赖剥离 + M9 职责剥离后）
 *
 * 变更点（设计文档 模块M1 §6.6 + M9 §8）：
 * 1. 移除 Knex 依赖（constructor 接收 IModelConfigStore 端口，不再接收 db）
 * 2. 行级数据访问通过 IModelConfigStore 端口（E 层 KnexModelConfigStore 实现），
 *    业务逻辑（加解密、掩码、缓存）保留在本类
 * 3. M9 职责剥离：选 key / 故障标记 / 冷却恢复迁移到 LLMRequestDispatcher
 *    （TokenBucket + KeyHealthTracker），本类不再持有 keyStates / restoreInterval
 * 4. updateProvider / deleteProvider 自增 version 并发送 provider_config_changed
 *    事件（§8.3），Dispatcher 事件驱动同步 tracker
 * 5. M2-B3 OAuth 托管型适配（D8）：OAuth 型 Provider 创建时自动写占位 key、
 *    管理面 apiKeys 变更忽略、testConnection 经 OAuthCredentialService 取真实 key
 */
export class ModelConfigService {
  private store: IModelConfigStore;
  private logger: ReturnType<typeof createChildLogger>;
  private providerCache: Map<string, LLMClient> = new Map();
  private eventBus?: EventBus;
  private oauthCredentialService?: OAuthCredentialService;

  constructor(store: IModelConfigStore, eventBus?: EventBus, oauthCredentialService?: OAuthCredentialService) {
    this.store = store;
    this.eventBus = eventBus;
    this.oauthCredentialService = oauthCredentialService;
    this.logger = createChildLogger('model-config');
    this.migratePlaintextKeys();
  }

  private async migratePlaintextKeys(): Promise<void> {
    try {
      const rows = await this.store.listProviderApiKeyRows();
      for (const row of rows) {
        const keys: Array<{ key: string; label: string; priority: number }> =
          JSON.parse(row.api_keys || '[]');
        const hasPlaintext = keys.some(k => !isEncrypted(k.key));
        if (hasPlaintext) {
          const encryptedKeys = keys.map(k => ({
            ...k,
            key: isEncrypted(k.key) ? k.key : encrypt(k.key),
          }));
          await this.store.updateProviderRow(row.id, {
            api_keys: JSON.stringify(encryptedKeys),
            updated_at: Date.now(),
          });
          this.logger.info('Migrated plaintext API keys to encrypted storage', { providerId: row.id });
        }
      }
    } catch (error) {
      this.logger.warn('Failed to migrate plaintext keys', {
        error: getErrorMessage(error),
      });
    }
  }

  destroy(): void {
    this.providerCache.clear();
  }

  async listProviders(): Promise<ModelProvider[]> {
    const rows = await this.store.listProviderRows();
    return rows.map(r => rowToProvider(r, true));
  }

  async getProvider(id: string): Promise<ModelProvider | null> {
    const row = await this.store.getProviderRow(id);
    if (!row) return null;
    return rowToProvider(row, true);
  }

  /**
   * 获取 Provider 完整配置（含未掩码 apiKeys）
   *
   * M9 后改为 public：LLMRequestDispatcher 选 key 后需要真实 key 调用 LLM，
   * 仅服务端内部使用，禁止经路由层直接暴露给前端。
   */
  async getProviderUnmasked(id: string): Promise<ModelProvider | null> {
    const row = await this.store.getProviderRow(id);
    if (!row) return null;
    return rowToProvider(row, false);
  }

  /**
   * 获取默认 Provider ID（M9 §8.2）
   * Dispatcher 解析 request.providerId 缺省时的默认 Provider
   */
  async getDefaultProviderId(): Promise<string | null> {
    const defaults = await this.getDefaults();
    return defaults.defaultProviderId;
  }

  /**
   * 获取所有已启用的 Provider（M9 §8.2）
   * Dispatcher 启动时全量同步 tracker 用（syncAllTrackers 兜底）
   */
  async getAllEnabledProviders(): Promise<ModelProvider[]> {
    const rows = await this.store.listProviderRows();
    return rows.filter(r => !!r.enabled).map(r => rowToProvider(r, true));
  }

  async createProvider(data: Record<string, unknown>): Promise<ModelProvider> {
    const providerType = (data.providerType || data.provider_type) as string;
    const name = (data.name) as string;
    const baseUrl = (data.baseUrl || data.base_url) as string;
    const apiFormat = (data.apiFormat || data.api_format || 'openai') as string;
    const apiKeys = (data.apiKeys || data.api_keys) as Array<{ key: string; label: string; priority: number }>;
    const defaultModel = (data.defaultModel || data.default_model) as string;
    const maxTokens = (data.maxTokens ?? data.max_tokens) as number || 8192;
    const enabled = data.enabled !== undefined ? !!data.enabled : true;
    const extraConfig = (data.extraConfig || data.extra_config) as Record<string, unknown> | undefined;

    const id = randomUUID();
    const now = Date.now();

    // M2-B3 D8：OAuth 托管型忽略传入 apiKeys，自动写 1 个占位 entry（走统一加密）；
    // 真实 key 由 OAuth 流程产出并运行时解析，不落 model_providers 表
    const oauthManaged = getOAuthProvider(providerType) !== undefined;
    const rawKeys: Array<{ key: string; label: string; priority: number }> = oauthManaged
      ? [{ key: OAUTH_PLACEHOLDER_KEY, label: 'OAuth 托管（真实 key 由 OAuth 登录产出）', priority: 0 }]
      : typeof apiKeys === 'string'
        ? JSON.parse(apiKeys) as Array<{ key: string; label: string; priority: number }>
        : apiKeys;
    const encryptedApiKeys = rawKeys.map(k => ({ ...k, key: encrypt(k.key) }));

    const row = {
      id,
      provider_type: providerType,
      name,
      base_url: baseUrl,
      api_format: apiFormat,
      api_keys: JSON.stringify(encryptedApiKeys),
      default_model: defaultModel,
      max_tokens: maxTokens,
      enabled: enabled ? 1 : 0,
      extra_config: extraConfig ? (typeof extraConfig === 'string' ? extraConfig : JSON.stringify(extraConfig)) : null,
      created_at: now,
      updated_at: now,
      version: 0,
    };

    await this.store.insertProviderRow(row);

    // 当没有默认 Provider 时，自动将新创建的 Provider 设为默认
    const defaults = await this.store.getDefaultsRow();
    if (!defaults?.default_provider_id) {
      const now = Date.now();
      if (defaults) {
        await this.store.updateDefaultsRow({
          default_provider_id: id,
          default_model: defaultModel,
          updated_at: now,
        });
      } else {
        await this.store.insertDefaultsRow({
          id: 'default',
          default_provider_id: id,
          default_model: defaultModel,
          fast_provider_id: null,
          fast_model: null,
          updated_at: now,
        });
      }
      this.logger.info('Auto-set new provider as default', { providerId: id, providerType });
    }

    this.logger.info('Provider created', { id, name, providerType });
    return (await this.getProvider(id))!;
  }

  async updateProvider(
    id: string,
    data: Record<string, unknown>,
    options?: {
      changedFields?: ProviderConfigChangedPayload['changedFields'];
      operator?: ProviderConfigChangedPayload['operator'];
    },
  ): Promise<ModelProvider> {
    const existing = await this.getProvider(id);
    if (!existing) {
      throw new Error(`Provider not found: ${id}`);
    }

    const now = Date.now();
    const updateData: Record<string, unknown> = { updated_at: now };

    const providerType = data.providerType || data.provider_type;
    if (providerType !== undefined) updateData.provider_type = providerType;

    if (data.name !== undefined) updateData.name = data.name;

    const baseUrl = data.baseUrl || data.base_url;
    if (baseUrl !== undefined) updateData.base_url = baseUrl;

    const apiFormat = data.apiFormat || data.api_format;
    if (apiFormat !== undefined) updateData.api_format = apiFormat;

    const apiKeys = data.apiKeys || data.api_keys;
    if (apiKeys !== undefined) {
      if (getOAuthProvider(existing.providerType)) {
        // M2-B3 D8：占位 key 不可经管理面变更（真实 key 唯一来源是 oauth_credentials）
        this.logger.warn('OAuth 托管型 Provider 的 apiKeys 管理面变更已忽略', {
          id,
          providerType: existing.providerType,
        });
      } else {
        const parsedKeys: Array<{ key: string; label: string; priority: number }> =
          typeof apiKeys === 'string' ? JSON.parse(apiKeys) : apiKeys;
        const existingProvider = await this.getProviderUnmasked(id);
        let finalKeys: Array<{ key: string; label: string; priority: number }>;
        if (existingProvider && existingProvider.apiKeys.length > 0) {
          finalKeys = parsedKeys.map((newKey, index) => {
            if (newKey.key.includes('****') && existingProvider.apiKeys[index]) {
              return {
                ...existingProvider.apiKeys[index],
                label: newKey.label,
                priority: newKey.priority,
              };
            }
            return newKey;
          });
        } else {
          finalKeys = parsedKeys;
        }
        const encryptedKeys = finalKeys.map(k => ({ ...k, key: encrypt(k.key) }));
        updateData.api_keys = JSON.stringify(encryptedKeys);
      }
    }

    const defaultModel = data.defaultModel || data.default_model;
    if (defaultModel !== undefined) updateData.default_model = defaultModel;

    const maxTokens = data.maxTokens ?? data.max_tokens;
    if (maxTokens !== undefined) updateData.max_tokens = maxTokens;

    if (data.enabled !== undefined) updateData.enabled = data.enabled ? 1 : 0;

    const extraConfig = data.extraConfig || data.extra_config;
    if (extraConfig !== undefined) {
      updateData.extra_config = extraConfig ? (typeof extraConfig === 'string' ? extraConfig : JSON.stringify(extraConfig)) : null;
    }

    await this.store.updateProviderRow(id, updateData);
    this.invalidateProviderCache(id);

    // M9 §8.3：自增 version（事件契约 §12.1：单调递增，订阅方据此丢弃过期事件）
    const newVersion = await this.store.incrementProviderVersion(id);

    // M9 §8.3：发送配置变更事件（emit 失败不影响 DB 更新，§12.2.1）
    this.emitProviderConfigChanged({
      version: newVersion,
      providerId: id,
      changeType: 'updated',
      // 保守默认 ['api_keys']：调用方未指明时触发 Dispatcher 完整同步（§8.3）
      changedFields: options?.changedFields ?? ['api_keys'],
      operator: options?.operator ?? 'unknown',
    });

    this.logger.info('Provider updated', { id, version: newVersion });
    return (await this.getProvider(id))!;
  }

  async deleteProvider(
    id: string,
    options?: { operator?: ProviderConfigChangedPayload['operator'] },
  ): Promise<void> {
    const existing = await this.getProvider(id);
    if (!existing) {
      throw new Error(`Provider not found: ${id}`);
    }

    const totalRefs = await this.store.countAgentProfilesReferencingProvider(id);

    if (totalRefs > 0) {
      throw new Error(`Cannot delete provider: ${totalRefs} profile(s) reference this provider`);
    }

    // model_config_defaults 为单行表（id='default'），仅当引用被删 Provider 时置空
    const defaultsRow = await this.store.getDefaultsRow();
    if (defaultsRow) {
      const clearData: Record<string, unknown> = {};
      if (defaultsRow.default_provider_id === id) clearData.default_provider_id = null;
      if (defaultsRow.fast_provider_id === id) clearData.fast_provider_id = null;
      if (Object.keys(clearData).length > 0) {
        clearData.updated_at = Date.now();
        await this.store.updateDefaultsRow(clearData);
      }
    }

    // M9 §12.1：删除前自增 version，保证 deleted 事件 version 大于此前所有
    // updated 事件（若与最后 update 同 version，会被 Dispatcher 乱序检查丢弃，
    // 导致 tracker 残留至重启）。与 §8.3 示例的 getProviderVersion 有意的偏差，
    // 理由即 §12.1 "version 单调递增" 契约。
    const newVersion = await this.store.incrementProviderVersion(id);

    await this.store.deleteProviderRow(id);
    this.invalidateProviderCache(id);

    // M9 §8.3：发送配置变更事件（emit 失败不影响 DB 删除，§12.2.1）
    this.emitProviderConfigChanged({
      version: newVersion,
      providerId: id,
      changeType: 'deleted',
      changedFields: [],
      operator: options?.operator ?? 'unknown',
    });

    this.logger.info('Provider deleted', { id, version: newVersion });
  }

  /**
   * 发送 provider_config_changed 事件（M9 §8.3 / §12.1）
   *
   * 适配说明：现有 EventBus.emit 签名为 emit(type, BusEvent)，payload 经
   * BusEvent.data 传递；事件为全局维度（非 save-scoped），saveId 置空串。
   * emit 为异步 fire-and-forget，失败仅记录日志不阻塞主流程（§12.2.1）。
   */
  private emitProviderConfigChanged(
    payload: Omit<ProviderConfigChangedPayload, 'eventId' | 'timestamp'>,
  ): void {
    if (!this.eventBus) return;

    const fullPayload: ProviderConfigChangedPayload = {
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      ...payload,
    };

    this.eventBus.emit('provider_config_changed', {
      type: 'provider_config_changed',
      saveId: '',
      data: fullPayload as unknown as Record<string, unknown>,
      timestamp: Date.now(),
    }).catch((err) => {
      this.logger.error('Failed to emit provider_config_changed', {
        providerId: payload.providerId,
        error: getErrorMessage(err),
      });
    });
  }

  async testConnection(id: string, overrides?: { model?: string; apiKey?: string }): Promise<{ success: boolean; latency: number; error?: string; model?: string }> {
    // M9 后：管理面测试连接固定使用 primary key（apiKeys[0]），
    // 选 key / 故障转移是运行时职责，由 LLMRequestDispatcher 承担
    const provider = await this.getProviderUnmasked(id);
    if (!provider) {
      return { success: false, latency: 0, error: 'Provider not found' };
    }

    if (!provider.enabled) {
      return { success: false, latency: 0, error: 'Provider is disabled' };
    }

    // M2-B3 D8：OAuth 托管型的真实 key 来自运行时解析（不过期直接取，过期自动刷新落库）；
    // 占位 key 不能发请求
    let activeKey: { key: string; index: number } | null;
    if (overrides?.apiKey) {
      activeKey = { key: overrides.apiKey, index: 0 };
    } else if (getOAuthProvider(provider.providerType)) {
      if (!this.oauthCredentialService) {
        return { success: false, latency: 0, error: 'OAuth 服务未装配（oauthCredentialService 未注入）' };
      }
      let resolvedKey: string | null;
      try {
        resolvedKey = await this.oauthCredentialService.resolveApiKey(provider.providerType);
      } catch (error) {
        return { success: false, latency: 0, error: `OAuth 凭证刷新失败：${getErrorMessage(error)}（请重新登录）` };
      }
      if (!resolvedKey) {
        return { success: false, latency: 0, error: 'OAuth 未登录，请先完成授权' };
      }
      activeKey = { key: resolvedKey, index: 0 };
    } else {
      activeKey = provider.apiKeys.length > 0
        ? { key: provider.apiKeys[0].key, index: 0 }
        : null;
    }
    if (!activeKey) {
      return { success: false, latency: 0, error: 'No active API key available' };
    }

    const model = overrides?.model || provider.defaultModel;

    const llmConfig: LLMConfig = {
      provider: provider.providerType,
      apiKey: activeKey.key,
      baseUrl: provider.baseUrl,
      model,
      apiFormat: provider.apiFormat,
      timeout: 30000, // 测试连接专用 30 秒超时，避免用户长时间等待
    };

    const startTime = Date.now();
    try {
      const client = providerFactory(llmConfig);
      await client.chat(
        [{ role: 'user', content: 'Hi' }],
        { maxTokens: 5 }
      );
      const latency = Date.now() - startTime;
      this.logger.info('Connection test succeeded', { id, latency, model });
      return { success: true, latency, model };
    } catch (error) {
      const latency = Date.now() - startTime;
      const errorMessage = getErrorMessage(error);
      this.logger.warn('Connection test failed', { id, error: errorMessage, latency });
      return { success: false, latency, error: errorMessage, model };
    }
  }

  async testConnectionWithConfig(config: {
    providerType: string;
    baseUrl: string;
    apiFormat: string;
    apiKey: string;
    defaultModel: string;
    extraConfig?: {
      thinking?: {
        enabled: boolean;
        effort?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
      };
    };
  }): Promise<{ success: boolean; latency: number; error?: string; model?: string }> {
    if (!config.apiKey) {
      return { success: false, latency: 0, error: 'API Key is required' };
    }
    if (!config.baseUrl) {
      return { success: false, latency: 0, error: 'Base URL is required' };
    }
    if (!config.defaultModel) {
      return { success: false, latency: 0, error: 'Default model is required' };
    }

    const llmConfig: LLMConfig = {
      provider: config.providerType as LLMConfig['provider'],
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.defaultModel,
      apiFormat: config.apiFormat as LLMConfig['apiFormat'],
      timeout: 30000, // 测试连接专用 30 秒超时，避免用户长时间等待
      thinking: config.extraConfig?.thinking?.enabled ? {
        enabled: true,
        effort: config.extraConfig?.thinking?.effort || 'high',
      } : undefined,
    };

    const startTime = Date.now();
    try {
      const client = providerFactory(llmConfig);
      await client.chat(
        [{ role: 'user', content: 'Hi' }],
        { maxTokens: 5 }
      );
      const latency = Date.now() - startTime;
      this.logger.info('Connection test with config succeeded', { latency, model: config.defaultModel });
      return { success: true, latency, model: config.defaultModel };
    } catch (error) {
      const latency = Date.now() - startTime;
      const errorMessage = getErrorMessage(error);
      this.logger.warn('Connection test with config failed', { error: errorMessage, latency });
      return { success: false, latency, error: errorMessage, model: config.defaultModel };
    }
  }

  async getDefaults(): Promise<ModelConfigDefaults> {
    const row = await this.store.getDefaultsRow();
    if (!row) {
      return {
        id: 'default',
        defaultProviderId: null,
        defaultModel: null,
        fastProviderId: null,
        fastModel: null,
        updatedAt: Date.now(),
      };
    }
    return rowToDefaults(row);
  }

  async setDefaults(defaults: Record<string, unknown>): Promise<ModelConfigDefaults> {
    const defaultProviderId = (defaults.defaultProviderId || defaults.default_provider_id) as string | undefined;
    const fastProviderId = (defaults.fastProviderId || defaults.fast_provider_id) as string | undefined;
    const fastModel = (defaults.fastModel || defaults.fast_model) as string | undefined;

    const now = Date.now();
    const existing = await this.store.getDefaultsRow();

    if (existing) {
      const updateData: Record<string, unknown> = { updated_at: now };
      if (defaultProviderId !== undefined) {
        updateData.default_provider_id = defaultProviderId;
      }
      if (fastProviderId !== undefined) {
        updateData.fast_provider_id = fastProviderId || null;
      }
      if (fastModel !== undefined) {
        updateData.fast_model = fastModel || null;
      }
      await this.store.updateDefaultsRow(updateData);
    } else {
      await this.store.insertDefaultsRow({
        id: 'default',
        default_provider_id: defaultProviderId ?? null,
        default_model: null,
        fast_provider_id: fastProviderId || null,
        fast_model: fastModel || null,
        updated_at: now,
      });
    }

    this.logger.info('Defaults updated', { defaultProviderId, fastProviderId, fastModel });
    return this.getDefaults();
  }

  async getProviderInstance(providerId: string): Promise<LLMClient | null> {
    // M9 后：固定使用 primary key（apiKeys[0]）构建 client，
    // 运行时选 key / 故障转移由 LLMRequestDispatcher + chatWithKey 承担
    const provider = await this.getProviderUnmasked(providerId);
    if (!provider || !provider.enabled || provider.apiKeys.length === 0) {
      return null;
    }

    const primaryKey = provider.apiKeys[0];

    const cacheKey = `${providerId}:0:${provider.apiFormat}`;
    const cached = this.providerCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const llmConfig: LLMConfig = {
      provider: provider.providerType,
      apiKey: primaryKey.key,
      baseUrl: provider.baseUrl,
      model: provider.defaultModel,
      maxTokens: provider.maxTokens,
      apiFormat: provider.apiFormat,
      thinking: provider.extraConfig?.thinking?.enabled ? {
        enabled: true,
        effort: provider.extraConfig?.thinking?.effort || 'high',
      } : undefined,
    };

    const client = providerFactory(llmConfig);
    this.providerCache.set(cacheKey, client);
    return client;
  }

  async getFastProviderInstance(): Promise<LLMClient | null> {
    const defaults = await this.getDefaults();
    if (defaults.fastProviderId) {
      return this.getProviderInstance(defaults.fastProviderId);
    }
    return null;
  }

  /**
   * 按 keyIndex 获取 LLMClient（M9：LLMService.chatWithKey 专用）
   *
   * 与 getProviderInstance 的差异：cacheKey 含 keyIndex，每个 key 独立缓存
   * client 实例（独立 HTTP 连接池）；apiKey 由调用方（LLMRequestDispatcher
   * 选 key 后）传入，本方法只负责 client 创建与缓存。
   *
   * M2-B3 D3：cacheKey 追加第四段 apiKey 指纹——OAuth token 刷新后指纹变化，
   * 产出持新 token 的 client；写入前清理同 providerId:keyIndex: 前缀的旧指纹项
   * （缓存有界：每 keyIndex 至多 1 项）。普通 key 场景指纹恒定，行为与现状一致。
   *
   * 缓存失效复用 invalidateProviderCache（按 providerId 前缀清理），
   * 配置变更时所有 keyIndex 的 client 一并失效。
   */
  async getProviderInstanceWithKey(
    providerId: string,
    keyIndex: number,
    apiKey: string,
  ): Promise<LLMClient | null> {
    const provider = await this.getProviderUnmasked(providerId);
    if (!provider || !provider.enabled) {
      return null;
    }

    const cacheKey = `${providerId}:${keyIndex}:${provider.apiFormat}:${apiKeyFingerprint(apiKey)}`;
    const cached = this.providerCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const llmConfig: LLMConfig = {
      provider: provider.providerType,
      apiKey,
      baseUrl: provider.baseUrl,
      model: provider.defaultModel,
      maxTokens: provider.maxTokens,
      apiFormat: provider.apiFormat,
      thinking: provider.extraConfig?.thinking?.enabled ? {
        enabled: true,
        effort: provider.extraConfig?.thinking?.effort || 'high',
      } : undefined,
    };

    // 同 keyIndex+apiFormat 旧指纹项清理（缓存有界）——token 刷新场景旧 client 持失效
    // token 必须淘汰；前缀含 apiFormat 段，不会误伤 getProviderInstance 的 3 段 primary 项
    const stalePrefix = `${providerId}:${keyIndex}:${provider.apiFormat}:`;
    for (const key of this.providerCache.keys()) {
      if (key.startsWith(stalePrefix) && key !== cacheKey) {
        this.providerCache.delete(key);
      }
    }

    const client = providerFactory(llmConfig);
    this.providerCache.set(cacheKey, client);
    return client;
  }

  async seedFromEnv(): Promise<void> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      this.logger.info('No DEEPSEEK_API_KEY env var found, skipping env seed');
      return;
    }

    const existing = (await this.store.listProviderRows())
      .find(row => row.provider_type === 'deepseek');

    if (existing) {
      this.logger.info('DeepSeek provider already exists, ensuring default provider is set');

      const defaults = await this.store.getDefaultsRow();
      if (!defaults?.default_provider_id) {
        const now = Date.now();
        if (defaults) {
          await this.store.updateDefaultsRow({
            default_provider_id: existing.id,
            default_model: existing.default_model,
            updated_at: now,
          });
        } else {
          await this.store.insertDefaultsRow({
            id: 'default',
            default_provider_id: existing.id,
            default_model: existing.default_model,
            fast_provider_id: null,
            fast_model: null,
            updated_at: now,
          });
        }
        this.logger.info('Default provider set from existing DeepSeek provider', { providerId: existing.id });
      }
      return;
    }

    const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/anthropic';
    const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
    const now = Date.now();

    const providerId = randomUUID();
    await this.store.insertProviderRow({
      id: providerId,
      provider_type: 'deepseek',
      name: 'DeepSeek',
      base_url: baseUrl,
      api_format: 'anthropic',
      api_keys: JSON.stringify([{ key: encrypt(apiKey), label: 'Env Key', priority: 0 }]),
      default_model: model,
      max_tokens: 8192,
      enabled: 1,
      extra_config: null,
      created_at: now,
      updated_at: now,
      version: 0,
    });

    const defaultsExist = await this.store.getDefaultsRow();
    if (defaultsExist) {
      await this.store.updateDefaultsRow({
        default_provider_id: providerId,
        default_model: model,
        updated_at: now,
      });
    } else {
      await this.store.insertDefaultsRow({
        id: 'default',
        default_provider_id: providerId,
        default_model: model,
        fast_provider_id: null,
        fast_model: null,
        updated_at: now,
      });
    }

    this.logger.info('Seeded DeepSeek provider from environment', { providerId, model });
  }

  /**
   * 从 convict config（环境变量驱动）桥接 LLM 配置到数据库。
   * 当数据库中没有默认 provider 时，使用 convict 配置创建 provider；
   * 当已存在同类型 provider 时，更新其 API key 和 model。
   */
  async seedFromConvictConfig(config: {
    provider: string;
    apiKey: string;
    baseUrl: string;
    model: string;
    temperature: number;
  }): Promise<void> {
    if (!config.apiKey) {
      this.logger.info('No API key in convict config, skipping convict seed');
      return;
    }

    const providerType = config.provider;
    const now = Date.now();

    const existing = (await this.store.listProviderRows())
      .find(row => row.provider_type === providerType);

    if (existing) {
      // 同类型 provider 已存在，更新 API key 和 model
      const newKeys = [{ key: encrypt(config.apiKey), label: 'Convict Config Key', priority: 0 }];

      await this.store.updateProviderRow(existing.id, {
        api_keys: JSON.stringify(newKeys),
        default_model: config.model,
        base_url: config.baseUrl || existing.base_url,
        updated_at: now,
      });

      // 确保默认 provider 已设置
      const defaults = await this.store.getDefaultsRow();
      if (!defaults?.default_provider_id) {
        if (defaults) {
          await this.store.updateDefaultsRow({
            default_provider_id: existing.id,
            default_model: config.model,
            updated_at: now,
          });
        } else {
          await this.store.insertDefaultsRow({
            id: 'default',
            default_provider_id: existing.id,
            default_model: config.model,
            fast_provider_id: null,
            fast_model: null,
            updated_at: now,
          });
        }
      }

      this.logger.info('Updated existing provider from convict config', {
        providerType,
        providerId: existing.id,
        model: config.model,
      });
      return;
    }

    // 创建新 provider
    const providerId = randomUUID();
    const apiFormat = this.resolveApiFormat(providerType);

    await this.store.insertProviderRow({
      id: providerId,
      provider_type: providerType,
      name: this.formatProviderName(providerType),
      base_url: config.baseUrl || this.getDefaultBaseUrl(providerType),
      api_format: apiFormat,
      api_keys: JSON.stringify([{ key: encrypt(config.apiKey), label: 'Convict Config Key', priority: 0 }]),
      default_model: config.model,
      max_tokens: 8192,
      enabled: 1,
      extra_config: null,
      created_at: now,
      updated_at: now,
      version: 0,
    });

    // 设置为默认 provider
    const defaultsExist = await this.store.getDefaultsRow();
    if (defaultsExist?.default_provider_id) {
      this.logger.info('Default provider already set, not overwriting', {
        existingDefault: defaultsExist.default_provider_id,
        newProvider: providerId,
      });
    } else if (defaultsExist) {
      await this.store.updateDefaultsRow({
        default_provider_id: providerId,
        default_model: config.model,
        updated_at: now,
      });
    } else {
      await this.store.insertDefaultsRow({
        id: 'default',
        default_provider_id: providerId,
        default_model: config.model,
        fast_provider_id: null,
        fast_model: null,
        updated_at: now,
      });
    }

    this.logger.info('Seeded provider from convict config', {
      providerType,
      providerId,
      model: config.model,
    });
  }

  private resolveApiFormat(providerType: string): string {
    const formatMap: Record<string, string> = {
      openai: 'openai',
      gemini: 'openai',
      deepseek: 'anthropic',
      glm: 'openai',
      kimi: 'openai',
      custom: 'openai',
    };
    return formatMap[providerType] || 'openai';
  }

  private formatProviderName(providerType: string): string {
    const nameMap: Record<string, string> = {
      openai: 'OpenAI',
      gemini: 'Gemini',
      deepseek: 'DeepSeek',
      glm: 'GLM',
      kimi: 'Kimi',
      custom: 'Custom',
    };
    return nameMap[providerType] || providerType;
  }

  private getDefaultBaseUrl(providerType: string): string {
    const urlMap: Record<string, string> = {
      openai: 'https://api.openai.com/v1',
      gemini: 'https://generativelanguage.googleapis.com/v1beta',
      deepseek: 'https://api.deepseek.com/anthropic',
      glm: 'https://open.bigmodel.cn/api/paas/v4',
      kimi: 'https://api.moonshot.cn/v1',
    };
    return urlMap[providerType] || '';
  }

  private invalidateProviderCache(providerId: string): void {
    const keysToDelete: string[] = [];
    for (const cacheKey of this.providerCache.keys()) {
      if (cacheKey.startsWith(`${providerId}:`)) {
        keysToDelete.push(cacheKey);
      }
    }
    for (const key of keysToDelete) {
      this.providerCache.delete(key);
    }
  }
}
