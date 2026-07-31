/**
 * 工具执行进度契约（M6 模块，pi onUpdate 映射，dimension-5 §2.1）。
 *
 * 设计文档：docs/design/solution-design-20260726-pi-reference-upgrade/
 *   solution-design-20260726-pi-reference-upgrade-模块M6-工具层扩展.md §7.1
 *
 * 设计约束：
 * - message 必填：前端进度树直接展示，必须人类可读（中文）
 * - percent 可选：无法估算总量的工具省略（前端降级为不定态展示）
 * - stage 可选：多阶段工具标识当前阶段（如 init 流程）
 * - details 兜底扩展：禁止塞入大对象（经 WS 序列化传输）
 */

import { getChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '../utils/error.js';

const logger = getChildLogger('tool-progress');

/** 工具执行进度 */
export interface ToolProgress {
  /** 完成百分比 0-100；无法估算总量时省略 */
  percent?: number;
  /** 人类可读进度描述（前端直接展示） */
  message: string;
  /** 当前阶段标识（多阶段工具使用，如 'generate_world'/'persist'） */
  stage?: string;
  /** 结构化附加数据（小对象，会经 WS 传输） */
  details?: Record<string, unknown>;
}

/** 进度回调签名（ToolContext.onUpdate 字段类型） */
export type ToolProgressCallback = (progress: ToolProgress) => void;

/** 进度上报器配置 */
export interface ProgressReporterOptions {
  /** 节流间隔毫秒，默认 200 */
  throttleMs?: number;
  /** 相同 message 是否去重，默认 true */
  dedupeByMessage?: boolean;
}

/**
 * 创建限流进度上报器。
 *
 * 包装原始 onUpdate 回调：
 * - 节流：距上次实际发射不足 throttleMs 的调用被丢弃（进度是瞬态，丢帧可接受）
 * - 去重：相同 message 连续上报被丢弃
 * - 防御：回调抛错被捕获并降级 logger.warn，绝不影响工具执行
 *
 * 返回的函数可直接赋值给 ToolContext.onUpdate。
 *
 * 为什么丢弃而非队列：进度语义是"最新状态覆盖"，旧帧无价值；
 * 队列会引入内存与延迟。
 */
export function createProgressReporter(
  onUpdate: ToolProgressCallback,
  options?: ProgressReporterOptions,
): ToolProgressCallback {
  const throttleMs = options?.throttleMs ?? 200;
  const dedupeByMessage = options?.dedupeByMessage ?? true;
  // 初始 0 保证首次调用必发射（now - 0 >= throttleMs 对任何现实时间戳成立）
  let lastEmitAt = 0;
  let lastMessage: string | undefined;

  return (progress: ToolProgress): void => {
    const now = Date.now();
    if (now - lastEmitAt < throttleMs) return;
    if (dedupeByMessage && lastMessage !== undefined && progress.message === lastMessage) return;

    lastEmitAt = now;
    lastMessage = progress.message;
    try {
      onUpdate(progress);
    } catch (error) {
      logger.warn('onUpdate callback threw; progress frame dropped', {
        error: getErrorMessage(error),
      });
    }
  };
}
