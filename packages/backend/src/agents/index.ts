export { BaseAgent } from './BaseAgent.js';
export { AgentRuntime } from './AgentRuntime.js';
export { ToolRegistry } from './ToolRegistry.js';
export { AgentFactory } from './AgentFactory.js';
export { initializeAgentSystem } from './init.js';
export type { AgentSystemInitResult } from './init.js';

export type {
  AgentResponse,
  AgentConfig,
  ScheduleRequest,
  CoordinationRequest,
  LLMResponse,
  LLMOptions
} from './types.js';

export {
  AgentStatus,
  AGENT_DEFAULT_CONFIG
} from './types.js';

export type {
  ToolMethod,
  ToolContext,
  ToolResponse,
  ToolDefinition,
  ToolPermission
} from '@ai-rpg/shared/types/tool';
