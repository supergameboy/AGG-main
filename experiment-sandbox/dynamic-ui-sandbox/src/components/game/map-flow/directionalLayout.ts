import type { MermaidDirection } from './parseMermaidToFlowData';

export interface DirectionalLayoutOptions {
  /** 层间距（主轴：LR/RL 为 x，TB/TD/BT 为 y） */
  levelGap?: number;
  /** 同层节点间距（交叉轴） */
  siblingGap?: number;
}

/**
 * 按 mermaid 方向声明做分层布局：LR/RL 沿 x 轴推进，TB/TD/BT 沿 y 轴推进。
 * 层级由 BFS 从根节点（无入边）推导；环或孤岛节点追加到末层之后，保证全部节点有坐标。
 */
export function directionalLayout(
  nodeIds: string[],
  edges: Array<{ from: string; to: string }>,
  direction: MermaidDirection,
  options?: DirectionalLayoutOptions
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodeIds.length === 0) return positions;

  const levelGap = options?.levelGap ?? 220;
  const siblingGap = options?.siblingGap ?? 120;

  const childMap = new Map<string, string[]>();
  const parentCount = new Map<string, number>();
  for (const id of nodeIds) {
    childMap.set(id, []);
    parentCount.set(id, 0);
  }
  for (const e of edges) {
    if (childMap.has(e.from) && childMap.has(e.to)) {
      childMap.get(e.from)!.push(e.to);
      parentCount.set(e.to, (parentCount.get(e.to) ?? 0) + 1);
    }
  }

  const roots = nodeIds.filter((id) => (parentCount.get(id) ?? 0) === 0);
  const visited = new Set<string>();
  const levelNodes = new Map<number, string[]>();

  const queue: Array<{ id: string; level: number }> = roots.map((id) => ({ id, level: 0 }));
  while (queue.length > 0) {
    const { id, level } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (!levelNodes.has(level)) levelNodes.set(level, []);
    levelNodes.get(level)!.push(id);
    for (const child of childMap.get(id) ?? []) {
      if (!visited.has(child)) {
        queue.push({ id: child, level: level + 1 });
      }
    }
  }

  for (const id of nodeIds) {
    if (!visited.has(id)) {
      const level = Math.max(0, ...levelNodes.keys()) + 1;
      if (!levelNodes.has(level)) levelNodes.set(level, []);
      levelNodes.get(level)!.push(id);
    }
  }

  const horizontal = direction === 'LR' || direction === 'RL';
  const reverse = direction === 'RL' || direction === 'BT';

  for (const [level, ids] of levelNodes) {
    const span = (ids.length - 1) * siblingGap;
    for (let i = 0; i < ids.length; i++) {
      const main = level * levelGap * (reverse ? -1 : 1);
      const cross = -span / 2 + i * siblingGap;
      positions.set(ids[i], horizontal ? { x: main, y: cross } : { x: cross, y: main });
    }
  }

  return positions;
}

/**
 * 方向对应的连接点方位：LR 右出左入，RL 左出右入，TB/TD 下出上入，BT 上出下入。
 * 配合节点上的 `s-{side}` / `t-{side}` Handle id 使用。
 */
export function directionHandleSides(direction: MermaidDirection): { source: string; target: string } {
  switch (direction) {
    case 'LR': return { source: 'right', target: 'left' };
    case 'RL': return { source: 'left', target: 'right' };
    case 'BT': return { source: 'top', target: 'bottom' };
    default: return { source: 'bottom', target: 'top' };
  }
}
