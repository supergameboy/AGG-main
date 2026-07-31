import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { SaveRecord, CompleteSaveData, SnapshotRecord, ListSavesParams, ListSnapshotsParams } from '@/api/saveApi';
import type { SnapshotType } from '../../../shared/src/types/api';
import { useSettingsStore } from './settingsStore';
import { useGameStore } from './gameStore';
import { wsManager } from '@/services/WebSocketManager';
import { WSRequestBuilder } from '@/services/WSRequestBuilder';

interface LanguageMismatch {
  saveId: string;
  saveLanguage: string;
  targetLanguage: string;
}

interface SaveState {
  saves: SaveRecord[];
  currentSaveId: string | null;
  currentSave: CompleteSaveData | null;
  snapshots: SnapshotRecord[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  languageMismatch: LanguageMismatch | null;
  isTranslating: boolean;
}

interface SaveActions {
  fetchSaves: (params?: ListSavesParams) => Promise<void>;
  fetchSave: (saveId: string) => Promise<void>;
  createSave: (name: string, templateId?: string) => Promise<SaveRecord>;
  saveGame: (saveId: string) => Promise<void>;
  updateSaveMetadata: (
    saveId: string,
    metadata: Partial<
      Pick<SaveRecord, 'name' | 'chapter' | 'location' | 'main_quest' | 'thumbnail' | 'game_mode' | 'type'>
    >
  ) => Promise<void>;
  deleteSave: (saveId: string) => Promise<void>;
  copySave: (saveId: string, name?: string) => Promise<SaveRecord>;
  autoSave: (saveId: string) => Promise<void>;
  exportSave: (saveId: string) => Promise<{ version: string; exportedAt: number; save: unknown }>;
  importSave: (data: unknown) => Promise<string>;
  fetchSnapshots: (saveId: string, params?: ListSnapshotsParams) => Promise<void>;
  createSnapshot: (saveId: string, snapshotType?: SnapshotType, chapterName?: string) => Promise<void>;
  deleteSnapshot: (saveId: string, snapshotId: string) => Promise<void>;
  restoreSnapshot: (saveId: string, snapshotId: string) => Promise<void>;
  confirmTranslation: () => Promise<void>;
  cancelTranslation: () => void;
  setCurrentSaveId: (saveId: string | null) => void;
  clearCurrentSave: () => void;
  clearError: () => void;
  reset: () => void;
}

const initialState: SaveState = {
  saves: [],
  currentSaveId: null,
  currentSave: null,
  snapshots: [],
  isLoading: false,
  isSaving: false,
  error: null,
  languageMismatch: null,
  isTranslating: false,
};

/** 从 WS 结果中提取业务数据（兼容 sendResult 包装格式） */
function unwrapWsResult(wsResult: unknown): unknown {
  const result = wsResult as Record<string, unknown>;
  if (result && typeof result === 'object' && result.data !== undefined && result.success === true) {
    return result.data;
  }
  return wsResult;
}

export const useSaveStore = create<SaveState & SaveActions>()(
  devtools(
    immer((set, get) => ({
      ...initialState,

      fetchSaves: async (params?: ListSavesParams) => {
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });
        try {
          const wsResult = await wsManager.sendRequest(WSRequestBuilder.save.list(params as Record<string, unknown> | undefined)) as Record<string, unknown>;
          const result = unwrapWsResult(wsResult) as { saves: SaveRecord[] };
          set((state) => {
            state.saves = result.saves;
            state.isLoading = false;
          });
        } catch (error) {
          set((state) => {
            state.isLoading = false;
            state.error = error instanceof Error ? error.message : '获取存档列表失败';
          });
        }
      },

      fetchSave: async (saveId: string) => {
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });
        try {
          const wsResult = await wsManager.sendRequest(WSRequestBuilder.save.get({ saveId })) as Record<string, unknown>;
          const save = unwrapWsResult(wsResult) as unknown as CompleteSaveData;
          set((state) => {
            state.currentSave = save;
            state.currentSaveId = saveId;
            state.isLoading = false;
          });
          const saveLanguage = save.language || 'zh-CN';
          const targetLanguage = useSettingsStore.getState().language;
          if (saveLanguage !== targetLanguage) {
            set((state) => {
              state.languageMismatch = {
                saveId,
                saveLanguage,
                targetLanguage,
              };
            });
          }
        } catch (error) {
          set((state) => {
            state.isLoading = false;
            state.error = error instanceof Error ? error.message : '获取存档详情失败';
          });
        }
      },

      createSave: async (name: string, templateId?: string) => {
        set((state) => {
          state.isSaving = true;
          state.error = null;
        });
        try {
          const wsResult = await wsManager.sendRequest(WSRequestBuilder.save.create({ name, templateId })) as Record<string, unknown>;
          const newSave = unwrapWsResult(wsResult) as unknown as SaveRecord;
          set((state) => {
            state.saves.unshift(newSave);
            state.isSaving = false;
          });
          return newSave;
        } catch (error) {
          set((state) => {
            state.isSaving = false;
            state.error = error instanceof Error ? error.message : '创建存档失败';
          });
          throw error;
        }
      },

      saveGame: async (saveId: string) => {
        set((state) => {
          state.isSaving = true;
          state.error = null;
        });
        try {
          await wsManager.sendRequest(WSRequestBuilder.save.save({ saveId }));
          set((state) => {
            state.isSaving = false;
          });
        } catch (error) {
          set((state) => {
            state.isSaving = false;
            state.error = error instanceof Error ? error.message : '保存存档失败';
          });
          throw error;
        }
      },

      updateSaveMetadata: async (saveId, metadata) => {
        set((state) => {
          state.isSaving = true;
          state.error = null;
        });
        try {
          const wsResult = await wsManager.sendRequest(WSRequestBuilder.save.update({ saveId, data: metadata as Record<string, unknown> })) as Record<string, unknown>;
          const updated = unwrapWsResult(wsResult) as unknown as SaveRecord;
          set((state) => {
            state.isSaving = false;
            const index = state.saves.findIndex((s) => s.id === saveId);
            if (index !== -1) {
              state.saves[index] = updated;
            }
            if (state.currentSaveId === saveId && state.currentSave) {
              Object.assign(state.currentSave, updated);
            }
          });
        } catch (error) {
          set((state) => {
            state.isSaving = false;
            state.error = error instanceof Error ? error.message : '更新存档元数据失败';
          });
          throw error;
        }
      },

      deleteSave: async (saveId: string) => {
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });
        try {
          await wsManager.sendRequest(WSRequestBuilder.save.delete({ saveId }));
          set((state) => {
            state.saves = state.saves.filter((s) => s.id !== saveId);
            if (state.currentSaveId === saveId) {
              state.currentSave = null;
              state.currentSaveId = null;
            }
            state.isLoading = false;
          });
        } catch (error) {
          set((state) => {
            state.isLoading = false;
            state.error = error instanceof Error ? error.message : '删除存档失败';
          });
          throw error;
        }
      },

      copySave: async (saveId: string, name?: string) => {
        set((state) => {
          state.isSaving = true;
          state.error = null;
        });
        try {
          const wsResult = await wsManager.sendRequest(WSRequestBuilder.save.copy({ saveId, name })) as Record<string, unknown>;
          const copied = unwrapWsResult(wsResult) as unknown as SaveRecord;
          set((state) => {
            state.saves.unshift(copied);
            state.isSaving = false;
          });
          return copied;
        } catch (error) {
          set((state) => {
            state.isSaving = false;
            state.error = error instanceof Error ? error.message : '复制存档失败';
          });
          throw error;
        }
      },

      autoSave: async (saveId: string) => {
        try {
          await wsManager.sendRequest(WSRequestBuilder.save.autoSave({ saveId }));
        } catch (error) {
          set((state) => {
            state.error = error instanceof Error ? error.message : '自动保存失败';
          });
        }
      },

      exportSave: async (saveId: string) => {
        try {
          const wsResult = await wsManager.sendRequest(WSRequestBuilder.save.exportSave({ saveId })) as Record<string, unknown>;
          return unwrapWsResult(wsResult) as { version: string; exportedAt: number; save: unknown };
        } catch (error) {
          set((state) => {
            state.error = error instanceof Error ? error.message : '导出存档失败';
          });
          throw error;
        }
      },

      importSave: async (data: unknown) => {
        set((state) => {
          state.isSaving = true;
          state.error = null;
        });
        try {
          const wsResult = await wsManager.sendRequest(WSRequestBuilder.save.importSave({ data })) as Record<string, unknown>;
          const result = unwrapWsResult(wsResult) as { saveId: string };
          set((state) => {
            state.isSaving = false;
          });
          return result.saveId;
        } catch (error) {
          set((state) => {
            state.isSaving = false;
            state.error = error instanceof Error ? error.message : '导入存档失败';
          });
          throw error;
        }
      },

      fetchSnapshots: async (saveId: string, _params?: ListSnapshotsParams) => {
        try {
          const wsResult = await wsManager.sendRequest(WSRequestBuilder.save.snapshot.list({ saveId })) as Record<string, unknown>;
          const snapshots = unwrapWsResult(wsResult) as unknown as SnapshotRecord[];
          set((state) => {
            state.snapshots = snapshots;
          });
        } catch (error) {
          set((state) => {
            state.error = error instanceof Error ? error.message : '获取快照列表失败';
          });
        }
      },

      createSnapshot: async (saveId: string, snapshotType?: SnapshotType, chapterName?: string) => {
        set((state) => {
          state.isSaving = true;
          state.error = null;
        });
        try {
          const wsResult = await wsManager.sendRequest(WSRequestBuilder.save.snapshot.create({ saveId, snapshotType, chapterName })) as Record<string, unknown>;
          const snapshot = unwrapWsResult(wsResult) as unknown as SnapshotRecord;
          set((state) => {
            state.snapshots.unshift(snapshot);
            state.isSaving = false;
          });
        } catch (error) {
          set((state) => {
            state.isSaving = false;
            state.error = error instanceof Error ? error.message : '创建快照失败';
          });
          throw error;
        }
      },

      deleteSnapshot: async (saveId: string, snapshotId: string) => {
        try {
          await wsManager.sendRequest(WSRequestBuilder.save.snapshot.delete({ saveId, snapshotId }));
          set((state) => {
            state.snapshots = state.snapshots.filter((s) => s.id !== snapshotId);
          });
        } catch (error) {
          set((state) => {
            state.error = error instanceof Error ? error.message : '删除快照失败';
          });
          throw error;
        }
      },

      restoreSnapshot: async (saveId: string, snapshotId: string) => {
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });
        try {
          await wsManager.sendRequest(WSRequestBuilder.save.snapshot.restore({ saveId, snapshotId }));
          const wsResult = await wsManager.sendRequest(WSRequestBuilder.save.get({ saveId })) as Record<string, unknown>;
          const save = unwrapWsResult(wsResult) as unknown as CompleteSaveData;
          set((state) => {
            state.currentSave = save;
            state.isLoading = false;
          });
        } catch (error) {
          set((state) => {
            state.isLoading = false;
            state.error = error instanceof Error ? error.message : '恢复快照失败';
          });
          throw error;
        }
      },

      confirmTranslation: async () => {
        const mismatch = get().languageMismatch;
        if (!mismatch) return;

        set((state) => {
          state.isTranslating = true;
          state.error = null;
        });
        try {
          await wsManager.sendRequest(WSRequestBuilder.save.translate({ saveId: mismatch.saveId, targetLanguage: mismatch.targetLanguage }));
          set((state) => {
            state.languageMismatch = null;
            state.isTranslating = false;
          });
          const wsResult = await wsManager.sendRequest(WSRequestBuilder.save.get({ saveId: mismatch.saveId })) as Record<string, unknown>;
          const save = unwrapWsResult(wsResult) as unknown as CompleteSaveData;
          useGameStore.getState().loadSave(save);
        } catch (error) {
          set((state) => {
            state.isTranslating = false;
            state.error = error instanceof Error ? error.message : '翻译存档数据失败';
          });
          throw error;
        }
      },

      cancelTranslation: () =>
        set((state) => {
          state.languageMismatch = null;
        }),

      setCurrentSaveId: (saveId: string | null) =>
        set((state) => {
          state.currentSaveId = saveId;
        }),

      clearCurrentSave: () =>
        set((state) => {
          state.currentSave = null;
          state.currentSaveId = null;
          state.snapshots = [];
        }),

      clearError: () =>
        set((state) => {
          state.error = null;
        }),

      reset: () => set(initialState),
    })),
    { name: 'SaveStore' }
  )
);
