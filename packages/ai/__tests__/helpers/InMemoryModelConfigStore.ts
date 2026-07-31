import type {
  IModelConfigStore,
  ModelProviderStoreRow,
  ModelConfigDefaultsStoreRow,
} from '../../src/types.js';

/**
 * 内存版 IModelConfigStore（测试专用）
 *
 * M1 后 ModelConfigService 通过 IModelConfigStore 端口访问存储，
 * packages/ai 测试不能依赖 E 层 KnexModelConfigStore（零业务依赖约束），
 * 故提供内存实现模拟 model_providers / model_config_defaults 两表语义。
 */
export class InMemoryModelConfigStore implements IModelConfigStore {
  providers = new Map<string, ModelProviderStoreRow>();
  defaultsRow: ModelConfigDefaultsStoreRow | null = null;
  agentProfileRefs = new Map<string, number>();

  async listProviderRows(): Promise<ModelProviderStoreRow[]> {
    return Array.from(this.providers.values()).sort((a, b) => a.created_at - b.created_at);
  }

  async getProviderRow(id: string): Promise<ModelProviderStoreRow | null> {
    return this.providers.get(id) ?? null;
  }

  async insertProviderRow(row: ModelProviderStoreRow): Promise<void> {
    this.providers.set(row.id, { ...row });
  }

  async updateProviderRow(id: string, data: Record<string, unknown>): Promise<void> {
    const existing = this.providers.get(id);
    if (!existing) return;
    this.providers.set(id, { ...existing, ...data } as ModelProviderStoreRow);
  }

  async deleteProviderRow(id: string): Promise<void> {
    this.providers.delete(id);
  }

  async getDefaultsRow(): Promise<ModelConfigDefaultsStoreRow | null> {
    return this.defaultsRow ? { ...this.defaultsRow } : null;
  }

  async insertDefaultsRow(row: ModelConfigDefaultsStoreRow): Promise<void> {
    this.defaultsRow = { ...row };
  }

  async updateDefaultsRow(data: Record<string, unknown>): Promise<void> {
    if (!this.defaultsRow) return;
    this.defaultsRow = { ...this.defaultsRow, ...data } as ModelConfigDefaultsStoreRow;
  }

  async countAgentProfilesReferencingProvider(providerId: string): Promise<number> {
    return this.agentProfileRefs.get(providerId) ?? 0;
  }

  async listProviderApiKeyRows(): Promise<Array<{ id: string; api_keys: string }>> {
    return Array.from(this.providers.values()).map(r => ({ id: r.id, api_keys: r.api_keys }));
  }

  async incrementProviderVersion(id: string): Promise<number> {
    const existing = this.providers.get(id);
    if (!existing) return 0;
    const newVersion = (existing.version ?? 0) + 1;
    this.providers.set(id, { ...existing, version: newVersion });
    return newVersion;
  }

  async getProviderVersion(id: string): Promise<number> {
    return this.providers.get(id)?.version ?? 0;
  }
}

export function makeProviderStoreRow(overrides: Partial<ModelProviderStoreRow> = {}): ModelProviderStoreRow {
  return {
    id: 'test-provider',
    provider_type: 'openai',
    name: 'Test Provider',
    base_url: 'https://api.test.com',
    api_format: 'openai',
    api_keys: '[]',
    default_model: 'test-model',
    max_tokens: 8192,
    enabled: 1,
    extra_config: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    version: 0,
    ...overrides,
  };
}
