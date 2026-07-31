/**
 * 图像 API 注册中心 + generateImages 包级入口（M2-5，接口先行 §15-D2）
 *
 * 独立注册中心（与 pi 对齐，不注册到 ProviderRegistry）：图像是独立类型族，
 * 统一注册中心需要泛型分裂；图像 Provider 的 key/配置未来复用 model_providers
 * 表 + providerType 区分（如 'openrouter-images'），无需新表。
 *
 * sourceId 命名空间（§7.2）：'images:builtin' / 'images:plugin:{id}'。
 * B2 阶段 0 图像 Provider（D2 拍板）：generateImages 对未注册 api 抛清晰 Error
 * 是预期行为；首个 Provider 实现随 ImageGenService 重设计立项交付（B3）。
 *
 * 设计文档: docs/design/solution-design-20260726-pi-reference-upgrade/模块M2 §6.6
 */

import type {
  AssistantImages,
  ImagesApiProvider,
  ImagesContext,
  ImagesModel,
  ImagesOptions,
} from './images-types.js';

/** 图像 Provider 注册信息（sourceId 支持按来源批量卸载） */
interface ImagesApiRegistration {
  provider: ImagesApiProvider;
  sourceId: string;
}

const registry = new Map<string, ImagesApiRegistration>();

/** 注册图像 Provider；重复 api 覆盖并 warn（与 provider-registry 对称） */
export function registerImagesApiProvider(
  provider: ImagesApiProvider,
  sourceId = 'images:builtin',
): void {
  if (registry.has(provider.api)) {
    console.warn(`Images API '${provider.api}' already registered, overwriting`);
  }
  registry.set(provider.api, { provider, sourceId });
}

/** 按 api 查询；未注册返回 undefined */
export function getImagesApiProvider(api: string): ImagesApiProvider | undefined {
  return registry.get(api)?.provider;
}

/** 列出全部已注册图像 Provider */
export function listImagesApiProviders(): ImagesApiProvider[] {
  return Array.from(registry.values()).map(registration => registration.provider);
}

/** 按 sourceId 批量注销（插件卸载/测试隔离用）；sourceId 不存在为空操作（不抛错） */
export function unregisterImagesApiProviders(sourceId: string): void {
  for (const [api, registration] of registry) {
    if (registration.sourceId === sourceId) {
      registry.delete(api);
    }
  }
}

/**
 * 包级入口（pi images.ts 对齐）：按 model.api 查找 Provider 并委托生成。
 *
 * 失败语义（§6.8）：
 * - api 未注册 → 抛清晰 Error（接口先行阶段唯一可达路径）
 * - Provider HTTP 失败 → 原样抛 Provider 错误（不吞不包装）
 * - 结果契约校验：每张图 data/url 二必有其一，皆无视为 Provider 契约违反抛错
 */
export async function generateImages(
  model: ImagesModel,
  context: ImagesContext,
  options?: ImagesOptions,
): Promise<AssistantImages> {
  const provider = getImagesApiProvider(model.api);
  if (!provider) {
    throw new Error(
      `No images API provider registered for api '${model.api}'（B2 接口先行阶段 0 内置图像 Provider，需先 registerImagesApiProvider）`,
    );
  }

  const result = await provider.generateImages(model, context, options);
  for (const [index, image] of result.images.entries()) {
    if (!image.data && !image.url) {
      throw new Error(
        `Images API provider '${model.api}' 契约违反：images[${index}] 既无 data 也无 url`,
      );
    }
  }
  return result;
}
