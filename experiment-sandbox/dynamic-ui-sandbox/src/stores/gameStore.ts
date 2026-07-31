/**
 * gameStore 最小副本 —— DynamicUIRenderer 的 npc-card 分支仅消费
 * `useGameStore.getState().npcInfoList`（经 findEntityByIdOrName 按名称查找），
 * 沙箱保留同名字段与 zustand 用法，便于代码原样回迁。
 */
import { create } from 'zustand';
import type { FrontendNPCInfo } from '@/types';

interface GameState {
  npcInfoList: FrontendNPCInfo[];
  setNpcInfoList: (npcs: FrontendNPCInfo[]) => void;
}

export const useGameStore = create<GameState>((set) => ({
  npcInfoList: [],
  setNpcInfoList: (npcs) => set({ npcInfoList: npcs }),
}));
