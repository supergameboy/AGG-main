/**
 * BatchQueryServiceTool P0 迁移测试（M6 §8.3）。
 *
 * 迁移内容（§7.7.1）：
 * - 批量循环 abort 检查点（每项发起前 + 子工具执行后）
 * - per-item onUpdate 进度（完成计数推进，并发下观测序列单调递增）
 *
 * 覆盖：
 * ① 20 项批量执行期间 onUpdate 被调用 ≥2 次且 percent 单调递增（末帧 100）
 * ② 第 5 项执行期间 abort → 整体返回 aborted 响应且不聚合部分数据
 *    （并发模式语义：所有在途项的检查点命中后统一冒泡；
 *      BatchQuery 为只读工具无 staging 写入，staging 无残留断言不适用，
 *      改断言 aborted 响应纯净——无 data / 无 writeOperation）
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { BaseTool, registerTimeoutConfig } from '@ai-rpg/shared/tool-core';
import type { TimeoutConfig } from '@ai-rpg/shared/utils/timeout';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import type { ToolProgress } from '@ai-rpg/shared/tool-core';
import type { ToolType } from '@ai-rpg/shared/types/agent';
import type { IToolRegistry } from '@ai-rpg/shared';
import { BatchQueryServiceTool } from '../BatchQueryServiceTool.js';

const TEST_TIMEOUT_CONFIG: TimeoutConfig = {
  chat: 1000,
  directMessage: 1000,
  llmProvider: 1000,
  agentProcessing: 1000,
  dagNode: 1000,
  toolExecution: 5000,
  reactIteration: 1000,
  reactMaxTokens: 1000,
  wsHeartbeat: 1000,
  wsMaxMissedHeartbeats: 3,
};

const SUB_TOOL_TYPE = 'fake_batch_query_target' as ToolType;
const AGENT_TYPE = 'tester';

/**
 * 批量查询目标子工具（真实 BaseTool 派生，保留基类入口 abort 检查行为）。
 *
 * handler 经 setTimeout 让出宏任务，模拟真实 DB 查询的异步边界，
 * 使"执行期间 abort"可被确定性地复现（不依赖时序竞争）。
 */
class FakeQueryTargetTool extends BaseTool {
  /** handler 实际执行次数（业务副作用证据） */
  public handlerCalls = 0;

  constructor(
    private readonly options?: {
      /** 第 N 次 handler 调用时触发（1 起计），用于模拟执行中取消 */
      abortOnCall?: number;
      abort?: () => void;
    },
  ) {
    super(SUB_TOOL_TYPE, 'Fake Query Target', 'M6 batch query migration test target');
    this.registerMethod({
      name: 'get_detail',
      description: 'read detail',
      parameters: {},
      isWrite: false,
      cacheable: false,
      handler: async (params: Record<string, unknown>): Promise<ToolResponse> => {
        this.handlerCalls++;
        if (this.options?.abortOnCall === this.handlerCalls) {
          this.options.abort?.();
        }
        // 让出宏任务：模拟真实异步 I/O 边界，使在途项在 abort 后才恢复
        await new Promise((resolve) => setTimeout(resolve, 0));
        return { success: true, data: { id: params.id } };
      },
    });
    this.setPermission({
      agentType: AGENT_TYPE,
      toolType: SUB_TOOL_TYPE,
      readAllowed: true,
      writeAllowed: false,
    });
  }
}

function buildRegistry(tool: BaseTool): IToolRegistry {
  return {
    getTool: (type: ToolType) => (type === SUB_TOOL_TYPE ? tool : undefined),
  };
}

function buildContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    saveId: 'save-bq-progress',
    agentType: AGENT_TYPE,
    timestamp: Date.now(),
    requestScope: {
      getDb: () => {
        throw new Error('测试环境无 db');
      },
      getOrCompute: <T>(_key: string, factory: () => Promise<T>): Promise<T> => factory(),
    },
    ...overrides,
  };
}

/** 构造 N 项展开查询：2 个 query 各携带 N/2 个 params（≤10 上限针对 query 数而非展开数） */
function buildQueries(expandedCount: number): Array<{ source: string; method: string; params: Array<{ id: number }> }> {
  const half = expandedCount / 2;
  const makeParams = (offset: number) =>
    Array.from({ length: half }, (_, i) => ({ id: offset + i }));
  return [
    { source: SUB_TOOL_TYPE, method: 'get_detail', params: makeParams(0) },
    { source: SUB_TOOL_TYPE, method: 'get_detail', params: makeParams(half) },
  ];
}

describe('BatchQueryServiceTool — M6 P0 迁移（进度 + abort）', () => {
  let tool: BatchQueryServiceTool;

  beforeEach(() => {
    registerTimeoutConfig(() => TEST_TIMEOUT_CONFIG);
    tool = new BatchQueryServiceTool();
    tool.setPermission({
      agentType: AGENT_TYPE,
      toolType: 'batch_query_service' as ToolType,
      readAllowed: true,
      writeAllowed: true,
    });
  });

  it('① 20 项批量执行期间 onUpdate ≥2 次且 percent 单调递增（末帧 100）', async () => {
    const subTool = new FakeQueryTargetTool();
    tool.setToolRegistry(buildRegistry(subTool));

    const frames: ToolProgress[] = [];
    const res = await tool.execute(
      'query',
      { queries: buildQueries(20) },
      buildContext({ onUpdate: (p) => frames.push(p) }),
    );

    expect(res.success).toBe(true);
    expect(subTool.handlerCalls).toBe(20);
    // 同方法多次查询结果合并为数组（20 项）
    const data = res.data as { results: Record<string, unknown[]> };
    expect(data.results[`${SUB_TOOL_TYPE}.get_detail`]).toHaveLength(20);

    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames).toHaveLength(20);
    const percents = frames.map((f) => f.percent ?? -1);
    const sorted = [...percents].sort((a, b) => a - b);
    expect(percents).toEqual(sorted); // 单调递增（完成计数推进，并发下仍单调）
    expect(percents[percents.length - 1]).toBe(100);
    for (const frame of frames) {
      expect(frame.stage).toBe('batch_process');
      expect(frame.message).toMatch(/^批量查询中：已处理 \d+\/20 项$/);
    }
  });

  it('② 第 5 项执行期间 abort → 整体 aborted 响应且不聚合部分数据', async () => {
    const controller = new AbortController();
    const subTool = new FakeQueryTargetTool({
      abortOnCall: 5,
      abort: () => controller.abort('用户取消批量查询'),
    });
    tool.setToolRegistry(buildRegistry(subTool));

    const frames: ToolProgress[] = [];
    const res = await tool.execute(
      'query',
      { queries: buildQueries(20) },
      buildContext({
        saveId: 'save-bq-abort',
        abortSignal: controller.signal,
        onUpdate: (p) => frames.push(p),
      }),
    );

    expect(res.success).toBe(false);
    expect(res.aborted).toBe(true);
    expect(res.error).toContain('用户取消批量查询');
    // aborted 响应纯净：不携带部分完成数据，不携带 writeOperation
    expect(res.data).toBeUndefined();
    expect(res.writeOperation).toBeUndefined();
    // 并发模式语义：全部 20 项在 abort 前已在途（检查点①均先于 abort 通过），
    // abort 后各在途项经检查点②统一冒泡——不保证中断已发起项，保证结果按取消语义上报
    expect(subTool.handlerCalls).toBe(20);
  });

  it('③ 回归：单项查询不上报进度（total=1 无中间态）', async () => {
    const subTool = new FakeQueryTargetTool();
    tool.setToolRegistry(buildRegistry(subTool));

    const frames: ToolProgress[] = [];
    const res = await tool.execute(
      'query',
      { queries: [{ source: SUB_TOOL_TYPE, method: 'get_detail', params: { id: 1 } }] },
      buildContext({ saveId: 'save-bq-single', onUpdate: (p) => frames.push(p) }),
    );

    expect(res.success).toBe(true);
    expect(frames).toHaveLength(0);
  });

  it('④ 回归：无 onUpdate/abortSignal 时行为与现状一致（未迁移调用方零影响）', async () => {
    const subTool = new FakeQueryTargetTool();
    tool.setToolRegistry(buildRegistry(subTool));

    const res = await tool.execute(
      'query',
      { queries: buildQueries(4) },
      buildContext({ saveId: 'save-bq-legacy' }),
    );

    expect(res.success).toBe(true);
    expect(res.aborted).toBeUndefined();
    expect(subTool.handlerCalls).toBe(4);
  });
});
