import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { gameApi } from '@/api/gameApi';
import { parseApiError, type ApiErrorDetail } from '@/api/errorHandler';
import { logger } from '@/utils/logger';
import type {
  StagingPoolResponse,
  ContinuityAuditResponse,
  EventBusResponse,
  EntityGraphChangesResponse,
  RuntimeSnapshotTraceResponse,
  PostReactTraceResponse,
  RuntimeEventsResponse,
} from '@/api/gameApi';

interface LiveEvent {
  type: string;
  data: unknown;
  timestamp: number;
}

export interface WSLogEntry {
  timestamp: number;
  direction: 'send' | 'receive';
  type: string;
  requestId?: string;
  eventType?: string;
  dataSummary: string;
}

export interface WSConnectionStats {
  state: 'connected' | 'disconnected' | 'reconnecting';
  connectedAt?: number;
  totalMessages: number;
  messagesByType: Record<string, number>;
  activeRequestIds: string[];
}

interface RuntimeState {
  stagingPool: StagingPoolResponse | null;
  stagingPoolLoading: boolean;
  eventBus: EventBusResponse | null;
  eventBusLoading: boolean;
  auditLog: ContinuityAuditResponse | null;
  auditLogLoading: boolean;
  graphChanges: EntityGraphChangesResponse | null;
  graphChangesLoading: boolean;
  runtimeSnapshots: RuntimeSnapshotTraceResponse | null;
  runtimeSnapshotsLoading: boolean;
  runtimeSnapshotsError: ApiErrorDetail | null;
  postReact: PostReactTraceResponse | null;
  postReactLoading: boolean;
  postReactError: ApiErrorDetail | null;
  runtimeEvents: RuntimeEventsResponse | null;
  runtimeEventsLoading: boolean;
  runtimeEventsError: ApiErrorDetail | null;
  liveEvents: LiveEvent[];
  wsLogs: WSLogEntry[];
  wsConnectionStats: WSConnectionStats;
  wsTypeFilter: string | null;
  wsAutoScroll: boolean;
  activeSubTab: 'staging' | 'eventbus' | 'audit' | 'graph' | 'snapshot' | 'postreact' | 'pacing' | 'trace' | 'ws';
}

interface RuntimeActions {
  fetchStagingPool: (saveId: string) => Promise<void>;
  fetchEventBus: (saveId: string) => Promise<void>;
  fetchAuditLog: (saveId: string) => Promise<void>;
  fetchGraphChanges: (saveId: string) => Promise<void>;
  fetchRuntimeSnapshots: (saveId: string) => Promise<void>;
  fetchPostReact: (saveId: string) => Promise<void>;
  fetchRuntimeEvents: (saveId: string, params?: { type?: string; requestId?: string; limit?: number }) => Promise<void>;
  addLiveEvent: (event: LiveEvent) => void;
  addWSLog: (entry: WSLogEntry) => void;
  clearWSLogs: () => void;
  updateWSConnectionState: (state: WSConnectionStats['state']) => void;
  addActiveRequestId: (requestId: string) => void;
  removeActiveRequestId: (requestId: string) => void;
  setWSTypeFilter: (filter: string | null) => void;
  setWSAutoScroll: (autoScroll: boolean) => void;
  setActiveSubTab: (tab: RuntimeState['activeSubTab']) => void;
}

const MAX_LIVE_EVENTS = 100;
const MAX_WS_LOGS = 200;

const initialState: RuntimeState = {
  stagingPool: null,
  stagingPoolLoading: false,
  eventBus: null,
  eventBusLoading: false,
  auditLog: null,
  auditLogLoading: false,
  graphChanges: null,
  graphChangesLoading: false,
  runtimeSnapshots: null,
  runtimeSnapshotsLoading: false,
  runtimeSnapshotsError: null,
  postReact: null,
  postReactLoading: false,
  postReactError: null,
  runtimeEvents: null,
  runtimeEventsLoading: false,
  runtimeEventsError: null,
  liveEvents: [],
  wsLogs: [],
  wsConnectionStats: {
    state: 'disconnected',
    totalMessages: 0,
    messagesByType: {},
    activeRequestIds: [],
  },
  wsTypeFilter: null,
  wsAutoScroll: true,
  activeSubTab: 'staging',
};

export const useRuntimeStore = create<RuntimeState & RuntimeActions>()(
  devtools(
    immer((set) => ({
      ...initialState,

      fetchStagingPool: async (saveId) => {
        set((s) => { s.stagingPoolLoading = true; });
        try {
          const data = await gameApi.fetchStagingPool(saveId);
          set((s) => { s.stagingPool = data; s.stagingPoolLoading = false; });
        } catch (error) {
          logger.error('runtimeStore', 'Failed to fetch staging pool', undefined, error instanceof Error ? error.stack : undefined);
          set((s) => { s.stagingPoolLoading = false; });
        }
      },

      fetchEventBus: async (saveId) => {
        set((s) => { s.eventBusLoading = true; });
        try {
          const data = await gameApi.fetchEventBus(saveId, 50);
          set((s) => { s.eventBus = data; s.eventBusLoading = false; });
        } catch (error) {
          logger.error('runtimeStore', 'Failed to fetch event bus', undefined, error instanceof Error ? error.stack : undefined);
          set((s) => { s.eventBusLoading = false; });
        }
      },

      fetchAuditLog: async (saveId) => {
        set((s) => { s.auditLogLoading = true; });
        try {
          const data = await gameApi.fetchContinuityAudit(saveId, 20);
          set((s) => { s.auditLog = data; s.auditLogLoading = false; });
        } catch (error) {
          logger.error('runtimeStore', 'Failed to fetch audit log', undefined, error instanceof Error ? error.stack : undefined);
          set((s) => { s.auditLogLoading = false; });
        }
      },

      fetchGraphChanges: async (saveId) => {
        set((s) => { s.graphChangesLoading = true; });
        try {
          const data = await gameApi.fetchEntityGraphChanges(saveId, 50);
          set((s) => { s.graphChanges = data; s.graphChangesLoading = false; });
        } catch (error) {
          logger.error('runtimeStore', 'Failed to fetch graph changes', undefined, error instanceof Error ? error.stack : undefined);
          set((s) => { s.graphChangesLoading = false; });
        }
      },

      fetchRuntimeSnapshots: async (saveId) => {
        set((s) => {
          s.runtimeSnapshotsLoading = true;
          s.runtimeSnapshotsError = null;
        });
        try {
          const data = await gameApi.fetchRuntimeSnapshots(saveId, 20);
          set((s) => {
            s.runtimeSnapshots = data;
            s.runtimeSnapshotsLoading = false;
            s.runtimeSnapshotsError = null;
          });
        } catch (error) {
          const parsedError = parseApiError(error);
          logger.error('runtimeStore', 'Failed to fetch runtime snapshots', JSON.stringify(parsedError));
          set((s) => {
            s.runtimeSnapshotsLoading = false;
            s.runtimeSnapshotsError = parsedError;
          });
        }
      },

      fetchPostReact: async (saveId) => {
        set((s) => {
          s.postReactLoading = true;
          s.postReactError = null;
        });
        try {
          const data = await gameApi.fetchPostReactTraces(saveId, 20);
          set((s) => {
            s.postReact = data;
            s.postReactLoading = false;
            s.postReactError = null;
          });
        } catch (error) {
          const parsedError = parseApiError(error);
          logger.error('runtimeStore', 'Failed to fetch post-react traces', JSON.stringify(parsedError));
          set((s) => {
            s.postReactLoading = false;
            s.postReactError = parsedError;
          });
        }
      },

      fetchRuntimeEvents: async (saveId, params) => {
        set((s) => {
          s.runtimeEventsLoading = true;
          s.runtimeEventsError = null;
        });
        try {
          const data = await gameApi.fetchRuntimeEvents(saveId, params);
          set((s) => {
            s.runtimeEvents = data;
            s.runtimeEventsLoading = false;
            s.runtimeEventsError = null;
          });
        } catch (error) {
          const parsedError = parseApiError(error);
          logger.error('runtimeStore', 'Failed to fetch runtime events', JSON.stringify(parsedError));
          set((s) => {
            s.runtimeEventsLoading = false;
            s.runtimeEventsError = parsedError;
          });
        }
      },

      addLiveEvent: (event) => {
        set((s) => {
          s.liveEvents.push(event);
          if (s.liveEvents.length > MAX_LIVE_EVENTS) s.liveEvents.shift();
        });
      },

      addWSLog: (entry) => {
        set((s) => {
          s.wsLogs.push(entry);
          if (s.wsLogs.length > MAX_WS_LOGS) s.wsLogs.shift();
          s.wsConnectionStats.totalMessages += 1;
          s.wsConnectionStats.messagesByType[entry.type] = (s.wsConnectionStats.messagesByType[entry.type] ?? 0) + 1;
        });
      },

      clearWSLogs: () => {
        set((s) => {
          s.wsLogs = [];
          s.wsConnectionStats.totalMessages = 0;
          s.wsConnectionStats.messagesByType = {};
          s.wsConnectionStats.activeRequestIds = [];
        });
      },

      updateWSConnectionState: (state) => {
        set((s) => {
          s.wsConnectionStats.state = state;
          if (state === 'connected') {
            s.wsConnectionStats.connectedAt = Date.now();
          }
        });
      },

      addActiveRequestId: (requestId) => {
        set((s) => {
          if (!s.wsConnectionStats.activeRequestIds.includes(requestId)) {
            s.wsConnectionStats.activeRequestIds.push(requestId);
          }
        });
      },

      removeActiveRequestId: (requestId) => {
        set((s) => {
          s.wsConnectionStats.activeRequestIds = s.wsConnectionStats.activeRequestIds.filter(id => id !== requestId);
        });
      },

      setWSTypeFilter: (filter) => {
        set((s) => { s.wsTypeFilter = filter; });
      },

      setWSAutoScroll: (autoScroll) => {
        set((s) => { s.wsAutoScroll = autoScroll; });
      },

      setActiveSubTab: (tab) => {
        set((s) => { s.activeSubTab = tab; });
      },
    })),
    { name: 'RuntimeStore' }
  )
);
