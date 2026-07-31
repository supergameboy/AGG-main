import { useGameStore } from '@/stores/gameStore';
import { useCombatStore } from '@/stores/combatStore';
import { useMapStore } from '@/stores/mapStore';
import { useDialogueStore } from '@/stores/dialogueStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSaveStore } from '@/stores/saveStore';
import { useGameTimeStore } from '@/stores/gameTimeStore';
import { useTemplateStore } from '@/stores/templateStore';
import { useAgentProfileStore } from '@/stores/agentProfileStore';
import { useModelConfigStore } from '@/stores/modelConfigStore';
import { useUIStore } from '@/stores/uiStore';
import { useLogStore } from '@/stores/logStore';
import { logger } from '@/utils/logger';

export interface SnapshotData {
  snapshotId: string;
  timestamp: number;
  type: 'auto' | 'manual';
  stores: Record<string, unknown>;
  metadata: { url: string; userAgent: string };
}

function sanitizeLogStore(state: Record<string, unknown>): Record<string, unknown> {
  const entries = state.entries as unknown[];
  return {
    ...state,
    entries: undefined,
    _entryCount: entries?.length ?? 0,
  };
}

export function captureAllStores(): SnapshotData {
  const storeGetters: [string, () => unknown][] = [
    ['gameStore', () => useGameStore.getState()],
    ['combatStore', () => useCombatStore.getState()],
    ['mapStore', () => useMapStore.getState()],
    ['dialogueStore', () => useDialogueStore.getState()],
    ['settingsStore', () => useSettingsStore.getState()],
    ['saveStore', () => useSaveStore.getState()],
    ['gameTimeStore', () => useGameTimeStore.getState()],
    ['templateStore', () => useTemplateStore.getState()],
    ['agentProfileStore', () => useAgentProfileStore.getState()],
    ['modelConfigStore', () => useModelConfigStore.getState()],
    ['uiStore', () => useUIStore.getState()],
    ['logStore', () => useLogStore.getState()],
  ];

  const stores: Record<string, unknown> = {};
  const storeNames: string[] = [];

  for (const [name, getState] of storeGetters) {
    try {
      const rawState = getState() as Record<string, unknown>;
      const filteredState: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(rawState)) {
        if (typeof value === 'function') continue;
        filteredState[key] = value;
      }

      if (name === 'logStore') {
        stores[name] = sanitizeLogStore(filteredState);
      } else {
        stores[name] = structuredClone(filteredState);
      }

      storeNames.push(name);
    } catch (e) {
      logger.snapshot('captureAllStores', `Failed to capture ${name}`, { error: String(e) });
    }
  }

  const snapshotId = `snap-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  logger.snapshot('captureAllStores', `Captured ${storeNames.length} stores`, {
    snapshotId,
    storeNames,
  });

  return {
    snapshotId,
    timestamp: Date.now(),
    type: 'manual',
    stores,
    metadata: {
      url: window.location.href,
      userAgent: navigator.userAgent,
    },
  };
}
