import { useState, useMemo, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ClipboardDocumentListIcon, CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { Tabs } from '@/components/ui/Tabs';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { Button } from '@/components/ui/Button';
import { resolveQuestDisplay } from '@/utils/customDataResolver';
import { findEntityByIdOrName } from '@/utils/entityFilter';
import type { Quest as SharedQuest, QuestStatus as SharedQuestStatus, QuestType as SharedQuestType, QuestObjective as SharedQuestObjective, FrontendNPCInfo } from '@/types';

type QuestStatus = SharedQuestStatus;
type QuestType = SharedQuestType;
type QuestObjective = SharedQuestObjective;
type Quest = SharedQuest;
type NPCInfo = FrontendNPCInfo;

interface QuestPanelProps {
  quests: Quest[];
  npcInfoList?: NPCInfo[];
  onQuestSelect?: (quest: Quest) => void;
  onQuestAccept?: (questId: string) => void;
  onQuestAbandon?: (questId: string) => void;
  className?: string;
}

const TYPE_COLORS: Record<QuestType, string> = {
  main: 'var(--error, #ef4444)',
  side: 'var(--info, #3b82f6)',
  daily: 'var(--success, #22c55e)',
  weekly: 'var(--accent, #a855f7)',
  chain: 'var(--warning, #f97316)',
  repeatable: 'var(--info, #06b6d4)',
};

type FilterTab = 'all' | 'active' | 'available' | 'completed' | 'failed';

const FILTER_KEYS: FilterTab[] = ['all', 'active', 'available', 'completed', 'failed'];

const STATUS_ICONS: Record<QuestStatus, typeof CheckCircleIcon | null> = {
  locked: null,
  available: ExclamationCircleIcon,
  active: ClipboardDocumentListIcon,
  completed: CheckCircleIcon,
  failed: ExclamationCircleIcon,
};

const STATUS_COLORS: Record<QuestStatus, string> = {
  locked: 'text-[var(--text-muted)]',
  available: 'text-[var(--accent)]',
  active: 'text-[var(--accent)]',
  completed: 'text-[var(--success)]',
  failed: 'text-[var(--error)]',
};

const ObjectiveProgress = memo(function ObjectiveProgress({ objective }: { objective: QuestObjective }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className={cn(
          'text-xs',
          objective.completed ? 'text-[var(--success)] line-through' : 'text-[var(--text-secondary)]',
        )}>
          {objective.description}
        </span>
      </div>
      <Progress
        value={objective.current}
        max={objective.required}
        variant={objective.completed ? 'experience' : 'default'}
        size="sm"
        showLabel
      />
    </div>
  );
});

const QuestCard = memo(function QuestCard({
  quest,
  allQuests,
  npcInfoList,
  isExpanded,
  onToggle,
  onSelect,
  onAccept,
  onAbandon,
  scrollToQuest,
}: {
  quest: Quest;
  allQuests: Quest[];
  npcInfoList?: NPCInfo[];
  isExpanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onAccept: () => void;
  onAbandon: () => void;
  scrollToQuest: (questId: string) => void;
}) {
  const { t } = useTranslation('game');
  const StatusIcon = STATUS_ICONS[quest.status];
  const display = useMemo(() => resolveQuestDisplay(quest), [quest]);

  return (
    <Card
      id={`quest-${quest.id}`}
      variant="default"
      padding="none"
      accentSide={quest.status === 'active' ? 'left' : 'none'}
      accentColor={quest.status === 'active' ? 'var(--accent)' : undefined}
      className={cn(
        'overflow-hidden rounded-lg',
        quest.status === 'completed' && 'opacity-60',
      )}
    >
      <button
        onClick={() => {
          onToggle();
          onSelect();
        }}
        className="flex w-full items-center gap-3 p-3 text-left cursor-pointer hover:bg-[var(--bg-primary)] transition-colors duration-150"
      >
        {StatusIcon && (
          <StatusIcon className={cn('h-4 w-4 shrink-0', STATUS_COLORS[quest.status])} />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text-primary)] truncate">
              {quest.name}
            </span>
            <Badge size="sm" customColor={TYPE_COLORS[quest.type]}>
              {t(`quests.type.${quest.type}`)}
            </Badge>
            {display.prerequisiteQuestIds.length > 0 && quest.status === 'locked' && (
              <Badge variant="default" size="sm">{t('quests.prerequisite')}</Badge>
            )}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-1">
            {quest.description}
          </p>
        </div>
        <svg
          className={cn(
            'h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform duration-200',
            isExpanded && 'rotate-180',
          )}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
        <div className="border-t border-[var(--border-primary)] px-3 pb-3 pt-2 space-y-3">
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
            {quest.description}
          </p>

          {quest.objectives.length > 0 && (
            <div className="space-y-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {t('quests.objectives')}
              </span>
              {quest.objectives.map((obj) => (
                <ObjectiveProgress key={obj.id} objective={obj} />
              ))}
            </div>
          )}

          {quest.rewards && (quest.rewards.experience || quest.rewards.gold || quest.rewards.currency || quest.rewards.items?.length || quest.rewards.skills?.length) && (
            <div className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {t('quests.rewards')}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {quest.rewards.experience != null && quest.rewards.experience > 0 && (
                  <span className="text-xs font-medium" style={{ color: 'var(--experience, #a855f7)' }}>
                    经验 +{quest.rewards.experience}
                  </span>
                )}
                {quest.rewards.gold != null && quest.rewards.gold > 0 && (
                  <span className="text-xs font-medium" style={{ color: 'var(--gold, #f59e0b)' }}>
                    金币 +{quest.rewards.gold}
                  </span>
                )}
                {quest.rewards.currency && Object.entries(quest.rewards.currency).map(([id, amount]) => (
                  <span key={id} className="text-xs font-medium" style={{ color: 'var(--accent, #a855f7)' }}>
                    {id} +{amount}
                  </span>
                ))}
                {quest.rewards.items?.map((item, i) => (
                  <span key={i} className="text-xs font-medium" style={{ color: 'var(--info, #3b82f6)' }}>
                    {item.itemName || item.itemId} x{item.quantity}
                  </span>
                ))}
                {quest.rewards.skills?.map((skill, i) => (
                  <span key={i} className="text-xs font-medium" style={{ color: 'var(--success, #22c55e)' }}>
                    {skill.skillName || skill.skillId}
                  </span>
                ))}
              </div>
            </div>
          )}

          {quest.giver_npc_id && (
            <div className="text-xs text-[var(--text-muted)]">
              发布者: {findEntityByIdOrName(npcInfoList ?? [], { id: quest.giver_npc_id })?.name ?? quest.giver_npc_id}
            </div>
          )}

          {quest.prerequisite_quest_ids.length > 0 && (
            <div className="text-xs text-[var(--text-muted)]">
              前置: {quest.prerequisite_quest_ids.map((id, i) => {
                const prereq = allQuests.find((q) => q.id === id);
                return prereq ? (
                  <span key={id}>
                    {i > 0 && '、'}
                    <button
                      type="button"
                      className="text-[var(--accent)] hover:underline cursor-pointer"
                      onClick={(e) => { e.stopPropagation(); scrollToQuest(id); }}
                    >
                      {prereq.name}
                    </button>
                  </span>
                ) : null;
              })}
            </div>
          )}

          {quest.quest_chain_id && allQuests
            .filter((q) => q.quest_chain_id === quest.quest_chain_id && q.prerequisite_quest_ids.includes(quest.id))
            .length > 0 && (
            <div className="text-xs text-[var(--text-muted)]">
              后续: {allQuests
                .filter((q) => q.quest_chain_id === quest.quest_chain_id && q.prerequisite_quest_ids.includes(quest.id))
                .map((nextQuest, i) => (
                  <span key={nextQuest.id}>
                    {i > 0 && '、'}
                    <button
                      type="button"
                      className="text-[var(--accent)] hover:underline cursor-pointer"
                      onClick={(e) => { e.stopPropagation(); scrollToQuest(nextQuest.id); }}
                    >
                      {nextQuest.name}
                    </button>
                  </span>
                ))}
            </div>
          )}

          {quest.time_limit > 0 && (
            <div className="text-xs text-[var(--text-muted)]">
              限时任务（时间系统待实现）
            </div>
          )}

          <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-[var(--border-primary)]">
            {quest.status === 'available' && (
              <Button
                variant="primary"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onAccept();
                }}
              >
                {t('quests.accept')}
              </Button>
            )}
            {quest.status === 'active' && (
              <Button
                variant="outline"
                size="sm"
                hoverColor="var(--error, #ef4444)"
                onClick={(e) => {
                  e.stopPropagation();
                  onAbandon();
                }}
              >
                {t('quests.abandon')}
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
});

export const QuestPanel = memo(function QuestPanel({
  quests,
  npcInfoList,
  onQuestSelect,
  onQuestAccept,
  onQuestAbandon,
  className,
}: QuestPanelProps) {
  const { t } = useTranslation('game');
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [expandedQuestId, setExpandedQuestId] = useState<string | null>(null);

  const visibleQuests = useMemo(() => quests.filter((q) => q.visible !== false), [quests]);

  const filteredQuests = useMemo(() => {
    switch (activeFilter) {
      case 'active':
        return visibleQuests.filter((q) => q.status === 'active');
      case 'available':
        return visibleQuests.filter((q) => q.status === 'available');
      case 'completed':
        return visibleQuests.filter((q) => q.status === 'completed');
      case 'failed':
        return visibleQuests.filter((q) => q.status === 'failed');
      default:
        return visibleQuests;
    }
  }, [visibleQuests, activeFilter]);

  const filterCounts = useMemo(() => ({
    all: visibleQuests.length,
    active: visibleQuests.filter((q) => q.status === 'active').length,
    available: visibleQuests.filter((q) => q.status === 'available').length,
    completed: visibleQuests.filter((q) => q.status === 'completed').length,
    failed: visibleQuests.filter((q) => q.status === 'failed').length,
  }), [visibleQuests]);

  const handleToggle = (questId: string) => {
    setExpandedQuestId((prev) => (prev === questId ? null : questId));
  };

  const scrollToQuest = (questId: string) => {
    setExpandedQuestId(questId);
    requestAnimationFrame(() => {
      const element = document.getElementById(`quest-${questId}`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: filteredQuests.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 3,
    measureElement: (el) => el?.getBoundingClientRect().height ?? 120,
  });

  const filterTabs = useMemo(() => FILTER_KEYS.map((key) => ({
    id: key,
    label: t(`quests.filter.${key}`),
    count: filterCounts[key],
  })), [filterCounts, t]);

  return (
    <Card
      variant="default"
      padding="md"
      className={cn('flex flex-col gap-3', className)}
    >
      <Tabs
        tabs={filterTabs}
        activeTab={activeFilter}
        onTabChange={(id) => setActiveFilter(id as FilterTab)}
        variant="pill"
        size="sm"
      />

      <div ref={parentRef} className="overflow-y-auto scrollbar-thin" style={{ maxHeight: 'calc(100vh - 200px)' }}>
        {filteredQuests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-[var(--text-muted)]">
            <ClipboardDocumentListIcon className="h-8 w-8 mb-2 opacity-40" />
            <span className="text-xs">{t('quests.noQuests')}</span>
          </div>
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const quest = filteredQuests[virtualItem.index];
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <QuestCard
                    quest={quest}
                    allQuests={visibleQuests}
                    npcInfoList={npcInfoList}
                    isExpanded={expandedQuestId === quest.id}
                    onToggle={() => handleToggle(quest.id)}
                    onSelect={() => onQuestSelect?.(quest)}
                    onAccept={() => onQuestAccept?.(quest.id)}
                    onAbandon={() => onQuestAbandon?.(quest.id)}
                    scrollToQuest={scrollToQuest}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
});