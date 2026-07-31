import type { ProfilerOnRenderCallback } from 'react';
import { usePerformanceStore } from '@/stores/performanceStore';
import { logger } from '@/utils/logger';

let memoryIntervalId: ReturnType<typeof setInterval> | null = null;
let storeUpdateIntervalId: ReturnType<typeof setInterval> | null = null;
let isMonitoring = false;

const STORE_UPDATE_TRACKING_WINDOW = 5000;
const storeUpdateBuffer: Map<string, number[]> = new Map();

function trackStoreUpdates(): void {
  const now = Date.now();
  const store = usePerformanceStore.getState();

  for (const [storeName, timestamps] of storeUpdateBuffer) {
    const recentTimestamps = timestamps.filter((t) => now - t < STORE_UPDATE_TRACKING_WINDOW);
    storeUpdateBuffer.set(storeName, recentTimestamps);

    if (recentTimestamps.length > 0) {
      store.recordStoreUpdate(storeName);
    }
  }
}

export function startPerformanceMonitoring(): void {
  if (isMonitoring) return;
  isMonitoring = true;

  const perf = performance as unknown as {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  };

  if (perf.memory) {
    memoryIntervalId = setInterval(() => {
      usePerformanceStore.getState().recordMemory();
    }, 5000);
    usePerformanceStore.getState().recordMemory();
  }

  storeUpdateIntervalId = setInterval(() => {
    trackStoreUpdates();
  }, 5000);

  logger.perf('performanceMonitor', '性能监控已启动');
}

export function stopPerformanceMonitoring(): void {
  if (!isMonitoring) return;
  isMonitoring = false;

  if (memoryIntervalId !== null) {
    clearInterval(memoryIntervalId);
    memoryIntervalId = null;
  }

  if (storeUpdateIntervalId !== null) {
    clearInterval(storeUpdateIntervalId);
    storeUpdateIntervalId = null;
  }

  storeUpdateBuffer.clear();
  logger.perf('performanceMonitor', '性能监控已停止');
}

export function measureRender(componentName: string, renderFn: () => void): void {
  const start = performance.now();
  renderFn();
  const duration = performance.now() - start;
  usePerformanceStore.getState().recordRender(componentName, duration);
}

export function createProfilerCallback(): ProfilerOnRenderCallback {
  return (_id, phase, actualDuration) => {
    const componentName = typeof _id === 'string' ? _id : String(_id);
    usePerformanceStore.getState().recordRender(`${componentName}:${phase}`, actualDuration);
  };
}

export function notifyStoreUpdate(storeName: string): void {
  if (!isMonitoring) return;
  const timestamps = storeUpdateBuffer.get(storeName) || [];
  timestamps.push(Date.now());
  storeUpdateBuffer.set(storeName, timestamps);
}

export function isPerformanceMonitoringActive(): boolean {
  return isMonitoring;
}
