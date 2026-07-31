import { BaseTool } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse, IRequestScope } from '@ai-rpg/shared/types/tool';
import { ToolType, type AgentType, type TaskReport } from '../../../../shared/src/types/agent.js';
import type { BaseAgent } from '../../agents/BaseAgent.js';
import type { ContextInjector, ContextFetchFn } from '../../services/context-injector.js';
import type { GameDataExpander } from '../../services/game-data-expander.js';
import type { ContextManifest, ExpandContext } from '../../../../shared/src/types/context-manifest.js';
import type { DedupService } from '../../game-systems/dispatch/DedupService.js';
import { buildDispatchKey, extractTaskHash } from '@ai-rpg/shared/utils/dispatch-key';
import type { ID, Timestamp } from '../../../../shared/src/types/core.js';
import type { AgentHookPoliciesConfig } from '../../../../shared/src/types/agent-config.js';
import type { ExecutionTraceIds } from '../../../../shared/src/types/execution-trace.js';
import { randomUUID } from 'crypto';
import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import { deriveChildRuntimeSnapshot } from '../runtime/derive-child-runtime-snapshot.js';
import type { AgentRuntimeSnapshot } from '../runtime/agent-runtime-snapshot.js';
import type { StagingPool } from '../../services/StagingPool.js';
import type { ShadowStateLayer } from '../../services/ShadowStateLayer.js';
import { buildTaskNodeId } from '@ai-rpg/shared';
import type { TaskContract } from '../../../../shared/src/types/audit.js';
import type { IPanelUpdateBroadcaster, TriggeredOp } from '@ai-rpg/shared/messaging';
import type { PanelUpdates } from '@ai-rpg/shared';

const logger = createChildLogger('coordinator-service');

const MAX_TASK_DESCRIPTION_LENGTH = 50;

/** 最大 Agent 递归深度：GM(0) → 子Agent(1)，子 Agent 不能再 spawn */
const MAX_AGENT_DEPTH = 1;

/**
 * 检查递归深度：当前 depth >= MAX_AGENT_DEPTH 时拒绝 spawn。
 * 核心防线：即使权限配置错误，也能阻止无限递归。
 */
function checkRecursionDepth(traceIds: Partial<ExecutionTraceIds> | undefined): {
  allowed: boolean;
  currentDepth: number;
  maxDepth: number;
} {
  const currentDepth = traceIds?.agentDepth ?? 0;
  return {
    allowed: currentDepth < MAX_AGENT_DEPTH,
    currentDepth,
    maxDepth: MAX_AGENT_DEPTH,
  };
}

/**
 * Agent 间 wave 依赖关系：A → B 表示 A 必须在 B 之后的 wave 执行。
 * 用于初始化场景的批量调度顺序校验，避免 LLM 派发顺序颠倒导致下游 Agent 找不到上游产物。
 * - quest 依赖 npc_party：quest 引用 NPC（如任务发放者），必须在 npc_party 创建 NPC 之后执行。
 */
const AGENT_WAVE_DEPENDENCIES: Record<string, string[]> = {
  quest: ['npc_party'],
  // npc 必须在 map 之后的 wave（NPC 创建需要引用 map 产出的地点 ID）
  npc_party: ['map'],
};

function validateWaveOrder(
  waveGroups: Array<{ wave: number; agents: Array<{ agent_type: string }> }>,
): { valid: boolean; violations: string[] } {
  // 记录每个 agent_type 出现的 wave 编号（取最早出现的 wave）
  const agentEarliestWave = new Map<string, number>();
  for (const group of waveGroups) {
    for (const agent of group.agents) {
      if (!agentEarliestWave.has(agent.agent_type)) {
        agentEarliestWave.set(agent.agent_type, group.wave);
      }
    }
  }

  const violations: string[] = [];
  for (const [agent, deps] of Object.entries(AGENT_WAVE_DEPENDENCIES)) {
    const agentWave = agentEarliestWave.get(agent);
    if (agentWave === undefined) continue;
    for (const dep of deps) {
      const depWave = agentEarliestWave.get(dep);
      if (depWave === undefined) continue; // 依赖未在本次调度中出现，跳过
      if (agentWave <= depWave) {
        violations.push(
          `${agent} (wave ${agentWave}) 必须在 ${dep} (wave ${depWave}) 之后执行。` +
          `正确顺序：${dep} 在更早的 wave，${agent} 在更晚的 wave。`,
        );
      }
    }
  }
  return { valid: violations.length === 0, violations };
}

type HookPolicyAwareAgent = BaseAgent & {
  getHookPolicies?: () => AgentHookPoliciesConfig | undefined;
  applyHookPolicies?: (policies?: AgentHookPoliciesConfig) => void;
};

function isHookPolicyAwareAgent(agent: BaseAgent | undefined | null): agent is HookPolicyAwareAgent {
  return Boolean(agent)
    && typeof (agent as HookPolicyAwareAgent).getHookPolicies === 'function'
    && typeof (agent as HookPolicyAwareAgent).applyHookPolicies === 'function';
}

function deriveChildHookPolicies(
  parentPolicies?: AgentHookPoliciesConfig,
  childPolicies?: AgentHookPoliciesConfig,
): AgentHookPoliciesConfig | undefined {
  const disable = Array.from(new Set([
    ...(parentPolicies?.disable ?? []),
    ...(childPolicies?.disable ?? []),
  ]));

  const recovery = {
    enableReadonlyDegrade: childPolicies?.recovery?.enableReadonlyDegrade
      ?? parentPolicies?.recovery?.enableReadonlyDegrade,
    enableFallbackAgent: childPolicies?.recovery?.enableFallbackAgent
      ?? parentPolicies?.recovery?.enableFallbackAgent,
    enableHelpReload: childPolicies?.recovery?.enableHelpReload
      ?? parentPolicies?.recovery?.enableHelpReload,
    enableStableModelRetry: childPolicies?.recovery?.enableStableModelRetry
      ?? parentPolicies?.recovery?.enableStableModelRetry,
    maxAttempts: childPolicies?.recovery?.maxAttempts
      ?? parentPolicies?.recovery?.maxAttempts,
  };

  const hasRecoveryPolicy = Object.values(recovery).some(value => value !== undefined);
  if (disable.length === 0 && !hasRecoveryPolicy) {
    return undefined;
  }

  return {
    ...(disable.length > 0 ? { disable } : {}),
    ...(hasRecoveryPolicy ? { recovery } : {}),
  };
}

export class CoordinatorServiceTool extends BaseTool {
  private agentRegistry: Map<AgentType, BaseAgent> | null = null;
  private contextInjector: ContextInjector;
  private gameDataExpander: GameDataExpander | null = null;
  private expandContextBuilder: ((saveId: ID, templateId: string) => ExpandContext) | null = null;
  private dedupService: DedupService | null = null;
  /**
   * 统一面板变更推送机制新增：panelUpdateBroadcaster 实例。
   * batch_spawn_agents handler 完成后调用 pushPanelUpdates 主动补推子 Agent 写入的面板数据。
   * 由 init.ts 组合根调用 setPanelUpdateBroadcaster 注入。
   */
  private panelUpdateBroadcaster: IPanelUpdateBroadcaster | null = null;

  constructor(contextInjector: ContextInjector) {
    super(
      'coordinator_service' as ToolType,
      'Coordinator Service',
      '主Agent专用服务 - 调度子Agent执行领域任务',
      '1.0.0'
    );

    this.contextInjector = contextInjector;
    this.registerMethods();
  }

  setAgentRegistry(agentRegistry: Map<AgentType, BaseAgent>): void {
    this.agentRegistry = agentRegistry;
  }

  /**
   * 设置 GameDataExpander 和 ExpandContext 构建器（方案L manifest 路径）。
   * 由 init.ts 组合根在构建 DataProviders 实现后调用。
   * 未调用时 manifest 路径降级为纯 v1 rules 路径（向后兼容）。
   */
  setGameDataExpander(expander: GameDataExpander, contextBuilder: (saveId: ID, templateId: string) => ExpandContext): void {
    this.gameDataExpander = expander;
    this.expandContextBuilder = contextBuilder;
  }

  /**
   * 设置 DedupService（方案I 去重持久化）。
   * 由 init.ts 组合根在创建 DispatchLogRepository 后调用。
   * 未调用时去重检查降级为跳过（向后兼容）。
   */
  setDedupService(dedupService: DedupService): void {
    this.dedupService = dedupService;
  }

  /**
   * 设置 PanelUpdateBroadcaster（统一面板变更推送机制）。
   * 由 init.ts 组合根在创建 PanelUpdateBroadcaster 实例后调用。
   * batch_spawn_agents handler 通过此实例主动补推子 Agent 写入的面板数据。
   */
  setPanelUpdateBroadcaster(broadcaster: IPanelUpdateBroadcaster): void {
    this.panelUpdateBroadcaster = broadcaster;
  }

  private buildExpandContext(saveId: ID, templateId: string): ExpandContext {
    if (!this.expandContextBuilder) {
      throw new Error('expandContextBuilder 未设置，请先调用 setGameDataExpander');
    }
    return this.expandContextBuilder(saveId, templateId);
  }

  private getAgentMaxContextTokens(agentType: string): number | undefined {
    if (!this.agentRegistry) return undefined;
    const agent = this.agentRegistry.get(agentType as AgentType);
    if (agent && 'maxContextTokens' in agent) {
      return (agent as unknown as { maxContextTokens: number | undefined }).maxContextTokens;
    }
    return undefined;
  }

  /**
   * 构建工具上下文获取器（用于子 Agent 数据预注入）。
   * L4.3 修复：参数化 agentType，避免硬编码 'gamemaster' 导致调用方身份伪装。
   * 子 Agent 调用工具预取数据时，工具看到的调用方应为实际子 Agent 类型，
   * 保证工具内部 agentType 分支逻辑（访问控制/日志归属/审计追溯）正确执行。
   */
  private buildContextFetcher(
    requestScope: IRequestScope,
    templateId: string | undefined,
    agentType: string,
  ): ContextFetchFn {
    return async (source, method, params, saveId, _templateId) => {
      const { ToolRegistry } = await import('../ToolRegistry.js');
      const toolRegistry = ToolRegistry.getInstance();
      const toolType = source as ToolType;
      const tool = toolRegistry.getTool(toolType);
      if (!tool) return null;
      const toolMethods = tool.getMethods();
      if (!toolMethods.includes(method)) return null;
      const effectiveTemplateId = _templateId || templateId;
      const result = await tool.execute(method, { ...params, saveId }, {
        saveId,
        agentType: agentType as AgentType,
        timestamp: Date.now() as Timestamp,
        templateId: effectiveTemplateId,
        requestScope,
      });
      return result.success ? result.data : null;
    };
  }

  /**
   * 构建子 Agent 专属的 storyDirective 视图：仅保留 storyGoal 字段。
   * L4.1 修复：用户明确要求"storyDirective 提取总任务目标 storyGoal 传递给子 Agent，其余字段不传递"。
   * 子 Agent 通过 buildTaskContent（AgentRuntime.ts:425）仅读取 storyGoal 字段对齐任务目标；
   * 其余 GM-only 字段（requiredLayer1Agents / characterProfileRevision / events / hooks / projection /
   * constraints / dialogueFocus / playerFacingObjective / todoList）属于 GM 编排决策，
   * 不应序列化到子 Agent 系统提示（prompt/index.ts:42-50 TASK_FIELDS.storyDirective.format）。
   * event 子 Agent 的 events 数据通过 buildTemplateContext 单独注入（coordinator-service.ts:228-235）。
   */
  private buildSubAgentStoryDirectiveView(
    parentDirective: unknown,
  ): { storyGoal?: string } | null {
    if (!parentDirective || typeof parentDirective !== 'object') return null;
    const directive = parentDirective as { storyGoal?: unknown };
    if (typeof directive.storyGoal !== 'string' || directive.storyGoal.length === 0) return null;
    return { storyGoal: directive.storyGoal };
  }

  private buildTemplateContext(
    extraContext: Record<string, unknown> | undefined,
    agentType: string,
    storyDirective: unknown,
  ): string | null {
    const directive = storyDirective as Record<string, unknown> | null;
    if (agentType === 'event' && directive?.events && typeof directive.events === 'object') {
      return JSON.stringify({
        ...(extraContext ?? {}),
        eventDirective: directive.events,
      });
    }
    return extraContext ? JSON.stringify(extraContext) : null;
  }

  private createScopedAgent(
    agent: BaseAgent,
    agentType: string,
    context: ToolContext,
    injectedContext: string | null,
    injectedMethods: Array<{ source: string; method: string }>,
    extraContext?: Record<string, unknown>,
  ): BaseAgent {
    const scopedAgent = agent.createRequestScopedCopy();
    const parentAgent = this.agentRegistry?.get(context.agentType as AgentType);
    if (isHookPolicyAwareAgent(scopedAgent)) {
      const mergedHookPolicies = deriveChildHookPolicies(
        isHookPolicyAwareAgent(parentAgent) ? parentAgent.getHookPolicies?.() : undefined,
        scopedAgent.getHookPolicies?.(),
      );
      scopedAgent.applyHookPolicies?.(mergedHookPolicies);
    }

    const runtimeSnapshot = deriveChildRuntimeSnapshot(
      context.runtimeSnapshot as AgentRuntimeSnapshot | undefined,
      {
        agentKey: agentType,
        configuredTools: agent.configuredTools,
        templateId: context.templateId,
      });
    // L4.1 修复：仅传 storyGoal 字段子集，阻断 10 个 GM-only 字段进入子 Agent 系统提示
    const subAgentStoryDirective = this.buildSubAgentStoryDirectiveView(context.storyDirective);
    scopedAgent.applyRequestScope({
      injectedContext,
      injectedMethods,
      templateContext: this.buildTemplateContext(extraContext, agentType, context.storyDirective),
      storyDirective: subAgentStoryDirective,
      stagingPool: context.stagingPool as StagingPool | undefined,
      shadowState: context.shadowState as ShadowStateLayer | undefined,
      templateId: context.templateId,
      runtimeSnapshot,
    });
    return scopedAgent;
  }

  private buildMissingAgentFallback(agentType: string, task: string, action: string) {
    const summary = `${agentType} 子Agent不可用，切换为主Agent直接执行`;
    const followUpDescription =
      `目标子Agent未注册。请由当前主Agent继续完成任务：${task}。` +
      `优先直接调用对应 ServiceTool；如果是叙事/描述类任务，可直接生成文本作为兜底。` +
      `当前请求动作为 ${action}。`;

    return {
      agent_type: agentType,
      fallback_to_main_agent: true,
      result: {
        data: {
          taskStatus: {
            completed: false,
            needsFollowUp: true,
            summary,
            failureReason: 'sub-agent unavailable',
            followUpDescription,
          },
          actions: [],
          results: {},
        },
      },
    };
  }

  private registerMethods(): void {
    this.registerMethod({
      name: 'spawn_agent',
      description: '调度子Agent执行领域任务。子Agent是领域专家，拥有特定工具权限。如果没有对应类型的子Agent，不再硬失败，而是返回主Agent继续直执的fallback follow-up。',
      parameters: {
        agent_type: { type: 'string', required: true, description: '目标子Agent类型。当前可用的子Agent类型见系统提示中的<available_agents>。' },
        task: { type: 'string', required: true, description: '给子Agent的任务描述' },
        action: { type: 'string', required: false, description: '子Agent执行的动作类型。combat: attack/defend/flee, quest: accept/complete/abandon/list/generate, map: move/explore/describe, inventory: list/use/equip/unequip, npc_party: interact/party/relation, skill: list/use/learn, event: list/check/trigger, time: get/advance/wait。默认chat。' },
        context: { type: 'object', required: false, description: '传递给子Agent的额外上下文' },
        taskContract: { type: 'object', required: false, description: '方案H：任务契约，供审核Agent程序审。格式：{ description: "任务描述", expected: { counts: { skills: 5 }, states: { allLearned: true } } }。GM规定数量质量不规定具体名称（不传expected.names）' },
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            properties: {
              agent_type: { type: 'string', description: '子Agent类型' },
              result: { type: 'object', description: '子Agent执行结果' },
              fallback_to_main_agent: { type: 'boolean', description: '是否降级为主Agent直执' },
            },
          },
          error: { type: 'string' },
        },
        required: ['success'],
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const agentType = params.agent_type as string;
        const task = params.task as string;
        const action = (params.action as string) || 'chat';
        const extraContext = params.context as Record<string, unknown> | undefined;
        // v5.2 EC10: 解构 taskContract，传递给子 Agent（与 batch_spawn_agents 路径一致）
        const taskContract = params.taskContract as TaskContract | undefined;

        if (!agentType || typeof agentType !== 'string') {
          return { success: false, error: 'Missing required parameter: agent_type' };
        }
        if (!task || typeof task !== 'string') {
          return { success: false, error: 'Missing required parameter: task' };
        }

        // 显式递归深度检查（核心防线）
        const depthCheck = checkRecursionDepth(context.traceIds);
        if (!depthCheck.allowed) {
          return {
            success: false,
            error: `递归深度超限: currentDepth=${depthCheck.currentDepth} >= maxDepth=${depthCheck.maxDepth}。子 Agent 不能再 spawn 子 Agent。`,
          };
        }

        // canSpawnAgent 冗余检查（配置防线）
        const callerAgent = this.agentRegistry?.get(context.agentType as AgentType);
        if (callerAgent && !callerAgent.canSpawnAgent) {
          return {
            success: false,
            error: `Agent ${context.agentType} 不允许 spawn 子 Agent（canSpawnAgent=false）`,
          };
        }

        if (!this.agentRegistry) {
          return {
            success: true,
            data: this.buildMissingAgentFallback(agentType, task, action),
          };
        }

        const agent = this.agentRegistry.get(agentType as AgentType);
        if (!agent) {
          return {
            success: true,
            data: this.buildMissingAgentFallback(agentType, task, action),
          };
        }

        let injectedContext: string | null = null;
        let injectedMethods: Array<{ source: string; method: string }> = [];
        // EG-OUT-6 修复: context injection 失败降级标记，让消费方感知子 Agent 降级
        let degraded = false;
        let degradedReason: string | undefined;

        try {
          const contextFetcher = this.buildContextFetcher(context.requestScope, context.templateId, agentType);
          const agentMaxTokens = this.getAgentMaxContextTokens(agentType);
          const injectionResult = await this.contextInjector.injectForAgentDetailed(
            agentType,
            context.saveId as ID,
            contextFetcher,
            undefined,
            agentMaxTokens,
            context.templateId,
          );
          injectedContext = injectionResult.context;
          injectedMethods = injectionResult.injectedMethods;
        } catch (injectionError) {
          // context injection failure is non-fatal（降级语义不变，仅提升可观测性）
          degraded = true;
          degradedReason = 'context_injection_failed';
          logger.warn('Context injection failed, continuing without injected context (degraded)', {
            agentType,
            error: getErrorMessage(injectionError),
          });
        }

        const scopedAgent = this.createScopedAgent(
          agent,
          agentType,
          context,
          injectedContext,
          injectedMethods,
          extraContext,
        );

        // v2.3: parentTask 改用 agentRunId 构建（D8 决策），通过 metadata 注入（B3 修复）
        // v2.3: 删除 setParentContext 调用（P1-9 修复）
        const gmProgressCtx = context.progressContext;
        const parentTaskId = gmProgressCtx ? buildTaskNodeId(gmProgressCtx.agentRunId) : null;
        const truncatedTask = task.length > MAX_TASK_DESCRIPTION_LENGTH
          ? task.slice(0, MAX_TASK_DESCRIPTION_LENGTH) + '…'
          : task;

        const result = await scopedAgent.processMessage({
          id: randomUUID() as ID,
          timestamp: Date.now() as Timestamp,
          from: 'gamemaster' as AgentType,
          to: agentType as AgentType,
          type: 'request',
          saveId: context.saveId as ID,
          payload: {
            action,
            intentHint: action,
            data: {
              taskDescription: truncatedTask,  // 与 prompt/index.ts TASK_FIELDS 字段名对齐
              message: task,
              traceIds: context.traceIds
                ? {
                    ...context.traceIds,
                    parentAgentRunId: context.traceIds.agentRunId,
                    agentDepth: (context.traceIds.agentDepth ?? 0) + 1,
                  }
                : undefined,
              // v5.2 EC10: 传递 taskContract 给子 Agent，供 buildTaskContent 构建 expected
              taskContract,
            },
          },
          metadata: {
            priority: 'normal',
            requiresResponse: true,
            _wsRequestId: gmProgressCtx?.requestId ?? '',
            _wsClientId: gmProgressCtx?.broadcastClientId ?? '',
            _parentTask: parentTaskId,  // B3 修复: parentTask 通过 metadata 注入
          },
        });

        return {
          success: result.success,
          ...(degraded ? { degraded, degradedReason } : {}),
          data: {
            agent_type: agentType,
            result: result.data,
          },
        };
      },
    });

    this.registerMethod({
      name: 'batch_spawn_agents',
      description:
        '批量调度多个子Agent，按波次分阶段执行。每波内的Agent并行执行，波与波之间串行等待。\n' +
        '⚠️ WAVE 约束（违反将直接拒绝，浪费一次调用！）：\n' +
        '- npc_party 必须在 map 之后的 wave（NPC 引用地图地点ID）\n' +
        '- quest 必须在 npc_party 之后的 wave（quest 引用 NPC）\n' +
        '- 正确分波示例：Wave1(inventory+skill+map) → Wave2(npc_party) → Wave3(quest)\n' +
        '\n' +
        '子Agent间数据引用关系：\n' +
        '- map → 产出：地点(location ID)、连接关系  | 被引用方：npc_party, quest\n' +
        '- inventory → 产出：物品(item ID)、装备槽位  | 被引用方：无\n' +
        '- skill → 产出：技能(skill ID)  | 被引用方：无\n' +
        '- npc_party → 产出：NPC(ID, location_id)  | 依赖：map的地点ID  | 被引用方：quest\n' +
        '- quest → 产出：任务(quest ID, giver_npc_id, target_location_id)  | 依赖：npc_party的NPC ID, map的地点ID',
      parameters: {
        agents: {
          type: 'array',
          required: true,
          description:
            '分波任务列表，每个元素包含 wave(波次编号) 和 agents(该波的子Agent列表)。' +
            '示例：[{"wave":1,"agents":[{"agent_type":"map","task":"创建地图","action":"enrich"}]}]\n' +
            '注意：wave 顺序必须满足 agent 依赖关系（如 quest 依赖 npc_party 先完成）。',
          items: {
            type: 'object',
            required: ['wave', 'agents'],
            properties: {
              wave: {
                type: 'number',
                required: true,
                description: '波次编号，从 1 开始递增，数字越小越先执行',
              },
              agents: {
                type: 'array',
                required: true,
                description: '该波次的子 Agent 列表',
                items: {
                  type: 'object',
                  required: ['agent_type', 'task'],
                  properties: {
                    agent_type: { type: 'string', required: true, description: '子Agent类型，如 map/skill/inventory/npc_party/quest' },
                    task: { type: 'string', required: true, description: '任务描述' },
                    action: { type: 'string', description: '动作类型，默认 chat，初始化用 enrich' },
                    context: { type: 'object', description: '额外上下文（可选）' },
                    manifest: {
                      type: 'object',
                      description: '方案L：数据预注入清单，指定需要注入到子Agent的数据标签和过滤条件。格式：{ sections: [{ tag: "模板数据.技能定义", filter: { recommendedClass: "mage" } }] }',
                    },
                    taskContract: {
                      type: 'object',
                      description: '方案H：任务契约，供审核Agent程序审。格式：{ description: "任务描述", expected: { counts: { skills: 5 }, states: { allLearned: true } } }。GM规定数量质量不规定具体名称（不传expected.names）',
                    },
                  },
                },
              },
            },
          },
        },
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            properties: {
              results: { type: 'array', description: '各子Agent执行结果列表' },
              summary: {
                type: 'object',
                properties: {
                  total: { type: 'number' },
                  succeeded: { type: 'number' },
                  failed: { type: 'number' },
                  fallback: { type: 'number' },
                  waves: { type: 'number' },
                },
              },
            },
          },
          error: { type: 'string' },
        },
        required: ['success'],
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const rawAgents = params.agents as Array<Record<string, unknown>>;

        if (!Array.isArray(rawAgents) || rawAgents.length === 0) {
          return {
            success: false,
            error: 'agents参数必须是非空数组。正确格式：[{"wave":1,"agents":[{"agent_type":"map","task":"创建地图","action":"enrich"}]}]',
          };
        }

        // 显式递归深度检查（核心防线）
        const depthCheck = checkRecursionDepth(context.traceIds);
        if (!depthCheck.allowed) {
          return {
            success: false,
            error: `递归深度超限: currentDepth=${depthCheck.currentDepth} >= maxDepth=${depthCheck.maxDepth}。子 Agent 不能再 spawn 子 Agent。`,
          };
        }

        // canSpawnAgent 冗余检查（配置防线）
        const callerAgent = this.agentRegistry?.get(context.agentType as AgentType);
        if (callerAgent && !callerAgent.canSpawnAgent) {
          return {
            success: false,
            error: `Agent ${context.agentType} 不允许 spawn 子 Agent（canSpawnAgent=false）`,
          };
        }

        if (!this.agentRegistry) {
          const fallbackResults = rawAgents.map(item => {
            const agentType = item.agent_type as string;
            const task = item.task as string;
            const action = (item.action as string) || 'chat';
            return {
              ...this.buildMissingAgentFallback(agentType, task, action),
              success: true,
            };
          });

          return {
            success: true,
            data: {
              results: fallbackResults,
              summary: {
                total: fallbackResults.length,
                succeeded: fallbackResults.length,
                failed: 0,
                fallback: fallbackResults.length,
                waves: 1,
              },
            },
          };
        }

        // 检测是否为分波模式
        const isWaveMode = rawAgents.length > 0 && rawAgents[0].wave !== undefined;

        type AgentTask = { agent_type: string; task: string; action?: string; context?: Record<string, unknown>; manifest?: ContextManifest; taskContract?: TaskContract };
        type WaveGroup = { wave: number; agents: AgentTask[] };

        let waveGroups: WaveGroup[];

        if (isWaveMode) {
          // 分波模式：解析 waves
          waveGroups = rawAgents
            .filter(item => item.wave !== undefined && Array.isArray(item.agents))
            .map(item => ({
              wave: item.wave as number,
              agents: (item.agents as Array<Record<string, unknown>>).map(a => ({
                agent_type: a.agent_type as string,
                task: a.task as string,
                action: a.action as string | undefined,
                context: a.context as Record<string, unknown> | undefined,
                manifest: a.manifest as ContextManifest | undefined,
                taskContract: a.taskContract as TaskContract | undefined,
              })),
            }))
            .sort((a, b) => a.wave - b.wave);

          // Wave 顺序依赖校验：防止 LLM 派发顺序颠倒（如 quest 在 npc_party 之前）
          const waveValidation = validateWaveOrder(waveGroups);
          if (!waveValidation.valid) {
            return {
              success: false,
              error: `Wave 顺序违反 agent 依赖关系：\n${waveValidation.violations.join('\n')}\n请按正确顺序重新派发 batch_spawn_agents。`,
            };
          }
        } else {
          // 简单模式：所有Agent作为一波
          waveGroups = [{
            wave: 1,
            agents: rawAgents.map(item => ({
              agent_type: item.agent_type as string,
              task: item.task as string,
              action: item.action as string | undefined,
              context: item.context as Record<string, unknown> | undefined,
              manifest: item.manifest as ContextManifest | undefined,
              taskContract: item.taskContract as TaskContract | undefined,
            })),
          }];
        }

        // 执行单个子Agent的通用逻辑
        // EC7：子 Agent 审核统一由 on_task_complete hook 处理（在子 Agent ReAct loop 内挂起-恢复）
        // coordinator 不再独立审核子 Agent 结果，不再做 audit retry
        // v5.2 EC10: taskContract 通过 processMessage payload.data.taskContract 传递给子 Agent
        // 子 Agent AgentRuntime.processSubAgentPath 读取并存储到 currentTaskContract，供 buildTaskContent 构建 expected
        const executeAgent = async (
          { agent_type, task, action, context: extraContext, manifest, taskContract }: AgentTask,
        ) => {
          const agent = this.agentRegistry!.get(agent_type as AgentType);
          if (!agent) {
            return {
              ...this.buildMissingAgentFallback(agent_type, task, action || 'chat'),
              success: true,
            };
          }

          // 方案I：去重持久化检查（DB级幂等+重试预算）
          if (this.dedupService && action) {
            const dedupDecision = await this.dedupService.checkDedup({
              saveId: context.saveId as ID,
              agentType: agent_type,
              action,
              task,
              manifest,
              taskDescription: task,
              manifestSummary: manifest ? JSON.stringify(manifest).substring(0, 200) : '',
            });

            if (dedupDecision.action === 'skip_succeeded') {
              return {
                agent_type,
                success: true,
                result: {
                  skipped: true,
                  reason: 'already_succeeded',
                  resultSummary: dedupDecision.resultSummary,
                },
              };
            }
            if (dedupDecision.action === 'skip_in_progress') {
              return {
                agent_type,
                success: true,
                result: { skipped: true, reason: 'in_progress' },
              };
            }
            if (dedupDecision.action === 'exhausted') {
              return {
                agent_type,
                success: false,
                error: `任务重试预算耗尽（attempt=${dedupDecision.attemptCount}/${dedupDecision.maxAttempts}），GM需接管或降级`,
              };
            }
            // proceed 或 retry：记录派发开始（proceed 时首次记录，retry 时已 incrementAttempt）
            if (dedupDecision.action === 'proceed') {
              await this.dedupService.recordDispatchStart({
                saveId: context.saveId as ID,
                agentType: agent_type,
                action,
                taskHash: dedupDecision.taskHash,
                taskDescription: task,
                manifestSummary: manifest ? JSON.stringify(manifest).substring(0, 200) : '',
              });
            }
          }

          let injectedContext: string | null = null;
          let injectedMethods: Array<{ source: string; method: string }> = [];
          // EG-OUT-6 修复: context injection 失败降级标记，让消费方感知子 Agent 降级
          let degraded = false;
          let degradedReason: string | undefined;
          // 方案L：manifest 路径（GameDataExpander）+ v1 rules 路径融合
          const resolvedManifest = manifest ?? this.contextInjector.getDefaultManifest(agent_type, action) ?? null;
          const isManifestPath = !!(resolvedManifest && this.gameDataExpander && context.templateId);

          try {
            const contextFetcher = this.buildContextFetcher(context.requestScope, context.templateId, agent_type);
            const agentMaxTokens = this.getAgentMaxContextTokens(agent_type);

            // 当 agentTask 有 manifest 或 getDefaultManifest 返回非 null 时，走 injectForAgentWithManifest
            // 否则回退到现有 injectForAgentDetailed（纯 v1 rules 路径）

            let injectionResult;
            if (isManifestPath) {
              // manifest 路径：先 GameDataExpander.expand，再合并 v1 rules
              const expandContext = this.buildExpandContext(context.saveId as ID, context.templateId!);
              injectionResult = await this.contextInjector.injectForAgentWithManifest({
                agentType: agent_type,
                saveId: context.saveId as ID,
                fetcher: contextFetcher,
                manifest: resolvedManifest!,
                gameDataExpander: this.gameDataExpander!,
                expandContext,
                overrideMaxContextTokens: agentMaxTokens,
                templateId: context.templateId,
              });
            } else {
              // v1 rules 路径（现有逻辑）
              injectionResult = await this.contextInjector.injectForAgentDetailed(
                agent_type,
                context.saveId as ID,
                contextFetcher,
                undefined,
                agentMaxTokens,
                context.templateId,
              );
            }
            injectedContext = injectionResult.context;
            injectedMethods = injectionResult.injectedMethods;
          } catch (injectionError) {
            // B-9：manifest 路径失败应阻断（数据源不可用/程序错误），不降级
            // v1 rules 路径失败可降级（继续无 injectedContext 执行）
            if (isManifestPath) {
              // manifest 路径失败 → 阻断，向上抛出
              logger.error('Manifest path injection failed (blocking, not degrading to v1)', {
                agentType: agent_type,
                error: getErrorMessage(injectionError),
              });
              throw injectionError;
            }
            // v1 rules 路径失败 → 降级，继续无 injectedContext 执行（降级语义不变，仅提升可观测性）
            degraded = true;
            degradedReason = 'context_injection_failed';
            logger.warn('Context injection failed (v1 path, continuing without injected context, degraded)', {
              agentType: agent_type,
              error: getErrorMessage(injectionError),
            });
          }

          const scopedAgent = this.createScopedAgent(
            agent,
            agent_type,
            context,
            injectedContext,
            injectedMethods,
            extraContext,
          );

          // v2.3: parentTask 改用 agentRunId 构建（D8 决策），通过 metadata 注入（B3 修复）
          // v2.3: 删除 setParentContext 调用（P1-9 修复）（batch路径）
          const batchGmProgressCtx = context.progressContext;
          const batchParentTaskId = batchGmProgressCtx ? buildTaskNodeId(batchGmProgressCtx.agentRunId) : null;
          const batchTruncatedTask = task.length > MAX_TASK_DESCRIPTION_LENGTH
            ? task.slice(0, MAX_TASK_DESCRIPTION_LENGTH) + '…'
            : task;

          const result = await scopedAgent.processMessage({
            id: randomUUID() as ID,
            timestamp: Date.now() as Timestamp,
            from: 'gamemaster' as AgentType,
            to: agent_type as AgentType,
            type: 'request',
            saveId: context.saveId as ID,
            payload: {
              action: action || 'chat',
              intentHint: action || 'chat',
              data: {
                taskDescription: batchTruncatedTask,  // 与 prompt/index.ts TASK_FIELDS 字段名对齐
                message: task,
                traceIds: context.traceIds
                  ? {
                      ...context.traceIds,
                      parentAgentRunId: context.traceIds.agentRunId,
                      agentDepth: (context.traceIds.agentDepth ?? 0) + 1,
                    }
                  : undefined,
                // v5.2 EC10: 传递 taskContract 给子 Agent，供 buildTaskContent 构建 expected
                taskContract,
              },
            },
            metadata: {
              priority: 'normal',
              requiresResponse: true,
              _wsRequestId: batchGmProgressCtx?.requestId ?? '',
              _wsClientId: batchGmProgressCtx?.broadcastClientId ?? '',
              _parentTask: batchParentTaskId,  // B3 修复: parentTask 通过 metadata 注入
            },
          });

          // 方案I：记录派发结果（成功/失败）
          if (this.dedupService && action) {
            const dispatchKey = buildDispatchKey(agent_type, action, task, manifest);
            const taskHash = extractTaskHash(dispatchKey);
            if (result.success) {
              const resultSummary = typeof result.data === 'string' ? result.data : JSON.stringify(result.data ?? '').substring(0, 500);
              await this.dedupService.recordSuccess(context.saveId as ID, agent_type, action, taskHash, resultSummary);
            } else {
              await this.dedupService.recordFailure(context.saveId as ID, agent_type, action, taskHash);
            }
          }

          // 统一面板变更推送机制：仅对成功子 Agent 收集 writeOperation 与 panelUpdates
          // - writeOperation: 从 result.toolCalls[i].writeOperation 收集（每 ToolResult 单数字段）
          // - panelUpdates: 从 result.data.panelUpdates 收集（子 Agent 走 processSubAgentPath，LLM 输出 panelUpdates 在 data 上）
          // 失败子 Agent 不收集数据，不影响其他子 Agent 数据推送
          if (result.success) {
            if (result.toolCalls) {
              for (const tc of result.toolCalls) {
                if (tc.writeOperation) {
                  childWriteOps.push(tc.writeOperation);
                }
              }
            }
            const subData = result.data as { panelUpdates?: PanelUpdates } | undefined;
            if (subData?.panelUpdates) {
              Object.assign(mergedPanelUpdates, subData.panelUpdates);
            }
          }

          return {
            agent_type,
            success: result.success,
            ...(degraded ? { degraded, degradedReason } : {}),
            result: result.data,
          };
        };

        // 按波次串行执行，波内并行
        const allResults: Array<{ agent_type: string; success: boolean; result?: unknown; error?: string; degraded?: boolean; degradedReason?: string }> = [];
        // 统一面板变更推送机制：聚合所有子 Agent 的 writeOperation 与 panelUpdates
        // - childWriteOps 透传给 GM Agent，让 ResultIntegrator.integrate 识别 toolCall.data.writeOperations 数组
        //   → GM 的 extractAndRefreshPanelUpdates 能感知子 Agent 写入的领域 → 自动 refresh 命中面板（路径 B 修复点 1）
        // - mergedPanelUpdates 用于 batch_spawn_agents 完成后主动补推（保险推送，路径 B 修复点 2）
        //   仅含子 Agent LLM 输出的 panelUpdates（不含 domain refresh 数据，子 Agent 走 processSubAgentPath 不走 buildGameMasterFinalResponse）
        const childWriteOps: Array<{ toolType: string; method: string; params: Record<string, unknown>; result: unknown; timestamp: Timestamp }> = [];
        const mergedPanelUpdates: PanelUpdates = {};

        for (const group of waveGroups) {
          logger.info('Executing wave', {
            wave: group.wave,
            agents: group.agents.map(a => a.agent_type),
          });

          const waveResults = await Promise.allSettled(
            group.agents.map(agentTask => executeAgent(agentTask)),
          );

          // EG-OUT-6 修复: 聚合 wave 内 rejected 子 Agent，warn 提示（不再静默）
          const rejectedInWave: string[] = [];
          for (const r of waveResults) {
            if (r.status === 'fulfilled') {
              allResults.push(r.value);
            } else {
              const failedAgentType = group.agents[waveResults.indexOf(r)]?.agent_type ?? 'unknown';
              allResults.push({ agent_type: failedAgentType, success: false, error: r.reason?.message || 'Unknown error' });
              rejectedInWave.push(failedAgentType);
            }
          }
          if (rejectedInWave.length > 0) {
            logger.warn('Wave has rejected sub-agents (continuing batch, not blocking)', {
              wave: group.wave,
              rejectedCount: rejectedInWave.length,
              rejectedAgents: rejectedInWave,
            });
          }
        }

        // 路径 B 修复点 2：主动补推（保险推送，仅成功子 Agent 数据）。
        // 子 Agent 走 processSubAgentPath（非 buildGameMasterFinalResponse），返回的 panelUpdates 是 LLM 输出（不含 domain refresh 数据）。
        // GM 的 extractAndRefreshPanelUpdates 会经透传的 writeOps 触发 refresh，作为权威推送（含 domain refresh 数据）。
        // 双重推送说明：T1（此处）+ T2（GM flush 后）对同一面板可能推两次。前端 applyPanelUpdates 幂等，无副作用；
        // 服务端不做去重（避免延迟与状态维护）。source 字段让前端日志能区分两次推送来源，便于诊断。
        if (this.panelUpdateBroadcaster && Object.keys(mergedPanelUpdates).length > 0) {
          const triggeredOps: TriggeredOp[] = childWriteOps.map(op => ({
            toolType: op.toolType,
            method: op.method,
          }));
          this.panelUpdateBroadcaster.pushPanelUpdates(
            context.saveId as ID,
            mergedPanelUpdates,
            'tool_side_effect',
            triggeredOps,
          );
        }

        const fallbackCount = allResults.filter(r => (r as Record<string, unknown>).fallback_to_main_agent === true).length;
        // EG-OUT-6 修复: 统计 degraded 子 Agent 数量，让 GM 感知批量执行降级情况
        const degradedCount = allResults.filter(r => r.degraded === true).length;
        const summary = {
          total: allResults.length,
          succeeded: allResults.filter(r => r.success).length,
          failed: allResults.filter(r => !r.success).length,
          fallback: fallbackCount,
          degradedCount,
          waves: waveGroups.length,
        };

        // 构建每个子 Agent 的结构化摘要（嵌套返回给 GM）
        // 优先使用 LLM 主动输出的 taskReport，未输出时 taskReport 为 undefined（GM 端 buildSubAgentResultSummary 会做程序兜底）
        const agentSummaries = allResults.map(r => {
          const data = r.result as Record<string, unknown> | undefined;
          const taskStatus = data?.taskStatus as { completed?: boolean; summary?: string; taskReport?: TaskReport } | undefined;
          return {
            agent_type: r.agent_type,
            success: r.success,
            ...(r.degraded ? { degraded: r.degraded, degradedReason: r.degradedReason } : {}),
            taskCompleted: taskStatus?.completed === true,
            summary: taskStatus?.summary ?? '',
            taskReport: taskStatus?.taskReport,
          };
        });

        return {
          success: summary.failed < summary.total,
          data: {
            results: allResults,
            summary,
            // 路径 B 修复点 1：透传子 Agent writeOperations 给 GM Agent。
            // ResultIntegrator.integrate 扩展识别 toolCall.data.writeOperations 数组，
            // 合并到 GM Agent 的 finalIntegrationResult.writeOperations，
            // 让 GM 的 extractAndRefreshPanelUpdates 能感知子 Agent 写入的领域（触发对应 RefreshConfig）。
            writeOperations: childWriteOps,
            // 嵌套子 Agent 结构化摘要：每个子 Agent 的 taskReport + 文本 summary + 完成状态
            // GM 可直接读取 agentSummaries[i].taskReport 获取 LLM 主动输出的变更清单
            agentSummaries,
          },
        };
      },
    });
  }
}
