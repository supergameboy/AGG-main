import { apiClient } from './client';
import type { AgentProfile } from '@ai-rpg/shared';

export type CreateAgentProfileParams = Omit<AgentProfile, 'id' | 'is_builtin' | 'source' | 'created_at' | 'updated_at'>;

export interface DuplicateProfileResult {
  message: string;
  profile: AgentProfile;
  sourceProfile: string;
}

export interface PermissionEntry {
  agentKey: string;
  writableTools: string[];
  readPolicy: string;
}

export interface PermissionsResult {
  agents: Record<string, { tools: string[] }>;
  permissionList: PermissionEntry[];
  totalAgents: number;
  semantics: {
    toolsField: string;
    readAccess: string;
    source: string;
  };
}

export interface ToolMethod {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  isWrite: boolean;
}

export interface ToolMethodsResult {
  toolType: string;
  toolName: string;
  toolDescription: string;
  toolVersion: string;
  methods: ToolMethod[];
}

export interface ReloadConfigParams {
  profileName: string;
}

export interface ReloadConfigResult {
  profileName: string;
  agentCount: number;
  agents: string[];
}

export interface ReactTestParams {
  agentKey: string;
  saveId: string;
  playerInput: string;
  profileName?: string;
}

export interface SystemAgentInfo {
  key: string;
  name: string;
  description: string;
  tools: string[];
  temperature?: number;
  max_iterations?: number;
  capabilities?: {
    supported_intents: string[];
    required_fields: string[];
    optional_fields: string[];
  };
}

export const configApi = {
  listProfiles: async (): Promise<AgentProfile[]> => {
    const data = await apiClient.get('/config/agent-profiles');
    const profiles = data as unknown as AgentProfile[];
    if (!Array.isArray(profiles)) return [];
    return profiles;
  },

  getProfile: async (name: string): Promise<AgentProfile> => {
    const data = await apiClient.get(`/config/agent-profiles/${name}`);
    return data as unknown as AgentProfile;
  },

  createProfile: async (params: CreateAgentProfileParams): Promise<AgentProfile> => {
    const data = await apiClient.post('/config/agent-profiles', params);
    return data as unknown as AgentProfile;
  },

  updateProfile: async (name: string, updates: Partial<CreateAgentProfileParams>): Promise<AgentProfile> => {
    const data = await apiClient.put(`/config/agent-profiles/${name}`, updates);
    return data as unknown as AgentProfile;
  },

  deleteProfile: async (name: string): Promise<{ deleted: string }> => {
    return apiClient.delete(`/config/agent-profiles/${name}`);
  },

  duplicateProfile: async (name: string, newName?: string): Promise<DuplicateProfileResult> => {
    const data = await apiClient.post(`/config/agent-profiles/${name}/duplicate`, { newName });
    return data as unknown as DuplicateProfileResult;
  },

  // 旧类型: Promise<string[]> — 仅返回key列表
  getProfileAgents: async (name: string): Promise<SystemAgentInfo[]> => {
    const data = await apiClient.get(`/config/agent-profiles/${name}/agents`);
    return data as unknown as SystemAgentInfo[];
  },

  reloadProfile: async (params: ReloadConfigParams): Promise<ReloadConfigResult> => {
    return apiClient.post('/config/reload', params);
  },

  seedFromYaml: async (): Promise<{ seeded: number }> => {
    return apiClient.post('/config/seed');
  },

  reactTest: async (params: ReactTestParams): Promise<unknown> => {
    return apiClient.post('/config/react-test', params);
  },

  getSystemTools: async (): Promise<unknown[]> => {
    const data = await apiClient.get('/config/tools');
    return data as unknown as unknown[];
  },

  getToolMethods: async (toolType: string): Promise<ToolMethodsResult> => {
    const data = await apiClient.get(`/config/tools/${toolType}/methods`);
    return data as unknown as ToolMethodsResult;
  },

  getPermissions: async (): Promise<PermissionsResult> => {
    const data = await apiClient.get('/config/permissions');
    return data as unknown as PermissionsResult;
  },

  getSystemAgents: async (): Promise<SystemAgentInfo[]> => {
    const data = await apiClient.get('/config/system-agents');
    return data as unknown as SystemAgentInfo[];
  },
};
