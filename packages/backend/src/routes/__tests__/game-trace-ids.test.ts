import { describe, it, expect } from 'vitest';
import type { ExecutionTraceIds } from '../../../../shared/src/types/execution-trace.js';

/**
 * 纯函数测试：验证 buildRequestTraceIds 的逻辑正确性。
 * 该函数从 game.ts 提取，用于在请求入口创建 ExecutionTraceIds。
 */
function buildRequestTraceIds(requestId: string | undefined, saveId: string): ExecutionTraceIds {
  return {
    requestId: requestId ?? 'unknown',
    sessionId: saveId,
    agentRunId: '', // 由 ReActAgent 填充
    agentDepth: 0, // 请求入口为 GM 层级
  };
}

describe('buildRequestTraceIds', () => {
  it('creates trace ids with requestId and sessionId', () => {
    const traceIds = buildRequestTraceIds('req-123', 'save-456');

    expect(traceIds.requestId).toBe('req-123');
    expect(traceIds.sessionId).toBe('save-456');
    expect(traceIds.agentRunId).toBe('');
  });

  it('falls back requestId to "unknown" when undefined', () => {
    const traceIds = buildRequestTraceIds(undefined, 'save-456');

    expect(traceIds.requestId).toBe('unknown');
    expect(traceIds.sessionId).toBe('save-456');
  });

  it('uses saveId as sessionId', () => {
    const traceIds = buildRequestTraceIds('req-1', 'my-save-id');

    expect(traceIds.sessionId).toBe('my-save-id');
  });

  it('agentRunId is empty — filled by ReActAgent', () => {
    const traceIds = buildRequestTraceIds('req-1', 'save-1');

    expect(traceIds.agentRunId).toBe('');
    expect(traceIds.iterationId).toBeUndefined();
    expect(traceIds.toolCallId).toBeUndefined();
    expect(traceIds.auditRoundId).toBeUndefined();
  });
});

describe('RequestContext traceIds integration', () => {
  it('traceIds field is compatible with Partial<ExecutionTraceIds>', () => {
    // 验证 RequestContext 的 traceIds 字段类型
    const reqCtx = {
      intentHint: 'chat',
      traceIds: {
        requestId: 'req-1',
        sessionId: 'save-1',
      } as Partial<ExecutionTraceIds>,
    };

    expect(reqCtx.traceIds.requestId).toBe('req-1');
    expect(reqCtx.traceIds.sessionId).toBe('save-1');
    expect(reqCtx.traceIds.agentRunId).toBeUndefined();
  });

  it('traceIds can be progressively enriched by ReActAgent', () => {
    const traceIds: Partial<ExecutionTraceIds> = {
      requestId: 'req-1',
      sessionId: 'save-1',
    };

    // ReActAgent enriches
    traceIds.agentRunId = 'gamemaster:uuid-001';
    traceIds.iterationId = 'iter-1';
    traceIds.toolCallId = 'tc-1';

    expect(traceIds.agentRunId).toBe('gamemaster:uuid-001');
    expect(traceIds.iterationId).toBe('iter-1');
    expect(traceIds.toolCallId).toBe('tc-1');
  });
});
