import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gitHubCopilotOAuthProvider } from '../../src/oauth/github-copilot.js';
import type { OAuthCredentials, OAuthLoginSession } from '../../src/oauth/index.js';

/**
 * M2-B3 GitHub Copilot OAuth Provider 单元测试（设计文档 §测试设计 GC1-GC9）
 * 全 mock fetch：device flow（github.com）+ copilot token 交换（api.github.com），
 * 无真实网络、无真实 GitHub 账号。
 */

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';

const GHO_TOKEN = 'gho_mockgithubtoken123';
const COPILOT_TOKEN = 'tid_mock_copilot_session_token';
const COPILOT_EXPIRES_AT_SEC = 1_900_000_000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeDeviceSession(): OAuthLoginSession & { flow: 'device_code' } {
  return {
    flow: 'device_code',
    info: {
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      intervalSeconds: 5,
      expiresInSeconds: 900,
    },
    sessionState: { deviceCode: 'dc_mock_device_code' },
  };
}

/** 按 URL 分发的 fetch mock 注册表 */
type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn<FetchHandler>>;

beforeEach(() => {
  fetchMock = vi.fn<FetchHandler>();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GitHubCopilotOAuthProvider.beginLogin（GC1）', () => {
  it('GC1: 请求 device/code 并返回 device_code 会话（userCode/verificationUri/deviceCode 映射正确）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      device_code: 'dc_mock_device_code',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      interval: 5,
      expires_in: 900,
    }));

    const session = await gitHubCopilotOAuthProvider.beginLogin();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DEVICE_CODE_URL);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Accept']).toBe('application/json');
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body.client_id).toBe('Iv1.b507a08c87ecfe98');
    expect(body.scope).toBe('read:user');

    expect(session.flow).toBe('device_code');
    if (session.flow !== 'device_code') throw new Error('unreachable');
    expect(session.info.userCode).toBe('ABCD-1234');
    expect(session.info.verificationUri).toBe('https://github.com/login/device');
    expect(session.info.intervalSeconds).toBe(5);
    expect(session.info.expiresInSeconds).toBe(900);
    expect(session.sessionState.deviceCode).toBe('dc_mock_device_code');
  });
});

describe('GitHubCopilotOAuthProvider.pollLogin（GC2-GC5）', () => {
  it('GC2: authorization_pending → pending', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'authorization_pending' }));

    const result = await gitHubCopilotOAuthProvider.pollLogin(makeDeviceSession());

    expect(result).toEqual({ status: 'pending' });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body.grant_type).toBe('urn:ietf:params:oauth:grant-type:device_code');
    expect(body.device_code).toBe('dc_mock_device_code');
  });

  it('GC3: slow_down → slow_down', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'slow_down' }));

    const result = await gitHubCopilotOAuthProvider.pollLogin(makeDeviceSession());

    expect(result).toEqual({ status: 'slow_down' });
  });

  it('GC4: access_token → 换 Copilot token → complete（双层 token 映射：refresh=gho / access=copilot / expires=expires_at×1000）', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: GHO_TOKEN, token_type: 'bearer', scope: 'read:user' }))
      .mockResolvedValueOnce(jsonResponse({ token: COPILOT_TOKEN, expires_at: COPILOT_EXPIRES_AT_SEC }));

    const result = await gitHubCopilotOAuthProvider.pollLogin(makeDeviceSession());

    expect(result.status).toBe('complete');
    if (result.status !== 'complete') throw new Error('unreachable');

    // 第二次调用：copilot_internal/v2/token，Authorization: token gho_xxx
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [copilotUrl, copilotInit] = fetchMock.mock.calls[1];
    expect(copilotUrl).toBe(COPILOT_TOKEN_URL);
    expect((copilotInit?.headers as Record<string, string>)['Authorization']).toBe(`token ${GHO_TOKEN}`);

    const credentials: OAuthCredentials = result.credentials;
    expect(credentials.refresh).toBe(GHO_TOKEN);
    expect(credentials.access).toBe(COPILOT_TOKEN);
    expect(credentials.expires).toBe(COPILOT_EXPIRES_AT_SEC * 1000);
  });

  it('GC5: access_denied → failed（message 含 error_description）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: 'access_denied',
      error_description: 'The user has denied your application access.',
    }));

    const result = await gitHubCopilotOAuthProvider.pollLogin(makeDeviceSession());

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('unreachable');
    expect(result.message).toContain('denied');
  });

  it('GC5b: expired_token → failed（提示重新发起登录）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: 'expired_token',
      error_description: 'The device code has expired.',
    }));

    const result = await gitHubCopilotOAuthProvider.pollLogin(makeDeviceSession());

    expect(result.status).toBe('failed');
  });
});

describe('GitHubCopilotOAuthProvider.refreshToken（GC6-GC7）', () => {
  it('GC6: 用 refresh（gho token）重换 Copilot session token；refresh 保持不变，access/expires 更新', async () => {
    const newExpiresAt = COPILOT_EXPIRES_AT_SEC + 1800;
    fetchMock.mockResolvedValueOnce(jsonResponse({ token: 'tid_new_copilot_token', expires_at: newExpiresAt }));

    const old: OAuthCredentials = { refresh: GHO_TOKEN, access: COPILOT_TOKEN, expires: COPILOT_EXPIRES_AT_SEC * 1000 };
    const refreshed = await gitHubCopilotOAuthProvider.refreshToken(old);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(COPILOT_TOKEN_URL);
    expect((init?.headers as Record<string, string>)['Authorization']).toBe(`token ${GHO_TOKEN}`);

    expect(refreshed.refresh).toBe(GHO_TOKEN);
    expect(refreshed.access).toBe('tid_new_copilot_token');
    expect(refreshed.expires).toBe(newExpiresAt * 1000);
  });

  it('GC7: gho token 失效（HTTP 401）→ 抛错，不返回旧凭证', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Bad credentials' }, 401));

    const old: OAuthCredentials = { refresh: 'gho_revoked', access: COPILOT_TOKEN, expires: 0 };

    await expect(gitHubCopilotOAuthProvider.refreshToken(old)).rejects.toThrow();
  });
});

describe('GitHubCopilotOAuthProvider.getApiKey / completeLogin（GC8-GC9）', () => {
  it('GC8: getApiKey 返回 credentials.access', () => {
    const credentials: OAuthCredentials = { refresh: GHO_TOKEN, access: COPILOT_TOKEN, expires: 0 };
    expect(gitHubCopilotOAuthProvider.getApiKey(credentials)).toBe(COPILOT_TOKEN);
  });

  it('GC9: completeLogin 抛"仅支持 device_code"（auth_url 流程不适用）', async () => {
    const authUrlSession: OAuthLoginSession & { flow: 'auth_url' } = {
      flow: 'auth_url',
      info: { url: 'https://example.com/auth', state: 's' },
      sessionState: {},
    };

    await expect(
      gitHubCopilotOAuthProvider.completeLogin(authUrlSession, { code: 'c', state: 's' }),
    ).rejects.toThrow(/device_code/);
  });

  it('Provider 元数据：id/name 契约', () => {
    expect(gitHubCopilotOAuthProvider.id).toBe('github-copilot');
    expect(gitHubCopilotOAuthProvider.name).toBeTruthy();
  });
});
