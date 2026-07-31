import { describe, it, expect } from 'vitest';
import { RiskGate, type RiskAssessmentInput } from '../risk-gate.js';
import type { IntegrationResult } from '../types.js';
import type { AgentMessage, AgentType, ToolResult } from '@ai-rpg/shared';
import type { SchedulerRequestContext } from '../types.js';

// --- Test Helpers ---

function makeToolCall(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    id: 'tc-1',
    toolCallId: 'tci-1',
    success: true,
    data: {},
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeWriteOperation(targetId: string = 'entity-1', toolType: string = 'npc_service', method: string = 'update_npc') {
  return {
    toolType,
    method,
    params: { id: targetId },
    result: { success: true },
    timestamp: Date.now(),
  };
}

function makeIntegrationResult(overrides: Partial<IntegrationResult> = {}): IntegrationResult {
  return {
    success: true,
    data: {},
    writeOperations: [],
    agentResponses: new Map(),
    needsFurtherProcessing: false,
    fallbackSuggestions: [],
    ...overrides,
  };
}

function makeMessage(action: string = 'talk'): AgentMessage {
  return {
    id: 'msg-1',
    timestamp: Date.now(),
    from: 'player' as AgentType,
    to: 'coordinator' as AgentType,
    type: 'request',
    saveId: 'save-1' as any,
    payload: {
      action,
      data: {},
    },
    metadata: {
      priority: 'normal',
      requiresResponse: true,
    },
  };
}

function makeRuntimeContext(overrides: Partial<SchedulerRequestContext> = {}): SchedulerRequestContext {
  return {
    saveId: 'save-1',
    reactIterations: 1,
    ...overrides,
  } as SchedulerRequestContext;
}

function makeAssessmentInput(overrides: Partial<RiskAssessmentInput> = {}): RiskAssessmentInput {
  return {
    integratedResult: makeIntegrationResult(),
    message: makeMessage(),
    runtimeContext: makeRuntimeContext(),
    ...overrides,
  };
}

// --- Tests ---

describe('RiskGate', () => {
  describe('low risk scenarios', () => {
    it('returns low risk when all conditions are safe', () => {
      const gate = new RiskGate();
      const input = makeAssessmentInput();

      const result = gate.assess(input);

      expect(result.level).toBe('low');
      expect(result.reasons).toEqual([]);
      expect(result.skippedReviewer).toBe(true);
    });

    it('returns low risk with single agent write operation', () => {
      const gate = new RiskGate();
      const agentResponses = new Map();
      agentResponses.set('dialogue', {
        success: true,
        toolCalls: [makeToolCall({ writeOperation: makeWriteOperation('npc-1') })],
      });
      const input = makeAssessmentInput({
        integratedResult: makeIntegrationResult({ agentResponses }),
      });

      const result = gate.assess(input);

      expect(result.level).toBe('low');
      expect(result.skippedReviewer).toBe(true);
    });

    it('returns low risk with zero tool failure rate', () => {
      const gate = new RiskGate();
      const input = makeAssessmentInput({ toolFailureRate: 0 });

      const result = gate.assess(input);

      expect(result.level).toBe('low');
    });
  });

  describe('high risk: cross-agent write conflict', () => {
    it('returns high risk when multiple agents write the same entity', () => {
      const gate = new RiskGate();
      const agentResponses = new Map();
      agentResponses.set('dialogue', {
        success: true,
        toolCalls: [makeToolCall({ writeOperation: makeWriteOperation('npc-1') })],
      });
      agentResponses.set('challenge', {
        success: true,
        toolCalls: [makeToolCall({ writeOperation: makeWriteOperation('npc-1') })],
      });
      const input = makeAssessmentInput({
        integratedResult: makeIntegrationResult({ agentResponses }),
      });

      const result = gate.assess(input);

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('cross_agent_write_conflict');
      expect(result.skippedReviewer).toBe(false);
    });

    it('returns low risk when agents write different entities', () => {
      const gate = new RiskGate();
      const agentResponses = new Map();
      agentResponses.set('dialogue', {
        success: true,
        toolCalls: [makeToolCall({ writeOperation: makeWriteOperation('npc-1') })],
      });
      agentResponses.set('challenge', {
        success: true,
        toolCalls: [makeToolCall({ writeOperation: makeWriteOperation('npc-2') })],
      });
      const input = makeAssessmentInput({
        integratedResult: makeIntegrationResult({ agentResponses }),
      });

      const result = gate.assess(input);

      expect(result.level).toBe('low');
    });
  });

  describe('high risk: needAgentRequests', () => {
    it('returns high risk when needAgentRequests exist', () => {
      const gate = new RiskGate();
      const input = makeAssessmentInput({
        integratedResult: makeIntegrationResult({
          needAgentRequests: [{ agentType: 'quest' as AgentType, action: 'generate', reason: 'generate', data: {} }],
        }),
      });

      const result = gate.assess(input);

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('need_agent_requests');
    });
  });

  describe('high risk: dynamic UI needed', () => {
    it('returns high risk when intent needs dynamic UI', () => {
      const gate = new RiskGate();
      const input = makeAssessmentInput({
        runtimeContext: makeRuntimeContext({
          intent: { needsDynamicUI: true, dynamicUIScenario: 'combat_result' } as any,
        }),
      });

      const result = gate.assess(input);

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('dynamic_ui_needed');
    });
  });

  describe('high risk: tool failure rate exceeds threshold', () => {
    it('returns high risk when tool failure rate exceeds 50%', () => {
      const gate = new RiskGate();
      const input = makeAssessmentInput({ toolFailureRate: 0.6 });

      const result = gate.assess(input);

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('tool_failure_rate_exceeded');
    });

    it('returns low risk when tool failure rate is at threshold boundary', () => {
      const gate = new RiskGate();
      const input = makeAssessmentInput({ toolFailureRate: 0.5 });

      const result = gate.assess(input);

      expect(result.level).toBe('low');
    });

    it('respects custom tool failure threshold', () => {
      const gate = new RiskGate({ toolFailureThreshold: 0.3 });
      const input = makeAssessmentInput({ toolFailureRate: 0.4 });

      const result = gate.assess(input);

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('tool_failure_rate_exceeded');
    });
  });

  describe('high risk: execution failure', () => {
    it('returns high risk when integratedResult.success is false', () => {
      const gate = new RiskGate();
      const input = makeAssessmentInput({
        integratedResult: makeIntegrationResult({ success: false }),
      });

      const result = gate.assess(input);

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('execution_failed');
    });

    it('returns high risk when needsFurtherProcessing is true', () => {
      const gate = new RiskGate();
      const input = makeAssessmentInput({
        integratedResult: makeIntegrationResult({ needsFurtherProcessing: true, processingReason: 'incomplete' }),
      });

      const result = gate.assess(input);

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('needs_further_processing');
    });
  });

  describe('high risk: correction action', () => {
    it('returns high risk when action is correct', () => {
      const gate = new RiskGate();
      const input = makeAssessmentInput({
        message: makeMessage('correct'),
      });

      const result = gate.assess(input);

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('correction_action');
    });
  });

  describe('high risk: second layer schedule', () => {
    it('returns high risk when reactIterations > 1', () => {
      const gate = new RiskGate();
      const input = makeAssessmentInput({
        runtimeContext: makeRuntimeContext({ reactIterations: 2 }),
      });

      const result = gate.assess(input);

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('second_layer_schedule');
    });
  });

  describe('multiple risk factors', () => {
    it('accumulates all risk reasons', () => {
      const gate = new RiskGate();
      const input = makeAssessmentInput({
        integratedResult: makeIntegrationResult({
          success: false,
          needsFurtherProcessing: true,
          processingReason: 'incomplete',
          needAgentRequests: [{ agentType: 'quest' as AgentType, action: 'generate', reason: 'generate', data: {} }],
        }),
        runtimeContext: makeRuntimeContext({ reactIterations: 2 }),
      });

      const result = gate.assess(input);

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('execution_failed');
      expect(result.reasons).toContain('needs_further_processing');
      expect(result.reasons).toContain('need_agent_requests');
      expect(result.reasons).toContain('second_layer_schedule');
      expect(result.reasons.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('disabled RiskGate', () => {
    it('always returns high risk when disabled', () => {
      const gate = new RiskGate({ enabled: false });
      const input = makeAssessmentInput();

      const result = gate.assess(input);

      expect(result.level).toBe('high');
      expect(result.skippedReviewer).toBe(false);
      expect(result.reasons).toContain('risk_gate_disabled');
    });
  });

  describe('buildDefaultDecision', () => {
    it('returns a valid default UnifiedPostReviewDecision', () => {
      const gate = new RiskGate();

      const decision = gate.buildDefaultDecision();

      expect(decision.taskReview?.completion).toBe('complete');
      expect(decision.taskReview?.qualityVerifications).toEqual([]);
      expect(decision.storyReview?.storyConsistency).toBe('match');
      expect(decision.storyReview?.progressDelta).toBe('low_risk_auto_approved');
      expect(decision.secondLayerDecision?.shouldSchedule).toBe(false);
      expect(decision.recordUploadDecision?.shouldUpload).toBe(true);
      expect(decision.recordUploadDecision?.reason).toBe('auto_approved_by_risk_gate');
    });
  });

  describe('config defaults', () => {
    it('uses default config when no config provided', () => {
      const gate = new RiskGate();
      const input = makeAssessmentInput();

      const result = gate.assess(input);

      expect(result.level).toBe('low');
    });

    it('merges partial config with defaults', () => {
      const gate = new RiskGate({ toolFailureThreshold: 0.2 });
      const input = makeAssessmentInput({ toolFailureRate: 0.3 });

      const result = gate.assess(input);

      expect(result.level).toBe('high');
    });
  });
});
