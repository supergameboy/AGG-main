/**
 * GitHub Copilot OAuth Provider（M2-B3，首个内置 OAuth Provider）
 *
 * 双层 token 结构（Copilot 特性，不存在传统 refresh_token）：
 *   第一层：GitHub OAuth token（gho_，长期有效）→ credentials.refresh
 *   第二层：Copilot session token（约 30min）→ credentials.access
 *   refreshToken = 用第一层重换第二层，refresh 本身不变。
 *
 * 流程：RFC 8628 device flow（github.com）→ access_token（gho_）
 *       → copilot_internal/v2/token 交换 session token（api.github.com）。
 *
 * client_id 为 VSCode OAuth App 的公共 ID（GitHub 官方扩展硬编码同款）：
 * GPT-5.x/Codex 等模型族对该 client_id 门控，换成自注册 App 会丢模型覆盖。
 *
 * 设计文档: docs/design/solution-design-20260726-pi-reference-upgrade/solution-design-20260731-m2b3-github-copilot-oauth.md
 */

import { COPILOT_IDENTITY_HEADERS } from '../utils/copilot-headers.js';
import type {
  OAuthCredentials,
  OAuthLoginSession,
  OAuthPollResult,
  OAuthProviderInterface,
} from './types.js';

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';

const CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const DEVICE_FLOW_SCOPE = 'read:user';
const DEVICE_CODE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

const JSON_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

// ===== GitHub 端响应类型（wire format）=====

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval?: number;
  expires_in?: number;
}

interface DeviceFlowPollResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface CopilotTokenResponse {
  token: string;
  /** epoch 秒 */
  expires_at: number;
}

/** 用 gho token 换 Copilot session token（pollLogin 完成阶段与 refreshToken 共用） */
async function fetchCopilotSessionToken(ghoToken: string): Promise<CopilotTokenResponse> {
  const response = await fetch(COPILOT_TOKEN_URL, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `token ${ghoToken}`,
      ...COPILOT_IDENTITY_HEADERS,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Copilot session token 交换失败（HTTP ${response.status}）：gho token 可能已失效或被吊销，需重新登录`,
    );
  }

  return (await response.json()) as CopilotTokenResponse;
}

/** 双层 token 映射：refresh=gho 长期 token，access=Copilot session token，expires=session 过期 ms */
function toCredentials(ghoToken: string, session: CopilotTokenResponse): OAuthCredentials {
  return {
    refresh: ghoToken,
    access: session.token,
    expires: session.expires_at * 1000,
  };
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`GitHub OAuth 请求失败（HTTP ${response.status}）：${url}`);
  }

  return (await response.json()) as T;
}

export const gitHubCopilotOAuthProvider: OAuthProviderInterface = {
  id: 'github-copilot',
  name: 'GitHub Copilot',

  async beginLogin(): Promise<OAuthLoginSession> {
    const data = await postJson<DeviceCodeResponse>(DEVICE_CODE_URL, {
      client_id: CLIENT_ID,
      scope: DEVICE_FLOW_SCOPE,
    });

    return {
      flow: 'device_code',
      info: {
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        intervalSeconds: data.interval,
        expiresInSeconds: data.expires_in,
      },
      sessionState: { deviceCode: data.device_code },
    };
  },

  async pollLogin(
    session: OAuthLoginSession & { flow: 'device_code' },
  ): Promise<OAuthPollResult> {
    const data = await postJson<DeviceFlowPollResponse>(ACCESS_TOKEN_URL, {
      client_id: CLIENT_ID,
      device_code: session.sessionState.deviceCode,
      grant_type: DEVICE_CODE_GRANT_TYPE,
    });

    // RFC 8628 §3.5：device flow 的待授权/降速以 200 + error 字段返回，非 HTTP 错误码
    if (data.error === 'authorization_pending') return { status: 'pending' };
    if (data.error === 'slow_down') return { status: 'slow_down' };
    if (data.error) {
      return {
        status: 'failed',
        message: data.error_description ?? data.error,
      };
    }

    if (!data.access_token) {
      return {
        status: 'failed',
        message: 'GitHub 响应既无 access_token 也无 error（协议外响应）',
      };
    }

    const sessionToken = await fetchCopilotSessionToken(data.access_token);
    return { status: 'complete', credentials: toCredentials(data.access_token, sessionToken) };
  },

  async completeLogin(): Promise<OAuthCredentials> {
    throw new Error('github-copilot 仅支持 device_code 流程（auth_url 流程不适用）');
  },

  async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
    const sessionToken = await fetchCopilotSessionToken(credentials.refresh);
    return toCredentials(credentials.refresh, sessionToken);
  },

  getApiKey(credentials: OAuthCredentials): string {
    return credentials.access;
  },
};
