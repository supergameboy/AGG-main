import { ID, Timestamp } from '../../../shared/src/types/core';
import { AgentType, AgentMessage, AgentContext, LLMMessage, ToolResult } from '../../../shared/src/types/agent';
import { AgentConfig, AgentResponse, AgentStatus, LLMOptions, LLMResponse, AGENT_DEFAULT_CONFIG } from './types.js';
import { ToolRegistry } from './ToolRegistry.js';
import { ContextManager } from './runtime/context-manager.js';
import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { IWebSocketBroadcaster } from '@ai-rpg/shared/messaging';
import type { IDevTraceHook, ToolProgress } from '@ai-rpg/shared/tool-core';
import { createProgressReporter } from '@ai-rpg/shared/tool-core';
import type { IContextProvider } from '../game-systems/shared/types.js';
import type { ContextFlushQueue } from '../services/context-flush-queue.js';
import { randomUUID } from 'crypto';
import type { StagingPool } from '../services/StagingPool.js';
import type { ShadowStateLayer } from '../services/ShadowStateLayer.js';
import type { DevTraceCollector } from '../services/DevTraceCollector.js';
import {
  buildRuntimeSnapshotDevtoolsSummary,
  type AgentRuntimeSnapshot,
} from './runtime/agent-runtime-snapshot.js';
import type { InjectedMethodState } from '@ai-rpg/shared/types/tool';
import type { RequestContext } from './ReActLoop.js';

const logger = createChildLogger('base-agent');

/**
 * BaseAgent 构造函数依赖（v1.4 新增）
 *
 * 通过构造函数注入的依赖，替代模块级 value import。
 * 子类需通过 super(config, deps) 传递。
 *
 * AP-L1 修复: 新增 devTraceHook 字段，dev:* 事件统一走 Hook 入口。
 */
export interface BaseAgentDeps {
  /** 开发追踪收集器访问器（条件启用，可能返回 null） */
  devTraceCollector: () => DevTraceCollector | null;
  /** WebSocket 广播端口（用于 report_progress Hook 等业务进度事件） */
  webSocketService: IWebSocketBroadcaster;
  /** dev:* 调试事件统一 Hook 端口（AP-L1 新增） */
  devTraceHook: IDevTraceHook;
}

export interface FallbackConfig {
  enabled: boolean;
  autoHandleSuggestions: boolean;
}

export const DEFAULT_FALLBACK_CONFIG: Required<FallbackConfig> = {
  enabled: true,
  autoHandleSuggestions: false
};

export interface RequestScopeRuntime {
  language?: string | null;
  injectedContext?: string | null;
  injectedMethods?: InjectedMethodState[];
  templateContext?: string | null;
  specialRules?: Record<string, unknown> | null;
  storyDirective?: unknown;
  postReviewDecision?: unknown;
  stagingPool?: StagingPool;
  shadowState?: ShadowStateLayer;
  templateId?: string;
  runtimeSnapshot?: AgentRuntimeSnapshot | null;
  pacingState?: import('./story/types.js').PacingState;
  pacingReviewResult?: import('./story/types.js').PacingReviewResult;
}

export abstract class BaseAgent {
  public readonly type: AgentType;
  public readonly name: string;
  public systemPrompt: string;
  protected config: Required<AgentConfig>;
  /**
   * ContextManager 组合（M3 §11.3 D3.6）：AgentContext 消息状态的唯一管理者。
   * public 可见性供 AgentRuntime 装配 MemoryController 的 contextManagerProvider 读取；
   * 外部禁止写入（createRequestScopedCopy 内部重绑定除外）。
   */
  public contextManager: ContextManager;

  /**
   * 兼容访问器：子类直接读写 this.context.state 的既有模式（如 TestAgent）。
   * 返回 ContextManager 内部可变引用；状态变更请经 contextManager 方法。
   */
  protected get context(): AgentContext {
    return this.contextManager.getMutableContext();
  }
  private status: AgentStatus = AgentStatus.IDLE;
  protected toolRegistry: ToolRegistry;
  private _fallbackConfig: Required<FallbackConfig>;
  protected currentSaveId: ID = '' as ID;
  // v2.3 Q3 决策: currentRequestId 字段已删除，由 ReActAgent 的 getter 从 ProgressContext 读取
  public currentTemplateId: string | undefined;
  protected contextService: IContextProvider | undefined;
  protected flushQueue: ContextFlushQueue | undefined;
  protected devTraceCollector: (() => DevTraceCollector | null) | undefined;
  protected webSocketService: IWebSocketBroadcaster | undefined;
  /** dev:* 调试事件统一 Hook 端口（AP-L1 新增） */
  protected devTraceHook: IDevTraceHook | undefined;
  public currentLanguage: string | null = null;
  public currentInjectedContext: string | null = null;
  public currentInjectedMethods: InjectedMethodState[] = [];
  public currentTemplateContext: string | null = null;
  public currentSpecialRules: Record<string, unknown> | null = null;
  public currentStoryDirective: unknown = null;
  public currentPostReviewDecision: unknown = null;
  public currentStagingPool?: StagingPool;
  public currentShadowState?: ShadowStateLayer;
  public currentPacingState?: import('./story/types.js').PacingState;
  public currentPacingReviewResult?: import('./story/types.js').PacingReviewResult;
  private currentRuntimeSnapshot: AgentRuntimeSnapshot | null = null;

  get configuredTools(): string[] {
    return [];
  }

  /**
   * 是否允许调用 coordinator_service.spawn_agent/batch_spawn_agents。
   * 默认 false，子类（AgentRuntime）按 isSubAgent override。
   * 运行时冗余防线：配合 agentDepth 检查，即使配置错误也能阻止子 Agent spawn。
   */
  get canSpawnAgent(): boolean {
    return false;
  }

  constructor(config: AgentConfig, deps?: BaseAgentDeps) {
    this.type = config.type;
    this.name = config.name;
    this.systemPrompt = config.systemPrompt;
    this.config = { ...config, ...AGENT_DEFAULT_CONFIG };
    this.contextManager = new ContextManager({
      agentType: this.type,
      getContextService: () => this.contextService,
      getFlushQueue: () => this.flushQueue,
      getCurrentSaveId: () => this.currentSaveId,
    });
    this.toolRegistry = ToolRegistry.getInstance();
    if (deps) {
      this.devTraceCollector = deps.devTraceCollector;
      this.webSocketService = deps.webSocketService;
      this.devTraceHook = deps.devTraceHook;
    }

    logger.info(`Agent initialized: ${this.type} - ${this.name}`);
    this._fallbackConfig = { ...DEFAULT_FALLBACK_CONFIG };
  }

  abstract processMessage(message: AgentMessage): Promise<AgentResponse>;

  private static cloneRequestScopedValue<T>(value: T): T {
    if (value === null || value === undefined) {
      return value;
    }
    return structuredClone(value);
  }

  private cloneRequestScopedState(): {
    currentSaveId: ID;
    currentTemplateId: string | undefined;
    currentLanguage: string | null;
    currentInjectedContext: string | null;
    currentInjectedMethods: InjectedMethodState[];
    currentTemplateContext: string | null;
    currentSpecialRules: Record<string, unknown> | null;
    currentStoryDirective: unknown;
    currentPostReviewDecision: unknown;
    currentStagingPool: undefined;
    currentShadowState: undefined;
    currentPacingState: import('./story/types.js').PacingState | undefined;
    currentPacingReviewResult: import('./story/types.js').PacingReviewResult | undefined;
    currentRuntimeSnapshot: AgentRuntimeSnapshot | null;
  } {
    return {
      currentSaveId: this.currentSaveId,
      currentTemplateId: this.currentTemplateId,
      currentLanguage: this.currentLanguage,
      currentInjectedContext: this.currentInjectedContext,
      currentInjectedMethods: BaseAgent.cloneRequestScopedValue(this.currentInjectedMethods),
      currentTemplateContext: this.currentTemplateContext,
      currentSpecialRules: BaseAgent.cloneRequestScopedValue(this.currentSpecialRules),
      currentStoryDirective: BaseAgent.cloneRequestScopedValue(this.currentStoryDirective),
      currentPostReviewDecision: BaseAgent.cloneRequestScopedValue(this.currentPostReviewDecision),
      currentStagingPool: undefined,
      currentShadowState: undefined,
      currentPacingState: this.currentPacingState,
      currentPacingReviewResult: this.currentPacingReviewResult,
      currentRuntimeSnapshot: BaseAgent.cloneRequestScopedValue(this.currentRuntimeSnapshot),
    };
  }

  public setRuntimeSnapshot(snapshot: AgentRuntimeSnapshot | null): void {
    this.currentRuntimeSnapshot = BaseAgent.cloneRequestScopedValue(snapshot);
    if (!snapshot) {
      return;
    }

    const traceSaveId = this.currentSaveId || (snapshot.sessionId as ID);
    if (!traceSaveId || !this.devTraceHook) {
      return;
    }

    const summary = buildRuntimeSnapshotDevtoolsSummary(snapshot);
    this.devTraceHook.emit({
      type: 'runtime_snapshot',
      saveId: traceSaveId,
      data: summary as unknown as Record<string, unknown>,
      timestamp: snapshot.createdAt,
      requestId: summary.requestId || undefined,
    });
  }

  /**
   * 获取当前运行时快照（v2 模块G #7: 返回引用而非 clone，消除冗余 structuredClone）。
   * 调用方不应修改返回的对象。如需修改，通过 setRuntimeSnapshot 设置新对象。
   */
  public getRuntimeSnapshot(): Readonly<AgentRuntimeSnapshot> | null {
    return this.currentRuntimeSnapshot;
  }

  applyRequestScope(runtime: RequestScopeRuntime): void {
    if ('language' in runtime) {
      this.currentLanguage = runtime.language ?? null;
    }
    if ('injectedContext' in runtime) {
      this.currentInjectedContext = runtime.injectedContext ?? null;
    }
    if ('injectedMethods' in runtime) {
      this.currentInjectedMethods = BaseAgent.cloneRequestScopedValue(runtime.injectedMethods ?? []);
    }
    if ('templateContext' in runtime) {
      this.currentTemplateContext = runtime.templateContext ?? null;
    }
    if ('specialRules' in runtime) {
      this.currentSpecialRules = BaseAgent.cloneRequestScopedValue(runtime.specialRules ?? null);
    }
    if ('storyDirective' in runtime) {
      this.currentStoryDirective = BaseAgent.cloneRequestScopedValue(runtime.storyDirective ?? null);
    }
    if ('postReviewDecision' in runtime) {
      this.currentPostReviewDecision = BaseAgent.cloneRequestScopedValue(runtime.postReviewDecision ?? null);
    }
    if ('stagingPool' in runtime) {
      this.currentStagingPool = runtime.stagingPool;
    }
    if ('shadowState' in runtime) {
      this.currentShadowState = runtime.shadowState;
    }
    if ('templateId' in runtime) {
      this.currentTemplateId = runtime.templateId;
    }
    if ('runtimeSnapshot' in runtime) {
      this.setRuntimeSnapshot(runtime.runtimeSnapshot ?? null);
    }
    if ('pacingState' in runtime) {
      this.currentPacingState = runtime.pacingState;
    }
    if ('pacingReviewResult' in runtime) {
      this.currentPacingReviewResult = runtime.pacingReviewResult;
    }
  }

  createRequestScopedCopy<T extends BaseAgent>(this: T): T {
    const scopedAgent = Object.create(Object.getPrototypeOf(this)) as T;
    Object.assign(scopedAgent, this);
    Object.assign(scopedAgent, this.cloneRequestScopedState());
    // ContextManager 克隆：独立 context 拷贝 + 依赖重绑定到 scoped 副本（M3 §11.3）
    scopedAgent.contextManager = this.contextManager.cloneForRequestScope({
      getContextService: () => scopedAgent.contextService,
      getFlushQueue: () => scopedAgent.flushQueue,
      getCurrentSaveId: () => scopedAgent.currentSaveId,
    });
    return scopedAgent;
  }

  protected summarizeInput(message: AgentMessage): string {
    const action = message.payload?.action || 'unknown';
    const data = message.payload?.data as Record<string, unknown> | undefined;
    const playerInput = data?.playerInput as string || '';
    if (playerInput) {
      return playerInput.substring(0, 300);
    }
    return `[${action}] ${JSON.stringify(data || {}).substring(0, 200)}`;
  }

  protected summarizeOutput(response: AgentResponse): string {
    const data = response.data as Record<string, unknown> | undefined;
    if (!data) return '[success]';
    const message = data.message as string || data.npcResponse as string || '';
    if (message) {
      return message.substring(0, 500);
    }
    return JSON.stringify(data).substring(0, 500);
  }

  protected extractSaveId(message: AgentMessage): ID {
    if (message.saveId) return message.saveId;
    const payloadData = message.payload?.data as Record<string, unknown> | undefined;
    if (payloadData?.saveId) return payloadData.saveId as ID;
    return '' as ID;
  }

  protected async ensureSaveId(message: AgentMessage): Promise<ID> {
    const saveId = this.extractSaveId(message);
    if (saveId && saveId !== this.currentSaveId) {
      this.currentSaveId = saveId;
      await this.loadContext();
    } else if (!this.currentSaveId) {
      this.currentSaveId = saveId;
    }
    return this.currentSaveId;
  }

  async callTool(toolType: string, method: string, params: Record<string, unknown>, saveId: ID | undefined, reqCtx: RequestContext): Promise<ToolResult> {
    const resolvedSaveId = saveId || this.currentSaveId;
    const toolCallId = this.generateId();
    const timestamp = Date.now() as Timestamp;

    logger.info(`Executing method: ${method} on tool: ${toolType}`, {
      agentType: this.type,
      saveId: resolvedSaveId,
      staging: !!this.currentStagingPool,
      params,
    });

    try {
      const toolContext: import('@ai-rpg/shared/types/tool').ToolContext = {
        saveId: resolvedSaveId,
        agentType: this.type,
        timestamp,
        agentTools: this.configuredTools.length > 0 ? this.configuredTools : undefined,
        templateId: this.currentTemplateId,
        runtimeSnapshot: this.getRuntimeSnapshot() ?? undefined,
        requestScope: reqCtx.requestScope,
        // M6 §7.6.1：进度桥接（ToolProgress → report_progress 链路）+ 请求级取消信号透传
        onUpdate: createProgressReporter(
          (progress) => {
            try {
              this.reportToolProgress(toolType, method, progress);
            } catch (err) {
              logger.warn('progress bridge failed', { error: getErrorMessage(err) });
            }
          },
          { throttleMs: 200 },
        ),
        abortSignal: reqCtx.abortSignal,
      };

      if (this.currentStagingPool) {
        toolContext.stagingPool = this.currentStagingPool;
        toolContext.shadowState = this.currentShadowState;
        toolContext.agentSource = this.type === 'gamemaster' ? 'gamemaster' : 'subagent';
        toolContext.subAgentType = this.type !== 'gamemaster' ? this.type : undefined;
      }

      const response = await this.toolRegistry.execute(
        this.type,
        toolType as import('../../../shared/src/types/agent').ToolType,
        method,
        params,
        toolContext,
      );

      const result: ToolResult = {
        id: this.generateId(),
        toolCallId,
        success: response.success,
        data: response.data as Record<string, unknown>,
        error: response.error,
        timestamp: Date.now() as Timestamp,
        _meta: {
          toolType,
          method,
          params
        },
        fallbackSuggestion: response.fallbackSuggestion,
        writeOperation: response.writeOperation,
      };

      if (response.success) {
        logger.info(`Method execution completed: ${method}`, {
          success: true,
          toolType,
          method,
          resultData: result.data,
        });
      } else {
        logger.error(`Method execution failed: ${method}`, {
          success: false,
          toolType,
          method,
          error: response.error,
        });
      }

      return result;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error(`Tool call exception: ${toolType}.${method}`, {
        toolCallId,
        error: errorMessage
      });

      return {
        id: this.generateId(),
        toolCallId,
        success: false,
        error: errorMessage,
        timestamp: Date.now() as Timestamp
      };
    }
  }

  /**
   * 工具执行进度上报（M6 §7.6.1）：ToolProgress → report_progress 链路。
   *
   * 基类无进度链路（直接子类仅测试场景），默认降级 logger.debug；
   * AgentRuntime override 接入 hookDispatcher.reportProgress（phase='tool_call'）。
   * 进度上报失败绝不影响工具执行（桥接内已 catch，本方法自身也不应抛出）。
   */
  protected reportToolProgress(toolType: string, method: string, progress: ToolProgress): void {
    logger.debug('tool progress (no reporter bound)', { toolType, method, progress });
  }

  abstract callLLM(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>;

  getContext(): AgentContext {
    return this.contextManager.getContext();
  }

  async updateContext(updates: Partial<AgentContext>): Promise<void> {
    return this.contextManager.update(updates);
  }

  async clearContext(): Promise<void> {
    return this.contextManager.clear();
  }

  protected async loadContext(): Promise<void> {
    return this.contextManager.load();
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  protected setStatus(status: AgentStatus): void {
    this.status = status;
    logger.debug(`Agent status changed: ${this.type} -> ${status}`);
  }

  protected generateId(): ID {
    return randomUUID() as ID;
  }

  protected async addMessageToContext(message: LLMMessage): Promise<void> {
    return this.contextManager.addMessage(message);
  }

  protected get fallbackConfig(): FallbackConfig {
    return this._fallbackConfig;
  }

  protected setFallbackConfig(config: Partial<FallbackConfig>): void {
    this._fallbackConfig = { ...this._fallbackConfig, ...config };
  }

  async destroy(): Promise<void> {
    await this.clearContext();
    this.setStatus(AgentStatus.IDLE);
    logger.info(`Agent destroyed: ${this.type}`);
  }
}
