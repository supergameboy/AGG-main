import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { logger } from '@/utils/logger';
import { apiClient } from '@/api/client';

export interface NetworkRequest {
  id: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  responseStatus: number;
  responseHeaders: Record<string, string>;
  responseBody: unknown;
  duration: number;
  timestamp: number;
}

export interface NetworkFilter {
  method: string | 'all';
  statusCode: string | 'all';
  urlPattern: string;
}

interface ReplayModification {
  url?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

interface NetworkStoreState {
  requests: NetworkRequest[];
  selectedRequestId: string | null;
  filter: NetworkFilter;

  addRequest: (request: NetworkRequest) => void;
  selectRequest: (id: string | null) => void;
  setFilter: (filter: Partial<NetworkFilter>) => void;
  clearRequests: () => void;
  replayRequest: (id: string) => Promise<void>;
  replayWithModification: (id: string, modifications: ReplayModification) => Promise<void>;
  getFilteredRequests: () => NetworkRequest[];
}

const MAX_REQUESTS = 200;

export const useNetworkStore = create<NetworkStoreState>()(
  devtools(
    immer((set, get) => ({
      requests: [],
      selectedRequestId: null,
      filter: { method: 'all', statusCode: 'all', urlPattern: '' },

      addRequest: (request: NetworkRequest) => {
        set((state) => {
          state.requests.push(request);
          if (state.requests.length > MAX_REQUESTS) {
            state.requests = state.requests.slice(-MAX_REQUESTS);
          }
        });
        logger.network('networkStore', `Recorded ${request.method} ${request.url}`, {
          id: request.id,
          status: request.responseStatus,
          duration: request.duration,
        });
      },

      selectRequest: (id: string | null) => {
        set({ selectedRequestId: id });
      },

      setFilter: (filter: Partial<NetworkFilter>) => {
        set((state) => {
          Object.assign(state.filter, filter);
        });
      },

      clearRequests: () => {
        set((state) => {
          state.requests = [];
          state.selectedRequestId = null;
        });
        logger.network('networkStore', 'Cleared all requests');
      },

      replayRequest: async (id: string) => {
        const request = get().requests.find((r) => r.id === id);
        if (!request) {
          logger.network('networkStore', `Replay failed: request ${id} not found`);
          return;
        }

        logger.network('networkStore', `Replaying ${request.method} ${request.url}`);

        try {
          const method = request.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch';
          const config: { headers?: Record<string, string> } = {};
          const filteredHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(request.requestHeaders)) {
            const lower = key.toLowerCase();
            if (lower !== 'content-type' && lower !== 'authorization' && lower !== 'x-request-id') {
              filteredHeaders[key] = value;
            }
          }
          if (Object.keys(filteredHeaders).length > 0) {
            config.headers = filteredHeaders;
          }

          if (method === 'get' || method === 'delete') {
            await apiClient[method](request.url, config);
          } else {
            await apiClient[method](request.url, request.requestBody, config);
          }
        } catch (error) {
          logger.network('networkStore', `Replay error: ${request.method} ${request.url}`, error);
        }
      },

      replayWithModification: async (id: string, modifications: ReplayModification) => {
        const request = get().requests.find((r) => r.id === id);
        if (!request) {
          logger.network('networkStore', `Replay with modification failed: request ${id} not found`);
          return;
        }

        const url = modifications.url ?? request.url;
        const body = modifications.body ?? request.requestBody;
        const headers = modifications.headers ?? request.requestHeaders;

        logger.network('networkStore', `Replaying with modification ${request.method} ${url}`, modifications);

        try {
          const method = request.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch';
          const config: { headers?: Record<string, string> } = {};
          const filteredHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(headers)) {
            const lower = key.toLowerCase();
            if (lower !== 'content-type' && lower !== 'authorization' && lower !== 'x-request-id') {
              filteredHeaders[key] = value;
            }
          }
          if (Object.keys(filteredHeaders).length > 0) {
            config.headers = filteredHeaders;
          }

          if (method === 'get' || method === 'delete') {
            await apiClient[method](url, config);
          } else {
            await apiClient[method](url, body, config);
          }
        } catch (error) {
          logger.network('networkStore', `Replay with modification error: ${request.method} ${url}`, error);
        }
      },

      getFilteredRequests: () => {
        const { requests, filter } = get();
        let filtered = requests;

        if (filter.method !== 'all') {
          filtered = filtered.filter((r) => r.method.toUpperCase() === filter.method.toUpperCase());
        }

        if (filter.statusCode !== 'all') {
          const prefix = filter.statusCode.replace('xx', '');
          filtered = filtered.filter((r) => String(r.responseStatus).startsWith(prefix));
        }

        if (filter.urlPattern) {
          const pattern = filter.urlPattern.toLowerCase();
          filtered = filtered.filter((r) => r.url.toLowerCase().includes(pattern));
        }

        return filtered;
      },
    })),
    { name: 'NetworkStore' }
  )
);
