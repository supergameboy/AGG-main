import { apiClient } from './client';
import type { ModelProvider, ModelConfigDefaults, ProviderPreset, ProviderType, ApiFormat, ApiKeyEntry } from '@ai-rpg/shared';

export interface CreateProviderRequest {
  providerType: ProviderType;
  name: string;
  baseUrl: string;
  apiFormat: ApiFormat;
  apiKeys: ApiKeyEntry[];
  defaultModel: string;
  maxTokens: number;
  enabled?: boolean;
  extraConfig?: Record<string, unknown>;
}

export interface UpdateProviderRequest {
  providerType?: ProviderType;
  name?: string;
  baseUrl?: string;
  apiFormat?: ApiFormat;
  apiKeys?: ApiKeyEntry[];
  defaultModel?: string;
  maxTokens?: number;
  enabled?: boolean;
  extraConfig?: Record<string, unknown>;
}

export interface TestConnectionConfig {
  providerType: ProviderType;
  baseUrl: string;
  apiFormat: ApiFormat;
  apiKey: string;
  defaultModel: string;
  extraConfig?: Record<string, unknown>;
}

export interface TestConnectionResult {
  success: boolean;
  latency: number;
  error?: string;
  model?: string;
}

export interface SetDefaultsRequest {
  defaultProviderId?: string;
  fastProviderId?: string;
  fastModel?: string;
}

export const modelConfigApi = {
  listProviders: async (): Promise<ModelProvider[]> => {
    const data = await apiClient.get('/model-config/providers');
    const providers = data as unknown as ModelProvider[];
    if (!Array.isArray(providers)) return [];
    return providers;
  },

  getProvider: async (id: string): Promise<ModelProvider> => {
    const data = await apiClient.get(`/model-config/providers/${id}`);
    return data as unknown as ModelProvider;
  },

  createProvider: async (params: CreateProviderRequest): Promise<ModelProvider> => {
    const data = await apiClient.post('/model-config/providers', params);
    return data as unknown as ModelProvider;
  },

  updateProvider: async (id: string, params: UpdateProviderRequest): Promise<ModelProvider> => {
    const data = await apiClient.put(`/model-config/providers/${id}`, params);
    return data as unknown as ModelProvider;
  },

  deleteProvider: async (id: string): Promise<{ deleted: string }> => {
    return apiClient.delete(`/model-config/providers/${id}`);
  },

  testConnection: async (id: string, overrides?: { model?: string }): Promise<TestConnectionResult> => {
    const data = await apiClient.post(`/model-config/providers/${id}/test`, overrides || {});
    return data as unknown as TestConnectionResult;
  },

  testConnectionWithConfig: async (config: TestConnectionConfig): Promise<TestConnectionResult> => {
    const data = await apiClient.post('/model-config/test-connection', config);
    return data as unknown as TestConnectionResult;
  },

  getPresets: async (): Promise<Record<string, ProviderPreset>> => {
    const data = await apiClient.get('/model-config/presets');
    return data as unknown as Record<string, ProviderPreset>;
  },

  getDefaults: async (): Promise<ModelConfigDefaults> => {
    const data = await apiClient.get('/model-config/defaults');
    return data as unknown as ModelConfigDefaults;
  },

  setDefaults: async (params: SetDefaultsRequest): Promise<ModelConfigDefaults> => {
    const data = await apiClient.put('/model-config/defaults', params);
    return data as unknown as ModelConfigDefaults;
  },
};
