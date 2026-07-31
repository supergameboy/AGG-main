/**
 * 优先级队列（镜像模块2 §4.2.5：二叉最小堆 + 去重 Set）
 * 主排序键 priority 升序（0 最高），次排序键 enqueuedAt 升序（FIFO）。
 */

export interface QueueItem {
  readonly priority: number;
  readonly enqueuedAt: number;
  readonly dedupeKey: string;
}

export class PriorityQueue<T extends QueueItem> {
  private heap: T[] = [];
  private dedupe = new Set<string>();

  enqueue(item: T): boolean {
    if (this.dedupe.has(item.dedupeKey)) return false;
    this.dedupe.add(item.dedupeKey);
    this.heap.push(item);
    this.bubbleUp(this.heap.length - 1);
    return true;
  }

  dequeue(): T | null {
    if (this.heap.length === 0) return null;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    this.dedupe.delete(top.dedupeKey);
    return top;
  }

  peek(): T | null {
    return this.heap[0] ?? null;
  }

  has(dedupeKey: string): boolean {
    return this.dedupe.has(dedupeKey);
  }

  remove(dedupeKey: string): boolean {
    const idx = this.heap.findIndex((i) => i.dedupeKey === dedupeKey);
    if (idx < 0) return false;
    const last = this.heap.pop()!;
    if (idx < this.heap.length) {
      this.heap[idx] = last;
      this.bubbleUp(idx);
      this.sinkDown(idx);
    }
    this.dedupe.delete(dedupeKey);
    return true;
  }

  clear(): void {
    this.heap = [];
    this.dedupe.clear();
  }

  size(): number {
    return this.heap.length;
  }

  list(): readonly T[] {
    return [...this.heap].sort((a, b) => a.priority - b.priority || a.enqueuedAt - b.enqueuedAt);
  }

  private less(a: T, b: T): boolean {
    return a.priority < b.priority || (a.priority === b.priority && a.enqueuedAt < b.enqueuedAt);
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(this.heap[i], this.heap[parent])) {
        [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
        i = parent;
      } else break;
    }
  }

  private sinkDown(i: number): void {
    const n = this.heap.length;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let smallest = i;
      if (l < n && this.less(this.heap[l], this.heap[smallest])) smallest = l;
      if (r < n && this.less(this.heap[r], this.heap[smallest])) smallest = r;
      if (smallest === i) break;
      [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
      i = smallest;
    }
  }
}
