import { useState, useMemo, useCallback } from 'react';
import {
  ShieldCheckIcon,
  PlayIcon,
  ArrowDownTrayIcon,
  FunnelIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { useConsistencyStore, type MismatchItem, type WSEventChainItem } from '@/stores/consistencyStore';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

interface ConsistencyTabProps {
  className?: string;
}

type MismatchFilter = 'all' | 'missing' | 'different' | 'extra';

const MISMATCH_TYPE_CONFIG: Record<MismatchItem['mismatchType'], { label: string; variant: 'error' | 'warning' | 'info' }> = {
  missing: { label: '缺失', variant: 'error' },
  different: { label: '不同', variant: 'warning' },
  extra: { label: '多余', variant: 'info' },
};

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

function formatValue(value: unknown): string {
  if (value === undefined) return '(undefined)';
  if (value === null) return '(null)';
  if (typeof value === 'string') return `"${value.length > 50 ? value.slice(0, 50) + '...' : value}"`;
  if (typeof value === 'object') {
    try {
      const str = JSON.stringify(value);
      return str.length > 80 ? str.slice(0, 80) + '...' : str;
    } catch {
      return '[Object]';
    }
  }
  return String(value);
}

export function ConsistencyTab({ className }: ConsistencyTabProps) {
  const isChecking = useConsistencyStore((s) => s.isChecking);
  const lastCheckTime = useConsistencyStore((s) => s.lastCheckTime);
  const mismatches = useConsistencyStore((s) => s.mismatches);
  const wsEventChain = useConsistencyStore((s) => s.wsEventChain);
  const checkError = useConsistencyStore((s) => s.checkError);
  const runConsistencyCheck = useConsistencyStore((s) => s.runConsistencyCheck);
  const clearResults = useConsistencyStore((s) => s.clearResults);
  const exportReport = useConsistencyStore((s) => s.exportReport);

  const [storeFilter, setStoreFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<MismatchFilter>('all');

  const storeNames = useMemo(() => {
    const names = new Set(mismatches.map((m) => m.storeName));
    return Array.from(names).sort();
  }, [mismatches]);

  const backendOnlyItems = useMemo(() => {
    return mismatches.filter((m) => m.isBackendOnly);
  }, [mismatches]);

  const comparisonMismatches = useMemo(() => {
    return mismatches.filter((m) => !m.isBackendOnly);
  }, [mismatches]);

  const filteredMismatches = useMemo(() => {
    return comparisonMismatches.filter((m) => {
      if (storeFilter !== 'all' && m.storeName !== storeFilter) return false;
      if (typeFilter !== 'all' && m.mismatchType !== typeFilter) return false;
      return true;
    });
  }, [comparisonMismatches, storeFilter, typeFilter]);

  const mismatchCounts = useMemo(() => {
    const counts = { missing: 0, different: 0, extra: 0 };
    for (const m of mismatches) {
      counts[m.mismatchType]++;
    }
    return counts;
  }, [mismatches]);

  const handleRunCheck = useCallback(() => {
    runConsistencyCheck();
  }, [runConsistencyCheck]);

  const handleExport = useCallback(() => {
    const json = exportReport();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `consistency-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportReport]);

  return (
    <div className={cn('flex h-full flex-col gap-3', className)}>
      <div className="flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            icon={<PlayIcon className="h-4 w-4" />}
            loading={isChecking}
            onClick={handleRunCheck}
          >
            运行一致性检查
          </Button>
          {isChecking && (
            <span className="text-xs text-[var(--text-muted)] animate-pulse">检查中...</span>
          )}
          {checkError && (
            <span className="text-xs text-[var(--error)]">{checkError}</span>
          )}
          {!isChecking && !checkError && lastCheckTime && (
            <span className="text-xs text-[var(--text-muted)]">
              上次检查: {formatTime(lastCheckTime)}
            </span>
          )}
          {!isChecking && !checkError && !lastCheckTime && (
            <span className="text-xs text-[var(--text-muted)]">尚未检查</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {mismatches.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearResults}>
              清空
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            icon={<ArrowDownTrayIcon className="h-4 w-4" />}
            onClick={handleExport}
            disabled={mismatches.length === 0 && wsEventChain.length === 0}
          >
            导出报告
          </Button>
        </div>
      </div>

      {mismatches.length > 0 && (
        <div className="flex items-center gap-2 shrink-0">
          <FunnelIcon className="h-4 w-4 text-[var(--text-muted)]" />
          <select
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
            className="h-7 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 text-xs text-[var(--text-primary)]"
          >
            <option value="all">全部 Store</option>
            {storeNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as MismatchFilter)}
            className="h-7 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 text-xs text-[var(--text-primary)]"
          >
            <option value="all">全部类型</option>
            <option value="missing">缺失 ({mismatchCounts.missing})</option>
            <option value="different">不同 ({mismatchCounts.different})</option>
            <option value="extra">多余 ({mismatchCounts.extra})</option>
          </select>
          <span className="text-xs text-[var(--text-muted)]">
            {filteredMismatches.length}/{mismatches.length} 项
          </span>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        {mismatches.length === 0 && wsEventChain.length === 0 && !isChecking && (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <ShieldCheckIcon className="h-10 w-10 text-[var(--text-muted)] opacity-30" />
            <p className="text-sm text-[var(--text-secondary)]">点击"运行一致性检查"开始</p>
          </div>
        )}

        {filteredMismatches.length > 0 && (
          <div className="mb-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              不一致项 ({filteredMismatches.length})
            </h3>
            <div className="space-y-1">
              {filteredMismatches.map((m, i) => (
                <MismatchRow key={`${m.storeName}-${m.fieldPath}-${i}`} item={m} />
              ))}
            </div>
          </div>
        )}

        {backendOnlyItems.length > 0 && (
          <div className="mb-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              后端独有数据 ({backendOnlyItems.length})
            </h3>
            <div className="space-y-1">
              {backendOnlyItems.map((m, i) => (
                <BackendOnlyRow key={`${m.storeName}-${i}`} item={m} />
              ))}
            </div>
          </div>
        )}

        {wsEventChain.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              WS 事件追踪链 ({wsEventChain.length})
            </h3>
            <div className="space-y-1">
              {wsEventChain.map((event, i) => (
                <WSEventRow key={`${event.eventType}-${event.timestamp}-${i}`} item={event} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MismatchRow({ item }: { item: MismatchItem }) {
  const config = MISMATCH_TYPE_CONFIG[item.mismatchType];
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        'rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)]',
        item.mismatchType === 'missing' && 'border-l-2 border-l-[var(--error)]',
        item.mismatchType === 'different' && 'border-l-2 border-l-[var(--warning)]',
        item.mismatchType === 'extra' && 'border-l-2 border-l-[var(--info)]'
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="shrink-0 text-xs font-mono text-[var(--text-secondary)]">
          {item.storeName}
        </span>
        <span className="shrink-0 text-[var(--border-primary)]">/</span>
        <span className="truncate text-xs text-[var(--text-muted)]">
          {item.fieldPath || '(root)'}
        </span>
        <Badge variant={config.variant} size="sm" className="ml-auto shrink-0">
          {config.label}
        </Badge>
      </button>
      {expanded && (
        <div className="border-t border-[var(--border-primary)] px-3 py-2 space-y-1">
          <div className="flex items-start gap-2 text-xs">
            <span className="shrink-0 w-16 text-[var(--text-muted)]">前端值:</span>
            <code className="break-all text-[var(--info)]">{formatValue(item.frontendValue)}</code>
          </div>
          <div className="flex items-start gap-2 text-xs">
            <span className="shrink-0 w-16 text-[var(--text-muted)]">后端值:</span>
            <code className="break-all text-[var(--warning)]">{formatValue(item.backendValue)}</code>
          </div>
        </div>
      )}
    </div>
  );
}

function WSEventRow({ item }: { item: WSEventChainItem }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 py-1.5',
        !item.storeUpdated && 'border-l-2 border-l-[var(--error)]'
      )}
    >
      <span className="text-xs font-mono text-[var(--text-secondary)]">{item.eventType}</span>
      <span className="text-xs text-[var(--text-muted)]">{formatTime(item.timestamp)}</span>
      {item.category && (
        <span className="rounded bg-[var(--bg-tertiary)] px-1 py-0.5 text-[10px] text-[var(--text-muted)]">{item.category}</span>
      )}
      {item.source && (
        <span className="rounded bg-[var(--bg-tertiary)] px-1 py-0.5 text-[10px] text-[var(--text-muted)]">{item.source}</span>
      )}
      {item.storeUpdated ? (
        <CheckCircleIcon className="h-4 w-4 text-[var(--success)]" />
      ) : (
        <XCircleIcon className="h-4 w-4 text-[var(--error)]" />
      )}
      {item.updatedStores.length > 0 && (
        <div className="flex items-center gap-1">
          <ExclamationTriangleIcon className="h-3 w-3 text-[var(--text-muted)]" />
          <span className="text-xs text-[var(--text-muted)]">
            {item.updatedStores.join(', ')}
          </span>
        </div>
      )}
      {!item.storeUpdated && (
        <span className="text-xs text-[var(--error)]">未触发Store更新</span>
      )}
    </div>
  );
}

function BackendOnlyRow({ item }: { item: MismatchItem }) {
  const [expanded, setExpanded] = useState(false);
  const recordCount = Array.isArray(item.backendValue) ? item.backendValue.length : 0;

  return (
    <div className="rounded-md border border-[var(--border-primary)] border-l-2 border-l-[var(--info)] bg-[var(--bg-card)]">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="shrink-0 text-xs font-mono text-[var(--text-secondary)]">
          {item.storeName}
        </span>
        <span className="text-xs text-[var(--text-muted)]">
          {recordCount} 条记录
        </span>
        <Badge variant="info" size="sm" className="ml-auto shrink-0">
          仅后端
        </Badge>
      </button>
      {expanded && (
        <div className="border-t border-[var(--border-primary)] px-3 py-2">
          <code className="block max-h-40 overflow-auto break-all text-xs text-[var(--text-muted)]">
            {formatValue(item.backendValue)}
          </code>
        </div>
      )}
    </div>
  );
}
