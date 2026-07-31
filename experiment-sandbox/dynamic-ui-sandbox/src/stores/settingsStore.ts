/**
 * settingsStore 最小副本 —— 仅保留 useTheme 依赖的 theme 字段，
 * 使 hooks/useTheme.ts 可与主项目保持一致实现。
 */
import { create } from 'zustand';

type ThemeMode = 'light' | 'dark' | 'system';

interface SettingsState {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: 'dark',
  setTheme: (theme) => set({ theme }),
}));
