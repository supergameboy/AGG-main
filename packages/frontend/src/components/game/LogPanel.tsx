import { useState, useMemo, useRef, useEffect, memo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  DocumentTextIcon,
  TrashIcon,
  FireIcon,
  ChatBubbleLeftRightIcon,
  ClipboardDocumentListIcon,
  Cog6ToothIcon,
  SparklesIcon,
  GlobeAltIcon,
  BookOpenIcon,
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { Tabs } from '@/components/ui/Tabs';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { StoryHistoryEvent } from '@/api/gameApi';

interface LogEntry {
  id: string;
  type: 'combat' | 'dialogue' | 'quest' | 'system' | 'event' | 'exploration';
  message: string;
  timestamp: number;
  details?: string;
}

interface StoryHistoryPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface LogPanelProps {
  logs: LogEntry[];
  storyHistory?: StoryHistoryEvent[];
  storyHistoryPagination?: StoryHistoryPagination | null;
  isStoryHistoryLoading?: boolean;
  onStoryHistoryPageChange?: (page: number) => void;
  onLogSelect?: (log: LogEntry) => void;
  onClear?: () => void;
  initialTrack?: TrackTab;
  className?: string;
}

type LogFilter = 'all' | 'combat' | 'dialogue' | 'quest' | 'system' | 'event' | 'exploration';
type TrackTab = 'instant' | 'major';

const LOG_TYPE_CONFIG: Record<LogEntry['type'], { icon: typeof FireIcon; color: string; label: string }> = {
  combat: { icon: FireIcon, color: 'var(--error, #ef4444)', label: '战斗' },
  dialogue: { icon: ChatBubbleLeftRightIcon, color: 'var(--accent, #3b82f6)', label: '对话' },
  quest: { icon: ClipboardDocumentListIcon, color: 'var(--success, #22c55e)', label: '任务' },
  system: { icon: Cog6ToothIcon, color: 'var(--text-muted, #94a3b8)', label: '系统' },
  event: { icon: SparklesIcon, color: 'var(--experience, #a855f7)', label: '事件' },
  exploration: { icon: GlobeAltIcon, color: 'var(--info, #06b6d4)', label: '探索' },
};

const IMPORTANCE_CONFIG: Record<string, { color: string; label: string }> = {
  critical: { color: 'var(--error, #ef4444)', label: '关键' },
  major: { color: 'var(--warning, #f59e0b)', label: '重要' },
  minor: { color: 'var(--text-muted, #94a3b8)', label: '一般' },
};

const FILTER_OPTIONS: { key: LogFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'combat', label: '战斗' },
  { key: 'dialogue', label: '对话' },
  { key: 'quest', label: '任务' },
  { key: 'system', label: '系统' },
  { key: 'event', label: '事件' },
  { key: 'exploration', label: '探索' },
];

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}/${d.getDate()} ${formatTime(timestamp)}`;
}

export const LogPanel = memo(function LogPanel({
  logs,
  storyHistory,
  storyHistoryPagination,
  isStoryHistoryLoading,
  onStoryHistoryPageChange,
  onLogSelect,
  onClear,
  initialTrack,
  className,
}: LogPanelProps) {
  const [track, setTrack] = useState<TrackTab>(initialTrack ?? 'instant');
  const [filter, setFilter] = useState<LogFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const logListRef = useRef<HTMLDivElement>(null);
  const storyListRef = useRef<HTMLDivElement>(null);

  const filteredLogs = useMemo(() => {
    if (filter === 'all') return logs;
    return logs.filter((l) => l.type === filter);
  }, [logs, filter]);

  const logVirtualizer = useVirtualizer({
    count: filteredLogs.length,
    getScrollElement: () => logListRef.current,
    estimateSize: () => 40,
    overscan: 10,
    measureElement: el => el?.getBoundingClientRect().height ?? 40,
  });

  const storyVirtualizer = useVirtualizer({
    count: storyHistory?.length ?? 0,
    getScrollElement: () => storyListRef.current,
    estimateSize: () => 60,
    overscan: 5,
    measureElement: el => el?.getBoundingClientRect().height ?? 60,
  });

  const filterCounts = useMemo(() => {
    const counts: Record<string, number> = { all: logs.length };
    for (const log of logs) {
      counts[log.type] = (counts[log.type] || 0) + 1;
    }
    return counts;
  }, [logs]);

  const tabs = useMemo(() => {
    return FILTER_OPTIONS
      .filter((opt) => opt.key === 'all' || (filterCounts[opt.key] || 0) > 0)
      .map((opt) => ({
        id: opt.key,
        label: opt.label,
        count: filterCounts[opt.key] || 0,
      }));
  }, [filterCounts]);

  const trackTabs = useMemo(() => {
    const result: { id: string; label: string; count?: number }[] = [
      { id: 'instant', label: '即时日志', count: logs.length },
    ];
    if (storyHistory !== undefined) {
      result.push({ id: 'major', label: '重大记录', count: storyHistoryPagination?.total });
    }
    return result;
  }, [logs.length, storyHistory, storyHistoryPagination]);

  useEffect(() => {
    if (logListRef.current && track === 'instant') {
      logListRef.current.scrollTop = logListRef.current.scrollHeight;
    }
  }, [filteredLogs.length, track]);

  const handlePageChange = useCallback(
    (direction: 'prev' | 'next') => {
      if (!onStoryHistoryPageChange || !storyHistoryPagination) return;
      const newPage = direction === 'prev'
        ? Math.max(1, storyHistoryPagination.page - 1)
        : Math.min(storyHistoryPagination.totalPages, storyHistoryPagination.page + 1);
      onStoryHistoryPageChange(newPage);
    },
    [onStoryHistoryPageChange, storyHistoryPagination],
  );

  return (
    <Card variant="default" padding="md" className={cn('flex h-full flex-col', className)}>
      <div className="flex items-center justify-between pb-2">
        <Tabs
          tabs={trackTabs}
          activeTab={track}
          onTabChange={(id) => setTrack(id as TrackTab)}
          variant="pill"
          size="sm"
        />
        {track === 'instant' && onClear && logs.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            icon={<TrashIcon className="h-3 w-3" />}
            onClick={onClear}
          >
            清空
          </Button>
        )}
      </div>

      {track === 'instant' && (
        <>
          <Tabs
            tabs={tabs}
            activeTab={filter}
            onTabChange={(id) => setFilter(id as LogFilter)}
            variant="pill"
            size="sm"
            className="mb-2"
          />

          <div ref={logListRef} className="flex-1 overflow-y-auto scrollbar-thin">
            {filteredLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-[var(--text-muted)]">
                <DocumentTextIcon className="mb-2 h-8 w-8 opacity-30" />
                <p className="text-sm">暂无记录</p>
              </div>
            ) : (
              <div style={{ height: `${logVirtualizer.getTotalSize()}px`, position: 'relative' }}>
                {logVirtualizer.getVirtualItems().map((virtualItem) => {
                  const log = filteredLogs[virtualItem.index];
                  const config = LOG_TYPE_CONFIG[log.type];
                  const Icon = config.icon;
                  const isExpanded = expandedId === log.id;
                  return (
                    <div
                      key={virtualItem.key}
                      data-index={virtualItem.index}
                      ref={logVirtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                      className={cn(
                        'cursor-pointer rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--bg-secondary)]',
                        isExpanded && 'bg-[var(--bg-secondary)]'
                      )}
                      onClick={() => {
                        setExpandedId(isExpanded ? null : log.id);
                        onLogSelect?.(log);
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: config.color }} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Badge customColor={config.color} size="sm">
                              {config.label}
                            </Badge>
                            <span className="text-[10px] text-[var(--text-muted)]">
                              {formatTime(log.timestamp)}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-[var(--text-primary)] leading-relaxed">
                            {log.message}
                          </p>
                          {isExpanded && log.details && (
                            <p className="mt-1 text-xs text-[var(--text-secondary)] leading-relaxed border-t border-[var(--border-primary)] pt-1">
                              {log.details}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {track === 'major' && (
        <>
          {isStoryHistoryLoading && (
            <div className="flex items-center justify-center py-4 text-[var(--text-muted)]">
              <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
              <span className="text-sm">加载中...</span>
            </div>
          )}

          {!isStoryHistoryLoading && (!storyHistory || storyHistory.length === 0) && (
            <div className="flex flex-col items-center justify-center py-8 text-[var(--text-muted)]">
              <BookOpenIcon className="mb-2 h-8 w-8 opacity-30" />
              <p className="text-sm">暂无重大记录</p>
            </div>
          )}

          {!isStoryHistoryLoading && storyHistory && storyHistory.length > 0 && (
            <div ref={storyListRef} className="flex-1 overflow-y-auto scrollbar-thin">
              <div style={{ height: `${storyVirtualizer.getTotalSize()}px`, position: 'relative' }}>
                {storyVirtualizer.getVirtualItems().map((virtualItem) => {
                  const event = storyHistory[virtualItem.index];
                  const importance = IMPORTANCE_CONFIG[event.importance] ?? IMPORTANCE_CONFIG.minor;
                  const isExpanded = expandedId === event.id;
                  return (
                    <div
                      key={virtualItem.key}
                      data-index={virtualItem.index}
                      ref={storyVirtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                      className={cn(
                        'cursor-pointer rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--bg-secondary)]',
                        isExpanded && 'bg-[var(--bg-secondary)]'
                      )}
                      onClick={() => setExpandedId(isExpanded ? null : event.id)}
                    >
                      <div className="flex items-start gap-2">
                        <BookOpenIcon
                          className="mt-0.5 h-3.5 w-3.5 shrink-0"
                          style={{ color: importance.color }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Badge customColor={importance.color} size="sm">
                              {importance.label}
                            </Badge>
                            {event.chapter && (
                              <span className="text-[10px] text-[var(--text-muted)]">
                                {event.chapter}
                              </span>
                            )}
                            <span className="text-[10px] text-[var(--text-muted)]">
                              {formatDate(event.timestamp)}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-[var(--text-primary)] leading-relaxed font-medium">
                            {event.title}
                          </p>
                          {isExpanded && (
                            <div className="mt-1 space-y-1 border-t border-[var(--border-primary)] pt-1">
                              {event.description && (
                                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                                  {event.description}
                                </p>
                              )}
                              {event.event_type && (
                                <p className="text-[10px] text-[var(--text-muted)]">
                                  类型：{event.event_type}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {storyHistoryPagination && storyHistoryPagination.totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-[var(--border-primary)] pt-2 mt-2">
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {storyHistoryPagination.page} / {storyHistoryPagination.totalPages}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<ChevronLeftIcon className="h-3 w-3" />}
                      disabled={storyHistoryPagination.page <= 1}
                      onClick={() => handlePageChange('prev')}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<ChevronRightIcon className="h-3 w-3" />}
                      disabled={storyHistoryPagination.page >= storyHistoryPagination.totalPages}
                      onClick={() => handlePageChange('next')}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
});
