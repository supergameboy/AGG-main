import express from 'express';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDevRoutes } from '../dev.js';
import { errorHandler } from '../../middlewares/errorhandler.js';
import { DevTraceCollector } from '../../services/DevTraceCollector.js';
import type { RuntimeEvent, ExecutionTraceIds } from '../../../../shared/src/types/execution-trace.js';

function makeTraceIds(overrides?: Partial<ExecutionTraceIds>): ExecutionTraceIds {
  return {
    requestId: 'req-001',
    sessionId: 'sess-001',
    agentRunId: 'run-001',
    agentDepth: 0,
    ...overrides,
  };
}

function makeRuntimeEvent(overrides?: Partial<RuntimeEvent>): RuntimeEvent {
  return {
    type: 'request_started',
    at: Date.now(),
    traceIds: makeTraceIds(),
    source: 'AgentRuntime',
    summary: 'Request started',
    ...overrides,
  };
}

describe('Dev API — runtime-events endpoint', () => {
  let db: Knex;
  let originalNodeEnv: string | undefined;

  beforeEach(async () => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await db.schema.createTable('dev_snapshots', (table) => {
      table.text('id').primary();
      table.text('type');
      table.text('data');
      table.text('store_names');
      table.text('session_id');
      table.integer('timestamp');
      table.integer('created_at');
    });
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    await db.destroy();
  });

  function createApp(devTraceCollector?: DevTraceCollector) {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/dev', createDevRoutes(db, undefined, undefined, undefined, devTraceCollector));
    app.use(errorHandler);
    return app;
  }

  it('returns 400 when saveId is missing', async () => {
    const collector = new DevTraceCollector();
    const app = createApp(collector);

    const res = await request(app).get('/api/v1/dev/runtime-events');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('returns 503 when DevTraceCollector is not available', async () => {
    const app = createApp(undefined);

    const res = await request(app).get('/api/v1/dev/runtime-events?saveId=save-1');

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('returns runtime events for a saveId', async () => {
    const collector = new DevTraceCollector();
    const event1 = makeRuntimeEvent({ type: 'request_started', summary: 'Request entered' });
    const event2 = makeRuntimeEvent({ type: 'snapshot_built', summary: 'Snapshot built' });
    collector.addRuntimeEvent('save-1', event1);
    collector.addRuntimeEvent('save-1', event2);

    const app = createApp(collector);
    const res = await request(app).get('/api/v1/dev/runtime-events?saveId=save-1');

    expect(res.status).toBe(200);
    expect(res.body.data.saveId).toBe('save-1');
    expect(res.body.data.events).toHaveLength(2);
    expect(res.body.data.events[0].type).toBe('request_started');
    expect(res.body.data.events[1].type).toBe('snapshot_built');
    expect(res.body.data.eventCount).toBe(2);
  });

  it('filters runtime events by type', async () => {
    const collector = new DevTraceCollector();
    collector.addRuntimeEvent('save-1', makeRuntimeEvent({ type: 'request_started' }));
    collector.addRuntimeEvent('save-1', makeRuntimeEvent({ type: 'tool_called' }));
    collector.addRuntimeEvent('save-1', makeRuntimeEvent({ type: 'tool_returned' }));

    const app = createApp(collector);
    const res = await request(app).get('/api/v1/dev/runtime-events?saveId=save-1&type=tool_called');

    expect(res.status).toBe(200);
    expect(res.body.data.events).toHaveLength(1);
    expect(res.body.data.events[0].type).toBe('tool_called');
  });

  it('filters runtime events by requestId', async () => {
    const collector = new DevTraceCollector();
    const traceIdsA = makeTraceIds({ requestId: 'req-A' });
    const traceIdsB = makeTraceIds({ requestId: 'req-B' });
    collector.addRuntimeEvent('save-1', makeRuntimeEvent({ traceIds: traceIdsA, type: 'request_started' }));
    collector.addRuntimeEvent('save-1', makeRuntimeEvent({ traceIds: traceIdsB, type: 'request_started' }));
    collector.addRuntimeEvent('save-1', makeRuntimeEvent({ traceIds: traceIdsA, type: 'tool_called' }));

    const app = createApp(collector);
    const res = await request(app).get('/api/v1/dev/runtime-events?saveId=save-1&requestId=req-A');

    expect(res.status).toBe(200);
    expect(res.body.data.events).toHaveLength(2);
    expect(res.body.data.events.every((e: RuntimeEvent) => e.traceIds.requestId === 'req-A')).toBe(true);
  });

  it('respects limit parameter', async () => {
    const collector = new DevTraceCollector();
    for (let i = 0; i < 10; i++) {
      collector.addRuntimeEvent('save-1', makeRuntimeEvent({ summary: `Event ${i}` }));
    }

    const app = createApp(collector);
    const res = await request(app).get('/api/v1/dev/runtime-events?saveId=save-1&limit=3');

    expect(res.status).toBe(200);
    expect(res.body.data.events).toHaveLength(3);
  });

  it('returns empty events for saveId with no data', async () => {
    const collector = new DevTraceCollector();

    const app = createApp(collector);
    const res = await request(app).get('/api/v1/dev/runtime-events?saveId=save-empty');

    expect(res.status).toBe(200);
    expect(res.body.data.events).toHaveLength(0);
    expect(res.body.data.eventCount).toBe(0);
  });

  it('returns event with full traceIds structure', async () => {
    const collector = new DevTraceCollector();
    const fullTraceIds: ExecutionTraceIds = {
      requestId: 'req-full',
      sessionId: 'sess-full',
      agentRunId: 'run-full',
      agentDepth: 0,
      iterationId: 'iter-1',
      toolCallId: 'tool-1',
      auditRoundId: 'audit-1',
    };
    collector.addRuntimeEvent('save-1', makeRuntimeEvent({
      traceIds: fullTraceIds,
      type: 'tool_called',
      summary: 'Tool called with full trace',
      detail: { toolName: 'map_service__get_current_top_location' },
    }));

    const app = createApp(collector);
    const res = await request(app).get('/api/v1/dev/runtime-events?saveId=save-1');

    expect(res.status).toBe(200);
    const event = res.body.data.events[0];
    expect(event.traceIds.requestId).toBe('req-full');
    expect(event.traceIds.agentRunId).toBe('run-full');
    expect(event.traceIds.iterationId).toBe('iter-1');
    expect(event.traceIds.toolCallId).toBe('tool-1');
    expect(event.traceIds.auditRoundId).toBe('audit-1');
    expect(event.detail.toolName).toBe('map_service__get_current_top_location');
  });

  it('combines type and requestId filters', async () => {
    const collector = new DevTraceCollector();
    const traceIdsA = makeTraceIds({ requestId: 'req-A' });
    const traceIdsB = makeTraceIds({ requestId: 'req-B' });
    collector.addRuntimeEvent('save-1', makeRuntimeEvent({ traceIds: traceIdsA, type: 'request_started' }));
    collector.addRuntimeEvent('save-1', makeRuntimeEvent({ traceIds: traceIdsA, type: 'tool_called' }));
    collector.addRuntimeEvent('save-1', makeRuntimeEvent({ traceIds: traceIdsB, type: 'tool_called' }));

    const app = createApp(collector);
    const res = await request(app).get('/api/v1/dev/runtime-events?saveId=save-1&requestId=req-A&type=tool_called');

    expect(res.status).toBe(200);
    expect(res.body.data.events).toHaveLength(1);
    expect(res.body.data.events[0].type).toBe('tool_called');
    expect(res.body.data.events[0].traceIds.requestId).toBe('req-A');
  });
});
