/**
 * 实体引用解析失败时抛出的统一错误（13.2 / 13.3 / 14.3 规则）。
 *
 * 设计目标：
 * - 调用方可 `instanceof EntityResolutionError` 精确捕获并提取候选列表
 * - 错误信息含候选节点列表（最多 10 个，按 created_at DESC 排序），引导 Agent 自修正
 * - 不再静默 fallback 返回原值（§13.3 合规）
 */

import type { EntityType, ResolvedEntity } from './types.js';

export type EntityResolutionReason =
  | 'not_found'
  | 'multiple_match_no_timestamp'
  | 'multiple_match_ambiguous';

interface EntityResolutionErrorParams {
  readonly entityType: EntityType;
  readonly ref: string;
  readonly saveId: string | null;
  readonly candidates: ResolvedEntity[];
  readonly reason: EntityResolutionReason;
}

function buildCandidatesText(candidates: ResolvedEntity[]): string {
  if (candidates.length === 0) return '[]';
  return candidates
    .map(c => `entityId=${c.entityId}, label=${c.label}`)
    .join('; ');
}

function buildFixSuggestion(reason: EntityResolutionReason, entityType: EntityType): string {
  switch (reason) {
    case 'not_found':
      return `使用 list_entities_by_type(entityType='${entityType}') 查询完整列表, 或直接使用 label 作为 entityId 参数`;
    case 'multiple_match_no_timestamp':
      return '传入更具体的 label, 或使用 entity_id 精确匹配';
    case 'multiple_match_ambiguous':
      return '传入 timestamp 参数消歧, 或使用 entity_id 精确匹配';
  }
}

function buildReasonText(reason: EntityResolutionReason): string {
  switch (reason) {
    case 'not_found':
      return '既无 entity_id 匹配也无 label 匹配';
    case 'multiple_match_no_timestamp':
      return 'label 匹配多个节点且未传 timestamp 无法消歧';
    case 'multiple_match_ambiguous':
      return 'label 匹配多个节点且 timestamp 仍无法消歧';
  }
}

function buildMessage(params: EntityResolutionErrorParams): string {
  const { entityType, ref, saveId, candidates, reason } = params;
  const saveIdText = saveId ?? 'null';
  const candidatesText = buildCandidatesText(candidates);
  const reasonText = buildReasonText(reason);
  const fixText = buildFixSuggestion(reason, entityType);
  return (
    `${entityType} 实体引用解析失败: ref='${ref}', saveId=${saveIdText}. ` +
    `${reasonText}. 可用 ${entityType} (最多10个): [${candidatesText}]. ` +
    `修复建议: ${fixText}`
  );
}

export class EntityResolutionError extends Error {
  readonly entityType: EntityType;
  readonly ref: string;
  readonly saveId: string | null;
  readonly candidates: ResolvedEntity[];
  readonly reason: EntityResolutionReason;

  constructor(params: EntityResolutionErrorParams) {
    super(buildMessage(params));
    this.name = 'EntityResolutionError';
    this.entityType = params.entityType;
    this.ref = params.ref;
    this.saveId = params.saveId;
    this.candidates = params.candidates;
    this.reason = params.reason;
  }
}
