import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../gameStore';
import type { ChatResult } from '@/api/gameApi';

const {
  setChallengeModeMock,
  setCombatMock,
  clearCombatMock,
  startCombatMock,
  dialogueStore,
  agentStore,
  performanceStore,
  consistencyStore,
} = vi.hoisted(() => ({
  setChallengeModeMock: vi.fn(),
  setCombatMock: vi.fn(),
  clearCombatMock: vi.fn(),
  startCombatMock: vi.fn(),
  dialogueStore: {
    addDialogueMessage: vi.fn(),
    setDialogueOptions: vi.fn(),
    setDialogueMessages: vi.fn(),
    setDialogueState: vi.fn(),
    setIsTyping: vi.fn(),
    clearDialogue: vi.fn(),
    isTyping: false,
  },
  agentStore: {
    activeChainId: null as string | null,
    startChain: vi.fn(),
    addStep: vi.fn(),
    endChain: vi.fn(),
  },
  performanceStore: {
    recordChatMetric: vi.fn(),
  },
  consistencyStore: {
    markStoreUpdate: vi.fn(),
  },
}));

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
    sendRequest: vi.fn(),
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
      setCombat: setCombatMock,
      clearCombat: clearCombatMock,
      startCombat: startCombatMock,
      setChallengeMode: setChallengeModeMock,
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

function buildChatResult(metadata: Record<string, unknown>): ChatResult {
  return {
    data: {
      dialogue: {
        messages: [{ speaker: 'GM', content: 'test', messageType: 'story' }],
      },
    },
    messages: [],
    toolCalls: [],
    metadata: {
      processingTime: 100,
      messageId: 'msg-1',
      processedAt: new Date().toISOString(),
      ...metadata,
    },
  } as unknown as ChatResult;
}

describe('useGameStore processChatResponse challengeMode', () => {
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

  it('processChatResponse 应在 metadata.challengeMode=turn_based_combat 时写入 combatStore', () => {
    useGameStore.getState().processChatResponse(
      buildChatResult({ challengeMode: 'turn_based_combat' }),
    );

    expect(setChallengeModeMock).toHaveBeenCalledWith('turn_based_combat');
  });

  it('processChatResponse 应在 challengeEnded=true 时清空 challengeMode', () => {
    useGameStore.getState().processChatResponse(
      buildChatResult({
        challengeMode: 'turn_based_combat',
        challengeEnded: true,
        challengeResult: 'victory',
      }),
    );

    expect(setChallengeModeMock).toHaveBeenCalledWith(null);
  });

  it('processChatResponse 应支持 dynamic_combat 模式', () => {
    useGameStore.getState().processChatResponse(
      buildChatResult({ challengeMode: 'dynamic_combat' }),
    );

    expect(setChallengeModeMock).toHaveBeenCalledWith('dynamic_combat');
  });

  it('processChatResponse 在 metadata.challengeMode 缺失时不应调用 setChallengeMode', () => {
    useGameStore.getState().processChatResponse(buildChatResult({}));

    expect(setChallengeModeMock).not.toHaveBeenCalled();
  });

  it('processChatResponse 应支持 narrative_combat 模式（GM 全权控制）', () => {
    useGameStore.getState().processChatResponse(
      buildChatResult({ challengeMode: 'narrative_combat' }),
    );

    expect(setChallengeModeMock).toHaveBeenCalledWith('narrative_combat');
  });

  it('processChatResponse 在 challengeMode=null 时应写入 null（非挑战状态）', () => {
    useGameStore.getState().processChatResponse(
      buildChatResult({ challengeMode: null }),
    );

    expect(setChallengeModeMock).toHaveBeenCalledWith(null);
  });
});
