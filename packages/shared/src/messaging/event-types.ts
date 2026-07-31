/**
 * 事件系统类型定义（v1.7 从 backend/src/game-systems/event/types.ts 迁移）
 *
 * 迁移要点:
 * - 用户决策 Q2=全部迁移：types.ts 含 game-specific 类型（GameEvent/EventEffect 等），
 *   但本身无 services/ 依赖（仅依赖 shared/src/types/core.js），迁移无技术阻碍
 * - 一并迁移到 shared/messaging/，与 event-bus.ts 同位
 * - import 路径调整: `../../../../shared/src/types/core.js` → `../types/core.js`
 */

import { ID, Timestamp } from '../types/core.js';

export type EventType = 'random' | 'conditional' | 'story' | 'time_based' | 'location' | 'combat' | 'quest';

export type TriggerStatus = 'pending' | 'resolved' | 'expired' | 'failed';

export type TriggerType = 'enter_location' | 'combat_end' | 'combat_start' | 'quest_complete' | 'quest_fail' | 'time_reached' | 'relation_change' | 'low_health' | 'discover_location';

export interface GameEvent {
  id: ID;
  templateId: string;
  name: string;
  description: string;
  type: EventType;
  triggerType: TriggerType;
  triggerData: Record<string, unknown>;
  effects: EventEffect[];
  priority: number;
  repeatable: boolean;
  cooldown: number;
}

export interface EventEffect {
  type: 'modify_stat' | 'give_item' | 'spawn_enemy' | 'change_weather' | 'dialogue_trigger' | 'quest_unlock';
  params: Record<string, unknown>;
}

export interface EventTrigger {
  id: ID;
  saveId: ID;
  eventId: ID;
  triggeredAt: Timestamp;
  resolvedAt: Timestamp | null;
  status: TriggerStatus;
  resultData: Record<string, unknown>;
}

export interface StoryEventRecord {
  id: ID;
  saveId: ID;
  chapter: string;
  eventType: string;
  title: string;
  description: string;
  importance?: 'critical' | 'major' | 'minor';
  participants: string[];
  impact: Record<string, unknown>;
  timestamp: Timestamp;
}

export interface EventRollResult {
  triggered: boolean;
  eventId: ID | null;
  eventName: string | null;
  reason: string;
  effects: EventEffect[];
}

export interface EventCheckResult {
  checks: Array<{
    eventType: string;
    matched: boolean;
    triggers: EventTrigger[];
  }>;
  totalMatched: number;
}

export interface EventChain {
  rootEventId: ID;
  chainEvents: Array<{
    eventId: ID;
    condition: string;
    delay: number;
  }>;
}

// ==================== M9 LLMRequestDispatcher 事件类型 ====================
// 设计文档：solution-design-20260726-llm-request-dispatcher-L2L3-细化设计.md §12.1

/**
 * Provider 配置变更事件 payload
 *
 * 设计目标：
 * 1. 自描述：订阅方无需回查 DB 即可判断是否需要处理
 * 2. 可追溯：通过 eventId/timestamp/operator 支持审计与排障
 * 3. 幂等友好：通过 eventId 去重，通过 version 检测乱序
 */
export interface ProviderConfigChangedPayload {
  /** 事件唯一 ID（crypto.randomUUID()），用于幂等去重 */
  eventId: string;
  /** 事件版本号（model_providers.version 字段，单调递增），订阅方据此丢弃过期事件 */
  version: number;
  /** ISO8601 时间戳，事件产生时刻 */
  timestamp: string;
  /** Provider ID */
  providerId: string;
  /** 变更类型 */
  changeType: 'updated' | 'deleted';
  /**
   * 变更字段清单（changeType='updated' 时填充；deleted 时为空数组）
   * 订阅方据此快速判断是否需要同步（如未涉及 api_keys/rateLimit 可跳过）
   */
  changedFields: ReadonlyArray<
    | 'api_keys'
    | 'rateLimit'
    | 'name'
    | 'isDefault'
    | 'enabled'
    | 'models'
  >;
  /** 触发变更的操作者 */
  operator: 'admin' | 'system' | 'init-seed' | 'unknown';
}

/**
 * LLM 调用指标事件 payload（C5 修复）
 *
 * 发布方：LLMRequestDispatcher.emitMetricsEvent()
 * 订阅方：LLMMetricsSink（E 层）
 * 持久化目标：llm_dispatch_metrics 表（v2.4 分表：dispatcher 调度度量；agent_llm_calls 仅由 M1 写单次调用度量）
 *
 * StagingPool 豁免：详见 LLMMetricsSink 类注释
 */
export interface LLMMetricsEventPayload {
  /** 事件唯一 ID（crypto.randomUUID()） */
  eventId: string;
  /** ISO8601 时间戳，事件产生时刻 */
  timestamp: string;
  /** Provider ID */
  providerId: string;
  /** Agent 标识（如 'gamemaster' / 'map_grid'） */
  agentKey: string;
  /** 关联的 saveId（可空，如 batch_spawn_agents 内部分发无 saveId） */
  saveId?: string;
  /** 本次调用的 key 索引 */
  keyIndex: number;
  /** 是否成功 */
  success: boolean;
  /** 失败时的错误类型（success=false 时必填） */
  errorType?: 'rate_limited' | 'auth_failed' | 'server_error' | 'timeout' | 'network' | 'context_overflow' | 'no_available_key';
  /** 调用耗时（毫秒） */
  durationMs: number;
  /** 本次 dispatch 的总尝试次数（含失败转移） */
  attemptCount: number;
  /** 总等待时间（毫秒，令牌桶 acquire 等待） */
  waitMs: number;
  /** 是否触发了冷静期 */
  cooldownTriggered: boolean;
}
