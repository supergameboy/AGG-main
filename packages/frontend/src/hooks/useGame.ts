import { useGameStore } from '@/stores/gameStore';
import type { Scene, NPC, FrontendInventoryItem, Quest } from '@/types';

export function useGame() {
  const currentScene = useGameStore((s) => s.currentScene) as Scene | null;
  const player = useGameStore((s) => s.player);
  const npcs = useGameStore((s) => s.npcs) as NPC[];
  const inventory = useGameStore((s) => s.inventory) as FrontendInventoryItem[];
  const quests = useGameStore((s) => s.quests) as Quest[];
  const isLoading = useGameStore((s) => s.isLoading);
  const error = useGameStore((s) => s.error);
  const saveId = useGameStore((s) => s.saveId);

  const setCurrentScene = useGameStore((s) => s.setCurrentScene);
  const updatePlayer = useGameStore((s) => s.updatePlayer);
  const addInventoryItem = useGameStore((s) => s.addInventoryItem);
  const removeInventoryItem = useGameStore((s) => s.removeInventoryItem);
  const updateQuest = useGameStore((s) => s.updateQuest);
  const setLoading = useGameStore((s) => s.setLoading);
  const setError = useGameStore((s) => s.setError);
  const reset = useGameStore((s) => s.reset);

  return {
    currentScene,
    player,
    npcs,
    inventory,
    quests,
    isLoading,
    error,
    saveId,
    setCurrentScene,
    updatePlayer,
    addInventoryItem,
    removeInventoryItem,
    updateQuest,
    setLoading,
    setError,
    reset,
  };
}
