import { useState, useMemo, useRef, useEffect, useCallback, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  BugAntIcon,
  InformationCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  TrashIcon,
  ArrowDownTrayIcon,
  MagnifyingGlassIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ServerIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { Tabs } from '@/components/ui/Tabs';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useLogStore } from '@/stores/logStore';
import type { LogLevel, LogCategory, DevLogEntry } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DevLogPanelProps {
  className?: string;
}

type LevelFilter = LogLevel | 'all';
type CategoryFilter = LogCategory | 'all';

// ---------------------------------------------------------------------------
// Level & Category configuration
// ---------------------------------------------------------------------------

const LEVEL_CONFIG: Record<LogLevel, { color: string; icon: typeof BugAntIcon; label: string }> = {
  debug: { color: '#94a3b8', icon: BugAntIcon, label: 'Debug' },
  info: { color: '#3b82f6', icon: InformationCircleIcon, label: 'Info' },
  warn: { color: '#f59e0b', icon: ExclamationTriangleIcon, label: 'Warn' },
  error: { color: '#ef4444', icon: XCircleIcon, label: 'Error' },
};

const CATEGORY_CONFIG: Record<LogCategory, { label: string }> = {
  system: { label: '系统运行' },
  api: { label: 'API请求' },
  websocket: { label: 'WebSocket' },
  agent: { label: 'Agent决策' },
  error: { label: '错误' },
  ui: { label: 'UI交互' },
  performance: { label: '性能' },
  snapshot: { label: '快照' },
  consistency: { label: '一致性' },
  state: { label: '状态' },
  network: { label: '网络' },
};

const LEVEL_FILTER_OPTIONS: { key: LevelFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'debug', label: 'Debug' },
  { key: 'info', label: 'Info' },
  { key: 'warn', label: 'Warn' },
  { key: 'error', label: 'Error' },
];

const CATEGORY_FILTER_OPTIONS: { key: CategoryFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'system', label: '系统' },
  { key: 'api', label: 'API' },
  { key: 'websocket', label: 'WS' },
  { key: 'agent', label: 'Agent' },
  { key: 'error', label: '错误' },
  { key: 'ui', label: 'UI' },
  { key: 'performance', label: '性能' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

function formatJson(data: unknown): string {
  if (data === undefined || data === null) return '';
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function downloadJson(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// LogEntryRow - individual log entry with expand/collapse
// ---------------------------------------------------------------------------

interface LogEntryRowProps {
  entry: DevLogEntry;
  isExpanded: boolean;
  onToggle: () => void;
}

const LogEntryRow = memo(function LogEntryRow({ entry, isExpanded, onToggle }: LogEntryRowProps) {
  const levelCfg = LEVEL_CONFIG[entry.level];
  const categoryCfg = CATEGORY_CONFIG[entry.category];
  const Icon = levelCfg.icon;

  const hasDetails = entry.data !== undefined || entry.stackTrace !== undefined;

  return (
    <div
      className={cn(
        'cursor-pointer rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--bg-secondary)]',
        isExpanded && 'bg-[var(--bg-secondary)]'
      )}
      onClick={onToggle}
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: levelCfg.color }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge customColor={levelCfg.color} size="sm">
              {levelCfg.label}
            </Badge>
            <Badge variant="default" size="sm">
              {categoryCfg.label}
            </Badge>
            <span className="text-[10px] text-[var(--text-muted)] font-mono">
              {formatTime(entry.timestamp)}
            </span>
            {entry.source && (
              <span className="text-[10px] text-[var(--text-secondary)] font-mono truncate max-w-[120px]">
                [{entry.source}]
              </span>
            )}
            {hasDetails && (
              isExpanded
                ? <ChevronDownIcon className="h-3 w-3 text-[var(--text-muted)] shrink-0" />
                : <ChevronRightIcon className="h-3 w-3 text-[var(--text-muted)] shrink-0" />
            )}
          </div>
          <p className="mt-0.5 text-xs text-[var(--text-primary)] leading-relaxed break-all">
            {entry.message}
          </p>
          {isExpanded && (
            <div className="mt-1 space-y-1 border-t border-[var(--border-primary)] pt-1">
              {entry.data !== undefined && (
                <div>
                  <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                    Data
                  </span>
                  <pre className="mt-0.5 text-[11px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap break-all bg-[var(--bg-tertiary)] rounded p-1.5 font-mono max-h-60 overflow-y-auto scrollbar-thin">
                    {formatJson(entry.data)}
                  </pre>
                </div>
              )}
              {entry.stackTrace && (
                <div>
                  <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                    Stack Trace
                  </span>
                  <pre className="mt-0.5 text-[11px] text-[var(--error)]/80 leading-relaxed whitespace-pre-wrap break-all bg-[var(--bg-tertiary)] rounded p-1.5 font-mono max-h-40 overflow-y-auto scrollbar-thin">
                    {entry.stackTrace}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// DevLogPanel - main component
// ---------------------------------------------------------------------------

export const DevLogPanel = memo(function DevLogPanel({ className }: DevLogPanelProps) {
  // ---- Store bindings ----
  const filter = useLogStore((s) => s.filter);
  const setFilter = useLogStore((s) => s.setFilter);
  const clearEntries = useLogStore((s) => s.clearEntries);
  const exportLogs = useLogStore((s) => s.exportLogs);
  const persistToBackend = useLogStore((s) => s.persistToBackend);
  const setPersistToBackend = useLogStore((s) => s.setPersistToBackend);
  const autoScroll = useLogStore((s) => s.autoScroll);
  const setAutoScroll = useLogStore((s) => s.setAutoScroll);
  const isCapturing = useLogStore((s) => s.isCapturing);
  const startCapturing = useLogStore((s) => s.startCapturing);
  const stopCapturing = useLogStore((s) => s.stopCapturing);
  const entriesCount = useLogStore((s) => s.entries.length);

  // ---- Local state ----
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(filter.search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  // ---- Debounced search ----
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setFilter({ search: value });
      }, 300);
    },
    [setFilter]
  );

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ---- Filtered entries ----
  const filteredEntries = useLogStore((s) => s.getFilteredEntries());

  // ---- Level filter counts ----
  const levelCounts = useMemo(() => {
    const allEntries = useLogStore.getState().entries;
    const counts: Record<string, number> = { all: allEntries.length };
    for (const entry of allEntries) {
      counts[entry.level] = (counts[entry.level] || 0) + 1;
    }
    return counts;
  }, [entriesCount]);

  // ---- Category filter counts ----
  const categoryCounts = useMemo(() => {
    const allEntries = useLogStore.getState().entries;
    const counts: Record<string, number> = { all: allEntries.length };
    for (const entry of allEntries) {
      counts[entry.category] = (counts[entry.category] || 0) + 1;
    }
    return counts;
  }, [entriesCount]);

  // ---- Level tabs ----
  const levelTabs = useMemo(() => {
    return LEVEL_FILTER_OPTIONS
      .filter((opt) => opt.key === 'all' || (levelCounts[opt.key] || 0) > 0)
      .map((opt) => ({
        id: opt.key,
        label: opt.label,
        count: levelCounts[opt.key] || 0,
      }));
  }, [levelCounts]);

  // ---- Category tabs ----
  const categoryTabs = useMemo(() => {
    return CATEGORY_FILTER_OPTIONS
      .filter((opt) => opt.key === 'all' || (categoryCounts[opt.key] || 0) > 0)
      .map((opt) => ({
        id: opt.key,
        label: opt.label,
        count: categoryCounts[opt.key] || 0,
      }));
  }, [categoryCounts]);

  // ---- Virtualizer ----
  const virtualizer = useVirtualizer({
    count: filteredEntries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const entry = filteredEntries[index];
      if (expandedId === entry?.id) {
        return 160;
      }
      return 48;
    },
    overscan: 10,
  });

  // ---- Auto-scroll ----
  useEffect(() => {
    if (autoScroll && filteredEntries.length > 0) {
      virtualizer.scrollToIndex(filteredEntries.length - 1, { align: 'end' });
    }
  }, [filteredEntries.length, autoScroll, virtualizer]);

  // ---- Detect manual scroll to disable auto-scroll ----
  const handleScroll = useCallback(() => {
    if (!parentRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 60;
    if (!isNearBottom && autoScroll) {
      setAutoScroll(false);
    }
  }, [autoScroll, setAutoScroll]);

  // ---- Actions ----
  const handleClear = useCallback(() => {
    clearEntries();
    setExpandedId(null);
  }, [clearEntries]);

  const handleExport = useCallback(() => {
    const json = exportLogs();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadJson(json, `dev-logs-${timestamp}.json`);
  }, [exportLogs]);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const handleToggleCapture = useCallback(() => {
    if (isCapturing) {
      stopCapturing();
    } else {
      startCapturing();
    }
  }, [isCapturing, startCapturing, stopCapturing]);

  const handleToggleAutoScroll = useCallback(() => {
    setAutoScroll(!autoScroll);
  }, [autoScroll, setAutoScroll]);

  // ---- Render ----
  return (
    <Card variant="default" padding="md" className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <DocumentTextIcon className="h-4 w-4 text-[var(--text-muted)]" />
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            DevLog
          </span>
          <Badge variant="default" size="sm">
            {filteredEntries.length}/{entriesCount}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={isCapturing ? 'primary' : 'ghost'}
            size="sm"
            onClick={handleToggleCapture}
            className="text-[10px]"
          >
            {isCapturing ? '采集中' : '开始采集'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowDownTrayIcon className="h-3 w-3" />}
            onClick={handleExport}
            disabled={entriesCount === 0}
          >
            导出
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<TrashIcon className="h-3 w-3" />}
            onClick={handleClear}
            disabled={entriesCount === 0}
          >
            清空
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-2">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
        <input
          type="text"
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="搜索日志..."
          className={cn(
            'h-8 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] pl-8 pr-3',
            'text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
            'focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20',
            'transition-all duration-150'
          )}
        />
      </div>

      {/* Level filter tabs */}
      <Tabs
        tabs={levelTabs}
        activeTab={filter.level}
        onTabChange={(id) => setFilter({ level: id as LevelFilter })}
        variant="pill"
        size="sm"
        className="mb-1"
      />

      {/* Category filter tabs */}
      <Tabs
        tabs={categoryTabs}
        activeTab={filter.category}
        onTabChange={(id) => setFilter({ category: id as CategoryFilter })}
        variant="pill"
        size="sm"
        className="mb-2"
      />

      {/* Toolbar: auto-scroll + persist toggle */}
      <div className="flex items-center justify-between mb-2 px-1">
        <button
          onClick={handleToggleAutoScroll}
          className={cn(
            'text-[10px] px-2 py-0.5 rounded-full transition-colors cursor-pointer border-none outline-none',
            autoScroll
              ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
          )}
        >
          {autoScroll ? '自动滚动: 开' : '自动滚动: 关'}
        </button>
        <button
          onClick={() => setPersistToBackend(!persistToBackend)}
          className={cn(
            'text-[10px] px-2 py-0.5 rounded-full transition-colors inline-flex items-center gap-1 cursor-pointer border-none outline-none',
            persistToBackend
              ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
          )}
        >
          <ServerIcon className="h-3 w-3" />
          {persistToBackend ? '后端持久化: 开' : '后端持久化: 关'}
        </button>
      </div>

      {/* Virtual scroll list */}
      <div
        ref={parentRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto scrollbar-thin"
      >
        {filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-[var(--text-muted)]">
            <DocumentTextIcon className="mb-2 h-8 w-8 opacity-30" />
            <p className="text-sm">暂无日志</p>
            {!isCapturing && (
              <p className="text-xs mt-1">点击"开始采集"捕获系统日志</p>
            )}
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const entry = filteredEntries[virtualRow.index];
              return (
                <div
                  key={entry.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <LogEntryRow
                    entry={entry}
                    isExpanded={expandedId === entry.id}
                    onToggle={() => handleToggleExpand(entry.id)}
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
