import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendRequestMock } = vi.hoisted(() => ({
  sendRequestMock: vi.fn(),
}));

const dialogueStore = {
  addDialogueMessage: vi.fn(),
  setDialogueOptions: vi.fn(),
  setDialogueMessages: vi.fn(),
  setIsTyping: vi.fn(),
  clearDialogue: vi.fn(),
  isTyping: false,
};

const combatStore = {
  combat: { log: [], currentTurn: 0 },
  setCombat: vi.fn(),
  clearCombat: vi.fn(),
  startCombat: vi.fn(),
};

const mapStore = {
  mapState: {
    discoveredLocationIds: [],
    locations: [],
    connections: [],
    currentLocationId: null,
  },
  setMapState: vi.fn(),
  clearMapState: vi.fn(),
};

const gameTimeStore = {
  setGameTime: vi.fn(),
  clearGameTime: vi.fn(),
};

const consistencyStore = {
  markStoreUpdate: vi.fn(),
};

const agentStore = {
  activeChainId: null as string | null,
  startChain: vi.fn(),
  addStep: vi.fn(),
  endChain: vi.fn(),
};

const performanceStore = {
  recordChatMetric: vi.fn(),
};

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/services/WebSocketManager', () => ({
  wsManager: {
    sendRequest: sendRequestMock,
    getState: vi.fn(() => 'connected'),
    onMessage: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
}));

vi.mock('@/services/WSRequestBuilder', () => ({
  WSRequestBuilder: {
    game: {
      resolve: (params: Record<string, unknown>) => ({
        module: 'game',
        action: 'resolve',
        payload: params,
      }),
    },
  },
}));

vi.mock('@/api/templateApi', () => ({
  templateApi: {
    getCharacterOptions: vi.fn(),
    getGameConfig: vi.fn(),
  },
}));

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      game: {},
    }),
  },
}));

vi.mock('@/stores/dialogueStore', () => ({
  useDialogueStore: {
    getState: () => dialogueStore,
  },
}));

vi.mock('@/stores/combatStore', () => ({
  useCombatStore: {
    getState: () => combatStore,
  },
}));

vi.mock('@/stores/mapStore', () => ({
  useMapStore: {
    getState: () => mapStore,
  },
}));

vi.mock('@/stores/gameTimeStore', () => ({
  useGameTimeStore: {
    getState: () => gameTimeStore,
  },
}));

vi.mock('@/stores/consistencyStore', () => ({
  useConsistencyStore: {
    getState: () => consistencyStore,
  },
}));

vi.mock('@/stores/agentStore', () => ({
  useAgentStore: {
    getState: () => agentStore,
  },
}));

vi.mock('@/stores/performanceStore', () => ({
  usePerformanceStore: {
    getState: () => performanceStore,
  },
}));

vi.mock('@/config/constants', () => ({
  FRONTEND_TIMEOUTS: {
    WS_EVENT_WAIT: 1000,
  },
}));

import { useGameStore } from '../gameStore';

describe('useGameStore quest:update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    useGameStore.setState({
      saveId: 'save-1',
      quests: [
        {
          id: 'quest-1',
          save_id: 'save-1',
          name: '寻找村长',
          type: 'main',
          description: '去村中心找到村长并交谈',
          status: 'active',
          visible: false,
          prerequisite_quest_ids: [],
          objectives: [],
          rewards: {
            experience: 0,
            gold: 0,
            items: [],
            skills: [],
          },
          time_limit: 0,
          created_at: 1,
          updated_at: 1,
        },
      ],
    });
  });

  it('收到缺少 description 的 quest:update 时应保留已有描述', () => {
    useGameStore.getState().handleWebSocketEvent({
      type: 'quest:update',
      timestamp: Date.now(),
      payload: {
        quest: {
          id: 'quest-1',
          name: '寻找村长',
          type: 'main',
          status: 'completed',
          objectives: [],
          rewards: {
            experience: 0,
            gold: 0,
            items: [],
            skills: [],
          },
        },
      },
    });

    expect(useGameStore.getState().quests[0]?.description).toBe('去村中心找到村长并交谈');
    expect(useGameStore.getState().quests[0]?.status).toBe('completed');
  });

  it('收到部分 quest:update 时不应把未下发字段重置为默认值', () => {
    useGameStore.setState({
      quests: [
        {
          id: 'quest-1',
          save_id: 'save-1',
          name: '寻找村长',
          type: 'main',
          description: '去村中心找到村长并交谈',
          status: 'active',
          visible: false,
          prerequisite_quest_ids: [],
          objectives: [
            {
              id: 'obj-1',
              quest_id: 'quest-1',
              type: 'talk',
              description: '与村长交谈',
              target: 'npc-chief',
              current: 0,
              required: 1,
              completed: false,
            },
          ],
          rewards: {
            experience: 100,
            gold: 20,
            items: [{ itemId: 'reward-token', quantity: 1 }],
            skills: [{ skillId: 'leadership' }],
          },
          giver_npc_id: 'npc-chief',
          giver_location_id: 'village-square',
          custom_data: { source: 'story' },
          time_limit: 0,
          created_at: 1,
          updated_at: 2,
        },
      ],
    });

    useGameStore.getState().handleWebSocketEvent({
      type: 'quest:update',
      timestamp: Date.now(),
      payload: {
        quest: {
          id: 'quest-1',
          status: 'completed',
        },
      },
    });

    const quest = useGameStore.getState().quests[0];
    expect(quest?.status).toBe('completed');
    expect(quest?.objectives).toEqual([
      {
        id: 'obj-1',
        quest_id: 'quest-1',
        type: 'talk',
        description: '与村长交谈',
        target: 'npc-chief',
        current: 0,
        required: 1,
        completed: false,
      },
    ]);
    expect(quest?.rewards).toEqual({
      experience: 100,
      gold: 20,
      items: [{ itemId: 'reward-token', quantity: 1 }],
      skills: [{ skillId: 'leadership' }],
    });
    expect(quest?.giver_npc_id).toBe('npc-chief');
    expect(quest?.giver_location_id).toBe('village-square');
    expect(quest?.custom_data).toEqual({ source: 'story' });
    expect(quest?.updated_at).toBe(2);
  });

  it('收到缺少 description 的新增 quest:update 时应拒绝写入空白任务', () => {
    useGameStore.setState({
      quests: [],
    });

    useGameStore.getState().handleWebSocketEvent({
      type: 'quest:update',
      timestamp: Date.now(),
      payload: {
        quest: {
          id: 'quest-2',
          name: '空白任务',
          type: 'side',
          status: 'active',
        },
      },
    });

    expect(useGameStore.getState().quests).toEqual([]);
  });
});
