import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { gameApi } from '@/api/gameApi';
import { logger } from '@/utils/logger';
import type { PromptConfigResponse, KnowledgeItemResponse, HelpRegistryResponse } from '@/api/gameApi';

interface KnowledgeState {
  rulesConfig: PromptConfigResponse['rules'] | null;
  skillsConfig: PromptConfigResponse['skills'] | null;
  helpConfig: HelpRegistryResponse | null;
  loading: boolean;
  selectedItem: KnowledgeItemResponse | null;
  selectedItemLoading: boolean;
  filterAgent: string;
  filterType: 'all' | 'skill' | 'rule' | 'help';
}

interface KnowledgeActions {
  fetchAll: () => Promise<void>;
  fetchItem: (type: 'skill' | 'rule' | 'help', name: string) => Promise<void>;
  setFilterAgent: (agent: string) => void;
  setFilterType: (type: 'all' | 'skill' | 'rule' | 'help') => void;
}

const initialState: KnowledgeState = {
  rulesConfig: null,
  skillsConfig: null,
  helpConfig: null,
  loading: false,
  selectedItem: null,
  selectedItemLoading: false,
  filterAgent: '',
  filterType: 'all',
};

export const useKnowledgeStore = create<KnowledgeState & KnowledgeActions>()(
  devtools(
    immer((set) => ({
      ...initialState,

      fetchAll: async () => {
        set((s) => { s.loading = true; });
        try {
          const [configData, helpData] = await Promise.all([
            gameApi.fetchPromptConfig(),
            gameApi.fetchHelpRegistry(),
          ]);
          set((s) => {
            s.rulesConfig = configData.rules;
            s.skillsConfig = configData.skills;
            s.helpConfig = helpData;
            s.loading = false;
          });
        } catch (error) {
          logger.error('knowledgeStore', 'Failed to fetch knowledge data', undefined, error instanceof Error ? error.stack : undefined);
          set((s) => { s.loading = false; });
        }
      },

      fetchItem: async (type, name) => {
        set((s) => { s.selectedItemLoading = true; });
        try {
          const data = await gameApi.fetchKnowledgeItem(type, name);
          set((s) => {
            s.selectedItem = data;
            s.selectedItemLoading = false;
          });
        } catch (error) {
          logger.error('knowledgeStore', 'Failed to fetch knowledge item', undefined, error instanceof Error ? error.stack : undefined);
          set((s) => { s.selectedItemLoading = false; });
        }
      },

      setFilterAgent: (agent) => {
        set((s) => { s.filterAgent = agent; });
      },

      setFilterType: (type) => {
        set((s) => { s.filterType = type; });
      },
    })),
    { name: 'KnowledgeStore' }
  )
);
