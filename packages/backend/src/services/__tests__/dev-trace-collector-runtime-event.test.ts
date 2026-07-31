import { describe, it, expect, beforeEach } from 'vitest';
import { DevTraceCollector } from '../DevTraceCollector.js';
import type { RuntimeEvent, ExecutionTraceIds } from '../../../../shared/src/types/execution-trace.js';

function makeTraceIds(overrides?: Partial<ExecutionTraceIds>): ExecutionTraceIds {
  return {
    requestId: 'req-001',
    sessionId: 'save-001',
    agentRunId: 'gamemaster:uuid-001',
    agentDepth: 0,
    ...overrides,
  };
}

function makeRuntimeEvent(overrides?: Partial<RuntimeEvent>): RuntimeEvent {
  return {
    type: 'request_started',
    at: Date.now(),
    traceIds: makeTraceIds(),
    source: 'gamemaster',
    summary: 'Request started',
    ...overrides,
  };
}

describe('DevTraceCollector — RuntimeEvent', () => {
  let collector: DevTraceCollector;

  beforeEach(() => {
    collector = new DevTraceCollector();
  });

  describe('addRuntimeEvent', () => {
    it('stores a runtime event for a saveId', () => {
      const event = makeRuntimeEvent();
      collector.addRuntimeEvent('save-001', event);

      const events = collector.getRuntimeEvents('save-001');
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(event);
    });

    it('stores multiple runtime events for the same saveId', () => {
      collector.addRuntimeEvent('save-001', makeRuntimeEvent({ type: 'request_started' }));
      collector.addRuntimeEvent('save-001', makeRuntimeEvent({ type: 'prompt_built' }));
      collector.addRuntimeEvent('save-001', makeRuntimeEvent({ type: 'tool_called' }));

      const events = collector.getRuntimeEvents('save-001');
      expect(events).toHaveLength(3);
      expect(events[0].type).toBe('request_started');
      expect(events[1].type).toBe('prompt_built');
      expect(events[2].type).toBe('tool_called');
    });

    it('isolates runtime events across different saveIds', () => {
      collector.addRuntimeEvent('save-001', makeRuntimeEvent({ traceIds: makeTraceIds({ requestId: 'req-A' }) }));
      collector.addRuntimeEvent('save-002', makeRuntimeEvent({ traceIds: makeTraceIds({ requestId: 'req-B' }) }));

      expect(collector.getRuntimeEvents('save-001')).toHaveLength(1);
      expect(collector.getRuntimeEvents('save-002')).toHaveLength(1);
      expect(collector.getRuntimeEvents('save-001')[0].traceIds.requestId).toBe('req-A');
      expect(collector.getRuntimeEvents('save-002')[0].traceIds.requestId).toBe('req-B');
    });

    it('returns empty array for saveId with no runtime events', () => {
      expect(collector.getRuntimeEvents('nonexistent')).toEqual([]);
    });
  });

  describe('getRuntimeEvents — type filter', () => {
    it('filters runtime events by type', () => {
      collector.addRuntimeEvent('save-001', makeRuntimeEvent({ type: 'request_started' }));
      collector.addRuntimeEvent('save-001', makeRuntimeEvent({ type: 'tool_called' }));
      collector.addRuntimeEvent('save-001', makeRuntimeEvent({ type: 'tool_called' }));
      collector.addRuntimeEvent('save-001', makeRuntimeEvent({ type: 'tool_returned' }));

      const toolCalledEvents = collector.getRuntimeEvents('save-001', 'tool_called');
      expect(toolCalledEvents).toHaveLength(2);
      expect(toolCalledEvents.every(e => e.type === 'tool_called')).toBe(true);
    });

    it('returns all events when type is not specified', () => {
      collector.addRuntimeEvent('save-001', makeRuntimeEvent({ type: 'request_started' }));
      collector.addRuntimeEvent('save-001', makeRuntimeEvent({ type: 'tool_called' }));

      const allEvents = collector.getRuntimeEvents('save-001');
      expect(allEvents).toHaveLength(2);
    });
  });

  describe('getRuntimeEvents — limit', () => {
    it('respects limit parameter returning most recent events', () => {
      for (let i = 0; i < 10; i++) {
        collector.addRuntimeEvent('save-001', makeRuntimeEvent({
          type: 'tool_called',
          summary: `Tool call ${i}`,
          at: 1000 + i,
        }));
      }

      const limited = collector.getRuntimeEvents('save-001', undefined, 3);
      expect(limited).toHaveLength(3);
      expect(limited[0].summary).toBe('Tool call 7');
      expect(limited[1].summary).toBe('Tool call 8');
      expect(limited[2].summary).toBe('Tool call 9');
    });

    it('defaults limit to 50', () => {
      for (let i = 0; i < 60; i++) {
        collector.addRuntimeEvent('save-001', makeRuntimeEvent({ summary: `Event ${i}` }));
      }

      const events = collector.getRuntimeEvents('save-001');
      expect(events).toHaveLength(50);
    });
  });

  describe('getRuntimeEvents — requestId index', () => {
    it('queries runtime events by requestId', () => {
      collector.addRuntimeEvent('save-001', makeRuntimeEvent({
        traceIds: makeTraceIds({ requestId: 'req-A' }),
        type: 'request_started',
      }));
      collector.addRuntimeEvent('save-001', makeRuntimeEvent({
        traceIds: makeTraceIds({ requestId: 'req-A' }),
        type: 'tool_called',
      }));
      collector.addRuntimeEvent('save-001', makeRuntimeEvent({
        traceIds: makeTraceIds({ requestId: 'req-B' }),
        type: 'request_started',
      }));

      const reqAEvents = collector.getRuntimeEventsByRequestId('save-001', 'req-A');
      expect(reqAEvents).toHaveLength(2);
      expect(reqAEvents.every(e => e.traceIds.requestId === 'req-A')).toBe(true);

      const reqBEvents = collector.getRuntimeEventsByRequestId('save-001', 'req-B');
      expect(reqBEvents).toHaveLength(1);
    });

    it('returns empty array for non-existent requestId', () => {
      collector.addRuntimeEvent('save-001', makeRuntimeEvent());
      expect(collector.getRuntimeEventsByRequestId('save-001', 'nonexistent')).toEqual([]);
    });
  });

  describe('backward compatibility', () => {
    it('existing addTrace/getTraces still work', () => {
      collector.addTrace('save-001', {
        type: 'staging_write',
        data: { table: 'npcs', operation: 'insert' },
        timestamp: Date.now(),
      });

      const traces = collector.getTraces('save-001');
      expect(traces).toHaveLength(1);
      expect(traces[0].type).toBe('staging_write');
    });

    it('runtime events do not interfere with legacy traces', () => {
      collector.addTrace('save-001', {
        type: 'staging_write',
        data: { table: 'npcs' },
        timestamp: Date.now(),
      });
      collector.addRuntimeEvent('save-001', makeRuntimeEvent());

      const traces = collector.getTraces('save-001');
      expect(traces).toHaveLength(1);
      expect(traces[0].type).toBe('staging_write');

      const events = collector.getRuntimeEvents('save-001');
      expect(events).toHaveLength(1);
    });
  });

  describe('capacity management', () => {
    it('evicts oldest runtime events when exceeding max capacity', () => {
      for (let i = 0; i < 120; i++) {
        collector.addRuntimeEvent('save-001', makeRuntimeEvent({
          summary: `Event ${i}`,
          at: 1000 + i,
        }));
      }

      const events = collector.getRuntimeEvents('save-001', undefined, 200);
      expect(events).toHaveLength(100);
      expect(events[0].summary).toBe('Event 20');
      expect(events[events.length - 1].summary).toBe('Event 119');
    });
  });

  describe('clearTraces clears runtime events too', () => {
    it('clears both legacy traces and runtime events', () => {
      collector.addTrace('save-001', {
        type: 'staging_write',
        data: {},
        timestamp: Date.now(),
      });
      collector.addRuntimeEvent('save-001', makeRuntimeEvent());

      collector.clearTraces('save-001');

      expect(collector.getTraces('save-001')).toHaveLength(0);
      expect(collector.getRuntimeEvents('save-001')).toHaveLength(0);
    });
  });
});
