/**
 * KnexModelConfigStore — 模型配置存储（E 层）
 *
 * 实现 @ai-rpg/ai 定义的 IModelConfigStore 端口（行级数据访问），
 * 通过 Knex 访问 model_providers / model_config_defaults / agent_profiles 表。
 *
 * 业务逻辑（加解密、掩码、Key 轮询、缓存）保留在 H 层 ModelConfigService，
 * 本类仅承担原始行读写，对应设计文档 模块M1 §6.6 的端口-适配器拆分。
 */

import type { Knex } from 'knex';
import type {
  IModelConfigStore,
  ModelProviderStoreRow,
  ModelConfigDefaultsStoreRow,
} from '@ai-rpg/ai';

export class KnexModelConfigStore implements IModelConfigStore {
  constructor(private readonly db: Knex) {}

  listProviderRows(): Promise<ModelProviderStoreRow[]> {
    return this.db<ModelProviderStoreRow>('model_providers').orderBy('name', 'asc');
  }

  async getProviderRow(id: string): Promise<ModelProviderStoreRow | null> {
    const row = await this.db<ModelProviderStoreRow>('model_providers').where({ id }).first();
    return row ?? null;
  }

  async insertProviderRow(row: ModelProviderStoreRow): Promise<void> {
    await this.db('model_providers').insert(row);
  }

  async updateProviderRow(id: string, data: Record<string, unknown>): Promise<void> {
    await this.db('model_providers').where({ id }).update(data);
  }

  async deleteProviderRow(id: string): Promise<void> {
    await this.db('model_providers').where({ id }).delete();
  }

  async getDefaultsRow(): Promise<ModelConfigDefaultsStoreRow | null> {
    const row = await this.db<ModelConfigDefaultsStoreRow>('model_config_defaults').where({ id: 'default' }).first();
    return row ?? null;
  }

  async insertDefaultsRow(row: ModelConfigDefaultsStoreRow): Promise<void> {
    await this.db('model_config_defaults').insert(row);
  }

  async updateDefaultsRow(data: Record<string, unknown>): Promise<void> {
    await this.db('model_config_defaults').where({ id: 'default' }).update(data);
  }

  async countAgentProfilesReferencingProvider(providerId: string): Promise<number> {
    const escaped = String(providerId).replace(/[%_\\]/g, '\\$&');
    const pattern = `%"provider_id":"${escaped}"%`;

    const agentsUsingProvider = await this.db('agent_profiles')
      .whereRaw('agents LIKE ?', [pattern])
      .count('* as count')
      .first();

    const coordinatorUsingProvider = await this.db('agent_profiles')
      .whereRaw('coordinator LIKE ?', [pattern])
      .count('* as count')
      .first();

    return (agentsUsingProvider ? Number(agentsUsingProvider.count) : 0)
      + (coordinatorUsingProvider ? Number(coordinatorUsingProvider.count) : 0);
  }

  listProviderApiKeyRows(): Promise<Array<{ id: string; api_keys: string }>> {
    return this.db('model_providers').select('id', 'api_keys');
  }

  async incrementProviderVersion(id: string): Promise<number> {
    // better-sqlite3 单连接串行执行，increment + select 两步无并发竞态
    await this.db('model_providers').where({ id }).increment('version', 1);
    return this.getProviderVersion(id);
  }

  async getProviderVersion(id: string): Promise<number> {
    const row = await this.db('model_providers').where({ id }).first('version');
    return Number(row?.version ?? 0);
  }
}
