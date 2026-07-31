/**
 * OAuth Provider 注册中心（M2-4，接口先行 §15-D1）
 *
 * 独立于 ProviderRegistry：OAuth 是凭证来源（产出 apiKey 字符串），
 * 不是 LLMClient 工厂，两套注册语义不同，统一注册中心需要泛型分裂（§7.1）。
 *
 * B3 起内置 github-copilot（M2-B3 D9 拍板）：模块加载时经 resetOAuthProviders 登记，
 * 与 register-builtins.ts 的模块副作用模式对称。
 *
 * 设计文档: docs/design/solution-design-20260726-pi-reference-upgrade/模块M2 §6.5
 */

import { gitHubCopilotOAuthProvider } from './github-copilot.js';
import type { OAuthProviderInterface } from './types.js';

/**
 * 内置 OAuth Provider 清单（B3：github-copilot）。
 * resetOAuthProviders 以此为准恢复——新增内置实现时登记到这里，
 * 而非散落在模块加载副作用里，保证"恢复内置"语义单一数据源。
 */
const BUILTIN_OAUTH_PROVIDERS: ReadonlyArray<OAuthProviderInterface> = [
  gitHubCopilotOAuthProvider,
];

const providers = new Map<string, OAuthProviderInterface>();

/** 注册 OAuth Provider；重复 id 覆盖并 warn（与 provider-registry 对称） */
export function registerOAuthProvider(provider: OAuthProviderInterface): void {
  if (providers.has(provider.id)) {
    console.warn(`OAuth provider '${provider.id}' already registered, overwriting`);
  }
  providers.set(provider.id, provider);
}

/** 按 id 查询；未注册返回 undefined（B2 阶段对任何 id 均返回 undefined） */
export function getOAuthProvider(id: string): OAuthProviderInterface | undefined {
  return providers.get(id);
}

/** 列出全部已注册 OAuth Provider */
export function listOAuthProviders(): OAuthProviderInterface[] {
  return Array.from(providers.values());
}

/** 注销指定 id；未注册为空操作（不抛错） */
export function unregisterOAuthProvider(id: string): void {
  providers.delete(id);
}

/** 恢复内置集（测试隔离用）：清空后重新登记 BUILTIN_OAUTH_PROVIDERS */
export function resetOAuthProviders(): void {
  providers.clear();
  for (const provider of BUILTIN_OAUTH_PROVIDERS) {
    providers.set(provider.id, provider);
  }
}

// 模块加载时登记内置集（M2-B3 D9；与 register-builtins.ts 模块副作用模式对称）
resetOAuthProviders();
