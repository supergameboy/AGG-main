import { useState, useCallback, useMemo, useEffect, useRef, memo } from 'react';
import {
  ChevronRightIcon,
  ChevronDownIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
  ClockIcon,
  CubeIcon,
  PencilSquareIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { getAllStores, getStoreState } from '@/utils/storeInspector';
import { useInspectorStore } from '@/stores/inspectorStore';
import type { StateChangeRecord } from '@/stores/inspectorStore';

interface StateTabProps {
  className?: string;
}

function countFields(obj: unknown): number {
  if (obj === null || obj === undefined) return 0;
  if (typeof obj !== 'object') return 0;
  if (Array.isArray(obj)) return obj.length;
  return Object.keys(obj).filter((k) => typeof (obj as Record<string, unknown>)[k] !== 'function').length;
}

function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === 'object') return `{${Object.keys(value).length} keys}`;
  return String(value);
}

function valueColorClass(value: unknown): string {
  if (value === null) return 'text-purple-400';
  if (value === undefined) return 'text-gray-500';
  if (typeof value === 'string') return 'text-green-400';
  if (typeof value === 'number') return 'text-blue-400';
  if (typeof value === 'boolean') return 'text-orange-400';
  return 'text-[var(--text-secondary)]';
}

function isExpandable(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.length > 0;
  return Object.keys(value).length > 0;
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);
  if (index === -1) return text;
  return (
    <>
      {text.slice(0, index)}
      <span className="bg-yellow-500/30 text-yellow-300">{text.slice(index, index + query.length)}</span>
      {text.slice(index + query.length)}
    </>
  );
}

interface StateTreeNodeProps {
  name: string;
  value: unknown;
  path: string;
  depth: number;
  searchQuery: string;
  editingPath: string | null;
  expandedPaths: string[];
  onToggle: (path: string) => void;
  onStartEdit: (path: string) => void;
  onApplyEdit: (storeName: string, path: string, value: unknown) => void;
  onStopEdit: () => void;
  storeName: string;
}

const StateTreeNode = memo(function StateTreeNode({
  name,
  value,
  path,
  depth,
  searchQuery,
  editingPath,
  expandedPaths,
  onToggle,
  onStartEdit,
  onApplyEdit,
  onStopEdit,
  storeName,
}: StateTreeNodeProps) {
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const expanded = expandedPaths.includes(path);
  const isEditing = editingPath === path;
  const expandable = isExpandable(value);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (isEditing) {
      if (typeof value === 'object' && value !== null) {
        setEditValue(JSON.stringify(value, null, 2));
      } else {
        setEditValue(String(value ?? ''));
      }
    }
  }, [isEditing, value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        onApplyEdit(storeName, path, editValue);
      } else if (e.key === 'Escape') {
        onStopEdit();
      }
    },
    [editValue, onApplyEdit, onStopEdit, storeName, path]
  );

  const handleDoubleClick = useCallback(() => {
    if (!expandable) {
      onStartEdit(path);
    }
  }, [expandable, onStartEdit, path]);

  const nameMatches = searchQuery && name.toLowerCase().includes(searchQuery.toLowerCase());
  const valueStr = formatValue(value);
  const valueMatches = searchQuery && valueStr.toLowerCase().includes(searchQuery.toLowerCase());

  if (searchQuery && !nameMatches && !valueMatches && !expandable) {
    if (!expandable) return null;
  }

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 py-0.5 px-1 hover:bg-white/5 rounded cursor-pointer group',
          isEditing && 'bg-white/10'
        )}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onDoubleClick={handleDoubleClick}
      >
        {expandable ? (
          <button
            onClick={() => onToggle(path)}
            className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          >
            {expanded ? (
              <ChevronDownIcon className="w-3 h-3" />
            ) : (
              <ChevronRightIcon className="w-3 h-3" />
            )}
          </button>
        ) : (
          <span className="flex-shrink-0 w-4" />
        )}

        <span className={cn('text-xs font-medium flex-shrink-0', nameMatches ? 'text-yellow-300' : 'text-[var(--text-secondary)]')}>
          {highlightText(name, searchQuery)}
        </span>

        <span className="text-xs text-[var(--text-muted)] flex-shrink-0">:</span>

        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => onStopEdit()}
            className="flex-1 min-w-0 text-xs bg-black/30 border border-[var(--accent)] rounded px-1 py-0.5 text-[var(--text-primary)] font-mono outline-none"
          />
        ) : (
          <span
            className={cn(
              'text-xs font-mono truncate',
              valueColorClass(value),
              valueMatches && 'bg-yellow-500/30 text-yellow-300'
            )}
          >
            {highlightText(valueStr, searchQuery)}
          </span>
        )}

        {expandable && !isEditing && (
          <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {Array.isArray(value) ? `${(value as unknown[]).length}` : `${Object.keys(value as object).length}`}
          </span>
        )}

        {!expandable && !isEditing && (
          <button
            onClick={() => onStartEdit(path)}
            className="flex-shrink-0 w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-muted)] hover:text-[var(--accent)]"
          >
            <PencilSquareIcon className="w-3 h-3" />
          </button>
        )}
      </div>

      {expandable && expanded && (
        <div>
          {Array.isArray(value)
            ? (value as unknown[]).map((item, index) => (
                <StateTreeNode
                  key={`${path}.${index}`}
                  name={`[${index}]`}
                  value={item}
                  path={`${path}.${index}`}
                  depth={depth + 1}
                  searchQuery={searchQuery}
                  editingPath={editingPath}
                  expandedPaths={expandedPaths}
                  onToggle={onToggle}
                  onStartEdit={onStartEdit}
                  onApplyEdit={onApplyEdit}
                  onStopEdit={onStopEdit}
                  storeName={storeName}
                />
              ))
            : Object.entries(value as Record<string, unknown>)
                .filter(([, v]) => typeof v !== 'function')
                .map(([key, val]) => (
                  <StateTreeNode
                    key={`${path}.${key}`}
                    name={key}
                    value={val}
                    path={`${path}.${key}`}
                    depth={depth + 1}
                    searchQuery={searchQuery}
                    editingPath={editingPath}
                    expandedPaths={expandedPaths}
                    onToggle={onToggle}
                    onStartEdit={onStartEdit}
                    onApplyEdit={onApplyEdit}
                    onStopEdit={onStopEdit}
                    storeName={storeName}
                  />
                ))}
        </div>
      )}
    </div>
  );
});

interface StoreSelectorProps {
  stores: { name: string; fieldCount: number }[];
  selectedStoreName: string | null;
  onSelect: (name: string) => void;
}

const StoreSelector = memo(function StoreSelector({ stores, selectedStoreName, onSelect }: StoreSelectorProps) {
  return (
    <div className="flex flex-col gap-0.5">
      {stores.map((store) => (
        <button
          key={store.name}
          onClick={() => onSelect(store.name)}
          className={cn(
            'flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left w-full transition-colors',
            selectedStoreName === store.name
              ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
              : 'text-[var(--text-secondary)] hover:bg-white/5 hover:text-[var(--text-primary)]'
          )}
        >
          <CubeIcon className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate flex-1">{store.name}</span>
          <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0">{store.fieldCount}</span>
        </button>
      ))}
    </div>
  );
});

interface ChangeHistoryPanelProps {
  history: StateChangeRecord[];
  filterStoreName: string | null;
  onFilterChange: (name: string | null) => void;
  onClear: () => void;
}

const ChangeHistoryPanel = memo(function ChangeHistoryPanel({
  history,
  filterStoreName,
  onFilterChange,
  onClear,
}: ChangeHistoryPanelProps) {
  const filtered = filterStoreName
    ? history.filter((r) => r.storeName === filterStoreName)
    : history;

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/5">
        <span className="text-xs font-medium text-[var(--text-secondary)]">变更历史</span>
        <div className="flex items-center gap-1">
          {filterStoreName && (
            <button
              onClick={() => onFilterChange(null)}
              className="text-[10px] text-[var(--accent)] hover:underline"
            >
              清除筛选
            </button>
          )}
          <button
            onClick={onClear}
            className="p-0.5 text-[var(--text-muted)] hover:text-red-400 transition-colors"
            title="清空历史"
          >
            <TrashIcon className="w-3 h-3" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-[var(--text-muted)]">暂无变更记录</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((record) => (
              <div
                key={record.id}
                className="px-2 py-1.5 border-b border-white/5 hover:bg-white/5"
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <ClockIcon className="w-3 h-3 text-[var(--text-muted)] flex-shrink-0" />
                  <span className="text-[10px] text-[var(--text-muted)]">{formatTime(record.timestamp)}</span>
                  <button
                    onClick={() => onFilterChange(record.storeName)}
                    className={cn(
                      'text-[10px] px-1 rounded cursor-pointer',
                      filterStoreName === record.storeName
                        ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                        : 'text-[var(--text-secondary)] hover:text-[var(--accent)]'
                    )}
                  >
                    {record.storeName}
                  </button>
                </div>
                <div className="text-[10px] font-mono text-[var(--text-muted)] truncate ml-5">
                  {record.path}
                </div>
                <div className="text-[10px] font-mono ml-5 flex items-center gap-1">
                  <span className="text-red-400 truncate max-w-[40%]">
                    {formatValue(record.oldValue)}
                  </span>
                  <span className="text-[var(--text-muted)]">→</span>
                  <span className="text-green-400 truncate max-w-[40%]">
                    {formatValue(record.newValue)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

export function StateTab({ className }: StateTabProps) {
  const selectedStoreName = useInspectorStore((s) => s.selectedStoreName);
  const searchQuery = useInspectorStore((s) => s.searchQuery);
  const expandedPaths = useInspectorStore((s) => s.expandedPaths);
  const editingPath = useInspectorStore((s) => s.editingPath);
  const changeHistory = useInspectorStore((s) => s.changeHistory);
  const selectStore = useInspectorStore((s) => s.selectStore);
  const setSearchQuery = useInspectorStore((s) => s.setSearchQuery);
  const togglePath = useInspectorStore((s) => s.togglePath);
  const startEditing = useInspectorStore((s) => s.startEditing);
  const stopEditing = useInspectorStore((s) => s.stopEditing);
  const applyEdit = useInspectorStore((s) => s.applyEdit);
  const clearHistory = useInspectorStore((s) => s.clearHistory);

  const [historyFilter, setHistoryFilter] = useState<string | null>(null);
  const [storeState, setStoreState] = useState<Record<string, unknown>>({});
  const [refreshKey, setRefreshKey] = useState(0);

  const stores = useMemo(() => {
    return getAllStores().map((s) => ({
      name: s.name,
      fieldCount: countFields(s.getState()),
    }));
  }, []);

  useEffect(() => {
    if (!selectedStoreName) {
      setStoreState({});
      return;
    }

    const state = getStoreState(selectedStoreName);
    setStoreState(state);

    const store = getAllStores().find((s) => s.name === selectedStoreName);
    if (!store) return;

    const unsubscribe = store.subscribe(() => {
      setRefreshKey((k) => k + 1);
    });

    return unsubscribe;
  }, [selectedStoreName, refreshKey]);

  useEffect(() => {
    if (!selectedStoreName) return;
    const state = getStoreState(selectedStoreName);
    setStoreState(state);
  }, [selectedStoreName, refreshKey]);

  const handleSelectStore = useCallback(
    (name: string) => {
      selectStore(name);
      setHistoryFilter(null);
    },
    [selectStore]
  );

  const handleApplyEdit = useCallback(
    (storeName: string, path: string, value: unknown) => {
      applyEdit(storeName, path, value);
      setRefreshKey((k) => k + 1);
    },
    [applyEdit]
  );

  return (
    <div className={cn('flex h-full gap-0', className)}>
      <div className="w-44 flex-shrink-0 border-r border-white/5 flex flex-col">
        <div className="px-2 py-1.5 border-b border-white/5">
          <span className="text-xs font-medium text-[var(--text-secondary)]">Store 列表</span>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 p-1">
          <StoreSelector
            stores={stores}
            selectedStoreName={selectedStoreName}
            onSelect={handleSelectStore}
          />
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-white/5">
          <MagnifyingGlassIcon className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索字段名或值..."
            className="flex-1 text-xs bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            >
              <XMarkIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-1">
          {selectedStoreName ? (
            Object.entries(storeState)
              .filter(([, v]) => typeof v !== 'function')
              .map(([key, value]) => (
                <StateTreeNode
                  key={key}
                  name={key}
                  value={value}
                  path={key}
                  depth={0}
                  searchQuery={searchQuery}
                  editingPath={editingPath}
                  expandedPaths={expandedPaths}
                  onToggle={togglePath}
                  onStartEdit={startEditing}
                  onApplyEdit={handleApplyEdit}
                  onStopEdit={stopEditing}
                  storeName={selectedStoreName}
                />
              ))
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-xs text-[var(--text-muted)]">选择一个 Store 查看状态</p>
            </div>
          )}
        </div>
      </div>

      <div className="w-56 flex-shrink-0 border-l border-white/5">
        <ChangeHistoryPanel
          history={changeHistory}
          filterStoreName={historyFilter}
          onFilterChange={setHistoryFilter}
          onClear={clearHistory}
        />
      </div>
    </div>
  );
}
