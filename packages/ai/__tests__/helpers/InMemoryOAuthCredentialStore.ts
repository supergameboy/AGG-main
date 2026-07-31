import type { IOAuthCredentialStore, OAuthCredentials } from '../../src/oauth/index.js';

/**
 * 内存版 IOAuthCredentialStore（测试专用）
 *
 * M2-4 后 OAuthCredentialService 通过 IOAuthCredentialStore 端口访问凭证存储，
 * packages/ai 测试不能依赖 E 层 KnexOAuthCredentialStore（零业务依赖约束，
 * 且 B3 才交付），故提供内存实现模拟 load/save/delete 语义。
 */
export class InMemoryOAuthCredentialStore implements IOAuthCredentialStore {
  readonly credentials = new Map<string, OAuthCredentials>();
  /** 落库调用记录（断言"刷新后 save 新凭证"等编排行为用） */
  readonly saveCalls: Array<{ providerId: string; credentials: OAuthCredentials }> = [];

  async load(providerId: string): Promise<OAuthCredentials | null> {
    return this.credentials.get(providerId) ?? null;
  }

  async save(providerId: string, credentials: OAuthCredentials): Promise<void> {
    this.saveCalls.push({ providerId, credentials });
    this.credentials.set(providerId, credentials);
  }

  async delete(providerId: string): Promise<void> {
    this.credentials.delete(providerId);
  }
}
