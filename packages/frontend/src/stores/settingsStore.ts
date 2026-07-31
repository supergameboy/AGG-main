import { create } from 'zustand';
import { persist, devtools, createJSONStorage } from 'zustand/middleware';
import type { ThemeMode } from '@/types';
import { useGameStore } from './gameStore';
import i18n from '@/i18n';

interface GameSettings {
  autoSaveInterval: number;
  textSpeed: number;
  fontSize: number;
  showDamageNumbers: boolean;
  showMinimap: boolean;
  combatAnimation: boolean;
  initTimeout: number;
  aiGenerateOptions: boolean;
}

interface AudioSettings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
}

interface SettingsState {
  theme: ThemeMode;
  language: string;
  developerMode: boolean;
  game: GameSettings;
  audio: AudioSettings;
  isLanguageChangeAllowed: boolean;

  setTheme: (theme: ThemeMode) => void;
  setLanguage: (language: string) => void;
  setDeveloperMode: (enabled: boolean) => void;
  updateGameSettings: (settings: Partial<GameSettings>) => void;
  updateAudioSettings: (settings: Partial<AudioSettings>) => void;
  reset: () => void;
}

const initialGame: GameSettings = {
  autoSaveInterval: 300,
  textSpeed: 50,
  fontSize: 14,
  showDamageNumbers: true,
  showMinimap: true,
  combatAnimation: true,
  // initTimeout: 300,
  initTimeout: 0, // 超时已禁用
  aiGenerateOptions: false,
};

const initialAudio: AudioSettings = {
  masterVolume: 80,
  musicVolume: 70,
  sfxVolume: 90,
  muted: false,
};

const initialState = {
  theme: 'system' as ThemeMode,
  language: 'zh-CN',
  developerMode: true,
  game: initialGame,
  audio: initialAudio,
};

export const useSettingsStore = create<SettingsState>()(
  devtools(
    persist(
      (set, _get) => ({
        ...initialState,

        get isLanguageChangeAllowed() {
          return !useGameStore.getState().isInitialized;
        },

        setTheme: (theme) => set({ theme }, false, 'setTheme'),
        setLanguage: (language) => {
          set({ language }, false, 'setLanguage');
          i18n.changeLanguage(language);
        },
        setDeveloperMode: (developerMode) => set({ developerMode }, false, 'setDeveloperMode'),

        updateGameSettings: (settings) =>
          set(
            (state) => ({ game: { ...state.game, ...settings } }),
            false,
            'updateGameSettings'
          ),

        updateAudioSettings: (settings) =>
          set(
            (state) => ({ audio: { ...state.audio, ...settings } }),
            false,
            'updateAudioSettings'
          ),

        reset: () => set(initialState, false, 'resetSettings'),
      }),
      {
        name: 'ai-rpg-settings',
        storage: createJSONStorage(() => sessionStorage),
        partialize: (state) => ({
          theme: state.theme,
          language: state.language,
          developerMode: state.developerMode,
        }),
      }
    ),
    { name: 'SettingsStore' }
  )
);
