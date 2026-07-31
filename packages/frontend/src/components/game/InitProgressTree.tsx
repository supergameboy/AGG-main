import { cn } from '@/utils/cn';
import type { ProgressTreeState } from '@/types/progress';
import { computeTreeProgress } from '@/types/progress';
import { ProgressNodeComponent } from './ProgressNode';

interface InitProgressTreeProps {
  tree: ProgressTreeState | null;
  onRetry?: () => void;
}

export function InitProgressTree({ tree, onRetry }: InitProgressTreeProps) {
  if (!tree) return null;

  const progress = computeTreeProgress(tree);
  const allNodes = Object.values(tree.nodes);
  const hasFatalError = allNodes.some(n => n.fatal);
  const rootNodes = tree.rootIds.map(id => tree.nodes[id]).filter(Boolean);

  return (
    <div className="flex flex-col items-center py-4">
      <div className="mb-5 flex items-center gap-2.5">
        {hasFatalError ? (
          <span className="h-5 w-5 text-[var(--error)] font-bold">!</span>
        ) : progress >= 100 ? (
          <span className="h-5 w-5 text-[var(--success)]">✓</span>
        ) : (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
        )}
        <span className="font-game text-lg font-bold text-[var(--text-primary)]">
          {hasFatalError ? '初始化失败' : progress >= 100 ? '初始化完成' : '正在初始化游戏世界...'}
        </span>
      </div>

      <div className="w-full space-y-2">
        {rootNodes.map((rootNode) => (
          <div key={rootNode.id}>
            <ProgressNodeComponent node={rootNode} depth={0} />
            {rootNode.childIds.map((childId) => {
              const childNode = tree.nodes[childId];
              if (!childNode) return null;
              return (
                <ProgressNodeComponent key={childId} node={childNode} depth={1} />
              );
            })}
          </div>
        ))}
      </div>

      {hasFatalError && onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors"
        >
          重试
        </button>
      )}

      <div className="mt-5 w-full">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-primary)]">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500 ease-out',
              progress >= 100 ? 'bg-[var(--success)]' : hasFatalError ? 'bg-[var(--error)]' : 'bg-[var(--accent)]'
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-1.5 text-center text-xs text-[var(--text-muted)]">{progress}%</p>
      </div>
    </div>
  );
}
