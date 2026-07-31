import { useState, useMemo, useCallback, useEffect, memo } from 'react';
import {
  ChartBarIcon,
  GlobeAltIcon,
  CpuChipIcon,
  ExclamationTriangleIcon,
  ArrowDownTrayIcon,
  TrashIcon,
  PlayIcon,
  StopIcon,
  SignalIcon,
  PaintBrushIcon,
  CircleStackIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import { usePerformanceStore } from '@/stores/performanceStore';
import { useLLMMetricsStore, type LLMTimeRange } from '@/stores/llmMetricsStore';
import type { PerformanceAlert, PercentileStats } from '@/stores/performanceStore';
import {
  startPerformanceMonitoring,
  stopPerformanceMonitoring,
  isPerformanceMonitoringActive,
} from '@/utils/performanceMonitor';

interface PerformanceTabProps {
  className?: string;
}

type DetailTabId = 'api' | 'ws' | 'render' | 'memory' | 'chat';

const ALERT_TYPE_CONFIG: Record<PerformanceAlert['type'], { color: string; icon: typeof ChartBarIcon; label: string }> = {
  api: { color: '#3b82f6', icon: GlobeAltIcon, label: 'API' },
  ws: { color: '#22c55e', icon: SignalIcon, label: 'WS' },
  render: { color: '#f97316', icon: PaintBrushIcon, label: '渲染' },
  memory: { color: '#ef4444', icon: CpuChipIcon, label: '内存' },
};

function formatMs(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatShortHash(value: string | null | undefined): string {
  if (!value) return '-';
  return value.length <= 12 ? value : `${value.slice(0, 12)}...`;
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

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  subValues?: string[];
  color: string;
}

const MetricCard = memo(function MetricCard({ icon, label, value, subValues, color }: MetricCardProps) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-3">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)` }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">{label}</p>
        <p className="text-lg font-bold leading-tight" style={{ color }}>{value}</p>
        {subValues && subValues.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
            {subValues.map((sv, i) => (
              <span key={i} className="text-[10px] text-[var(--text-muted)]">{sv}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

interface AlertRowProps {
  alert: PerformanceAlert;
}

const AlertRow = memo(function AlertRow({ alert }: AlertRowProps) {
  const config = ALERT_TYPE_CONFIG[alert.type];
  const Icon = config.icon;

  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--bg-secondary)] transition-colors">
      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: config.color }} />
      <Badge customColor={config.color} size="sm">{config.label}</Badge>
      <span className="flex-1 text-xs text-[var(--text-primary)] truncate">{alert.message}</span>
      <span className="text-[10px] font-mono text-[var(--text-muted)]">
        {formatMs(alert.value)}/{formatMs(alert.threshold)}
      </span>
      <span className="text-[10px] text-[var(--text-muted)] font-mono">{formatTime(alert.timestamp)}</span>
    </div>
  );
});

interface StatsRowProps {
  stats: PercentileStats;
  unit?: string;
}

const StatsRow = memo(function StatsRow({ stats, unit = 'ms' }: StatsRowProps) {
  const fmt = unit === 'ms' ? formatMs : (v: number) => `${v}`;
  return (
    <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)] font-mono">
      <span>P50: <span className="text-[var(--text-primary)]">{fmt(stats.p50)}</span></span>
      <span>P95: <span className="text-[var(--text-primary)]">{fmt(stats.p95)}</span></span>
      <span>P99: <span className="text-[var(--text-primary)]">{fmt(stats.p99)}</span></span>
      <span>AVG: <span className="text-[var(--text-primary)]">{fmt(stats.avg)}</span></span>
      <span>MIN: <span className="text-[var(--text-primary)]">{fmt(stats.min)}</span></span>
      <span>MAX: <span className="text-[var(--text-primary)]">{fmt(stats.max)}</span></span>
      <span>N: <span className="text-[var(--text-primary)]">{stats.count}</span></span>
    </div>
  );
});

export function PerformanceTab({ className }: PerformanceTabProps) {
  const [isMonitoring, setIsMonitoring] = useState(isPerformanceMonitoringActive());
  const [detailTab, setDetailTab] = useState<DetailTabId>('api');
  const [thresholdInputs, setThresholdInputs] = useState({
    apiMaxMs: '',
    wsMaxMs: '',
    renderMaxMs: '',
  });

  const apiResponseTimes = usePerformanceStore((s) => s.apiResponseTimes);
  const wsLatencies = usePerformanceStore((s) => s.wsLatencies);
  const renderMetrics = usePerformanceStore((s) => s.renderMetrics);
  const memoryUsage = usePerformanceStore((s) => s.memoryUsage);
  const alerts = usePerformanceStore((s) => s.alerts);
  const thresholds = usePerformanceStore((s) => s.thresholds);
  const setThresholds = usePerformanceStore((s) => s.setThresholds);
  const clearAlerts = usePerformanceStore((s) => s.clearAlerts);
  const exportMetrics = usePerformanceStore((s) => s.exportMetrics);

  const apiStats = useMemo(() => usePerformanceStore.getState().getApiStats(), [apiResponseTimes]);
  const wsStats = useMemo(() => usePerformanceStore.getState().getWsStats(), [wsLatencies]);
  const renderStats = useMemo(() => usePerformanceStore.getState().getRenderStats(), [renderMetrics]);

  const latestMemory = useMemo(() => {
    if (memoryUsage.length === 0) return null;
    return memoryUsage[memoryUsage.length - 1];
  }, [memoryUsage]);

  const avgRenderDuration = useMemo(() => {
    if (renderMetrics.length === 0) return 0;
    const recent = renderMetrics.slice(-10);
    return recent.reduce((sum, r) => sum + r.duration, 0) / recent.length;
  }, [renderMetrics]);

  useEffect(() => {
    setThresholdInputs({
      apiMaxMs: String(thresholds.apiMaxMs),
      wsMaxMs: String(thresholds.wsMaxMs),
      renderMaxMs: String(thresholds.renderMaxMs),
    });
  }, [thresholds.apiMaxMs, thresholds.wsMaxMs, thresholds.renderMaxMs]);

  const handleToggleMonitoring = useCallback(() => {
    if (isMonitoring) {
      stopPerformanceMonitoring();
      setIsMonitoring(false);
    } else {
      startPerformanceMonitoring();
      setIsMonitoring(true);
    }
  }, [isMonitoring]);

  const handleThresholdChange = useCallback((key: string, value: string) => {
    setThresholdInputs((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleThresholdBlur = useCallback((key: keyof typeof thresholds, value: string) => {
    const num = parseInt(value, 10);
    if (!isNaN(num) && num > 0) {
      setThresholds({ [key]: num });
    } else {
      setThresholdInputs((prev) => ({ ...prev, [key]: String(thresholds[key]) }));
    }
  }, [setThresholds, thresholds]);

  const handleExport = useCallback(() => {
    const json = exportMetrics();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadJson(json, `performance-metrics-${timestamp}.json`);
  }, [exportMetrics]);

  const chatMetrics = usePerformanceStore((s) => s.chatMetrics);
  const chatStats = usePerformanceStore((s) => s.getChatStats());
  const llmFilters = useLLMMetricsStore((s) => s.filters);
  const llmSummary = useLLMMetricsStore((s) => s.summary);
  const llmRecentItems = useLLMMetricsStore((s) => s.recentItems);
  const llmAvailableStages = useLLMMetricsStore((s) => s.availableStages);
  const llmLoading = useLLMMetricsStore((s) => s.loading);
  const llmError = useLLMMetricsStore((s) => s.error);
  const setLLMTimeRange = useLLMMetricsStore((s) => s.setTimeRange);
  const setLLMStage = useLLMMetricsStore((s) => s.setStage);
  const refreshLLMMetrics = useLLMMetricsStore((s) => s.refresh);

  const DETAIL_TABS = useMemo(() => [
    { id: 'api', label: 'API', count: apiResponseTimes.length },
    { id: 'ws', label: 'WS', count: wsLatencies.length },
    { id: 'render', label: '渲染', count: renderMetrics.length },
    { id: 'memory', label: '内存', count: memoryUsage.length },
    { id: 'chat', label: 'Chat', count: chatMetrics.length },
  ], [apiResponseTimes.length, wsLatencies.length, renderMetrics.length, memoryUsage.length, chatMetrics.length]);

  useEffect(() => {
    void refreshLLMMetrics();
  }, [llmFilters.timeRange, llmFilters.stage, refreshLLMMetrics]);

  const llmStageOptions = useMemo(() => {
    return llmAvailableStages.length > 0 ? llmAvailableStages : ['all'];
  }, [llmAvailableStages]);

  const renderDetailContent = () => {
    switch (detailTab) {
      case 'api':
        return (
          <div className="space-y-1">
            <StatsRow stats={apiStats} />
            {apiResponseTimes.length === 0 ? (
              <p className="py-4 text-center text-xs text-[var(--text-muted)]">暂无API响应时间记录</p>
            ) : (
              [...apiResponseTimes].reverse().map((r, i) => (
                <div key={`${r.timestamp}-${i}`} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-[var(--bg-secondary)]">
                  <span className="font-mono text-[var(--text-muted)] w-14 shrink-0">{formatTime(r.timestamp)}</span>
                  <Badge variant="default" size="sm">{r.method}</Badge>
                  <span className="flex-1 text-[var(--text-primary)] truncate">{r.url}</span>
                  <span className={cn('font-mono shrink-0', r.duration > thresholds.apiMaxMs ? 'text-[var(--error)]' : 'text-[var(--text-secondary)]')}>
                    {formatMs(r.duration)}
                  </span>
                </div>
              ))
            )}
          </div>
        );
      case 'ws':
        return (
          <div className="space-y-1">
            <StatsRow stats={wsStats} />
            {wsLatencies.length === 0 ? (
              <p className="py-4 text-center text-xs text-[var(--text-muted)]">暂无WS延迟记录</p>
            ) : (
              [...wsLatencies].reverse().map((r, i) => (
                <div key={`${r.timestamp}-${i}`} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-[var(--bg-secondary)]">
                  <span className="font-mono text-[var(--text-muted)] w-14 shrink-0">{formatTime(r.timestamp)}</span>
                  <Badge variant="default" size="sm">{r.eventType}</Badge>
                  <span className={cn('font-mono shrink-0', r.latency > thresholds.wsMaxMs ? 'text-[var(--error)]' : 'text-[var(--text-secondary)]')}>
                    {formatMs(r.latency)}
                  </span>
                </div>
              ))
            )}
          </div>
        );
      case 'render':
        return (
          <div className="space-y-1">
            <StatsRow stats={renderStats} />
            {renderMetrics.length === 0 ? (
              <p className="py-4 text-center text-xs text-[var(--text-muted)]">暂无渲染耗时记录</p>
            ) : (
              [...renderMetrics].reverse().map((r, i) => (
                <div key={`${r.timestamp}-${i}`} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-[var(--bg-secondary)]">
                  <span className="font-mono text-[var(--text-muted)] w-14 shrink-0">{formatTime(r.timestamp)}</span>
                  <span className="flex-1 text-[var(--text-primary)] truncate">{r.componentName}</span>
                  <span className={cn('font-mono shrink-0', r.duration > thresholds.renderMaxMs ? 'text-[var(--error)]' : 'text-[var(--text-secondary)]')}>
                    {formatMs(r.duration)}
                  </span>
                </div>
              ))
            )}
          </div>
        );
      case 'memory':
        return (
          <div className="space-y-1">
            {memoryUsage.length === 0 ? (
              <p className="py-4 text-center text-xs text-[var(--text-muted)]">暂无内存使用记录（仅Chrome支持）</p>
            ) : (
              [...memoryUsage].reverse().map((r, i) => {
                const usagePercent = (r.usedJSHeapSize / r.jsHeapSizeLimit) * 100;
                return (
                  <div key={`${r.timestamp}-${i}`} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-[var(--bg-secondary)]">
                    <span className="font-mono text-[var(--text-muted)] w-14 shrink-0">{formatTime(r.timestamp)}</span>
                    <span className="font-mono text-[var(--text-primary)]">{formatBytes(r.usedJSHeapSize)}</span>
                    <span className="text-[var(--text-muted)]">/</span>
                    <span className="font-mono text-[var(--text-secondary)]">{formatBytes(r.totalJSHeapSize)}</span>
                    <div className="flex-1" />
                    <div className="w-20 h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          usagePercent > 80 ? 'bg-[var(--error)]' : usagePercent > 60 ? 'bg-[var(--warning)]' : 'bg-[var(--success)]'
                        )}
                        style={{ width: `${Math.min(usagePercent, 100)}%` }}
                      />
                    </div>
                    <span className={cn(
                      'font-mono shrink-0 text-[10px]',
                      usagePercent > 80 ? 'text-[var(--error)]' : 'text-[var(--text-muted)]'
                    )}>
                      {usagePercent.toFixed(1)}%
                    </span>
                  </div>
                );
              })
            )}
          </div>
        );
      case 'chat':
        return (
          <div className="space-y-1">
            <StatsRow stats={chatStats} />
            {chatMetrics.length === 0 ? (
              <p className="py-4 text-center text-xs text-[var(--text-muted)]">暂无Chat性能记录</p>
            ) : (
              [...chatMetrics].reverse().map((r, i) => (
                <div key={`${r.timestamp}-${i}`} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-[var(--bg-secondary)]">
                  <span className="font-mono text-[var(--text-muted)] w-14 shrink-0">{formatTime(r.timestamp)}</span>
                  <span className={cn(
                    'font-mono',
                    r.processingTime > 3000 ? 'text-[var(--error)]' : r.processingTime > 1500 ? 'text-[var(--warning)]' : 'text-[var(--success)]'
                  )}>
                    {formatMs(r.processingTime)}
                  </span>
                  {r.gmDuration !== undefined && (
                    <>
                      <span className="text-[var(--text-muted)]">GM:</span>
                      <span className="font-mono text-[var(--text-secondary)]">{formatMs(r.gmDuration)}</span>
                    </>
                  )}
                  {r.reactIterations !== undefined && (
                    <>
                      <span className="text-[var(--text-muted)]">迭代:</span>
                      <span className="font-mono text-[var(--text-secondary)]">{r.reactIterations}</span>
                    </>
                  )}
                  <div className="flex-1" />
                  <div className="flex gap-0.5">
                    {r.agentsInvolved.map((a) => (
                      <span key={a} className="rounded bg-[var(--bg-tertiary)] px-1 py-0.5 text-[10px] text-[var(--text-muted)]">{a}</span>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        );
    }
  };

  return (
    <Card variant="default" padding="md" className={cn('flex h-full flex-col', className)}>
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--border-primary)]">
        <div className="flex items-center gap-2">
          <ChartBarIcon className="h-4 w-4 text-[var(--text-muted)]" />
          <span className="text-xs font-medium text-[var(--text-secondary)]">性能监控</span>
          <Badge variant={isMonitoring ? 'success' : 'default'} size="sm" dot>
            {isMonitoring ? '监控中' : '已停止'}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={isMonitoring ? 'danger' : 'primary'}
            size="sm"
            icon={isMonitoring ? <StopIcon className="h-3 w-3" /> : <PlayIcon className="h-3 w-3" />}
            onClick={handleToggleMonitoring}
            className="text-[10px]"
          >
            {isMonitoring ? '停止' : '启动'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 mb-3">
        <MetricCard
          icon={<GlobeAltIcon className="h-4 w-4" style={{ color: '#3b82f6' }} />}
          label="API响应"
          value={apiStats.count > 0 ? formatMs(apiStats.p50) : '-'}
          subValues={apiStats.count > 0 ? [`P95: ${formatMs(apiStats.p95)}`, `P99: ${formatMs(apiStats.p99)}`] : undefined}
          color="#3b82f6"
        />
        <MetricCard
          icon={<SignalIcon className="h-4 w-4" style={{ color: '#22c55e' }} />}
          label="WS延迟"
          value={wsStats.count > 0 ? formatMs(wsStats.p50) : '-'}
          subValues={wsStats.count > 0 ? [`P95: ${formatMs(wsStats.p95)}`] : undefined}
          color="#22c55e"
        />
        <MetricCard
          icon={<PaintBrushIcon className="h-4 w-4" style={{ color: '#f97316' }} />}
          label="渲染耗时"
          value={renderMetrics.length > 0 ? formatMs(avgRenderDuration) : '-'}
          subValues={renderMetrics.length > 0 ? [`P95: ${formatMs(renderStats.p95)}`] : undefined}
          color="#f97316"
        />
        <MetricCard
          icon={<CircleStackIcon className="h-4 w-4" style={{ color: '#ef4444' }} />}
          label="内存使用"
          value={latestMemory ? formatBytes(latestMemory.usedJSHeapSize) : '-'}
          subValues={latestMemory ? [`${formatBytes(latestMemory.totalJSHeapSize)} / ${formatBytes(latestMemory.jsHeapSizeLimit)}`] : ['仅Chrome支持']}
          color="#ef4444"
        />
      </div>

      <div className="mb-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CpuChipIcon className="h-4 w-4 text-[var(--text-muted)]" />
            <span className="text-xs font-medium text-[var(--text-secondary)]">LLM分析</span>
            {llmLoading && (
              <Badge variant="default" size="sm">加载中</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={llmFilters.timeRange}
              onChange={(e) => setLLMTimeRange(e.target.value as LLMTimeRange)}
              className="h-7 rounded border border-[var(--border-primary)] bg-[var(--bg-card)] px-2 text-xs text-[var(--text-primary)]"
            >
              <option value="1h">近1小时</option>
              <option value="6h">近6小时</option>
              <option value="24h">近24小时</option>
              <option value="7d">近7天</option>
            </select>
            <select
              value={llmFilters.stage}
              onChange={(e) => setLLMStage(e.target.value)}
              className="h-7 rounded border border-[var(--border-primary)] bg-[var(--bg-card)] px-2 text-xs text-[var(--text-primary)]"
            >
              {llmStageOptions.map((stage) => (
                <option key={stage} value={stage}>
                  {stage === 'all' ? '全部阶段' : stage}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              size="sm"
              icon={<ArrowPathIcon className="h-3 w-3" />}
              onClick={() => { void refreshLLMMetrics(); }}
              className="text-[10px]"
            >
              刷新
            </Button>
          </div>
        </div>

        {llmError ? (
          <div className="rounded border border-[var(--error)]/20 bg-[var(--error)]/5 px-3 py-2 text-xs text-[var(--error)]">
            {llmError}
          </div>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-4 gap-2">
              <MetricCard
                icon={<ChartBarIcon className="h-4 w-4" style={{ color: '#8b5cf6' }} />}
                label="LLM调用"
                value={llmSummary ? String(llmSummary.overview.totalCalls) : '-'}
                subValues={llmSummary ? [`成功: ${llmSummary.overview.successCalls}`, `失败: ${llmSummary.overview.failedCalls}`] : undefined}
                color="#8b5cf6"
              />
              <MetricCard
                icon={<CpuChipIcon className="h-4 w-4" style={{ color: '#06b6d4' }} />}
                label="平均耗时"
                value={llmSummary ? formatMs(llmSummary.overview.avgDurationMs) : '-'}
                subValues={llmSummary ? [`P95: ${formatMs(llmSummary.overview.p95DurationMs)}`] : undefined}
                color="#06b6d4"
              />
              <MetricCard
                icon={<CircleStackIcon className="h-4 w-4" style={{ color: '#22c55e' }} />}
                label="缓存命中率"
                value={llmSummary ? formatPercent(llmSummary.overview.cacheHitRatio) : '-'}
                subValues={llmSummary ? [`Hit: ${llmSummary.overview.promptCacheHitTokens}`, `Miss: ${llmSummary.overview.promptCacheMissTokens}`] : undefined}
                color="#22c55e"
              />
              <MetricCard
                icon={<ExclamationTriangleIcon className="h-4 w-4" style={{ color: '#f59e0b' }} />}
                label="P95耗时"
                value={llmSummary ? formatMs(llmSummary.overview.p95DurationMs) : '-'}
                subValues={llmSummary ? [`时间窗: ${llmFilters.timeRange}`] : undefined}
                color="#f59e0b"
              />
            </div>

            <div className="mb-3">
              <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Stage 聚合</div>
              {llmSummary?.stageBreakdown.length ? (
                <div className="overflow-x-auto rounded border border-[var(--border-primary)]">
                  <table className="min-w-full text-xs">
                    <thead className="bg-[var(--bg-secondary)] text-[var(--text-muted)]">
                      <tr>
                        <th className="px-2 py-1.5 text-left">Stage</th>
                        <th className="px-2 py-1.5 text-right">Calls</th>
                        <th className="px-2 py-1.5 text-right">AVG</th>
                        <th className="px-2 py-1.5 text-right">P95</th>
                        <th className="px-2 py-1.5 text-right">Hit</th>
                        <th className="px-2 py-1.5 text-right">Miss</th>
                        <th className="px-2 py-1.5 text-right">Ratio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {llmSummary.stageBreakdown.map((item) => (
                        <tr key={item.stage} className="border-t border-[var(--border-primary)] text-[var(--text-primary)]">
                          <td className="px-2 py-1.5">{item.stage}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{item.calls}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{formatMs(item.avgDurationMs)}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{formatMs(item.p95DurationMs)}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{item.promptCacheHitTokens}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{item.promptCacheMissTokens}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{formatPercent(item.cacheHitRatio)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded border border-[var(--border-primary)] px-3 py-2 text-xs text-[var(--text-muted)]">当前筛选下暂无 LLM 聚合数据</p>
              )}
            </div>

            <div>
              <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">最近调用</div>
              {llmRecentItems.length ? (
                <div className="overflow-x-auto rounded border border-[var(--border-primary)]">
                  <table className="min-w-full text-xs">
                    <thead className="bg-[var(--bg-secondary)] text-[var(--text-muted)]">
                      <tr>
                        <th className="px-2 py-1.5 text-left">时间</th>
                        <th className="px-2 py-1.5 text-left">Stage</th>
                        <th className="px-2 py-1.5 text-left">状态</th>
                        <th className="px-2 py-1.5 text-right">耗时</th>
                        <th className="px-2 py-1.5 text-right">总Tokens</th>
                        <th className="px-2 py-1.5 text-right">Hit</th>
                        <th className="px-2 py-1.5 text-right">Miss</th>
                        <th className="px-2 py-1.5 text-left">策略</th>
                        <th className="px-2 py-1.5 text-left">前缀</th>
                      </tr>
                    </thead>
                    <tbody>
                      {llmRecentItems.map((item) => (
                        <tr key={item.id} className="border-t border-[var(--border-primary)] text-[var(--text-primary)]">
                          <td className="px-2 py-1.5 font-mono">{formatTime(item.timestamp)}</td>
                          <td className="px-2 py-1.5">{item.stage}</td>
                          <td className="px-2 py-1.5">
                            <Badge variant={item.success ? 'success' : 'error'} size="sm">
                              {item.success ? '成功' : '失败'}
                            </Badge>
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono">{formatMs(item.durationMs)}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{item.totalTokens}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{item.promptCacheHitTokens}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{item.promptCacheMissTokens}</td>
                          <td className="px-2 py-1.5">{item.cacheStrategy ?? '-'}</td>
                          <td className="px-2 py-1.5 font-mono">{formatShortHash(item.prefixHash)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded border border-[var(--border-primary)] px-3 py-2 text-xs text-[var(--text-muted)]">当前筛选下暂无最近调用明细</p>
              )}
            </div>
          </>
        )}
      </div>

      {alerts.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <ExclamationTriangleIcon className="h-3.5 w-3.5 text-[var(--warning)]" />
              <span className="text-xs font-medium text-[var(--text-secondary)]">告警</span>
              <Badge variant="warning" size="sm">{alerts.length}</Badge>
            </div>
            <Button variant="ghost" size="sm" icon={<TrashIcon className="h-3 w-3" />} onClick={clearAlerts} className="text-[10px]">
              清空
            </Button>
          </div>
          <div className="max-h-32 overflow-y-auto scrollbar-thin rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)]">
            {[...alerts].reverse().map((alert) => (
              <AlertRow key={alert.id} alert={alert} />
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col mb-3">
        <Tabs
          tabs={DETAIL_TABS}
          activeTab={detailTab}
          onTabChange={(id) => setDetailTab(id as DetailTabId)}
          variant="pill"
          size="sm"
          className="mb-2"
        />
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
          {renderDetailContent()}
        </div>
      </div>

      <div className="border-t border-[var(--border-primary)] pt-2 mb-2">
        <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">告警阈值</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="flex items-center gap-1.5">
            <GlobeAltIcon className="h-3 w-3 text-[#3b82f6] shrink-0" />
            <input
              type="number"
              value={thresholdInputs.apiMaxMs}
              onChange={(e) => handleThresholdChange('apiMaxMs', e.target.value)}
              onBlur={(e) => handleThresholdBlur('apiMaxMs', e.target.value)}
              className={cn(
                'h-6 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-card)] px-2',
                'text-xs text-[var(--text-primary)] font-mono',
                'focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/20',
                '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
              )}
            />
            <span className="text-[10px] text-[var(--text-muted)] shrink-0">ms</span>
          </div>
          <div className="flex items-center gap-1.5">
            <SignalIcon className="h-3 w-3 text-[#22c55e] shrink-0" />
            <input
              type="number"
              value={thresholdInputs.wsMaxMs}
              onChange={(e) => handleThresholdChange('wsMaxMs', e.target.value)}
              onBlur={(e) => handleThresholdBlur('wsMaxMs', e.target.value)}
              className={cn(
                'h-6 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-card)] px-2',
                'text-xs text-[var(--text-primary)] font-mono',
                'focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/20',
                '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
              )}
            />
            <span className="text-[10px] text-[var(--text-muted)] shrink-0">ms</span>
          </div>
          <div className="flex items-center gap-1.5">
            <PaintBrushIcon className="h-3 w-3 text-[#f97316] shrink-0" />
            <input
              type="number"
              value={thresholdInputs.renderMaxMs}
              onChange={(e) => handleThresholdChange('renderMaxMs', e.target.value)}
              onBlur={(e) => handleThresholdBlur('renderMaxMs', e.target.value)}
              className={cn(
                'h-6 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-card)] px-2',
                'text-xs text-[var(--text-primary)] font-mono',
                'focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/20',
                '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
              )}
            />
            <span className="text-[10px] text-[var(--text-muted)] shrink-0">ms</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-1 border-t border-[var(--border-primary)] pt-2">
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowDownTrayIcon className="h-3 w-3" />}
          onClick={handleExport}
          className="text-[10px]"
        >
          导出指标
        </Button>
      </div>
    </Card>
  );
}
