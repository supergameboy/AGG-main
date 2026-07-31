import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getOAuthProvider,
  listOAuthProviders,
  registerOAuthProvider,
  resetOAuthProviders,
  unregisterOAuthProvider,
  type OAuthCredentials,
  type OAuthLoginSession,
  type OAuthPollResult,
  type OAuthProviderInterface,
} from '../../src/oauth/index.js';

/**
 * M2-4 OAuth 注册中心单元测试（设计文档 模块M2 §8.4 O10 + M2-B3 D9 内置登记）
 * 全 mock，无真实 OAuth 流程。
 */

/** 最小可用的 mock OAuth Provider（仅注册中心场景，方法均不被调用） */
function makeMockProvider(id: string): OAuthProviderInterface {
  return {
    id,
    name: `Mock ${id}`,
    beginLogin: vi.fn(async (): Promise<OAuthLoginSession> => {
      throw new Error('not implemented');
    }),
    pollLogin: vi.fn(async (): Promise<OAuthPollResult> => {
      throw new Error('not implemented');
    }),
    completeLogin: vi.fn(async (): Promise<OAuthCredentials> => {
      throw new Error('not implemented');
    }),
    refreshToken: vi.fn(async (): Promise<OAuthCredentials> => {
      throw new Error('not implemented');
    }),
    getApiKey: vi.fn((credentials: OAuthCredentials) => credentials.access),
  };
}

afterEach(() => {
  // 测试隔离：reset 恢复内置集（B3 起内置为 github-copilot）
  resetOAuthProviders();
});

describe('OAuth 注册中心（O10 + D9 内置登记）', () => {
  it('O10: register/get/list/unregister/reset 全链路 CRUD', () => {
    const providerA = makeMockProvider('test-provider-a');
    const providerB = makeMockProvider('test-provider-b');
    const builtinCount = listOAuthProviders().length;

    registerOAuthProvider(providerA);
    registerOAuthProvider(providerB);

    expect(getOAuthProvider('test-provider-a')).toBe(providerA);
    expect(getOAuthProvider('test-provider-b')).toBe(providerB);
    expect(listOAuthProviders()).toHaveLength(builtinCount + 2);

    unregisterOAuthProvider('test-provider-a');
    expect(getOAuthProvider('test-provider-a')).toBeUndefined();
    expect(listOAuthProviders()).toHaveLength(builtinCount + 1);

    // 注销未注册 id 为空操作（不抛错）
    unregisterOAuthProvider('non-existent');

    // reset 恢复内置集：测试用 mock 被清空，内置 github-copilot 保留
    resetOAuthProviders();
    expect(listOAuthProviders()).toHaveLength(builtinCount);
    expect(getOAuthProvider('test-provider-b')).toBeUndefined();
  });

  it('O10b: 重复注册同 id 覆盖并 warn（与 provider-registry 对称）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = makeMockProvider('dup-provider');
    const second = makeMockProvider('dup-provider');

    registerOAuthProvider(first);
    registerOAuthProvider(second);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('dup-provider'));
    expect(getOAuthProvider('dup-provider')).toBe(second);
    warnSpy.mockRestore();
  });

  it('D9: 内置 github-copilot——模块加载即注册，reset 后仍在', () => {
    // M2-B3 D9：B2 验收"0 内置"自 B3 落地起反转为"内置 github-copilot"
    expect(getOAuthProvider('github-copilot')).toBeDefined();
    expect(getOAuthProvider('github-copilot')?.name).toBe('GitHub Copilot');

    resetOAuthProviders();
    expect(getOAuthProvider('github-copilot')).toBeDefined();
  });
});
