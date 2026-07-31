import { describe, expect, it, vi } from 'vitest';
import { EntityGraphService } from '../EntityGraphService.js';
import type {
  IEntityGraphRepository,
  IEntityGraphCache,
  IAwarenessRepository,
  IRelationshipRepository,
  EntityNode,
  EntityType,
} from '../types.js';

/**
 * EntityGraphService.countAwarenessByTopic 单元测试。
 *
 * 设计文档 §8 测试用例大纲：
 *   - 无 NPC 对 quest 有 awareness → 返回 0
 *   - 1 个 NPC 对 quest 有 awareness（currentScore=5）→ 返回 1
 *   - 3 个 NPC 对 quest 有 awareness（currentScore 均 ≥ 1）→ 返回 3
 *   - NPC 的 currentScore = 0 → 不计入（minScore=1）
 *   - NPC 的 currentScore = -5（负数）→ 不计入
 *   - quest 节点不存在 → 返回 0（不抛错）
 *   - 不同 saveId 隔离：saveA 的 NPC 计数不包含 saveB 的 NPC
 *
 * Mock 策略：
 *   - repository.getNode：返回构造的 EntityNode（用于 tryGetNodeId 解析 topicNodeId）
 *   - awarenessRepository.countObserversByTargetAndScore：mock 返回值
 *   - 验证 Service 层正确传参（saveId、topicNodeId、minScore:1）
 *
 * 注意：
 *   - currentScore >= minScore 过滤由 Repository 层 SQL WHERE 实现
 *   - Service 层只负责调用 Repository 并返回数字，不处理 currentScore 过滤
 *   - 测试通过 mock Repository 返回值模拟各种 currentScore 场景
 */

function createMockRepository(topicNode?: EntityNode | null): IEntityGraphRepository {
  return {
    getNode: vi.fn().mockResolvedValue(topicNode ?? null),
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
      nodeCount: 0,
      edgeCount: 0,
      nodesByType: {},
      edgesByRelation: {},
      snapshotCount: 0,
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

function createMockAwarenessRepository(
  countResult: number = 0,
): IAwarenessRepository {
  return {
    insertEvent: vi.fn().mockResolvedValue('event-id'),
    mergeEvent: vi.fn().mockResolvedValue(undefined),
    upsertState: vi.fn().mockResolvedValue(undefined),
    getLatestEvent: vi.fn().mockResolvedValue(null),
    getHistory: vi.fn().mockResolvedValue([]),
    getState: vi.fn().mockResolvedValue(null),
    getStatesBatch: vi.fn().mockResolvedValue([]),
    countObserversByTargetAndScore: vi.fn().mockResolvedValue(countResult),
    deleteBySaveId: vi.fn().mockResolvedValue(undefined),
  } as unknown as IAwarenessRepository;
}

function createMockRelationshipRepository(): IRelationshipRepository {
  return {
    insertEvent: vi.fn().mockResolvedValue('event-id'),
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

function createTopicNode(saveId: string, entityId: string): EntityNode {
  return {
    id: `egn_quest_${saveId}_${entityId}`,
    saveId,
    entityType: 'quest',
    entityId,
    label: `Quest ${entityId}`,
    properties: {},
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };
}

describe('EntityGraphService.countAwarenessByTopic', () => {
  const SAVE_ID = 'save-A';
  const TOPIC_TYPE: EntityType = 'quest';
  const TOPIC_ID = 'quest-main-shadow-forest';
  const TOPIC_NODE_ID = `egn_quest_${SAVE_ID}_${TOPIC_ID}`;

  it('无 NPC 对 quest 有 awareness 时返回 0', async () => {
    const topicNode = createTopicNode(SAVE_ID, TOPIC_ID);
    const repository = createMockRepository(topicNode);
    const awarenessRepository = createMockAwarenessRepository(0);
    const service = new EntityGraphService(
      repository,
      createMockCache(),
      awarenessRepository,
      createMockRelationshipRepository(),
      null,
      null,
    );

    const result = await service.countAwarenessByTopic(SAVE_ID, TOPIC_TYPE, TOPIC_ID);

    expect(result).toBe(0);
    expect(repository.getNode).toHaveBeenCalledWith(SAVE_ID, TOPIC_TYPE, TOPIC_ID);
    expect(awarenessRepository.countObserversByTargetAndScore).toHaveBeenCalledWith(
      SAVE_ID,
      TOPIC_NODE_ID,
      { minScore: 1 },
    );
  });

  it('1 个 NPC 对 quest 有 awareness（currentScore=5）时返回 1', async () => {
    const topicNode = createTopicNode(SAVE_ID, TOPIC_ID);
    const repository = createMockRepository(topicNode);
    const awarenessRepository = createMockAwarenessRepository(1);
    const service = new EntityGraphService(
      repository,
      createMockCache(),
      awarenessRepository,
      createMockRelationshipRepository(),
      null,
      null,
    );

    const result = await service.countAwarenessByTopic(SAVE_ID, TOPIC_TYPE, TOPIC_ID);

    expect(result).toBe(1);
    expect(awarenessRepository.countObserversByTargetAndScore).toHaveBeenCalledWith(
      SAVE_ID,
      TOPIC_NODE_ID,
      { minScore: 1 },
    );
  });

  it('3 个 NPC 对 quest 有 awareness（currentScore 均 ≥ 1）时返回 3', async () => {
    const topicNode = createTopicNode(SAVE_ID, TOPIC_ID);
    const repository = createMockRepository(topicNode);
    const awarenessRepository = createMockAwarenessRepository(3);
    const service = new EntityGraphService(
      repository,
      createMockCache(),
      awarenessRepository,
      createMockRelationshipRepository(),
      null,
      null,
    );

    const result = await service.countAwarenessByTopic(SAVE_ID, TOPIC_TYPE, TOPIC_ID);

    expect(result).toBe(3);
  });

  it('NPC 的 currentScore = 0 不计入（minScore=1 传参校验）', async () => {
    // Repository 层负责 current_score >= 1 过滤，Service 层仅传 minScore:1
    // 此场景 mock Repository 返回 0（模拟 SQL 过滤掉 currentScore=0 的记录）
    const topicNode = createTopicNode(SAVE_ID, TOPIC_ID);
    const repository = createMockRepository(topicNode);
    const awarenessRepository = createMockAwarenessRepository(0);
    const service = new EntityGraphService(
      repository,
      createMockCache(),
      awarenessRepository,
      createMockRelationshipRepository(),
      null,
      null,
    );

    const result = await service.countAwarenessByTopic(SAVE_ID, TOPIC_TYPE, TOPIC_ID);

    expect(result).toBe(0);
    // 关键校验：Service 必须传 minScore:1，Repository 据此过滤
    expect(awarenessRepository.countObserversByTargetAndScore).toHaveBeenCalledWith(
      SAVE_ID,
      TOPIC_NODE_ID,
      { minScore: 1 },
    );
  });

  it('NPC 的 currentScore = -5（负数）不计入（minScore=1 过滤）', async () => {
    // Repository 层 SQL WHERE current_score >= 1 会过滤掉负数
    // 此场景 mock Repository 返回 0（模拟 SQL 过滤掉 currentScore=-5 的记录）
    const topicNode = createTopicNode(SAVE_ID, TOPIC_ID);
    const repository = createMockRepository(topicNode);
    const awarenessRepository = createMockAwarenessRepository(0);
    const service = new EntityGraphService(
      repository,
      createMockCache(),
      awarenessRepository,
      createMockRelationshipRepository(),
      null,
      null,
    );

    const result = await service.countAwarenessByTopic(SAVE_ID, TOPIC_TYPE, TOPIC_ID);

    expect(result).toBe(0);
    expect(awarenessRepository.countObserversByTargetAndScore).toHaveBeenCalledWith(
      SAVE_ID,
      TOPIC_NODE_ID,
      { minScore: 1 },
    );
  });

  it('quest 节点不存在时返回 0（不抛错）', async () => {
    // repository.getNode 返回 null（节点不存在）
    const repository = createMockRepository(null);
    const awarenessRepository = createMockAwarenessRepository(99);
    const service = new EntityGraphService(
      repository,
      createMockCache(),
      awarenessRepository,
      createMockRelationshipRepository(),
      null,
      null,
    );

    const result = await service.countAwarenessByTopic(SAVE_ID, TOPIC_TYPE, TOPIC_ID);

    expect(result).toBe(0);
    expect(repository.getNode).toHaveBeenCalledWith(SAVE_ID, TOPIC_TYPE, TOPIC_ID);
    // 关键校验：节点不存在时不调用 countObserversByTargetAndScore（短路返回 0）
    expect(awarenessRepository.countObserversByTargetAndScore).not.toHaveBeenCalled();
  });

  it('不同 saveId 隔离：saveA 的 NPC 计数不包含 saveB 的 NPC', async () => {
    const saveA = 'save-A';
    const saveB = 'save-B';
    const topicNodeA = createTopicNode(saveA, TOPIC_ID);
    const topicNodeB = createTopicNode(saveB, TOPIC_ID);

    // 同一 Service 实例，repository.getNode 按 saveId 区分返回不同节点
    const repository = createMockRepository(topicNodeA);
    (repository.getNode as ReturnType<typeof vi.fn>).mockImplementation(
      (saveId: string, _type: EntityType, _entityId: string) => {
        if (saveId === saveA) return Promise.resolve(topicNodeA);
        if (saveId === saveB) return Promise.resolve(topicNodeB);
        return Promise.resolve(null);
      },
    );

    // awarenessRepository 按 saveId 区分返回不同计数
    const awarenessRepository = createMockAwarenessRepository(0);
    (awarenessRepository.countObserversByTargetAndScore as ReturnType<typeof vi.fn>).mockImplementation(
      (saveId: string, _targetNodeId: string, _options: { minScore: number }) => {
        if (saveId === saveA) return Promise.resolve(2); // saveA 有 2 个 NPC aware
        if (saveId === saveB) return Promise.resolve(5); // saveB 有 5 个 NPC aware
        return Promise.resolve(0);
      },
    );

    const service = new EntityGraphService(
      repository,
      createMockCache(),
      awarenessRepository,
      createMockRelationshipRepository(),
      null,
      null,
    );

    const resultA = await service.countAwarenessByTopic(saveA, TOPIC_TYPE, TOPIC_ID);
    const resultB = await service.countAwarenessByTopic(saveB, TOPIC_TYPE, TOPIC_ID);

    expect(resultA).toBe(2);
    expect(resultB).toBe(5);

    // 验证 saveA 调用时传 saveA + topicNodeA.id
    expect(awarenessRepository.countObserversByTargetAndScore).toHaveBeenCalledWith(
      saveA,
      topicNodeA.id,
      { minScore: 1 },
    );
    // 验证 saveB 调用时传 saveB + topicNodeB.id
    expect(awarenessRepository.countObserversByTargetAndScore).toHaveBeenCalledWith(
      saveB,
      topicNodeB.id,
      { minScore: 1 },
    );
  });
});
