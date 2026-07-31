import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PromptTab } from '../PromptTab';

type PromptState = {
  config: {
    skills: {
      skills: Array<{ targetAgent: string[] }>;
    };
  } | null;
  composition: {
    agentKey: string;
    intentHint: string | null;
    action: string | null;
    timestamp: number;
    systemPrompt: {
      totalTokens: number;
      layers: Array<{ name: string; order: number; content: string | null; tokenCount: number; metadata: Record<string, unknown> }>;
    };
    userPrompt: {
      totalTokens: number;
      action: string | null;
      intentHint: string | null;
      blocks: Array<{ name: string; content: string | null; fields: Array<{ key: string; label: string; present: boolean; content: string | null }> }>;
    };
    tools: {
      totalTools: number;
      totalMethods: number;
      visibleTools: number;
      deferredTools: number;
      maxOnDemandLoads: number;
      usedOnDemandLoads: number;
      deferredToolNames?: string[];
    };
  } | null;
  compositionLoading: boolean;
  selectedLayerIndex: number | null;
  selectedBlockIndex: number | null;
  fetchConfig: ReturnType<typeof vi.fn>;
  fetchComposition: ReturnType<typeof vi.fn>;
  selectLayer: ReturnType<typeof vi.fn>;
  selectBlock: ReturnType<typeof vi.fn>;
};

const promptState: PromptState = {
  config: {
    skills: {
      skills: [{ targetAgent: ['gamemaster', 'output'] }],
    },
  },
  composition: {
    agentKey: 'gamemaster',
    intentHint: 'chat',
    action: 'chat',
    timestamp: Date.now(),
    systemPrompt: {
      totalTokens: 120,
      layers: [
        { name: 'rules', order: 1, content: 'rules', tokenCount: 40, metadata: {} },
      ],
    },
    userPrompt: {
      totalTokens: 80,
      action: 'chat',
      intentHint: 'chat',
      blocks: [
        { name: 'task', content: 'task', fields: [] },
      ],
    },
    tools: {
      totalTools: 3,
      totalMethods: 5,
      visibleTools: 2,
      deferredTools: 3,
      maxOnDemandLoads: 2,
      usedOnDemandLoads: 1,
      deferredToolNames: ['map_service__move_to', 'skill_loader__load_skill'],
    },
  },
  compositionLoading: false,
  selectedLayerIndex: null,
  selectedBlockIndex: null,
  fetchConfig: vi.fn(),
  fetchComposition: vi.fn(),
  selectLayer: vi.fn(),
  selectBlock: vi.fn(),
};

vi.mock('@/stores/promptStore', () => ({
  usePromptStore: (selector: (state: PromptState) => unknown) => selector(promptState),
}));

vi.mock('@/stores/gameStore', () => ({
  useGameStore: (selector: (state: { saveId: string | null }) => unknown) => selector({ saveId: 'save-1' }),
}));

describe('PromptTab', () => {
  it('应在 PromptTab 中展示工具预算与 deferredTools 摘要', () => {
    const markup = renderToStaticMarkup(<PromptTab />);

    expect(markup).toContain('预算');
    expect(markup).toContain('Visible: 2');
    expect(markup).toContain('Deferred: 3');
    expect(markup).toContain('按需加载: 1/2');
    expect(markup).toContain('map_service__move_to');
    expect(markup).toContain('skill_loader__load_skill');
  });
});
