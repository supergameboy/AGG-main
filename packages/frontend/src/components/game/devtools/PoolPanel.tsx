import { useState, useEffect, useCallback, memo } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { useGameStore } from '@/stores/gameStore';
import { gameApi } from '@/api/gameApi';
import type { TemplateSkillPoolEntry, TemplateItemPoolEntry, SkillPoolEntry, ItemPoolEntry } from '@/types';

interface PoolPanelProps {
  className?: string;
}

type PoolSubTab = 'template_skills' | 'template_items' | 'save_skills' | 'save_items';

const SUB_TABS: { id: PoolSubTab; label: string }[] = [
  { id: 'template_skills', label: '模板技能' },
  { id: 'template_items', label: '模板物品' },
  { id: 'save_skills', label: '存档技能' },
  { id: 'save_items', label: '存档物品' },
];

interface PoolStats {
  templatePool: {
    skillCount: number;
    itemCount: number;
    skillCategories: Record<string, number>;
    itemCategories: Record<string, number>;
  };
  savePool: {
    skillCount: number;
    learnedCount: number;
    itemCount: number;
    takenCount: number;
  };
}

interface PoolDisplayEntry {
  id: string;
  name: string;
  category?: string;
  quality?: string;
  description?: string;
  learned?: boolean;
  taken?: boolean;
}

type PoolEntrySource = TemplateSkillPoolEntry | TemplateItemPoolEntry | SkillPoolEntry | ItemPoolEntry;

function toDisplayEntry(entry: PoolEntrySource): PoolDisplayEntry {
  return {
    id: entry.id,
    name: entry.name,
    category: entry.category,
    quality: 'quality' in entry ? (entry.quality as string) : undefined,
    description: entry.description,
    learned: 'learned' in entry ? (entry as SkillPoolEntry).learned : undefined,
    taken: 'taken' in entry ? (entry as ItemPoolEntry).taken : undefined,
  };
}

export const PoolPanel = memo(function PoolPanel({ className }: PoolPanelProps) {
  const saveId = useGameStore((s) => s.saveId);
  const [activeSubTab, setActiveSubTab] = useState<PoolSubTab>('template_skills');
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [entries, setEntries] = useState<PoolDisplayEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const loadStats = useCallback(async () => {
    if (!saveId) return;
    try {
      const data = await gameApi.getPoolStats(saveId);
      setStats(data);
    } catch {
      // stats fetch failure is non-critical
    }
  }, [saveId]);

  const loadEntries = useCallback(async () => {
    if (!saveId) return;
    setLoading(true);
    try {
      let result: PoolDisplayEntry[] = [];
      switch (activeSubTab) {
        case 'template_skills': {
          const data = await gameApi.getPoolTemplateSkills(saveId);
          result = (data.skills ?? []).map(toDisplayEntry);
          break;
        }
        case 'template_items': {
          const data = await gameApi.getPoolTemplateItems(saveId);
          result = (data.items ?? []).map(toDisplayEntry);
          break;
        }
        case 'save_skills': {
          const data = await gameApi.getPoolSaveSkills(saveId);
          result = (data.skills ?? []).map(toDisplayEntry);
          break;
        }
        case 'save_items': {
          const data = await gameApi.getPoolSaveItems(saveId);
          result = (data.items ?? []).map(toDisplayEntry);
          break;
        }
      }
      setEntries(result);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [saveId, activeSubTab]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const handleRefresh = useCallback(() => {
    loadStats();
    loadEntries();
  }, [loadStats, loadEntries]);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/5 shrink-0">
        <span className="text-xs font-medium text-[var(--text-secondary)]">池数据</span>
        <button
          onClick={handleRefresh}
          disabled={!saveId}
          className={cn(
            'flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors',
            saveId
              ? 'text-[var(--text-secondary)] hover:bg-white/5 hover:text-[var(--text-primary)]'
              : 'text-[var(--text-muted)] cursor-not-allowed'
          )}
        >
          <ArrowPathIcon className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          刷新
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-1.5 px-2 py-2 border-b border-white/5 shrink-0">
          <div className="rounded bg-white/5 px-2 py-1.5 text-center">
            <div className="text-lg font-semibold text-[var(--accent)]">{stats.templatePool.skillCount}</div>
            <div className="text-[10px] text-[var(--text-muted)]">模板技能</div>
          </div>
          <div className="rounded bg-white/5 px-2 py-1.5 text-center">
            <div className="text-lg font-semibold text-[var(--accent)]">{stats.templatePool.itemCount}</div>
            <div className="text-[10px] text-[var(--text-muted)]">模板物品</div>
          </div>
          <div className="rounded bg-white/5 px-2 py-1.5 text-center">
            <div className="text-lg font-semibold text-green-400">{stats.savePool.learnedCount}/{stats.savePool.skillCount}</div>
            <div className="text-[10px] text-[var(--text-muted)]">存档技能(已学/总数)</div>
          </div>
          <div className="rounded bg-white/5 px-2 py-1.5 text-center">
            <div className="text-lg font-semibold text-green-400">{stats.savePool.takenCount}/{stats.savePool.itemCount}</div>
            <div className="text-[10px] text-[var(--text-muted)]">存档物品(已取/总数)</div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1 px-2 py-1.5 border-b border-white/5 shrink-0">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
              activeSubTab === tab.id
                ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                : 'text-[var(--text-secondary)] hover:bg-white/5 hover:text-[var(--text-primary)]'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {!saveId ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-[var(--text-muted)]">需要先加载存档</p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--border-primary)] border-t-[var(--accent)]" />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-[var(--text-muted)]">暂无数据</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {entries.map((entry, index) => (
              <div
                key={entry.id ?? index}
                className="px-2 py-1.5 border-b border-white/5 hover:bg-white/5"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                    {entry.name ?? `#${index + 1}`}
                  </span>
                  {entry.category && (
                    <span className="rounded-full bg-[var(--accent)]/10 px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
                      {entry.category}
                    </span>
                  )}
                  {entry.quality && (
                    <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                      {entry.quality}
                    </span>
                  )}
                  {entry.learned !== undefined && (
                    <span className={cn(
                      'rounded-full px-1.5 py-0.5 text-[10px]',
                      entry.learned ? 'bg-green-500/10 text-green-400' : 'bg-white/5 text-[var(--text-muted)]'
                    )}>
                      {entry.learned ? '已学' : '未学'}
                    </span>
                  )}
                  {entry.taken !== undefined && (
                    <span className={cn(
                      'rounded-full px-1.5 py-0.5 text-[10px]',
                      entry.taken ? 'bg-green-500/10 text-green-400' : 'bg-white/5 text-[var(--text-muted)]'
                    )}>
                      {entry.taken ? '已取' : '未取'}
                    </span>
                  )}
                </div>
                {entry.description && (
                  <p className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">{entry.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
