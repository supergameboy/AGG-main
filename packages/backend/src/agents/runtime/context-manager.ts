/**
 * ContextManager —— AgentContext 消息状态的唯一管理者（M3 模块 5）。
 *
 * 设计文档：docs/design/solution-design-20260726-pi-reference-upgrade/
 *   solution-design-20260726-pi-reference-upgrade-模块M3-AgentRuntime拆分.md §11
 *
 * 职责：加载（load）、持久化（persist：ContextFlushQueue 优先 + 3 次指数退避重试）、
 * 追加消息（SOFT=100 异步压缩 / HARD=150 同步压缩）、更新/清空、
 * 回退截断压缩（compressInMemory，M8 已加 protectToolPairs：findSafeCutIndex 安全切点）、
 * replaceMessages 压缩回写（§9.4 修复：内存 + 落库同步）。
 *
 * 迁移自 BaseAgent（行为等价，纯移动）：
 * context 字段 / getContext / persistContext / updateContext / clearContext /
 * loadContext / addMessageToContext / compressContext / cloneContextForRequestScope
 *
 * 依赖方向：叶节点（§13.1），不依赖任何 runtime/ 模块，仅 type import types.ts。
 */

import type { Timestamp } from '../../../../shared/src/types/core.js';
import type { AgentContext, LLMMessage } from '../../../../shared/src/types/agent.js';
import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { IContextProvider } from '../../game-systems/shared/types.js';
import type {
  ContextManagerDeps,
  ContextManagerRebindDeps,
  IContextManager,
} from './types.js';

const logger = createChildLogger('context-manager');

// ─── M8：fallback 压缩 tool 配对保护（模块级纯函数，export 供单测） ───
// 设计文档：docs/design/solution-design-20260726-pi-reference-upgrade/
//   solution-design-20260726-pi-reference-upgrade-模块M8-compaction改进.md
// 位置适配：M3 完成后压缩逻辑归属 ContextManager，纯函数放本文件模块级（设计 D2：
// 复用时再提取共享位置，禁止提前提取到 packages/shared）。

/**
 * 判定消息是否为 tool 结果消息（tool_result / legacy function 结果）
 */
export function isToolResultMessage(message: LLMMessage): boolean {
  return message.role === 'tool' || message.role === 'function';
}

/**
 * 收集消息序列中所有 assistant 消息携带的 toolCalls[].id
 */
export function collectToolCallIds(messages: LLMMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      ids.add(toolCall.id);
    }
  }
  return ids;
}

/**
 * 在计数预算内寻找最近安全切点，禁止切断 tool_call ↔ tool_result 配对。
 *
 * @param nonSystemMessages 已过滤 system 的消息序列（保持原顺序）
 * @param desiredCut 期望切点（保留 nonSystemMessages[desiredCut..end]）
 * @returns 安全切点索引（0 <= safeCut <= nonSystemMessages.length）
 *
 * 不变式（返回后保证）：
 * 1. 保留区首条消息不是孤儿 tool_result（其 owner assistant 不在保留区）
 * 2. 保留区内每条 tool_result 的 toolCallId 都能在保留区内找到 owner
 * 3. safeCut <= desiredCut（向后调整只多保留）；owner 缺失时允许 safeCut > desiredCut（向前丢弃孤儿）
 */
export function findSafeCutIndex(
  nonSystemMessages: LLMMessage[],
  desiredCut: number,
): number {
  const n = nonSystemMessages.length;
  if (n === 0) return 0;
  let cut = Math.min(Math.max(desiredCut, 0), n);

  // toolCallId -> owner assistant 索引映射
  const ownerIndex = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    for (const toolCall of nonSystemMessages[i].toolCalls ?? []) {
      ownerIndex.set(toolCall.id, i);
    }
  }

  // 主策略：向后调整（向旧消息方向），直到保留区首条不是"owner 被裁掉"的 tool_result
  while (cut > 0 && cut < n && isToolResultMessage(nonSystemMessages[cut])) {
    const message = nonSystemMessages[cut];
    let owner: number | undefined;
    if (message.toolCallId !== undefined) {
      owner = ownerIndex.get(message.toolCallId);
    } else if (message.role === 'function') {
      // legacy function 结果无配对 id：相邻前驱 assistant(functionCall) 视为配对（设计 E5）
      const prev = nonSystemMessages[cut - 1];
      if (prev.role === 'assistant' && prev.functionCall) {
        owner = cut - 1;
      }
    }
    if (owner !== undefined && owner < cut) {
      cut = owner; // 向后纳入 owner assistant（保留完整配对）
    } else {
      break; // owner 缺失 → 转兜底策略
    }
  }

  // 全配对链兜底：向后调整到达 0（整条序列是一个大连配对链）→ 等效不压缩（设计 E1）
  if (cut === 0 && desiredCut > 0) {
    logger.warn('Context compression cut adjusted to 0: entire sequence is one tool-call chain, skipping compression', {
      desiredCut,
      messageCount: n,
    });
  }

  // 兜底策略：向前丢弃 owner 缺失的孤儿 tool_result（数据损坏/已被历史压缩裁掉）
  let droppedOrphans = 0;
  while (cut < n && isToolResultMessage(nonSystemMessages[cut])) {
    const toolCallId = nonSystemMessages[cut].toolCallId;
    if (toolCallId !== undefined && ownerIndex.has(toolCallId)) break;
    cut += 1;
    droppedOrphans += 1;
  }
  if (droppedOrphans > 0) {
    logger.warn('Dropped orphan tool_result messages during context compression', { droppedOrphans });
  }

  // 一致性校验（防御）：保留区内不得有 owner 在保留区外的 tool_result（理论上被主策略覆盖）
  let keptIds = collectToolCallIds(nonSystemMessages.slice(cut));
  for (;;) {
    const orphan = nonSystemMessages
      .slice(cut)
      .find(
        (msg) =>
          isToolResultMessage(msg) &&
          msg.toolCallId !== undefined &&
          !keptIds.has(msg.toolCallId) &&
          ownerIndex.has(msg.toolCallId),
      );
    const orphanToolCallId = orphan?.toolCallId;
    if (orphanToolCallId === undefined) break;
    const owner = ownerIndex.get(orphanToolCallId);
    if (owner === undefined || owner >= cut) break;
    cut = owner;
    keptIds = collectToolCallIds(nonSystemMessages.slice(cut));
  }

  return cut;
}

export class ContextManager implements IContextManager {
  private static readonly SOFT_CONTEXT_LIMIT = 100;
  private static readonly HARD_CONTEXT_LIMIT = 150;

  private context: AgentContext;
  private readonly deps: ContextManagerDeps;

  constructor(deps: ContextManagerDeps) {
    this.deps = deps;
    this.context = this.createInitialContext();
  }

  private createInitialContext(): AgentContext {
    return {
      agentType: this.deps.agentType,
      messages: [],
      state: {},
      lastUpdate: Date.now() as Timestamp,
    };
  }

  getContext(): AgentContext {
    return { ...this.context };
  }

  /**
   * 返回内部 context 引用（BaseAgent protected context 访问器专用）。
   * 兼容既有子类直接读写 this.context.state 的访问模式（如 TestAgent）。
   */
  getMutableContext(): AgentContext {
    return this.context;
  }

  private getContextService(): IContextProvider | null {
    return this.deps.getContextService() ?? null;
  }

  private async persist(forceSync = false): Promise<void> {
    const currentSaveId = this.deps.getCurrentSaveId();
    if (!currentSaveId) return;

    const flushQueue = this.deps.getFlushQueue();
    // 优先使用 ContextFlushQueue（异步入队，debounce 合并写入）
    if (flushQueue) {
      flushQueue.enqueue(currentSaveId, this.deps.agentType, this.context);
      if (forceSync) {
        await flushQueue.forceFlush(currentSaveId, this.deps.agentType);
      }
      return;
    }

    // 回退：直接写 DB（保留原有逻辑）
    const service = this.getContextService();
    if (!service) return;

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await service.saveContext(currentSaveId, this.deps.agentType, this.context);
        return;
      } catch (err) {
        const errorMsg = getErrorMessage(err);
        if (attempt < maxRetries) {
          logger.warn(`Persist context failed (attempt ${attempt}/${maxRetries}), retrying for agent: ${this.deps.agentType}`, {
            error: errorMsg,
          });
          await this.delay(Math.pow(2, attempt - 1) * 1000);
        } else {
          logger.error(`Failed to persist context for agent: ${this.deps.agentType} after ${maxRetries} attempts`, {
            error: errorMsg,
          });
        }
      }
    }
  }

  async update(updates: Partial<AgentContext>): Promise<void> {
    this.context = {
      ...this.context,
      ...updates,
      lastUpdate: Date.now() as Timestamp,
    };
    logger.debug(`Context updated for agent: ${this.deps.agentType}`);
    await this.persist();
  }

  async clear(): Promise<void> {
    this.context = this.createInitialContext();
    logger.info(`Context cleared for agent: ${this.deps.agentType}`);
    const currentSaveId = this.deps.getCurrentSaveId();
    if (currentSaveId) {
      const service = this.getContextService();
      if (service) {
        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            await service.clearContext(currentSaveId, this.deps.agentType);
            return;
          } catch (err) {
            const errorMsg = getErrorMessage(err);
            if (attempt < maxRetries) {
              logger.warn(`Clear persisted context failed (attempt ${attempt}/${maxRetries}), retrying for agent: ${this.deps.agentType}`, {
                error: errorMsg,
              });
              await this.delay(Math.pow(2, attempt - 1) * 1000);
            } else {
              logger.error(`Failed to clear persisted context for agent: ${this.deps.agentType} after ${maxRetries} attempts`, {
                error: errorMsg,
              });
            }
          }
        }
      }
    }
  }

  async load(): Promise<void> {
    const currentSaveId = this.deps.getCurrentSaveId();
    if (!currentSaveId) return;
    const service = this.getContextService();
    if (!service) return;
    try {
      const loaded = await service.getContext(currentSaveId, this.deps.agentType);
      this.context = loaded;
      logger.info(`Context loaded from DB for agent: ${this.deps.agentType}`, {
        saveId: currentSaveId,
        messageCount: loaded.messages.length,
      });
    } catch (err) {
      logger.error(`Failed to load context for agent: ${this.deps.agentType}`, {
        error: getErrorMessage(err),
      });
    }
  }

  async addMessage(message: LLMMessage): Promise<void> {
    this.context.messages.push(message);
    this.context.lastUpdate = Date.now() as Timestamp;

    const messageCount = this.context.messages.length;

    if (messageCount >= ContextManager.HARD_CONTEXT_LIMIT) {
      // HARD_LIMIT：强制同步 flush + 同步压缩
      await this.persist(true);
      logger.warn(`Agent context exceeded hard limit, triggering sync compression`, {
        agentType: this.deps.agentType,
        messageCount,
      });
      await this.compressInMemory();
    } else if (messageCount >= ContextManager.SOFT_CONTEXT_LIMIT) {
      // SOFT_LIMIT：异步入队 + 异步压缩
      this.persist();
      logger.info(`Agent context reached soft limit, async compression will be triggered`, {
        agentType: this.deps.agentType,
        messageCount,
      });
      this.compressInMemory().catch(err => {
        logger.warn('Async context compression failed', {
          agentType: this.deps.agentType,
          error: getErrorMessage(err),
        });
      });
    } else {
      // 正常：异步入队，不阻塞
      this.persist();
    }
  }

  /**
   * 压缩回写（§9.4 修复）：同时更新内存 context 并落库。
   * 修复前 compressAgentContexts 将压缩结果写在 getContext() 浅拷贝上，
   * 仅落库不更新内存，导致内存/DB 不一致。
   */
  async replaceMessages(messages: LLMMessage[]): Promise<void> {
    this.context = {
      ...this.context,
      messages,
      lastUpdate: Date.now() as Timestamp,
    };
    await this.persist();
  }

  /**
   * 回退截断压缩（M8：protectToolPairs 配对保护）。
   * 计数预算内由 findSafeCutIndex 选最近安全切点，禁止切断 tool_call ↔ tool_result 配对；
   * 向后调整只多保留（可超 SOFT 上限，设计 Q3 拍板可接受），owner 缺失时向前丢弃孤儿 + warn。
   */
  private async compressInMemory(): Promise<void> {
    const messages = this.context.messages;
    if (messages.length <= ContextManager.SOFT_CONTEXT_LIMIT) return;

    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');
    const retainCount = Math.max(0, ContextManager.SOFT_CONTEXT_LIMIT - systemMessages.length);
    if (nonSystemMessages.length <= retainCount) return;

    const desiredCut = nonSystemMessages.length - retainCount;
    const safeCut = findSafeCutIndex(nonSystemMessages, desiredCut);
    const retained = nonSystemMessages.slice(safeCut);

    this.context.messages = [...systemMessages, ...retained];
    this.context.lastUpdate = Date.now() as Timestamp;

    logger.info('Agent context compressed in-memory', {
      agentType: this.deps.agentType,
      originalCount: messages.length,
      newCount: this.context.messages.length,
      desiredCut,
      safeCut,
      cutAdjusted: safeCut !== desiredCut,
    });

    await this.persist();
  }

  private cloneContextForRequestScope(): AgentContext {
    return {
      agentType: this.context.agentType,
      messages: this.context.messages.map((message) => ({
        ...message,
        functionCall: message.functionCall ? { ...message.functionCall } : undefined,
        toolCalls: message.toolCalls?.map((toolCall) => ({
          ...toolCall,
          function: { ...toolCall.function },
        })),
      })),
      state: structuredClone(this.context.state),
      lastUpdate: this.context.lastUpdate,
    };
  }

  cloneForRequestScope(rebind: ContextManagerRebindDeps): ContextManager {
    const clone = new ContextManager({
      agentType: this.deps.agentType,
      ...rebind,
    });
    clone.context = this.cloneContextForRequestScope();
    return clone;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
