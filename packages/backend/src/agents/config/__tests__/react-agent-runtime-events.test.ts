import { describe, it, expect } from 'vitest';
import type { RuntimeEvent, ExecutionTraceIds } from '../../../../../shared/src/types/execution-trace.js';

/**
 * 纯函数测试：验证 ReActAgent 关键节点 RuntimeEvent 构建逻辑。
 * 这些函数从 ReActAgent 提取，用于在主循环中生成结构化事件。
 */

function buildTraceIds(
  base: Partial<ExecutionTraceIds>,
  overrides: Partial<ExecutionTraceIds> = {},
): ExecutionTraceIds {
  return {
    requestId: base.requestId ?? 'unknown',
    sessionId: base.sessionId ?? 'unknown',
    agentRunId: base.agentRunId ?? '',
    agentDepth: base.agentDepth ?? 0,
    ...overrides,
  };
}

function buildRequestStartedEvent(traceIds: ExecutionTraceIds, source: string): RuntimeEvent {
  return {
    type: 'request_started',
    at: Date.now(),
    traceIds,
    source,
    summary: `Request started: ${traceIds.requestId}`,
  };
}

function buildPromptBuiltEvent(traceIds: ExecutionTraceIds, source: string, layerCount: number): RuntimeEvent {
  return {
    type: 'prompt_built',
    at: Date.now(),
    traceIds,
    source,
    summary: `Prompt built with ${layerCount} layers`,
    detail: { layerCount },
  };
}

function buildToolCalledEvent(
  traceIds: ExecutionTraceIds,
  source: string,
  toolName: string,
  toolCallId: string,
): RuntimeEvent {
  return {
    type: 'tool_called',
    at: Date.now(),
    traceIds: { ...traceIds, toolCallId },
    source,
    summary: `Tool called: ${toolName}`,
    detail: { toolName, toolCallId },
  };
}

function buildToolReturnedEvent(
  traceIds: ExecutionTraceIds,
  source: string,
  toolName: string,
  toolCallId: string,
  success: boolean,
): RuntimeEvent {
  return {
    type: 'tool_returned',
    at: Date.now(),
    traceIds: { ...traceIds, toolCallId },
    source,
    summary: `Tool returned: ${toolName} (${success ? 'ok' : 'error'})`,
    detail: { toolName, toolCallId, success },
  };
}

function buildAuditFinishedEvent(
  traceIds: ExecutionTraceIds,
  source: string,
  auditRoundId: string,
  passed: boolean,
): RuntimeEvent {
  return {
    type: 'audit_finished',
    at: Date.now(),
    traceIds: { ...traceIds, auditRoundId },
    source,
    summary: `Audit finished: ${passed ? 'passed' : 'failed'}`,
    detail: { auditRoundId, passed },
  };
}

function buildAgentFailedOrRecoveredEvent(
  traceIds: ExecutionTraceIds,
  source: string,
  error: string,
  recovered: boolean,
): RuntimeEvent {
  return {
    type: 'agent_failed_or_recovered',
    at: Date.now(),
    traceIds,
    source,
    summary: recovered ? `Agent recovered from: ${error}` : `Agent failed: ${error}`,
    detail: { error, recovered },
  };
}

describe('ReActAgent RuntimeEvent builders', () => {
  const baseTraceIds: ExecutionTraceIds = {
    requestId: 'req-001',
    sessionId: 'save-001',
    agentRunId: 'gamemaster:uuid-001',
    agentDepth: 0,
  };

  describe('buildRequestStartedEvent', () => {
    it('creates request_started event with correct traceIds', () => {
      const event = buildRequestStartedEvent(baseTraceIds, 'gamemaster');

      expect(event.type).toBe('request_started');
      expect(event.traceIds.requestId).toBe('req-001');
      expect(event.traceIds.sessionId).toBe('save-001');
      expect(event.traceIds.agentRunId).toBe('gamemaster:uuid-001');
      expect(event.source).toBe('gamemaster');
      expect(event.summary).toContain('req-001');
    });
  });

  describe('buildPromptBuiltEvent', () => {
    it('creates prompt_built event with layer count', () => {
      const event = buildPromptBuiltEvent(baseTraceIds, 'gamemaster', 7);

      expect(event.type).toBe('prompt_built');
      expect(event.detail?.layerCount).toBe(7);
      expect(event.summary).toContain('7 layers');
    });
  });

  describe('buildToolCalledEvent', () => {
    it('creates tool_called event with toolCallId in traceIds', () => {
      const event = buildToolCalledEvent(baseTraceIds, 'gamemaster', 'npc_service__get_npc', 'tc-001');

      expect(event.type).toBe('tool_called');
      expect(event.traceIds.toolCallId).toBe('tc-001');
      expect(event.detail?.toolName).toBe('npc_service__get_npc');
      expect(event.detail?.toolCallId).toBe('tc-001');
    });

    it('preserves base traceIds while adding toolCallId', () => {
      const event = buildToolCalledEvent(baseTraceIds, 'gamemaster', 'tool', 'tc-002');

      expect(event.traceIds.requestId).toBe('req-001');
      expect(event.traceIds.agentRunId).toBe('gamemaster:uuid-001');
      expect(event.traceIds.toolCallId).toBe('tc-002');
    });
  });

  describe('buildToolReturnedEvent', () => {
    it('creates tool_returned event with success status', () => {
      const event = buildToolReturnedEvent(baseTraceIds, 'gamemaster', 'npc_service__get_npc', 'tc-001', true);

      expect(event.type).toBe('tool_returned');
      expect(event.traceIds.toolCallId).toBe('tc-001');
      expect(event.detail?.success).toBe(true);
      expect(event.summary).toContain('ok');
    });

    it('creates tool_returned event with error status', () => {
      const event = buildToolReturnedEvent(baseTraceIds, 'gamemaster', 'npc_service__get_npc', 'tc-001', false);

      expect(event.detail?.success).toBe(false);
      expect(event.summary).toContain('error');
    });
  });

  describe('buildAuditFinishedEvent', () => {
    it('creates audit_finished event with auditRoundId', () => {
      const event = buildAuditFinishedEvent(baseTraceIds, 'gamemaster', 'audit-001', true);

      expect(event.type).toBe('audit_finished');
      expect(event.traceIds.auditRoundId).toBe('audit-001');
      expect(event.detail?.passed).toBe(true);
      expect(event.summary).toContain('passed');
    });
  });

  describe('buildAgentFailedOrRecoveredEvent', () => {
    it('creates agent_failed_or_recovered event for failure', () => {
      const event = buildAgentFailedOrRecoveredEvent(baseTraceIds, 'gamemaster', 'timeout', false);

      expect(event.type).toBe('agent_failed_or_recovered');
      expect(event.detail?.recovered).toBe(false);
      expect(event.summary).toContain('failed');
    });

    it('creates agent_failed_or_recovered event for recovery', () => {
      const event = buildAgentFailedOrRecoveredEvent(baseTraceIds, 'gamemaster', 'timeout', true);

      expect(event.detail?.recovered).toBe(true);
      expect(event.summary).toContain('recovered');
    });
  });

  describe('buildTraceIds — progressive enrichment', () => {
    it('enriches traceIds with iterationId', () => {
      const enriched = buildTraceIds(baseTraceIds, { iterationId: 'iter-1' });

      expect(enriched.iterationId).toBe('iter-1');
      expect(enriched.requestId).toBe('req-001');
    });

    it('enriches traceIds with toolCallId', () => {
      const enriched = buildTraceIds(baseTraceIds, { toolCallId: 'tc-001' });

      expect(enriched.toolCallId).toBe('tc-001');
      expect(enriched.agentRunId).toBe('gamemaster:uuid-001');
    });

    it('enriches traceIds with auditRoundId', () => {
      const enriched = buildTraceIds(baseTraceIds, { auditRoundId: 'audit-001' });

      expect(enriched.auditRoundId).toBe('audit-001');
    });
  });
});
