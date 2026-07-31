export interface ToolCallTrace {
  iteration: number;
  tool: string;
  args: Record<string, unknown>;
  resultPreview: string;
  duration: number;
  isReadOperation: boolean;
}

export interface LlmInputEntry {
  iteration: number;
  toolSections: Array<{ section: string; fields: string[] }>;
  messageCount: number;
}

export interface AgentTraceEntry {
  agentType: string;
  iterations: number;
  maxIterations: number;
  reachedMax: boolean;
  toolCalls: ToolCallTrace[];
  tokenUsage: { input: number; output: number; total: number; cacheHit: number; cacheMiss: number };
  finalAnswer: string;
  llmInputs: LlmInputEntry[];
}

export interface CoordinatorDecision {
  intent: string;
  routedAgents: string[];
  dagPlan?: unknown;
}

export interface AgentTraceData {
  requestId: string;
  agentTraces: AgentTraceEntry[];
  coordinatorDecisions: CoordinatorDecision[];
}

export class TraceCollector {
  private agentTraces: Map<string, AgentTraceEntry> = new Map();
  private coordinatorDecisions: CoordinatorDecision[] = [];
  private readonly requestId: string;

  constructor(requestId: string) {
    this.requestId = requestId;
  }

  recordIteration(params: {
    agentType: string;
    iteration: number;
    maxIterations: number;
    toolCall?: {
      tool: string;
      args: Record<string, unknown>;
      resultPreview: string;
      duration: number;
      isReadOperation: boolean;
    };
    llmInput?: {
      toolSections: Array<{ section: string; fields: string[] }>;
      messageCount: number;
    };
  }): void {
    const { agentType, iteration, maxIterations, toolCall, llmInput } = params;

    if (!this.agentTraces.has(agentType)) {
      this.agentTraces.set(agentType, {
        agentType,
        iterations: 0,
        maxIterations,
        reachedMax: false,
        toolCalls: [],
        tokenUsage: { input: 0, output: 0, total: 0, cacheHit: 0, cacheMiss: 0 },
        finalAnswer: '',
        llmInputs: [],
      });
    }

    const trace = this.agentTraces.get(agentType)!;
    trace.iterations = iteration;
    trace.maxIterations = maxIterations;

    if (toolCall) {
      trace.toolCalls.push({
        iteration,
        tool: toolCall.tool,
        args: toolCall.args,
        resultPreview: toolCall.resultPreview,
        duration: toolCall.duration,
        isReadOperation: toolCall.isReadOperation,
      });
    }

    if (llmInput) {
      trace.llmInputs.push({
        iteration,
        toolSections: llmInput.toolSections,
        messageCount: llmInput.messageCount,
      });
    }
  }

  setReachedMax(agentType: string, reached: boolean): void {
    const trace = this.agentTraces.get(agentType);
    if (trace) {
      trace.reachedMax = reached;
    }
  }

  setTokenUsage(agentType: string, usage: { input: number; output: number; total: number; cacheHit: number; cacheMiss: number }): void {
    const trace = this.agentTraces.get(agentType);
    if (trace) {
      trace.tokenUsage = usage;
    }
  }

  setFinalAnswer(agentType: string, answer: string): void {
    const trace = this.agentTraces.get(agentType);
    if (trace) {
      trace.finalAnswer = answer;
    }
  }

  setCoordinatorDecisions(decisions: CoordinatorDecision[]): void {
    this.coordinatorDecisions = decisions;
  }

  toAgentTraceData(): AgentTraceData {
    return {
      requestId: this.requestId,
      agentTraces: Array.from(this.agentTraces.values()),
      coordinatorDecisions: this.coordinatorDecisions,
    };
  }

  getAgentTraces(): AgentTraceEntry[] {
    return Array.from(this.agentTraces.values());
  }

  getRequestId(): string {
    return this.requestId;
  }
}
