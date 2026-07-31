import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ModelProviderStoreRow } from '@ai-rpg/ai';
import { KnexModelConfigStore } from '../KnexModelConfigStore.js';

/**
 * KnexModelConfigStore 单元测试（M1 设计文档 §10.1 / §6.6）
 *
 * 验证点：
 * 1. provider 行 CRUD（insert/get/list 按 name 升序/update/delete）
 * 2. defaults 行读写（get 空 → null / insert / update）
 * 3. countAgentProfilesReferencingProvider（agents 与 coordinator 双字段 JSON LIKE 匹配）
 * 4. listProviderApiKeyRows（仅返回 id + api_keys）
 */

function makeProviderRow(overrides: Partial<ModelProviderStoreRow> = {}): ModelProviderStoreRow {
  return {
    id: 'provider-1',
    provider_type: 'openai',
    name: 'OpenAI',
    base_url: 'https://api.openai.com/v1',
    api_format: 'openai',
    api_keys: JSON.stringify([{ key: 'sk-test', label: 'Key0', priority: 0 }]),
    default_model: 'gpt-4o',
    max_tokens: 8192,
    enabled: 1,
    extra_config: null,
    created_at: 1770000000000,
    updated_at: 1770000000000,
    version: 0,
    ...overrides,
  };
}

describe('KnexModelConfigStore', () => {
  let db: Knex;
  let store: KnexModelConfigStore;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await db.schema.createTable('model_providers', (table) => {
      table.text('id').primary();
      table.text('provider_type').notNullable();
      table.text('name').notNullable();
      table.text('base_url').notNullable();
      table.text('api_format').notNullable().defaultTo('openai');
      table.text('api_keys').notNullable();
      table.text('default_model').notNullable();
      table.integer('enabled').defaultTo(1);
      table.text('extra_config');
      table.integer('max_tokens').defaultTo(8192);
      table.integer('created_at').notNullable();
      table.integer('updated_at').notNullable();
      // M9 迁移009：model_providers.version（provider_config_changed 事件契约）
      table.bigInteger('version').notNullable().defaultTo(0);
    });

    await db.schema.createTable('model_config_defaults', (table) => {
      table.text('id').primary();
      table.text('default_provider_id').nullable();
      table.text('default_model').nullable();
      table.text('fast_provider_id').nullable();
      table.text('fast_model').nullable();
      table.integer('updated_at').notNullable();
    });

    await db.schema.createTable('agent_profiles', (table) => {
      table.text('id').primary();
      table.text('name').notNullable();
      table.text('agents').defaultTo('{}');
      table.text('coordinator').defaultTo('{}');
    });

    store = new KnexModelConfigStore(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('provider 行 CRUD', () => {
    it('insertProviderRow + getProviderRow 往返一致', async () => {
      await store.insertProviderRow(makeProviderRow());

      const row = await store.getProviderRow('provider-1');
      expect(row).toMatchObject({
        id: 'provider-1',
        provider_type: 'openai',
        name: 'OpenAI',
        default_model: 'gpt-4o',
        enabled: 1,
      });
    });

    it('getProviderRow 未命中返回 null', async () => {
      expect(await store.getProviderRow('missing')).toBeNull();
    });

    it('listProviderRows 按 name 升序返回', async () => {
      await store.insertProviderRow(makeProviderRow({ id: 'p-b', name: 'Beta' }));
      await store.insertProviderRow(makeProviderRow({ id: 'p-a', name: 'Alpha' }));
      await store.insertProviderRow(makeProviderRow({ id: 'p-c', name: 'Gamma' }));

      const rows = await store.listProviderRows();
      expect(rows.map(r => r.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
    });

    it('updateProviderRow 仅更新指定字段', async () => {
      await store.insertProviderRow(makeProviderRow());
      await store.updateProviderRow('provider-1', { enabled: 0, updated_at: 1770000001000 });

      const row = await store.getProviderRow('provider-1');
      expect(row).toMatchObject({ enabled: 0, updated_at: 1770000001000, name: 'OpenAI' });
    });

    it('deleteProviderRow 删除后 get 返回 null', async () => {
      await store.insertProviderRow(makeProviderRow());
      await store.deleteProviderRow('provider-1');

      expect(await store.getProviderRow('provider-1')).toBeNull();
    });
  });

  describe('defaults 行读写', () => {
    it('空表 getDefaultsRow 返回 null', async () => {
      expect(await store.getDefaultsRow()).toBeNull();
    });

    it('insertDefaultsRow + getDefaultsRow 往返一致', async () => {
      await store.insertDefaultsRow({
        id: 'default',
        default_provider_id: 'provider-1',
        default_model: 'gpt-4o',
        fast_provider_id: 'provider-2',
        fast_model: 'gpt-4o-mini',
        updated_at: 1770000000000,
      });

      expect(await store.getDefaultsRow()).toMatchObject({
        id: 'default',
        default_provider_id: 'provider-1',
        default_model: 'gpt-4o',
        fast_provider_id: 'provider-2',
        fast_model: 'gpt-4o-mini',
      });
    });

    it('updateDefaultsRow 更新 default 行', async () => {
      await store.insertDefaultsRow({
        id: 'default',
        default_provider_id: null,
        default_model: null,
        fast_provider_id: null,
        fast_model: null,
        updated_at: 1770000000000,
      });
      await store.updateDefaultsRow({ default_provider_id: 'provider-9', updated_at: 1770000002000 });

      expect(await store.getDefaultsRow()).toMatchObject({
        default_provider_id: 'provider-9',
        updated_at: 1770000002000,
      });
    });
  });

  describe('countAgentProfilesReferencingProvider', () => {
    it('agents 字段引用时计数', async () => {
      await db('agent_profiles').insert([
        { id: 'ap-1', name: 'p1', agents: JSON.stringify({ main: { provider_id: 'provider-1' } }), coordinator: '{}' },
        { id: 'ap-2', name: 'p2', agents: '{}', coordinator: '{}' },
      ]);

      expect(await store.countAgentProfilesReferencingProvider('provider-1')).toBe(1);
    });

    it('coordinator 字段引用时计数', async () => {
      await db('agent_profiles').insert([
        { id: 'ap-1', name: 'p1', agents: '{}', coordinator: JSON.stringify({ provider_id: 'provider-1' }) },
      ]);

      expect(await store.countAgentProfilesReferencingProvider('provider-1')).toBe(1);
    });

    it('agents 与 coordinator 同时引用时合计计数', async () => {
      await db('agent_profiles').insert([
        {
          id: 'ap-1',
          name: 'p1',
          agents: JSON.stringify({ main: { provider_id: 'provider-1' } }),
          coordinator: JSON.stringify({ provider_id: 'provider-1' }),
        },
      ]);

      expect(await store.countAgentProfilesReferencingProvider('provider-1')).toBe(2);
    });

    it('无引用时返回 0', async () => {
      await db('agent_profiles').insert([
        { id: 'ap-1', name: 'p1', agents: JSON.stringify({ main: { provider_id: 'other' } }), coordinator: '{}' },
      ]);

      expect(await store.countAgentProfilesReferencingProvider('provider-1')).toBe(0);
    });
  });

  describe('listProviderApiKeyRows', () => {
    it('仅返回 id 与 api_keys 字段', async () => {
      await store.insertProviderRow(makeProviderRow({ id: 'p-1' }));
      await store.insertProviderRow(makeProviderRow({ id: 'p-2' }));

      const rows = await store.listProviderApiKeyRows();
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual(['api_keys', 'id']);
      }
    });
  });
});
