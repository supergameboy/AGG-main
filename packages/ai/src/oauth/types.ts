/**
 * OAuth 类型契约（M2-4，接口先行 §15-D1）
 *
 * 与 pi 的关键差异（后端适配）：pi 的 login(callbacks) 持有交互式回调闭包（CLI/TUI 场景）；
 * AGG 是 HTTP 后端，请求间不能持有闭包，改为两段式无状态 API：
 *   beginLogin →（前端展示 + 用户授权）→ pollLogin / completeLogin
 *
 * 设计文档: docs/design/solution-design-20260726-pi-reference-upgrade/模块M2 §6.5
 */

/** OAuth 凭证（可持久化；索引签名允许 Provider 扩展字段如 enterpriseDomain） */
export interface OAuthCredentials {
  /** refresh token */
  refresh: string;
  /** access token（即 getApiKey 返回值来源） */
  access: string;
  /** access token 过期时间（Unix ms） */
  expires: number;
  [key: string]: unknown;
}

/** 设备码流程信息（beginLogin 返回，前端展示） */
export interface OAuthDeviceCodeInfo {
  userCode: string;
  verificationUri: string;
  intervalSeconds?: number;
  expiresInSeconds?: number;
}

/** 授权 URL 流程信息（PKCE / callback 流程，前端新窗口打开） */
export interface OAuthAuthUrlInfo {
  url: string;
  instructions?: string;
  /** state 参数（completeLogin 时回传校验，防 CSRF） */
  state: string;
}

/** beginLogin 返回：两种流程之一；sessionState 由 Provider 自定义，调用方暂存后回传 */
export type OAuthLoginSession =
  | { flow: 'device_code'; info: OAuthDeviceCodeInfo; sessionState: Record<string, unknown> }
  | { flow: 'auth_url'; info: OAuthAuthUrlInfo; sessionState: Record<string, unknown> };

/** device_code 流程单次轮询结果（pollLogin 返回） */
export type OAuthPollResult =
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'complete'; credentials: OAuthCredentials }
  | { status: 'failed'; message: string };

/**
 * OAuth Provider 接口（pi OAuthProviderInterface 的后端适配版）
 *
 * B2 接口先行阶段 0 内置实现（D1 拍板）；首个内置 Provider（候选 github-copilot）
 * 与其 Knex 存储、B 层路由随 B3 一并交付。
 */
export interface OAuthProviderInterface {
  readonly id: string;
  readonly name: string;

  /**
   * 发起登录。sessionState 由 Provider 自定义（如 deviceCode / PKCE verifier），
   * 调用方负责在流程期间暂存（内存或 DB），pollLogin / completeLogin 时回传。
   */
  beginLogin(options?: { signal?: AbortSignal }): Promise<OAuthLoginSession>;

  /** device_code 流程：轮询一次（调用方按 intervalSeconds 循环，或委托 pollDeviceCodeFlow） */
  pollLogin(session: OAuthLoginSession & { flow: 'device_code' }): Promise<OAuthPollResult>;

  /** auth_url 流程：用户授权后回调携带 code + state，交换 token */
  completeLogin(
    session: OAuthLoginSession & { flow: 'auth_url' },
    callback: { code: string; state: string },
  ): Promise<OAuthCredentials>;

  /** 刷新过期凭证 */
  refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;

  /** 从凭证提取 apiKey 字符串（作为普通 key 进入 M1/M9 调用链） */
  getApiKey(credentials: OAuthCredentials): string;
}

/**
 * 凭证存储端口（H 层定义，E 层 Knex 实现；packages/ai 零业务依赖硬约束）
 *
 * B3 交付 KnexOAuthCredentialStore（oauth_credentials 表 + utils/crypto 加密）；
 * B2 阶段测试用内存实现。
 */
export interface IOAuthCredentialStore {
  load(providerId: string): Promise<OAuthCredentials | null>;
  save(providerId: string, credentials: OAuthCredentials): Promise<void>;
  delete(providerId: string): Promise<void>;
}
