/**
 * EventStream 泛型类 — 事件流基础设施
 *
 * 与 pi 参考项目的 AssistantMessageEventStream 完全对齐：
 * - 异步迭代（AsyncIterable）
 * - 队列缓冲（防止生产速度快于消费速度时事件丢失）
 * - 完成信号（end）与错误传播（fail）
 * - 最终结果提取（result）
 * - 泛型化（T=事件类型，R=最终结果类型，可被 M2 多模态 / M9 dispatcher 复用）
 *
 * 设计文档: docs/design/solution-design-20260726-pi-reference-upgrade/模块M1 §6.1
 */
export class EventStream<T, R = T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private waiting: Array<(value: IteratorResult<T>) => void> = [];
  private done = false;
  private error: Error | null = null;

  private finalResultPromise: Promise<R>;
  private resolveFinalResult!: (result: R) => void;
  private rejectFinalResult!: (error: Error) => void;

  private readonly isComplete: (event: T) => boolean;
  private readonly extractResult: (event: T) => R;

  constructor(
    isComplete: (event: T) => boolean,
    extractResult: (event: T) => R
  ) {
    this.isComplete = isComplete;
    this.extractResult = extractResult;

    this.finalResultPromise = new Promise<R>((resolve, reject) => {
      this.resolveFinalResult = resolve;
      this.rejectFinalResult = reject;
    });
    // 抑制 unhandled rejection：仅用 for-await 消费（不调用 result()）时，
    // fail() 触发的 promise 拒绝不应成为未处理拒绝；错误已通过迭代器 throw 传播，
    // result() 调用方仍会收到同一个拒绝的 promise。
    this.finalResultPromise.catch(() => {});
  }

  /**
   * 推送事件到流中
   * 如果事件满足 isComplete 条件，自动触发 end()
   */
  push(event: T): void {
    if (this.done) {
      throw new Error('EventStream already ended');
    }

    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      resolve({ value: event, done: false });
    } else {
      this.queue.push(event);
    }

    if (this.isComplete(event)) {
      this.end(this.extractResult(event));
    }
  }

  /**
   * 结束事件流
   * @param result 最终结果（可选，若未提供则使用最后一个事件的 extractResult）
   */
  end(result?: R): void {
    if (this.done) return;

    this.done = true;

    while (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      resolve({ value: undefined as T, done: true });
    }

    if (result !== undefined) {
      this.resolveFinalResult(result);
    } else if (this.queue.length > 0) {
      const lastEvent = this.queue[this.queue.length - 1];
      this.resolveFinalResult(this.extractResult(lastEvent));
    } else {
      this.rejectFinalResult(new Error('EventStream ended without result'));
    }
  }

  /**
   * 标记流错误
   */
  fail(error: Error): void {
    if (this.done) return;

    this.done = true;
    this.error = error;

    while (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      resolve({ value: undefined as T, done: true });
    }

    this.rejectFinalResult(error);
  }

  /**
   * 异步迭代器
   */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
        continue;
      }

      if (this.done) {
        if (this.error) throw this.error;
        return;
      }

      const result = await new Promise<IteratorResult<T>>((resolve) => {
        this.waiting.push(resolve);
      });

      if (result.done) {
        if (this.error) throw this.error;
        return;
      }

      yield result.value;
    }
  }

  /**
   * 获取最终结果（等待流结束）
   */
  async result(): Promise<R> {
    return this.finalResultPromise;
  }

  /**
   * 检查流是否已结束
   */
  get isDone(): boolean {
    return this.done;
  }
}
