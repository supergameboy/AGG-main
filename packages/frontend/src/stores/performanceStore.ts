import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { logger } from '@/utils/logger';

const MAX_RECORDS = 50;

export interface ResponseTimeRecord {
  url: string;
  method: string;
  duration: number;
  timestamp: number;
}

export interface WSLatencyRecord {
  eventType: string;
  latency: number;
  timestamp: number;
}

export interface RenderMetric {
  componentName: string;
  duration: number;
  timestamp: number;
}

export interface MemoryRecord {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
  timestamp: number;
}

export interface StoreUpdateRecord {
  storeName: string;
  updateCount: number;
  timestamp: number;
}

export interface ChatMetricRecord {
  processingTime: number;
  gmDuration?: number;
  reactIterations?: number;
  agentsInvolved: string[];
  timestamp: number;
}

export interface PerformanceAlert {
  id: string;
  type: 'api' | 'ws' | 'render' | 'memory';
  message: string;
  value: number;
  threshold: number;
  timestamp: number;
}

export interface PerformanceThresholds {
  apiMaxMs: number;
  wsMaxMs: number;
  renderMaxMs: number;
}

export interface PercentileStats {
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  min: number;
  max: number;
  count: number;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

function calculatePercentile(sorted: number[], percentile: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function computeStats(values: number[]): PercentileStats {
  if (values.length === 0) {
    return { p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0, count: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: calculatePercentile(sorted, 50),
    p95: calculatePercentile(sorted, 95),
    p99: calculatePercentile(sorted, 99),
    avg: values.reduce((sum, v) => sum + v, 0) / values.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    count: values.length,
  };
}

interface PerformanceStoreState {
  apiResponseTimes: ResponseTimeRecord[];
  wsLatencies: WSLatencyRecord[];
  renderMetrics: RenderMetric[];
  memoryUsage: MemoryRecord[];
  storeUpdateCounts: StoreUpdateRecord[];
  chatMetrics: ChatMetricRecord[];
  alerts: PerformanceAlert[];
  thresholds: PerformanceThresholds;

  recordApiResponse: (url: string, method: string, duration: number) => void;
  recordWsLatency: (eventType: string, latency: number) => void;
  recordRender: (componentName: string, duration: number) => void;
  recordMemory: () => void;
  recordStoreUpdate: (storeName: string) => void;
  recordChatMetric: (metric: Omit<ChatMetricRecord, 'timestamp'>) => void;
  setThresholds: (thresholds: Partial<PerformanceThresholds>) => void;
  clearAlerts: () => void;
  getApiStats: () => PercentileStats;
  getWsStats: () => PercentileStats;
  getRenderStats: () => PercentileStats;
  getChatStats: () => PercentileStats;
  exportMetrics: () => string;
}

export const usePerformanceStore = create<PerformanceStoreState>()(
  devtools(
    immer((set, get) => ({
      apiResponseTimes: [],
      wsLatencies: [],
      renderMetrics: [],
      memoryUsage: [],
      storeUpdateCounts: [],
      chatMetrics: [],
      alerts: [],
      thresholds: {
        apiMaxMs: 3000,
        wsMaxMs: 1000,
        renderMaxMs: 100,
      },

      recordApiResponse: (url: string, method: string, duration: number) => {
        const record: ResponseTimeRecord = { url, method, duration, timestamp: Date.now() };
        set((state) => {
          state.apiResponseTimes.push(record);
          if (state.apiResponseTimes.length > MAX_RECORDS) {
            state.apiResponseTimes = state.apiResponseTimes.slice(-MAX_RECORDS);
          }
        });
        const { thresholds } = get();
        if (duration > thresholds.apiMaxMs) {
          const alert: PerformanceAlert = {
            id: generateId(),
            type: 'api',
            message: `API ${method} ${url} 响应超时`,
            value: duration,
            threshold: thresholds.apiMaxMs,
            timestamp: Date.now(),
          };
          set((state) => {
            state.alerts.push(alert);
          });
          logger.perf('performanceStore', `API响应超时: ${method} ${url} ${duration}ms > ${thresholds.apiMaxMs}ms`, {
            url,
            method,
            duration,
            threshold: thresholds.apiMaxMs,
          });
        }
      },

      recordWsLatency: (eventType: string, latency: number) => {
        const record: WSLatencyRecord = { eventType, latency, timestamp: Date.now() };
        set((state) => {
          state.wsLatencies.push(record);
          if (state.wsLatencies.length > MAX_RECORDS) {
            state.wsLatencies = state.wsLatencies.slice(-MAX_RECORDS);
          }
        });
        const { thresholds } = get();
        if (latency > thresholds.wsMaxMs) {
          const alert: PerformanceAlert = {
            id: generateId(),
            type: 'ws',
            message: `WS ${eventType} 延迟过高`,
            value: latency,
            threshold: thresholds.wsMaxMs,
            timestamp: Date.now(),
          };
          set((state) => {
            state.alerts.push(alert);
          });
          logger.perf('performanceStore', `WS延迟过高: ${eventType} ${latency}ms > ${thresholds.wsMaxMs}ms`, {
            eventType,
            latency,
            threshold: thresholds.wsMaxMs,
          });
        }
      },

      recordRender: (componentName: string, duration: number) => {
        const record: RenderMetric = { componentName, duration, timestamp: Date.now() };
        set((state) => {
          state.renderMetrics.push(record);
          if (state.renderMetrics.length > MAX_RECORDS) {
            state.renderMetrics = state.renderMetrics.slice(-MAX_RECORDS);
          }
        });
        const { thresholds } = get();
        if (duration > thresholds.renderMaxMs) {
          const alert: PerformanceAlert = {
            id: generateId(),
            type: 'render',
            message: `${componentName} 渲染耗时过长`,
            value: duration,
            threshold: thresholds.renderMaxMs,
            timestamp: Date.now(),
          };
          set((state) => {
            state.alerts.push(alert);
          });
          logger.perf('performanceStore', `渲染耗时过长: ${componentName} ${duration}ms > ${thresholds.renderMaxMs}ms`, {
            componentName,
            duration,
            threshold: thresholds.renderMaxMs,
          });
        }
      },

      recordMemory: () => {
        const perf = performance as unknown as {
          memory?: {
            usedJSHeapSize: number;
            totalJSHeapSize: number;
            jsHeapSizeLimit: number;
          };
        };
        if (!perf.memory) return;
        const record: MemoryRecord = {
          usedJSHeapSize: perf.memory.usedJSHeapSize,
          totalJSHeapSize: perf.memory.totalJSHeapSize,
          jsHeapSizeLimit: perf.memory.jsHeapSizeLimit,
          timestamp: Date.now(),
        };
        set((state) => {
          state.memoryUsage.push(record);
          if (state.memoryUsage.length > MAX_RECORDS) {
            state.memoryUsage = state.memoryUsage.slice(-MAX_RECORDS);
          }
        });
      },

      recordStoreUpdate: (storeName: string) => {
        const now = Date.now();
        set((state) => {
          const existing = state.storeUpdateCounts.find(
            (r) => r.storeName === storeName && now - r.timestamp < 5000
          );
          if (existing) {
            existing.updateCount += 1;
          } else {
            state.storeUpdateCounts.push({ storeName, updateCount: 1, timestamp: now });
            if (state.storeUpdateCounts.length > MAX_RECORDS) {
              state.storeUpdateCounts = state.storeUpdateCounts.slice(-MAX_RECORDS);
            }
          }
        });
      },

      recordChatMetric: (metric) => {
        const record: ChatMetricRecord = { ...metric, timestamp: Date.now() };
        set((state) => {
          state.chatMetrics.push(record);
          if (state.chatMetrics.length > MAX_RECORDS) {
            state.chatMetrics = state.chatMetrics.slice(-MAX_RECORDS);
          }
        });
        const { thresholds } = get();
        if (metric.processingTime > thresholds.apiMaxMs) {
          const alert: PerformanceAlert = {
            id: generateId(),
            type: 'api',
            message: `Chat请求耗时 ${metric.processingTime}ms 超过阈值 ${thresholds.apiMaxMs}ms`,
            value: metric.processingTime,
            threshold: thresholds.apiMaxMs,
            timestamp: Date.now(),
          };
          set((state) => { state.alerts.push(alert); });
        }
      },

      setThresholds: (thresholds: Partial<PerformanceThresholds>) => {
        set((state) => {
          Object.assign(state.thresholds, thresholds);
        });
      },

      clearAlerts: () => {
        set((state) => {
          state.alerts = [];
        });
      },

      getApiStats: () => {
        const { apiResponseTimes } = get();
        return computeStats(apiResponseTimes.map((r) => r.duration));
      },

      getWsStats: () => {
        const { wsLatencies } = get();
        return computeStats(wsLatencies.map((r) => r.latency));
      },

      getRenderStats: () => {
        const { renderMetrics } = get();
        return computeStats(renderMetrics.map((r) => r.duration));
      },

      getChatStats: () => {
        const { chatMetrics } = get();
        return computeStats(chatMetrics.map((r) => r.processingTime));
      },

      exportMetrics: () => {
        const state = get();
        const exportData = {
          exportedAt: new Date().toISOString(),
          apiResponseTimes: state.apiResponseTimes,
          wsLatencies: state.wsLatencies,
          renderMetrics: state.renderMetrics,
          memoryUsage: state.memoryUsage,
          storeUpdateCounts: state.storeUpdateCounts,
          chatMetrics: state.chatMetrics,
          alerts: state.alerts,
          thresholds: state.thresholds,
          apiStats: state.getApiStats(),
          wsStats: state.getWsStats(),
          renderStats: state.getRenderStats(),
          chatStats: state.getChatStats(),
        };
        return JSON.stringify(exportData, null, 2);
      },
    })),
    { name: 'PerformanceStore' }
  )
);
