import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { modelConfigApi } from '@/api/modelConfigApi';
import type { ModelProvider, ModelConfigDefaults, ProviderPreset } from '@ai-rpg/shared';
import type { CreateProviderRequest, UpdateProviderRequest, TestConnectionConfig, TestConnectionResult, SetDefaultsRequest } from '@/api/modelConfigApi';
import { getUserMessage } from '@/api/errorHandler';

interface ModelConfigState {
  providers: ModelProvider[];
  presets: Record<string, ProviderPreset>;
  defaults: ModelConfigDefaults | null;
  loading: boolean;
  error: string | null;
}

interface ModelConfigActions {
  fetchProviders: () => Promise<void>;
  fetchPresets: () => Promise<void>;
  fetchDefaults: () => Promise<void>;
  createProvider: (data: CreateProviderRequest) => Promise<ModelProvider>;
  updateProvider: (id: string, data: UpdateProviderRequest) => Promise<ModelProvider>;
  deleteProvider: (id: string) => Promise<void>;
  testConnection: (config: TestConnectionConfig) => Promise<TestConnectionResult>;
  testSavedProvider: (id: string, overrides?: { model?: string }) => Promise<TestConnectionResult>;
  setDefaults: (data: SetDefaultsRequest) => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

const initialState: ModelConfigState = {
  providers: [],
  presets: {},
  defaults: null,
  loading: false,
  error: null,
};

export const useModelConfigStore = create<ModelConfigState & ModelConfigActions>()(
  devtools(
    immer((set) => ({
      ...initialState,

      fetchProviders: async () => {
        set((state) => { state.loading = true; state.error = null; });
        try {
          const providers = await modelConfigApi.listProviders();
          set((state) => {
            state.providers = providers;
            state.loading = false;
          });
        } catch (error) {
          set((state) => {
            state.loading = false;
            state.error = getUserMessage(error);
          });
        }
      },

      fetchPresets: async () => {
        try {
          const presets = await modelConfigApi.getPresets();
          set((state) => { state.presets = presets; });
        } catch (error) {
          set((state) => { state.error = getUserMessage(error); });
        }
      },

      fetchDefaults: async () => {
        try {
          const defaults = await modelConfigApi.getDefaults();
          set((state) => { state.defaults = defaults; });
        } catch (error) {
          set((state) => { state.error = getUserMessage(error); });
        }
      },

      createProvider: async (data: CreateProviderRequest) => {
        set((state) => { state.loading = true; state.error = null; });
        try {
          const newProvider = await modelConfigApi.createProvider(data);
          set((state) => {
            state.providers.push(newProvider);
            state.loading = false;
          });
          return newProvider;
        } catch (error) {
          set((state) => {
            state.loading = false;
            state.error = getUserMessage(error);
          });
          throw error;
        }
      },

      updateProvider: async (id: string, data: UpdateProviderRequest) => {
        set((state) => { state.loading = true; state.error = null; });
        try {
          const updated = await modelConfigApi.updateProvider(id, data);
          set((state) => {
            const index = state.providers.findIndex((p) => p.id === id);
            if (index !== -1) {
              state.providers[index] = updated;
            }
            state.loading = false;
          });
          return updated;
        } catch (error) {
          set((state) => {
            state.loading = false;
            state.error = getUserMessage(error);
          });
          throw error;
        }
      },

      deleteProvider: async (id: string) => {
        set((state) => { state.loading = true; state.error = null; });
        try {
          await modelConfigApi.deleteProvider(id);
          set((state) => {
            state.providers = state.providers.filter((p) => p.id !== id);
            if (state.defaults?.defaultProviderId === id) {
              state.defaults.defaultProviderId = null;
            }
            if (state.defaults?.fastProviderId === id) {
              state.defaults.fastProviderId = null;
              state.defaults.fastModel = null;
            }
            state.loading = false;
          });
        } catch (error) {
          set((state) => {
            state.loading = false;
            state.error = getUserMessage(error);
          });
          throw error;
        }
      },

      testConnection: async (config: TestConnectionConfig) => {
        try {
          return await modelConfigApi.testConnectionWithConfig(config);
        } catch (error) {
          set((state) => { state.error = getUserMessage(error); });
          throw error;
        }
      },

      testSavedProvider: async (id: string, overrides?: { model?: string }) => {
        try {
          return await modelConfigApi.testConnection(id, overrides);
        } catch (error) {
          set((state) => { state.error = getUserMessage(error); });
          throw error;
        }
      },

      setDefaults: async (data: SetDefaultsRequest) => {
        set((state) => { state.loading = true; state.error = null; });
        try {
          const defaults = await modelConfigApi.setDefaults(data);
          set((state) => {
            state.defaults = defaults;
            state.loading = false;
          });
        } catch (error) {
          set((state) => {
            state.loading = false;
            state.error = getUserMessage(error);
          });
          throw error;
        }
      },

      clearError: () =>
        set((state) => { state.error = null; }),

      reset: () => set(initialState),
    })),
    { name: 'ModelConfigStore' }
  )
);
