/**
 * EntityGraphReconciler — 实体图定期纠错器（简化版）。
 *
 * 职责：从业务表全量重建图数据，修复累积漂移。无审计闭环，无差异检测。
 *
 * 设计依据（模块2 方案B + L0-1 决策）：
 * - 删除 EntityGraphAuditor/EntityGraphRepairer 依赖
 * - 删除 deriveExpectedGraph + computeGraphDiff + applyDiff 差异检测逻辑
 * - 改用 Builder.enrichFromExistingData 全量重建（upsert 语义幂等）
 * - 失败不阻塞 AgentRuntime 主流程，通过 logger 暴露给开发者（L3-1）
 *
 * 触发时机：
 * - 写入阈值触发（AgentRuntime.triggerReconcileIfNeeded，累计写入次数达阈值）
 * - 章节推进触发（init.ts chapter_advanced 订阅，快照前纠错）
 *
 * 走 graphProvider 直写 DB（非 StagingPool）：
 * - Reconciler 在 flush 后触发，数据已落库
 * - enrichFromExistingData 通过 graphProvider.upsertNode/upsertEdge 直接写入
 * - upsert 语义幂等，重复调用无副作用
 * - §13.1 不适用（非 ReAct 循环路径，非工具调用路径）
 */

import type { IEntityGraphProvider } from '../shared/types.js';
import type {
  EntityGraphBuildContext,
  IEntityGraphReconciler,
  ReconcileResult,
} from './types.js';
import type { EntityGraphBuilder } from './EntityGraphBuilder.js';
import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';

const logger = createChildLogger('entity-graph-reconciler');

export class EntityGraphReconciler implements IEntityGraphReconciler {
  constructor(
    private entityGraphBuilder: EntityGraphBuilder,
    private context: EntityGraphBuildContext,
    private graphProvider: IEntityGraphProvider,
  ) {}

  /**
   * 全量重建图数据（兜底机制）。
   *
   * 调用 Builder.enrichFromExistingData 从业务表派生期望图状态并 upsert 写入。
   * 失败时返回 error 字段，不抛错（不阻塞 AgentRuntime 主流程，L3-1 决策）。
   */
  async reconcile(saveId: string): Promise<ReconcileResult> {
    logger.info('Reconcile: starting full rebuild', { saveId });

    try {
      // 全量重建（enrichFromExistingData 内部 upsert 幂等）
      await this.entityGraphBuilder.enrichFromExistingData(saveId, this.context);

      // 重建后统计节点/边数（读取已落库状态）
      const graph = await this.graphProvider.getFullGraph(saveId);
      const nodeCount = graph.nodes.length;
      const edgeCount = graph.edges.length;

      if (nodeCount === 0 && edgeCount === 0) {
        logger.warn('Reconcile: rebuilt graph is empty', { saveId });
      }

      const result: ReconcileResult = {
        saveId,
        rebuilt: true,
        nodeCount,
        edgeCount,
      };

      logger.info('Reconcile: full rebuild completed', { saveId, nodeCount, edgeCount });
      return result;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Reconcile: full rebuild failed', { saveId, error: errorMessage });

      return {
        saveId,
        rebuilt: false,
        nodeCount: 0,
        edgeCount: 0,
        error: errorMessage,
      };
    }
  }
}
