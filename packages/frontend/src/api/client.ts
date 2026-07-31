import axios from 'axios';
import type { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import type { APIResponse } from '@/types';
import { parseApiError } from './errorHandler';
import { logger } from '@/utils/logger';
import type { NetworkRequest } from '@/stores/networkStore';
import { FRONTEND_TIMEOUTS } from '../config/constants.js';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';
const DEFAULT_TIMEOUT = 0; // 超时已禁用（commit f61d5f8 决策）
const LLM_TIMEOUT = FRONTEND_TIMEOUTS.LLM_REQUEST;

function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

function recordToNetworkStore(request: NetworkRequest): void {
  import('@/stores/networkStore').then(({ useNetworkStore }) => {
    useNetworkStore.getState().addRequest(request);
  });
}

function extractHeaders(headers: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  if (headers && typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') {
        result[key] = value;
      } else if (value != null) {
        result[key] = String(value);
      }
    }
  }
  return result;
}

const createApiClient = (timeout: number = DEFAULT_TIMEOUT): AxiosInstance => {
  const client = axios.create({
    baseURL: BASE_URL,
    timeout,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  client.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      if (!config.headers['X-Request-ID']) {
        config.headers['X-Request-ID'] = generateRequestId();
      }

      const token = sessionStorage.getItem('auth_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      const method = config.method?.toUpperCase() || 'GET';
      const url = config.url || '';
      logger.api('client', `${method} ${url}`, { requestId: config.headers['X-Request-ID'] });

      config.metadata = { startTime: Date.now() };

      return config;
    },
    (error) => Promise.reject(error)
  );

  client.interceptors.response.use(
    (response) => {
      const method = response.config.method?.toUpperCase() || 'GET';
      const url = response.config.url || '';
      const status = response.status;
      logger.api('client', `${method} ${url} → ${status}`);

      const startTime = (response.config.metadata as { startTime?: number } | undefined)?.startTime ?? Date.now();
      recordToNetworkStore({
        id: (response.config.headers['X-Request-ID'] as string) || generateRequestId(),
        method,
        url,
        requestHeaders: extractHeaders(response.config.headers as unknown as Record<string, unknown>),
        requestBody: response.config.data ? (typeof response.config.data === 'string' ? tryParseJSON(response.config.data) : response.config.data) : undefined,
        responseStatus: status,
        responseHeaders: extractHeaders(response.headers as unknown as Record<string, unknown>),
        responseBody: response.data,
        duration: Date.now() - startTime,
        timestamp: startTime,
      });

      const data = response.data as APIResponse;
      if (data && typeof data === 'object' && 'success' in data) {
        if (data.success) {
          return data.data as unknown as typeof response;
        }
        const error = data.error;
        const apiError = parseApiError(error);
        return Promise.reject(apiError);
      }
      return response.data;
    },
    (error: AxiosError<APIResponse>) => {
      const apiError = parseApiError(error);
      const method = error.config?.method?.toUpperCase() || 'UNKNOWN';
      const url = error.config?.url || '';
      logger.apiError('client', `${method} ${url} failed`, { code: apiError.code, message: apiError.message });

      const startTime = (error.config?.metadata as { startTime?: number } | undefined)?.startTime ?? Date.now();
      recordToNetworkStore({
        id: ((error.config?.headers as Record<string, unknown> | undefined)?.['X-Request-ID'] as string) || generateRequestId(),
        method,
        url,
        requestHeaders: error.config?.headers ? extractHeaders(error.config.headers as unknown as Record<string, unknown>) : {},
        requestBody: error.config?.data ? (typeof error.config.data === 'string' ? tryParseJSON(error.config.data) : error.config.data) : undefined,
        responseStatus: error.response?.status ?? 0,
        responseHeaders: error.response?.headers ? extractHeaders(error.response.headers as unknown as Record<string, unknown>) : {},
        responseBody: error.response?.data,
        duration: Date.now() - startTime,
        timestamp: startTime,
      });

      return Promise.reject(apiError);
    }
  );

  return client;
};

function tryParseJSON(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

declare module 'axios' {
  interface InternalAxiosRequestConfig {
    metadata?: { startTime?: number };
  }
}

export const apiClient = createApiClient();

export const llmClient = createApiClient(LLM_TIMEOUT);
