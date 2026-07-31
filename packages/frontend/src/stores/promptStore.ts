import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { gameApi } from '@/api/gameApi';
import { logger } from '@/utils/logger';
import type { PromptCompositionResponse, PromptConfigResponse } from '@/api/gameApi';

interface PromptState {
  config: PromptConfigResponse | null;
  configLoading: boolean;
  composition: PromptCompositionResponse | null;
  compositionLoading: boolean;
  selectedLayerIndex: number | null;
  selectedBlockIndex: number | null;
}

interface PromptActions {
  fetchConfig: () => Promise<void>;
  fetchComposition: (saveId: string, agentKey?: string, intentHint?: string) => Promise<void>;
  selectLayer: (index: number | null) => void;
  selectBlock: (index: number | null) => void;
}

const initialState: PromptState = {
  config: null,
  configLoading: false,
  composition: null,
  compositionLoading: false,
  selectedLayerIndex: null,
  selectedBlockIndex: null,
};

export const usePromptStore = create<PromptState & PromptActions>()(
  devtools(
    immer((set) => ({
      ...initialState,

      fetchConfig: async () => {
        set((s) => { s.configLoading = true; });
        try {
          const data = await gameApi.fetchPromptConfig();
          set((s) => {
            s.config = data;
            s.configLoading = false;
          });
        } catch (error) {
          logger.error('promptStore', 'Failed to fetch prompt config', undefined, error instanceof Error ? error.stack : undefined);
          set((s) => { s.configLoading = false; });
        }
      },

      fetchComposition: async (saveId: string, agentKey?: string, intentHint?: string) => {
        set((s) => { s.compositionLoading = true; });
        try {
          const data = await gameApi.fetchPromptComposition({ saveId, agentKey, intentHint });
          set((s) => {
            s.composition = data;
            s.compositionLoading = false;
            s.selectedLayerIndex = null;
            s.selectedBlockIndex = null;
          });
        } catch (error) {
          logger.error('promptStore', 'Failed to fetch prompt composition', undefined, error instanceof Error ? error.stack : undefined);
          set((s) => { s.compositionLoading = false; });
        }
      },

      selectLayer: (index) => {
        set((s) => { s.selectedLayerIndex = index; });
      },

      selectBlock: (index) => {
        set((s) => { s.selectedBlockIndex = index; });
      },
    })),
    { name: 'PromptStore' }
  )
);
