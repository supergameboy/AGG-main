import { useState, useEffect, useCallback, memo } from 'react';
import {
  BookOpenIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { apiClient } from '@/api/client';
import { useGameStore } from '@/stores/gameStore';
import { DRIVE_DIMENSIONS } from '@/utils/driveDimensions';

interface StoryRuntimeState {
  storyPhase?: string;
  activeHooks?: string[];
  lastStoryDirective?: Record<string, unknown>;
  lastResolvedLayer1Agents?: string[];
  lastWriteToolTypes?: string[];
  lastNeedAgentReasons?: string[];
  lastStoryStateUpdatedAt?: number;
  [key: string]: unknown;
}

interface EntityGraphData {
  nodeCount: number;
  edgeCount: number;
  nodesByType: Record<string, number>;
  edgesByRelation: Record<string, number>;
  boundaries: Array<{
    entityId: string;
    entityType: string;
    label: string;
    knownFacts: string[];
    unknownFacts: string[];
  }>;
  snapshots: Array<{
    id: string;
    snapshotType: string;
    chapterNumber: number | null;
    nodesCount: number;
    edgesCount: number;
    createdAt: number;
  }>;
}

interface StoryOrchestrationData {
  saveId: string;
  chapter: string | null;
  eventStats: Record<string, number>;
  totalEvents: number;
  recentEvents: Array<{
    id: string;
    eventType: string;
    title: string;
    importance: string;
    chapter: string;
    timestamp: number;
  }>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  runtimeState: StoryRuntimeState | null;
  entityGraph?: EntityGraphData;
}

interface StoryTabProps {
  className?: string;
}

const IMPORTANCE_CONFIG: Record<string, { color: string; label: string }> = {
  critical: { color: 'var(--error, #ef4444)', label: '关键' },
  major: { color: 'var(--warning, #f59e0b)', label: '重要' },
  minor: { color: 'var(--text-muted, #94a3b8)', label: '一般' },
};

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export const StoryTab = memo(function StoryTab({ className }: StoryTabProps) {
  const saveId = useGameStore((s) => s.saveId);
  const npcInfoList = useGameStore((s) => s.npcInfoList);
  const [data, setData] = useState<StoryOrchestrationData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [runtimeExpanded, setRuntimeExpanded] = useState(true);
  const [graphOverviewExpanded, setGraphOverviewExpanded] = useState(true);
  const [boundaryExpanded, setBoundaryExpanded] = useState(false);
  const [snapshotsExpanded, setSnapshotsExpanded] = useState(false);
  const [driveOverviewExpanded, setDriveOverviewExpanded] = useState(false);

  const npcsWithDrive = npcInfoList.filter((npc) => npc.driveProfile);

  const fetchData = useCallback(async () => {
    if (!saveId) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<StoryOrchestrationData>(`/dev/story-orchestration?saveId=${saveId}`);
      // apiClient 拦截器已解包 success 响应，response 实际值就是 StoryOrchestrationData
      setData(response as unknown as StoryOrchestrationData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch story orchestration data');
    } finally {
      setIsLoading(false);
    }
  }, [saveId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const statsEntries = data ? Object.entries(data.eventStats) : [];

  return (
    <div className={cn('flex h-full flex-col gap-3 overflow-y-auto p-1', className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--text-primary)]">故事编排观测</h3>
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowPathIcon className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />}
          onClick={fetchData}
          disabled={isLoading}
        >
          刷新
        </Button>
      </div>

      {error && (
        <Card variant="default" padding="sm" className="border-[var(--error)]">
          <div className="flex items-center gap-2 text-[var(--error)]">
            <ExclamationTriangleIcon className="h-4 w-4" />
            <span className="text-xs">{error}</span>
          </div>
        </Card>
      )}

      {!error && data && (
        <>
          <Card variant="default" padding="md">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)]">当前章节</span>
                <Badge size="sm">{data.chapter ?? '—'}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)]">事件总数</span>
                <span className="text-sm font-medium text-[var(--text-primary)]">{data.totalEvents}</span>
              </div>
              {statsEntries.length > 0 && (
                <div className="space-y-1 border-t border-[var(--border-primary)] pt-2">
                  <span className="text-xs text-[var(--text-muted)]">事件重要性分布</span>
                  <div className="flex gap-2">
                    {statsEntries.map(([importance, count]) => {
                      const config = IMPORTANCE_CONFIG[importance] ?? IMPORTANCE_CONFIG.minor;
                      return (
                        <div key={importance} className="flex items-center gap-1">
                          <Badge customColor={config.color} size="sm">
                            {config.label}
                          </Badge>
                          <span className="text-xs text-[var(--text-primary)]">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </Card>

          {data.runtimeState && (
            <Card variant="default" padding="md">
              <div
                className="flex cursor-pointer items-center gap-1"
                onClick={() => setRuntimeExpanded((v) => !v)}
              >
                {runtimeExpanded ? (
                  <ChevronDownIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
                ) : (
                  <ChevronRightIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
                )}
                <span className="text-xs font-medium text-[var(--text-primary)]">运行时故事状态</span>
              </div>
              {runtimeExpanded && (
                <div className="mt-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--text-muted)]">Story Phase</span>
                    <Badge size="sm" variant="info">{data.runtimeState.storyPhase ?? '—'}</Badge>
                  </div>
                  {Array.isArray(data.runtimeState.activeHooks) && data.runtimeState.activeHooks.length > 0 && (
                    <div>
                      <span className="text-xs text-[var(--text-muted)]">Active Hooks</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {data.runtimeState.activeHooks.map((hook) => (
                          <Badge key={hook} size="sm" variant="primary">{hook}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {data.runtimeState.lastStoryDirective && (
                    <div>
                      <span className="text-xs text-[var(--text-muted)]">Last Directive</span>
                      <p className="mt-0.5 text-xs text-[var(--text-primary)]">
                        {typeof data.runtimeState.lastStoryDirective === 'string'
                          ? data.runtimeState.lastStoryDirective
                          : JSON.stringify(data.runtimeState.lastStoryDirective)}
                      </p>
                    </div>
                  )}
                  {data.runtimeState.lastStoryStateUpdatedAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-muted)]">Last Updated</span>
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {formatTime(data.runtimeState.lastStoryStateUpdatedAt)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

          <div className="space-y-1">
            <span className="text-xs text-[var(--text-muted)]">最近事件</span>
            {data.recentEvents.length === 0 ? (
              <div className="py-4 text-center text-xs text-[var(--text-muted)]">暂无事件</div>
            ) : (
              data.recentEvents.map((event) => {
                const importance = IMPORTANCE_CONFIG[event.importance] ?? IMPORTANCE_CONFIG.minor;
                const isExpanded = expandedId === event.id;
                return (
                  <div
                    key={event.id}
                    className={cn(
                      'cursor-pointer rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--bg-secondary)]',
                      isExpanded && 'bg-[var(--bg-secondary)]'
                    )}
                    onClick={() => setExpandedId(isExpanded ? null : event.id)}
                  >
                    <div className="flex items-center gap-2">
                      {isExpanded ? (
                        <ChevronDownIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
                      ) : (
                        <ChevronRightIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
                      )}
                      <Badge customColor={importance.color} size="sm">
                        {importance.label}
                      </Badge>
                      <span className="text-xs text-[var(--text-primary)] truncate">{event.title}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-[var(--text-muted)]">
                        {formatTime(event.timestamp)}
                      </span>
                    </div>
                    {isExpanded && (
                      <div className="ml-5 mt-1 space-y-0.5 border-t border-[var(--border-primary)] pt-1">
                        <div className="text-[10px] text-[var(--text-muted)]">
                          类型：{event.eventType}
                        </div>
                        {event.chapter && (
                          <div className="text-[10px] text-[var(--text-muted)]">
                            章节：{event.chapter}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {npcsWithDrive.length > 0 && (
            <Card variant="default" padding="md">
              <div
                className="flex cursor-pointer items-center gap-1"
                onClick={() => setDriveOverviewExpanded((v) => !v)}
              >
                {driveOverviewExpanded ? (
                  <ChevronDownIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
                ) : (
                  <ChevronRightIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
                )}
                <UserGroupIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
                <span className="text-xs font-medium text-[var(--text-primary)]">NPC 驱动力概览</span>
                <Badge size="sm" variant="info">{npcsWithDrive.length}</Badge>
              </div>
              {driveOverviewExpanded && (
                <div className="mt-2 space-y-2">
                  {npcsWithDrive.map((npc) => (
                    <div key={npc.id} className="rounded-md bg-[var(--bg-secondary)] p-2">
                      <div className="text-xs font-medium text-[var(--text-primary)] mb-1.5">{npc.name}</div>
                      <div className="space-y-1">
                        {DRIVE_DIMENSIONS.map(({ key, label, color }) => {
                          const value = npc.driveProfile![key];
                          if (value === undefined) return null;
                          return (
                            <div key={key} className="flex items-center gap-1.5">
                              <span className="text-[10px] text-[var(--text-muted)] w-8 shrink-0">{label}</span>
                              <div className="flex-1 h-1 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{ width: `${Math.min(value, 100)}%`, backgroundColor: color }}
                                />
                              </div>
                              <span className="text-[10px] font-mono text-[var(--text-secondary)] w-5 text-right">{value}</span>
                            </div>
                          );
                        })}
                      </div>
                      {npc.goals && npc.goals.filter((g) => g.status === 'active').length > 0 && (
                        <div className="mt-1.5 border-t border-[var(--border-primary)] pt-1.5">
                          <span className="text-[10px] text-[var(--text-muted)]">活跃目标</span>
                          <div className="mt-0.5 space-y-0.5">
                            {npc.goals.filter((g) => g.status === 'active').slice(0, 3).map((goal) => (
                              <div key={goal.id} className="text-[10px] text-[var(--text-primary)]">
                                [{goal.type === 'long_term' ? '长期' : '中期'}] {goal.description}
                              </div>
                            ))}
                            {npc.goals.filter((g) => g.status === 'active').length > 3 && (
                              <div className="text-[10px] text-[var(--text-muted)]">
                                +{npc.goals.filter((g) => g.status === 'active').length - 3} 更多
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {data.entityGraph && (
            <>
              <Card variant="default" padding="md">
                <div
                  className="flex cursor-pointer items-center gap-1"
                  onClick={() => setGraphOverviewExpanded((v) => !v)}
                >
                  {graphOverviewExpanded ? (
                    <ChevronDownIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
                  ) : (
                    <ChevronRightIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
                  )}
                  <span className="text-xs font-medium text-[var(--text-primary)]">Entity Graph 概览</span>
                </div>
                {graphOverviewExpanded && (
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-muted)]">节点数</span>
                      <span className="text-sm font-medium text-[var(--text-primary)]">{data.entityGraph.nodeCount}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-muted)]">边数</span>
                      <span className="text-sm font-medium text-[var(--text-primary)]">{data.entityGraph.edgeCount}</span>
                    </div>
                    {Object.keys(data.entityGraph.nodesByType).length > 0 && (
                      <div className="space-y-1 border-t border-[var(--border-primary)] pt-2">
                        <span className="text-xs text-[var(--text-muted)]">节点类型分布</span>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(data.entityGraph.nodesByType).map(([type, count]) => (
                            <div key={type} className="flex items-center gap-1">
                              <Badge size="sm" variant="info">{type}</Badge>
                              <span className="text-xs text-[var(--text-primary)]">{count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {Object.keys(data.entityGraph.edgesByRelation).length > 0 && (
                      <div className="space-y-1 border-t border-[var(--border-primary)] pt-2">
                        <span className="text-xs text-[var(--text-muted)]">关系类型分布</span>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(data.entityGraph.edgesByRelation).map(([relation, count]) => (
                            <div key={relation} className="flex items-center gap-1">
                              <Badge size="sm" variant="primary">{relation}</Badge>
                              <span className="text-xs text-[var(--text-primary)]">{count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Card>

              {data.entityGraph.boundaries.length > 0 && (
                <Card variant="default" padding="md">
                  <div
                    className="flex cursor-pointer items-center gap-1"
                    onClick={() => setBoundaryExpanded((v) => !v)}
                  >
                    {boundaryExpanded ? (
                      <ChevronDownIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
                    ) : (
                      <ChevronRightIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
                    )}
                    <span className="text-xs font-medium text-[var(--text-primary)]">信息边界</span>
                    <Badge size="sm" variant="info">{data.entityGraph.boundaries.length}</Badge>
                  </div>
                  {boundaryExpanded && (
                    <div className="mt-2 space-y-2">
                      {data.entityGraph.boundaries.map((b) => (
                        <div key={b.entityId} className="rounded-md bg-[var(--bg-secondary)] p-2">
                          <div className="text-xs font-medium text-[var(--text-primary)]">{b.label}</div>
                          {b.knownFacts.length > 0 && (
                            <div className="mt-1">
                              <span className="text-[10px] text-[var(--text-muted)]">已知信息</span>
                              <div className="mt-0.5 space-y-0.5">
                                {b.knownFacts.map((fact, idx) => (
                                  <div key={idx} className="text-[10px] text-[var(--text-primary)]">- {fact}</div>
                                ))}
                              </div>
                            </div>
                          )}
                          {b.unknownFacts.length > 0 && (
                            <div className="mt-1">
                              <span className="text-[10px] text-[var(--text-muted)]">不应知道</span>
                              <div className="mt-0.5 space-y-0.5">
                                {b.unknownFacts.map((fact, idx) => (
                                  <div key={idx} className="text-[10px] text-[var(--warning)]">- {fact}</div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              )}

              {data.entityGraph.snapshots.length > 0 && (
                <Card variant="default" padding="md">
                  <div
                    className="flex cursor-pointer items-center gap-1"
                    onClick={() => setSnapshotsExpanded((v) => !v)}
                  >
                    {snapshotsExpanded ? (
                      <ChevronDownIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
                    ) : (
                      <ChevronRightIcon className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
                    )}
                    <span className="text-xs font-medium text-[var(--text-primary)]">图快照</span>
                    <Badge size="sm" variant="info">{data.entityGraph.snapshots.length}</Badge>
                  </div>
                  {snapshotsExpanded && (
                    <div className="mt-2 space-y-2">
                      {data.entityGraph.snapshots.map((snap) => (
                        <div key={snap.id} className="rounded-md bg-[var(--bg-secondary)] p-2">
                          <div className="flex items-center justify-between">
                            <Badge size="sm" variant={snap.snapshotType === 'baseline' ? 'primary' : 'info'}>
                              {snap.snapshotType === 'baseline' ? '基线' : `章节 ${snap.chapterNumber ?? '?'}`}
                            </Badge>
                            <span className="text-[10px] text-[var(--text-muted)]">{formatTime(snap.createdAt)}</span>
                          </div>
                          <div className="mt-1 flex gap-3">
                            <span className="text-[10px] text-[var(--text-muted)]">节点: {snap.nodesCount}</span>
                            <span className="text-[10px] text-[var(--text-muted)]">边: {snap.edgesCount}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              )}
            </>
          )}
        </>
      )}

      {!error && !data && !isLoading && (
        <div className="flex flex-col items-center justify-center py-8 text-[var(--text-muted)]">
          <BookOpenIcon className="mb-2 h-8 w-8 opacity-30" />
          <p className="text-sm">加载存档后查看故事编排数据</p>
        </div>
      )}
    </div>
  );
});
