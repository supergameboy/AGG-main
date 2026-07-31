import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventBus } from '@ai-rpg/shared/messaging';
import type { BusEvent, CombatEndData } from '@ai-rpg/shared/messaging';
import { AwarenessAutoSubscriber } from '../AwarenessAutoSubscriber.js';
import type { EntityGraphService } from '../EntityGraphService.js';
import type { AwarenessSource, EntityAwarenessEvent, EntityAwarenessState } from '../types.js';

/**
 * AwarenessAutoSubscriber 单元测试。
 *
 * 设计文档 §5 测试用例大纲：
 *   - dialogue 事件触发：自动 setAwareness(npc, player, delta=+1, source='auto:dialogue')
 *   - combat_end 事件触发：对每个 NPC 参与者 setAwareness(delta=+3, source='auto:combat')
 *   - 自动事件被压缩：连续 dialogue 事件合并为一条（merged_count 累加）
 *   - 自动事件与 GM 事件叠加：GM 后调用 setAwareness(delta=+5)，currentScore = 1 + 5 = 6
 *   - player 节点不存在：跳过（不抛错，记日志）
 *
 * Mock 策略：
 *   - 使用真实 EventBus 实例（不 mock），通过 emit 触发订阅器
 *   - mock EntityGraphService.setAwareness：记录调用参数 + 控制返回值/抛错
 *   - 通过 spy 验证 setAwareness 的参数（source.type、delta、entity 引用）
 */

function createSetAwarenessReturn(scoreDelta: number, source: AwarenessSource): {
  event: EntityAwarenessEvent;
  state: EntityAwarenessState;
} {
  const eventId = `aev_${Math.random().toString(36).slice(2)}`;
  return {
    event: {
      id: eventId,
      saveId: 'save-1',
      observerNodeId: 'egn_npc_save-1_npc-tom',
      targetNodeId: 'egn_character_save-1_player-1',
      scoreDelta,
      source,
      mergedCount: 1,
      createdAt: source.occurredAt ?? 1700000000000,
    },
    state: {
      id: 'ast_save-1_egn_npc_save-1_npc-tom_egn_character_save-1_player-1',
      saveId: 'save-1',
      observerNodeId: 'egn_npc_save-1_npc-tom',
      targetNodeId: 'egn_character_save-1_player-1',
      currentScore: scoreDelta,
      effectiveSource: source,
      effectiveEventId: eventId,
      lastUpdated: 1700000000000,
    },
  };
}

function createMockEntityGraphService(): EntityGraphService & {
  _setAwarenessCalls: ReturnType<typeof vi.fn>;
  _setThrowError: (err: Error | null) => void;
  _setReturnScore: (score: number) => void;
} {
  let throwError: Error | null = null;
  let returnScore = 1;

  const setAwarenessMock = vi.fn(async (
    _saveId: string,
    _observerType: string,
    _observerId: string,
    _targetType: string,
    _targetId: string,
    scoreDelta: number,
    source: AwarenessSource,
    _note?: string,
  ) => {
    if (throwError) throw throwError;
    return createSetAwarenessReturn(returnScore, source);
  });

  return {
    setAwareness: setAwarenessMock,
    _setAwarenessCalls: setAwarenessMock,
    _setThrowError: (err: Error | null) => { throwError = err; },
    _setReturnScore: (score: number) => { returnScore = score; },
  } as unknown as EntityGraphService & {
    _setAwarenessCalls: ReturnType<typeof vi.fn>;
    _setThrowError: (err: Error | null) => void;
    _setReturnScore: (score: number) => void;
  };
}

function createDialogueEvent(
  saveId: string,
  npcId: string | undefined,
  playerId: string | undefined,
  timestamp: number = 1700000000000,
): BusEvent {
  return {
    type: 'dialogue',
    saveId,
    data: { npcId, playerId },
    timestamp,
  };
}

function createCombatEndEvent(
  saveId: string,
  participants: CombatEndData['participants'],
  combatId: string = 'combat-1',
  result: CombatEndData['result'] = 'victory',
  timestamp: number = 1700000000000,
): BusEvent {
  return {
    type: 'combat_end',
    saveId,
    data: {
      saveId,
      combatId,
      result,
      participants,
      duration: 100,
    } as unknown as Record<string, unknown>,
    timestamp,
  };
}

describe('AwarenessAutoSubscriber 单元测试', () => {
  let eventBus: EventBus;
  let mockService: ReturnType<typeof createMockEntityGraphService>;
  let subscriber: AwarenessAutoSubscriber;

  beforeEach(() => {
    eventBus = new EventBus();
    mockService = createMockEntityGraphService();
    subscriber = new AwarenessAutoSubscriber(eventBus, mockService);
    subscriber.subscribe();
  });

  describe('dialogue 事件触发', () => {
    /**
     * 设计文档 §5 期望效果：
     *   - dialogue 事件 → setAwareness(saveId, 'npc', npcId, 'character', playerId, +1, source)
     *   - source = { type: 'auto:dialogue', occurredAt: event.timestamp }
     */
    it('dialogue 事件触发：自动 setAwareness(npc, player, delta=+1, source.type=auto:dialogue)', async () => {
      const event = createDialogueEvent('save-1', 'npc-tom', 'player-1', 1700000000000);

      await eventBus.emit('dialogue', event);

      expect(mockService._setAwarenessCalls).toHaveBeenCalledTimes(1);
      const args = mockService._setAwarenessCalls.mock.calls[0];
      expect(args[0]).toBe('save-1');              // saveId
      expect(args[1]).toBe('npc');                  // observerType
      expect(args[2]).toBe('npc-tom');              // observerId
      expect(args[3]).toBe('character');            // targetType
      expect(args[4]).toBe('player-1');             // targetId
      expect(args[5]).toBe(1);                      // scoreDelta
      expect(args[6]).toEqual({      // source
        type: 'auto:dialogue',
        occurredAt: 1700000000000,
      });
    });

    it('dialogue 事件 timestamp 透传到 source.occurredAt', async () => {
      const customTimestamp = 1700000099999;
      const event = createDialogueEvent('save-1', 'npc-tom', 'player-1', customTimestamp);

      await eventBus.emit('dialogue', event);

      const args = mockService._setAwarenessCalls.mock.calls[0];
      expect(args[6].occurredAt).toBe(customTimestamp);
    });

    it('dialogue awarenessNote 默认为"自动：对话发生"', async () => {
      const event = createDialogueEvent('save-1', 'npc-tom', 'player-1');

      await eventBus.emit('dialogue', event);

      const args = mockService._setAwarenessCalls.mock.calls[0];
      expect(args[7]).toBe('自动：对话发生');
    });
  });

  describe('combat_end 事件触发', () => {
    /**
     * 设计文档 §5 期望效果：
     *   - combat_end 事件 → 对每个 NPC 参与者 setAwareness(npc, player, +3, source='auto:combat')
     */
    it('combat_end 事件触发：对每个 NPC 参与者 setAwareness(delta=+3, source.type=auto:combat)', async () => {
      const participants: CombatEndData['participants'] = [
        { type: 'character', id: 'player-1', name: 'Hero' },
        { type: 'npc', id: 'npc-tom', name: 'Tom' },
        { type: 'npc', id: 'npc-jerry', name: 'Jerry' },
      ];
      const event = createCombatEndEvent('save-1', participants, 'combat-x', 'victory', 1700000000000);

      await eventBus.emit('combat_end', event);

      // 对每个 NPC 调用一次 setAwareness
      expect(mockService._setAwarenessCalls).toHaveBeenCalledTimes(2);

      const call1 = mockService._setAwarenessCalls.mock.calls[0];
      expect(call1[1]).toBe('npc');
      expect(call1[2]).toBe('npc-tom');
      expect(call1[3]).toBe('character');
      expect(call1[4]).toBe('player-1');
      expect(call1[5]).toBe(3);
      expect(call1[6]).toEqual({
        type: 'auto:combat',
        occurredAt: 1700000000000,
      });

      const call2 = mockService._setAwarenessCalls.mock.calls[1];
      expect(call2[2]).toBe('npc-jerry');
      expect(call2[5]).toBe(3);
    });

    it('combat_end 事件：仅 character 参与者作为 target，无 NPC 跳过', async () => {
      const participants: CombatEndData['participants'] = [
        { type: 'character', id: 'player-1', name: 'Hero' },
      ];
      const event = createCombatEndEvent('save-1', participants);

      await eventBus.emit('combat_end', event);

      expect(mockService._setAwarenessCalls).not.toHaveBeenCalled();
    });

    it('combat_end 事件：无 character 参与者跳过', async () => {
      const participants: CombatEndData['participants'] = [
        { type: 'npc', id: 'npc-tom', name: 'Tom' },
      ];
      const event = createCombatEndEvent('save-1', participants);

      await eventBus.emit('combat_end', event);

      expect(mockService._setAwarenessCalls).not.toHaveBeenCalled();
    });

    it('combat_end 事件：空 participants 数组跳过', async () => {
      const event = createCombatEndEvent('save-1', []);

      await eventBus.emit('combat_end', event);

      expect(mockService._setAwarenessCalls).not.toHaveBeenCalled();
    });

    it('combat_end 单个 NPC setAwareness 抛错不影响其他 NPC', async () => {
      // 让第一次调用抛错，第二次正常
      let callCount = 0;
      mockService._setAwarenessCalls.mockImplementation(async (
        _saveId: string,
        _observerType: string,
        observerId: string,
        _targetType: string,
        _targetId: string,
        _scoreDelta: number,
        source: AwarenessSource,
      ) => {
        callCount++;
        if (callCount === 1) {
          throw new Error(`node not found: ${observerId}`);
        }
        return createSetAwarenessReturn(3, source);
      });

      const participants: CombatEndData['participants'] = [
        { type: 'character', id: 'player-1' },
        { type: 'npc', id: 'npc-fail' },
        { type: 'npc', id: 'npc-ok' },
      ];
      const event = createCombatEndEvent('save-1', participants);

      // 不应抛错（单个 NPC 失败不应传播）
      await expect(eventBus.emit('combat_end', event)).resolves.not.toThrow();

      // 两个 NPC 都被尝试调用
      expect(mockService._setAwarenessCalls).toHaveBeenCalledTimes(2);
    });
  });

  describe('自动事件被压缩（R1-R4）', () => {
    /**
     * 设计文档 §5 期望效果：
     *   - 连续 dialogue 事件会被 EntityGraphService.isAwarenessCompressible 合并
     *   - merged_count 累加记录合并次数
     *
     * 验证方式：AwarenessAutoSubscriber 自身不做压缩判断，仅发出 auto:dialogue 事件。
     * 压缩在 EntityGraphService.setAwareness 内部完成（R1-R4 判断在 isAwarenessCompressible）。
     * 此测试验证：连续 dialogue 事件触发后，setAwareness 被调用 N 次（每次都是 delta=+1），
     * 压缩逻辑由 Service 层负责，Subscriber 层不感知压缩。
     */
    it('连续 3 次 dialogue 事件：Subscriber 调用 3 次 setAwareness（每次 delta=+1，source.type=auto:dialogue）', async () => {
      const event1 = createDialogueEvent('save-1', 'npc-tom', 'player-1', 1700000000000);
      const event2 = createDialogueEvent('save-1', 'npc-tom', 'player-1', 1700000001000);
      const event3 = createDialogueEvent('save-1', 'npc-tom', 'player-1', 1700000002000);

      await eventBus.emit('dialogue', event1);
      await eventBus.emit('dialogue', event2);
      await eventBus.emit('dialogue', event3);

      // Subscriber 侧：3 次独立调用 setAwareness（压缩由 Service 内部决定）
      expect(mockService._setAwarenessCalls).toHaveBeenCalledTimes(3);
      // 每次 delta 都是 +1
      for (const call of mockService._setAwarenessCalls.mock.calls) {
        expect(call[5]).toBe(1);
        expect(call[6].type).toBe('auto:dialogue');
      }
      // 每次 occurredAt 透传事件时间戳
      expect(mockService._setAwarenessCalls.mock.calls[0][6].occurredAt).toBe(1700000000000);
      expect(mockService._setAwarenessCalls.mock.calls[1][6].occurredAt).toBe(1700000001000);
      expect(mockService._setAwarenessCalls.mock.calls[2][6].occurredAt).toBe(1700000002000);
    });
  });

  describe('自动事件与 GM 事件叠加', () => {
    /**
     * 设计文档 §5 期望效果：
     *   - 自动事件与 GM 事件叠加：GM 后调用 setAwareness(delta=+5)，currentScore = 1 + 5 = 6
     *
     * 验证方式：Subscriber 发出 auto 事件后，外部（GM 路径）再次调用 setAwareness(delta=+5)，
     * 验证 GM 调用不被 Subscriber 拦截或污染，两次调用独立累加（由 Service 层负责）。
     * Subscriber 测试仅验证：auto 事件 delta=+1 已发出，GM 调用 delta=+5 独立传入。
     */
    it('auto dialogue +1 后 GM 调用 setAwareness(delta=+5)：两次调用独立透传', async () => {
      // 1. auto dialogue 事件触发 +1
      const event = createDialogueEvent('save-1', 'npc-tom', 'player-1');
      await eventBus.emit('dialogue', event);

      // 2. GM 路径直接调用 setAwareness(delta=+5)（不经 Subscriber，由 GM Agent 调用 EntityGraphService）
      await mockService.setAwareness(
        'save-1',
        'npc', 'npc-tom',
        'character', 'player-1',
        5,
        { type: 'informed_by', informerType: 'npc', informerId: 'npc-village-chief', occurredAt: 1700000005000 },
        '村长告知老汤姆',
      );

      // 验证：两次调用独立透传，Subscriber 不干预 GM 调用
      expect(mockService._setAwarenessCalls).toHaveBeenCalledTimes(2);

      // 第 1 次：auto dialogue +1
      const autoCall = mockService._setAwarenessCalls.mock.calls[0];
      expect(autoCall[5]).toBe(1);
      expect(autoCall[6].type).toBe('auto:dialogue');

      // 第 2 次：GM informed_by +5
      const gmCall = mockService._setAwarenessCalls.mock.calls[1];
      expect(gmCall[5]).toBe(5);
      expect(gmCall[6].type).toBe('informed_by');
      expect((gmCall[6] as AwarenessSource & { informerId: string }).informerId).toBe('npc-village-chief');
    });
  });

  describe('player 节点不存在/数据缺失', () => {
    /**
     * 设计文档 §5 期望效果：
     *   - player 节点不存在：跳过（不抛错，记日志）
     *
     * 实现方式（AwarenessAutoSubscriber.handleDialogue/handleCombatEnd）：
     *   - npcId/playerId 缺失（data 字段为空）→ 跳过 + warn 日志
     *   - setAwareness 抛错（如 player 节点不存在）→ 捕获 + warn 日志，不传播
     */
    it('dialogue 事件 npcId 缺失：跳过（不调用 setAwareness，不抛错）', async () => {
      const event = createDialogueEvent('save-1', undefined, 'player-1');

      await expect(eventBus.emit('dialogue', event)).resolves.not.toThrow();
      expect(mockService._setAwarenessCalls).not.toHaveBeenCalled();
    });

    it('dialogue 事件 playerId 缺失：跳过（不调用 setAwareness，不抛错）', async () => {
      const event = createDialogueEvent('save-1', 'npc-tom', undefined);

      await expect(eventBus.emit('dialogue', event)).resolves.not.toThrow();
      expect(mockService._setAwarenessCalls).not.toHaveBeenCalled();
    });

    it('dialogue setAwareness 抛错（player 节点不存在）：捕获错误，不传播到 emit 调用方', async () => {
      mockService._setThrowError(new Error('target node not found: player-1'));
      const event = createDialogueEvent('save-1', 'npc-tom', 'player-1');

      // emit 不应抛错（Subscriber 内部 try-catch 吞错）
      await expect(eventBus.emit('dialogue', event)).resolves.not.toThrow();
      // setAwareness 确实被调用了（只是抛错被捕获）
      expect(mockService._setAwarenessCalls).toHaveBeenCalledTimes(1);
    });

    it('combat_end setAwareness 全部 NPC 抛错：emit 不传播异常', async () => {
      mockService._setThrowError(new Error('observer node not found'));
      const participants: CombatEndData['participants'] = [
        { type: 'character', id: 'player-1' },
        { type: 'npc', id: 'npc-a' },
        { type: 'npc', id: 'npc-b' },
      ];
      const event = createCombatEndEvent('save-1', participants);

      await expect(eventBus.emit('combat_end', event)).resolves.not.toThrow();
      expect(mockService._setAwarenessCalls).toHaveBeenCalledTimes(2);
    });
  });
});
