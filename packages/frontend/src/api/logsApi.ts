import { apiClient } from './client';

export interface LogEntry {
  id?: number;
  level: string;
  category: string;
  source: string;
  message: string;
  data?: string | null;
  stack_trace?: string | null;
  session_id?: string | null;
  timestamp: number;
  created_at?: number;
}

export interface LogQueryParams {
  level?: string;
  category?: string;
  limit?: number;
  offset?: number;
  sessionId?: string;
  search?: string;
}

export interface LogQueryResult {
  data: LogEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface LogStatsResult {
  total: number;
  byLevel: Record<string, number>;
  byCategory: Record<string, number>;
}

export interface LogDeleteParams {
  beforeTimestamp?: number;
  level?: string;
  category?: string;
}

export interface LogDeleteResult {
  deleted: boolean;
  count: number;
}

export const logsApi = {
  query: async (params?: LogQueryParams): Promise<LogQueryResult> => {
    const query: Record<string, string> = {};
    if (params?.level) query.level = params.level;
    if (params?.category) query.category = params.category;
    if (params?.limit !== undefined) query.limit = String(params.limit);
    if (params?.offset !== undefined) query.offset = String(params.offset);
    if (params?.sessionId) query.sessionId = params.sessionId;
    if (params?.search) query.search = params.search;
    const searchParams = new URLSearchParams(query).toString();
    const url = searchParams ? `/logs?${searchParams}` : '/logs';
    return apiClient.get(url) as unknown as Promise<LogQueryResult>;
  },

  getStats: async (): Promise<LogStatsResult> => {
    return apiClient.get('/logs/stats') as unknown as Promise<LogStatsResult>;
  },

  delete: async (params: LogDeleteParams): Promise<LogDeleteResult> => {
    const query: Record<string, string> = {};
    if (params.beforeTimestamp !== undefined) query.beforeTimestamp = String(params.beforeTimestamp);
    if (params.level) query.level = params.level;
    if (params.category) query.category = params.category;
    const searchParams = new URLSearchParams(query).toString();
    const url = searchParams ? `/logs?${searchParams}` : '/logs';
    return apiClient.delete(url) as unknown as Promise<LogDeleteResult>;
  },
};
