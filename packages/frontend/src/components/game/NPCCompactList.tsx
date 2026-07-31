import { memo, useCallback } from 'react';
import { UsersIcon, ChatBubbleLeftIcon } from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';

interface NPCCompactListProps {
  npcs: Array<{ id: string; name: string; role?: string }>;
  targetNpcIds?: string[];
  onToggleTargetNpc?: (npcId: string) => void;
  title?: string;
  className?: string;
}

export const NPCCompactList = memo(function NPCCompactList({
  npcs,
  targetNpcIds,
  onToggleTargetNpc,
  title = '此地NPC',
  className,
}: NPCCompactListProps) {
  const handleClick = useCallback(
    (npcId: string) => () => onToggleTargetNpc?.(npcId),
    [onToggleTargetNpc],
  );

  if (npcs.length === 0) return null;

  return (
    <div className={cn(className)}>
      <div className="flex items-center gap-1.5 mb-1">
        <UsersIcon className="h-3 w-3 text-[var(--accent)]" />
        <span className="text-[10px] font-medium text-[var(--text-muted)]">
          {title} ({npcs.length})
        </span>
      </div>
      <div className="space-y-1">
        {npcs.map((npc) => {
          const isTarget = targetNpcIds?.includes(npc.id);
          return (
            <button
              key={npc.id}
              type="button"
              onClick={onToggleTargetNpc ? handleClick(npc.id) : undefined}
              className={cn(
                "flex items-center gap-1.5 w-full rounded-md px-1.5 py-1 text-left transition-colors hover:bg-[var(--bg-primary)]",
                isTarget && "bg-[var(--accent)]/10"
              )}
            >
              <div className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] text-white",
                isTarget ? "bg-[var(--accent)]" : "bg-[var(--accent)]/60"
              )}>
                {npc.name[0]}
              </div>
              <span className={cn(
                "text-[10px] truncate",
                isTarget ? "text-[var(--accent)] font-medium" : "text-[var(--text-primary)]"
              )}>
                {npc.name}
              </span>
              {npc.role && (
                <span className="text-[8px] text-[var(--text-muted)]">{npc.role}</span>
              )}
              <ChatBubbleLeftIcon className={cn(
                "h-2.5 w-2.5 ml-auto",
                isTarget ? "text-[var(--accent)]" : "text-[var(--accent)]/50"
              )} />
            </button>
          );
        })}
      </div>
    </div>
  );
});
