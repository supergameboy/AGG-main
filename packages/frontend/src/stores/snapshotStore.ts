import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { apiClient } from '@/api/client';
import { logger } from '@/utils/logger';
import { captureAllStores, type SnapshotData } from '@/utils/snapshotCapture';
import { computeDiff, type FieldDiff, type SnapshotDiffResult } from '@/utils/snapshotDiff';

export interface SnapshotItem {
  id: string;
  timestamp: number;
  type: 'auto' | 'manual';
  storeNames: string[];
  storeCount: number;
  summary: string;
}

export type { FieldDiff, SnapshotDiffResult };

interface SnapshotStoreState {
  snapshots: SnapshotItem[];
  selectedSnapshotId: string | null;
  compareSnapshotIds: [string, string] | null;
  diffResult: SnapshotDiffResult | null;
  autoSnapshotEnabled: boolean;
  autoSnapshotInterval: number;
  autoSnapshotTimerId: ReturnType<typeof setInterval> | null;
  snapshotDataCache: Record<string, SnapshotData>;

  captureSnapshot: (type: 'auto' | 'manual') => Promise<void>;
  deleteSnapshot: (id: string) => Promise<void>;
  selectSnapshot: (id: string | null) => void;
  setCompareIds: (ids: [string, string] | null) => void;
  compareSnapshots: () => Promise<void>;
  setAutoSnapshot: (enabled: boolean, interval?: number) => void;
  exportSnapshot: (id: string) => string | null;
  exportDiffResult: () => string | null;
  fetchSnapshots: () => Promise<void>;
}

const MAX_SNAPSHOTS = 100;
const MAX_AUTO_SNAPSHOTS = 50;

function generateSummary(stores: Record<string, unknown>): string {
  let fieldCount = 0;
  for (const storeData of Object.values(stores)) {
    if (storeData && typeof storeData === 'object') {
      fieldCount += Object.keys(storeData as Record<string, unknown>).length;
    }
  }
  const storeCount = Object.keys(stores).length;
  return `${storeCount} stores, ${fieldCount} fields`;
}

export const useSnapshotStore = create<SnapshotStoreState>()(
  devtools(
    immer((set, get) => ({
      snapshots: [],
      selectedSnapshotId: null,
      compareSnapshotIds: null,
      diffResult: null,
      autoSnapshotEnabled: false,
      autoSnapshotInterval: 30000,
      autoSnapshotTimerId: null,
      snapshotDataCache: {},

      captureSnapshot: async (type: 'auto' | 'manual') => {
        try {
          const snapshotData = captureAllStores();
          snapshotData.type = type;

          const storeNames = Object.keys(snapshotData.stores);
          const summary = generateSummary(snapshotData.stores);

          const item: SnapshotItem = {
            id: snapshotData.snapshotId,
            timestamp: snapshotData.timestamp,
            type,
            storeNames,
            storeCount: storeNames.length,
            summary,
          };

          set((state) => {
            state.snapshots.unshift(item);
            state.snapshotDataCache[snapshotData.snapshotId] = snapshotData;

            if (state.snapshots.length > MAX_SNAPSHOTS) {
              state.snapshots = state.snapshots.slice(0, MAX_SNAPSHOTS);
            }

            const autoSnapshots = state.snapshots.filter((s) => s.type === 'auto');
            if (autoSnapshots.length > MAX_AUTO_SNAPSHOTS) {
              const toRemove = autoSnapshots.slice(MAX_AUTO_SNAPSHOTS);
              for (const snap of toRemove) {
                delete state.snapshotDataCache[snap.id];
              }
              const removeIds = new Set(toRemove.map((s) => s.id));
              state.snapshots = state.snapshots.filter((s) => !removeIds.has(s.id));
            }
          });

          try {
            await apiClient.post('/dev/snapshots', {
              type,
              data: JSON.stringify(snapshotData.stores),
              storeNames: storeNames.join(','),
              timestamp: snapshotData.timestamp,
            });
            logger.snapshot('captureSnapshot', `Snapshot saved to backend`, { id: item.id, type });
          } catch (apiError) {
            logger.snapshot('captureSnapshot', `Failed to save snapshot to backend`, {
              error: String(apiError),
            });
          }

          logger.snapshot('captureSnapshot', `Captured ${type} snapshot`, {
            id: item.id,
            storeCount: item.storeCount,
          });
        } catch (error) {
          logger.snapshot('captureSnapshot', `Failed to capture snapshot`, {
            error: String(error),
          });
        }
      },

      deleteSnapshot: async (id: string) => {
        set((state) => {
          state.snapshots = state.snapshots.filter((s) => s.id !== id);
          delete state.snapshotDataCache[id];
          if (state.selectedSnapshotId === id) {
            state.selectedSnapshotId = null;
          }
          if (state.compareSnapshotIds) {
            const [id1, id2] = state.compareSnapshotIds;
            if (id1 === id || id2 === id) {
              state.compareSnapshotIds = null;
              state.diffResult = null;
            }
          }
        });

        try {
          await apiClient.delete(`/dev/snapshots/${id}`);
          logger.snapshot('deleteSnapshot', `Snapshot deleted`, { id });
        } catch (apiError) {
          logger.snapshot('deleteSnapshot', `Failed to delete snapshot from backend`, {
            error: String(apiError),
          });
        }
      },

      selectSnapshot: (id: string | null) => {
        set((state) => {
          state.selectedSnapshotId = id;
        });
      },

      setCompareIds: (ids: [string, string] | null) => {
        set((state) => {
          state.compareSnapshotIds = ids;
          if (!ids) {
            state.diffResult = null;
          }
        });
      },

      compareSnapshots: async () => {
        const { compareSnapshotIds, snapshotDataCache } = get();
        if (!compareSnapshotIds) return;

        const [id1, id2] = compareSnapshotIds;
        let data1 = snapshotDataCache[id1]?.stores;
        let data2 = snapshotDataCache[id2]?.stores;

        if (!data1 || !data2) {
          try {
            if (!data1) {
              const resp = await apiClient.get(`/dev/snapshots/${id1}`) as Record<string, unknown>;
              const respData = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
              data1 = (respData as Record<string, unknown>).stores || respData;
              set((state) => {
                state.snapshotDataCache[id1] = {
                  snapshotId: id1,
                  timestamp: (resp.timestamp as number) ?? 0,
                  type: (resp.type as 'auto' | 'manual') ?? 'manual',
                  stores: data1 as Record<string, unknown>,
                  metadata: { url: '', userAgent: '' },
                };
              });
            }
            if (!data2) {
              const resp = await apiClient.get(`/dev/snapshots/${id2}`) as Record<string, unknown>;
              const respData = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
              data2 = (respData as Record<string, unknown>).stores || respData;
              set((state) => {
                state.snapshotDataCache[id2] = {
                  snapshotId: id2,
                  timestamp: (resp.timestamp as number) ?? 0,
                  type: (resp.type as 'auto' | 'manual') ?? 'manual',
                  stores: data2 as Record<string, unknown>,
                  metadata: { url: '', userAgent: '' },
                };
              });
            }
          } catch (error) {
            logger.snapshot('compareSnapshots', `Failed to fetch snapshot data from backend`, {
              error: String(error),
            });
          }
        }

        if (data1 && data2) {
          const result = computeDiff(
            data1 as Record<string, unknown>,
            data2 as Record<string, unknown>,
            id1,
            id2
          );
          set((state) => {
            state.diffResult = result;
          });
          logger.snapshot('compareSnapshots', `Compared snapshots`, {
            id1,
            id2,
            diffStoreCount: Object.keys(result.diffs).length,
          });
        }
      },

      setAutoSnapshot: (enabled: boolean, interval?: number) => {
        const state = get();
        if (state.autoSnapshotTimerId) {
          clearInterval(state.autoSnapshotTimerId);
        }

        const newInterval = interval ?? state.autoSnapshotInterval;

        set((state) => {
          state.autoSnapshotEnabled = enabled;
          state.autoSnapshotInterval = newInterval;
          state.autoSnapshotTimerId = null;
        });

        if (enabled) {
          const timerId = setInterval(() => {
            get().captureSnapshot('auto');
          }, newInterval);

          set((state) => {
            state.autoSnapshotTimerId = timerId;
          });

          logger.snapshot('setAutoSnapshot', `Auto snapshot enabled`, {
            interval: newInterval,
          });
        } else {
          logger.snapshot('setAutoSnapshot', `Auto snapshot disabled`);
        }
      },

      exportSnapshot: (id: string) => {
        const { snapshotDataCache } = get();
        const data = snapshotDataCache[id];
        if (!data) return null;
        return JSON.stringify(data, null, 2);
      },

      exportDiffResult: () => {
        const { diffResult } = get();
        if (!diffResult) return null;
        return JSON.stringify(diffResult, null, 2);
      },

      fetchSnapshots: async () => {
        try {
          const resp = await apiClient.get('/dev/snapshots', { params: { limit: 100 } });
          const items: SnapshotItem[] = (resp.data || []).map(
            (s: Record<string, unknown>) => {
              const storeNames = typeof s.store_names === 'string'
                ? s.store_names.split(',').filter(Boolean)
                : [];
              return {
                id: s.id as string,
                timestamp: (s.timestamp as number) || (s.created_at as number) || 0,
                type: (s.type as 'auto' | 'manual') || 'manual',
                storeNames,
                storeCount: storeNames.length,
                summary: `${storeNames.length} stores`,
              };
            }
          );

          set((state) => {
            state.snapshots = items;
          });

          logger.snapshot('fetchSnapshots', `Fetched ${items.length} snapshots from backend`);
        } catch (error) {
          logger.snapshot('fetchSnapshots', `Failed to fetch snapshots`, {
            error: String(error),
          });
        }
      },
    })),
    { name: 'SnapshotStore' }
  )
);
