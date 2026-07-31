import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OAuthCredentialService,
  registerOAuthProvider,
  resetOAuthProviders,
  type OAuthCredentials,
  type OAuthLoginSession,
  type OAuthPollResult,
  type OAuthProviderInterface,
} from '../../src/oauth/index.js';
import { InMemoryOAuthCredentialStore } from '../helpers/InMemoryOAuthCredentialStore.js';

/**
 * M2-4 OAuthCredentialService 单元测试（设计文档 模块M2 §8.4 O1-O5/O11 + 登录编排补充）
 * 全 mock：mock OAuth Provider + InMemoryOAuthCredentialStore，无真实 OAuth 流程。
 */

const PROVIDER_ID = 'svc-mock-oauth';
const ONE_HOUR_MS = 3_600_000;

function makeCredentials(access: string, expires: number): OAuthCredentials {
  return { refresh: `refresh-${access}`, access, expires };
}

/** mock OAuth Provider：方法全部为 vi.fn，getApiKey 默认返回 credentials.access */
function makeMockProvider(id: string = PROVIDER_ID) {
  const provider: OAuthProviderInterface = {
    id,
    name: `Mock ${id}`,
    beginLogin: vi.fn(async (): Promise<OAuthLoginSession> => ({
      flow: 'device_code',
      info: { userCode: 'XXXX-XXXX', verificationUri: 'https://example.com/device' },
      sessionState: {},
    })),
    pollLogin: vi.fn(async (): Promise<OAuthPollResult> => ({ status: 'pending' })),
    completeLogin: vi.fn(async (): Promise<OAuthCredentials> => {
      throw new Error('not implemented');
    }),
    refreshToken: vi.fn(async (): Promise<OAuthCredentials> => {
      throw new Error('not implemented');
    }),
    getApiKey: vi.fn((credentials: OAuthCredentials) => credentials.access),
  };
  return provider;
}

afterEach(() => {
  resetOAuthProviders();
  vi.restoreAllMocks();
});

describe('OAuthCredentialService.resolveApiKey（O1-O5/O11）', () => {
  it('O1: 凭证未过期——直接返回 access，不调用 refreshToken、不落库', async () => {
    const store = new InMemoryOAuthCredentialStore();
    const provider = makeMockProvider();
    registerOAuthProvider(provider);
    store.credentials.set(PROVIDER_ID, makeCredentials('valid-access', Date.now() + ONE_HOUR_MS));
    const service = new OAuthCredentialService(store);

    const apiKey = await service.resolveApiKey(PROVIDER_ID);

    expect(apiKey).toBe('valid-access');
    expect(provider.refreshToken).not.toHaveBeenCalled();
    expect(store.saveCalls).toHaveLength(0);
  });

  it('O2: 凭证已过期——调用 refreshToken、save 新凭证、返回新 access', async () => {
    const store = new InMemoryOAuthCredentialStore();
    const provider = makeMockProvider();
    registerOAuthProvider(provider);
    const expired = makeCredentials('old-access', Date.now() - 1000);
    const refreshed = makeCredentials('new-access', Date.now() + ONE_HOUR_MS);
    store.credentials.set(PROVIDER_ID, expired);
    vi.mocked(provider.refreshToken).mockResolvedValue(refreshed);
    const service = new OAuthCredentialService(store);

    const apiKey = await service.resolveApiKey(PROVIDER_ID);

    expect(apiKey).toBe('new-access');
    expect(provider.refreshToken).toHaveBeenCalledTimes(1);
    expect(provider.refreshToken).toHaveBeenCalledWith(expired);
    expect(store.saveCalls).toEqual([{ providerId: PROVIDER_ID, credentials: refreshed }]);
    // 新凭证已落库：store 中不再是过期凭证
    expect(await store.load(PROVIDER_ID)).toBe(refreshed);
  });

  it('O3: 无凭证返回 null（走普通 api_keys 路径）；Provider 未注册同样返回 null', async () => {
    const store = new InMemoryOAuthCredentialStore();
    const provider = makeMockProvider();
    registerOAuthProvider(provider);
    const service = new OAuthCredentialService(store);

    expect(await service.resolveApiKey(PROVIDER_ID)).toBeNull();
    expect(await service.resolveApiKey('never-registered')).toBeNull();
    expect(provider.refreshToken).not.toHaveBeenCalled();
  });

  it('O4: 刷新失败——抛 Error，不落库、不返回旧 access（禁止静默降级用过期 token）', async () => {
    const store = new InMemoryOAuthCredentialStore();
    const provider = makeMockProvider();
    registerOAuthProvider(provider);
    store.credentials.set(PROVIDER_ID, makeCredentials('old-access', Date.now() - 1000));
    vi.mocked(provider.refreshToken).mockRejectedValue(new Error('refresh token revoked'));
    const service = new OAuthCredentialService(store);

    await expect(service.resolveApiKey(PROVIDER_ID)).rejects.toThrow('refresh token revoked');
    expect(store.saveCalls).toHaveLength(0);

    // 失败 promise 未缓存：修复后下次调用可重试成功
    const refreshed = makeCredentials('recovered-access', Date.now() + ONE_HOUR_MS);
    vi.mocked(provider.refreshToken).mockResolvedValue(refreshed);
    expect(await service.resolveApiKey(PROVIDER_ID)).toBe('recovered-access');
    expect(provider.refreshToken).toHaveBeenCalledTimes(2);
  });

  it('O5: 并发 resolveApiKey（均过期）——refreshToken 仅调用 1 次（刷新 promise 去重防风暴）', async () => {
    const store = new InMemoryOAuthCredentialStore();
    const provider = makeMockProvider();
    registerOAuthProvider(provider);
    store.credentials.set(PROVIDER_ID, makeCredentials('old-access', Date.now() - 1000));
    const refreshed = makeCredentials('new-access', Date.now() + ONE_HOUR_MS);
    vi.mocked(provider.refreshToken).mockResolvedValue(refreshed);
    const service = new OAuthCredentialService(store);

    const results = await Promise.all([
      service.resolveApiKey(PROVIDER_ID),
      service.resolveApiKey(PROVIDER_ID),
      service.resolveApiKey(PROVIDER_ID),
    ]);

    expect(results).toEqual(['new-access', 'new-access', 'new-access']);
    expect(provider.refreshToken).toHaveBeenCalledTimes(1);
    expect(store.saveCalls).toHaveLength(1);
  });

  it('O11: expires 边界值——Date.now() === expires 视为过期并刷新', async () => {
    const store = new InMemoryOAuthCredentialStore();
    const provider = makeMockProvider();
    registerOAuthProvider(provider);
    const fixedNow = 1_800_000_000_000;
    store.credentials.set(PROVIDER_ID, makeCredentials('boundary-access', fixedNow));
    const refreshed = makeCredentials('refreshed-access', fixedNow + ONE_HOUR_MS);
    vi.mocked(provider.refreshToken).mockResolvedValue(refreshed);
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
    const service = new OAuthCredentialService(store);

    const apiKey = await service.resolveApiKey(PROVIDER_ID);

    expect(apiKey).toBe('refreshed-access');
    expect(provider.refreshToken).toHaveBeenCalledTimes(1);
  });
});

describe('OAuthCredentialService 登录编排（补充：覆盖 beginLogin/completeXxxLogin/logout 公共 API）', () => {
  it('beginLogin 委托 Provider 并返回会话；未注册 Provider 抛清晰 Error', async () => {
    const store = new InMemoryOAuthCredentialStore();
    const provider = makeMockProvider();
    registerOAuthProvider(provider);
    const service = new OAuthCredentialService(store);

    const session = await service.beginLogin(PROVIDER_ID);
    expect(session.flow).toBe('device_code');
    expect(provider.beginLogin).toHaveBeenCalledTimes(1);

    await expect(service.beginLogin('not-registered')).rejects.toThrow(/not registered/);
  });

  it('completeDeviceLogin：pollLogin pending → complete，凭证落库', async () => {
    const store = new InMemoryOAuthCredentialStore();
    const provider = makeMockProvider();
    registerOAuthProvider(provider);
    const credentials = makeCredentials('device-access', Date.now() + ONE_HOUR_MS);
    vi.mocked(provider.pollLogin)
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'complete', credentials });
    const service = new OAuthCredentialService(store);
    const session: OAuthLoginSession = {
      flow: 'device_code',
      info: {
        userCode: 'XXXX-XXXX',
        verificationUri: 'https://example.com/device',
        intervalSeconds: 0,
        expiresInSeconds: 600,
      },
      sessionState: { deviceCode: 'dc-1' },
    };

    await service.completeDeviceLogin(PROVIDER_ID, session);

    expect(provider.pollLogin).toHaveBeenCalledTimes(2);
    expect(provider.pollLogin).toHaveBeenCalledWith(session);
    expect(store.saveCalls).toEqual([{ providerId: PROVIDER_ID, credentials }]);
    expect(await store.load(PROVIDER_ID)).toBe(credentials);
  });

  it('completeDeviceLogin 拒绝 auth_url 会话（flow 不匹配抛清晰 Error）', async () => {
    const store = new InMemoryOAuthCredentialStore();
    registerOAuthProvider(makeMockProvider());
    const service = new OAuthCredentialService(store);
    const authUrlSession: OAuthLoginSession = {
      flow: 'auth_url',
      info: { url: 'https://example.com/auth', state: 's-1' },
      sessionState: {},
    };

    await expect(service.completeDeviceLogin(PROVIDER_ID, authUrlSession)).rejects.toThrow(
      /flow='device_code'/,
    );
  });

  it('completeCallbackLogin：回调 code + state 交换 token，凭证落库', async () => {
    const store = new InMemoryOAuthCredentialStore();
    const provider = makeMockProvider();
    registerOAuthProvider(provider);
    const credentials = makeCredentials('callback-access', Date.now() + ONE_HOUR_MS);
    vi.mocked(provider.completeLogin).mockResolvedValue(credentials);
    const service = new OAuthCredentialService(store);
    const session: OAuthLoginSession = {
      flow: 'auth_url',
      info: { url: 'https://example.com/auth', state: 'state-1' },
      sessionState: { verifier: 'pkce-verifier' },
    };
    const callback = { code: 'auth-code', state: 'state-1' };

    await service.completeCallbackLogin(PROVIDER_ID, session, callback);

    expect(provider.completeLogin).toHaveBeenCalledWith(session, callback);
    expect(store.saveCalls).toEqual([{ providerId: PROVIDER_ID, credentials }]);
  });

  it('logout：删除已存凭证', async () => {
    const store = new InMemoryOAuthCredentialStore();
    registerOAuthProvider(makeMockProvider());
    store.credentials.set(PROVIDER_ID, makeCredentials('bye-access', Date.now() + ONE_HOUR_MS));
    const service = new OAuthCredentialService(store);

    await service.logout(PROVIDER_ID);

    expect(await store.load(PROVIDER_ID)).toBeNull();
  });
});
