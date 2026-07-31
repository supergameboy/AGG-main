import { apiClient, llmClient } from '@/api/client';
import type { StoryTemplate, RaceDefinition, ClassDefinition, BackgroundDefinition, AttributeDefinition, CustomOption, AgeMode, AgeGroupDefinition, AgeNumberConfig, UITheme, UILayout, GameRules, AIConstraints, WorldSetting, SpecialRules } from '@/types';

export interface TemplateListResponse {
  templates: StoryTemplate[];
}

export interface TemplateValidationResult {
  valid: boolean;
  errors: Array<{ field: string; message: string; severity: string }>;
  warnings: Array<{ field: string; message: string }>;
  score: number;
}

export interface TemplateExportData {
  version: string;
  exportedAt: string;
  template: StoryTemplate;
}

export interface CharacterOptionsResponse {
  races: RaceDefinition[];
  classes: ClassDefinition[];
  backgrounds: BackgroundDefinition[];
  attributes: AttributeDefinition[];
  attribute_points: number;
  custom_options: CustomOption[];
  age_mode: AgeMode;
  age_groups: AgeGroupDefinition[];
  age_number: AgeNumberConfig;
}

export interface GameConfigResponse {
  ui_theme: UITheme;
  ui_layout: UILayout;
  game_rules: GameRules;
  ai_constraints: AIConstraints;
  world_setting: WorldSetting;
  special_rules: SpecialRules;
  numerical_complexity: string;
  skills: Record<string, unknown>[];
  items: Record<string, unknown>[];
  npcs: Record<string, unknown>[];
}

export interface GenerateOptionsResponse {
  session_id: string;
  type: string;
}

export interface GeneratedOptionsStatus {
  status: 'pending' | 'completed' | 'failed' | 'expired';
  type?: string;
  data?: {
    races: RaceDefinition[];
    classes: ClassDefinition[];
    backgrounds: BackgroundDefinition[];
  };
}

export const templateApi = {
  async list(): Promise<StoryTemplate[]> {
    const data = await apiClient.get('/templates');
    return data as unknown as StoryTemplate[];
  },

  async getById(id: string): Promise<StoryTemplate> {
    const data = await apiClient.get(`/templates/${id}`);
    return data as unknown as StoryTemplate;
  },

  async create(templateData: Partial<StoryTemplate>): Promise<StoryTemplate> {
    const data = await apiClient.post('/templates', { data: templateData });
    return data as unknown as StoryTemplate;
  },

  async update(id: string, updates: Partial<StoryTemplate>): Promise<StoryTemplate> {
    const data = await apiClient.put(`/templates/${id}`, updates);
    return data as unknown as StoryTemplate;
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/templates/${id}`);
  },

  async duplicate(id: string): Promise<StoryTemplate> {
    const data = await apiClient.post(`/templates/${id}/duplicate`);
    return data as unknown as StoryTemplate;
  },

  async export(id: string): Promise<TemplateExportData> {
    const data = await apiClient.post(`/templates/${id}/export`);
    return data as unknown as TemplateExportData;
  },

  async validate(id: string): Promise<TemplateValidationResult> {
    const data = await apiClient.post(`/templates/${id}/validate`);
    return data as unknown as TemplateValidationResult;
  },

  async getPrompts(id: string): Promise<Record<string, unknown[]>> {
    const data = await apiClient.get(`/templates/${id}/prompts`);
    return data as unknown as Record<string, unknown[]>;
  },

  async getCharacterOptions(templateId: string): Promise<CharacterOptionsResponse> {
    const data = await apiClient.get(`/templates/${templateId}/character-options`);
    return data as unknown as CharacterOptionsResponse;
  },

  async getGameConfig(templateId: string): Promise<GameConfigResponse> {
    const data = await apiClient.get(`/templates/${templateId}/game-config`);
    return data as unknown as GameConfigResponse;
  },

  async generateOptions(templateId: string): Promise<GenerateOptionsResponse> {
    const data = await apiClient.post(`/templates/${templateId}/generate-options`);
    return data as unknown as GenerateOptionsResponse;
  },

  async getGeneratedOptions(templateId: string, sessionId: string): Promise<GeneratedOptionsStatus> {
    const data = await apiClient.get(`/templates/${templateId}/generated-options/${sessionId}`);
    return data as unknown as GeneratedOptionsStatus;
  },

  // Skill Pool (interceptor already unwraps {success,data} → data)
  getTemplateSkillPool: (templateId: string, params?: { category?: string; recommendedClass?: string }) =>
    apiClient.get(`/templates/${templateId}/pool/skills`, { params }),
  getTemplateSkillPoolEntry: (templateId: string, skillId: string) =>
    apiClient.get(`/templates/${templateId}/pool/skills/${skillId}`),
  addTemplateSkillPoolEntry: (templateId: string, data: any) =>
    apiClient.post(`/templates/${templateId}/pool/skills`, data),
  updateTemplateSkillPoolEntry: (templateId: string, skillId: string, data: any) =>
    apiClient.put(`/templates/${templateId}/pool/skills/${skillId}`, data),
  deleteTemplateSkillPoolEntry: (templateId: string, skillId: string) =>
    apiClient.delete(`/templates/${templateId}/pool/skills/${skillId}`),

  // Item Pool
  getTemplateItemPool: (templateId: string, params?: { category?: string; equippedSlot?: string; recommendedClass?: string; quality?: string }) =>
    apiClient.get(`/templates/${templateId}/pool/items`, { params }),
  getTemplateItemPoolEntry: (templateId: string, itemId: string) =>
    apiClient.get(`/templates/${templateId}/pool/items/${itemId}`),
  addTemplateItemPoolEntry: (templateId: string, data: any) =>
    apiClient.post(`/templates/${templateId}/pool/items`, data),
  updateTemplateItemPoolEntry: (templateId: string, itemId: string, data: any) =>
    apiClient.put(`/templates/${templateId}/pool/items/${itemId}`, data),
  deleteTemplateItemPoolEntry: (templateId: string, itemId: string) =>
    apiClient.delete(`/templates/${templateId}/pool/items/${itemId}`),

  // Generate (async trigger + poll)
  generateTemplateSkillPool: (templateId: string, config?: { categories?: string[]; recommendedClasses?: string[]; batchSize?: number; seed?: string }) =>
    llmClient.post(`/templates/${templateId}/pool/skills/generate`, config || {}),
  generateTemplateItemPool: (templateId: string, config?: { categories?: string[]; recommendedClasses?: string[]; batchSize?: number; seed?: string }) =>
    llmClient.post(`/templates/${templateId}/pool/items/generate`, config || {}),

  // Poll generation status
  getPoolGenerateStatus: (templateId: string, resultId: string) =>
    apiClient.get(`/templates/${templateId}/pool/generate-status/${resultId}`),

  // Commit after review
  commitPoolSkills: (templateId: string, skills: unknown[]) =>
    apiClient.post(`/templates/${templateId}/pool/skills/commit`, { skills }),
  commitPoolItems: (templateId: string, items: unknown[]) =>
    apiClient.post(`/templates/${templateId}/pool/items/commit`, { items }),

  // Clear generated data
  clearGeneratedSkills: (templateId: string) =>
    apiClient.delete(`/templates/${templateId}/pool/skills/generated`),
  clearGeneratedItems: (templateId: string) =>
    apiClient.delete(`/templates/${templateId}/pool/items/generated`),

  // Stats
  getTemplatePoolStats: (templateId: string) =>
    apiClient.get(`/templates/${templateId}/pool/stats`),
};
