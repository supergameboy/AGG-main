// EG-M1-5: 修复 F→E 违规 — DatabaseWriteQueue（服务层E）改为 IWriteQueue 接口（共享层）
// 消除业务层F → 服务层E 的反向依赖（架构规范 §二 第1项禁止依赖）
import type { IWriteQueue } from '../../../../shared/src/tool-core/port-interfaces.js';
import type { EntitySubgraph, GraphSnapshot } from './types.js';
import type { IEntityGraphProvider } from '../shared/types.js';
import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';

const logger = createChildLogger('entity-graph-snapshot');

/**
 * SnapshotManager 所需的 EntityGraph 端口（扩展 IEntityGraphProvider）。
 *
 * IEntityGraphProvider.createSnapshot 仅含 3 参数（baseline 快照），
 * SnapshotManager 需要完整的 8 参数版本（含 delta 信息）。
 * EG-M1-6: 新增 getAllSnapshots — 用于 reconstructGraphStateAtSnapshot 从 baseline 正向遍历快照链。
 */
type IEntityGraphSnapshotProvider = IEntityGraphProvider & {
  createSnapshot(
    saveId: string,
    type: 'baseline' | 'chapter',
    chapterNumber?: number,
    deltaFromId?: string,
    addedNodeIds?: string[],
    removedNodeIds?: string[],
    addedEdgeIds?: string[],
    removedEdgeIds?: string[],
  ): Promise<string>;
  /** EG-M1-6: 获取全部快照（EntityGraphService 已实现此方法） */
  getAllSnapshots(saveId: string): Promise<GraphSnapshot[]>;
};

interface SnapshotDelta {
  addedNodeIds: string[];
  removedNodeIds: string[];
  addedEdgeIds: string[];
  removedEdgeIds: string[];
}

/**
 * 快照时刻的图状态（仅 ID 集合，不含完整节点/边数据）。
 * EG-M1-6: reconstructGraphStateAtSnapshot 返回类型，computeDelta 消费类型。
 */
interface GraphStateIds {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

export class EntityGraphSnapshotManager {
  constructor(
    private graphProvider: IEntityGraphSnapshotProvider,
    // EG-M1-5: IWriteQueue 接口类型（共享层），非 DatabaseWriteQueue 具体类（服务层E）
    private writeQueue: IWriteQueue,
  ) {}

  async createBaselineSnapshot(saveId: string): Promise<string> {
    return this.writeQueue.enqueueFn(async () => {
      const snapshotId = await this.graphProvider.createSnapshot(saveId, 'baseline');
      logger.info('Baseline snapshot created', { saveId, snapshotId });
      return snapshotId;
    }, 'EntityGraphSnapshotManager.createBaselineSnapshot');
  }

  /**
   * EG-M2-5: 自动创建章节快照（由章节推进事件触发）。
   *
   * 包装 createChapterSnapshot，捕获异常并降级为 warn 日志：
   * - 快照属于非关键归档路径，失败不影响数据一致性
   * - 错误已记录到日志（非静默吞没），运维可监控快照失败率
   * - 返回 null 表示快照未创建（与成功返回的 snapshotId 区分）
   *
   * @param saveId 存档 ID
   * @param chapterNumber 章节号
   * @returns 快照 ID（成功）或 null（失败）
   */
  async autoCreateChapterSnapshot(saveId: string, chapterNumber: number): Promise<string | null> {
    try {
      return await this.createChapterSnapshot(saveId, chapterNumber);
    } catch (error) {
      logger.warn('Auto chapter snapshot failed', {
        saveId, chapterNumber,
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  async createChapterSnapshot(saveId: string, chapterNumber: number): Promise<string> {
    return this.writeQueue.enqueueFn(async () => {
      const currentGraph = await this.graphProvider.getFullGraph(saveId);
      const latestSnapshot = await this.graphProvider.getLatestSnapshot(saveId);

      let delta: SnapshotDelta;
      if (latestSnapshot) {
        // EG-M1-6: 从 baseline 正向遍历快照链重建 latestSnapshot 时刻的图状态
        const previousState = await this.reconstructGraphStateAtSnapshot(latestSnapshot);
        delta = this.computeDelta(previousState, currentGraph);
      } else {
        delta = {
          addedNodeIds: currentGraph.nodes.map(n => n.id),
          removedNodeIds: [],
          addedEdgeIds: currentGraph.edges.map(e => e.id),
          removedEdgeIds: [],
        };
      }

      const snapshotId = await this.graphProvider.createSnapshot(
        saveId,
        'chapter',
        chapterNumber,
        latestSnapshot?.id,
        delta.addedNodeIds,
        delta.removedNodeIds,
        delta.addedEdgeIds,
        delta.removedEdgeIds,
      );

      logger.info('Chapter snapshot created', { saveId, chapterNumber, snapshotId });
      return snapshotId;
    }, `EntityGraphSnapshotManager.createChapterSnapshot(ch${chapterNumber})`);
  }

  /**
   * 计算前一状态到当前状态的 delta（added/removed 节点 + 边 ID）。
   * EG-M1-6: 重构参数类型 — previous 从 EntitySubgraph 改为 GraphStateIds（仅 ID 集合）。
   */
  private computeDelta(previous: GraphStateIds, current: EntitySubgraph): SnapshotDelta {
    const currNodeIds = new Set(current.nodes.map(n => n.id));
    const currEdgeIds = new Set(current.edges.map(e => e.id));

    return {
      addedNodeIds: current.nodes.filter(n => !previous.nodeIds.has(n.id)).map(n => n.id),
      removedNodeIds: [...previous.nodeIds].filter(id => !currNodeIds.has(id)),
      addedEdgeIds: current.edges.filter(e => !previous.edgeIds.has(e.id)).map(e => e.id),
      removedEdgeIds: [...previous.edgeIds].filter(id => !currEdgeIds.has(id)),
    };
  }

  /**
   * 从 baseline 快照正向遍历快照链，重建目标快照时刻的图状态（节点 + 边 ID 集合）。
   *
   * EG-M1-6: 替换桩代码（原实现直接返回 getFullGraph，即当前图状态，非快照时刻状态）。
   *
   * 算法：
   * 1. 获取全部快照，按 createdAt 升序排序
   * 2. 找到 baseline 快照（链起点，snapshotType === 'baseline'）
   * 3. 从 baseline.addedNodeIds/addedEdgeIds 初始化 ID 集合
   * 4. 正向遍历后续 chapter 快照，逐个应用 delta（add/remove）
   * 5. 到达 targetSnapshot 时停止，返回累积的 ID 集合
   *
   * 为什么必须用完整方案（而非"从当前图筛 addedNodeIds"）：
   * - addedNodeIds 是相对前一个快照的增量，不是快照时刻的全部节点
   * - 简化方案会丢失 baseline 节点，导致 computeDelta 把已有节点错误算作 addedNodeIds
   * - 必须从 baseline 正向累加 delta 才能得到快照时刻的完整 ID 集合
   */
  private async reconstructGraphStateAtSnapshot(targetSnapshot: GraphSnapshot): Promise<GraphStateIds> {
    const allSnapshots = await this.graphProvider.getAllSnapshots(targetSnapshot.saveId);

    if (allSnapshots.length === 0) {
      throw new Error(`reconstructGraphStateAtSnapshot: no snapshots found for saveId=${targetSnapshot.saveId}`);
    }

    // 按 createdAt 升序排序（baseline 在最前，chapter 依次在后）
    const sorted = [...allSnapshots].sort((a, b) => a.createdAt - b.createdAt);

    // 找到 baseline 快照（链起点）
    const baselineIndex = sorted.findIndex(s => s.snapshotType === 'baseline');
    if (baselineIndex === -1) {
      throw new Error(`reconstructGraphStateAtSnapshot: no baseline snapshot found for saveId=${targetSnapshot.saveId}`);
    }

    // 从 baseline 初始化 ID 集合
    const nodeIds = new Set<string>(sorted[baselineIndex].addedNodeIds);
    const edgeIds = new Set<string>(sorted[baselineIndex].addedEdgeIds);

    // 正向遍历 baseline 之后的快照，逐个应用 delta
    for (let i = baselineIndex + 1; i < sorted.length; i++) {
      const snap = sorted[i];

      // 应用 delta：先 remove 再 add（避免 remove 刚 add 的节点）
      for (const id of snap.removedNodeIds) nodeIds.delete(id);
      for (const id of snap.addedNodeIds) nodeIds.add(id);
      for (const id of snap.removedEdgeIds) edgeIds.delete(id);
      for (const id of snap.addedEdgeIds) edgeIds.add(id);

      // 到达目标快照，停止遍历
      if (snap.id === targetSnapshot.id) break;
    }

    return { nodeIds, edgeIds };
  }
}
