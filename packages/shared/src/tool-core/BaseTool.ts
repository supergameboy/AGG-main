/**
 * BaseTool — 工具基类（从 backend/agents/BaseTool.ts 迁移）
 *
 * v1.3 改动：
 * - import 路径改为 shared/ 内部相对路径
 * - createChildLogger → getChildLogger（shared/utils/logger 的端口接口）
 * - getTimeoutConfig() → resolveTimeoutConfig()（静态注册模式，方案 D）
 * - toolResultCache/createStagingKnex 从 ./tool-result-cache.js 和 ./staging-knex.js 导入
 *
 * 设计理由：BaseTool 是 26 个工具派生类的基类，迁移到 shared/ 后通过端口接口
 * 和静态注册模式解耦对 backend services/ 和 config 的依赖。
 */

import type { Knex } from 'knex';
import type { ToolType } from '../types/agent.js';
import type {
  ToolMethod,
  ToolContext,
  ToolResponse,
  ToolDefinition,
  ToolPermission,
  ActionHandler,
  IRequestScope,
} from '../types/tool.js';
import type { TimeoutConfig } from '../utils/timeout.js';
import { getChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '../utils/error.js';
import { withTimeout } from '../utils/timeout.js';
import { toolResultCache } from './tool-result-cache.js';
import { createStagingKnex } from './staging-knex.js';
import { throwIfAborted, isAbortError, abortReasonToMessage } from './abort-signal.js';

const logger = getChildLogger('base-tool');

/**
 * Staging-aware RequestScope: getDb() 返回 staging-wrapped knex，
 * getOrCompute() 委托给内部 RequestScope（保持请求级缓存一致性）。
 *
 * v1.5 新增：替代原 context.db = stagingDb 模式（D4 决策移除 ToolContext.db 字段）。
 */
class StagingRequestScope implements IRequestScope {
  constructor(
    private readonly stagingDb: Knex,
    private readonly inner: IRequestScope,
  ) {}
  getDb(): Knex { return this.stagingDb; }
  getOrCompute<T>(key: string, factory: () => Promise<T>): Promise<T> {
    return this.inner.getOrCompute(key, factory);
  }
}

/** 超时配置提供器（由 backend 启动时注册） */
let timeoutConfigProvider: (() => TimeoutConfig) | undefined;

/**
 * 注册超时配置提供器（v1.3 新增）
 *
 * backend 启动入口调用此方法，传入读取 config 的函数。
 * 未注册时调用 BaseTool 的工具执行方法会抛错，确保配置必达。
 */
export function registerTimeoutConfig(provider: (() => TimeoutConfig)): void {
  timeoutConfigProvider = provider;
}

/**
 * 工具事件发射器类型（M6 D6.6，EventBus.emit 的结构子集）。
 *
 * 经 registerToolEventEmitter 静态注册注入，tool-core 不 value import messaging，
 * 保持 tool-core → messaging 运行时边不存在（循环依赖零新增）。
 */
export type ToolEventEmitter = (
  eventType: 'before_tool_execute' | 'after_tool_execute',
  event: {
    type: 'before_tool_execute' | 'after_tool_execute';
    saveId: string;
    data: Record<string, unknown>;
    timestamp: number;
  },
) => Promise<void> | void;

/** 工具事件发射器（由 backend 组合根启动时注册） */
let toolEventEmitter: ToolEventEmitter | undefined;

/**
 * 注册工具事件发射器（M6 D6.6，与 registerTimeoutConfig 模式对称）。
 *
 * backend 组合根启动时调用，注入 EventBus.emit 的薄适配器。
 * 未注册时事件发布降级 logger.debug，工具执行不受影响（G4 静默降级）。
 */
export function registerToolEventEmitter(emitter: ToolEventEmitter): void {
  toolEventEmitter = emitter;
}

export abstract class BaseTool {
  public readonly type: ToolType;
  public readonly name: string;
  public readonly description: string;
  public readonly version: string;
  public readonly handledActions: ActionHandler[];

  private methods: Map<string, ToolMethod> = new Map();
  private permissions: Map<string, ToolPermission> = new Map();

  constructor(
    type: ToolType,
    name: string,
    description: string,
    version: string = '1.0.0',
    handledActions: ActionHandler[] = []
  ) {
    this.type = type;
    this.name = name;
    this.description = description;
    this.version = version;
    this.handledActions = handledActions;

    if (handledActions.length > 0) {
      logger.debug(`Tool ${type} declares ${handledActions.length} action handlers`);
    }
  }

  protected addActionHandler(
    action: string,
    method: string,
    priority: number,
    description?: string,
    paramMapping?: Record<string, string>
  ): void {
    this.handledActions.push({
      action,
      method,
      paramMapping,
      priority,
      description
    });
  }

  protected registerMethod(config: ToolMethod): void {
    if (this.methods.has(config.name)) {
      throw new Error(`Method ${config.name} already registered in tool ${this.type}`);
    }
    this.methods.set(config.name, config);
    logger.debug(`Registered method: ${config.name} for tool: ${this.type}`);
  }

  async execute(methodName: string, params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> {
    const method = this.methods.get(methodName);

    if (!method) {
      logger.error(`Method not found: ${methodName} in tool: ${this.type}`);
      return {
        success: false,
        error: `Method ${methodName} not found in tool ${this.type}`
      };
    }

    const hasPermission = this.checkPermission(context.agentType, methodName);
    if (!hasPermission) {
      logger.warn(`Permission denied: agent ${context.agentType} cannot execute ${methodName} on tool ${this.type}`);
      return {
        success: false,
        error: `Permission denied: agent ${context.agentType} cannot execute method ${methodName}`
      };
    }

    // M6① abort 入口检查：已取消则不进入执行路径。
    // 不发布 before_tool_execute——工具未执行，事件语义纯净（§7.3.2）
    if (context.abortSignal?.aborted) {
      return this.buildAbortedResponse(context.abortSignal.reason);
    }

    // M6② before_tool_execute：每次 execute() 恰好一次（D6.7）
    await this.emitToolEvent('before_tool_execute', context, {
      toolType: this.type,
      method: methodName,
      saveId: context.saveId,
      agentType: context.agentType,
    });

    const startedAt = Date.now();
    const response = await this.executeMethod(method, params, context);

    // M6③ after_tool_execute：恰好一次，仅携带摘要字段（D6.8，params/result 不入事件）
    await this.emitToolEvent('after_tool_execute', context, {
      toolType: this.type,
      method: methodName,
      saveId: context.saveId,
      agentType: context.agentType,
      success: response.success,
      ...(response.error !== undefined ? { error: response.error } : {}),
      durationMs: Date.now() - startedAt,
      ...(response.aborted ? { aborted: true } : {}),
    });

    return response;
  }

  /**
   * 方法分发执行（execute 的下半段，M6 提取）。
   *
   * 批量分支先校验/规整参数再进 executeBatch；单条分支直接 executeSingle。
   * 提取理由：execute() 需要在"恰好一对 before/after 事件"之间包裹完整执行路径，
   * 原批量校验的 early return 必须收敛为单一 response 出口。
   */
  private async executeMethod(method: ToolMethod, params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> {
    if (method.batch) {
      const batchParam = method.batch.param;
      let items = params[batchParam];

      if (!Array.isArray(items)) {
        const hasBizFields = Object.keys(params).some(k => k !== batchParam);
        if (hasBizFields) {
          const idFields = ['inventoryId', 'npcId', 'skillId', 'locationId', 'questId', 'name'];
          const hasIdField = Object.keys(params).some(k => idFields.includes(k));
          if (!hasIdField) {
            const itemsProps = (method.parameters?.[batchParam] as Record<string, unknown>)?.items as Record<string, unknown> | undefined;
            const props = itemsProps?.properties as Record<string, unknown> | undefined;
            const requiredIds = props ? Object.keys(props).filter(k => idFields.includes(k)) : [];
            if (requiredIds.length > 0) {
              return {
                success: false,
                error: `参数格式错误：请使用 {${batchParam}: [{${requiredIds[0]}: "xxx", ...}]} 格式传入批量数据，每项必须包含 ${requiredIds[0]}。当前传入的参数缺少 ${requiredIds.join('/')}。`
              };
            }
          }
          items = [params];
        }
      }

      if (!Array.isArray(items) || items.length === 0) {
        return { success: false, error: `参数 '${batchParam}' 必须是非空数组` };
      }
      return this.executeBatch(method, { ...params, [batchParam]: items }, context);
    }

    return this.executeSingle(method, params, context);
  }

  private async executeSingle(method: ToolMethod, params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> {
    if (!method.isWrite && method.cacheable !== false) {
      const cached = toolResultCache.get(context.saveId, this.type, method.name, params);
      if (cached !== undefined) {
        return { success: true, data: cached };
      }
    }

    try {
      logger.info(`Executing method: ${method.name} on tool: ${this.type}`, {
        agentType: context.agentType,
        saveId: context.saveId,
        staging: !!context.stagingPool,
      });

      const effectiveContext = this.buildEffectiveContext(method, context);

      const executeHandler = () => withTimeout(
        method.handler(params, effectiveContext),
        {
          timeoutMs: this.resolveTimeoutConfig().toolExecution,
          context: `${this.type}.${method.name}`
        }
      );

      // !! 强制布尔转换：与第 162 行 staging: !!context.stagingPool 保持一致。
      // 若缺少 !!，写方法时 useStaging 会是 StagingPool 实例（true && obj => obj），
      // 传入 logger.info 的 staged 字段会导致 winston format JSON.stringify
      // 遍历 StagingPool → WebSocketService → setInterval Timeout 循环引用抛错。
      const useStaging = !!(method.isWrite && context.stagingPool);
      const useWriteQueue = method.isWrite && context.writeQueue && !useStaging;

      const response = useWriteQueue
        ? await context.writeQueue!.enqueueFn(executeHandler, `${this.type}.${method.name}`)
        : await executeHandler();

      if (response.success && method.isWrite && !response.writeOperation) {
        response.writeOperation = {
          toolType: this.type,
          method: method.name,
          params,
          result: response.data,
          timestamp: context.timestamp
        };
      }

      if (response.success && !method.isWrite && method.cacheable !== false) {
        toolResultCache.set(context.saveId, this.type, method.name, params, response.data);
      }

      if (response.success && method.isWrite) {
        toolResultCache.invalidateAfterWrite(context.saveId, this.type);
      }

      logger.info(`Method execution completed: ${method.name}`, {
        success: response.success,
        toolType: this.type,
        staged: useStaging,
      });

      return response;
    } catch (error) {
      // M6: 取消错误优先规范化（D6.4）。
      // aborted 语义是"未完成"：直接从 catch 返回，不触达 writeOperation 附加/缓存写入分支
      if (isAbortError(error)) {
        logger.info(`Method execution aborted: ${method.name}`, {
          toolType: this.type,
          reason: error.reason,
        });
        return this.buildAbortedResponse(error.reason);
      }
      const errorMessage = getErrorMessage(error);
      logger.error(`Method execution failed: ${method.name}`, {
        error: errorMessage,
        toolType: this.type
      });

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  private buildEffectiveContext(method: ToolMethod, context: ToolContext): ToolContext {
    if (!context.stagingPool) {
      return context;
    }

    const stagingDb = createStagingKnex(context.requestScope.getDb(), {
      stagingPool: context.stagingPool,
      shadowState: context.shadowState!,
      toolType: String(this.type),
      method: method.name,
      source: context.agentSource || (context.agentType === 'gamemaster' ? 'gamemaster' : 'subagent'),
      subAgentType: context.agentType !== 'gamemaster' ? context.agentType : undefined,
    });

    return {
      ...context,
      requestScope: new StagingRequestScope(stagingDb, context.requestScope),
      ...(method.isWrite ? { writeQueue: undefined } : {}),
    };
  }

  /**
   * 批量执行入口。
   *
   * 流程：
   * 1. 从 `params[batchConfig.param]` 取出数组（如 LLM 传 `{updates: [...]}` → 取 `updates`）
   * 2. 校验数组长度不超过 `batchConfig.maxItems`（默认 20）
   * 3. 根据 `batchConfig.mode` 决定执行模式：
   *    - `sequential`（默认）：顺序对每个 item 调用 `buildSingleParams` + `executeSingle`
   *    - `parallel`：并行调用（staging 模式下强制顺序，避免事务冲突）
   * 4. 聚合每项的 `response.data` 与 `response.writeOperation`，整体返回
   *
   * **handler 调用契约**：handler 通过 `buildSingleParams` 转换后的 `singleParams` 调用，
   * `singleParams` 是 `{...原 params（去除 batch param 字段）, ...item}`，即 item 字段
   * 平铺到顶层。handler 内部必须访问顶层字段，**不能**访问原 batch param 字段。
   *
   * @see buildSingleParams 单 item 参数转换逻辑
   * @see BatchConfig 批量配置完整语义
   */
  private async executeBatch(method: ToolMethod, params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> {
    const batchConfig = method.batch!;
    const items = params[batchConfig.param] as Record<string, unknown>[];
    const maxItems = batchConfig.maxItems ?? 20;

    if (items.length > maxItems) {
      return { success: false, error: `批量参数 '${batchConfig.param}' 超过上限 ${maxItems}，当前 ${items.length} 项` };
    }

    logger.info(`Batch executing method: ${method.name} on tool: ${this.type}`, {
      agentType: context.agentType,
      itemCount: items.length,
      mode: batchConfig.mode ?? 'sequential'
    });

    const mode = batchConfig.mode ?? 'sequential';
    const forceSequential = mode === 'parallel' && !!context.stagingPool;
    const data: unknown[] = [];
    let hasSuccess = false;
    let hasFailure = false;
    const batchOperations: NonNullable<ToolResponse['writeOperation']>['batchOperations'] = [];

    if (mode === 'sequential' || forceSequential) {
      try {
        for (const item of items) {
          // M6 检查点①：每项开始前协作式取消（§7.3.4）
          throwIfAborted(context.abortSignal);
          const singleParams = this.buildSingleParams(params, batchConfig.param, item);
          const response = await this.executeSingle(method, singleParams, context);
          // M6 检查点②：handler 内部取消经 executeSingle 规范化后冒泡——整体按取消语义结束，
          // 不聚合部分完成数据（避免 Agent 误判部分成功）
          if (response.aborted) {
            return response;
          }
          if (response.success) {
            data.push(response.data);
            hasSuccess = true;
          } else {
            data.push({ error: response.error ?? 'Unknown error' });
            hasFailure = true;
          }
          if (response.writeOperation) {
            batchOperations.push(response.writeOperation);
          }
        }
      } catch (error) {
        // M6: 检查点取消规范化为整体 aborted 响应（executeSingle 同级语义，§7.3.4）
        if (isAbortError(error)) {
          logger.info(`Batch execution aborted: ${method.name}`, {
            toolType: this.type,
            reason: error.reason,
          });
          return this.buildAbortedResponse(error.reason);
        }
        throw error;
      }
    } else {
      const responses = await Promise.all(
        items.map((item, index) => {
          const singleParams = this.buildSingleParams(params, batchConfig.param, item);
          return this.executeSingle(method, singleParams, context)
            .then(response => ({ index, response }))
            .catch(e => ({
              index,
              response: { success: false, error: getErrorMessage(e) } as ToolResponse
            }));
        })
      );
      responses.sort((a, b) => a.index - b.index);
      for (const { response } of responses) {
        if (response.success) {
          data.push(response.data);
          hasSuccess = true;
        } else {
          data.push({ error: response.error ?? 'Unknown error' });
          hasFailure = true;
        }
        if (response.writeOperation) {
          batchOperations.push(response.writeOperation);
        }
      }
    }

    const response: ToolResponse = {
      success: !hasFailure,
      data,
      ...(method.isWrite && batchOperations.length > 0 ? {
        writeOperation: {
          toolType: this.type,
          method: method.name,
          params,
          result: data,
          timestamp: context.timestamp,
          batchOperations
        }
      } : {})
    };

    if (hasFailure) {
      if (hasSuccess) {
        response.error = `${data.filter(d => d && typeof d === 'object' && 'error' in (d as Record<string, unknown>)).length} 项执行失败`;
      } else {
        const firstError = data.find(d => d && typeof d === 'object' && 'error' in (d as Record<string, unknown>));
        response.error = firstError
          ? (firstError as Record<string, unknown>).error as string
          : '批量操作全部失败';
      }
    }

    return response;
  }

  /**
   * 单 item 参数转换：将原 params 中的 batch param 字段移除，把 item 字段平铺到顶层。
   *
   * 转换逻辑：
   * 1. `{ [batchParamName]: _, ...rest } = originalParams` → 移除 batch param 字段
   *    （如 `updates` / `skills` / `npcs` 等数组字段，避免 handler 误访问原数组）
   * 2. `{ ...rest, ...item }` → 把 item 字段平铺到顶层
   *    （如 item `{npcId, attrInitialized}` → `params.npcId` / `params.attrInitialized`）
   * 3. `delete singleParams._needsLLMEnrichment` → 移除内部标记字段
   *
   * **handler 契约**：handler 收到的 `params` 是转换后的 `singleParams`，访问 item 字段
   * 直接用 `params.xxx`（如 `params.npcId`），**禁止**访问 `params[batchParamName]`
   * （值为 `undefined`，会触发 `Cannot read properties of undefined` 错误）。
   *
   * @see executeBatch 批量执行入口
   * @see BatchConfig.batch.param 字段语义
   */
  private buildSingleParams(
    originalParams: Record<string, unknown>,
    batchParamName: string,
    item: Record<string, unknown>
  ): Record<string, unknown> {
    const { [batchParamName]: _, ...rest } = originalParams;
    const singleParams = { ...rest, ...item };
    // 自动移除内部标记字段，LLM 无需关心
    delete singleParams._needsLLMEnrichment;
    return singleParams;
  }

  checkPermission(agentType: string, methodName: string): boolean {
    const wildcardKey = `${agentType}:*`;
    const permission = this.permissions.get(wildcardKey);

    if (!permission) {
      return false;
    }

    const method = this.methods.get(methodName);
    if (!method) {
      return false;
    }

    return method.isWrite ? permission.writeAllowed : permission.readAllowed;
  }

  setPermission(permission: ToolPermission): void {
    const key = `${permission.agentType}:*`;
    this.permissions.set(key, permission);
    logger.debug(`Set permission for agent: ${permission.agentType} on tool: ${this.type}`);
  }

  removePermission(agentType: string): void {
    const key = `${agentType}:*`;
    this.permissions.delete(key);
    logger.debug(`Removed permission for agent: ${agentType} on tool: ${this.type}`);
  }

  clearPermissions(): void {
    this.permissions.clear();
    logger.debug(`Cleared all permissions on tool: ${this.type}`);
  }

  getDefinition(): ToolDefinition {
    return {
      type: this.type,
      name: this.name,
      description: this.description,
      version: this.version,
      methods: Array.from(this.methods.values())
    };
  }

  getMethods(): string[] {
    return Array.from(this.methods.keys());
  }

  hasMethod(methodName: string): boolean {
    return this.methods.has(methodName);
  }

  getMethodDefinition(methodName: string): ToolMethod | undefined {
    return this.methods.get(methodName);
  }

  /** 解析超时配置（未注册则抛错，非 fallback） */
  private resolveTimeoutConfig(): TimeoutConfig {
    if (!timeoutConfigProvider) {
      throw new Error(
        'BaseTool.timeoutConfigProvider 未注册。请在 backend 启动入口调用 registerTimeoutConfig(getTimeoutConfig)。'
      );
    }
    return timeoutConfigProvider();
  }

  /**
   * 发布工具执行生命周期事件（M6）。
   *
   * fire-and-forget 语义：
   * - emitter 未注册 → 降级 logger.debug，工具执行正常继续（G4 静默降级）
   * - emitter 抛错（含 EventBus MAX_EVENT_DEPTH 中断）→ 吞错 logger.warn，
   *   绝不影响 ToolResponse（观察事件不可干预原则，§4.4）
   */
  private async emitToolEvent(
    eventType: 'before_tool_execute' | 'after_tool_execute',
    context: ToolContext,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (!toolEventEmitter) {
      logger.debug('Tool event emitter not registered; tool event skipped', {
        eventType,
        toolType: this.type,
        method: data.method,
      });
      return;
    }
    try {
      await toolEventEmitter(eventType, {
        type: eventType,
        saveId: context.saveId,
        data,
        timestamp: Date.now(),
      });
    } catch (error) {
      logger.warn('Tool event emission failed; tool execution result unaffected', {
        eventType,
        toolType: this.type,
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * 构造取消响应（M6，D6.4）。
   *
   * aborted 语义是"未完成"：不携带 writeOperation（G 层不应据此回放写入）、
   * 不携带部分完成数据（避免 Agent 误判部分成功）。
   */
  private buildAbortedResponse(reason: unknown): ToolResponse {
    return {
      success: false,
      aborted: true,
      error: `工具执行已取消：${abortReasonToMessage(reason)}`,
    };
  }
}
