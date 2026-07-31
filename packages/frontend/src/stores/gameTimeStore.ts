import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

export interface GameTime {
  day: number;
  hour: number;
  minute: number;
  period: string;
  season: string;
  description: string;
}

interface GameTimeStoreState {
  gameTime: GameTime | null;

  setGameTime: (time: GameTime | null) => void;
  updateGameTime: (updates: Partial<GameTime>) => void;
  clearGameTime: () => void;
}

export const useGameTimeStore = create<GameTimeStoreState>()(
  devtools(
    immer((set) => ({
      gameTime: null,

      setGameTime: (time) =>
        set((state) => {
          state.gameTime = time;
        }),

      updateGameTime: (updates) =>
        set((state) => {
          if (state.gameTime) {
            Object.assign(state.gameTime, updates);
          }
        }),

      clearGameTime: () =>
        set((state) => {
          state.gameTime = null;
        }),
    })),
    { name: 'GameTimeStore' }
  )
);
