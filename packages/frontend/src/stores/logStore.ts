import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { LogLevel, LogCategory, DevLogEntry } from '@/utils/logger';
import { setLogHandler, setMinLevel, captureGlobalErrors } from '@/utils/logger';
import { apiClient } from '@/api/client';

const MAX_LOG_ENTRIES = 2000;
const FLUSH_BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 5000;

interface LogFilter {
  level: LogLevel | 'all';
  category: LogCategory | 'all';
  search: string;
}

interface LogStoreState {
  entries: DevLogEntry[];
  filter: LogFilter;
  isCapturing: boolean;
  autoScroll: boolean;
  persistToBackend: boolean;
  pendingBatch: DevLogEntry[];
  flushTimerId: ReturnType<typeof setInterval> | null;

  addEntry: (entry: DevLogEntry) => void;
  setFilter: (filter: Partial<LogFilter>) => void;
  clearEntries: () => void;
  setAutoScroll: (enabled: boolean) => void;
  setPersistToBackend: (enabled: boolean) => void;
  startCapturing: () => void;
  stopCapturing: () => void;
  flushToBackend: () => Promise<void>;
  exportLogs: () => string;
  getFilteredEntries: () => DevLogEntry[];
}

export const useLogStore = create<LogStoreState>()(
  devtools(
    immer((set, get) => {
      let globalErrorCleanup: (() => void) | null = null;

      return {
        entries: [],
        filter: { level: 'all', category: 'all', search: '' },
        isCapturing: false,
        autoScroll: true,
        persistToBackend: true,
        pendingBatch: [],
        flushTimerId: null,

        addEntry: (entry: DevLogEntry) => {
          set((state) => {
            state.entries.push(entry);
            if (state.entries.length > MAX_LOG_ENTRIES) {
              state.entries = state.entries.slice(-MAX_LOG_ENTRIES);
            }
            if (state.persistToBackend) {
              state.pendingBatch.push(entry);
            }
          });
        },

        setFilter: (filter: Partial<LogFilter>) => {
          set((state) => {
            Object.assign(state.filter, filter);
          });
          const { filter: currentFilter } = get();
          if (currentFilter.level !== 'all') {
            setMinLevel(currentFilter.level);
          } else {
            setMinLevel('debug');
          }
        },

        clearEntries: () => {
          set((state) => {
            state.entries = [];
            state.pendingBatch = [];
          });
        },

        setAutoScroll: (enabled: boolean) => {
          set({ autoScroll: enabled });
        },

        setPersistToBackend: (enabled: boolean) => {
          set({ persistToBackend: enabled });
          if (enabled && !get().flushTimerId) {
            const timerId = setInterval(() => {
              get().flushToBackend();
            }, FLUSH_INTERVAL_MS);
            set({ flushTimerId: timerId });
          } else if (!enabled && get().flushTimerId) {
            clearInterval(get().flushTimerId!);
            set({ flushTimerId: null });
            get().flushToBackend();
          }
        },

        startCapturing: () => {
          if (get().isCapturing) return;

          setLogHandler((entry) => {
            get().addEntry(entry);
          });

          globalErrorCleanup = captureGlobalErrors();

          set({ isCapturing: true });
        },

        stopCapturing: () => {
          if (!get().isCapturing) return;

          setLogHandler(() => {});
          if (globalErrorCleanup) {
            globalErrorCleanup();
            globalErrorCleanup = null;
          }

          set({ isCapturing: false });
        },

        flushToBackend: async () => {
          const { pendingBatch } = get();
          if (pendingBatch.length === 0) return;

          const batch = pendingBatch.slice(0, FLUSH_BATCH_SIZE);
          set((state) => {
            state.pendingBatch = state.pendingBatch.slice(batch.length);
          });

          try {
            await apiClient.post('/logs', { entries: batch });
          } catch {
            // 发送失败时将批次放回队列头部，避免日志丢失
            set((state) => {
              state.pendingBatch = [...batch, ...state.pendingBatch];
            });
          }
        },

        exportLogs: () => {
          const { entries } = get();
          const exportData = {
            exportedAt: new Date().toISOString(),
            version: '1.0.0',
            entryCount: entries.length,
            entries: entries.map((e) => ({
              timestamp: new Date(e.timestamp).toISOString(),
              level: e.level,
              category: e.category,
              source: e.source,
              message: e.message,
              data: e.data,
              stackTrace: e.stackTrace,
            })),
          };
          return JSON.stringify(exportData, null, 2);
        },

        getFilteredEntries: () => {
          const { entries, filter } = get();
          let filtered = entries;

          if (filter.level !== 'all') {
            const levelPriority: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
            const minPriority = levelPriority[filter.level] ?? 0;
            filtered = filtered.filter((e) => (levelPriority[e.level] ?? 0) >= minPriority);
          }

          if (filter.category !== 'all') {
            filtered = filtered.filter((e) => e.category === filter.category);
          }

          if (filter.search) {
            const searchLower = filter.search.toLowerCase();
            filtered = filtered.filter(
              (e) =>
                e.message.toLowerCase().includes(searchLower) ||
                e.source.toLowerCase().includes(searchLower) ||
                (typeof e.data === 'string' && e.data.toLowerCase().includes(searchLower))
            );
          }

          return filtered;
        },
      };
    }),
    { name: 'LogStore' }
  )
);
