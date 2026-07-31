import type { LLMConfig, LLMClient } from '../types.js';
import { getProviderFactory } from '../provider-registry.js';
import './register-builtins.js';

/**
 * 创建 LLM 客户端
 *
 * M1 改造：从 ProviderRegistry 获取工厂函数，替代硬编码 switch。
 * apiFormat === 'anthropic' 的优先路径保持现有行为不变（优先于 provider 字段分发），
 * M2-1 起经注册表查询 'anthropic'（lazy 工厂），不再 eager import AnthropicCompatibleProvider，
 * 保证模块加载期零 Provider 类加载。
 */
export function providerFactory(config: LLMConfig): LLMClient {
  const type = config.apiFormat === 'anthropic' ? 'anthropic' : config.provider;
  const factory = getProviderFactory(type);
  if (!factory) {
    throw new Error(`Unknown LLM provider: ${config.provider}`);
  }

  return factory(config);
}
