import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { EventBus, BusEvent, CombatEndData } from '@ai-rpg/shared/messaging';
import type { EntityGraphService } from './EntityGraphService.js';
import type { AwarenessSource } from './types.js';

/**
 * Awareness 自动化订阅器（006 升级新增）。
 *
 * 设计文档 §7.3 自动化订阅流程：
 *   - 订阅 dialogue 事件 → setAwareness(npc, player, delta=+1, source='auto:dialogue')
 *   - 订阅 combat_end 事件 → 对每个 NPC 参与者 setAwareness(npc, player, delta=+3, source='auto:combat')
 *
 * 自动化范围（设计文档 §5.3 不做的事项）：
 *   - 仅 awareness 最低基线自动化（dialogue +1, combat_end +3）
 *   - relationship 完全手动，不自动化
 *   - 信息传播链由 GM 显式调用 set_awareness(source.type='informed_by') 记录
 *
 * 错误处理策略：
 *   - dialogue 事件 data.playerId 缺失 → 跳过并记日志（DialogueService 未注入 characterService 时降级）
 *   - setAwareness 抛错（如 player 节点不存在）→ 捕获并记日志，不传播异常（避免污染发布方）
 *   - 不阻塞 EventBus 事件链
 *
 * 自动事件压缩（设计文档 §3 R1-R4）：
 *   - 连续 auto:dialogue 事件会被 EntityGraphService.isAwarenessCompressible 合并
 *   - 连续 auto:combat 事件同上
 *   - merged_count 累加记录合并次数
 */
export class AwarenessAutoSubscriber {
  private readonly logger: ReturnType<typeof createChildLogger>;

  constructor(
    private readonly eventBus: EventBus,
    private readonly entityGraphService: EntityGraphService,
  ) {
    this.logger = createChildLogger('service:awareness-auto-subscriber');
  }

  /**
   * 订阅 dialogue / combat_end 事件，自动追加 awareness 事件。
   *
   * 期望效果：
   *   - dialogue 事件 → setAwareness(npc, player, delta=+1, source='auto:dialogue')
   *   - combat_end 事件 → 对每个 NPC 参与者 setAwareness(delta=+3, source='auto:combat')
   *   - 事件处理失败不传播异常，仅记日志
   *
   * 调用时机：组合根装配阶段（init.ts）调用一次。
   */
  subscribe(): void {
    this.eventBus.subscribe('dialogue', (event) => this.handleDialogue(event));
    this.eventBus.subscribe('combat_end', (event) => this.handleCombatEnd(event));
    this.logger.info('AwarenessAutoSubscriber subscribed to dialogue + combat_end events');
  }

  /**
   * 处理 dialogue 事件：自动追加 awareness 事件（npc → player, delta=+1）。
   *
   * 期望效果：
   *   - 从 event.data 解析 npcId + playerId
   *   - 调用 entityGraphService.setAwareness(saveId, 'npc', npcId, 'character', playerId, +1, source)
   *   - source = { type: 'auto:dialogue', occurredAt: event.timestamp }
   *   - npcId/playerId 缺失或 setAwareness 抛错 → 跳过并记日志
   */
  private async handleDialogue(event: BusEvent): Promise<void> {
    const { saveId, data, timestamp } = event;
    const npcId = data.npcId as string | undefined;
    const playerId = data.playerId as string | undefined;

    if (!npcId) {
      this.logger.warn('Dialogue event missing npcId, skip awareness auto-update', { saveId });
      return;
    }
    if (!playerId) {
      this.logger.warn('Dialogue event missing playerId, skip awareness auto-update', {
        saveId,
        npcId,
        hint: 'DialogueService may not have characterService injected; data.playerId unavailable',
      });
      return;
    }

    const source: AwarenessSource = {
      type: 'auto:dialogue',
      occurredAt: timestamp,
    };

    try {
      await this.entityGraphService.setAwareness(
        saveId,
        'npc', npcId,
        'character', playerId,
        1,
        source,
        '自动：对话发生',
      );
      this.logger.info('Awareness auto-updated from dialogue', { saveId, npcId, playerId, delta: 1 });
    } catch (error) {
      // player 或 npc 节点不存在、StagingPool 写入失败等场景
      // 不传播异常，避免污染 DialogueService 的事件链
      this.logger.warn('Failed to auto-update awareness from dialogue', {
        saveId,
        npcId,
        playerId,
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * 处理 combat_end 事件：对每个 NPC 参与者自动追加 awareness 事件（npc → player, delta=+3）。
   *
   * 期望效果：
   *   - 从 event.data 解析 participants 数组（CombatEndData）
   *   - 找到 type='character' 的参与者作为 player
   *   - 对每个 type='npc' 的参与者调用 setAwareness(saveId, 'npc', npcId, 'character', playerId, +3, source)
   *   - source = { type: 'auto:combat', occurredAt: event.timestamp }
   *   - player 缺失或 setAwareness 抛错 → 跳过并记日志
   */
  private async handleCombatEnd(event: BusEvent): Promise<void> {
    const { saveId, data, timestamp } = event;
    const combatEndData = data as unknown as CombatEndData;
    const participants = combatEndData.participants;

    if (!participants || !Array.isArray(participants) || participants.length === 0) {
      this.logger.warn('Combat_end event missing participants, skip awareness auto-update', { saveId });
      return;
    }

    const playerParticipant = participants.find(p => p.type === 'character');
    if (!playerParticipant) {
      this.logger.warn('Combat_end event missing character participant, skip awareness auto-update', {
        saveId,
        participantsCount: participants.length,
      });
      return;
    }
    const playerId = playerParticipant.id;

    const npcParticipants = participants.filter(p => p.type === 'npc');
    if (npcParticipants.length === 0) {
      this.logger.info('Combat_end event has no NPC participants, skip awareness auto-update', { saveId });
      return;
    }

    const source: AwarenessSource = {
      type: 'auto:combat',
      occurredAt: timestamp,
    };

    let successCount = 0;
    let failCount = 0;
    for (const npc of npcParticipants) {
      try {
        await this.entityGraphService.setAwareness(
          saveId,
          'npc', npc.id,
          'character', playerId,
          3,
          source,
          '自动：战斗结束',
        );
        successCount++;
      } catch (error) {
        failCount++;
        // 单个 NPC 失败不影响其他 NPC 的 awareness 更新
        this.logger.warn('Failed to auto-update awareness from combat_end for NPC', {
          saveId,
          npcId: npc.id,
          npcName: npc.name,
          playerId,
          error: getErrorMessage(error),
        });
      }
    }

    this.logger.info('Awareness auto-updated from combat_end', {
      saveId,
      combatId: combatEndData.combatId,
      result: combatEndData.result,
      npcCount: npcParticipants.length,
      successCount,
      failCount,
    });
  }
}
