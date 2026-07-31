import { describe, it, expect } from 'vitest';
import type {
  ExecutionTraceIds,
  RuntimeEventType,
  RuntimeEvent,
} from '../execution-trace';
import {
  RUNTIME_EVENT_TYPES,
} from '../execution-trace';

describe('ExecutionTraceIds', () => {
  it('requires requestId, sessionId, agentRunId, agentDepth', () => {
    const trace: ExecutionTraceIds = {
      requestId: 'req-001',
      sessionId: 'sess-001',
      agentRunId: 'run-001',
      agentDepth: 0,
    };
    expect(trace.requestId).toBe('req-001');
    expect(trace.sessionId).toBe('sess-001');
    expect(trace.agentRunId).toBe('run-001');
    expect(trace.agentDepth).toBe(0);
  });

  it('allows optional fields', () => {
    const trace: ExecutionTraceIds = {
      requestId: 'req-001',
      sessionId: 'sess-001',
      agentRunId: 'run-001',
      agentDepth: 1,
      parentAgentRunId: 'parent-run-001',
      iterationId: 'iter-001',
      toolCallId: 'tool-001',
      commandId: 'cmd-001',
      eventId: 'evt-001',
      auditRoundId: 'audit-001',
    };
    expect(trace.agentDepth).toBe(1);
    expect(trace.parentAgentRunId).toBe('parent-run-001');
    expect(trace.iterationId).toBe('iter-001');
    expect(trace.toolCallId).toBe('tool-001');
    expect(trace.commandId).toBe('cmd-001');
    expect(trace.eventId).toBe('evt-001');
    expect(trace.auditRoundId).toBe('audit-001');
  });

  it('agentDepth represents GM(0) → 子Agent(1) hierarchy', () => {
    const gmTrace: ExecutionTraceIds = {
      requestId: 'req-001',
      sessionId: 'sess-001',
      agentRunId: 'gm-run-001',
      agentDepth: 0,
    };
    const subAgentTrace: ExecutionTraceIds = {
      requestId: 'req-001',
      sessionId: 'sess-001',
      agentRunId: 'sub-run-001',
      agentDepth: 1,
      parentAgentRunId: 'gm-run-001',
    };
    expect(gmTrace.agentDepth).toBe(0);
    expect(subAgentTrace.agentDepth).toBe(1);
    expect(subAgentTrace.agentDepth).toBeGreaterThan(gmTrace.agentDepth);
  });
});

describe('RuntimeEventType', () => {
  it('contains exactly 8 event types', () => {
    expect(RUNTIME_EVENT_TYPES).toHaveLength(8);
  });

  it('includes request_started', () => {
    expect(RUNTIME_EVENT_TYPES).toContain('request_started');
  });

  it('includes snapshot_built', () => {
    expect(RUNTIME_EVENT_TYPES).toContain('snapshot_built');
  });

  it('includes prompt_built', () => {
    expect(RUNTIME_EVENT_TYPES).toContain('prompt_built');
  });

  it('includes tool_exposed', () => {
    expect(RUNTIME_EVENT_TYPES).toContain('tool_exposed');
  });

  it('includes tool_called', () => {
    expect(RUNTIME_EVENT_TYPES).toContain('tool_called');
  });

  it('includes tool_returned', () => {
    expect(RUNTIME_EVENT_TYPES).toContain('tool_returned');
  });

  it('includes audit_finished', () => {
    expect(RUNTIME_EVENT_TYPES).toContain('audit_finished');
  });

  it('includes agent_failed_or_recovered', () => {
    expect(RUNTIME_EVENT_TYPES).toContain('agent_failed_or_recovered');
  });

  it('RuntimeEventType derives from RUNTIME_EVENT_TYPES', () => {
    const type: RuntimeEventType = 'request_started';
    expect(type).toBe('request_started');
  });
});

describe('RuntimeEvent', () => {
  it('requires type, at, traceIds, source, summary', () => {
    const event: RuntimeEvent = {
      type: 'request_started',
      at: Date.now(),
      traceIds: {
        requestId: 'req-001',
        sessionId: 'sess-001',
        agentRunId: 'run-001',
        agentDepth: 0,
      },
      source: 'CoordinatorAgent',
      summary: 'Request entered backend',
    };
    expect(event.type).toBe('request_started');
    expect(typeof event.at).toBe('number');
    expect(event.traceIds.requestId).toBe('req-001');
    expect(event.source).toBe('CoordinatorAgent');
    expect(event.summary).toBe('Request entered backend');
  });

  it('allows optional detail', () => {
    const event: RuntimeEvent = {
      type: 'tool_called',
      at: Date.now(),
      traceIds: {
        requestId: 'req-001',
        sessionId: 'sess-001',
        agentRunId: 'run-001',
        agentDepth: 0,
        toolCallId: 'tc-001',
      },
      source: 'ReActAgent',
      summary: 'Called combat_service.execute_turn',
      detail: {
        toolType: 'combat_service',
        method: 'execute_turn',
        params: { target: 'goblin' },
      },
    };
    expect(event.detail).toBeDefined();
    expect(event.detail?.toolType).toBe('combat_service');
  });
});
