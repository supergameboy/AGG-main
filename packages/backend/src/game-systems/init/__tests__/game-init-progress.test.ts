/**
 * GameInitServiceTool P0 迁移测试（M6 §8.3）。
 *
 * 迁移内容（§7.7.1）：
 * - 阶段 onUpdate（check_existing → load_template → create_character → complete）
 * - 阶段边界 abort 检查点（各阶段开始前 throwIfAborted）
 *
 * 覆盖：
 * ① 各阶段 stage 字段按序出现
 * ② 阶段边界 abort → aborted 响应（error 含 reason 且 data/writeOperation 纯净）
 * ③ 角色已存在跳过路径仍上报进度
 * ④ 无 onUpdate/abortSignal 时行为与现状一致（零回归）
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerTimeoutConfig,
  registerToolEventEmitter,
} from '@ai-rpg/shared/tool-core';
import type { TimeoutConfig } from '@ai-rpg/shared/utils/timeout';
import type { ToolContext } from '@ai-rpg/shared/types/tool';
import type { ToolProgress } from '@ai-rpg/shared/tool-core';
import type { ToolType } from '@ai-rpg/shared/types/agent';
import { GameInitServiceTool } from '../GameInitServiceTool.js';
import type { GameInitService } from '../GameInitService.js';
import type { CharacterServiceTool } from '../../character/CharacterServiceTool.js';

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

const AGENT_TYPE = 'tester';
const SAVE_ID = 'save-gi-progress';

function buildContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    saveId: SAVE_ID,
    agentType: AGENT_TYPE,
    timestamp: Date.now(),
    templateId: 'tpl-test',
    requestScope: {
      getDb: () => {
        throw new Error('测试环境无 db');
      },
      getOrCompute: <T>(_key: string, factory: () => Promise<T>): Promise<T> => factory(),
    },
    ...overrides,
  };
}

/** 构造受控的 mock GameInitService，按场景返回指定值 */
function buildMockInitService(scenario: {
  hasCharacter?: string | null;
  getTemplateData?: Record<string, unknown>;
  step1Result?: Record<string, unknown>;
  step1DelayMs?: number;
}): GameInitService {
  return {
    hasCharacter: vi.fn().mockResolvedValue(scenario.hasCharacter ?? null),
    getTemplateData: vi.fn().mockResolvedValue(
      scenario.getTemplateData ?? {
        id: 'tpl-test',
        name: 'Test Template',
        character_creation: {
          attribute_points: 50,
          min_attribute: 5,
          max_attribute: 20,
        },
        starting_scene: { location: 'start' },
        initial_data: { gold: { default: 30 } },
        world_setting: {},
      },
    ),
    step1_initStats: vi.fn().mockImplementation(async () => {
      if (scenario.step1DelayMs && scenario.step1DelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, scenario.step1DelayMs));
      }
      return scenario.step1Result ?? { characterId: 'char-1', name: 'Hero' };
    }),
    isInitializationComplete: vi.fn().mockResolvedValue(false),
    getInitializationStatus: vi.fn().mockResolvedValue({
      isInitialized: false,
      character: false,
      counts: { locations: 0, npcs: 0, skills: 0, items: 0, quests: 0 },
      missing: ['character'],
    }),
  } as unknown as GameInitService;
}

describe('GameInitServiceTool — M6 P0 迁移（阶段进度 + abort）', () => {
  let tool: GameInitServiceTool;

  beforeEach(() => {
    registerTimeoutConfig(() => TEST_TIMEOUT_CONFIG);
    // 静默注册空 emitter，避免 BaseTool logger.debug 降级干扰断言
    registerToolEventEmitter(() => Promise.resolve());
    // CharacterServiceTool 仅构造注入存档（createInitService 被 mock 覆盖后不会触达）
    tool = new GameInitServiceTool({} as unknown as CharacterServiceTool);
    tool.setPermission({
      agentType: AGENT_TYPE,
      toolType: 'game_init_service' as ToolType,
      readAllowed: true,
      writeAllowed: true,
    });
  });

  it('① 各阶段 stage 字段按序出现（check_existing → load_template → create_character → complete）', async () => {
    const mockService = buildMockInitService({});
    (tool as unknown as { createInitService: (_ctx: ToolContext) => Promise<GameInitService> }).createInitService =
      vi.fn().mockResolvedValue(mockService);

    const frames: ToolProgress[] = [];
    const res = await tool.execute(
      'init_stats',
      {
        characterData: {
          name: 'Hero',
          gender: 'male',
          ageGroup: 'youth',
          race: 'human',
          classType: 'warrior',
          background: 'soldier',
          attributes: { str: 10, dex: 10 },
        },
      },
      buildContext({
        saveId: 'save-gi-stages',
        onUpdate: (p) => frames.push(p),
      }),
    );

    expect(res.success).toBe(true);
    const stages = frames.map((f) => f.stage);
    expect(stages).toEqual([
      'check_existing',
      'load_template',
      'create_character',
      'complete',
    ]);
    for (const frame of frames) {
      expect(frame.percent).toBeDefined();
    }
    expect(frames[0].percent).toBe(0);
    expect(frames[frames.length - 1].percent).toBe(100);
  });

  it('② 阶段边界 abort（load_template 前）→ aborted 响应纯净', async () => {
    const controller = new AbortController();
    const mockService = buildMockInitService({});
    // 幂等检查完成时触发取消——模拟初始化流程执行期间收到取消请求（确定性复现，非时序竞争）
    vi.mocked(mockService.hasCharacter).mockImplementation(async () => {
      controller.abort('用户取消初始化');
      return null;
    });
    (tool as unknown as { createInitService: (_ctx: ToolContext) => Promise<GameInitService> }).createInitService =
      vi.fn().mockResolvedValue(mockService);

    const frames: ToolProgress[] = [];
    const res = await tool.execute(
      'init_stats',
      {
        characterData: {
          name: 'Hero',
          gender: 'male',
          ageGroup: 'youth',
          race: 'human',
          classType: 'warrior',
          background: 'soldier',
          attributes: { str: 10, dex: 10 },
        },
      },
      buildContext({
        saveId: 'save-gi-abort',
        abortSignal: controller.signal,
        onUpdate: (p) => frames.push(p),
      }),
    );

    expect(res.success).toBe(false);
    expect(res.aborted).toBe(true);
    expect(res.error).toContain('用户取消初始化');
    // aborted 响应纯净：不携带部分完成数据，不携带 writeOperation
    expect(res.data).toBeUndefined();
    expect(res.writeOperation).toBeUndefined();
    // 阶段边界检查点（load_template 阶段开始前）命中：后续阶段未执行
    expect(mockService.hasCharacter).toHaveBeenCalledTimes(1);
    expect(mockService.getTemplateData).not.toHaveBeenCalled();
    expect(mockService.step1_initStats).not.toHaveBeenCalled();
    // 检查点先于帧上报——进度帧止于 check_existing，不报告未进入的阶段
    expect(frames.map((f) => f.stage)).toEqual(['check_existing']);
  });

  it('③ 角色已存在跳过路径仍上报进度且末帧 100%', async () => {
    const mockService = buildMockInitService({ hasCharacter: 'char-existing' });
    (tool as unknown as { createInitService: (_ctx: ToolContext) => Promise<GameInitService> }).createInitService =
      vi.fn().mockResolvedValue(mockService);

    const frames: ToolProgress[] = [];
    const res = await tool.execute(
      'init_stats',
      {},
      buildContext({
        saveId: 'save-gi-skip',
        onUpdate: (p) => frames.push(p),
      }),
    );

    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ action: 'skipped' });
    expect(frames.length).toBe(2);
    expect(frames[0].stage).toBe('check_existing');
    expect(frames[1].stage).toBe('complete');
    expect(frames[1].percent).toBe(100);
  });

  it('④ 无 onUpdate/abortSignal 时行为与现状一致（零回归）', async () => {
    const mockService = buildMockInitService({});
    (tool as unknown as { createInitService: (_ctx: ToolContext) => Promise<GameInitService> }).createInitService =
      vi.fn().mockResolvedValue(mockService);

    const res = await tool.execute(
      'init_stats',
      {
        characterData: {
          name: 'Hero',
          gender: 'male',
          ageGroup: 'youth',
          race: 'human',
          classType: 'warrior',
          background: 'soldier',
          attributes: { str: 10, dex: 10 },
        },
      },
      buildContext({ saveId: 'save-gi-legacy' }),
    );

    expect(res.success).toBe(true);
    expect(res.aborted).toBeUndefined();
    expect(mockService.hasCharacter).toHaveBeenCalledWith('save-gi-legacy');
  });
});
