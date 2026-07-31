import { createHash } from 'crypto';
import type { ContextManifest } from '../types/context-manifest.js';

/**
 * 构建派发去重键 - 三段组合：agent_type | action | contentHash。
 *
 * action固定LLM难绕过，manifest结构化LLM微调task文本但manifest不变则hash不变。
 */
export function buildDispatchKey(
  agentType: string,
  action: string,
  task: string,
  manifest?: ContextManifest,
): string {
  const manifestStr = manifest ? JSON.stringify(manifest) : '';
  const contentHash = createHash('sha256').update(task + manifestStr).digest('hex').substring(0, 16);
  return `${agentType}|${action}|${contentHash}`;
}

/**
 * 从去重键提取 task_hash 部分（用于DB查询的 task_hash 字段）。
 */
export function extractTaskHash(dispatchKey: string): string {
  const parts = dispatchKey.split('|');
  return parts[2] ?? '';
}
