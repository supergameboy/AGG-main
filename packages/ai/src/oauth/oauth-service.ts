/**
 * OAuthCredentialService — OAuth 凭证编排服务（M2-4，接口先行 §15-D1）
 *
 * 职责：登录流程编排（beginLogin / completeXxxLogin）+ LLM 调用链取 key 的
 * 统一入口（resolveApiKey，过期自动刷新）。
 *
 * 消费方（未来 B3）：B 层 OAuth 路由调用登录编排；ModelConfigService 的 key 解析
 * 路径经 resolveApiKey 取 OAuth 型 Provider 的 apiKey（产出纯字符串，M9 不感知 OAuth）。
 *
 * 存储经 IOAuthCredentialStore 端口注入（H 层零 Knex 依赖硬约束）。
 *
 * 设计文档: docs/design/solution-design-20260726-pi-reference-upgrade/模块M2 §6.5
 */

import { getOAuthProvider } from './oauth-registry.js';
import { pollDeviceCodeFlow, type DeviceCodePollResult } from './device-code.js';
import type {
  IOAuthCredentialStore,
  OAuthCredentials,
  OAuthLoginSession,
  OAuthProviderInterface,
} from './types.js';

export class OAuthCredentialService {
  /**
   * 进行中的刷新 promise（按 providerId 去重）：
   * 并发 resolveApiKey 命中过期凭证时共享同一次刷新，防刷新风暴（§6.8）。
   * 无论成败均在 settle 后清除——成功后续用新凭证，失败允许下次重试（禁止缓存失败）。
   */
  private readonly refreshPromises = new Map<string, Promise<OAuthCredentials>>();

  constructor(private readonly store: IOAuthCredentialStore) {}

  /**
   * 解析 apiKey（自动刷新）。
   *
   * @returns apiKey 字符串；Provider 未注册或无凭证返回 null（调用方走普通 api_keys 路径）
   * @throws 刷新失败原样抛 Provider 错误（禁止静默降级用过期 token，§6.8）
   */
  async resolveApiKey(providerId: string): Promise<string | null> {
    const provider = getOAuthProvider(providerId);
    if (!provider) return null;

    const credentials = await this.store.load(providerId);
    if (!credentials) return null;

    // 边界契约（O11）：Date.now() === expires 视为过期，提前刷新
    if (Date.now() < credentials.expires) {
      return provider.getApiKey(credentials);
    }

    const refreshed = await this.refreshOnce(provider, credentials);
    return provider.getApiKey(refreshed);
  }

  /** 登录流程编排（B 层路由调用）：未注册的 Provider 抛清晰 Error */
  async beginLogin(providerId: string): Promise<OAuthLoginSession> {
    return this.requireProvider(providerId).beginLogin();
  }

  /**
   * device_code 流程推进：内部委托 pollDeviceCodeFlow 循环，完成后凭证落库。
   *
   * signal 由 B 层路由注入（M2-B3 D6）：logout / 重复 login 时中止后台轮询，
   * 中止表现为抛 'Login cancelled'（LOGIN_CANCELLED_MESSAGE，路由据此区分取消与真实失败）。
   */
  async completeDeviceLogin(
    providerId: string,
    session: OAuthLoginSession,
    signal?: AbortSignal,
  ): Promise<void> {
    const provider = this.requireProvider(providerId);
    if (session.flow !== 'device_code') {
      throw new Error(
        `completeDeviceLogin 需要 flow='device_code' 的会话，实际收到 '${session.flow}'`,
      );
    }

    const credentials = await pollDeviceCodeFlow<OAuthCredentials>({
      intervalSeconds: session.info.intervalSeconds,
      expiresInSeconds: session.info.expiresInSeconds,
      signal,
      poll: async (): Promise<DeviceCodePollResult<OAuthCredentials>> => {
        const result = await provider.pollLogin(session);
        // 状态族映射：complete 的 credentials 提取为 value，其余原样透传
        return result.status === 'complete'
          ? { status: 'complete', value: result.credentials }
          : result;
      },
    });
    await this.store.save(providerId, credentials);
  }

  /** auth_url 流程推进：回调 code + state 交换 token，凭证落库 */
  async completeCallbackLogin(
    providerId: string,
    session: OAuthLoginSession,
    callback: { code: string; state: string },
  ): Promise<void> {
    const provider = this.requireProvider(providerId);
    if (session.flow !== 'auth_url') {
      throw new Error(
        `completeCallbackLogin 需要 flow='auth_url' 的会话，实际收到 '${session.flow}'`,
      );
    }

    const credentials = await provider.completeLogin(session, callback);
    await this.store.save(providerId, credentials);
  }

  /** 注销：删除已存凭证；无凭证为空操作（store 端口契约） */
  async logout(providerId: string): Promise<void> {
    await this.store.delete(providerId);
  }

  /** 凭证存在性（B 层路由 status/providers 列表用） */
  async hasCredentials(providerId: string): Promise<boolean> {
    return (await this.store.load(providerId)) !== null;
  }

  /**
   * 401 恢复（M2-B3 D7）：无视 expires 强制刷新并落库。
   * 刷新失败删除死凭证后原样抛错——死凭证不删会反复 401 死循环；
   * 删除后下次 resolveApiKey 返回 null，调用方走"未登录"提示路径。
   */
  async forceRefresh(providerId: string): Promise<void> {
    const provider = this.requireProvider(providerId);
    const credentials = await this.store.load(providerId);
    if (!credentials) {
      throw new Error(`OAuth provider '${providerId}' 无凭证，无法强制刷新（需先登录）`);
    }

    try {
      await this.refreshOnce(provider, credentials);
    } catch (error) {
      await this.store.delete(providerId);
      throw error;
    }
  }

  /** 登录编排入口的 Provider 解析：未注册是调用方错误，必须抛清晰 Error */
  private requireProvider(providerId: string): OAuthProviderInterface {
    const provider = getOAuthProvider(providerId);
    if (!provider) {
      throw new Error(
        `OAuth provider '${providerId}' is not registered（B2 接口先行阶段 0 内置 Provider，需先 registerOAuthProvider）`,
      );
    }
    return provider;
  }

  /** 刷新并落库；并发去重（同一 providerId 同时进行中的刷新仅一次） */
  private refreshOnce(
    provider: OAuthProviderInterface,
    credentials: OAuthCredentials,
  ): Promise<OAuthCredentials> {
    const existing = this.refreshPromises.get(provider.id);
    if (existing) return existing;

    const promise = provider
      .refreshToken(credentials)
      .then(async refreshed => {
        // 刷新成功立即落库：登录结果不落库即视为未登录（§6.8）
        await this.store.save(provider.id, refreshed);
        return refreshed;
      })
      .finally(() => {
        this.refreshPromises.delete(provider.id);
      });
    this.refreshPromises.set(provider.id, promise);
    return promise;
  }
}
