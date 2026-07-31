import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { getStoreState, setStoreState } from '@/utils/storeInspector';
import { logger } from '@/utils/logger';

export interface StateChangeRecord {
  id: string;
  timestamp: number;
  storeName: string;
  path: string;
  oldValue: unknown;
  newValue: unknown;
}

interface InspectorState {
  selectedStoreName: string | null;
  searchQuery: string;
  expandedPaths: string[];
  editingPath: string | null;
  changeHistory: StateChangeRecord[];

  selectStore: (name: string | null) => void;
  setSearchQuery: (query: string) => void;
  togglePath: (path: string) => void;
  startEditing: (path: string) => void;
  stopEditing: () => void;
  applyEdit: (storeName: string, path: string, value: unknown) => void;
  clearHistory: () => void;
}

const MAX_HISTORY = 100;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

function getNestedValue(obj: unknown, path: string): unknown {
  const keys = path.split('.');
  let current = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
}

export const useInspectorStore = create<InspectorState>()(
  devtools(
    immer((set) => ({
      selectedStoreName: null,
      searchQuery: '',
      expandedPaths: [],
      editingPath: null,
      changeHistory: [],

      selectStore: (name) =>
        set((state) => {
          state.selectedStoreName = name;
          state.expandedPaths = [];
          state.editingPath = null;
          state.searchQuery = '';
        }),

      setSearchQuery: (query) =>
        set((state) => {
          state.searchQuery = query;
        }),

      togglePath: (path) =>
        set((state) => {
          const idx = state.expandedPaths.indexOf(path);
          if (idx >= 0) {
            state.expandedPaths.splice(idx, 1);
          } else {
            state.expandedPaths.push(path);
          }
        }),

      startEditing: (path) =>
        set((state) => {
          state.editingPath = path;
        }),

      stopEditing: () =>
        set((state) => {
          state.editingPath = null;
        }),

      applyEdit: (storeName, path, value) =>
        set((state) => {
          const currentState = getStoreState(storeName);
          const oldValue = getNestedValue(currentState, path);

          let parsedValue: unknown = value;
          if (typeof value === 'string') {
            try {
              parsedValue = JSON.parse(value);
            } catch {
              parsedValue = value;
            }
          }

          setStoreState(storeName, path, parsedValue);

          const record: StateChangeRecord = {
            id: generateId(),
            timestamp: Date.now(),
            storeName,
            path,
            oldValue,
            newValue: parsedValue,
          };

          state.changeHistory.unshift(record);
          if (state.changeHistory.length > MAX_HISTORY) {
            state.changeHistory = state.changeHistory.slice(0, MAX_HISTORY);
          }

          state.editingPath = null;

          logger.stateChange(
            'inspectorStore',
            `${storeName}.${path}: ${JSON.stringify(oldValue)} -> ${JSON.stringify(parsedValue)}`
          );
        }),

      clearHistory: () =>
        set((state) => {
          state.changeHistory = [];
        }),
    })),
    { name: 'InspectorStore' }
  )
);
