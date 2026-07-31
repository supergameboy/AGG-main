import { describe, expect, it, vi } from 'vitest';
import { EntityGraphService } from '../EntityGraphService.js';
import type {
  IEntityGraphRepository,
  IEntityGraphCache,
  IAwarenessRepository,
  IRelationshipRepository,
  EntityNode,
  EntityType,
  AwarenessSource,
  EntityAwarenessEvent,
  EntityAwarenessState,
  EntityEdge,
} from '../types.js';

/**
 * EntityGraphService.awareness-upgrade 集成测试。
 *
 * 设计文档 §3 测试用例大纲：
 *   - setAwareness delta 语义：连续调用 scoreDelta=+3, +5, -2 → currentScore=6
 *   - setAwareness clamp：currentScore=9 + delta=+5 → currentScore=10
 *   - setAwareness clamp：currentScore=-8 + delta=-5 → currentScore=-10
 *   - setAwareness source 结构化：source.type=informed_by 时 source.informerId 持久化
 *   - setAwareness 节点缺失：抛错（无 fallback）
 *   - getAwareness：返回 currentScore 而非 awarenessScore
 *   - getAwarenessHistory：返回全部事件（含压缩合并的）
 *   - getAwarenessBatch：批量查询多个 NPC 对玩家的认识
 *   - 压缩 R1-R4：覆盖所有规则的合并/不合并场景
 *
 * Mock 策略：
 *   - repository.getNode：返回构造的节点（模拟节点存在）
 *   - awarenessRepository.getLatestEvent：控制压缩判断分支
 *   - awarenessRepository.getState：控制 upsertState 前的 oldScore
 *   - awarenessRepository.insertEvent/mergeEvent/upsertState：记录调用参数
 *   - 通过多次调用 setAwareness 验证 delta 累加 + clamp + 压缩逻辑
 */

function createNode(saveId: string, type: EntityType, entityId: string): EntityNode {
  return {
    id: `egn_${type}_${saveId}_${entityId}`,
    saveId,
    entityType: type,
    entityId,
    label: `${type}-${entityId}`,
    properties: {},
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };
}

function createSource(overrides: Partial<AwarenessSource> = {}): AwarenessSource {
  return {
    type: 'direct_observation',
    occurredAt: 1700000000000,
    ...overrides,
  };
}

function createEvent(
  id: string,
  saveId: string,
  observerNodeId: string,
  targetNodeId: string,
  scoreDelta: number,
  source: AwarenessSource,
  mergedCount: number = 1,
  createdAt: number = 1700000000000,
): EntityAwarenessEvent {
  return {
    id, saveId, observerNodeId, targetNodeId,
    scoreDelta, source, mergedCount, createdAt,
  };
}

function createState(
  saveId: string,
  observerNodeId: string,
  targetNodeId: string,
  currentScore: number,
  effectiveSource: AwarenessSource,
  effectiveEventId: string,
): EntityAwarenessState {
  return {
    id: `ast_${saveId}_${observerNodeId}_${targetNodeId}`,
    saveId, observerNodeId, targetNodeId,
    currentScore,
    effectiveSource,
    effectiveEventId,
    lastUpdated: 1700000000000,
  };
}

function createMockRepository(getNodeResult: EntityNode | null = null): IEntityGraphRepository {
  return {
    getNode: vi.fn().mockResolvedValue(getNodeResult),
    deleteBySaveId: vi.fn().mockResolvedValue(undefined),
    upsertNode: vi.fn().mockResolvedValue('node-id'),
    getNodesByType: vi.fn().mockResolvedValue([]),
    getNodesByLocation: vi.fn().mockResolvedValue([]),
    findNodeByEntityIdOrLabel: vi.fn().mockResolvedValue(null),
    findNodesByLabel: vi.fn().mockResolvedValue([]),
    upsertEdge: vi.fn().mockResolvedValue('edge-id'),
    getEdges: vi.fn().mockResolvedValue([]),
    getEdgesByRelation: vi.fn().mockResolvedValue([]),
    findNodeIdByEntityIdOrLabel: vi.fn().mockResolvedValue(null),
    getSubgraph: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
    getFullGraph: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
    createSnapshot: vi.fn().mockResolvedValue('snapshot-id'),
    getSnapshot: vi.fn().mockResolvedValue(null),
    getLatestSnapshot: vi.fn().mockResolvedValue(null),
    getAllSnapshots: vi.fn().mockResolvedValue([]),
    getWorldStateSummary: vi.fn().mockResolvedValue({
      nodeCount: 0, edgeCount: 0, nodesByType: {}, edgesByRelation: {}, snapshotCount: 0,
    }),
    getPerceivesEdges: vi.fn().mockResolvedValue([]),
  } as unknown as IEntityGraphRepository;
}

function createMockCache(): IEntityGraphCache {
  return {
    get: vi.fn().mockReturnValue(null),
    set: vi.fn(),
    invalidate: vi.fn(),
    invalidateKey: vi.fn(),
    clear: vi.fn(),
    getStats: vi.fn().mockReturnValue({ size: 0, hitCount: 0, missCount: 0 }),
  } as unknown as IEntityGraphCache;
}

function createMockAwarenessRepository(): IAwarenessRepository & {
  _setLatestEvent: (e: EntityAwarenessEvent | null) => void;
  _setState: (s: EntityAwarenessState | null) => void;
  _setHistory: (h: EntityAwarenessEvent[]) => void;
  _setStatesBatch: (s: EntityAwarenessState[]) => void;
  _insertEventCalls: ReturnType<typeof vi.fn>;
  _mergeEventCalls: ReturnType<typeof vi.fn>;
  _upsertStateCalls: ReturnType<typeof vi.fn>;
} {
  let latestEvent: EntityAwarenessEvent | null = null;
  let state: EntityAwarenessState | null = null;
  let history: EntityAwarenessEvent[] = [];
  let statesBatch: EntityAwarenessState[] = [];

  const insertEventMock = vi.fn(async (
    saveId: string,
    observerNodeId: string,
    targetNodeId: string,
    scoreDelta: number,
    source: AwarenessSource,
  ) => {
    const id = `aev_${history.length + 1}`;
    const event = createEvent(id, saveId, observerNodeId, targetNodeId, scoreDelta, source, 1, source.occurredAt);
    latestEvent = event;
    history = [...history, event];
    return id;
  });

  const mergeEventMock = vi.fn(async (
    _saveId: string,
    eventId: string,
    incomingDelta: number,
    _incomingNote: string | undefined,
    incomingSource: AwarenessSource,
  ) => {
    if (latestEvent && latestEvent.id === eventId) {
      latestEvent = {
        ...latestEvent,
        scoreDelta: latestEvent.scoreDelta + incomingDelta,
        mergedCount: latestEvent.mergedCount + 1,
        createdAt: incomingSource.occurredAt,
      };
      history = history.map(e => e.id === eventId ? latestEvent! : e);
    }
  });

  const upsertStateMock = vi.fn(async (
    saveId: string,
    observerNodeId: string,
    targetNodeId: string,
    newScore: number,
    effectiveNote: string | undefined,
    effectiveSource: AwarenessSource,
    effectiveEventId: string,
  ) => {
    state = createState(saveId, observerNodeId, targetNodeId, newScore, effectiveSource, effectiveEventId);
    if (effectiveNote !== undefined) {
      state = { ...state, effectiveNote };
    }
  });

  return {
    insertEvent: insertEventMock,
    mergeEvent: mergeEventMock,
    upsertState: upsertStateMock,
    getLatestEvent: vi.fn(async () => latestEvent),
    getHistory: vi.fn(async () => [...history].sort((a, b) => a.createdAt - b.createdAt)),
    getState: vi.fn(async () => state),
    getStatesBatch: vi.fn(async () => statesBatch),
    countObserversByTargetAndScore: vi.fn(async () => 0),
    deleteBySaveId: vi.fn(async () => { state = null; history = []; latestEvent = null; }),
    _setLatestEvent: (e: EntityAwarenessEvent | null) => { latestEvent = e; },
    _setState: (s: EntityAwarenessState | null) => { state = s; },
    _setHistory: (h: EntityAwarenessEvent[]) => { history = h; if (h.length > 0) latestEvent = h[h.length - 1]; },
    _setStatesBatch: (s: EntityAwarenessState[]) => { statesBatch = s; },
    _insertEventCalls: insertEventMock,
    _mergeEventCalls: mergeEventMock,
    _upsertStateCalls: upsertStateMock,
  } as unknown as IAwarenessRepository & {
    _setLatestEvent: (e: EntityAwarenessEvent | null) => void;
    _setState: (s: EntityAwarenessState | null) => void;
    _setHistory: (h: EntityAwarenessEvent[]) => void;
    _setStatesBatch: (s: EntityAwarenessState[]) => void;
    _insertEventCalls: ReturnType<typeof vi.fn>;
    _mergeEventCalls: ReturnType<typeof vi.fn>;
    _upsertStateCalls: ReturnType<typeof vi.fn>;
  };
}

function createMockRelationshipRepository(): IRelationshipRepository {
  return {
    insertEvent: vi.fn().mockResolvedValue('rev_1'),
    mergeEvent: vi.fn().mockResolvedValue(undefined),
    upsertState: vi.fn().mockResolvedValue(undefined),
    getLatestEvent: vi.fn().mockResolvedValue(null),
    getHistory: vi.fn().mockResolvedValue([]),
    getState: vi.fn().mockResolvedValue(null),
    getStatesBatch: vi.fn().mockResolvedValue([]),
    countObserversByTargetAndScore: vi.fn().mockResolvedValue(0),
    deleteBySaveId: vi.fn().mockResolvedValue(undefined),
  } as unknown as IRelationshipRepository;
}

describe('EntityGraphService awareness-upgrade 集成测试', () => {
  const SAVE_ID = 'save-1';
  const OBSERVER_ID = 'npc-tom';
  const OBSERVER_TYPE: EntityType = 'npc';
  const TARGET_ID = 'player-1';
  const TARGET_TYPE: EntityType = 'character';

  function setupService(options?: { observerNode?: EntityNode | null; targetNode?: EntityNode | null }) {
    const observerNode = options?.observerNode ?? createNode(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID);
    const targetNode = options?.targetNode ?? createNode(SAVE_ID, TARGET_TYPE, TARGET_ID);

    const repository = createMockRepository(null);
    // 按 saveId+type+entityId 返回对应节点
    (repository.getNode as ReturnType<typeof vi.fn>).mockImplementation(
      (saveId: string, type: EntityType, entityId: string) => {
        if (saveId === SAVE_ID && type === OBSERVER_TYPE && entityId === OBSERVER_ID) {
          return Promise.resolve(observerNode);
        }
        if (saveId === SAVE_ID && type === TARGET_TYPE && entityId === TARGET_ID) {
          return Promise.resolve(targetNode);
        }
        return Promise.resolve(null);
      },
    );

    const awarenessRepository = createMockAwarenessRepository();
    const service = new EntityGraphService(
      repository,
      createMockCache(),
      awarenessRepository,
      createMockRelationshipRepository(),
      null,
      null,
    );

    return { service, repository, awarenessRepository, observerNode, targetNode };
  }

  describe('setAwareness delta 语义', () => {
    it('连续调用 scoreDelta=+3, +5, -2 → currentScore=6', async () => {
      const { service, awarenessRepository } = setupService();
      const source = createSource();

      // 第一次：+3，oldScore=0 → newScore=3
      await service.setAwareness(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID, TARGET_TYPE, TARGET_ID, 3, source);
      expect(awarenessRepository._upsertStateCalls).toHaveBeenCalledWith(
        SAVE_ID,
        `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
        `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
        3, // 0 + 3 = 3
        undefined,
        source,
        expect.any(String),
      );

      // 第二次：+5，oldScore=3 → newScore=8
      // 需要先设置 state 让 getState 返回 currentScore=3
      awarenessRepository._setState(createState(
        SAVE_ID,
        `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
        `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
        3, source, 'aev_1',
      ));
      await service.setAwareness(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID, TARGET_TYPE, TARGET_ID, 5, source);
      expect(awarenessRepository._upsertStateCalls).toHaveBeenCalledWith(
        SAVE_ID,
        `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
        `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
        8, // 3 + 5 = 8
        undefined,
        source,
        expect.any(String),
      );

      // 第三次：-2，oldScore=8 → newScore=6
      awarenessRepository._setState(createState(
        SAVE_ID,
        `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
        `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
        8, source, 'aev_2',
      ));
      await service.setAwareness(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID, TARGET_TYPE, TARGET_ID, -2, source);
      expect(awarenessRepository._upsertStateCalls).toHaveBeenCalledWith(
        SAVE_ID,
        `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
        `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
        6, // 8 - 2 = 6
        undefined,
        source,
        expect.any(String),
      );
    });
  });

  describe('setAwareness clamp 边界', () => {
    it('currentScore=9 + delta=+5 → currentScore=10（clamp 到上限）', async () => {
      const { service, awarenessRepository } = setupService();
      const source = createSource();

      // 设置 oldScore=9
      awarenessRepository._setState(createState(
        SAVE_ID,
        `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
        `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
        9, source, 'aev_1',
      ));

      await service.setAwareness(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID, TARGET_TYPE, TARGET_ID, 5, source);

      // 9 + 5 = 14，clamp 到 10
      expect(awarenessRepository._upsertStateCalls).toHaveBeenCalledWith(
        SAVE_ID,
        `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
        `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
        10, // clamp(9 + 5, -10, 10) = 10
        undefined,
        source,
        expect.any(String),
      );
    });

    it('currentScore=-8 + delta=-5 → currentScore=-10（clamp 到下限）', async () => {
      const { service, awarenessRepository } = setupService();
      const source = createSource();

      awarenessRepository._setState(createState(
        SAVE_ID,
        `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
        `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
        -8, source, 'aev_1',
      ));

      await service.setAwareness(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID, TARGET_TYPE, TARGET_ID, -5, source);

      // -8 - 5 = -13，clamp 到 -10
      expect(awarenessRepository._upsertStateCalls).toHaveBeenCalledWith(
        SAVE_ID,
        `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
        `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
        -10, // clamp(-8 - 5, -10, 10) = -10
        undefined,
        source,
        expect.any(String),
      );
    });
  });

  describe('setAwareness source 结构化', () => {
    it('source.type=informed_by 时 source.informerId 持久化', async () => {
      const { service, awarenessRepository } = setupService();
      const source = createSource({
        type: 'informed_by',
        informerType: 'npc',
        informerId: 'npc-edwin',
        topicType: 'quest',
        topicId: 'quest-main-1',
        note: '听村长说玩家来了',
      });

      await service.setAwareness(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID, TARGET_TYPE, TARGET_ID, 3, source, '听村长说');

      // 校验 insertEvent 收到完整 source 对象
      expect(awarenessRepository._insertEventCalls).toHaveBeenCalledWith(
        SAVE_ID,
        `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
        `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
        3,
        source,
        '听村长说',
      );
      // 校验 upsertState 收到完整 source 对象
      expect(awarenessRepository._upsertStateCalls).toHaveBeenCalledWith(
        SAVE_ID,
        `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
        `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
        3,
        '听村长说',
        source,
        expect.any(String),
      );
    });
  });

  describe('setAwareness 节点缺失', () => {
    it('observer 节点不存在时抛错（无 fallback）', async () => {
      const { service, repository } = setupService({ observerNode: null });
      (repository.getNode as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        service.setAwareness(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID, TARGET_TYPE, TARGET_ID, 1, createSource()),
      ).rejects.toThrow(/observer 节点不存在/);
    });

    it('target 节点不存在时抛错（无 fallback）', async () => {
      const { service, repository } = setupService();
      // observer 存在，target 不存在
      (repository.getNode as ReturnType<typeof vi.fn>).mockImplementation(
        (saveId: string, type: EntityType, entityId: string) => {
          if (type === OBSERVER_TYPE && entityId === OBSERVER_ID) {
            return Promise.resolve(createNode(saveId, type, entityId));
          }
          return Promise.resolve(null);
        },
      );

      await expect(
        service.setAwareness(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID, TARGET_TYPE, TARGET_ID, 1, createSource()),
      ).rejects.toThrow(/target 节点不存在/);
    });
  });

  describe('getAwareness', () => {
    it('返回 currentScore 字段（非 awarenessScore）', async () => {
      const { service, awarenessRepository } = setupService();
      const source = createSource({ type: 'informed_by', informerId: 'npc-edwin' });
      awarenessRepository._setState(createState(
        SAVE_ID,
        `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
        `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
        7, source, 'aev_1',
      ));

      const result = await service.getAwareness(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID, TARGET_TYPE, TARGET_ID);

      expect(result).not.toBeNull();
      // 关键校验：字段名是 currentScore（非 awarenessScore）
      expect(result).toHaveProperty('currentScore');
      expect(result).not.toHaveProperty('awarenessScore');
      expect(result!.currentScore).toBe(7);
      expect(result!.effectiveSource).toEqual(source);
      expect(result!.lastUpdated).toBe(1700000000000);
    });

    it('state 不存在时返回 null', async () => {
      const { service, awarenessRepository } = setupService();
      awarenessRepository._setState(null);

      const result = await service.getAwareness(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID, TARGET_TYPE, TARGET_ID);
      expect(result).toBeNull();
    });

    it('observer 节点不存在时返回 null', async () => {
      const { service, repository } = setupService({ observerNode: null });
      (repository.getNode as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await service.getAwareness(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID, TARGET_TYPE, TARGET_ID);
      expect(result).toBeNull();
    });
  });

  describe('getAwarenessHistory', () => {
    it('返回全部事件（含压缩合并的）', async () => {
      const { service, awarenessRepository } = setupService();
      const source1 = createSource({ occurredAt: 1700000001000 });
      const source2 = createSource({ type: 'auto:dialogue', occurredAt: 1700000002000 });
      // 模拟历史含合并事件（mergedCount=3）
      const mergedEvent = createEvent(
        'aev_1', SAVE_ID,
        `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
        `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
        5, source1, 3, 1700000001000, // mergedCount=3 表示已合并 3 次
      );
      const newEvent = createEvent(
        'aev_2', SAVE_ID,
        `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
        `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
        2, source2, 1, 1700000002000,
      );
      awarenessRepository._setHistory([mergedEvent, newEvent]);

      const history = await service.getAwarenessHistory(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID, TARGET_TYPE, TARGET_ID);

      expect(history).toHaveLength(2);
      expect(history[0].id).toBe('aev_1');
      expect(history[0].mergedCount).toBe(3); // 含压缩合并的事件
      expect(history[1].id).toBe('aev_2');
    });

    it('observer 节点不存在时返回空数组', async () => {
      const { service, repository } = setupService({ observerNode: null });
      (repository.getNode as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const history = await service.getAwarenessHistory(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID, TARGET_TYPE, TARGET_ID);
      expect(history).toEqual([]);
    });
  });

  describe('getAwarenessBatch', () => {
    it('批量查询多个 NPC 对玩家的认识', async () => {
      const npc1Id = 'npc-1';
      const npc2Id = 'npc-2';
      const npc3Id = 'npc-3';
      const npc1Node = createNode(SAVE_ID, 'npc', npc1Id);
      const npc2Node = createNode(SAVE_ID, 'npc', npc2Id);
      const npc3Node = createNode(SAVE_ID, 'npc', npc3Id);
      const targetNode = createNode(SAVE_ID, TARGET_TYPE, TARGET_ID);

      const { service, repository, awarenessRepository } = setupService({ observerNode: npc1Node, targetNode });
      // 每个 NPC 节点都存在
      (repository.getNode as ReturnType<typeof vi.fn>).mockImplementation(
        (saveId: string, type: EntityType, entityId: string) => {
          if (type === TARGET_TYPE && entityId === TARGET_ID) return Promise.resolve(targetNode);
          if (type === 'npc' && entityId === npc1Id) return Promise.resolve(npc1Node);
          if (type === 'npc' && entityId === npc2Id) return Promise.resolve(npc2Node);
          if (type === 'npc' && entityId === npc3Id) return Promise.resolve(npc3Node);
          return Promise.resolve(null);
        },
      );

      // mock getStatesBatch 返回 2 个 NPC 的 state（npc3 无 awareness）
      awarenessRepository._setStatesBatch([
        createState(SAVE_ID, npc1Node.id, targetNode.id, 5, createSource(), 'aev_1'),
        createState(SAVE_ID, npc2Node.id, targetNode.id, 3, createSource(), 'aev_2'),
      ]);

      const result = await service.getAwarenessBatch(SAVE_ID, 'npc', [npc1Id, npc2Id, npc3Id], TARGET_TYPE, TARGET_ID);

      // 返回 2 个有 awareness 的 NPC（npc3 无 state 被过滤）
      expect(result).toHaveLength(2);
      expect(result[0].observerId).toBe(npc1Id);
      expect(result[0].currentScore).toBe(5);
      expect(result[1].observerId).toBe(npc2Id);
      expect(result[1].currentScore).toBe(3);
    });

    it('target 节点不存在时返回空数组', async () => {
      const { service, repository } = setupService({ targetNode: null });
      (repository.getNode as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await service.getAwarenessBatch(SAVE_ID, 'npc', ['npc-1'], TARGET_TYPE, TARGET_ID);
      expect(result).toEqual([]);
    });

    it('observerIds 全部不存在时返回空数组', async () => {
      const { service, repository } = setupService();
      // 仅 target 存在，所有 observer 都不存在
      (repository.getNode as ReturnType<typeof vi.fn>).mockImplementation(
        (_saveId: string, type: EntityType, _entityId: string) => {
          if (type === TARGET_TYPE) return Promise.resolve(createNode(SAVE_ID, type, TARGET_ID));
          return Promise.resolve(null);
        },
      );

      const result = await service.getAwarenessBatch(SAVE_ID, 'npc', ['npc-x', 'npc-y'], TARGET_TYPE, TARGET_ID);
      expect(result).toEqual([]);
    });
  });

  describe('压缩 R1-R4 规则', () => {
    it('R1+R4：连续 auto:dialogue 事件 + 同符号 → 合并', async () => {
      const { service, awarenessRepository } = setupService();
      // 上一条事件是 auto:dialogue，符号为 +
      const lastEvent = createEvent(
        'aev_1', SAVE_ID,
        `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
        `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
        1, createSource({ type: 'auto:dialogue', occurredAt: 1700000001000 }),
        1, 1700000001000,
      );
      awarenessRepository._setLatestEvent(lastEvent);
      awarenessRepository._setState(null); // oldScore=0

      // 新事件也是 auto:dialogue，符号 +1
      const incomingSource = createSource({ type: 'auto:dialogue', occurredAt: 1700000002000 });
      await service.setAwareness(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID, TARGET_TYPE, TARGET_ID, 1, incomingSource);

      // 应调用 mergeEvent（非 insertEvent）
      expect(awarenessRepository._mergeEventCalls).toHaveBeenCalledWith(
        SAVE_ID, 'aev_1', 1, undefined, incomingSource,
      );
      expect(awarenessRepository._insertEventCalls).not.toHaveBeenCalled();
    });

    it('R1：不同 source.type → 不合并', async () => {
      const { service, awarenessRepository } = setupService();
      const lastEvent = createEvent(
        'aev_1', SAVE_ID,
        `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
        `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
        1, createSource({ type: 'auto:dialogue' }),
      );
      awarenessRepository._setLatestEvent(lastEvent);
      awarenessRepository._setState(null);

      // 新事件是 auto:combat（不同 source.type）
      const incomingSource = createSource({ type: 'auto:combat' });
      await service.setAwareness(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID, TARGET_TYPE, TARGET_ID, 3, incomingSource);

      expect(awarenessRepository._insertEventCalls).toHaveBeenCalled();
      expect(awarenessRepository._mergeEventCalls).not.toHaveBeenCalled();
    });

    it('R1：不同符号 → 不合并', async () => {
      const { service, awarenessRepository } = setupService();
      const lastEvent = createEvent(
        'aev_1', SAVE_ID,
        `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
        `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
        2, createSource({ type: 'auto:dialogue' }), // 正数
      );
      awarenessRepository._setLatestEvent(lastEvent);
      awarenessRepository._setState(null);

      // 新事件符号为负
      const incomingSource = createSource({ type: 'auto:dialogue' });
      await service.setAwareness(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID, TARGET_TYPE, TARGET_ID, -1, incomingSource);

      expect(awarenessRepository._insertEventCalls).toHaveBeenCalled();
      expect(awarenessRepository._mergeEventCalls).not.toHaveBeenCalled();
    });

    it('R2：delta 绝对值 >= 3 → 不合并（关键转折）', async () => {
      const { service, awarenessRepository } = setupService();
      const lastEvent = createEvent(
        'aev_1', SAVE_ID,
        `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
        `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
        1, createSource({ type: 'auto:dialogue' }),
      );
      awarenessRepository._setLatestEvent(lastEvent);
      awarenessRepository._setState(null);

      // delta=3，绝对值 >= 3，不合并
      const incomingSource = createSource({ type: 'auto:dialogue' });
      await service.setAwareness(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID, TARGET_TYPE, TARGET_ID, 3, incomingSource);

      expect(awarenessRepository._insertEventCalls).toHaveBeenCalled();
      expect(awarenessRepository._mergeEventCalls).not.toHaveBeenCalled();
    });

    it('R3：source.type=informed_by → 不合并（保留 informed_by）', async () => {
      const { service, awarenessRepository } = setupService();
      const lastEvent = createEvent(
        'aev_1', SAVE_ID,
        `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
        `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
        1, createSource({ type: 'informed_by', informerId: 'npc-edwin' }),
      );
      awarenessRepository._setLatestEvent(lastEvent);
      awarenessRepository._setState(null);

      // informed_by 不应被压缩（虽已通过 R4 排除，但显式校验 R3）
      const incomingSource = createSource({ type: 'informed_by', informerId: 'npc-edwin' });
      await service.setAwareness(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID, TARGET_TYPE, TARGET_ID, 1, incomingSource);

      expect(awarenessRepository._insertEventCalls).toHaveBeenCalled();
      expect(awarenessRepository._mergeEventCalls).not.toHaveBeenCalled();
    });

    it('R4：source.type 非 auto:xxx（GM 手动）→ 不合并', async () => {
      const { service, awarenessRepository } = setupService();
      const lastEvent = createEvent(
        'aev_1', SAVE_ID,
        `egn_${OBSERVER_TYPE}_${SAVE_ID}_${OBSERVER_ID}`,
        `egn_${TARGET_TYPE}_${SAVE_ID}_${TARGET_ID}`,
        1, createSource({ type: 'direct_observation' }), // 非 auto:xxx
      );
      awarenessRepository._setLatestEvent(lastEvent);
      awarenessRepository._setState(null);

      const incomingSource = createSource({ type: 'direct_observation' });
      await service.setAwareness(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID, TARGET_TYPE, TARGET_ID, 1, incomingSource);

      expect(awarenessRepository._insertEventCalls).toHaveBeenCalled();
      expect(awarenessRepository._mergeEventCalls).not.toHaveBeenCalled();
    });

    it('无上一条事件时 → 不合并（直接 insertEvent）', async () => {
      const { service, awarenessRepository } = setupService();
      awarenessRepository._setLatestEvent(null);
      awarenessRepository._setState(null);

      const incomingSource = createSource({ type: 'auto:dialogue' });
      await service.setAwareness(SAVE_ID, OBSERVER_TYPE, OBSERVER_ID, TARGET_TYPE, TARGET_ID, 1, incomingSource);

      expect(awarenessRepository._insertEventCalls).toHaveBeenCalled();
      expect(awarenessRepository._mergeEventCalls).not.toHaveBeenCalled();
    });
  });
});
