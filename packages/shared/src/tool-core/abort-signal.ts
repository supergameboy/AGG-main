/**
 * 工具取消契约（M6 模块，pi ExtensionContext.signal 映射，dimension-5 §2.1）。
 *
 * 设计文档：docs/design/solution-design-20260726-pi-reference-upgrade/
 *   solution-design-20260726-pi-reference-upgrade-模块M6-工具层扩展.md §7.2
 *
 * 协作式取消是唯一可行语义：JavaScript Promise 不可外部中断，
 * abort 命中时 handler 内部必须主动在检查点调用 throwIfAborted 抛出 ToolAbortError；
 * BaseTool 在执行边界（入口/批量项间）内置检查点，handler 作者在循环/批处理内放置检查点。
 *
 * 分层约束：shared 包只定义消费面接口，禁止引用 AbortController（创建面由 G 层 backend 持有）。
 */

/**
 * 最小结构取消信号接口（D6.3）。
 *
 * 结构化兼容标准 AbortSignal（Node ≥ 18 / DOM）：
 * 真实 AbortSignal 实例可直接赋值给本接口（TS 结构化类型），
 * shared 包无需引用 DOM lib 或 @types/node 的全局类型。
 *
 * 只含消费面（aborted/reason/throwIfAborted/addEventListener），
 * 创建面（AbortController）由 G 层持有。
 */
export interface ToolAbortSignal {
  /** 是否已取消 */
  readonly aborted: boolean;
  /** 取消原因（AbortController.abort(reason) 传入值） */
  readonly reason?: unknown;
  /** 已取消时抛出（标准 AbortSignal 同名方法语义，真实 signal 原生能力透传） */
  throwIfAborted?: () => void;
  /** 监听 abort 事件（一次性语义由调用方保证 { once: true }） */
  addEventListener?: (type: 'abort', listener: () => void, options?: { once?: boolean }) => void;
  removeEventListener?: (type: 'abort', listener: () => void) => void;
}

/**
 * 工具取消错误。
 *
 * 协作式取消的唯一错误类型：handler 检查点抛出，
 * BaseTool.executeSingle catch 后规范化为 {success:false, aborted:true}。
 * name 固定 'ToolAbortError' 供 isAbortError 判别。
 */
export class ToolAbortError extends Error {
  public readonly reason?: unknown;

  constructor(message?: string, reason?: unknown) {
    super(message ?? '工具执行已取消');
    this.name = 'ToolAbortError';
    this.reason = reason;
  }
}

/**
 * 判别捕获的错误是否为取消错误（BaseTool 规范化分支用）。
 * instanceof 覆盖同域实例；name 检查覆盖跨域/模块重复加载场景。
 */
export function isAbortError(error: unknown): error is ToolAbortError {
  return (
    error instanceof ToolAbortError ||
    (error instanceof Error && error.name === 'ToolAbortError')
  );
}

/** reason 提取为人类可读文案（aborted 响应 error 字段用） */
export function abortReasonToMessage(reason: unknown): string {
  if (reason === undefined || reason === null) return '外部请求已取消';
  if (typeof reason === 'string') return reason;
  if (reason instanceof Error) return reason.message;
  try {
    return String(reason);
  } catch {
    return '外部请求已取消';
  }
}

/**
 * 已取消则抛 ToolAbortError。
 *
 * 检查点辅助函数，handler 作者在以下位置调用：
 * - 批量/循环每项开始前
 * - 长耗时阶段边界（如 LLM 辅助调用前后）
 * - 事务开启前
 *
 * 优先委托 signal.throwIfAborted()（真实 AbortSignal 原生语义），
 * 原生抛出的非 ToolAbortError（DOMException/reason 原值）统一规范化为 ToolAbortError；
 * 方法缺失时回退检查 signal.aborted 手动抛出（简版字面量 signal 兼容）。
 */
export function throwIfAborted(signal: ToolAbortSignal | undefined): void {
  if (!signal) return;

  if (signal.throwIfAborted) {
    try {
      signal.throwIfAborted();
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new ToolAbortError(
        `工具执行已取消：${abortReasonToMessage(signal.reason)}`,
        signal.reason,
      );
    }
  }

  if (signal.aborted) {
    throw new ToolAbortError(
      `工具执行已取消：${abortReasonToMessage(signal.reason)}`,
      signal.reason,
    );
  }
}
