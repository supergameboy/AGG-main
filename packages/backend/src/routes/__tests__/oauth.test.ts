import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuthCredentialService, OAuthLoginSession } from '@ai-rpg/ai';
import { registerOAuthProvider, unregisterOAuthProvider, LOGIN_CANCELLED_MESSAGE } from '@ai-rpg/ai';
import { createOAuthRouter } from '../oauth.js';
import { errorHandler } from '../../middlewares/errorhandler.js';

/**
 * OAuth 路由单元测试（M2-B3 D6，RT1-RT6）
 *
 * Mock 策略：OAuthCredentialService 以 plain object mock（login 轮询可控）；
 * oauth-registry 用真实注册表（github-copilot 经模块加载已内置登记），
 * 未注册场景使用虚构 id，auth_url 501 场景临时登记虚构 Provider 后卸载。
 * 每个用例重建 router（会话 Map 存于路由闭包，重建即隔离）。
 */

const beginLogin = vi.fn();
const completeDeviceLogin = vi.fn();
const hasCredentials = vi.fn();
const logout = vi.fn();
const oauthCredentialService = {
  beginLogin,
  completeDeviceLogin,
  hasCredentials,
  logout,
} as unknown as OAuthCredentialService;

function makeDeviceSession(userCode = 'ABCD-1234'): OAuthLoginSession {
  return {
    flow: 'device_code',
    info: {
      userCode,
      verificationUri: 'https://github.com/login/device',
      intervalSeconds: 5,
      expiresInSeconds: 900,
    },
    sessionState: { deviceCode: `dc-${userCode}` },
  };
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/oauth', createOAuthRouter(oauthCredentialService));
  app.use(errorHandler);
  return app;
}

/** 等待后台轮询 promise settle（then/catch 微任务 + 状态写入） */
async function flush(ms = 20): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe('OAuth routes（M2-B3 D6）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasCredentials.mockResolvedValue(false);
    logout.mockResolvedValue(undefined);
    // 缺省：后台轮询挂起（永不 settle），各用例按需覆盖
    completeDeviceLogin.mockReturnValue(new Promise(() => {}));
    beginLogin.mockResolvedValue(makeDeviceSession());
  });

  describe('RT1: login 成功', () => {
    it('202 返回设备码信息，后台轮询启动', async () => {
      const res = await request(createApp()).post('/api/v1/oauth/github-copilot/login');

      expect(res.status).toBe(202);
      expect(res.body.data).toEqual({
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        intervalSeconds: 5,
        expiresInSeconds: 900,
      });
      expect(beginLogin).toHaveBeenCalledWith('github-copilot');
      // 后台轮询已启动（fire-and-forget）：session + AbortSignal 透传
      expect(completeDeviceLogin).toHaveBeenCalledTimes(1);
      expect(completeDeviceLogin.mock.calls[0][0]).toBe('github-copilot');
      expect(completeDeviceLogin.mock.calls[0][1]).toMatchObject({ flow: 'device_code' });
      expect(completeDeviceLogin.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
    });
  });

  describe('RT2: login 重复', () => {
    it('旧会话 abort 后重建新会话', async () => {
      const app = createApp();

      await request(app).post('/api/v1/oauth/github-copilot/login');
      const firstSignal = completeDeviceLogin.mock.calls[0][2] as AbortSignal;
      expect(firstSignal.aborted).toBe(false);

      beginLogin.mockResolvedValue(makeDeviceSession('WXYZ-9876'));
      const res = await request(app).post('/api/v1/oauth/github-copilot/login');

      expect(res.status).toBe(202);
      expect(res.body.data.userCode).toBe('WXYZ-9876');
      expect(firstSignal.aborted).toBe(true);
      expect(completeDeviceLogin).toHaveBeenCalledTimes(2);
      const secondSignal = completeDeviceLogin.mock.calls[1][2] as AbortSignal;
      expect(secondSignal.aborted).toBe(false);

      // 新会话为 pending 且展示新设备码
      const status = await request(app).get('/api/v1/oauth/github-copilot/status');
      expect(status.body.data).toMatchObject({
        status: 'pending',
        login: { userCode: 'WXYZ-9876', verificationUri: 'https://github.com/login/device' },
      });
    });
  });

  describe('RT3: login 未注册', () => {
    it('未注册 providerId 返回 404', async () => {
      const res = await request(createApp()).post('/api/v1/oauth/nonexistent-provider/login');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('OAUTH_PROVIDER_NOT_FOUND');
      expect(beginLogin).not.toHaveBeenCalled();
    });

    it('auth_url 流程返回 501（契约预留）', async () => {
      registerOAuthProvider({
        id: 'fake-auth-url',
        name: 'Fake Auth URL',
        beginLogin: async () => ({
          flow: 'auth_url',
          info: { url: 'https://example.com/auth', state: 's1' },
          sessionState: {},
        }),
        pollLogin: async () => ({ status: 'failed', message: 'n/a' }),
        completeLogin: async () => ({ refresh: 'r', access: 'a', expires: 0 }),
        refreshToken: async (c) => c,
        getApiKey: (c) => c.access,
      });
      try {
        beginLogin.mockResolvedValue({
          flow: 'auth_url',
          info: { url: 'https://example.com/auth', state: 's1' },
          sessionState: {},
        });

        const res = await request(createApp()).post('/api/v1/oauth/fake-auth-url/login');

        expect(res.status).toBe(501);
        expect(res.body.error.code).toBe('OAUTH_FLOW_UNSUPPORTED');
      } finally {
        unregisterOAuthProvider('fake-auth-url');
      }
    });
  });

  describe('RT4: status 四态', () => {
    it('idle：无会话时 status=idle + hasCredentials', async () => {
      const res = await request(createApp()).get('/api/v1/oauth/github-copilot/status');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ status: 'idle', hasCredentials: false });
    });

    it('pending：login 后附设备码（刷新恢复展示用）', async () => {
      const app = createApp();
      await request(app).post('/api/v1/oauth/github-copilot/login');

      const res = await request(app).get('/api/v1/oauth/github-copilot/status');

      expect(res.body.data).toEqual({
        status: 'pending',
        hasCredentials: false,
        login: { userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' },
      });
    });

    it('success：后台轮询完成后状态迁移且幂等保留', async () => {
      const app = createApp();
      completeDeviceLogin.mockResolvedValue(undefined);
      hasCredentials.mockResolvedValue(true);
      await request(app).post('/api/v1/oauth/github-copilot/login');
      await flush();

      const res = await request(app).get('/api/v1/oauth/github-copilot/status');

      expect(res.body.data).toEqual({ status: 'success', hasCredentials: true });
    });

    it('failed：轮询失败附错误信息；Login cancelled 不覆盖状态', async () => {
      const app = createApp();
      completeDeviceLogin.mockRejectedValue(new Error('用户拒绝了授权请求'));
      await request(app).post('/api/v1/oauth/github-copilot/login');
      await flush();

      const res = await request(app).get('/api/v1/oauth/github-copilot/status');

      expect(res.body.data).toMatchObject({ status: 'failed', error: '用户拒绝了授权请求' });
    });
  });

  describe('RT5: logout', () => {
    it('中止 pending 轮询 + 删除凭证 + 状态复位 idle', async () => {
      const app = createApp();
      // 轮询挂起直至 abort（模拟真实 device flow 循环的取消语义）
      completeDeviceLogin.mockImplementation(
        async (_id: string, _s: OAuthLoginSession, signal?: AbortSignal) =>
          new Promise<void>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new Error(LOGIN_CANCELLED_MESSAGE)), { once: true });
          }),
      );
      await request(app).post('/api/v1/oauth/github-copilot/login');
      const signal = completeDeviceLogin.mock.calls[0][2] as AbortSignal;

      const res = await request(app).post('/api/v1/oauth/github-copilot/logout');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ loggedOut: true });
      expect(signal.aborted).toBe(true);
      expect(logout).toHaveBeenCalledWith('github-copilot');

      // 取消的轮询不覆盖状态：logout 后为 idle
      await flush();
      const status = await request(app).get('/api/v1/oauth/github-copilot/status');
      expect(status.body.data).toEqual({ status: 'idle', hasCredentials: false });
    });
  });

  describe('RT6: providers 列表', () => {
    it('含 github-copilot + hasCredentials + status', async () => {
      hasCredentials.mockImplementation(async (id: string) => id === 'github-copilot');

      const res = await request(createApp()).get('/api/v1/oauth/providers');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        { id: 'github-copilot', name: 'GitHub Copilot', hasCredentials: true, status: 'idle' },
      ]);
    });
  });
});
