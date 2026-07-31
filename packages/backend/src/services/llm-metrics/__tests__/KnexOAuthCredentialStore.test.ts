import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isEncrypted, type OAuthCredentials } from '@ai-rpg/ai';
import { KnexOAuthCredentialStore } from '../KnexOAuthCredentialStore.js';
import { down, up } from '../../../migrations/011_add_oauth_credentials.js';

/**
 * KnexOAuthCredentialStore 单元测试（M2-B3 设计文档 KS1-KS5）
 *
 * 验证点：
 * 1. KS1 save→load 往返：字段一致；DB 原文为 enc:v1: 密文，无明文 token（验收硬约束 M2 R7）
 * 2. KS2 save upsert：同 providerId 覆盖写，恒单行
 * 3. KS3 load 不存在：返回 null
 * 4. KS4 delete：删除后 load 为 null
 * 5. KS5 migration 011：up 建表 / down 删表（幂等）
 *
 * 表结构经真实 migration up() 创建（schema 单一数据源，不重复定义）。
 */

function makeCredentials(overrides: Partial<OAuthCredentials> = {}): OAuthCredentials {
  return {
    refresh: 'gho_refresh_token_plain',
    access: 'ghu_access_token_plain',
    expires: 1770000000000,
    ...overrides,
  };
}

describe('KnexOAuthCredentialStore', () => {
  let db: Knex;
  let store: KnexOAuthCredentialStore;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await up(db);
    store = new KnexOAuthCredentialStore(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('KS1: save→load 往返字段一致，且 DB 原文为密文（无明文 token）', async () => {
    const credentials = makeCredentials();
    await store.save('github-copilot', credentials);

    const loaded = await store.load('github-copilot');
    expect(loaded).toEqual(credentials);

    const raw = await db('oauth_credentials').where({ provider_id: 'github-copilot' }).first();
    expect(raw).toBeDefined();
    expect(isEncrypted(raw.credentials as string)).toBe(true);
    expect(raw.credentials as string).not.toContain(credentials.access);
    expect(raw.credentials as string).not.toContain(credentials.refresh);
  });

  it('KS2: save 为 upsert——同 providerId 覆盖写，恒单行', async () => {
    await store.save('github-copilot', makeCredentials({ access: 'ghu_old' }));
    const updated = makeCredentials({ access: 'ghu_new', expires: 1880000000000 });
    await store.save('github-copilot', updated);

    const rows = await db('oauth_credentials').where({ provider_id: 'github-copilot' });
    expect(rows).toHaveLength(1);

    const loaded = await store.load('github-copilot');
    expect(loaded).toEqual(updated);
  });

  it('KS3: load 不存在的 providerId 返回 null', async () => {
    expect(await store.load('nonexistent')).toBeNull();
  });

  it('KS4: delete 后再 load 为 null', async () => {
    await store.save('github-copilot', makeCredentials());
    await store.delete('github-copilot');
    expect(await store.load('github-copilot')).toBeNull();
  });

  it('KS5: migration 011——up 建表 / down 删表，且幂等', async () => {
    // beforeEach 已执行 up：表存在且列契约正确
    expect(await db.schema.hasTable('oauth_credentials')).toBe(true);
    const columns = await db('oauth_credentials').columnInfo();
    expect(Object.keys(columns).sort()).toEqual(['credentials', 'provider_id', 'updated_at']);

    // up 幂等：重复执行无副作用
    await up(db);
    expect(await db.schema.hasTable('oauth_credentials')).toBe(true);

    // down 删表；重复 down 亦无副作用
    await down(db);
    expect(await db.schema.hasTable('oauth_credentials')).toBe(false);
    await down(db);
    expect(await db.schema.hasTable('oauth_credentials')).toBe(false);
  });
});
