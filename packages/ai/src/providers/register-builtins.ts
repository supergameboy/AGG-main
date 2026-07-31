/**
 * 内置 Provider 注册（M2-1 lazy 版）
 *
 * 模块加载时仅注册 lazy 工厂（同步返回），零 Provider 类加载；
 * 首次调用某 Provider 时才 dynamic import 对应模块（LazyProviderProxy 委托）。
 * 12 个内置 + bedrock/vertex 插槽统一 lazy（§15-D4 拍板方案A）。
 *
 * 设计文档: docs/design/solution-design-20260726-pi-reference-upgrade/模块M2 §6.1
 */

import { registerProvider } from '../provider-registry.js';
import { createLazyProviderFactory, type ProviderConstructor } from '../utils/lazy-provider.js';

/**
 * bedrock/vertex 插槽使用计算式 specifier：
 * 两个实现文件本版本不交付（§15-D3 插槽预留），字面量 `import('./BedrockProvider.js')`
 * 会被 tsc 静态解析报 TS2307；计算式 specifier 保留为运行时边界，
 * 只有真正调用该类型时才触发 import 并抛 LLMProviderLoadError（含可选依赖提示）。
 * 构建产物（tsc, module=ESNext）中 dynamic import 原样保留，相对路径基于本文件位置解析。
 */
const BEDROCK_MODULE = './BedrockProvider.js';
const VERTEX_MODULE = './VertexProvider.js';

export function registerBuiltinProviders(): void {
  registerProvider('openai', createLazyProviderFactory(
    () => import('./OpenAIProvider.js').then(m => m.OpenAIProvider), 'openai'), 'builtin');
  registerProvider('gemini', createLazyProviderFactory(
    () => import('./GeminiProvider.js').then(m => m.GeminiProvider), 'gemini'), 'builtin');
  registerProvider('deepseek', createLazyProviderFactory(
    () => import('./DeepSeekProvider.js').then(m => m.DeepSeekProvider), 'deepseek'), 'builtin');
  registerProvider('glm', createLazyProviderFactory(
    () => import('./GLMProvider.js').then(m => m.GLMProvider), 'glm'), 'builtin');
  registerProvider('kimi', createLazyProviderFactory(
    () => import('./KimiProvider.js').then(m => m.KimiProvider), 'kimi'), 'builtin');
  registerProvider('anthropic', createLazyProviderFactory(
    () => import('./AnthropicCompatibleProvider.js').then(m => m.AnthropicCompatibleProvider), 'anthropic'), 'builtin');
  registerProvider('qwen', createLazyProviderFactory(
    () => import('./QwenProvider.js').then(m => m.QwenProvider), 'qwen'), 'builtin');
  registerProvider('ernie', createLazyProviderFactory(
    () => import('./ErnieProvider.js').then(m => m.ErnieProvider), 'ernie'), 'builtin');
  registerProvider('spark', createLazyProviderFactory(
    () => import('./SparkProvider.js').then(m => m.SparkProvider), 'spark'), 'builtin');
  registerProvider('siliconflow', createLazyProviderFactory(
    () => import('./SiliconFlowProvider.js').then(m => m.SiliconFlowProvider), 'siliconflow'), 'builtin');
  registerProvider('github-copilot', createLazyProviderFactory(
    () => import('./GitHubCopilotProvider.js').then(m => m.GitHubCopilotProvider), 'github-copilot'), 'builtin');
  registerProvider('custom', createLazyProviderFactory(
    () => import('./CustomProvider.js').then(m => m.CustomProvider), 'custom'), 'builtin');

  // M2-6 插槽预留：文件不存在时，仅调用该类型才报 LLMProviderLoadError，启动与其他 Provider 不受影响
  registerProvider('bedrock', createLazyProviderFactory(
    () => import(BEDROCK_MODULE).then((m: { BedrockProvider: ProviderConstructor }) => m.BedrockProvider),
    'bedrock', { optionalDependency: '@aws-sdk/client-bedrock-runtime' }), 'builtin');
  registerProvider('vertex', createLazyProviderFactory(
    () => import(VERTEX_MODULE).then((m: { VertexProvider: ProviderConstructor }) => m.VertexProvider),
    'vertex', { optionalDependency: '@google/genai' }), 'builtin');
}

registerBuiltinProviders();
