import { useMemo, useCallback, useEffect, useRef } from 'react';
import { ArrowPathIcon, ExclamationTriangleIcon, TrashIcon, ArrowDownIcon } from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { useRuntimeStore, type WSLogEntry } from '@/stores/runtimeStore';
import { useGameStore } from '@/stores/gameStore';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

interface RuntimeTabProps {
  className?: string;
}

const SUB_TABS = [
  { id: 'staging' as const, label: '暂存池' },
  { id: 'eventbus' as const, label: '事件总线' },
  { id: 'audit' as const, label: '审计日志' },
  { id: 'graph' as const, label: '图变更' },
  { id: 'snapshot' as const, label: '快照' },
  { id: 'postreact' as const, label: 'Post-react' },
  { id: 'pacing' as const, label: '节奏' },
  { id: 'trace' as const, label: 'Trace' },
  { id: 'ws' as const, label: 'WS' },
];

const WS_TYPE_FILTERS = [
  { value: null, label: '全部' },
  { value: 'game:request', label: 'game:request' },
  { value: 'game:event', label: 'game:event' },
  { value: 'game:result', label: 'game:result' },
  { value: 'game:error', label: 'game:error' },
];

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

function getLatestPostReactRefreshEventKey(
  liveEvents: Array<{ type: string; timestamp: number }>
): string | null {
  for (let index = liveEvents.length - 1; index >= 0; index -= 1) {
    const event = liveEvents[index];
    const shouldRefreshPostReact = event.type === 'dev:audit_decision'
      || event.type === 'dev:staging_commit';

    if (shouldRefreshPostReact) {
      return `${event.type}:${event.timestamp}`;
    }
  }

  return null;
}

function getLatestRuntimeSnapshotRefreshEventKey(
  liveEvents: Array<{ type: string; timestamp: number }>
): string | null {
  for (let index = liveEvents.length - 1; index >= 0; index -= 1) {
    const event = liveEvents[index];
    if (event.type === 'dev:runtime_snapshot') {
      return `${event.type}:${event.timestamp}`;
    }
  }

  return null;
}

export function RuntimeTab({ className }: RuntimeTabProps) {
  const lastRuntimeSnapshotRefreshEventRef = useRef<string | null>(null);
  const lastPostReactRefreshEventRef = useRef<string | null>(null);
  const activeSubTab = useRuntimeStore((s) => s.activeSubTab);
  const stagingPool = useRuntimeStore((s) => s.stagingPool);
  const stagingPoolLoading = useRuntimeStore((s) => s.stagingPoolLoading);
  const eventBus = useRuntimeStore((s) => s.eventBus);
  const eventBusLoading = useRuntimeStore((s) => s.eventBusLoading);
  const auditLog = useRuntimeStore((s) => s.auditLog);
  const auditLogLoading = useRuntimeStore((s) => s.auditLogLoading);
  const graphChanges = useRuntimeStore((s) => s.graphChanges);
  const graphChangesLoading = useRuntimeStore((s) => s.graphChangesLoading);
  const runtimeSnapshots = useRuntimeStore((s) => s.runtimeSnapshots);
  const runtimeSnapshotsLoading = useRuntimeStore((s) => s.runtimeSnapshotsLoading);
  const runtimeSnapshotsError = useRuntimeStore((s) => s.runtimeSnapshotsError);
  const postReact = useRuntimeStore((s) => s.postReact);
  const postReactLoading = useRuntimeStore((s) => s.postReactLoading);
  const postReactError = useRuntimeStore((s) => s.postReactError);
  const runtimeEvents = useRuntimeStore((s) => s.runtimeEvents);
  const runtimeEventsLoading = useRuntimeStore((s) => s.runtimeEventsLoading);
  const runtimeEventsError = useRuntimeStore((s) => s.runtimeEventsError);
  const liveEvents = useRuntimeStore((s) => s.liveEvents);
  const wsLogs = useRuntimeStore((s) => s.wsLogs);
  const wsConnectionStats = useRuntimeStore((s) => s.wsConnectionStats);
  const wsTypeFilter = useRuntimeStore((s) => s.wsTypeFilter);
  const wsAutoScroll = useRuntimeStore((s) => s.wsAutoScroll);
  const clearWSLogs = useRuntimeStore((s) => s.clearWSLogs);
  const setWSTypeFilter = useRuntimeStore((s) => s.setWSTypeFilter);
  const setWSAutoScroll = useRuntimeStore((s) => s.setWSAutoScroll);
  const setActiveSubTab = useRuntimeStore((s) => s.setActiveSubTab);
  const fetchStagingPool = useRuntimeStore((s) => s.fetchStagingPool);
  const fetchEventBus = useRuntimeStore((s) => s.fetchEventBus);
  const fetchAuditLog = useRuntimeStore((s) => s.fetchAuditLog);
  const fetchGraphChanges = useRuntimeStore((s) => s.fetchGraphChanges);
  const fetchRuntimeSnapshots = useRuntimeStore((s) => s.fetchRuntimeSnapshots);
  const fetchPostReact = useRuntimeStore((s) => s.fetchPostReact);
  const fetchRuntimeEvents = useRuntimeStore((s) => s.fetchRuntimeEvents);

  const saveId = useGameStore((s) => s.saveId);

  const wsLogListRef = useRef<HTMLDivElement>(null);
  const wsLogBottomRef = useRef<HTMLDivElement>(null);

  const filteredWSLogs = useMemo(() => {
    if (!wsTypeFilter) return wsLogs;
    return wsLogs.filter((entry) => entry.type === wsTypeFilter);
  }, [wsLogs, wsTypeFilter]);

  useEffect(() => {
    if (activeSubTab !== 'ws' || !wsAutoScroll) return;
    wsLogBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [filteredWSLogs, activeSubTab, wsAutoScroll]);

  const handleWSLogScroll = useCallback(() => {
    const container = wsLogListRef.current;
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 30;
    if (!atBottom && wsAutoScroll) {
      setWSAutoScroll(false);
    }
  }, [wsAutoScroll, setWSAutoScroll]);

  const handleRefresh = useCallback(() => {
    if (!saveId) return;
    switch (activeSubTab) {
      case 'staging': fetchStagingPool(saveId); break;
      case 'eventbus': fetchEventBus(saveId); break;
      case 'audit': fetchAuditLog(saveId); break;
      case 'graph': fetchGraphChanges(saveId); break;
      case 'snapshot': fetchRuntimeSnapshots(saveId); break;
      case 'postreact': fetchPostReact(saveId); break;
      case 'trace': fetchRuntimeEvents(saveId); break;
    }
  }, [saveId, activeSubTab, fetchStagingPool, fetchEventBus, fetchAuditLog, fetchGraphChanges, fetchRuntimeSnapshots, fetchPostReact, fetchRuntimeEvents]);

  useEffect(() => {
    if (!saveId || activeSubTab !== 'snapshot') {
      return;
    }

    void fetchRuntimeSnapshots(saveId);
  }, [activeSubTab, fetchRuntimeSnapshots, saveId]);

  useEffect(() => {
    if (!saveId || activeSubTab !== 'snapshot') {
      return;
    }

    lastRuntimeSnapshotRefreshEventRef.current = getLatestRuntimeSnapshotRefreshEventKey(liveEvents);
  }, [activeSubTab, saveId]);

  useEffect(() => {
    if (!saveId || activeSubTab !== 'snapshot' || liveEvents.length === 0) {
      return;
    }

    const refreshEventKey = getLatestRuntimeSnapshotRefreshEventKey(liveEvents);
    if (!refreshEventKey || lastRuntimeSnapshotRefreshEventRef.current === refreshEventKey) {
      return;
    }

    lastRuntimeSnapshotRefreshEventRef.current = refreshEventKey;
    void fetchRuntimeSnapshots(saveId);
  }, [activeSubTab, fetchRuntimeSnapshots, liveEvents, saveId]);

  useEffect(() => {
    if (!saveId || activeSubTab !== 'postreact') {
      return;
    }

    void fetchPostReact(saveId);
  }, [activeSubTab, fetchPostReact, saveId]);

  useEffect(() => {
    if (!saveId || activeSubTab !== 'postreact') {
      return;
    }

    lastPostReactRefreshEventRef.current = getLatestPostReactRefreshEventKey(liveEvents);
  }, [activeSubTab, saveId]);

  useEffect(() => {
    if (!saveId || activeSubTab !== 'postreact' || liveEvents.length === 0) {
      return;
    }

    const refreshEventKey = getLatestPostReactRefreshEventKey(liveEvents);
    if (!refreshEventKey) {
      return;
    }

    if (lastPostReactRefreshEventRef.current === refreshEventKey) {
      return;
    }

    lastPostReactRefreshEventRef.current = refreshEventKey;
    void fetchPostReact(saveId);
  }, [activeSubTab, fetchPostReact, liveEvents, saveId]);

  useEffect(() => {
    if (!saveId || activeSubTab !== 'trace') {
      return;
    }
    void fetchRuntimeEvents(saveId);
  }, [activeSubTab, fetchRuntimeEvents, saveId]);

  const currentData = useMemo(() => {
    switch (activeSubTab) {
      case 'staging': return stagingPool?.stagingWriteTraces ?? [];
      case 'eventbus': return eventBus?.eventBusTraces ?? [];
      case 'audit': return auditLog?.auditTraces ?? [];
      case 'graph': return graphChanges?.graphChangeTraces ?? [];
      case 'snapshot': return runtimeSnapshots?.runtimeSnapshots ?? [];
      case 'postreact': return postReact?.postReactTraces ?? [];
      case 'trace': return runtimeEvents?.events ?? [];
      case 'pacing': return [];
      case 'ws': return [];
    }
  }, [activeSubTab, stagingPool, eventBus, auditLog, graphChanges, runtimeSnapshots, postReact, runtimeEvents]);

  const currentLoading = useMemo(() => {
    switch (activeSubTab) {
      case 'staging': return stagingPoolLoading;
      case 'eventbus': return eventBusLoading;
      case 'audit': return auditLogLoading;
      case 'graph': return graphChangesLoading;
      case 'snapshot': return runtimeSnapshotsLoading;
      case 'postreact': return postReactLoading;
      case 'trace': return runtimeEventsLoading;
      case 'pacing': return false;
      case 'ws': return false;
    }
  }, [activeSubTab, stagingPoolLoading, eventBusLoading, auditLogLoading, graphChangesLoading, runtimeSnapshotsLoading, postReactLoading, runtimeEventsLoading]);

  const currentError = useMemo(() => {
    if (activeSubTab === 'snapshot') {
      return runtimeSnapshotsError;
    }
    if (activeSubTab === 'postreact') {
      return postReactError;
    }
    if (activeSubTab === 'trace') {
      return runtimeEventsError;
    }
    return null;
  }, [activeSubTab, runtimeSnapshotsError, postReactError, runtimeEventsError]);
  const hasCurrentData = currentData.length > 0;

  const latestRuntimeSnapshotTrace = useMemo(() => {
    const traces = runtimeSnapshots?.runtimeSnapshots ?? [];
    return traces.length > 0 ? traces[traces.length - 1] : null;
  }, [runtimeSnapshots]);

  const latestPostReactTrace = useMemo(() => {
    const traces = postReact?.postReactTraces ?? [];
    return traces.length > 0 ? traces[traces.length - 1] : null;
  }, [postReact]);

  const runtimeSnapshotErrorTitle = currentError?.code === 'SERVICE_UNAVAILABLE'
    ? 'Runtime snapshot collector 暂不可用'
    : 'Runtime snapshot 数据加载失败';
  const postReactErrorTitle = currentError?.code === 'SERVICE_UNAVAILABLE'
    ? 'Post-react collector 暂不可用'
    : 'Post-react 数据加载失败';
  const traceErrorTitle = currentError?.code === 'SERVICE_UNAVAILABLE'
    ? 'Runtime events collector 暂不可用'
    : 'Runtime events 数据加载失败';

  function getErrorTitle(): string {
    if (activeSubTab === 'snapshot') return runtimeSnapshotErrorTitle;
    if (activeSubTab === 'postreact') return postReactErrorTitle;
    if (activeSubTab === 'trace') return traceErrorTitle;
    return '数据加载失败';
  }

  return (
    <div className={cn('flex h-full flex-col gap-2', className)}>
      {/* Sub-tabs + Refresh */}
      <div className="flex items-center gap-2 shrink-0">
        {SUB_TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium transition-colors',
              activeSubTab === tab.id
                ? 'bg-[var(--primary)] text-white'
                : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
            )}
            onClick={() => setActiveSubTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <div className="flex-1" />
        <Button variant="outline" size="sm" icon={<ArrowPathIcon className="h-4 w-4" />} onClick={handleRefresh} disabled={!saveId}>
          刷新
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {currentError && !hasCurrentData ? (
          <div className="rounded-md border border-[var(--error)]/30 bg-[var(--error)]/5 px-3 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--error)]">
              <ExclamationTriangleIcon className="h-4 w-4" />
              <span>{getErrorTitle()}</span>
            </div>
            <p className="mt-2 text-xs text-[var(--text-secondary)]">
              {currentError.message}
              {typeof currentError.statusCode === 'number' ? ` · ${currentError.statusCode}` : ''}
            </p>
          </div>
        ) : currentLoading ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-[var(--text-muted)]">正在加载运行时数据...</p>
          </div>
        ) : currentData.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-[var(--text-muted)]">点击"刷新"加载数据</p>
          </div>
        ) : (
          <div className="space-y-1">
            {currentError && (
              <div className="rounded-md border border-[var(--error)]/30 bg-[var(--error)]/5 px-3 py-3">
                <div className="flex items-center gap-2 text-sm font-medium text-[var(--error)]">
                  <ExclamationTriangleIcon className="h-4 w-4" />
                  <span>{getErrorTitle()}</span>
                </div>
                <p className="mt-2 text-xs text-[var(--text-secondary)]">
                  {currentError.message}
                  {typeof currentError.statusCode === 'number' ? ` · ${currentError.statusCode}` : ''}
                </p>
              </div>
            )}
            {activeSubTab === 'snapshot' && latestRuntimeSnapshotTrace && (
              <section className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Snapshot 概览</h3>
                  <Badge variant="info" size="sm">
                    {latestRuntimeSnapshotTrace.data.agentKey}
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[var(--text-secondary)]">
                  <span>Request: {latestRuntimeSnapshotTrace.data.requestId}</span>
                  <span>Model: {latestRuntimeSnapshotTrace.data.model.model ?? '未配置'}</span>
                  <span>Language: {latestRuntimeSnapshotTrace.data.context.language ?? '未设置'}</span>
                </div>

                <h4 className="mt-3 text-xs font-semibold text-[var(--text-primary)]">工具可见性</h4>
                <pre className="mt-1 whitespace-pre-wrap text-[10px] text-[var(--text-muted)]">
                  {JSON.stringify(latestRuntimeSnapshotTrace.data.permissions, null, 2)}
                </pre>

                <h4 className="mt-3 text-xs font-semibold text-[var(--text-primary)]">Deferred</h4>
                <pre className="mt-1 whitespace-pre-wrap text-[10px] text-[var(--text-muted)]">
                  {JSON.stringify(latestRuntimeSnapshotTrace.data.deferredTools, null, 2)}
                </pre>

                <h4 className="mt-3 text-xs font-semibold text-[var(--text-primary)]">预算消耗</h4>
                <pre className="mt-1 whitespace-pre-wrap text-[10px] text-[var(--text-muted)]">
                  {JSON.stringify(latestRuntimeSnapshotTrace.data.toolExposureBudget, null, 2)}
                </pre>

                <h4 className="mt-3 text-xs font-semibold text-[var(--text-primary)]">知识命中</h4>
                <pre className="mt-1 whitespace-pre-wrap text-[10px] text-[var(--text-muted)]">
                  {JSON.stringify(latestRuntimeSnapshotTrace.data.knowledge, null, 2)}
                </pre>

                <h4 className="mt-3 text-xs font-semibold text-[var(--text-primary)]">Prompt 摘要</h4>
                <pre className="mt-1 whitespace-pre-wrap text-[10px] text-[var(--text-muted)]">
                  {JSON.stringify(latestRuntimeSnapshotTrace.data.prompt, null, 2)}
                </pre>
              </section>
            )}
            {activeSubTab === 'postreact' && latestPostReactTrace && (
              <section className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Post-react 概览</h3>
                  <Badge variant={latestPostReactTrace.data.requiresRepair ? 'warning' : 'success'} size="sm">
                    {latestPostReactTrace.data.requiresRepair ? '需要修正' : '已收敛'}
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[var(--text-secondary)]">
                  <span>修正回合: {latestPostReactTrace.data.repairRoundCount}</span>
                  <span>Layer1 Agents: {latestPostReactTrace.data.resolvedLayer1Agents.join(', ') || '无'}</span>
                </div>
                <pre className="mt-2 whitespace-pre-wrap text-[10px] text-[var(--text-muted)]">
                  {JSON.stringify(latestPostReactTrace.data.decisionSummary, null, 2)}
                </pre>

                <h4 className="mt-3 text-xs font-semibold text-[var(--text-primary)]">修正回路</h4>
                <pre className="mt-1 whitespace-pre-wrap text-[10px] text-[var(--text-muted)]">
                  {JSON.stringify({
                    repairReasons: latestPostReactTrace.data.repairReasons,
                    needAgentReasons: latestPostReactTrace.data.needAgentReasons,
                  }, null, 2)}
                </pre>

                <h4 className="mt-3 text-xs font-semibold text-[var(--text-primary)]">状态写回摘要</h4>
                <pre className="mt-1 whitespace-pre-wrap text-[10px] text-[var(--text-muted)]">
                  {JSON.stringify(latestPostReactTrace.data.runtimeCommitSummary, null, 2)}
                </pre>
              </section>
            )}
            {activeSubTab === 'trace' && currentData.length > 0 && (
              <section className="space-y-1">
                {currentData.map((event: any, i: number) => (
                  <div key={i} className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 py-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-[var(--text-muted)]">{formatTime(event.at)}</span>
                      <Badge
                        variant={
                          event.type === 'agent_failed_or_recovered' ? 'warning'
                          : event.type === 'audit_finished' ? 'info'
                          : event.type.startsWith('tool_') ? 'default'
                          : 'success'
                        }
                        size="sm"
                      >
                        {event.type}
                      </Badge>
                      <span className="text-[var(--text-secondary)]">{event.summary}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--text-muted)]">
                      <span>req: {event.traceIds.requestId}</span>
                      <span>run: {event.traceIds.agentRunId}</span>
                      {event.traceIds.iterationId && <span>iter: {event.traceIds.iterationId}</span>}
                      {event.traceIds.toolCallId && <span>tool: {event.traceIds.toolCallId}</span>}
                      {event.traceIds.auditRoundId && <span>audit: {event.traceIds.auditRoundId}</span>}
                      {event.traceIds.parentAgentRunId && <span>parent: {event.traceIds.parentAgentRunId}</span>}
                    </div>
                    {event.detail && (
                      <pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap text-[10px] text-[var(--text-muted)]">
                        {JSON.stringify(event.detail, null, 2).slice(0, 300)}
                      </pre>
                    )}
                  </div>
                ))}
              </section>
            )}
            {activeSubTab === 'pacing' && (
              <PacingVisualization liveEvents={liveEvents} />
            )}
            {activeSubTab === 'ws' && (
              <section className="space-y-1">
                <div className="flex items-center gap-2 mb-2">
                  <Badge
                    variant={wsConnectionStats.state === 'connected' ? 'success' : wsConnectionStats.state === 'reconnecting' ? 'warning' : 'error'}
                    size="sm"
                  >
                    {wsConnectionStats.state}
                  </Badge>
                  <span className="text-xs text-[var(--text-muted)]">{filteredWSLogs.length} 条日志</span>
                  {wsConnectionStats.activeRequestIds.length > 0 && (
                    <span className="text-xs text-[var(--text-muted)]">{wsConnectionStats.activeRequestIds.length} 请求中</span>
                  )}
                  <div className="flex-1" />
                  {!wsAutoScroll && (
                    <Button
                      variant="outline"
                      size="sm"
                      icon={<ArrowDownIcon className="h-3 w-3" />}
                      onClick={() => setWSAutoScroll(true)}
                    >
                      恢复滚动
                    </Button>
                  )}
                  <Button variant="outline" size="sm" icon={<TrashIcon className="h-3 w-3" />} onClick={clearWSLogs}>
                    清空
                  </Button>
                </div>
                <div className="flex items-center gap-1 mb-2">
                  {WS_TYPE_FILTERS.map((f) => (
                    <button
                      key={f.label}
                      type="button"
                      className={cn(
                        'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
                        wsTypeFilter === f.value
                          ? 'bg-[var(--primary)] text-white'
                          : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                      )}
                      onClick={() => setWSTypeFilter(f.value)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                {filteredWSLogs.length === 0 ? (
                  <div className="flex items-center justify-center py-8">
                    <p className="text-sm text-[var(--text-muted)]">暂无 WS 消息日志</p>
                  </div>
                ) : (
                  <div ref={wsLogListRef} className="space-y-1 max-h-[calc(100vh-300px)] overflow-y-auto" onScroll={handleWSLogScroll}>
                    {filteredWSLogs.map((entry: WSLogEntry, i: number) => (
                      <div key={i} className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 py-1.5">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-mono text-[var(--text-muted)]">{formatTime(entry.timestamp)}</span>
                          <span className={cn(
                            'text-xs font-bold',
                            entry.direction === 'send' ? 'text-blue-400' : 'text-green-400'
                          )}>
                            {entry.direction === 'send' ? '↑' : '↓'}
                          </span>
                          <Badge
                            variant={
                              entry.type === 'game:request' ? 'info'
                              : entry.type === 'game:result' ? 'success'
                              : entry.type === 'game:error' ? 'error'
                              : 'default'
                            }
                            size="sm"
                          >
                            {entry.type}
                          </Badge>
                          {entry.eventType && (
                            <Badge variant="default" size="sm">{entry.eventType}</Badge>
                          )}
                          {entry.requestId && (
                            <span className="font-mono text-[10px] text-[var(--text-muted)]" title={entry.requestId}>
                              {entry.requestId.slice(0, 8)}
                            </span>
                          )}
                          <span className="text-[var(--text-secondary)] text-[10px]">{entry.dataSummary}</span>
                        </div>
                      </div>
                    ))}
                    <div ref={wsLogBottomRef} />
                  </div>
                )}
              </section>
            )}
            {activeSubTab !== 'trace' && activeSubTab !== 'ws' && currentData.map((entry: any, i: number) => (
              <div key={i} className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] px-3 py-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-[var(--text-muted)]">{formatTime(entry.timestamp)}</span>
                  <Badge variant="default" size="sm">{entry.type}</Badge>
                </div>
                <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-[10px] text-[var(--text-muted)]">
                  {JSON.stringify(entry.data, null, 2).slice(0, 500)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Live events */}
      {liveEvents.length > 0 && (
        <div className="shrink-0 border-t border-[var(--border-primary)] pt-2">
          <h3 className="mb-1 text-xs font-semibold text-[var(--text-muted)]">实时事件</h3>
          <div className="max-h-20 overflow-auto space-y-0.5">
            {liveEvents.slice(-10).map((e, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px]">
                <span className="text-[var(--text-muted)]">{formatTime(e.timestamp)}</span>
                <span className="font-mono text-[var(--text-secondary)]">{e.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pacing Visualization ────────────────────────────────────────────────────

type PacingStage = 'exposition' | 'rising' | 'climax' | 'falling' | 'resolution';

interface PacingLiveEvent {
  type: string;
  data: unknown;
  timestamp: number;
}

const STAGE_COLORS: Record<PacingStage, string> = {
  exposition: '#60a5fa',
  rising: '#fbbf24',
  climax: '#ef4444',
  falling: '#a78bfa',
  resolution: '#34d399',
};

const FACTOR_LABELS = ['战斗', '威胁', '资源', '信息', '时间'] as const;
const FACTOR_KEYS = ['combat', 'threat', 'resource', 'info', 'time'] as const;

function PacingVisualization({ liveEvents }: { liveEvents: PacingLiveEvent[] }) {
  const pacingEvents = useMemo(
    () => liveEvents.filter(e => e.type.startsWith('pacing:')),
    [liveEvents],
  );

  // 从 pacing:tension_change 事件中提取紧张度历史
  const tensionHistory = useMemo(() => {
    return pacingEvents
      .filter(e => e.type === 'pacing:tension_change')
      .map(e => {
        const d = e.data as Record<string, unknown>;
        return {
          tension: d.tension as number,
          stage: d.stage as PacingStage,
          round: d.roundNumber as number,
          factors: d.factors as Record<string, number> | undefined,
          eventCount: d.eventCount as number | undefined,
          mainQuestProgress: d.mainQuestProgress as number | undefined,
          timestamp: e.timestamp,
        };
      });
  }, [pacingEvents]);

  // 最新5维因子
  const latestFactors = useMemo(() => {
    const last = tensionHistory[tensionHistory.length - 1];
    return last?.factors ?? null;
  }, [tensionHistory]);

  // 最新阶段变化
  const stageChanges = useMemo(() => {
    return pacingEvents
      .filter(e => e.type === 'pacing:stage_change')
      .map(e => {
        const d = e.data as Record<string, unknown>;
        return {
          previousStage: d.previousStage as PacingStage,
          currentStage: d.currentStage as PacingStage,
          tension: d.tension as number,
          timestamp: e.timestamp,
        };
      });
  }, [pacingEvents]);

  // 审查告警
  const reviewAlerts = useMemo(() => {
    return pacingEvents
      .filter(e => e.type === 'pacing:review_alert')
      .map(e => {
        const d = e.data as Record<string, unknown>;
        return {
          tensionConsistent: d.tensionConsistent as boolean,
          consecutiveHighPressure: d.consecutiveHighPressure as boolean,
          consecutiveLowPressure: d.consecutiveLowPressure as boolean,
          progressDeviation: d.progressDeviation as number,
          suggestions: d.suggestions as string[],
          timestamp: e.timestamp,
        };
      });
  }, [pacingEvents]);

  if (pacingEvents.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-sm text-[var(--text-muted)]">暂无节奏事件数据</p>
      </div>
    );
  }

  return (
    <section className="space-y-3">
      {/* 紧张度曲线图 */}
      <TensionCurveChart data={tensionHistory} />

      {/* 5维雷达图 + 当前状态 */}
      <div className="grid grid-cols-2 gap-3">
        <FactorRadar factors={latestFactors} />
        <CurrentPacingStatus tensionHistory={tensionHistory} stageChanges={stageChanges} />
      </div>

      {/* 事件密度 + 推进速度 */}
      <div className="grid grid-cols-2 gap-3">
        <DensityBarChart tensionHistory={tensionHistory} />
        <ProgressPanel tensionHistory={tensionHistory} />
      </div>

      {/* 审查告警 */}
      {reviewAlerts.length > 0 && (
        <ReviewAlerts alerts={reviewAlerts} />
      )}

      {/* 事件日志 */}
      <div>
        <h4 className="text-xs font-semibold text-[var(--text-primary)] mb-2">事件日志</h4>
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {pacingEvents.slice(-20).map((e, i) => (
            <div key={i} className="rounded border border-[var(--border-primary)] bg-[var(--bg-card)] px-2 py-1">
              <div className="flex items-center gap-2 text-[10px]">
                <span className="font-mono text-[var(--text-muted)]">{formatTime(e.timestamp)}</span>
                <Badge
                  variant={e.type === 'pacing:review_alert' ? 'error' : e.type === 'pacing:stage_change' ? 'warning' : 'info'}
                  size="sm"
                >
                  {e.type.replace('pacing:', '')}
                </Badge>
              </div>
              <pre className="text-[9px] font-mono text-[var(--text-secondary)] whitespace-pre-wrap break-all mt-0.5">
                {JSON.stringify(e.data, null, 2).slice(0, 300)}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Tension Curve Chart (SVG) ───────────────────────────────────────────────

function TensionCurveChart({ data }: { data: Array<{ tension: number; stage: PacingStage; round: number }> }) {
  if (data.length < 2) {
    return (
      <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-3">
        <h4 className="text-xs font-semibold text-[var(--text-primary)] mb-2">紧张度曲线</h4>
        <p className="text-[10px] text-[var(--text-muted)]">需要至少2个数据点绘制曲线</p>
      </div>
    );
  }

  const W = 400;
  const H = 120;
  const PAD = 30;
  const plotW = W - PAD * 2;
  const plotH = H - PAD * 2;

  const points = data.map((d, i) => ({
    x: PAD + (i / (data.length - 1)) * plotW,
    y: PAD + plotH - (d.tension / 100) * plotH,
    stage: d.stage,
    tension: d.tension,
    round: d.round,
  }));

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // Sigmoid 目标曲线 (K=0.1, T0=25)
  const sigmoidPoints = Array.from({ length: 50 }, (_, i) => {
    const t = i / 49;
    const round = data[0].round + t * (data[data.length - 1].round - data[0].round);
    const sigmoid = 100 / (1 + Math.exp(-0.1 * (round - 25)));
    return {
      x: PAD + t * plotW,
      y: PAD + plotH - (sigmoid / 100) * plotH,
    };
  });
  const sigmoidD = sigmoidPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // 阶段阈值线
  const thresholds = [
    { label: 'climax', value: 70, color: '#ef4444' },
    { label: 'rising', value: 40, color: '#fbbf24' },
    { label: 'falling', value: 50, color: '#a78bfa' },
  ];

  return (
    <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-3">
      <h4 className="text-xs font-semibold text-[var(--text-primary)] mb-2">紧张度曲线</h4>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 140 }}>
        {/* Y轴标签 */}
        {[0, 25, 50, 75, 100].map(v => (
          <text key={v} x={PAD - 4} y={PAD + plotH - (v / 100) * plotH + 3} textAnchor="end" className="text-[8px] fill-[var(--text-muted)]">
            {v}
          </text>
        ))}
        {/* 阶段阈值线 */}
        {thresholds.map(t => (
          <line key={t.label} x1={PAD} y1={PAD + plotH - (t.value / 100) * plotH} x2={W - PAD} y2={PAD + plotH - (t.value / 100) * plotH} stroke={t.color} strokeOpacity={0.3} strokeDasharray="4 2" />
        ))}
        {/* Sigmoid 目标曲线 */}
        <path d={sigmoidD} fill="none" stroke="#9ca3af" strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.5} />
        {/* 紧张度曲线 */}
        <path d={pathD} fill="none" stroke="var(--primary)" strokeWidth={1.5} />
        {/* 数据点 */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={STAGE_COLORS[p.stage]} stroke="var(--bg-card)" strokeWidth={1} />
        ))}
      </svg>
      <div className="flex items-center gap-3 mt-1 text-[9px] text-[var(--text-muted)]">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[var(--primary)]" />紧张度</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 border-t border-dashed border-gray-400" />Sigmoid目标</span>
        {Object.entries(STAGE_COLORS).map(([stage, color]) => (
          <span key={stage} className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: color }} />{stage}</span>
        ))}
      </div>
    </div>
  );
}

// ─── Factor Radar Chart (SVG) ────────────────────────────────────────────────

function FactorRadar({ factors }: { factors: Record<string, number> | null }) {
  const R = 60;
  const CX = 80;
  const CY = 75;
  const N = 5;

  if (!factors) {
    return (
      <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-3">
        <h4 className="text-xs font-semibold text-[var(--text-primary)] mb-2">5维因子</h4>
        <p className="text-[10px] text-[var(--text-muted)]">等待数据...</p>
      </div>
    );
  }

  const values = FACTOR_KEYS.map(k => factors[k] ?? 0);
  const angleStep = (2 * Math.PI) / N;

  // 网格线
  const gridLevels = [0.25, 0.5, 0.75, 1.0];
  const gridPaths = gridLevels.map(level => {
    const pts = Array.from({ length: N }, (_, i) => {
      const angle = -Math.PI / 2 + i * angleStep;
      return `${CX + level * R * Math.cos(angle)},${CY + level * R * Math.sin(angle)}`;
    });
    return `M ${pts.join(' L')} Z`;
  });

  // 数据多边形
  const dataPoints = values.map((v, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    const r = Math.max(0, Math.min(1, v)) * R;
    return `${CX + r * Math.cos(angle)},${CY + r * Math.sin(angle)}`;
  });
  const dataPath = `M ${dataPoints.join(' L')} Z`;

  // 轴线标签
  const axisLabels = FACTOR_LABELS.map((label, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    const lx = CX + (R + 14) * Math.cos(angle);
    const ly = CY + (R + 14) * Math.sin(angle);
    return { label, x: lx, y: ly + 3, anchor: (Math.abs(Math.cos(angle)) < 0.1 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end') as 'middle' | 'start' | 'end' };
  });

  return (
    <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-3">
      <h4 className="text-xs font-semibold text-[var(--text-primary)] mb-2">5维因子</h4>
      <svg viewBox="0 0 160 150" className="w-full" style={{ maxHeight: 150 }}>
        {/* 网格 */}
        {gridPaths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="var(--border-primary)" strokeWidth={0.5} />
        ))}
        {/* 轴线 */}
        {Array.from({ length: N }, (_, i) => {
          const angle = -Math.PI / 2 + i * angleStep;
          return <line key={i} x1={CX} y1={CY} x2={CX + R * Math.cos(angle)} y2={CY + R * Math.sin(angle)} stroke="var(--border-primary)" strokeWidth={0.5} />;
        })}
        {/* 数据区域 */}
        <path d={dataPath} fill="var(--primary)" fillOpacity={0.15} stroke="var(--primary)" strokeWidth={1.5} />
        {/* 数据点 */}
        {values.map((v, i) => {
          const angle = -Math.PI / 2 + i * angleStep;
          const r = Math.max(0, Math.min(1, v)) * R;
          return <circle key={i} cx={CX + r * Math.cos(angle)} cy={CY + r * Math.sin(angle)} r={2.5} fill="var(--primary)" />;
        })}
        {/* 标签 */}
        {axisLabels.map((a, i) => (
          <text key={i} x={a.x} y={a.y} textAnchor={a.anchor} className="text-[8px] fill-[var(--text-secondary)]">
            {a.label} {values[i].toFixed(2)}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ─── Current Pacing Status ───────────────────────────────────────────────────

function CurrentPacingStatus({
  tensionHistory,
  stageChanges,
}: {
  tensionHistory: Array<{ tension: number; stage: PacingStage; round: number; timestamp: number }>;
  stageChanges: Array<{ previousStage: PacingStage; currentStage: PacingStage; tension: number; timestamp: number }>;
}) {
  const latest = tensionHistory[tensionHistory.length - 1];
  if (!latest) return null;

  // 最近5轮事件密度（简化：用 tension_change 事件计数）
  const recentRounds = tensionHistory.slice(-5);
  const densityCounts = recentRounds.map(d => d.tension);

  return (
    <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-3">
      <h4 className="text-xs font-semibold text-[var(--text-primary)] mb-2">当前状态</h4>

      {/* 紧张度 + 阶段 */}
      <div className="flex items-center gap-3 mb-3">
        <div className="text-center">
          <div className="text-lg font-bold" style={{ color: STAGE_COLORS[latest.stage] }}>
            {latest.tension.toFixed(0)}
          </div>
          <div className="text-[9px] text-[var(--text-muted)]">紧张度</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold" style={{ color: STAGE_COLORS[latest.stage] }}>
            {latest.stage}
          </div>
          <div className="text-[9px] text-[var(--text-muted)]">阶段</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold text-[var(--text-secondary)]">{latest.round}</div>
          <div className="text-[9px] text-[var(--text-muted)]">轮次</div>
        </div>
      </div>

      {/* 紧张度条 */}
      <div className="mb-3">
        <div className="h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${latest.tension}%`, backgroundColor: STAGE_COLORS[latest.stage] }}
          />
        </div>
      </div>

      {/* 最近5轮密度柱状图 */}
      <div className="mb-2">
        <div className="text-[9px] text-[var(--text-muted)] mb-1">最近紧张度趋势</div>
        <div className="flex items-end gap-1 h-8">
          {densityCounts.map((v, i) => (
            <div key={i} className="flex-1 rounded-t" style={{
              height: `${Math.max(4, v)}%`,
              backgroundColor: STAGE_COLORS[recentRounds[i].stage],
              opacity: 0.7,
            }} />
          ))}
        </div>
      </div>

      {/* 阶段变化历史 */}
      {stageChanges.length > 0 && (
        <div>
          <div className="text-[9px] text-[var(--text-muted)] mb-1">阶段变化</div>
          <div className="space-y-0.5 max-h-16 overflow-y-auto">
            {stageChanges.slice(-5).map((sc, i) => (
              <div key={i} className="flex items-center gap-1 text-[9px]">
                <span style={{ color: STAGE_COLORS[sc.previousStage] }}>{sc.previousStage}</span>
                <span className="text-[var(--text-muted)]">→</span>
                <span style={{ color: STAGE_COLORS[sc.currentStage] }}>{sc.currentStage}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Density Bar Chart (CSS) ─────────────────────────────────────────────────

function DensityBarChart({ tensionHistory }: {
  tensionHistory: Array<{ round: number; eventCount?: number; stage: PacingStage }>;
}) {
  const recentRounds = tensionHistory.slice(-5);

  if (recentRounds.length === 0) {
    return (
      <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-3">
        <h4 className="text-xs font-semibold text-[var(--text-primary)] mb-2">事件密度</h4>
        <p className="text-[10px] text-[var(--text-muted)]">等待数据...</p>
      </div>
    );
  }

  const maxCount = Math.max(1, ...recentRounds.map(d => d.eventCount ?? 0));

  return (
    <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-3">
      <h4 className="text-xs font-semibold text-[var(--text-primary)] mb-2">事件密度</h4>
      <div className="flex items-end gap-2 h-16">
        {recentRounds.map((d, i) => {
          const count = d.eventCount ?? 0;
          const heightPct = maxCount > 0 ? (count / maxCount) * 100 : 0;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[9px] text-[var(--text-muted)]">{count}</span>
              <div className="w-full flex-1 flex items-end">
                <div
                  className="w-full rounded-t transition-all duration-300"
                  style={{
                    height: `${Math.max(4, heightPct)}%`,
                    backgroundColor: STAGE_COLORS[d.stage],
                    opacity: 0.8,
                  }}
                />
              </div>
              <span className="text-[8px] text-[var(--text-muted)]">R{d.round}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Progress Panel ──────────────────────────────────────────────────────────

function ProgressPanel({ tensionHistory }: {
  tensionHistory: Array<{ round: number; mainQuestProgress?: number; stage: PacingStage }>;
}) {
  const latest = tensionHistory[tensionHistory.length - 1];

  if (!latest) {
    return (
      <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-3">
        <h4 className="text-xs font-semibold text-[var(--text-primary)] mb-2">推进速度</h4>
        <p className="text-[10px] text-[var(--text-muted)]">等待数据...</p>
      </div>
    );
  }

  const currentProgress = latest.mainQuestProgress ?? 0;
  // Sigmoid 目标曲线 (K=0.1, T0=25)
  const targetProgress = 100 / (1 + Math.exp(-0.1 * (latest.round - 25)));
  const deviation = (currentProgress - targetProgress) / 100;
  const deviationPct = (deviation * 100).toFixed(0);
  const isOverSpeed = deviation > 0.3;
  const isUnderSpeed = deviation < -0.3;

  return (
    <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] p-3">
      <h4 className="text-xs font-semibold text-[var(--text-primary)] mb-2">推进速度</h4>

      {/* 数值面板 */}
      <div className="flex items-center gap-3 mb-3">
        <div className="text-center">
          <div className="text-sm font-bold text-[var(--primary)]">{currentProgress}%</div>
          <div className="text-[9px] text-[var(--text-muted)]">当前进度</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold text-[var(--text-secondary)]">{targetProgress.toFixed(0)}%</div>
          <div className="text-[9px] text-[var(--text-muted)]">目标进度</div>
        </div>
        <div className="text-center">
          <div className={cn(
            'text-sm font-semibold',
            isOverSpeed ? 'text-red-400' : isUnderSpeed ? 'text-yellow-400' : 'text-green-500',
          )}>
            {deviation > 0 ? '+' : ''}{deviationPct}%
          </div>
          <div className="text-[9px] text-[var(--text-muted)]">偏离度</div>
        </div>
      </div>

      {/* 当前进度条 */}
      <div className="mb-2">
        <div className="flex items-center justify-between text-[9px] text-[var(--text-muted)] mb-0.5">
          <span>当前</span>
          <span>{currentProgress}%</span>
        </div>
        <div className="h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300 bg-[var(--primary)]"
            style={{ width: `${Math.min(100, currentProgress)}%` }}
          />
        </div>
      </div>

      {/* 目标进度条 */}
      <div>
        <div className="flex items-center justify-between text-[9px] text-[var(--text-muted)] mb-0.5">
          <span>目标</span>
          <span>{targetProgress.toFixed(0)}%</span>
        </div>
        <div className="h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300 bg-[var(--text-muted)]"
            style={{ width: `${Math.min(100, targetProgress)}%`, opacity: 0.5 }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Review Alerts ───────────────────────────────────────────────────────────

function ReviewAlerts({ alerts }: {
  alerts: Array<{
    tensionConsistent: boolean;
    consecutiveHighPressure: boolean;
    consecutiveLowPressure: boolean;
    progressDeviation: number;
    suggestions: string[];
    timestamp: number;
  }>;
}) {
  const latest = alerts[alerts.length - 1];
  if (!latest) return null;

  return (
    <div className="rounded-md border border-[var(--error)]/30 bg-[var(--error)]/5 p-3">
      <div className="flex items-center gap-2 mb-2">
        <ExclamationTriangleIcon className="h-3.5 w-3.5 text-[var(--error)]" />
        <h4 className="text-xs font-semibold text-[var(--error)]">节奏审查告警</h4>
        <span className="text-[9px] text-[var(--text-muted)] ml-auto">{formatTime(latest.timestamp)}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[10px] mb-2">
        <div>
          <span className="text-[var(--text-muted)]">紧张度一致性: </span>
          <span className={latest.tensionConsistent ? 'text-green-500' : 'text-red-400'}>
            {latest.tensionConsistent ? '通过' : '异常'}
          </span>
        </div>
        <div>
          <span className="text-[var(--text-muted)]">进度偏离: </span>
          <span className={Math.abs(latest.progressDeviation) > 0.3 ? 'text-red-400' : 'text-green-500'}>
            {(latest.progressDeviation * 100).toFixed(0)}%
          </span>
        </div>
        <div>
          <span className="text-[var(--text-muted)]">连续高压: </span>
          <span className={latest.consecutiveHighPressure ? 'text-red-400' : 'text-green-500'}>
            {latest.consecutiveHighPressure ? '是' : '否'}
          </span>
        </div>
        <div>
          <span className="text-[var(--text-muted)]">连续低压: </span>
          <span className={latest.consecutiveLowPressure ? 'text-yellow-400' : 'text-green-500'}>
            {latest.consecutiveLowPressure ? '是' : '否'}
          </span>
        </div>
      </div>
      {latest.suggestions.length > 0 && (
        <div>
          <div className="text-[9px] text-[var(--text-muted)] mb-1">建议</div>
          <ul className="list-disc list-inside space-y-0.5">
            {latest.suggestions.map((s, i) => (
              <li key={i} className="text-[10px] text-[var(--text-secondary)]">{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
