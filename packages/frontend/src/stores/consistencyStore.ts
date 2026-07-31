import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { apiClient } from '@/api/client';
import { logger } from '@/utils/logger';
import { compareWithBackend, type MismatchItem } from '@/utils/consistencyChecker';
import { useGameStore } from '@/stores/gameStore';
import { useCombatStore } from '@/stores/combatStore';
import { useMapStore } from '@/stores/mapStore';
import { useDialogueStore } from '@/stores/dialogueStore';
import { useGameTimeStore } from '@/stores/gameTimeStore';
import { useSaveStore } from '@/stores/saveStore';

export type { MismatchItem };

export interface WSEventChainItem {
  eventType: string;
  timestamp: number;
  storeUpdated: boolean;
  updatedStores: string[];
  payload: unknown;
  category?: string;
  source?: string;
}

interface ConsistencyState {
  isChecking: boolean;
  lastCheckTime: number | null;
  mismatches: MismatchItem[];
  wsEventChain: WSEventChainItem[];
  backendData: Record<string, unknown> | null;
  checkError: string | null;
}

interface ConsistencyActions {
  runConsistencyCheck: () => Promise<void>;
  addWSEvent: (event: { type: string; payload?: unknown }) => void;
  markStoreUpdate: (eventType: string, storeNames: string[]) => void;
  clearResults: () => void;
  exportReport: () => string;
}

const initialState: ConsistencyState = {
  isChecking: false,
  lastCheckTime: null,
  mismatches: [],
  wsEventChain: [],
  backendData: null,
  checkError: null,
};

function collectFrontendStoreSnapshot(): Record<string, unknown> {
  const gameStore = useGameStore.getState();
  const combatStore = useCombatStore.getState();
  const mapStore = useMapStore.getState();
  const dialogueStore = useDialogueStore.getState();
  const gameTimeStore = useGameTimeStore.getState();

  return {
    game: {
      currentScene: gameStore.currentScene,
      player: gameStore.player,
      npcs: gameStore.npcs,
      npcInfoList: gameStore.npcInfoList,
      inventory: gameStore.inventory,
      quests: gameStore.quests,
      skills: gameStore.skills,
      saveId: gameStore.saveId,
      templateId: gameStore.templateId,
      isInitialized: gameStore.isInitialized,
    },
    combat: {
      active: combatStore.combat.active,
      enemies: combatStore.combat.enemies,
      playerHP: combatStore.combat.playerHP,
      playerMaxHP: combatStore.combat.playerMaxHP,
      playerMP: combatStore.combat.playerMP,
      playerMaxMP: combatStore.combat.playerMaxMP,
      currentTurn: combatStore.combat.currentTurn,
      isPlayerTurn: combatStore.combat.isPlayerTurn,
    },
    map: {
      locations: mapStore.mapState.locations,
      connections: mapStore.mapState.connections,
      currentLocationId: mapStore.mapState.currentLocationId,
      discoveredLocationIds: mapStore.mapState.discoveredLocationIds,
    },
    dialogue: {
      dialogueMessages: dialogueStore.dialogueMessages,
      dialogueOptions: dialogueStore.dialogueOptions,
      isTyping: dialogueStore.isTyping,
    },
    gameTime: {
      gameTime: gameTimeStore.gameTime,
    },
  };
}

export const useConsistencyStore = create<ConsistencyState & ConsistencyActions>()(
  devtools(
    immer((set, get) => ({
      ...initialState,

      runConsistencyCheck: async () => {
        const saveId = useSaveStore.getState().currentSaveId;
        if (!saveId) {
          logger.consistency('consistencyStore', 'No active saveId, cannot run consistency check');
          set((state) => {
            state.checkError = 'No active save session';
          });
          return;
        }

        set((state) => {
          state.isChecking = true;
          state.checkError = null;
        });

        logger.consistency('consistencyStore', 'Starting consistency check', { saveId });

        try {
          const backendData = await apiClient.get(
            `/dev/consistency-check?saveId=${saveId}`
          ) as Record<string, unknown>;

          logger.consistency('consistencyStore', 'Received backend data', {
            storeCount: Object.keys(backendData).length,
          });

          const frontendSnapshot = collectFrontendStoreSnapshot();
          const mismatches = compareWithBackend(backendData, frontendSnapshot);

          logger.consistency('consistencyStore', 'Comparison complete', {
            mismatchCount: mismatches.length,
          });

          set((state) => {
            state.isChecking = false;
            state.lastCheckTime = Date.now();
            state.mismatches = mismatches;
            state.backendData = backendData;
          });

          try {
            await apiClient.post('/dev/consistency-reports', {
              saveId,
              mismatches,
              frontendSnapshot,
              checkedAt: Date.now(),
            });
            logger.consistency('consistencyStore', 'Report saved to backend');
          } catch (reportError) {
            logger.consistency('consistencyStore', 'Failed to save report to backend', {
              error: reportError instanceof Error ? reportError.message : String(reportError),
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Consistency check failed';
          logger.consistency('consistencyStore', 'Consistency check failed', { error: message });
          set((state) => {
            state.isChecking = false;
            state.checkError = message;
          });
        }
      },

      addWSEvent: (event: { type: string; payload?: unknown }) => {
        logger.consistency('consistencyStore', 'WS event tracked', { eventType: event.type });
        const payload = event.payload as Record<string, unknown> | undefined;
        set((state) => {
          state.wsEventChain.push({
            eventType: event.type,
            timestamp: Date.now(),
            storeUpdated: false,
            updatedStores: [],
            payload: event.payload,
            category: typeof payload?.category === 'string' ? payload.category : undefined,
            source: typeof payload?.source === 'string' ? payload.source : undefined,
          });
        });
      },

      markStoreUpdate: (eventType: string, storeNames: string[]) => {
        set((state) => {
          const eventIndex = [...state.wsEventChain]
            .reverse()
            .findIndex((e) => e.eventType === eventType && !e.storeUpdated);
          if (eventIndex !== -1) {
            const realIndex = state.wsEventChain.length - 1 - eventIndex;
            state.wsEventChain[realIndex].storeUpdated = true;
            state.wsEventChain[realIndex].updatedStores = storeNames;
          }
        });
      },

      clearResults: () => {
        set((state) => {
          state.mismatches = [];
          state.wsEventChain = [];
          state.backendData = null;
          state.lastCheckTime = null;
          state.checkError = null;
        });
      },

      exportReport: () => {
        const { mismatches, wsEventChain, lastCheckTime, backendData } = get();
        const report = {
          exportedAt: new Date().toISOString(),
          lastCheckTime: lastCheckTime ? new Date(lastCheckTime).toISOString() : null,
          mismatchCount: mismatches.length,
          mismatches,
          wsEventChain,
          backendDataKeys: backendData ? Object.keys(backendData) : [],
        };
        return JSON.stringify(report, null, 2);
      },
    })),
    { name: 'ConsistencyStore' }
  )
);
