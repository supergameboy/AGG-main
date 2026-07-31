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
    save: {
      storyHistory: (params: Record<string, unknown>) => ({
        module: 'save',
        action: 'story-history',
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

describe('useGameStore story history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as {
      document?: {
        documentElement: { style: { removeProperty: (name: string) => void } };
        getElementById: (id: string) => { remove: () => void } | null;
      };
    }).document = {
      documentElement: {
        style: {
          removeProperty: vi.fn(),
        },
      },
      getElementById: vi.fn().mockReturnValue(null),
    };
    useGameStore.getState().reset();
    useGameStore.setState({
      saveId: 'save-1',
      logs: [
        {
          id: 'log-1',
          type: 'system',
          message: '即时系统反馈',
          timestamp: 1,
        },
      ],
    });
  });

  it('fetchStoryHistory 应把持久化重大记录写入独立状态，不污染即时 logs', async () => {
    sendRequestMock.mockResolvedValue({
      success: true,
      data: {
        events: [
          {
            id: 'evt-1',
            save_id: 'save-1',
            chapter: 'chapter_2',
            event_type: 'major_record',
            title: '玩家确认灰雾源头线索',
            description: '村长给出关键线索',
            importance: 'critical',
            participants: '["npc-chief"]',
            impact: '{"source":"post_review"}',
            timestamp: 200,
          },
        ],
        pagination: {
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
        },
      },
    });

    await useGameStore.getState().fetchStoryHistory();

    expect(sendRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'save',
        action: 'story-history',
      }),
    );
    expect(useGameStore.getState().storyHistory).toEqual([
      expect.objectContaining({
        id: 'evt-1',
        event_type: 'major_record',
        importance: 'critical',
      }),
    ]);
    expect(useGameStore.getState().logs).toEqual([
      expect.objectContaining({
        id: 'log-1',
        message: '即时系统反馈',
      }),
    ]);
  });

  it('收到 save 模块的 game:result 响应时不应触发对话处理或 fetchStoryHistory', async () => {
    // 回归测试：修复 save.story-history 响应触发死循环 BUG
    // 见 docs/design/fix/fix-20260704-ws-story-history-infinite-loop.md
    // 注意：beforeEach 的 reset 会调用 setIsTyping(false)，这里清空以仅观察 handleWSMessage 的副作用
    vi.clearAllMocks();

    const saveResponseMessage = {
      type: 'game:result' as const,
      requestId: 'save-req-1',
      module: 'save',
      data: {
        events: [],
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
      },
    };

    useGameStore.getState().handleWSMessage(saveResponseMessage);

    // 不应再次发起 save.story-history 请求（死循环根因）
    expect(sendRequestMock).not.toHaveBeenCalled();
    // 不应被误当作对话响应处理
    expect(dialogueStore.setIsTyping).not.toHaveBeenCalled();
  });

  it('收到 game 模块的 game:result 响应时正常触发对话处理与 fetchStoryHistory', async () => {
    // 对照测试：确认 module === 'game' 时原有行为不变
    vi.clearAllMocks();
    sendRequestMock.mockResolvedValue({
      success: true,
      data: { events: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
    });

    const gameResponseMessage = {
      type: 'game:result' as const,
      requestId: 'game-req-1',
      module: 'game',
      data: { dialogue: { message: 'NPC 回复' } },
    };

    useGameStore.getState().handleWSMessage(gameResponseMessage);

    // 应该触发 fetchStoryHistory（这是对话结束后的正常行为）
    expect(sendRequestMock).toHaveBeenCalledTimes(1);
    expect(sendRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'save',
        action: 'story-history',
      }),
    );
    // 应该把 isTyping 关闭
    expect(dialogueStore.setIsTyping).toHaveBeenCalledWith(false);
  });
});
