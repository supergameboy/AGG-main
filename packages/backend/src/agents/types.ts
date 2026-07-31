import { ID, JSONValue } from '../../../shared/src/types/core';
import { AgentType } from '../../../shared/src/types/agent';
// import { DEFAULT_TIMEOUT_MS } from '../utils/config.js'; // 超时已禁用
import type { ToolType } from '../../../shared/src/types/agent';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
// v2.7: type-only imports from game-systems/，符合"零 value import game-systems/"规则
import type { GameTime, TimeAdvanceParams, TimePassageResult } from '../game-systems/time/types';
// 模块2 简化：IEntityGraphAuditor 已删除（EntityGraphAuditor 审计闭环已删除）

// AgentResponse + GameResponseData 已迁移到 shared/src/types/agent.ts（Phase 4 模块D 统一收敛）
// 此处 re-export 保持 agents 模块内聚，15+ 处消费方零改动
export type { AgentResponse, GameResponseData } from '@ai-rpg/shared/types/agent';

export interface AgentConfig {
  type: AgentType;
  name: string;
  systemPrompt: string;
  maxRetries?: number;
  timeout?: number;
  enableToolCalling?: boolean;
}

export interface ScheduleRequest {
  saveId: ID;
  agentType: AgentType;
  action: string;
  input: JSONValue;
  priority?: 'low' | 'normal' | 'high';
  delay?: number;
}

export interface CoordinationRequest {
  fromAgent: AgentType;
  toAgent: AgentType | AgentType[];
  action: string;
  data: unknown;
  priority?: 'low' | 'normal' | 'high';
  requiresResponse?: boolean;
  timeout?: number;
}

export interface LLMResponse {
  success: boolean;
  content?: string;
  reasoningContent?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    promptCacheHitTokens?: number;
    promptCacheMissTokens?: number;
  };
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  loggingMetadata?: {
    stage?: string;
    prefixHash?: string;
    cacheStrategy?: string;
    reactIterations?: number;
    toolCallsCount?: number;
  };
}

export enum AgentStatus {
  IDLE = 'idle',
  PROCESSING = 'processing',
  ERROR = 'error'
}

// export const DEFAULT_AGENT_TIMEOUT = DEFAULT_TIMEOUT_MS;
export const DEFAULT_AGENT_TIMEOUT = 0; // 超时已禁用

export const AGENT_DEFAULT_CONFIG: Required<Omit<AgentConfig, 'type' | 'name' | 'systemPrompt'>> = {
  maxRetries: 3,
  timeout: DEFAULT_AGENT_TIMEOUT,
  enableToolCalling: true
};

export interface AgentCapability {
  agentType: string;
  description: string;
  whenToInvoke: string;
  supportedIntents: string[];
  requiredFields: string[];
  optionalFields: string[];
}

// ActionHandler 已迁移到 shared/src/types/tool.ts（Phase 4 模块D 统一收敛）
// 此处 re-export 保持 agents 模块内聚
export type { ActionHandler } from '@ai-rpg/shared/types/tool';

/**
 * Agent 通过此接口调用工具，不直接依赖 ToolRegistry 具体实现。
 * 签名与 ToolRegistry.execute 一致，ToolCallerImpl 是薄包装。
 */
export interface ToolCaller {
  execute(
    agentType: string,
    toolType: ToolType,
    method: string,
    params: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResponse>;
}

/**
 * GameTimeService 接口：仅暴露 GM Agent 内部需要的时间查询与推进方法。
 *
 * ResponseBuilder 调用（非 LLM 工具调用）：
 * - advanceTime: 按动作类型推进游戏时间
 * - getCurrentTime: 获取当前游戏时间（天/小时/分钟/时段/季节）
 *
 * 实现：game-systems/time/GameTimeService.ts（结构类型匹配，不显式 implements）
 * 注入：init.ts 创建 GameTimeService 实例，通过 createGMAgentDeps → ResponseBuilder 构造函数注入
 */
export interface IGameTimeService {
  advanceTime(saveId: ID, params: TimeAdvanceParams): Promise<TimePassageResult>;
  getCurrentTime(saveId: ID): Promise<GameTime>;
}

export let AGENT_CAPABILITIES_DECLARATION: Record<string, AgentCapability> = {};

export function updateCapabilitiesFromConfig(capabilities: Record<string, AgentCapability>): void {
    for (const [key, cap] of Object.entries(capabilities)) {
        const existing = AGENT_CAPABILITIES_DECLARATION[key];
        if (existing) {
            // Merge supportedIntents, deduplicate
            const mergedIntents = [...new Set([...existing.supportedIntents, ...cap.supportedIntents])];
            existing.supportedIntents = mergedIntents;
            // Preserve first non-empty whenToInvoke
            if (!existing.whenToInvoke && cap.whenToInvoke) {
                existing.whenToInvoke = cap.whenToInvoke;
            }
        } else {
            AGENT_CAPABILITIES_DECLARATION[key] = cap;
        }
    }
}
