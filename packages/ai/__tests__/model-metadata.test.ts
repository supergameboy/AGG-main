import { describe, expect, it } from 'vitest';
import { registerChildLoggerFactory, type ILogger } from '@ai-rpg/shared/utils/logger';
import {
  calculateCost,
  getBuiltinModelMetadata,
  listBuiltinModelMetadata,
  resolveModelMetadata,
  type ModelMetadata,
} from '../src/model-metadata.js';

/**
 * M2-2 Model 元数据单元测试（设计文档 模块M2 §8.2 M1-M7）
 * 静态表命中 / 未知模型 undefined（禁止编造）/ DB override 字段级合并 /
 * 非法值忽略并 warn / calculateCost inclusive/exclusive 口径。
 */

interface WarnCall {
  message: string;
  data?: Record<string, unknown>;
}

function createSilentLogger(): ILogger {
  const logger: ILogger = {
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
    verbose: () => {},
    child: () => logger,
  };
  return logger;
}

/** 注册捕获 warn 的 logger 工厂；restore 必须调用（模块级工厂是全局状态） */
function captureWarns(): { warns: WarnCall[]; restore: () => void } {
  const warns: WarnCall[] = [];
  const logger: ILogger = {
    error: () => {},
    warn: (message, data) => { warns.push({ message, data }); },
    info: () => {},
    debug: () => {},
    verbose: () => {},
    child: () => logger,
  };
  registerChildLoggerFactory(() => logger);
  return { warns, restore: () => registerChildLoggerFactory(createSilentLogger) };
}

describe('resolveModelMetadata 静态表（M1-M2）', () => {
  it('M1: 静态表命中 deepseek-chat 返回 contextWindow/cost/compat', () => {
    const metadata = resolveModelMetadata('deepseek', 'deepseek-chat');

    expect(metadata?.contextWindow).toBe(65536);
    expect(metadata?.maxOutputTokens).toBe(8192);
    expect(metadata?.cost).toEqual({ input: 0.27, output: 1.1, cacheRead: 0.07 });
    expect(metadata?.compat?.promptCacheConvention).toBe('inclusive');
  });

  it('M1b: getBuiltinModelMetadata 按 provider+id 双键匹配，list 覆盖 D5 裁剪规模', () => {
    expect(getBuiltinModelMetadata('anthropic', 'claude-sonnet-4-5')?.cost?.cacheWrite).toBe(3.75);
    // 同名模型不同 provider 不命中（双键约束）
    expect(getBuiltinModelMetadata('openai', 'deepseek-chat')).toBeUndefined();
    // D5 拍板：手工静态表 20-30 条已知模型
    expect(listBuiltinModelMetadata().length).toBeGreaterThanOrEqual(20);
  });

  it('M2: 未知模型返回 undefined（禁止编造默认值）', () => {
    expect(resolveModelMetadata('openai', 'gpt-99-turbo')).toBeUndefined();
    expect(resolveModelMetadata('custom', 'my-private-model')).toBeUndefined();
    expect(getBuiltinModelMetadata('custom', 'anything')).toBeUndefined();
  });
});

describe('resolveModelMetadata DB override（M3-M4）', () => {
  it('M3: 部分覆盖——覆盖字段生效，其余回落静态表', () => {
    const metadata = resolveModelMetadata('deepseek', 'deepseek-chat', { contextWindow: 128000 });

    expect(metadata?.contextWindow).toBe(128000);   // 覆盖生效
    expect(metadata?.maxOutputTokens).toBe(8192);   // 回落静态表
    expect(metadata?.cost).toEqual({ input: 0.27, output: 1.1, cacheRead: 0.07 }); // 未触碰
  });

  it('M3b: 部分 cost 覆盖——字段级合并而非整体替换（input/output 回落静态表）', () => {
    const metadata = resolveModelMetadata('deepseek', 'deepseek-chat', { cost: { cacheRead: 0.05 } });

    expect(metadata?.cost?.input).toBe(0.27);
    expect(metadata?.cost?.output).toBe(1.1);
    expect(metadata?.cost?.cacheRead).toBe(0.05);
    expect(metadata?.cost?.cacheWrite).toBeUndefined();
  });

  it('M3c: 部分 compat 覆盖——扁平字段级合并，其余标志保留', () => {
    const metadata = resolveModelMetadata('deepseek', 'deepseek-chat', { compat: { supportsImages: true } });

    expect(metadata?.compat?.supportsImages).toBe(true);            // 新增
    expect(metadata?.compat?.supportsTools).toBe(true);             // 静态表保留
    expect(metadata?.compat?.promptCacheConvention).toBe('inclusive'); // 静态表保留
  });

  it('M3d: 未知模型 + dbOverride——以管理员显式声明构造（非编造）', () => {
    const metadata = resolveModelMetadata('custom', 'my-private-model', {
      contextWindow: 32000,
      cost: { input: 1, output: 2 },
    });

    expect(metadata?.id).toBe('my-private-model');
    expect(metadata?.provider).toBe('custom');
    expect(metadata?.contextWindow).toBe(32000);
    expect(metadata?.cost?.input).toBe(1);
    expect(metadata?.cost?.output).toBe(2);
  });

  it('M3e: 未知模型 + 不完整 cost 覆盖（仅 cacheRead）——不产出 cost（宁缺毋滥）', () => {
    const metadata = resolveModelMetadata('custom', 'my-private-model', { cost: { cacheRead: 0.01 } });

    expect(metadata?.cost).toBeUndefined();
  });

  it('M4: 非法值（负 contextWindow / 负价格 / 非对象 cost）——忽略该字段并 warn', () => {
    const { warns, restore } = captureWarns();
    try {
      const metadata = resolveModelMetadata('deepseek', 'deepseek-chat', {
        contextWindow: -100,
        cost: { input: -1 },
      });

      // 非法字段被忽略，回落静态表
      expect(metadata?.contextWindow).toBe(65536);
      expect(metadata?.cost?.input).toBe(0.27);

      const fields = warns.map(w => w.data?.field);
      expect(fields).toContain('contextWindow');
      expect(fields).toContain('cost.input');
      for (const w of warns) {
        expect(w.message).toBe('Ignoring invalid dbOverride field');
        expect(w.data?.provider).toBe('deepseek');
        expect(w.data?.modelId).toBe('deepseek-chat');
      }
    } finally {
      restore();
    }
  });

  it('M4b: 非对象 cost override 整体忽略并 warn，合法字段不受影响', () => {
    const { warns, restore } = captureWarns();
    try {
      // 真实路径：E 层 JSON.parse(extra_config) 后传入，类型在 JSON 边界失真，只能运行时校验
      const override = JSON.parse('{"contextWindow":128000,"cost":"not-an-object"}');
      const metadata = resolveModelMetadata('deepseek', 'deepseek-chat', override);

      expect(metadata?.contextWindow).toBe(128000); // 合法字段生效
      expect(metadata?.cost?.input).toBe(0.27);     // 非法 cost 忽略，回落静态表
      expect(warns.map(w => w.data?.field)).toContain('cost');
    } finally {
      restore();
    }
  });
});

describe('calculateCost（M5-M7）', () => {
  it('M5: 完整四维成本 + total（inclusive 口径，deepseek-chat）', () => {
    const metadata = getBuiltinModelMetadata('deepseek', 'deepseek-chat');
    if (!metadata) throw new Error('静态表应包含 deepseek-chat');

    const breakdown = calculateCost(metadata, {
      promptTokens: 1000,
      completionTokens: 500,
      promptCacheHitTokens: 200,
      promptCacheMissTokens: 800,
    });
    if (!breakdown) throw new Error('有 cost 元数据应产出 breakdown');

    // inclusive：计费输入 = promptTokens - hit = 800
    expect(breakdown.inputCost).toBeCloseTo((800 / 1e6) * 0.27, 12);
    expect(breakdown.outputCost).toBeCloseTo((500 / 1e6) * 1.1, 12);
    expect(breakdown.cacheReadCost).toBeCloseTo((200 / 1e6) * 0.07, 12);
    expect(breakdown.cacheWriteCost).toBe(0); // deepseek 无 cacheWrite 单价
    expect(breakdown.totalCost).toBeCloseTo(
      (800 / 1e6) * 0.27 + (500 / 1e6) * 1.1 + (200 / 1e6) * 0.07,
      12,
    );
  });

  it('M5b: exclusive 口径（anthropic claude-sonnet-4-5）——计费输入不扣 cache 命中', () => {
    const metadata = getBuiltinModelMetadata('anthropic', 'claude-sonnet-4-5');
    if (!metadata) throw new Error('静态表应包含 claude-sonnet-4-5');

    const breakdown = calculateCost(metadata, {
      promptTokens: 100,
      completionTokens: 50,
      promptCacheHitTokens: 1000,
      promptCacheMissTokens: 2000,
    });
    if (!breakdown) throw new Error('有 cost 元数据应产出 breakdown');

    // exclusive：计费输入 = promptTokens（input_tokens 本就不含 cache）
    expect(breakdown.inputCost).toBeCloseTo((100 / 1e6) * 3, 12);
    expect(breakdown.outputCost).toBeCloseTo((50 / 1e6) * 15, 12);
    expect(breakdown.cacheReadCost).toBeCloseTo((1000 / 1e6) * 0.3, 12);
    expect(breakdown.cacheWriteCost).toBeCloseTo((2000 / 1e6) * 3.75, 12);
    expect(breakdown.totalCost).toBeCloseTo(
      (100 / 1e6) * 3 + (50 / 1e6) * 15 + (1000 / 1e6) * 0.3 + (2000 / 1e6) * 3.75,
      12,
    );
  });

  it('M6: 无 cost 元数据返回 undefined 而非 0（禁止编造）', () => {
    const metadata = getBuiltinModelMetadata('glm', 'glm-4-plus');
    if (!metadata) throw new Error('静态表应包含 glm-4-plus');
    expect(metadata.cost).toBeUndefined();

    expect(calculateCost(metadata, { promptTokens: 1000, completionTokens: 500 })).toBeUndefined();
  });

  it('M7: cache 单价缺失时 cache 项按 0 计，total 正确', () => {
    const metadata: ModelMetadata = {
      id: 'synthetic',
      provider: 'custom',
      cost: { input: 1, output: 2 }, // 无 cacheRead/cacheWrite 单价
    };

    const breakdown = calculateCost(metadata, {
      promptTokens: 1000,
      completionTokens: 500,
      promptCacheHitTokens: 200,
      promptCacheMissTokens: 300,
    });
    if (!breakdown) throw new Error('有 cost 元数据应产出 breakdown');

    expect(breakdown.inputCost).toBeCloseTo((800 / 1e6) * 1, 12); // inclusive 缺省
    expect(breakdown.outputCost).toBeCloseTo((500 / 1e6) * 2, 12);
    expect(breakdown.cacheReadCost).toBe(0);
    expect(breakdown.cacheWriteCost).toBe(0);
    expect(breakdown.totalCost).toBeCloseTo((800 / 1e6) * 1 + (500 / 1e6) * 2, 12);
  });

  it('M7b: usage 全 0 返回全 0 breakdown（§6.8 合法边界）', () => {
    const metadata: ModelMetadata = {
      id: 'synthetic',
      provider: 'custom',
      cost: { input: 1, output: 2 },
    };

    const breakdown = calculateCost(metadata, { promptTokens: 0, completionTokens: 0 });

    expect(breakdown).toEqual({
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      totalCost: 0,
    });
  });

  it('M7c: inclusive 口径 hit > promptTokens 时计费输入钳制为 0（防御异常 usage）', () => {
    const metadata: ModelMetadata = {
      id: 'synthetic',
      provider: 'custom',
      cost: { input: 1, output: 2 },
    };

    const breakdown = calculateCost(metadata, {
      promptTokens: 100,
      completionTokens: 0,
      promptCacheHitTokens: 500,
    });
    if (!breakdown) throw new Error('有 cost 元数据应产出 breakdown');

    expect(breakdown.inputCost).toBe(0);
  });
});
