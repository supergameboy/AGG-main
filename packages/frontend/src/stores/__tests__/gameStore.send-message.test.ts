import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../gameStore';

const {
  sendRequestMock,
} = vi.hoisted(() => ({
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

const agentStore = {
  activeChainId: null as string | null,
  startChain: vi.fn(),
  addStep: vi.fn(),
  endChain: vi.fn(),
};

const performanceStore = {
  recordChatMetric: vi.fn(),
};

const consistencyStore = {
  markStoreUpdate: vi.fn(),
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

vi.mock('@/stores/consistencyStore', () => ({
  useConsistencyStore: {
    getState: () => consistencyStore,
  },
}));

vi.mock('@/stores/combatStore', () => ({
  useCombatStore: {
    getState: () => ({
      setCombat: vi.fn(),
      clearCombat: vi.fn(),
      startCombat: vi.fn(),
    }),
  },
}));

vi.mock('@/stores/mapStore', () => ({
  useMapStore: {
    getState: () => ({
      setMapState: vi.fn(),
      clearMapState: vi.fn(),
    }),
  },
}));

vi.mock('@/stores/gameTimeStore', () => ({
  useGameTimeStore: {
    getState: () => ({
      setGameTime: vi.fn(),
      clearGameTime: vi.fn(),
    }),
  },
}));

vi.mock('@/config/constants', () => ({
  FRONTEND_TIMEOUTS: {
    WS_EVENT_WAIT: 1000,
  },
}));

describe('useGameStore sendMessage', () => {
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
      player: {
        id: 'char-1',
        name: '测试勇者',
      } as never,
    });
  });

  it('sendMessage 成功时应通过 WS 发送请求，不直接插入对话消息', async () => {
    sendRequestMock.mockResolvedValue({
      success: true,
      data: {
        dialogue: {
          messages: [
            {
              speaker: '测试勇者',
              content: '你好',
              messageType: 'player',
            },
          ],
        },
      },
      metadata: {},
      messages: [],
      toolCalls: [],
    });

    await useGameStore.getState().sendMessage('你好');

    // WS 模式下 sendMessage 乐观更新：立即添加玩家消息
    expect(dialogueStore.addDialogueMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '你好',
        isPlayer: true,
        messageType: 'player',
      }),
    );
    // 应通过 WS 发送请求
    expect(sendRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'game',
        action: 'resolve',
      }),
    );
  });
});
