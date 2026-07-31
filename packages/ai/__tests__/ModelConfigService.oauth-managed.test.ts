import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMClient } from '../src/types.js';

/**
 * M2-B3 ModelConfigService OAuth 托管适配 + client 缓存指纹测试
 * （设计文档 §测试设计 CC1-CC3 + D8 管理面契约）
 *
 * providerFactory 全 mock（无真实 Provider 实例、无网络）；
 * OAuth 凭证用真实 OAuthCredentialService + InMemoryOAuthCredentialStore 接线。
 */

const hoisted = vi.hoisted(() => {
  const factorySpy = vi.fn((config: { apiKey: string }): LLMClient => ({
    chat: async () => ({ content: `ok:${config.apiKey}`, finishReason: 'stop' }),
    stream: async function* (): AsyncIterable<never> {
      // 空流：缓存与管理面测试不验证流内容
    },
    countTokens: () => 0,
  }));
  return { factorySpy };
});

vi.mock('../src/providers/providerFactory.js', () => ({
  providerFactory: hoisted.factorySpy,
}));

import { ModelConfigService, OAUTH_PLACEHOLDER_KEY } from '../src/ModelConfigService.js';
import { OAuthCredentialService } from '../src/oauth/index.js';
import { InMemoryModelConfigStore, makeProviderStoreRow } from './helpers/InMemoryModelConfigStore.js';
import { InMemoryOAuthCredentialStore } from './helpers/InMemoryOAuthCredentialStore.js';
import { encrypt } from '../src/utils/crypto.js';

const factorySpy = hoisted.factorySpy;

let service: ModelConfigService | null = null;

beforeEach(() => {
  factorySpy.mockClear();
});

afterEach(() => {
  service?.destroy();
  service = null;
});

function createService(
  store: InMemoryModelConfigStore,
  oauthCredentialService?: OAuthCredentialService,
): ModelConfigService {
  service = new ModelConfigService(store, undefined, oauthCredentialService);
  return service;
}

function seedOpenaiProvider(store: InMemoryModelConfigStore, id = 'p-openai'): void {
  store.providers.set(id, makeProviderStoreRow({
    id,
    provider_type: 'openai',
    api_keys: JSON.stringify([{ key: encrypt('sk-db-primary'), label: 'primary', priority: 0 }]),
  }));
}

describe('client 缓存 key 指纹（CC1-CC3，D3）', () => {
  it('CC1: 同 keyIndex 不同 key → 不同 client；旧指纹项被清理（缓存有界，再次用旧 key 需重建）', async () => {
    const store = new InMemoryModelConfigStore();
    seedOpenaiProvider(store);
    const svc = createService(store);

    const clientA = await svc.getProviderInstanceWithKey('p-openai', 0, 'key-alpha');
    const clientB = await svc.getProviderInstanceWithKey('p-openai', 0, 'key-beta');

    expect(clientA).not.toBe(clientB);
    expect(factorySpy).toHaveBeenCalledTimes(2);
    // 第二次调用拿到的是新 key（无指纹的旧实现会复用持 key-alpha 的 client → 401 缺陷）
    expect(factorySpy.mock.calls[1][0].apiKey).toBe('key-beta');

    // 缓存有界：key-beta 写入时旧 key-alpha 项已淘汰，再次使用需重建
    const clientA2 = await svc.getProviderInstanceWithKey('p-openai', 0, 'key-alpha');
    expect(factorySpy).toHaveBeenCalledTimes(3);
    expect(clientA2).not.toBe(clientA);
  });

  it('CC2: 同 key 重复调用 → 缓存命中同一 client（普通 key 场景行为与现状一致）', async () => {
    const store = new InMemoryModelConfigStore();
    seedOpenaiProvider(store);
    const svc = createService(store);

    const first = await svc.getProviderInstanceWithKey('p-openai', 0, 'key-same');
    const second = await svc.getProviderInstanceWithKey('p-openai', 0, 'key-same');

    expect(second).toBe(first);
    expect(factorySpy).toHaveBeenCalledTimes(1);
  });

  it('CC3: 配置变更 invalidateProviderCache → 含指纹段 key 一并失效', async () => {
    const store = new InMemoryModelConfigStore();
    seedOpenaiProvider(store);
    const svc = createService(store);

    const before = await svc.getProviderInstanceWithKey('p-openai', 0, 'key-x');
    await svc.updateProvider('p-openai', { name: 'renamed' });
    const after = await svc.getProviderInstanceWithKey('p-openai', 0, 'key-x');

    expect(after).not.toBe(before);
    expect(factorySpy).toHaveBeenCalledTimes(2);
  });
});

describe('OAuth 托管型管理面适配（D8）', () => {
  it('D8-create: providerType=github-copilot 忽略传入 apiKeys，自动写 1 个加密占位 entry', async () => {
    const store = new InMemoryModelConfigStore();
    const svc = createService(store);

    const created = await svc.createProvider({
      providerType: 'github-copilot',
      name: 'My Copilot',
      baseUrl: 'https://api.githubcopilot.com',
      apiFormat: 'openai',
      apiKeys: [{ key: 'sk-should-be-ignored', label: 'ignored', priority: 0 }],
      defaultModel: 'gpt-4o',
    });

    const unmasked = await svc.getProviderUnmasked(created.id);
    expect(unmasked?.apiKeys).toHaveLength(1);
    expect(unmasked?.apiKeys[0].key).toBe(OAUTH_PLACEHOLDER_KEY);

    // DB 原文：占位 entry 走统一加密，且传入的真实样式 key 被完全忽略
    const row = await store.getProviderRow(created.id);
    expect(row?.api_keys).toContain('enc:v1:');
    expect(row?.api_keys).not.toContain('sk-should-be-ignored');
  });

  it('D8-update: OAuth 型收到 apiKeys 字段 → 忽略（占位 key 不可经管理面变更）', async () => {
    const store = new InMemoryModelConfigStore();
    const svc = createService(store);
    const created = await svc.createProvider({
      providerType: 'github-copilot',
      name: 'My Copilot',
      baseUrl: 'https://api.githubcopilot.com',
      defaultModel: 'gpt-4o',
    });

    await svc.updateProvider(created.id, {
      apiKeys: [{ key: 'sk-management-override', label: 'evil', priority: 0 }],
    });

    const unmasked = await svc.getProviderUnmasked(created.id);
    expect(unmasked?.apiKeys).toHaveLength(1);
    expect(unmasked?.apiKeys[0].key).toBe(OAUTH_PLACEHOLDER_KEY);
  });

  it('D8-testConnection: OAuth 无凭证 → success=false 提示未登录（不发请求）', async () => {
    const store = new InMemoryModelConfigStore();
    const oauthStore = new InMemoryOAuthCredentialStore();
    const oauthService = new OAuthCredentialService(oauthStore);
    const svc = createService(store, oauthService);
    const created = await svc.createProvider({
      providerType: 'github-copilot',
      name: 'My Copilot',
      baseUrl: 'https://api.githubcopilot.com',
      defaultModel: 'gpt-4o',
    });

    const result = await svc.testConnection(created.id);

    expect(result.success).toBe(false);
    expect(result.error).toContain('OAuth 未登录');
    expect(factorySpy).not.toHaveBeenCalled();
  });

  it('D8-testConnection: OAuth 有凭证 → 经 resolveApiKey 取真实 key 发请求', async () => {
    const store = new InMemoryModelConfigStore();
    const oauthStore = new InMemoryOAuthCredentialStore();
    const oauthService = new OAuthCredentialService(oauthStore);
    const svc = createService(store, oauthService);
    const created = await svc.createProvider({
      providerType: 'github-copilot',
      name: 'My Copilot',
      baseUrl: 'https://api.githubcopilot.com',
      defaultModel: 'gpt-4o',
    });
    await oauthStore.save('github-copilot', {
      refresh: 'gho_long_lived',
      access: 'tid-real-session-token',
      expires: Date.now() + 3_600_000,
    });

    const result = await svc.testConnection(created.id);

    expect(result.success).toBe(true);
    expect(factorySpy).toHaveBeenCalledTimes(1);
    // 真实 key 来自 OAuth 运行时解析，而非 DB 占位 key
    expect(factorySpy.mock.calls[0][0].apiKey).toBe('tid-real-session-token');
  });

  it('D8-testConnection 回归: 普通 Provider 仍用 apiKeys[0]（resolveApiKey 不介入）', async () => {
    const store = new InMemoryModelConfigStore();
    seedOpenaiProvider(store);
    const oauthStore = new InMemoryOAuthCredentialStore();
    const oauthService = new OAuthCredentialService(oauthStore);
    const svc = createService(store, oauthService);

    const result = await svc.testConnection('p-openai');

    expect(result.success).toBe(true);
    expect(factorySpy.mock.calls[0][0].apiKey).toBe('sk-db-primary');
  });
});
