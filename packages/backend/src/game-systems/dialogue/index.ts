/**
 * dialogue/ 模块桶导出（S3-3 完整 Repository 模式）。
 *
 * S3-3: dialogues 表归 DialogueRepository（D7 一表一 Repository），
 * DialogueService 通过 IDialogueRepository 端口操作数据。
 * mappers.ts 是包内共享纯映射函数，不从桶导出（接口最小化）。
 */

export { DialogueService } from './DialogueService.js';
export { DialogueServiceTool } from './DialogueServiceTool.js';
export { DialogueRepository } from './DialogueRepository.js';
export type {
  IDialogueRepository,
  DialogueMessageRecord,
  MessageType,
  DialogueMessage,
  DialogueSession,
  DialogueOption,
  DialogueContext,
  CreateDialogueParams,
  ConditionalCheckResult,
  DialogueEffect,
  DialogueChoiceResult,
  DialogueContextSummary,
} from './types.js';
