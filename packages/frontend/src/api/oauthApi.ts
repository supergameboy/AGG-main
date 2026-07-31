import { apiClient } from './client';

/**
 * OAuth API client（M2-B3 D10）
 *
 * 与后端 routes/oauth.ts 契约对称：login 立即返回设备码（后台轮询），
 * 前端经 status 2s 轮询观察状态机迁移（idle/pending/success/failed）。
 */

export type OAuthLoginStatus = 'idle' | 'pending' | 'success' | 'failed';

export interface OAuthLoginBeginResult {
  userCode: string;
  verificationUri: string;
  intervalSeconds?: number;
  expiresInSeconds?: number;
}

export interface OAuthStatusResult {
  status: OAuthLoginStatus;
  hasCredentials: boolean;
  error?: string;
  login?: { userCode: string; verificationUri: string };
}

export interface OAuthProviderInfo {
  id: string;
  name: string;
  hasCredentials: boolean;
  status: OAuthLoginStatus;
}

export const oauthApi = {
  /** 发起登录：202 返回设备码信息；pending 中重复调用会中止旧轮询重启 */
  login: async (providerId: string): Promise<OAuthLoginBeginResult> => {
    const data = await apiClient.post(`/oauth/${providerId}/login`, {});
    return data as unknown as OAuthLoginBeginResult;
  },

  /** 状态查询（前端 2s 轮询用） */
  status: async (providerId: string): Promise<OAuthStatusResult> => {
    const data = await apiClient.get(`/oauth/${providerId}/status`);
    return data as unknown as OAuthStatusResult;
  },

  /** 注销：中止 pending 轮询 + 删除凭证 */
  logout: async (providerId: string): Promise<{ loggedOut: boolean }> => {
    const data = await apiClient.post(`/oauth/${providerId}/logout`, {});
    return data as unknown as { loggedOut: boolean };
  },

  /** OAuth Provider 列表（ProviderCard badge 数据源） */
  listOAuthProviders: async (): Promise<OAuthProviderInfo[]> => {
    const data = await apiClient.get('/oauth/providers');
    const providers = data as unknown as OAuthProviderInfo[];
    if (!Array.isArray(providers)) return [];
    return providers;
  },
};
