/**
 * dialogue 领域纯映射函数。
 *
 * 从 DialogueService 私有方法 rowToDialogueMessage 迁入，
 * 供 DialogueRepository / DialogueService 共享。
 * 数据库 snake_case ↔ DialogueMessageRecord camelCase ↔ DialogueMessage 实体。
 */
import type { ID, Timestamp } from '../../../../shared/src/types/core.js';
import type { DialogueMessage, DialogueMessageRecord, MessageType } from './types.js';

/**
 * dialogues 表行 → DialogueMessageRecord 实体。
 *
 * 覆盖 DialogueService.rowToDialogueMessage L1083-1094 的字段映射，
 * 但返回中间类型 DialogueMessageRecord（保持原始 string 字段）。
 */
export function rowToDialogueMessageRecord(row: Record<string, unknown>): DialogueMessageRecord {
  return {
    id: row.id as ID,
    saveId: row.save_id as string,
    npcId: (row.npc_id as string | null) ?? null,
    speaker: row.speaker as string,
    content: row.content as string,
    emotion: row.emotion as string,
    messageType: (row.message_type as string) ?? 'npc',
    timestamp: row.timestamp as number,
  };
}

/**
 * DialogueMessageRecord → DialogueMessage 实体（领域层消费类型）。
 *
 * saveId/npcId/timestamp 从 string/number 收窄为 ID/Timestamp（标记类型），
 * messageType 从 string 收窄为 MessageType 联合类型，无效值兜底为 'npc'。
 */
export function recordToDialogueMessage(record: DialogueMessageRecord): DialogueMessage {
  return {
    id: record.id as ID,
    saveId: record.saveId as ID,
    npcId: record.npcId as ID | null,
    speaker: record.speaker,
    content: record.content,
    emotion: record.emotion,
    messageType: (record.messageType as MessageType) || 'npc',
    timestamp: record.timestamp as Timestamp,
  };
}
