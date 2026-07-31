import { createChildLogger } from '../utils/logger.js';
import type { RuntimeEvent } from '../../../shared/src/types/execution-trace.js';

const logger = createChildLogger('dev-trace-collector');

export interface TraceEntry {
  type: 'staging_write' | 'staging_commit' | 'event_bus_publish' | 'audit_decision' | 'graph_change' | 'story_post_react' | 'runtime_snapshot' | 'llm_debug'
    // M9 LLMRequestDispatcher 调度事件
    | 'dispatcher_request_start' | 'dispatcher_key_selected' | 'dispatcher_token_acquired'
    | 'dispatcher_cooldown_triggered' | 'dispatcher_key_failed' | 'dispatcher_request_end';
  data: Record<string, unknown>;
  timestamp: number;
}

export class DevTraceCollector {
  private traces = new Map<string, TraceEntry[]>();
  private runtimeEvents = new Map<string, RuntimeEvent[]>();
  private readonly MAX_ENTRIES = 100;
  private readonly MAX_RUNTIME_EVENTS = 100;

  addTrace(saveId: string, entry: TraceEntry): void {
    if (!this.traces.has(saveId)) this.traces.set(saveId, []);
    const entries = this.traces.get(saveId)!;
    entries.push(entry);
    if (entries.length > this.MAX_ENTRIES) entries.shift();
  }

  getTraces(saveId: string, type?: TraceEntry['type'], limit = 50): TraceEntry[] {
    const entries = this.traces.get(saveId) ?? [];
    const filtered = type ? entries.filter(e => e.type === type) : entries;
    return filtered.slice(-limit);
  }

  addRuntimeEvent(saveId: string, event: RuntimeEvent): void {
    if (!this.runtimeEvents.has(saveId)) this.runtimeEvents.set(saveId, []);
    const events = this.runtimeEvents.get(saveId)!;
    events.push(event);
    if (events.length > this.MAX_RUNTIME_EVENTS) events.shift();
  }

  getRuntimeEvents(saveId: string, type?: RuntimeEvent['type'], limit = 50): RuntimeEvent[] {
    const events = this.runtimeEvents.get(saveId) ?? [];
    const filtered = type ? events.filter(e => e.type === type) : events;
    return filtered.slice(-limit);
  }

  getRuntimeEventsByRequestId(saveId: string, requestId: string): RuntimeEvent[] {
    const events = this.runtimeEvents.get(saveId) ?? [];
    return events.filter(e => e.traceIds.requestId === requestId);
  }

  clearTraces(saveId: string): void {
    this.traces.delete(saveId);
    this.runtimeEvents.delete(saveId);
    logger.info('Traces cleared', { saveId });
  }

  getSaveIds(): string[] {
    const allIds = new Set([...this.traces.keys(), ...this.runtimeEvents.keys()]);
    return [...allIds];
  }
}

/** Global singleton — only instantiated when DEV_MODE is enabled */
let _instance: DevTraceCollector | null = null;

export function getDevTraceCollector(): DevTraceCollector | null {
  return _instance;
}

export function initDevTraceCollector(): DevTraceCollector {
  if (!_instance) {
    _instance = new DevTraceCollector();
    logger.info('DevTraceCollector initialized');
  }
  return _instance;
}
