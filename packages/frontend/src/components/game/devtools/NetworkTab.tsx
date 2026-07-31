import { useState, useMemo, useCallback, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  GlobeAltIcon,
  TrashIcon,
  ArrowPathIcon,
  PencilSquareIcon,
  MagnifyingGlassIcon,
  ChevronDownIcon,
  XMarkIcon,
  PaperAirplaneIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { useNetworkStore, type NetworkRequest } from '@/stores/networkStore';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { logger } from '@/utils/logger';

interface NetworkTabProps {
  className?: string;
}

type MethodFilter = 'all' | 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
type StatusCodeFilter = 'all' | '2xx' | '3xx' | '4xx' | '5xx';
type DetailSection = 'request' | 'response';
type DetailTab = 'headers' | 'body';

const METHOD_COLORS: Record<string, string> = {
  GET: '#3b82f6',
  POST: '#22c55e',
  PUT: '#f97316',
  DELETE: '#ef4444',
  PATCH: '#a855f7',
};

function getStatusColor(status: number): string {
  if (status >= 200 && status < 300) return '#22c55e';
  if (status >= 300 && status < 400) return '#3b82f6';
  if (status >= 400 && status < 500) return '#f97316';
  if (status >= 500) return '#ef4444';
  return '#6b7280';
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

function truncateUrl(url: string, maxLen: number = 60): string {
  if (url.length <= maxLen) return url;
  return url.slice(0, maxLen - 3) + '...';
}

function JsonTreeView({ data, label }: { data: unknown; label: string }) {
  const [expanded, setExpanded] = useState(true);

  if (data === undefined || data === null) {
    return (
      <div className="text-xs text-[var(--text-muted)] italic py-1">
        {label}: (空)
      </div>
    );
  }

  const isObject = typeof data === 'object' && data !== null;
  const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer bg-transparent border-none p-0"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronDownIcon
          className={cn('h-3 w-3 transition-transform', !expanded && '-rotate-90')}
        />
        {label}
        {isObject && (
          <span className="text-[var(--text-muted)]">
            ({Array.isArray(data) ? `Array[${(data as unknown[]).length}]` : 'Object'})
          </span>
        )}
      </button>
      {expanded && (
        <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-[var(--bg-primary)] p-2 text-[11px] font-mono text-[var(--text-primary)] whitespace-pre-wrap break-all scrollbar-thin">
          {jsonStr}
        </pre>
      )}
    </div>
  );
}

function FormattedJsonBody({ data }: { data: unknown }) {
  if (data === undefined || data === null) {
    return <div className="text-xs text-[var(--text-muted)] italic py-1">(空)</div>;
  }

  const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  return (
    <pre className="max-h-64 overflow-auto rounded-md bg-[var(--bg-primary)] p-2 text-[11px] font-mono text-[var(--text-primary)] whitespace-pre-wrap break-all scrollbar-thin">
      {jsonStr}
    </pre>
  );
}

function RequestDetailPanel({ request }: { request: NetworkRequest }) {
  const [section, setSection] = useState<DetailSection>('request');
  const [tab, setTab] = useState<DetailTab>('headers');
  const [showReplayModal, setShowReplayModal] = useState(false);
  const [editUrl, setEditUrl] = useState(request.url);
  const [editBody, setEditBody] = useState('');
  const [bodyError, setBodyError] = useState('');
  const replayRequest = useNetworkStore((s) => s.replayRequest);
  const replayWithModification = useNetworkStore((s) => s.replayWithModification);

  useMemo(() => {
    try {
      setEditBody(typeof request.requestBody === 'string' ? request.requestBody : JSON.stringify(request.requestBody, null, 2));
    } catch {
      setEditBody(String(request.requestBody));
    }
  }, [request]);

  const handleReplay = useCallback(() => {
    replayRequest(request.id);
    logger.network('NetworkTab', `Replay request: ${request.method} ${request.url}`);
  }, [replayRequest, request.id, request.method, request.url]);

  const handleOpenReplayModal = useCallback(() => {
    setEditUrl(request.url);
    try {
      setEditBody(typeof request.requestBody === 'string' ? request.requestBody : JSON.stringify(request.requestBody, null, 2));
    } catch {
      setEditBody(String(request.requestBody));
    }
    setBodyError('');
    setShowReplayModal(true);
  }, [request]);

  const handleModifyAndReplay = useCallback(() => {
    let parsedBody: unknown = undefined;
    if (editBody.trim()) {
      try {
        parsedBody = JSON.parse(editBody);
        setBodyError('');
      } catch {
        setBodyError('JSON 格式无效');
        return;
      }
    }

    const modifications: { url?: string; body?: unknown } = {};
    if (editUrl !== request.url) modifications.url = editUrl;
    if (parsedBody !== undefined) modifications.body = parsedBody;

    replayWithModification(request.id, modifications);
    logger.network('NetworkTab', `Replay with modification: ${request.method} ${editUrl}`, modifications);
    setShowReplayModal(false);
  }, [editUrl, editBody, request, replayWithModification]);

  const SECTION_TABS = useMemo(() => [
    { id: 'request', label: '请求' },
    { id: 'response', label: '响应' },
  ], []);

  const DETAIL_TABS = useMemo(() => [
    { id: 'headers', label: 'Headers' },
    { id: 'body', label: 'Body' },
  ], []);

  const currentHeaders = section === 'request' ? request.requestHeaders : request.responseHeaders;
  const currentBody = section === 'request' ? request.requestBody : request.responseBody;

  return (
    <div className="flex h-full flex-col border-l border-[var(--border-primary)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-primary)] px-3 py-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Badge customColor={METHOD_COLORS[request.method] || '#6b7280'} size="sm">
            {request.method}
          </Badge>
          <span className="truncate text-xs text-[var(--text-primary)] font-mono">{request.url}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowPathIcon className="h-3.5 w-3.5" />}
            onClick={handleReplay}
            className="text-[10px]"
          >
            重放
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<PencilSquareIcon className="h-3.5 w-3.5" />}
            onClick={handleOpenReplayModal}
            className="text-[10px]"
          >
            修改并重放
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1 px-3 pt-2 shrink-0">
        {SECTION_TABS.map((st) => (
          <button
            key={st.id}
            type="button"
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer border-none',
              section === st.id
                ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
            )}
            onClick={() => setSection(st.id as DetailSection)}
          >
            {st.label}
          </button>
        ))}
        <div className="flex-1" />
        {DETAIL_TABS.map((dt) => (
          <button
            key={dt.id}
            type="button"
            className={cn(
              'px-2 py-1 text-[10px] font-medium rounded transition-colors cursor-pointer border-none',
              tab === dt.id
                ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            )}
            onClick={() => setTab(dt.id as DetailTab)}
          >
            {dt.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 scrollbar-thin">
        {tab === 'headers' ? (
          <JsonTreeView data={currentHeaders} label="Headers" />
        ) : (
          <FormattedJsonBody data={currentBody} />
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--border-primary)] px-3 py-1.5 flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
        <span>状态: <span style={{ color: getStatusColor(request.responseStatus) }}>{request.responseStatus}</span></span>
        <span>耗时: {formatDuration(request.duration)}</span>
        <span>时间: {formatTime(request.timestamp)}</span>
      </div>

      <Modal
        open={showReplayModal}
        onClose={() => setShowReplayModal(false)}
        title="修改并重放"
        size="lg"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setShowReplayModal(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<PaperAirplaneIcon className="h-3.5 w-3.5" />}
              onClick={handleModifyAndReplay}
            >
              发送
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">URL</label>
            <input
              type="text"
              value={editUrl}
              onChange={(e) => setEditUrl(e.target.value)}
              className={cn(
                'w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2',
                'text-xs text-[var(--text-primary)] font-mono',
                'focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/20'
              )}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Body (JSON)</label>
            <textarea
              value={editBody}
              onChange={(e) => {
                setEditBody(e.target.value);
                setBodyError('');
              }}
              rows={10}
              className={cn(
                'w-full rounded-md border bg-[var(--bg-primary)] px-3 py-2',
                'text-xs text-[var(--text-primary)] font-mono resize-y',
                'focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/20',
                bodyError ? 'border-[var(--error)]' : 'border-[var(--border-primary)] focus:border-[var(--accent)]'
              )}
            />
            {bodyError && (
              <p className="mt-1 text-xs text-[var(--error)]">{bodyError}</p>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}

export function NetworkTab({ className }: NetworkTabProps) {
  const requests = useNetworkStore((s) => s.requests);
  const selectedRequestId = useNetworkStore((s) => s.selectedRequestId);
  const selectRequest = useNetworkStore((s) => s.selectRequest);
  const setFilter = useNetworkStore((s) => s.setFilter);
  const clearRequests = useNetworkStore((s) => s.clearRequests);

  const [methodFilter, setMethodFilter] = useState<MethodFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusCodeFilter>('all');
  const [urlSearch, setUrlSearch] = useState('');

  const filteredRequests = useMemo(() => {
    let result = requests;

    if (methodFilter !== 'all') {
      result = result.filter((r) => r.method === methodFilter);
    }
    if (statusFilter !== 'all') {
      const prefix = statusFilter.replace('xx', '');
      result = result.filter((r) => String(r.responseStatus).startsWith(prefix));
    }
    if (urlSearch) {
      const pattern = urlSearch.toLowerCase();
      result = result.filter((r) => r.url.toLowerCase().includes(pattern));
    }

    return result;
  }, [requests, methodFilter, statusFilter, urlSearch]);

  const selectedRequest = useMemo(
    () => requests.find((r) => r.id === selectedRequestId) ?? null,
    [requests, selectedRequestId]
  );

  const handleMethodFilterChange = useCallback((value: MethodFilter) => {
    setMethodFilter(value);
    setFilter({ method: value });
  }, [setFilter]);

  const handleStatusFilterChange = useCallback((value: StatusCodeFilter) => {
    setStatusFilter(value);
    setFilter({ statusCode: value });
  }, [setFilter]);

  const handleUrlSearchChange = useCallback((value: string) => {
    setUrlSearch(value);
    setFilter({ urlPattern: value });
  }, [setFilter]);

  const handleClear = useCallback(() => {
    clearRequests();
    logger.network('NetworkTab', 'Cleared all network requests');
  }, [clearRequests]);

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: filteredRequests.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 20,
  });

  const METHOD_OPTIONS: MethodFilter[] = ['all', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
  const STATUS_OPTIONS: StatusCodeFilter[] = ['all', '2xx', '3xx', '4xx', '5xx'];

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="flex items-center gap-2 border-b border-[var(--border-primary)] px-3 py-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <GlobeAltIcon className="h-4 w-4 text-[var(--text-muted)]" />
          <span className="text-xs font-medium text-[var(--text-secondary)]">网络请求</span>
          <Badge variant="default" size="sm">{requests.length}</Badge>
        </div>

        <div className="flex-1" />

        <select
          value={methodFilter}
          onChange={(e) => handleMethodFilterChange(e.target.value as MethodFilter)}
          className={cn(
            'h-7 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2',
            'text-xs text-[var(--text-primary)] cursor-pointer',
            'focus:outline-none focus:border-[var(--accent)]'
          )}
        >
          {METHOD_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt === 'all' ? 'ALL' : opt}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => handleStatusFilterChange(e.target.value as StatusCodeFilter)}
          className={cn(
            'h-7 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2',
            'text-xs text-[var(--text-primary)] cursor-pointer',
            'focus:outline-none focus:border-[var(--accent)]'
          )}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt === 'all' ? 'ALL' : opt}
            </option>
          ))}
        </select>

        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="搜索URL..."
            value={urlSearch}
            onChange={(e) => handleUrlSearchChange(e.target.value)}
            className={cn(
              'h-7 w-40 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] pl-7 pr-2',
              'text-xs text-[var(--text-primary)]',
              'focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/20',
              'placeholder:text-[var(--text-muted)]'
            )}
          />
          {urlSearch && (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer bg-transparent border-none p-0"
              onClick={() => handleUrlSearchChange('')}
            >
              <XMarkIcon className="h-3 w-3" />
            </button>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          icon={<TrashIcon className="h-3.5 w-3.5" />}
          onClick={handleClear}
          disabled={requests.length === 0}
          className="text-[10px]"
        >
          清空
        </Button>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className={cn('flex flex-col min-h-0', selectedRequest ? 'w-1/2' : 'w-full')}>
          <div className="flex items-center gap-2 px-3 py-1 text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider border-b border-[var(--border-primary)] shrink-0">
            <span className="w-14">方法</span>
            <span className="flex-1">URL</span>
            <span className="w-12 text-right">状态</span>
            <span className="w-16 text-right">耗时</span>
          </div>

          <div ref={parentRef} className="flex-1 min-h-0 overflow-auto scrollbar-thin">
            {filteredRequests.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 py-8">
                <GlobeAltIcon className="h-10 w-10 text-[var(--text-muted)] opacity-30" />
                <p className="text-xs text-[var(--text-muted)]">
                  {requests.length === 0 ? '暂无网络请求记录' : '没有匹配的请求'}
                </p>
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
                  const req = filteredRequests[virtualRow.index];
                  const isSelected = req.id === selectedRequestId;
                  const methodColor = METHOD_COLORS[req.method] || '#6b7280';
                  const statusColor = getStatusColor(req.responseStatus);

                  return (
                    <div
                      key={req.id}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <button
                        type="button"
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-1 text-left transition-colors cursor-pointer border-none',
                          isSelected
                            ? 'bg-[var(--accent)]/10 border-l-2 border-l-[var(--accent)]'
                            : 'bg-transparent hover:bg-[var(--bg-secondary)] border-l-2 border-l-transparent'
                        )}
                        onClick={() => selectRequest(isSelected ? null : req.id)}
                      >
                        <span
                          className="w-14 shrink-0 text-[10px] font-bold font-mono"
                          style={{ color: methodColor }}
                        >
                          {req.method}
                        </span>
                        <span className="flex-1 truncate text-xs text-[var(--text-primary)] font-mono" title={req.url}>
                          {truncateUrl(req.url)}
                        </span>
                        <span
                          className="w-12 shrink-0 text-right text-xs font-mono font-semibold"
                          style={{ color: statusColor }}
                        >
                          {req.responseStatus || '---'}
                        </span>
                        <span className="w-16 shrink-0 text-right text-[10px] font-mono text-[var(--text-secondary)]">
                          {formatDuration(req.duration)}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {filteredRequests.length > 0 && (
            <div className="shrink-0 border-t border-[var(--border-primary)] px-3 py-1 text-[10px] text-[var(--text-muted)]">
              显示 {filteredRequests.length} / {requests.length} 条请求
            </div>
          )}
        </div>

        {selectedRequest && (
          <div className="w-1/2 min-h-0">
            <RequestDetailPanel request={selectedRequest} />
          </div>
        )}
      </div>
    </div>
  );
}
