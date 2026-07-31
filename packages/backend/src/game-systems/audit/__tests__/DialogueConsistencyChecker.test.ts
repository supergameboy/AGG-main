import { describe, expect, it, vi } from 'vitest';
import { DialogueConsistencyChecker } from '../DialogueConsistencyChecker.js';
import type { LLMService } from '@ai-rpg/ai';
import type { EntityGraphService } from '../entity-graph/EntityGraphService.js';
import type { EntityNode, EntityType, EntityAwarenessEvent, AwarenessSource } from '../entity-graph/types.js';
import type { AuditRequestForLLM, AuditFailure } from '../../../../shared/src/types/audit.js';
import type { AuditContext } from './ProgramChecker.js';

/**
 * DialogueConsistencyChecker 单元测试。
 *
 * 设计文档 §4 测试用例大纲：
 *   - 老汤姆场景：对话"听村长说" + history 无 informed_by 事件 → warning + suggestedFix
 *   - 老汤姆场景：对话"听村长说" + history 有 informed_by:村长 事件 → pass
 *   - 老汤姆场景：对话"看你这身打扮" + history 有 direct_observation 事件 → pass
 *   - 对话无信息源声明：跳过审核
 *   - LLM 失败时：返回低置信度 warning（非静默降级）
 *   - LLM 提取多个声明：每个声明独立查询 + 综合判断
 *
 * Mock 策略：
 *   - llmService.chat：mock 返回结构化 JSON（claims 数组 + synthesize failures）
 *   - entityGraphService.findNodeByNameOrId：返回构造的节点（模拟 name → entity_id 解析）
 *   - entityGraphService.getAwarenessHistory：返回构造的 history（模拟 awareness 变更事件）
 *
 * 老汤姆场景设计（设计文档 §3.2）：
 *   - 老汤姆（npc-tom）声称"听村长说玩家干了什么"
 *   - observer=老汤姆，target=玩家，informer=村长（npc-edwin）
 *   - history(老汤姆, 玩家) 无 informed_by:村长 事件 → warning
 */

function createNode(saveId: string, type: EntityType, entityId: string, label: string): EntityNode {
  return {
    id: `egn_${type}_${saveId}_${entityId}`,
    saveId,
    entityType: type,
    entityId,
    label,
    properties: {},
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };
}

function createEvent(
  id: string,
  saveId: string,
  observerNodeId: string,
  targetNodeId: string,
  scoreDelta: number,
  source: AwarenessSource,
  createdAt: number = 1700000000000,
): EntityAwarenessEvent {
  return {
    id, saveId, observerNodeId, targetNodeId,
    scoreDelta, source, mergedCount: 1, createdAt,
  };
}

function createMockEntityGraphService(): EntityGraphService & {
  _setNodeByName: (name: string, node: EntityNode | null) => void;
  _setHistoryByObserverTarget: (key: string, history: EntityAwarenessEvent[]) => void;
} {
  const nodeByName = new Map<string, EntityNode | null>();
  const historyByKey = new Map<string, EntityAwarenessEvent[]>();

  const service = {
    findNodeByNameOrId: vi.fn(async (saveId: string, type: EntityType, nameOrId: string) => {
      // 先按 entity_id 精确匹配（mock 简化：直接按 name 查）
      return nodeByName.get(nameOrId) ?? null;
    }),
    getAwarenessHistory: vi.fn(async (
      saveId: string,
      observerType: EntityType, observerId: string,
      targetType: EntityType, targetId: string,
    ) => {
      const key = `${observerId}:${targetId}`;
      return historyByKey.get(key) ?? [];
    }),
    _setNodeByName: (name: string, node: EntityNode | null) => { nodeByName.set(name, node); },
    _setHistoryByObserverTarget: (key: string, history: EntityAwarenessEvent[]) => { historyByKey.set(key, history); },
  };

  return service as unknown as EntityGraphService & {
    _setNodeByName: (name: string, node: EntityNode | null) => void;
    _setHistoryByObserverTarget: (key: string, history: EntityAwarenessEvent[]) => void;
  };
}

function createMockLLMService(): LLMService & {
  _setChatResponse: (response: { content: string }) => void;
  _setChatResponses: (responses: { content: string }[]) => void;
  _setChatThrow: (error: Error) => void;
} {
  let responses: { content: string }[] = [];
  let throwError: Error | null = null;
  let callIndex = 0;

  const service = {
    chat: vi.fn(async () => {
      if (throwError) throw throwError;
      const response = responses[callIndex] ?? { content: '[]' };
      callIndex++;
      return response;
    }),
    _setChatResponse: (response: { content: string }) => {
      responses = [response];
      callIndex = 0;
    },
    _setChatResponses: (newResponses: { content: string }[]) => {
      responses = newResponses;
      callIndex = 0;
    },
    _setChatThrow: (error: Error) => {
      throwError = error;
      callIndex = 0;
    },
  };

  return service as unknown as LLMService & {
    _setChatResponse: (response: { content: string }) => void;
    _setChatResponses: (responses: { content: string }[]) => void;
    _setChatThrow: (error: Error) => void;
  };
}

function createAuditRequest(output: string): AuditRequestForLLM {
  return {
    taskId: 'task-1',
    agentType: 'dialogue',
    toolName: 'dialogue_service',
    actualOutput: { output },
    expected: {},
  } as unknown as AuditRequestForLLM;
}

function createAuditContext(saveId: string): AuditContext {
  return { saveId } as unknown as AuditContext;
}

describe('DialogueConsistencyChecker', () => {
  const SAVE_ID = 'save-1';
  const OBSERVER_NAME = '老汤姆';
  const OBSERVER_ID = 'npc-tom';
  const OBSERVER_TYPE: EntityType = 'npc';
  const TARGET_NAME = '玩家';
  const TARGET_ID = 'player-1';
  const TARGET_TYPE: EntityType = 'character';
  const INFORMER_NAME = '村长艾德温';
  const INFORMER_ID = 'npc-edwin';
  const INFORMER_TYPE: EntityType = 'npc';

  function setupStandardNodes(egService: ReturnType<typeof createMockEntityGraphService>) {
    egService._setNodeByName(OBSERVER_NAME, createNode(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID, OBSERVER_NAME));
    egService._setNodeByName(TARGET_NAME, createNode(SAVE_ID, TARGET_TYPE, TARGET_ID, TARGET_NAME));
    egService._setNodeByName(INFORMER_NAME, createNode(SAVE_ID, INFORMER_TYPE, INFORMER_ID, INFORMER_NAME));
  }

  describe('老汤姆场景：对话"听村长说" + history 无 informed_by 事件 → warning + suggestedFix', () => {
    it('history 仅有 direct_observation 事件时，输出 warning 含 suggestedFix', async () => {
      const egService = createMockEntityGraphService();
      setupStandardNodes(egService);
      // history 只有 direct_observation，无 informed_by:村长 事件
      egService._setHistoryByObserverTarget(`${OBSERVER_ID}:${TARGET_ID}`, [
        createEvent('aev_1', SAVE_ID,
          `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
          `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
          1, { type: 'direct_observation', occurredAt: 1700000001000 }),
      ]);

      const llmService = createMockLLMService();
      // Step 1: 提取一个声明
      const claimsResponse = JSON.stringify([{
        observerName: OBSERVER_NAME,
        observerType: OBSERVER_TYPE,
        targetName: TARGET_NAME,
        targetType: TARGET_TYPE,
        informerName: INFORMER_NAME,
        informerType: INFORMER_TYPE,
        claimText: '听村长说玩家干了什么',
      }]);
      // Step 3: synthesize 返回 1 个 failure
      const synthesizeResponse = JSON.stringify([{
        dimension: 'dialogue_consistency',
        reason: '对话声明"听村长说玩家干了什么"缺少 awareness 依据',
        severity: 'warning',
        suggestedFix: `请调用 set_awareness(observerType=npc, observerId=${OBSERVER_NAME}, targetType=character, targetId=${TARGET_NAME}, scoreDelta=+1, sourceType=informed_by, informerType=npc, informerId=${INFORMER_NAME})`,
      }]);
      llmService._setChatResponses([
        { content: claimsResponse },
        { content: synthesizeResponse },
      ]);

      const checker = new DialogueConsistencyChecker(egService, llmService);
      const result = await checker.check(
        createAuditRequest('老汤姆说：听村长说玩家干了什么大事。'),
        createAuditContext(SAVE_ID),
        [], // _programFailures
      );

      expect(result).toHaveLength(1);
      expect(result[0].dimension).toBe('dialogue_consistency');
      expect(result[0].severity).toBe('warning');
      expect(result[0].suggestedFix).toContain('set_awareness');
      expect(result[0].suggestedFix).toContain('informed_by');
      expect(result[0].suggestedFix).toContain(INFORMER_NAME);
    });
  });

  describe('老汤姆场景：对话"听村长说" + history 有 informed_by:村长 事件 → pass', () => {
    it('history 含 informed_by:村长 事件时，LLM synthesize 返回空数组', async () => {
      const egService = createMockEntityGraphService();
      setupStandardNodes(egService);
      // history 含 informed_by:村长 事件
      egService._setHistoryByObserverTarget(`${OBSERVER_ID}:${TARGET_ID}`, [
        createEvent('aev_1', SAVE_ID,
          `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
          `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
          1, { type: 'direct_observation', occurredAt: 1700000001000 }),
        createEvent('aev_2', SAVE_ID,
          `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
          `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
          1, { type: 'informed_by', informerType: INFORMER_TYPE, informerId: INFORMER_ID, occurredAt: 1700000002000 }),
      ]);

      const llmService = createMockLLMService();
      llmService._setChatResponses([
        { content: JSON.stringify([{
          observerName: OBSERVER_NAME, observerType: OBSERVER_TYPE,
          targetName: TARGET_NAME, targetType: TARGET_TYPE,
          informerName: INFORMER_NAME, informerType: INFORMER_TYPE,
          claimText: '听村长说玩家干了什么',
        }]) },
        { content: '[]' }, // synthesize 返回空数组（pass）
      ]);

      const checker = new DialogueConsistencyChecker(egService, llmService);
      const result = await checker.check(
        createAuditRequest('老汤姆说：听村长说玩家干了什么大事。'),
        createAuditContext(SAVE_ID),
        [],
      );

      expect(result).toEqual([]);
    });
  });

  describe('老汤姆场景：对话"看你这身打扮" + history 有 direct_observation 事件 → pass', () => {
    it('对话无信息源声明（仅直接观察），LLM 返回空数组 → 跳过审核', async () => {
      const egService = createMockEntityGraphService();
      setupStandardNodes(egService);
      egService._setHistoryByObserverTarget(`${OBSERVER_ID}:${TARGET_ID}`, [
        createEvent('aev_1', SAVE_ID,
          `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
          `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
          1, { type: 'direct_observation', occurredAt: 1700000001000 }),
      ]);

      const llmService = createMockLLMService();
      // Step 1: 无信息源声明（直接观察），返回空数组
      llmService._setChatResponse({ content: '[]' });

      const checker = new DialogueConsistencyChecker(egService, llmService);
      const result = await checker.check(
        createAuditRequest('老汤姆说：看你这身打扮，是个冒险者吧？'),
        createAuditContext(SAVE_ID),
        [],
      );

      // 无声明 → 跳过审核，返回空数组
      expect(result).toEqual([]);
      // Step 2/3 不应被调用
      expect(llmService.chat).toHaveBeenCalledTimes(1);
    });
  });

  describe('对话无信息源声明：跳过审核', () => {
    it('LLM 提取空声明数组时，跳过审核返回空数组', async () => {
      const egService = createMockEntityGraphService();
      const llmService = createMockLLMService();
      llmService._setChatResponse({ content: '[]' });

      const checker = new DialogueConsistencyChecker(egService, llmService);
      const result = await checker.check(
        createAuditRequest('天气不错。'),
        createAuditContext(SAVE_ID),
        [],
      );

      expect(result).toEqual([]);
      // egService 不应被调用（无声明无需查询 history）
      expect(egService.findNodeByNameOrId).not.toHaveBeenCalled();
      expect(egService.getAwarenessHistory).not.toHaveBeenCalled();
    });

    it('对话内容为空时，跳过审核', async () => {
      const egService = createMockEntityGraphService();
      const llmService = createMockLLMService();

      const checker = new DialogueConsistencyChecker(egService, llmService);
      const result = await checker.check(
        createAuditRequest(''),
        createAuditContext(SAVE_ID),
        [],
      );

      expect(result).toEqual([]);
      // LLM 不应被调用
      expect(llmService.chat).not.toHaveBeenCalled();
    });

    it('对话内容仅空白时，跳过审核', async () => {
      const egService = createMockEntityGraphService();
      const llmService = createMockLLMService();

      const checker = new DialogueConsistencyChecker(egService, llmService);
      const result = await checker.check(
        createAuditRequest('   \n\t  '),
        createAuditContext(SAVE_ID),
        [],
      );

      expect(result).toEqual([]);
      expect(llmService.chat).not.toHaveBeenCalled();
    });
  });

  describe('LLM 失败时：返回低置信度 warning（非静默降级）', () => {
    it('Step 1 LLM 提取失败时，返回低置信度 warning', async () => {
      const egService = createMockEntityGraphService();
      const llmService = createMockLLMService();
      llmService._setChatThrow(new Error('LLM service unavailable'));

      const checker = new DialogueConsistencyChecker(egService, llmService);
      const result = await checker.check(
        createAuditRequest('老汤姆说：听村长说玩家干了什么。'),
        createAuditContext(SAVE_ID),
        [],
      );

      expect(result).toHaveLength(1);
      expect(result[0].dimension).toBe('dialogue_consistency');
      expect(result[0].severity).toBe('warning');
      expect(result[0].reason).toContain('低置信度');
      expect(result[0].reason).toContain('Step 1 提取声明失败');
      expect(result[0].suggestedFix).toContain('人工');
    });

    it('Step 3 LLM 综合判断失败 + 程序兜底有 failures → 返回程序兜底 failures', async () => {
      const egService = createMockEntityGraphService();
      setupStandardNodes(egService);
      // history 无 informed_by 事件 → 程序兜底会生成 failure
      egService._setHistoryByObserverTarget(`${OBSERVER_ID}:${TARGET_ID}`, []);

      const llmService = createMockLLMService();
      // Step 1 成功，Step 3 失败
      llmService._setChatResponses([
        { content: JSON.stringify([{
          observerName: OBSERVER_NAME, observerType: OBSERVER_TYPE,
          targetName: TARGET_NAME, targetType: TARGET_TYPE,
          informerName: INFORMER_NAME, informerType: INFORMER_TYPE,
          claimText: '听村长说',
        }]) },
      ]);
      // Step 3 抛错：通过让第二次 chat 调用抛错
      let callCount = 0;
      (llmService.chat as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { content: JSON.stringify([{
            observerName: OBSERVER_NAME, observerType: OBSERVER_TYPE,
            targetName: TARGET_NAME, targetType: TARGET_TYPE,
            informerName: INFORMER_NAME, informerType: INFORMER_TYPE,
            claimText: '听村长说',
          }]) };
        }
        throw new Error('Step 3 LLM unavailable');
      });

      const checker = new DialogueConsistencyChecker(egService, llmService);
      const result = await checker.check(
        createAuditRequest('老汤姆说：听村长说玩家干了什么。'),
        createAuditContext(SAVE_ID),
        [],
      );

      // 程序兜底应生成 1 个 failure
      expect(result).toHaveLength(1);
      expect(result[0].dimension).toBe('dialogue_consistency');
      expect(result[0].severity).toBe('warning');
      expect(result[0].suggestedFix).toContain('set_awareness');
    });

    it('Step 3 LLM 失败 + 程序兜底无 failures → 返回低置信度 warning（不静默降级为"通过"）', async () => {
      const egService = createMockEntityGraphService();
      setupStandardNodes(egService);
      // history 含 informed_by 事件 → 程序兜底不生成 failure
      egService._setHistoryByObserverTarget(`${OBSERVER_ID}:${TARGET_ID}`, [
        createEvent('aev_1', SAVE_ID,
          `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
          `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
          1, { type: 'informed_by', informerType: INFORMER_TYPE, informerId: INFORMER_ID, occurredAt: 1700000001000 }),
      ]);

      const llmService = createMockLLMService();
      let callCount = 0;
      (llmService.chat as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { content: JSON.stringify([{
            observerName: OBSERVER_NAME, observerType: OBSERVER_TYPE,
            targetName: TARGET_NAME, targetType: TARGET_TYPE,
            informerName: INFORMER_NAME, informerType: INFORMER_TYPE,
            claimText: '听村长说',
          }]) };
        }
        throw new Error('Step 3 LLM unavailable');
      });

      const checker = new DialogueConsistencyChecker(egService, llmService);
      const result = await checker.check(
        createAuditRequest('老汤姆说：听村长说玩家干了什么。'),
        createAuditContext(SAVE_ID),
        [],
      );

      // 程序兜底无 failures（有 informed_by 事件），返回低置信度 warning（非空数组）
      expect(result).toHaveLength(1);
      expect(result[0].dimension).toBe('dialogue_consistency');
      expect(result[0].severity).toBe('warning');
      expect(result[0].reason).toContain('低置信度');
      expect(result[0].reason).toContain('LLM 综合判断失败');
    });
  });

  describe('LLM 提取多个声明：每个声明独立查询 + 综合判断', () => {
    it('两个声明（一个有依据 + 一个无依据）→ 仅无依据的生成 warning', async () => {
      const egService = createMockEntityGraphService();
      // 第一个声明：老汤姆 听 村长 说 玩家（有依据）
      // 第二个声明：老汤姆 听 酒馆老板 说 玩家（无依据）
      const observerNode = createNode(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID, OBSERVER_NAME);
      const targetNode = createNode(SAVE_ID, TARGET_TYPE, TARGET_ID, TARGET_NAME);
      const informer1Node = createNode(SAVE_ID, INFORMER_TYPE, INFORMER_ID, INFORMER_NAME);
      const informer2Name = '酒馆老板鲍勃';
      const informer2Id = 'npc-bob';
      const informer2Node = createNode(SAVE_ID, INFORMER_TYPE, informer2Id, informer2Name);
      egService._setNodeByName(OBSERVER_NAME, observerNode);
      egService._setNodeByName(TARGET_NAME, targetNode);
      egService._setNodeByName(INFORMER_NAME, informer1Node);
      egService._setNodeByName(informer2Name, informer2Node);

      // history 含 informed_by:村长 事件，但无 informed_by:酒馆老板 事件
      egService._setHistoryByObserverTarget(`${OBSERVER_ID}:${TARGET_ID}`, [
        createEvent('aev_1', SAVE_ID,
          `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
          `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
          1, { type: 'informed_by', informerType: INFORMER_TYPE, informerId: INFORMER_ID, occurredAt: 1700000001000 }),
      ]);

      const llmService = createMockLLMService();
      // Step 1: 提取两个声明
      const claimsResponse = JSON.stringify([
        {
          observerName: OBSERVER_NAME, observerType: OBSERVER_TYPE,
          targetName: TARGET_NAME, targetType: TARGET_TYPE,
          informerName: INFORMER_NAME, informerType: INFORMER_TYPE,
          claimText: '听村长说',
        },
        {
          observerName: OBSERVER_NAME, observerType: OBSERVER_TYPE,
          targetName: TARGET_NAME, targetType: TARGET_TYPE,
          informerName: informer2Name, informerType: INFORMER_TYPE,
          claimText: '酒馆老板也提到过',
        },
      ]);
      // Step 3: 仅第二个声明生成 failure
      const synthesizeResponse = JSON.stringify([{
        dimension: 'dialogue_consistency',
        reason: '对话声明"酒馆老板也提到过"缺少 awareness 依据',
        severity: 'warning',
        suggestedFix: `请调用 set_awareness(...informerId=${informer2Name})`,
      }]);
      llmService._setChatResponses([
        { content: claimsResponse },
        { content: synthesizeResponse },
      ]);

      const checker = new DialogueConsistencyChecker(egService, llmService);
      const result = await checker.check(
        createAuditRequest('老汤姆说：听村长说玩家干了什么，酒馆老板也提到过。'),
        createAuditContext(SAVE_ID),
        [],
      );

      expect(result).toHaveLength(1);
      expect(result[0].reason).toContain('酒馆老板');
      // 校验：每个声明独立查询 history（两次 findNodeByNameOrId 调用解析 informer）
      expect(egService.findNodeByNameOrId).toHaveBeenCalledTimes(6); // 2 claims * 3 nodes per claim
    });

    it('节点不存在时标记 verified=false（不生成 failure）', async () => {
      const egService = createMockEntityGraphService();
      // 仅 observer 和 target 存在，informer 不存在
      egService._setNodeByName(OBSERVER_NAME, createNode(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID, OBSERVER_NAME));
      egService._setNodeByName(TARGET_NAME, createNode(SAVE_ID, TARGET_TYPE, TARGET_ID, TARGET_NAME));
      // informer 节点不设置（返回 null）

      const llmService = createMockLLMService();
      llmService._setChatResponses([
        { content: JSON.stringify([{
          observerName: OBSERVER_NAME, observerType: OBSERVER_TYPE,
          targetName: TARGET_NAME, targetType: TARGET_TYPE,
          informerName: INFORMER_NAME, informerType: INFORMER_TYPE,
          claimText: '听村长说',
        }]) },
        { content: '[]' }, // synthesize 返回空（无法验证不输出 failure）
      ]);

      const checker = new DialogueConsistencyChecker(egService, llmService);
      const result = await checker.check(
        createAuditRequest('老汤姆说：听村长说玩家干了什么。'),
        createAuditContext(SAVE_ID),
        [],
      );

      // 无法验证（informer 节点不存在）→ 不输出 failure
      expect(result).toEqual([]);
    });
  });
});
