import { useGameStore } from '@/stores/gameStore';
import { useCombatStore } from '@/stores/combatStore';
import { useMapStore } from '@/stores/mapStore';
import { useDialogueStore } from '@/stores/dialogueStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useLogStore } from '@/stores/logStore';
import { useUIStore } from '@/stores/uiStore';
import { useSaveStore } from '@/stores/saveStore';
import { useGameTimeStore } from '@/stores/gameTimeStore';
import { useTemplateStore } from '@/stores/templateStore';
import { useAgentProfileStore } from '@/stores/agentProfileStore';
import { useModelConfigStore } from '@/stores/modelConfigStore';

export interface StoreRegistration {
  name: string;
  getState: () => Record<string, unknown>;
  setState: (partial: Record<string, unknown>) => void;
  subscribe: (listener: () => void) => () => void;
}

const storeRegistry = new Map<string, StoreRegistration>();

export function registerStore(registration: StoreRegistration): void {
  storeRegistry.set(registration.name, registration);
}

export function getAllStores(): StoreRegistration[] {
  return Array.from(storeRegistry.values());
}

export function getStore(name: string): StoreRegistration | undefined {
  return storeRegistry.get(name);
}

export function getStoreState(name: string): Record<string, unknown> {
  const store = storeRegistry.get(name);
  if (!store) return {};
  const state = store.getState();
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (typeof value !== 'function') {
      filtered[key] = value;
    }
  }
  return filtered;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      result[key] !== null &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function setStoreState(name: string, path: string, value: unknown): void {
  const store = storeRegistry.get(name);
  if (!store) return;

  const keys = path.split('.');
  const partial: Record<string, unknown> = {};
  let current: Record<string, unknown> = partial;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (i === keys.length - 1) {
      current[key] = value;
    } else {
      current[key] = {};
      current = current[key] as Record<string, unknown>;
    }
  }

  const currentState = store.getState();
  const merged = deepMerge(currentState, partial);
  store.setState(merged);
}

function initStoreRegistrations(): void {
  const stores: StoreRegistration[] = [
    {
      name: 'gameStore',
      getState: () => useGameStore.getState() as unknown as Record<string, unknown>,
      setState: (partial) => useGameStore.setState(partial as never),
      subscribe: (listener) => useGameStore.subscribe(listener),
    },
    {
      name: 'combatStore',
      getState: () => useCombatStore.getState() as unknown as Record<string, unknown>,
      setState: (partial) => useCombatStore.setState(partial as never),
      subscribe: (listener) => useCombatStore.subscribe(listener),
    },
    {
      name: 'mapStore',
      getState: () => useMapStore.getState() as unknown as Record<string, unknown>,
      setState: (partial) => useMapStore.setState(partial as never),
      subscribe: (listener) => useMapStore.subscribe(listener),
    },
    {
      name: 'dialogueStore',
      getState: () => useDialogueStore.getState() as unknown as Record<string, unknown>,
      setState: (partial) => useDialogueStore.setState(partial as never),
      subscribe: (listener) => useDialogueStore.subscribe(listener),
    },
    {
      name: 'settingsStore',
      getState: () => useSettingsStore.getState() as unknown as Record<string, unknown>,
      setState: (partial) => useSettingsStore.setState(partial as never),
      subscribe: (listener) => useSettingsStore.subscribe(listener),
    },
    {
      name: 'logStore',
      getState: () => useLogStore.getState() as unknown as Record<string, unknown>,
      setState: (partial) => useLogStore.setState(partial as never),
      subscribe: (listener) => useLogStore.subscribe(listener),
    },
    {
      name: 'uiStore',
      getState: () => useUIStore.getState() as unknown as Record<string, unknown>,
      setState: (partial) => useUIStore.setState(partial as never),
      subscribe: (listener) => useUIStore.subscribe(listener),
    },
    {
      name: 'saveStore',
      getState: () => useSaveStore.getState() as unknown as Record<string, unknown>,
      setState: (partial) => useSaveStore.setState(partial as never),
      subscribe: (listener) => useSaveStore.subscribe(listener),
    },
    {
      name: 'gameTimeStore',
      getState: () => useGameTimeStore.getState() as unknown as Record<string, unknown>,
      setState: (partial) => useGameTimeStore.setState(partial as never),
      subscribe: (listener) => useGameTimeStore.subscribe(listener),
    },
    {
      name: 'templateStore',
      getState: () => useTemplateStore.getState() as unknown as Record<string, unknown>,
      setState: (partial) => useTemplateStore.setState(partial as never),
      subscribe: (listener) => useTemplateStore.subscribe(listener),
    },
    {
      name: 'agentProfileStore',
      getState: () => useAgentProfileStore.getState() as unknown as Record<string, unknown>,
      setState: (partial) => useAgentProfileStore.setState(partial as never),
      subscribe: (listener) => useAgentProfileStore.subscribe(listener),
    },
    {
      name: 'modelConfigStore',
      getState: () => useModelConfigStore.getState() as unknown as Record<string, unknown>,
      setState: (partial) => useModelConfigStore.setState(partial as never),
      subscribe: (listener) => useModelConfigStore.subscribe(listener),
    },
  ];

  for (const store of stores) {
    registerStore(store);
  }
}

initStoreRegistrations();
