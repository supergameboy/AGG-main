import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

const MAX_CHAINS = 20;
const MAX_CHAIN_STEPS = 50;

export interface ReActStep {
  id: string;
  phase: 'thinking' | 'tool_call' | 'observation' | 'final_answer' | 'error';
  agentName: string;
  thought?: string;
  toolName?: string;
  toolInput?: unknown;
  result?: unknown;
  answer?: unknown;
  error?: string;
  timestamp: number;
}

export interface ReActChain {
  id: string;
  steps: ReActStep[];
  startTime: number;
  endTime: number | null;
  gm?: {
    processedAt: number;
    duration: number;
    reactIterations: number;
    agentsInvolved: string[];
  };
  metadata?: {
    processingTime: number;
    messageId: string;
    processedAt: string;
    partialSuccess?: boolean;
    isInitialization?: boolean;
  };
  writeOperations?: Array<{
    toolType: string;
    method: string;
    timestamp: number;
  }>;
  agentOutputs?: Record<string, unknown>;
  messages?: Array<Record<string, unknown>>;
  toolCalls?: Array<Record<string, unknown>>;
}

interface AgentState {
  chains: ReActChain[];
  activeChainId: string | null;
  selectedStepId: string | null;
}

interface AgentActions {
  startChain: () => string;
  addStep: (step: Omit<ReActStep, 'id'>) => void;
  endChain: (data: {
    gm?: ReActChain['gm'];
    metadata?: ReActChain['metadata'];
    writeOperations?: ReActChain['writeOperations'];
    agentOutputs?: ReActChain['agentOutputs'];
    messages?: Array<Record<string, unknown>>;
    toolCalls?: Array<Record<string, unknown>>;
  }) => void;
  selectStep: (stepId: string | null) => void;
  clearChains: () => void;
}

const initialState: AgentState = {
  chains: [],
  activeChainId: null,
  selectedStepId: null,
};

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

export const useAgentStore = create<AgentState & AgentActions>()(
  devtools(
    immer((set, get) => ({
      ...initialState,

      startChain: () => {
        const id = generateId();
        const chain: ReActChain = {
          id,
          steps: [],
          startTime: Date.now(),
          endTime: null,
        };
        set((s) => {
          s.chains.unshift(chain);
          if (s.chains.length > MAX_CHAINS) {
            s.chains = s.chains.slice(0, MAX_CHAINS);
          }
          s.activeChainId = id;
          s.selectedStepId = null;
        });
        return id;
      },

      addStep: (step) => {
        const { activeChainId } = get();
        if (!activeChainId) return;
        const id = generateId();
        set((s) => {
          const chain = s.chains.find((c) => c.id === activeChainId);
          if (!chain) return;
          if (chain.steps.length >= MAX_CHAIN_STEPS) return;
          chain.steps.push({ ...step, id });
        });
      },

      endChain: (data) => {
        const { activeChainId } = get();
        if (!activeChainId) return;
        set((s) => {
          const chain = s.chains.find((c) => c.id === activeChainId);
          if (!chain) return;
          chain.endTime = Date.now();
          if (data.gm) chain.gm = data.gm;
          if (data.metadata) chain.metadata = data.metadata;
          if (data.writeOperations) chain.writeOperations = data.writeOperations;
          if (data.agentOutputs) chain.agentOutputs = data.agentOutputs;
          if (data.messages) chain.messages = data.messages;
          if (data.toolCalls) chain.toolCalls = data.toolCalls;
          s.activeChainId = null;
        });
      },

      selectStep: (stepId) => {
        set((s) => {
          s.selectedStepId = stepId;
        });
      },

      clearChains: () => {
        set((s) => {
          s.chains = [];
          s.activeChainId = null;
          s.selectedStepId = null;
        });
      },
    })),
    { name: 'AgentStore' }
  )
);
