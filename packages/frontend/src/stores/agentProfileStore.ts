import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { configApi } from '@/api/configApi';
import type { AgentProfile } from '@/types';
import type { CreateAgentProfileParams, ReloadConfigParams, ReloadConfigResult, ReactTestParams, SystemAgentInfo } from '@/api/configApi';
import { getUserMessage } from '@/api/errorHandler';

/** 将 profile.agents 映射为 SystemAgentInfo[] 的辅助函数 */
function profileAgentsToList(agents: Record<string, any> | undefined): SystemAgentInfo[] {
  if (!agents) return [];
  return Object.entries(agents).map(([key, config]) => ({
    key,
    name: config.name,
    description: config.description,
    tools: config.tools,
    temperature: config.temperature,
    max_iterations: config.max_iterations,
    capabilities: config.capabilities,
  }));
}

interface AgentProfileState {
  profiles: AgentProfile[];
  currentProfile: AgentProfile | null;
  currentProfileName: string | null;
  // 旧字段: agentKeys: string[] — 已升级为 agents 对象数组
  agents: SystemAgentInfo[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
}

interface AgentProfileActions {
  fetchProfiles: () => Promise<void>;
  fetchProfile: (name: string) => Promise<void>;
  fetchProfileAgents: (name: string) => Promise<void>;
  createProfile: (params: CreateAgentProfileParams) => Promise<AgentProfile>;
  updateProfile: (name: string, updates: Partial<CreateAgentProfileParams>) => Promise<void>;
  deleteProfile: (name: string) => Promise<void>;
  reloadProfile: (params: ReloadConfigParams) => Promise<ReloadConfigResult>;
  seedFromYaml: () => Promise<number>;
  reactTest: (params: ReactTestParams) => Promise<unknown>;
  setCurrentProfile: (profile: AgentProfile | null) => void;
  clearCurrentProfile: () => void;
  clearError: () => void;
  reset: () => void;
}

const initialState: AgentProfileState = {
  profiles: [],
  currentProfile: null,
  currentProfileName: null,
  agents: [],
  isLoading: false,
  isSaving: false,
  error: null,
};

export const useAgentProfileStore = create<AgentProfileState & AgentProfileActions>()(
  devtools(
    immer((set) => ({
      ...initialState,

      fetchProfiles: async () => {
        set((state) => { state.isLoading = true; state.error = null; });
        try {
          const profiles = await configApi.listProfiles();
          set((state) => {
            state.profiles = profiles;
            state.isLoading = false;
          });
        } catch (error) {
          set((state) => {
            state.isLoading = false;
            state.error = getUserMessage(error);
          });
        }
      },

      fetchProfile: async (name: string) => {
        set((state) => { state.isLoading = true; state.error = null; });
        try {
          const profile = await configApi.getProfile(name);
          set((state) => {
            state.currentProfile = profile;
            state.currentProfileName = name;
            state.agents = profileAgentsToList(profile.agents);
            state.isLoading = false;
          });
        } catch (error) {
          set((state) => {
            state.isLoading = false;
            state.error = getUserMessage(error);
          });
        }
      },

      fetchProfileAgents: async (name: string) => {
        try {
          const agents = await configApi.getProfileAgents(name);
          set((state) => { state.agents = agents; });
        } catch (error) {
          set((state) => { state.error = getUserMessage(error); });
        }
      },

      createProfile: async (params: CreateAgentProfileParams) => {
        set((state) => { state.isSaving = true; state.error = null; });
        try {
          const newProfile = await configApi.createProfile(params);
          set((state) => {
            state.profiles.push(newProfile);
            state.currentProfile = newProfile;
            state.currentProfileName = newProfile.name;
            state.agents = profileAgentsToList(newProfile.agents);
            state.isSaving = false;
          });
          return newProfile;
        } catch (error) {
          set((state) => {
            state.isSaving = false;
            state.error = getUserMessage(error);
          });
          throw error;
        }
      },

      updateProfile: async (name: string, updates: Partial<CreateAgentProfileParams>) => {
        set((state) => { state.isSaving = true; state.error = null; });
        try {
          const updated = await configApi.updateProfile(name, updates);
          set((state) => {
            const index = state.profiles.findIndex((p) => p.name === name);
            if (index !== -1) {
              state.profiles[index] = updated;
            }
            if (state.currentProfileName === name) {
              state.currentProfile = updated;
              state.agents = profileAgentsToList(updated.agents);
            }
            state.isSaving = false;
          });
        } catch (error) {
          set((state) => {
            state.isSaving = false;
            state.error = getUserMessage(error);
          });
          throw error;
        }
      },

      deleteProfile: async (name: string) => {
        set((state) => { state.isLoading = true; state.error = null; });
        try {
          await configApi.deleteProfile(name);
          set((state) => {
            state.profiles = state.profiles.filter((p) => p.name !== name);
            if (state.currentProfileName === name) {
              state.currentProfile = null;
              state.currentProfileName = null;
              state.agents = [];
            }
            state.isLoading = false;
          });
        } catch (error) {
          set((state) => {
            state.isLoading = false;
            state.error = getUserMessage(error);
          });
          throw error;
        }
      },

      reloadProfile: async (params: ReloadConfigParams) => {
        set((state) => { state.isLoading = true; state.error = null; });
        try {
          const result = await configApi.reloadProfile(params);
          const refreshed = await configApi.getProfile(params.profileName);
          set((state) => {
            const index = state.profiles.findIndex((p) => p.name === params.profileName);
            if (index !== -1) {
              state.profiles[index] = refreshed;
            }
            if (state.currentProfileName === params.profileName) {
              state.currentProfile = refreshed;
              state.agents = profileAgentsToList(refreshed.agents);
            }
            state.isLoading = false;
          });
          return result;
        } catch (error) {
          set((state) => {
            state.isLoading = false;
            state.error = getUserMessage(error);
          });
          throw error;
        }
      },

      seedFromYaml: async () => {
        set((state) => { state.isLoading = true; state.error = null; });
        try {
          const result = await configApi.seedFromYaml();
          const profiles = await configApi.listProfiles();
          set((state) => {
            state.profiles = profiles;
            state.isLoading = false;
          });
          return result.seeded;
        } catch (error) {
          set((state) => {
            state.isLoading = false;
            state.error = getUserMessage(error);
          });
          throw error;
        }
      },

      reactTest: async (params: ReactTestParams) => {
        try {
          return await configApi.reactTest(params);
        } catch (error) {
          set((state) => { state.error = getUserMessage(error); });
          throw error;
        }
      },

      setCurrentProfile: (profile: AgentProfile | null) =>
        set((state) => {
          state.currentProfile = profile;
          state.currentProfileName = profile?.name ?? null;
          state.agents = profileAgentsToList(profile?.agents);
        }),

      clearCurrentProfile: () =>
        set((state) => {
          state.currentProfile = null;
          state.currentProfileName = null;
          state.agents = [];
        }),

      clearError: () =>
        set((state) => { state.error = null; }),

      reset: () => set(initialState),
    })),
    { name: 'AgentProfileStore' }
  )
);
