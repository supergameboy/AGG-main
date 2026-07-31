import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateImages,
  getImagesApiProvider,
  listImagesApiProviders,
  registerImagesApiProvider,
  unregisterImagesApiProviders,
  type AssistantImages,
  type ImagesApiProvider,
  type ImagesContext,
  type ImagesModel,
  type ImagesOptions,
} from '../src/images-api-registry.js';

/**
 * M2-5 图像注册中心单元测试（设计文档 模块M2 §8.5 I1-I4 + §10.2 B2 验收）
 * 全 mock Provider，无真实图像 API 调用。
 */

const TEST_SOURCE = 'images:test';
const OTHER_SOURCE = 'images:plugin:other';

/** mock 图像 Provider：generateImages 为 vi.fn，默认返回 1 张 base64 图 */
function makeMockProvider(api: string): ImagesApiProvider {
  return {
    api,
    generateImages: vi.fn(async (): Promise<AssistantImages> => ({
      images: [{ data: 'aGVsbG8=', mimeType: 'image/png' }],
      usage: { totalImages: 1 },
    })),
  };
}

function makeModel(api: string): ImagesModel {
  return { id: 'test-image-model', provider: 'test', api };
}

afterEach(() => {
  // 测试隔离：按 sourceId 清理本文件注册的 Provider
  unregisterImagesApiProviders(TEST_SOURCE);
  unregisterImagesApiProviders(OTHER_SOURCE);
  unregisterImagesApiProviders('images:builtin');
});

describe('图像注册中心 + generateImages（I1-I4）', () => {
  it('I1: register + get + generateImages 委托——mock Provider 收到 model/context/options', async () => {
    const provider = makeMockProvider('test-images');
    registerImagesApiProvider(provider, TEST_SOURCE);
    expect(getImagesApiProvider('test-images')).toBe(provider);
    expect(listImagesApiProviders()).toEqual([provider]);

    const model = makeModel('test-images');
    const context: ImagesContext = { prompt: '一座被雾气笼罩的精灵古城', negativePrompt: '低质量' };
    const options: ImagesOptions = { size: '1024x1024', n: 2, quality: 'hd' };

    const result = await generateImages(model, context, options);

    expect(provider.generateImages).toHaveBeenCalledTimes(1);
    expect(provider.generateImages).toHaveBeenCalledWith(model, context, options);
    expect(result.images).toHaveLength(1);
    expect(result.usage?.totalImages).toBe(1);
  });

  it('I2: 未注册 api——generateImages 抛清晰 Error（B2 验收第 3 条）', async () => {
    await expect(
      generateImages(makeModel('openrouter-images'), { prompt: ' anything ' }),
    ).rejects.toThrow(/No images API provider registered.*openrouter-images/);
  });

  it('I3: unregisterImagesApiProviders(sourceId) 按来源批量删除，其他来源保留', () => {
    const mine = makeMockProvider('mine-images');
    const other = makeMockProvider('other-images');
    registerImagesApiProvider(mine, TEST_SOURCE);
    registerImagesApiProvider(other, OTHER_SOURCE);

    unregisterImagesApiProviders(TEST_SOURCE);

    expect(getImagesApiProvider('mine-images')).toBeUndefined();
    expect(getImagesApiProvider('other-images')).toBe(other);
    // sourceId 不存在为空操作（不抛错）
    unregisterImagesApiProviders('images:non-existent');
  });

  it('I4: 结果契约校验——images 条目 data/url 二必有其一，皆无抛契约违反', async () => {
    const provider = makeMockProvider('contract-images');
    registerImagesApiProvider(provider, TEST_SOURCE);

    // 正向：url 形态结果合法（data/url 二选一）
    vi.mocked(provider.generateImages).mockResolvedValueOnce({
      images: [{ url: 'https://cdn.example.com/a.png', mimeType: 'image/png' }],
    });
    const ok = await generateImages(makeModel('contract-images'), { prompt: 'p' });
    expect(ok.images[0].url).toBe('https://cdn.example.com/a.png');

    // 反向：既无 data 也无 url → Provider 契约违反抛错
    vi.mocked(provider.generateImages).mockResolvedValueOnce({
      images: [{ mimeType: 'image/png' }],
    });
    await expect(generateImages(makeModel('contract-images'), { prompt: 'p' })).rejects.toThrow(
      /契约违反.*images\[0\]/,
    );
  });

  it('I4b: Provider 失败原样上抛（不吞不包装）', async () => {
    const provider = makeMockProvider('failing-images');
    registerImagesApiProvider(provider, TEST_SOURCE);
    vi.mocked(provider.generateImages).mockRejectedValue(new Error('HTTP 429 rate limited'));

    await expect(generateImages(makeModel('failing-images'), { prompt: 'p' })).rejects.toThrow(
      'HTTP 429 rate limited',
    );
  });
});
