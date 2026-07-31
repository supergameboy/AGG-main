import { cn } from '@/utils/cn';
import type { ProgressTreeState } from '@/types/progress';
import { ProgressNodeComponent, formatToolDisplayName } from './ProgressNode';

interface ChatProgressTreeProps {
  tree: ProgressTreeState | null;
}

const PHASE_LABELS_ZH: Record<string, string> = {
  task_start: '开始',
  thinking: '思考中',
  tool_call: '调用工具',
  tool_result: '获取结果',
  iteration: '迭代中',
  sub_agent_start: '委派子任务',
  sub_agent_end: '子任务完成',
  task_end: '完成',
  error: '出错',
};

export function ChatProgressTree({ tree }: ChatProgressTreeProps) {
  if (!tree) return null;

  const allNodes = Object.values(tree.nodes);
  const activeNodes = tree.activeNodeIds
    .map(id => tree.nodes[id])
    .filter(n => n && n.status === 'running');

  const doneNodes = allNodes.filter(n => n.status === 'done' && !tree.activeNodeIds.includes(n.id));
  const failedNodes = allNodes.filter(n => n.status === 'failed');

  if (activeNodes.length === 0 && doneNodes.length === 0 && failedNodes.length === 0) return null;

  return (
    <div
      className={cn(
        'rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]/50 px-3 py-2 transition-opacity duration-500',
        tree.fadingOut && 'opacity-0'
      )}
    >
      {/* 已完成任务收缩为一行 */}
      {doneNodes.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-x-3 gap-y-1">
          {doneNodes.map((node) => (
            <ProgressNodeComponent key={node.id} node={node} compact />
          ))}
        </div>
      )}

      {/* 失败节点 */}
      {failedNodes.map((node) => (
        <ProgressNodeComponent key={node.id} node={node} depth={0} />
      ))}

      {/* 当前运行中的操作 */}
      {activeNodes.map((node) => {
        const phaseLabel = node.currentPhase ? PHASE_LABELS_ZH[node.currentPhase] ?? node.currentPhase : '';
        let detailText = '';
        if (node.currentPhase === 'thinking' && (node.latestDetail as { thought?: string })?.thought) {
          detailText = (node.latestDetail as { thought?: string }).thought!;
        } else if (node.currentPhase === 'tool_call' && (node.latestDetail as { toolName?: string })?.toolName) {
          detailText = formatToolDisplayName((node.latestDetail as { toolName?: string }).toolName!);
        } else if (node.currentPhase === 'tool_result' && (node.latestDetail as { toolName?: string })?.toolName) {
          detailText = formatToolDisplayName((node.latestDetail as { toolName?: string }).toolName!);
        }

        return (
          <div key={node.id} className="flex items-center gap-2 py-0.5">
            <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
            <span className="text-xs font-medium text-[var(--accent)]">{node.displayDescription}</span>
            <span className="text-[10px] text-[var(--text-muted)]">
              {phaseLabel}{detailText ? `: ${detailText}` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}
