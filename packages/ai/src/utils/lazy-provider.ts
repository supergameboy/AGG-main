/**
 * LazyProviderProxy — Provider 模块按需加载（M2-1）
 *
 * 为什么需要代理模式：M1 的 ProviderFactoryFn = (config) => LLMClient 是同步签名，
 * 而 dynamic import 是异步的。同步工厂返回本代理（实现 LLMClient），
 * 首次 chat/stream 时才 await 模块 promise 并委托给真实实例，
 * 从而把 Provider 类的加载从"模块加载时 eager import"推迟到"首次调用时"。
 *
 * 失败语义（禁止 fallback 掩盖）：dynamic import 失败 → 所有方法 reject
 * LLMProviderLoadError；失败 promise 不缓存（瞬时问题允许下次调用重试）。
 *
 * 设计文档: docs/design/solution-design-20260726-pi-reference-upgrade/模块M2 §6.1
 */

import type { LLMClient, LLMConfig, LLMResponse, StreamChunk, ChatOptions } from '../types.js';
import type { LLMMessage } from '@ai-rpg/shared';
import { LLMProviderLoadError } from '../errors.js';

/** Provider 构造函数签名（与各 Provider 类一致） */
export type ProviderConstructor = new (config: LLMConfig) => LLMClient;

/** 模块加载器：dynamic import 并提取 Provider 类 */
export type ProviderModuleLoader = () => Promise<ProviderConstructor>;

/** lazy 工厂选项 */
export interface LazyProviderOptions {
  /**
   * 可选依赖提示（如 bedrock 的 '@aws-sdk/client-bedrock-runtime'）。
   * 模块不存在（插槽未交付/缺依赖）时附加到 LLMProviderLoadError.message，
   * 让调用方知道"为什么加载失败、需要安装什么"，而非笼统的 import 错误。
   */
  optionalDependency?: string;
}

/**
 * Lazy Provider 透明代理
 *
 * - modulePromise 使用 ||= 缓存（并发首次调用共享同一 promise，去重）
 * - realInstance 缓存（模块加载后构造一次）
 * - 加载失败不缓存 promise（允许下次调用重试）
 */
export class LazyProviderProxy implements LLMClient {
  private modulePromise: Promise<ProviderConstructor> | null = null;
  private realInstance: LLMClient | null = null;

  constructor(
    private readonly loader: ProviderModuleLoader,
    private readonly config: LLMConfig,
    private readonly providerType: string,
    private readonly options: LazyProviderOptions = {},
  ) {}

  private async resolve(): Promise<LLMClient> {
    if (this.realInstance) return this.realInstance;
    // ||= 并发去重：多个并发首次调用共享同一 promise
    this.modulePromise ||= this.loader().catch((error: unknown) => {
      // 失败不缓存：重置 promise 允许下次重试
      this.modulePromise = null;
      const cause = error instanceof Error ? error.message : String(error);
      const dependencyHint = this.options.optionalDependency
        ? `（该 Provider 需要安装可选依赖 ${this.options.optionalDependency}，或其实现尚未交付）`
        : '';
      throw new LLMProviderLoadError(
        `Failed to load provider module '${this.providerType}': ${cause}${dependencyHint}`,
        this.providerType,
      );
    });
    const Ctor = await this.modulePromise;
    this.realInstance = new Ctor(this.config);
    return this.realInstance;
  }

  async chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const instance = await this.resolve();
    return instance.chat(messages, options);
  }

  async *stream(messages: LLMMessage[], options?: ChatOptions): AsyncIterable<StreamChunk> {
    const instance = await this.resolve();
    yield* instance.stream(messages, options);
  }

  countTokens(text: string): number {
    // 同步方法无法 await：未加载时用 BaseProvider 同款粗估（chars/4），
    // 已加载后委托真实实例。countTokens 本身是启发式估算，语义可接受。
    if (this.realInstance) return this.realInstance.countTokens(text);
    return Math.ceil(text.length / 4);
  }
}

/** 创建与 M1 ProviderFactoryFn 签名兼容的 lazy 工厂（同步返回 proxy） */
export function createLazyProviderFactory(
  loader: ProviderModuleLoader,
  providerType: string,
  options: LazyProviderOptions = {},
): (config: LLMConfig) => LLMClient {
  return (config: LLMConfig) => new LazyProviderProxy(loader, config, providerType, options);
}
