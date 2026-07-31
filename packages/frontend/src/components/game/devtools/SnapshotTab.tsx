import { useState, useCallback, useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  CameraIcon,
  PlayIcon,
  PauseIcon,
  TrashIcon,
  ArrowDownTrayIcon,
  ArrowsRightLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { useSnapshotStore, type FieldDiff } from '@/stores/snapshotStore';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

interface SnapshotTabProps {
  className?: string;
}

const INTERVAL_OPTIONS = [
  { label: '10s', value: 10000 },
  { label: '30s', value: 30000 },
  { label: '60s', value: 60000 },
  { label: '300s', value: 300000 },
];

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${formatTime(ts)}`;
}

function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}...${id.slice(-4)}`;
}

function StoreTreeView({
  name,
  data,
  depth = 0,
}: {
  name: string;
  data: unknown;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 1);

  if (data === null || data === undefined) {
    return (
      <div style={{ paddingLeft: depth * 16 }} className="py-0.5">
        <span className="text-[var(--text-secondary)]">{name}:</span>{' '}
        <span className="text-[var(--text-muted)]">{String(data)}</span>
      </div>
    );
  }

  if (typeof data !== 'object') {
    return (
      <div style={{ paddingLeft: depth * 16 }} className="py-0.5">
        <span className="text-[var(--text-secondary)]">{name}:</span>{' '}
        <span className="text-[var(--accent)]">{JSON.stringify(data)}</span>
      </div>
    );
  }

  const isArr = Array.isArray(data);
  const entries = isArr
    ? data.map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(data as Record<string, unknown>);

  const entryCount = entries.length;

  return (
    <div>
      <button
        className="flex items-center gap-1 py-0.5 text-left w-full bg-transparent border-none cursor-pointer text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] rounded px-1"
        style={{ paddingLeft: depth * 16 }}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDownIcon className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRightIcon className="h-3 w-3 shrink-0" />
        )}
        <span className="font-medium text-[var(--text-primary)]">{name}</span>
        <span className="text-xs text-[var(--text-muted)]">
          {isArr ? `[${entryCount}]` : `{${entryCount}}`}
        </span>
      </button>
      {expanded &&
        entries.map(([key, value]) => (
          <StoreTreeView key={key} name={key} data={value} depth={depth + 1} />
        ))}
    </div>
  );
}

function DiffView({ diffs }: { diffs: Record<string, FieldDiff[]> }) {
  const [expandedStores, setExpandedStores] = useState<Set<string>>(new Set());

  const toggleStore = useCallback((storeName: string) => {
    setExpandedStores((prev) => {
      const next = new Set(prev);
      if (next.has(storeName)) {
        next.delete(storeName);
      } else {
        next.add(storeName);
      }
      return next;
    });
  }, []);

  const storeNames = Object.keys(diffs);

  if (storeNames.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-[var(--text-muted)] text-sm">
        No differences found
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {storeNames.map((storeName) => {
        const storeDiffs = diffs[storeName];
        const isExpanded = expandedStores.has(storeName);
        const added = storeDiffs.filter((d) => d.type === 'added').length;
        const removed = storeDiffs.filter((d) => d.type === 'removed').length;
        const changed = storeDiffs.filter((d) => d.type === 'changed').length;

        return (
          <div key={storeName} className="border border-[var(--border-primary)] rounded-lg">
            <button
              className="flex items-center gap-2 w-full px-3 py-2 bg-transparent border-none cursor-pointer text-left hover:bg-[var(--bg-secondary)] rounded-lg"
              onClick={() => toggleStore(storeName)}
            >
              {isExpanded ? (
                <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
              ) : (
                <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
              )}
              <span className="font-medium text-sm text-[var(--text-primary)]">{storeName}</span>
              <div className="flex gap-1.5 ml-auto">
                {added > 0 && (
                  <Badge variant="success" size="sm">
                    +{added}
                  </Badge>
                )}
                {removed > 0 && (
                  <Badge variant="error" size="sm">
                    -{removed}
                  </Badge>
                )}
                {changed > 0 && (
                  <Badge variant="warning" size="sm">
                    ~{changed}
                  </Badge>
                )}
              </div>
            </button>
            {isExpanded && (
              <div className="px-3 pb-2 space-y-0.5">
                {storeDiffs.map((diff, idx) => (
                  <DiffItem key={`${diff.path}-${idx}`} diff={diff} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DiffItem({ diff }: { diff: FieldDiff }) {
  const colorMap: Record<string, string> = {
    added: 'text-[var(--success)]',
    removed: 'text-[var(--error)]',
    changed: 'text-[var(--warning)]',
  };

  const bgMap: Record<string, string> = {
    added: 'bg-[var(--success)]/5',
    removed: 'bg-[var(--error)]/5',
    changed: 'bg-[var(--warning)]/5',
  };

  const labelMap: Record<string, string> = {
    added: '+',
    removed: '-',
    changed: '~',
  };

  return (
    <div
      className={cn(
        'flex items-start gap-2 px-2 py-1 rounded text-xs font-mono',
        bgMap[diff.type]
      )}
    >
      <span className={cn('font-bold shrink-0', colorMap[diff.type])}>
        {labelMap[diff.type]}
      </span>
      <span className="text-[var(--text-secondary)] shrink-0">{diff.path || '(root)'}</span>
      {diff.type === 'added' && (
        <span className="text-[var(--success)] truncate">
          {JSON.stringify(diff.newValue)}
        </span>
      )}
      {diff.type === 'removed' && (
        <span className="text-[var(--error)] truncate">
          {JSON.stringify(diff.oldValue)}
        </span>
      )}
      {diff.type === 'changed' && (
        <span className="truncate">
          <span className="text-[var(--error)]">{JSON.stringify(diff.oldValue)}</span>
          <span className="text-[var(--text-muted)] mx-1">{'->'}</span>
          <span className="text-[var(--success)]">{JSON.stringify(diff.newValue)}</span>
        </span>
      )}
    </div>
  );
}

export function SnapshotTab({ className }: SnapshotTabProps) {
  const {
    snapshots,
    selectedSnapshotId,
    diffResult,
    autoSnapshotEnabled,
    autoSnapshotInterval,
    snapshotDataCache,
    captureSnapshot,
    deleteSnapshot,
    selectSnapshot,
    setCompareIds,
    compareSnapshots,
    setAutoSnapshot,
    exportSnapshot,
    exportDiffResult,
    fetchSnapshots,
  } = useSnapshotStore();

  const [isCapturing, setIsCapturing] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [detailMode, setDetailMode] = useState<'single' | 'compare'>('single');
  const [intervalValue, setIntervalValue] = useState(autoSnapshotInterval);
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSnapshots();
  }, [fetchSnapshots]);

  const handleCapture = useCallback(async () => {
    setIsCapturing(true);
    await captureSnapshot('manual');
    setIsCapturing(false);
  }, [captureSnapshot]);

  const handleAutoToggle = useCallback(() => {
    setAutoSnapshot(!autoSnapshotEnabled, intervalValue);
  }, [autoSnapshotEnabled, intervalValue, setAutoSnapshot]);

  const handleCompare = useCallback(async () => {
    if (selectedForCompare.length === 2) {
      setCompareIds([selectedForCompare[0], selectedForCompare[1]]);
      setIsComparing(true);
      await compareSnapshots();
      setIsComparing(false);
      setDetailMode('compare');
    }
  }, [selectedForCompare, setCompareIds, compareSnapshots]);

  const handleCheckboxToggle = useCallback(
    (id: string) => {
      setSelectedForCompare((prev) => {
        if (prev.includes(id)) {
          return prev.filter((x) => x !== id);
        }
        if (prev.length >= 2) {
          return [prev[1], id];
        }
        return [...prev, id];
      });
    },
    []
  );

  const handleExport = useCallback(() => {
    if (detailMode === 'compare' && diffResult) {
      const json = exportDiffResult();
      if (json) {
        downloadJson(json, `snapshot-diff-${diffResult.snapshotId1}-${diffResult.snapshotId2}.json`);
      }
    } else if (selectedSnapshotId) {
      const json = exportSnapshot(selectedSnapshotId);
      if (json) {
        downloadJson(json, `snapshot-${selectedSnapshotId}.json`);
      }
    }
  }, [detailMode, diffResult, selectedSnapshotId, exportSnapshot, exportDiffResult]);

  const handleDelete = useCallback(async () => {
    if (selectedSnapshotId) {
      await deleteSnapshot(selectedSnapshotId);
    }
  }, [selectedSnapshotId, deleteSnapshot]);

  const selectedSnapshotData = selectedSnapshotId
    ? snapshotDataCache[selectedSnapshotId]
    : null;

  const rowVirtualizer = useVirtualizer({
    count: snapshots.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

  return (
    <div className={cn('flex h-full flex-col min-h-0', className)}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-primary)] shrink-0">
        <Button
          variant="primary"
          size="sm"
          icon={<CameraIcon className="h-4 w-4" />}
          loading={isCapturing}
          onClick={handleCapture}
        >
          Capture
        </Button>

        <div className="h-5 w-px bg-[var(--border-primary)]" />

        <button
          className={cn(
            'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors border-none cursor-pointer',
            autoSnapshotEnabled
              ? 'bg-[var(--success)]/15 text-[var(--success)]'
              : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          )}
          onClick={handleAutoToggle}
        >
          {autoSnapshotEnabled ? (
            <PauseIcon className="h-3.5 w-3.5" />
          ) : (
            <PlayIcon className="h-3.5 w-3.5" />
          )}
          Auto
        </button>

        {autoSnapshotEnabled && (
          <select
            className="h-7 px-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-xs text-[var(--text-primary)] outline-none cursor-pointer"
            value={intervalValue}
            onChange={(e) => {
              const v = Number(e.target.value);
              setIntervalValue(v);
              if (autoSnapshotEnabled) {
                setAutoSnapshot(true, v);
              }
            }}
          >
            {INTERVAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            icon={<ArrowsRightLeftIcon className="h-4 w-4" />}
            disabled={selectedForCompare.length !== 2}
            loading={isComparing}
            onClick={handleCompare}
          >
            Compare
          </Button>
          <span className="text-xs text-[var(--text-muted)]">
            {snapshots.length} snapshots
          </span>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="w-72 shrink-0 border-r border-[var(--border-primary)] flex flex-col min-h-0">
          <div className="px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] border-b border-[var(--border-primary)] shrink-0">
            Snapshots
          </div>
          <div ref={parentRef} className="flex-1 overflow-auto min-h-0">
            {snapshots.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-[var(--text-muted)] text-xs">
                <CameraIcon className="h-6 w-6 mb-2 opacity-30" />
                No snapshots yet
              </div>
            ) : (
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const snap = snapshots[virtualRow.index];
                  const isSelected = snap.id === selectedSnapshotId;
                  const isCompareSelected = selectedForCompare.includes(snap.id);

                  return (
                    <div
                      key={snap.id}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <div
                        className={cn(
                          'flex items-center gap-2 px-3 h-full cursor-pointer text-xs transition-colors',
                          isSelected
                            ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                            : 'hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                        )}
                        onClick={() => {
                          selectSnapshot(snap.id);
                          setDetailMode('single');
                        }}
                      >
                        <input
                          type="checkbox"
                          className="h-3 w-3 shrink-0 accent-[var(--accent)] cursor-pointer"
                          checked={isCompareSelected}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleCheckboxToggle(snap.id);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[10px] truncate">
                              {truncateId(snap.id)}
                            </span>
                            <Badge
                              variant={snap.type === 'auto' ? 'info' : 'primary'}
                              size="sm"
                            >
                              {snap.type}
                            </Badge>
                          </div>
                          <div className="text-[10px] text-[var(--text-muted)] truncate">
                            {formatDate(snap.timestamp)} | {snap.summary}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0 overflow-auto">
          {detailMode === 'compare' && diffResult ? (
            <div className="p-3">
              <div className="flex items-center gap-2 mb-3">
                <ArrowsRightLeftIcon className="h-4 w-4 text-[var(--accent)]" />
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  Diff Result
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  {truncateId(diffResult.snapshotId1)} vs {truncateId(diffResult.snapshotId2)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDetailMode('single');
                    setCompareIds(null);
                    setSelectedForCompare([]);
                  }}
                >
                  Back
                </Button>
              </div>
              <DiffView diffs={diffResult.diffs} />
            </div>
          ) : selectedSnapshotData ? (
            <div className="p-3">
              <div className="flex items-center gap-2 mb-3">
                <CameraIcon className="h-4 w-4 text-[var(--accent)]" />
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  Snapshot Detail
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  {truncateId(selectedSnapshotData.snapshotId)} |{' '}
                  {formatDate(selectedSnapshotData.timestamp)}
                </span>
              </div>
              <div className="space-y-0.5">
                {Object.entries(selectedSnapshotData.stores).map(([storeName, storeData]) => (
                  <StoreTreeView key={storeName} name={storeName} data={storeData} />
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] text-sm gap-2">
              <CameraIcon className="h-8 w-8 opacity-30" />
              <span>Select a snapshot to view details</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-t border-[var(--border-primary)] shrink-0">
        <Button
          variant="outline"
          size="sm"
          icon={<ArrowDownTrayIcon className="h-4 w-4" />}
          disabled={!selectedSnapshotId && !diffResult}
          onClick={handleExport}
        >
          Export
        </Button>
        <Button
          variant="danger"
          size="sm"
          icon={<TrashIcon className="h-4 w-4" />}
          disabled={!selectedSnapshotId}
          onClick={handleDelete}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

function downloadJson(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
