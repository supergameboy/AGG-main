export const RUNTIME_EVENT_TYPES = [
  'request_started',
  'snapshot_built',
  'prompt_built',
  'tool_exposed',
  'tool_called',
  'tool_returned',
  'audit_finished',
  'agent_failed_or_recovered',
] as const;

export type RuntimeEventType = (typeof RUNTIME_EVENT_TYPES)[number];

export interface ExecutionTraceIds {
  requestId: string;
  sessionId: string;
  agentRunId: string;
  parentAgentRunId?: string;
  agentDepth: number;
  iterationId?: string;
  toolCallId?: string;
  commandId?: string;
  eventId?: string;
  auditRoundId?: string;
}

export interface RuntimeEvent {
  type: RuntimeEventType;
  at: number;
  traceIds: ExecutionTraceIds;
  source: string;
  summary: string;
  detail?: Record<string, unknown>;
}
