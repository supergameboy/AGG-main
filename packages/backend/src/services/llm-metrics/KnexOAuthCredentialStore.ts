/**
 * KnexOAuthCredentialStore — OAuth 凭证存储（E 层，M2-B3 §D5）
 *
 * 实现 @ai-rpg/ai 定义的 IOAuthCredentialStore 端口，访问 oauth_credentials 表。
 * 加解密复用 @ai-rpg/ai 的 utils/crypto（与 model_providers.api_keys 同一套 enc:v1: 体系）：
 * DB 原文永无明文 token（验收硬约束 M2 R7）。
 *
 * save 为 upsert 语义（onConflict merge）：同一 providerId 恒单行，
 * 与 IOAuthCredentialStore 端口契约一致（调用方不感知新建/覆盖差异）。
 */

import type { Knex } from 'knex';
import { decrypt, encrypt, type IOAuthCredentialStore, type OAuthCredentials } from '@ai-rpg/ai';

interface OAuthCredentialRow {
  provider_id: string;
  credentials: string;
  updated_at: number;
}

export class KnexOAuthCredentialStore implements IOAuthCredentialStore {
  constructor(private readonly db: Knex) {}

  async load(providerId: string): Promise<OAuthCredentials | null> {
    const row = await this.db<OAuthCredentialRow>('oauth_credentials')
      .where({ provider_id: providerId })
      .first();
    if (!row) return null;
    return JSON.parse(decrypt(row.credentials)) as OAuthCredentials;
  }

  async save(providerId: string, credentials: OAuthCredentials): Promise<void> {
    const encrypted = encrypt(JSON.stringify(credentials));
    const now = Date.now();
    await this.db('oauth_credentials')
      .insert({ provider_id: providerId, credentials: encrypted, updated_at: now })
      .onConflict('provider_id')
      .merge({ credentials: encrypted, updated_at: now });
  }

  async delete(providerId: string): Promise<void> {
    await this.db('oauth_credentials').where({ provider_id: providerId }).delete();
  }
}
