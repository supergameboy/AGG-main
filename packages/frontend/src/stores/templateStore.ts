import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

import type { StoryTemplate, TemplateSkillPoolEntry, TemplateItemPoolEntry } from '@/types';
import { wsManager } from '@/services/WebSocketManager';
import { WSRequestBuilder } from '@/services/WSRequestBuilder';

export type EditorTab =
  | 'basic'
  | 'world'
  | 'race'
  | 'class'
  | 'background'
  | 'attributes'
  | 'customOptions'
  | 'rules'
  | 'ai'
  | 'scene'
  | 'skills'
  | 'items'
  | 'skill_pool'
  | 'item_pool'
  | 'npcs'
  | 'ui_theme'
  | 'ui_layout'
  | 'preview';

interface TemplateState {
  templates: StoryTemplate[];
  currentTemplateId: string | null;
  editingTemplate: StoryTemplate | null;
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  activeTab: EditorTab;
  isReadOnly: boolean;
  hasUnsavedChanges: boolean;
  originalTemplate: StoryTemplate | null;
  skillPool: TemplateSkillPoolEntry[];
  itemPool: TemplateItemPoolEntry[];
  poolStats: { skillCount: number; itemCount: number; skillCategories: Record<string, number>; itemCategories: Record<string, number> } | null;
  poolLoading: boolean;
  poolGenerating: boolean;
  pendingGeneratedSkills: TemplateSkillPoolEntry[] | null;
  pendingGeneratedItems: TemplateItemPoolEntry[] | null;
  isReviewingGeneration: boolean;
  generateConfig: {
    categories: string[];
    recommendedClasses: string[];
    batchSize: number;
    seed: string;
  } | null;
}

interface TemplateActions {
  fetchTemplates: () => Promise<void>;
  fetchTemplate: (id: string) => Promise<void>;
  createTemplate: (data: Partial<StoryTemplate>) => Promise<StoryTemplate>;
  updateTemplate: (id: string, data: Partial<StoryTemplate>) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  duplicateTemplate: (id: string) => Promise<StoryTemplate>;
  exportTemplate: (id: string) => Promise<unknown>;
  validateTemplate: (id: string) => Promise<{ valid: boolean; errors: Array<{ message: string }>; score: number }>;

  setEditingTemplate: (template: StoryTemplate | null) => void;
  updateEditingTemplate: (updates: Partial<StoryTemplate>) => void;
  updateNestedField: <T extends keyof StoryTemplate>(field: T, value: StoryTemplate[T]) => void;
  clearEditingTemplate: () => void;

  setActiveTab: (tab: EditorTab) => void;
  setIsReadOnly: (readonly: boolean) => void;
  resetUnsavedChanges: () => void;

  clearError: () => void;
  reset: () => void;

  fetchSkillPool: (templateId: string, params?: { category?: string; recommendedClass?: string }) => Promise<void>;
  fetchItemPool: (templateId: string, params?: { category?: string; equippedSlot?: string; recommendedClass?: string; quality?: string }) => Promise<void>;
  addSkillToPool: (templateId: string, data: Partial<Omit<TemplateSkillPoolEntry, 'id' | 'templateId' | 'createdAt' | 'updatedAt'>>) => Promise<void>;
  updateSkillInPool: (templateId: string, skillId: string, data: Partial<Omit<TemplateSkillPoolEntry, 'id' | 'templateId' | 'createdAt' | 'updatedAt'>>) => Promise<void>;
  removeSkillFromPool: (templateId: string, skillId: string) => Promise<void>;
  generateSkillPool: (templateId: string, config?: { categories?: string[]; recommendedClasses?: string[]; batchSize?: number; seed?: string }) => Promise<void>;
  addItemToPool: (templateId: string, data: Partial<Omit<TemplateItemPoolEntry, 'id' | 'templateId' | 'createdAt' | 'updatedAt'>>) => Promise<void>;
  updateItemInPool: (templateId: string, itemId: string, data: Partial<Omit<TemplateItemPoolEntry, 'id' | 'templateId' | 'createdAt' | 'updatedAt'>>) => Promise<void>;
  removeItemFromPool: (templateId: string, itemId: string) => Promise<void>;
  generateItemPool: (templateId: string, config?: { categories?: string[]; recommendedClasses?: string[]; batchSize?: number; seed?: string }) => Promise<void>;
  commitAndContinueSkillPool: (templateId: string, skills: TemplateSkillPoolEntry[]) => Promise<void>;
  endSkillPoolGeneration: (templateId: string) => Promise<void>;
  removePendingSkill: (index: number) => void;
  commitAndContinueItemPool: (templateId: string, items: TemplateItemPoolEntry[]) => Promise<void>;
  endItemPoolGeneration: (templateId: string) => Promise<void>;
  removePendingItem: (index: number) => void;
  fetchPoolStats: (templateId: string) => Promise<void>;
}

const initialState: TemplateState = {
  templates: [],
  currentTemplateId: null,
  editingTemplate: null,
  isLoading: false,
  error: null,
  isSaving: false,
  activeTab: 'basic',
  isReadOnly: false,
  hasUnsavedChanges: false,
  originalTemplate: null,
  skillPool: [],
  itemPool: [],
  poolStats: null,
  poolLoading: false,
  poolGenerating: false,
  pendingGeneratedSkills: null,
  pendingGeneratedItems: null,
  isReviewingGeneration: false,
  generateConfig: null,
};

/** 从 WS 结果中提取业务数据（兼容 sendResult 包装格式） */
function unwrapWsResult(wsResult: unknown): unknown {
  const result = wsResult as Record<string, unknown>;
  if (result && typeof result === 'object' && result.data !== undefined && result.success === true) {
    return result.data;
  }
  return wsResult;
}

export const useTemplateStore = create<TemplateState & TemplateActions>()(
  devtools(
    immer((set) => ({
      ...initialState,

      fetchTemplates: async () => {
        set((state) => { state.isLoading = true; state.error = null; });
        try {
          const wsResult = await wsManager.sendRequest(WSRequestBuilder.template.list()) as Record<string, unknown>;
          const data = unwrapWsResult(wsResult) as { templates: StoryTemplate[] };
          set((state) => {
            state.templates = data.templates;
            state.isLoading = false;
          });
        } catch (error) {
          set((state) => {
            state.isLoading = false;
            state.error = error instanceof Error ? error.message : 'Failed to fetch templates';
          });
        }
      },

      fetchTemplate: async (id: string) => {
        set((state) => { state.isLoading = true; state.error = null; });
        try {
          const wsResult = await wsManager.sendRequest(WSRequestBuilder.template.get({ templateId: id })) as Record<string, unknown>;
          const template = unwrapWsResult(wsResult) as unknown as StoryTemplate;
          set((state) => {
            state.editingTemplate = template;
            state.originalTemplate = JSON.parse(JSON.stringify(template));
            state.currentTemplateId = id;
            state.isReadOnly = template.is_builtin;
            state.hasUnsavedChanges = false;
            state.isLoading = false;
          });
        } catch (error) {
          set((state) => {
            state.isLoading = false;
            state.error = error instanceof Error ? error.message : 'Failed to fetch template';
          });
        }
      },

      createTemplate: async (data: Partial<StoryTemplate>) => {
        set((state) => { state.isSaving = true; state.error = null; });
        try {
          const wsResult = await wsManager.sendRequest(WSRequestBuilder.template.create({ data: data as Record<string, unknown> })) as Record<string, unknown>;
          const newTemplate = unwrapWsResult(wsResult) as unknown as StoryTemplate;
          set((state) => {
            state.templates.push(newTemplate);
            state.editingTemplate = newTemplate;
            state.originalTemplate = JSON.parse(JSON.stringify(newTemplate));
            state.currentTemplateId = newTemplate.id;
            state.hasUnsavedChanges = false;
            state.isSaving = false;
          });
          return newTemplate;
        } catch (error) {
          set((state) => {
            state.isSaving = false;
            state.error = error instanceof Error ? error.message : 'Failed to create template';
          });
          throw error;
        }
      },

      updateTemplate: async (id: string, data: Partial<StoryTemplate>) => {
        set((state) => { state.isSaving = true; state.error = null; });
        try {
          const wsResult = await wsManager.sendRequest(WSRequestBuilder.template.update({ templateId: id, data: data as Record<string, unknown> })) as Record<string, unknown>;
          const updated = unwrapWsResult(wsResult) as unknown as StoryTemplate;
          set((state) => {
            state.editingTemplate = updated;
            state.originalTemplate = JSON.parse(JSON.stringify(updated));
            state.hasUnsavedChanges = false;
            state.isSaving = false;
            const index = state.templates.findIndex(t => t.id === id);
            if (index !== -1) {
              state.templates[index] = updated;
            }
          });
        } catch (error) {
          set((state) => {
            state.isSaving = false;
            state.error = error instanceof Error ? error.message : 'Failed to update template';
          });
          throw error;
        }
      },

      deleteTemplate: async (id: string) => {
        set((state) => { state.isLoading = true; state.error = null; });
        try {
          await wsManager.sendRequest(WSRequestBuilder.template.delete({ templateId: id }));
          set((state) => {
            state.templates = state.templates.filter(t => t.id !== id);
            if (state.currentTemplateId === id) {
              state.editingTemplate = null;
              state.originalTemplate = null;
              state.currentTemplateId = null;
            }
            state.isLoading = false;
          });
        } catch (error) {
          set((state) => {
            state.isLoading = false;
            state.error = error instanceof Error ? error.message : 'Failed to delete template';
          });
          throw error;
        }
      },

      duplicateTemplate: async (id: string) => {
        set((state) => { state.isLoading = true; state.error = null; });
        try {
          const wsResult = await wsManager.sendRequest(WSRequestBuilder.template.duplicate({ templateId: id })) as Record<string, unknown>;
          const duplicated = unwrapWsResult(wsResult) as unknown as StoryTemplate;
          set((state) => {
            state.templates.push(duplicated);
            state.editingTemplate = duplicated;
            state.originalTemplate = JSON.parse(JSON.stringify(duplicated));
            state.currentTemplateId = duplicated.id;
            state.isReadOnly = false;
            state.hasUnsavedChanges = false;
            state.isLoading = false;
          });
          return duplicated;
        } catch (error) {
          set((state) => {
            state.isLoading = false;
            state.error = error instanceof Error ? error.message : 'Failed to duplicate template';
          });
          throw error;
        }
      },

      exportTemplate: async (id: string) => {
        try {
          const wsResult = await wsManager.sendRequest(WSRequestBuilder.template.exportTemplate({ templateId: id })) as Record<string, unknown>;
          return unwrapWsResult(wsResult);
        } catch (error) {
          set((state) => {
            state.error = error instanceof Error ? error.message : 'Failed to export template';
          });
          throw error;
        }
      },

      validateTemplate: async (id: string) => {
        try {
          const wsResult = await wsManager.sendRequest(WSRequestBuilder.template.validate({ templateId: id })) as Record<string, unknown>;
          return unwrapWsResult(wsResult) as { valid: boolean; errors: Array<{ message: string }>; score: number };
        } catch (error) {
          set((state) => {
            state.error = error instanceof Error ? error.message : 'Failed to validate template';
          });
          throw error;
        }
      },

      setEditingTemplate: (template: StoryTemplate | null) =>
        set((state) => {
          state.editingTemplate = template;
          state.originalTemplate = template ? JSON.parse(JSON.stringify(template)) : null;
          state.hasUnsavedChanges = false;
          if (!template) {
            state.currentTemplateId = null;
            state.isReadOnly = false;
          }
        }),

      updateEditingTemplate: (updates: Partial<StoryTemplate>) =>
        set((state) => {
          if (state.editingTemplate) {
            Object.assign(state.editingTemplate, updates);
            state.hasUnsavedChanges = true;
          }
        }),

      updateNestedField: <T extends keyof StoryTemplate>(field: T, value: StoryTemplate[T]) =>
        set((state) => {
          if (state.editingTemplate) {
            state.editingTemplate[field] = value;
            state.hasUnsavedChanges = true;
          }
        }),

      clearEditingTemplate: () =>
        set((state) => {
          state.editingTemplate = null;
          state.originalTemplate = null;
          state.currentTemplateId = null;
          state.hasUnsavedChanges = false;
          state.activeTab = 'basic';
        }),

      setActiveTab: (tab: EditorTab) =>
        set((state) => {
          state.activeTab = tab;
        }),

      setIsReadOnly: (readonly: boolean) =>
        set((state) => {
          state.isReadOnly = readonly;
        }),

      resetUnsavedChanges: () =>
        set((state) => {
          if (state.editingTemplate) {
            state.originalTemplate = JSON.parse(JSON.stringify(state.editingTemplate));
          }
          state.hasUnsavedChanges = false;
        }),

      clearError: () =>
        set((state) => {
          state.error = null;
        }),

      reset: () => set(initialState),

      fetchSkillPool: async (templateId: string, params?: { category?: string; recommendedClass?: string }) => {
        set((state) => { state.poolLoading = true; });
        try {
          const wsResult = await wsManager.sendRequest(WSRequestBuilder.template.pool.skills({ templateId, ...params })) as Record<string, unknown>;
          const data = unwrapWsResult(wsResult) as unknown as TemplateSkillPoolEntry[];
          set((state) => { state.skillPool = data; state.poolLoading = false; });
        } catch {
          set((state) => { state.poolLoading = false; });
        }
      },

      fetchItemPool: async (templateId: string, params?: { category?: string; equippedSlot?: string; recommendedClass?: string; quality?: string }) => {
        set((state) => { state.poolLoading = true; });
        try {
          const wsResult = await wsManager.sendRequest(WSRequestBuilder.template.pool.items({ templateId, ...params })) as Record<string, unknown>;
          const data = unwrapWsResult(wsResult) as unknown as TemplateItemPoolEntry[];
          set((state) => { state.itemPool = data; state.poolLoading = false; });
        } catch {
          set((state) => { state.poolLoading = false; });
        }
      },

      addSkillToPool: async (templateId: string, data: Partial<Omit<TemplateSkillPoolEntry, 'id' | 'templateId' | 'createdAt' | 'updatedAt'>>) => {
        await wsManager.sendRequest(WSRequestBuilder.template.pool.addSkill({ templateId, data: data as Record<string, unknown> }));
        const currentTemplateId = useTemplateStore.getState().currentTemplateId;
        if (currentTemplateId) await useTemplateStore.getState().fetchSkillPool(currentTemplateId);
      },

      updateSkillInPool: async (templateId: string, skillId: string, data: Partial<Omit<TemplateSkillPoolEntry, 'id' | 'templateId' | 'createdAt' | 'updatedAt'>>) => {
        await wsManager.sendRequest(WSRequestBuilder.template.pool.updateSkill({ templateId, skillId, data: data as Record<string, unknown> }));
        const currentTemplateId = useTemplateStore.getState().currentTemplateId;
        if (currentTemplateId) await useTemplateStore.getState().fetchSkillPool(currentTemplateId);
      },

      removeSkillFromPool: async (templateId: string, skillId: string) => {
        await wsManager.sendRequest(WSRequestBuilder.template.pool.deleteSkill({ templateId, skillId }));
        const currentTemplateId = useTemplateStore.getState().currentTemplateId;
        if (currentTemplateId) await useTemplateStore.getState().fetchSkillPool(currentTemplateId);
      },

      generateSkillPool: async (templateId: string, config?: { categories?: string[]; recommendedClasses?: string[]; batchSize?: number; seed?: string }) => {
        set((state) => { state.poolGenerating = true; });
        if (config) {
          set((state) => {
            state.generateConfig = {
              categories: config.categories || [],
              recommendedClasses: config.recommendedClasses || [],
              batchSize: config.batchSize || 10,
              seed: config.seed || Math.random().toString(36).substring(2, 10),
            };
          });
        }
        const activeConfig = useTemplateStore.getState().generateConfig;
        try {
          const result = await wsManager.sendRequest(WSRequestBuilder.template.generateSkills({
            templateId,
            categories: activeConfig?.categories,
            recommendedClasses: activeConfig?.recommendedClasses,
            batchSize: activeConfig?.batchSize,
            seed: activeConfig?.seed,
          }));
          const resultId = (result as { result_id?: string }).result_id;
          if (!resultId) return;
          // 等待 WS generate_progress 事件推送结果
          const generatedSkills = await new Promise<TemplateSkillPoolEntry[] | null>((resolve, reject) => {
            const timeout = setTimeout(() => {
              unregister();
              resolve(null);
            }, 180_000);
            const unregister = wsManager.onMessage((message) => {
              if (message.type !== 'game:event') return;
              const event = message as { eventType?: string; data?: { resultId?: string; status?: string; type?: string; data?: { generated?: { skills?: TemplateSkillPoolEntry[] } }; error?: string } };
              if (event.eventType !== 'generate_progress') return;
              if (event.data?.resultId !== resultId) return;
              if (event.data.status === 'completed') {
                clearTimeout(timeout);
                unregister();
                resolve(event.data.data?.generated?.skills ?? null);
              } else if (event.data.status === 'failed') {
                clearTimeout(timeout);
                unregister();
                reject(new Error(event.data.error || '生成失败'));
              }
            });
          });
          if (generatedSkills && generatedSkills.length > 0) {
            set((state) => {
              state.pendingGeneratedSkills = generatedSkills;
              state.isReviewingGeneration = true;
            });
          }
        } finally {
          set((state) => { state.poolGenerating = false; });
        }
      },

      addItemToPool: async (templateId: string, data: Partial<Omit<TemplateItemPoolEntry, 'id' | 'templateId' | 'createdAt' | 'updatedAt'>>) => {
        await wsManager.sendRequest(WSRequestBuilder.template.pool.addItem({ templateId, data: data as Record<string, unknown> }));
        const currentTemplateId = useTemplateStore.getState().currentTemplateId;
        if (currentTemplateId) await useTemplateStore.getState().fetchItemPool(currentTemplateId);
      },

      updateItemInPool: async (templateId: string, itemId: string, data: Partial<Omit<TemplateItemPoolEntry, 'id' | 'templateId' | 'createdAt' | 'updatedAt'>>) => {
        await wsManager.sendRequest(WSRequestBuilder.template.pool.updateItem({ templateId, itemId, data: data as Record<string, unknown> }));
        const currentTemplateId = useTemplateStore.getState().currentTemplateId;
        if (currentTemplateId) await useTemplateStore.getState().fetchItemPool(currentTemplateId);
      },

      removeItemFromPool: async (templateId: string, itemId: string) => {
        await wsManager.sendRequest(WSRequestBuilder.template.pool.deleteItem({ templateId, itemId }));
        const currentTemplateId = useTemplateStore.getState().currentTemplateId;
        if (currentTemplateId) await useTemplateStore.getState().fetchItemPool(currentTemplateId);
      },

      generateItemPool: async (templateId: string, config?: { categories?: string[]; recommendedClasses?: string[]; batchSize?: number; seed?: string }) => {
        set((state) => { state.poolGenerating = true; });
        if (config) {
          set((state) => {
            state.generateConfig = {
              categories: config.categories || [],
              recommendedClasses: config.recommendedClasses || [],
              batchSize: config.batchSize || 10,
              seed: config.seed || Math.random().toString(36).substring(2, 10),
            };
          });
        }
        const activeConfig = useTemplateStore.getState().generateConfig;
        try {
          const result = await wsManager.sendRequest(WSRequestBuilder.template.generateItems({
            templateId,
            categories: activeConfig?.categories,
            recommendedClasses: activeConfig?.recommendedClasses,
            batchSize: activeConfig?.batchSize,
            seed: activeConfig?.seed,
          }));
          const resultId = (result as { result_id?: string }).result_id;
          if (!resultId) return;
          // 等待 WS generate_progress 事件推送结果
          const generatedItems = await new Promise<TemplateItemPoolEntry[] | null>((resolve, reject) => {
            const timeout = setTimeout(() => {
              unregister();
              resolve(null);
            }, 180_000);
            const unregister = wsManager.onMessage((message) => {
              if (message.type !== 'game:event') return;
              const event = message as { eventType?: string; data?: { resultId?: string; status?: string; type?: string; data?: { generated?: { items?: TemplateItemPoolEntry[] } }; error?: string } };
              if (event.eventType !== 'generate_progress') return;
              if (event.data?.resultId !== resultId) return;
              if (event.data.status === 'completed') {
                clearTimeout(timeout);
                unregister();
                resolve(event.data.data?.generated?.items ?? null);
              } else if (event.data.status === 'failed') {
                clearTimeout(timeout);
                unregister();
                reject(new Error(event.data.error || '生成失败'));
              }
            });
          });
          if (generatedItems && generatedItems.length > 0) {
            set((state) => {
              state.pendingGeneratedItems = generatedItems;
              state.isReviewingGeneration = true;
            });
          }
        } finally {
          set((state) => { state.poolGenerating = false; });
        }
      },

      commitAndContinueSkillPool: async (templateId: string, skills: TemplateSkillPoolEntry[]) => {
        set((state) => { state.poolGenerating = true; });
        try {
          await wsManager.sendRequest(WSRequestBuilder.template.pool.commitSkills({ templateId, skills }));
          set((state) => {
            state.pendingGeneratedSkills = null;
            state.isReviewingGeneration = false;
          });
          await useTemplateStore.getState().fetchSkillPool(templateId);
          await useTemplateStore.getState().generateSkillPool(templateId);
        } finally {
          set((state) => { state.poolGenerating = false; });
        }
      },

      endSkillPoolGeneration: async (templateId: string) => {
        const state = useTemplateStore.getState();
        if (state.pendingGeneratedSkills && state.pendingGeneratedSkills.length > 0) {
          await wsManager.sendRequest(WSRequestBuilder.template.pool.commitSkills({ templateId, skills: state.pendingGeneratedSkills }));
        }
        set((state) => {
          state.pendingGeneratedSkills = null;
          state.isReviewingGeneration = false;
          state.generateConfig = null;
        });
        await useTemplateStore.getState().fetchSkillPool(templateId);
      },

      removePendingSkill: (index: number) => {
        set((state) => {
          if (state.pendingGeneratedSkills) {
            state.pendingGeneratedSkills.splice(index, 1);
          }
        });
      },

      commitAndContinueItemPool: async (templateId: string, items: TemplateItemPoolEntry[]) => {
        set((state) => { state.poolGenerating = true; });
        try {
          await wsManager.sendRequest(WSRequestBuilder.template.pool.commitItems({ templateId, items }));
          set((state) => {
            state.pendingGeneratedItems = null;
            state.isReviewingGeneration = false;
          });
          await useTemplateStore.getState().fetchItemPool(templateId);
          await useTemplateStore.getState().generateItemPool(templateId);
        } finally {
          set((state) => { state.poolGenerating = false; });
        }
      },

      endItemPoolGeneration: async (templateId: string) => {
        const state = useTemplateStore.getState();
        if (state.pendingGeneratedItems && state.pendingGeneratedItems.length > 0) {
          await wsManager.sendRequest(WSRequestBuilder.template.pool.commitItems({ templateId, items: state.pendingGeneratedItems }));
        }
        set((state) => {
          state.pendingGeneratedItems = null;
          state.isReviewingGeneration = false;
          state.generateConfig = null;
        });
        await useTemplateStore.getState().fetchItemPool(templateId);
      },

      removePendingItem: (index: number) => {
        set((state) => {
          if (state.pendingGeneratedItems) {
            state.pendingGeneratedItems.splice(index, 1);
          }
        });
      },

      fetchPoolStats: async (templateId: string) => {
        try {
          const wsResult = await wsManager.sendRequest(WSRequestBuilder.template.pool.stats({ templateId })) as Record<string, unknown>;
          const data = unwrapWsResult(wsResult) as NonNullable<TemplateState['poolStats']>;
          set((state) => { state.poolStats = data; });
        } catch {
          // stats fetch failure is non-critical
        }
      },
    })),
    { name: 'TemplateStore' }
  )
);
