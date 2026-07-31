/**
 * WS 请求处理器
 *
 * 接收 WS game:request 消息，按 module 分发到对应处理器，
 * game 模块内部按 action 路由到具体处理函数。
 * 与 HTTP 路径共享同一套业务逻辑（processInitialize / processChat） */

import type { WebSocket } from 'ws';
import type { WSGameRequest, WSGameResult, WSGameError, GameInitializePayload, GameChatPayload, GameLoadPayload, IToolRegistry } from '@ai-rpg/shared';
import type { IWebSocketContext, IPanelUpdateBroadcaster } from '@ai-rpg/shared/messaging';
import { mapLocationToPanelData } from '@ai-rpg/shared/utils';
import type { AgentRuntime } from '../agents/AgentRuntime.js';
import type { ConfigLoader } from '../agents/config/ConfigLoader.js';
import type { Knex } from 'knex';
import { processInitialize, processChat } from './game-service.js';
import type { GameServiceDeps } from './game-service.js';
import type { ISaveProvider } from '../game-systems/save/types.js';
import { StoryService } from '../game-systems/story/StoryService.js';
import { StoryEventRepository } from '../game-systems/story/StoryEventRepository.js';
import { AgentContextRepository } from '../game-systems/story/AgentContextRepository.js';
import { SaveRepository } from '../game-systems/save/index.js';
import { KnexTransactionManager } from '../database/TransactionManager.js';
import { handleTemplateModule } from './ws-template-handler.js';
import { handleSaveModule } from './ws-save-handler.js';
import { handleConfigModule } from './ws-config-handler.js';
import { handleSystemModule } from './ws-system-handler.js';
import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';

const logger = createChildLogger('ws-request-handler');

// ── 共享类型（导出供子 handler 使用）──

export interface GameHandlerContext {
  coordinatorAgent: AgentRuntime;
  db: Knex;
  configLoader: ConfigLoader;
  /** v2 模块E 新增: 发起请求的 WS 客户端 ID */
  clientId: string;
  /** P3-S7 新增: ToolRegistry 端口实例（ws-template-handler pool:generate-options 使用） */
  toolRegistry: IToolRegistry;
  /** P1-2 新增: WebSocket 消息层上下文（IWebSocketContext 类型，D8 决策） */
  webSocketService: IWebSocketContext;
  /** P0-2 新增: game-service 所需的端口依赖（locationRepo/skillService/rollbackRepos/txManager） */
  gameServiceDeps: GameServiceDeps;
  /** S5 新增: SaveService 端口实例（ws handlers 共享，消除 new SaveService(ctx.db)） */
  saveService: ISaveProvider;
  /**
   * 统一面板变更推送机制新增：IPanelUpdateBroadcaster 端口实例。
   *
   * handleWSInitialize 完成后调 pushPanelUpdate(saveId, 'location', {...}, 'init') 推送初始 location 面板，
   * 替代原 'map:update' 事件。实例来源策略：组合根优先复用 coordinatorAgent.deps.panelUpdateBroadcaster
   * （避免重复 new 导致内部状态分散），降级时 new PanelUpdateBroadcaster(ctx.webSocketService) 新建。
   * 类型张力：ctx.webSocketService 类型是 IWebSocketContext（子接口），
   * PanelUpdateBroadcaster 构造函数声明参数为 IWebSocketBroadcaster（父接口），
   * 子→父类型转换安全（TypeScript 协变），无需 as 断言。
   */
  panelUpdateBroadcaster: IPanelUpdateBroadcaster;
}

// ── 共享辅助函数（导出供子 handler 使用，D9 决策参数化）──

export function sendResult(
  webSocketService: IWebSocketContext,
  ws: WebSocket,
  requestId: string,
  module: string,
  data: unknown,
  intentHint?: string,
): void {
  const result: WSGameResult = {
    type: 'game:result',
    requestId,
    module,
    data: { success: true, data },
    intentHint,
  };
  webSocketService.sendToClient(ws, result);
  // 模块I: 响应已发送，清理 pending 请求（如果是长时间 LLM 请求）
  webSocketService.completePendingRequest(requestId);
}

export function sendError(
  webSocketService: IWebSocketContext,
  ws: WebSocket,
  requestId: string,
  errorCode: string,
  errorMessage: string,
  recoverable: boolean,
  module: string = 'game',
): void {
  const errorEvent: WSGameError = {
    type: 'game:error',
    requestId,
    module,
    error: `${errorCode}: ${errorMessage}`,
    errorType: errorCode,
    recoverable,
  };
  webSocketService.sendToClient(ws, errorEvent);
  // 模块I: 错误响应也意味着请求已完成，清理 pending 请求
  webSocketService.completePendingRequest(requestId);
}

// ── 参数校验辅助函数（v2 模块H H15/H16: 提取重复的校验逻辑）──

/**
 * 校验 payload 中包含 saveId，否则发送错误并返回 false。
 * 冗余-7 修复: 提取 ws-save-handler.ts 中 10 处重复的 SAVE_ID_REQUIRED 校验。
 */
export function requireSaveId(
  webSocketService: IWebSocketContext,
  ws: WebSocket,
  requestId: string,
  payload: Record<string, unknown>,
): payload is { saveId: string } & Record<string, unknown> {
  const saveId = payload.saveId;
  if (!saveId || typeof saveId !== 'string') {
    sendError(webSocketService, ws, requestId, 'SAVE_ID_REQUIRED', 'saveId is required', true, 'save');
    return false;
  }
  return true;
}

/**
 * 校验 payload 中包含 templateId，否则发送错误并返回 false。
 * 冗余-8 修复: 提取 ws-template-handler.ts 中 22 处重复的 TEMPLATE_ID_REQUIRED 校验。
 */
export function requireTemplateId(
  webSocketService: IWebSocketContext,
  ws: WebSocket,
  requestId: string,
  payload: Record<string, unknown>,
): payload is { templateId: string } & Record<string, unknown> {
  const templateId = payload.templateId;
  if (!templateId || typeof templateId !== 'string') {
    sendError(webSocketService, ws, requestId, 'TEMPLATE_ID_REQUIRED', 'templateId is required', true, 'template');
    return false;
  }
  return true;
}

// ── 主入口 ──

/** 创建 WS 请求处理器 */
export function createWSGameHandler(ctx: GameHandlerContext) {
  return async function handleWSRequest(request: WSGameRequest, ws: WebSocket): Promise<void> {
    const { requestId, module } = request;
    const { webSocketService } = ctx;

    const MODULE_HANDLERS: Record<string, (req: WSGameRequest, ws: WebSocket, ctx: GameHandlerContext) => Promise<void>> = {
      game: handleGameModule,
      template: handleTemplateModule,
      save: handleSaveModule,
      config: handleConfigModule,
      system: handleSystemModule,
    };

    const handler = MODULE_HANDLERS[module];
    if (!handler) {
      sendError(webSocketService, ws, requestId, 'UNKNOWN_MODULE', `Unknown module: ${module}`, false);
      return;
    }

    // v2 模块E P0-9: getClientIdByWs 返回 null 时记录 warn 日志，不静默转为空字符串
    const clientId = webSocketService.getClientIdByWs(ws);
    if (!clientId) {
      logger.warn('WS handler: client not authenticated', { requestId });
    }

    try {
      await handler(request, ws, { ...ctx, clientId: clientId || '' });
    } catch (error) {
      sendError(webSocketService, ws, requestId, 'HANDLER_ERROR', getErrorMessage(error), false);
    }
  };
}

// ── Game 模块路由 ──

async function handleGameModule(request: WSGameRequest, ws: WebSocket, ctx: GameHandlerContext): Promise<void> {
  const { action } = request;

  switch (action) {
    case 'initialize':
      return handleWSInitialize(ctx, request, ws);
    case 'chat':
      return handleWSChat(ctx, request, ws);
    case 'load':
      return handleWSLoad(ctx, request, ws);
    // 直接路径：-LLM 后缀的 action 统一走 processChat（完整 ReAct 循环）
    case 'dialogue-LLM':
    case 'inventory-LLM':
    case 'skill-LLM':
    case 'travel-LLM':
    case 'quest-LLM':
    case 'shop-LLM':
    case 'craft-LLM':
    case 'storage-LLM':
    case 'explore-LLM':
    case 'levelup-LLM':
    case 'combat-LLM':
    case 'npc-LLM':
      return handleWSChat(ctx, request, ws);
    // G2 快速路径：-program 后缀的 action 走 processChat → handleProgramAction（非 LLM 纯程序执行）
    // game-service.ts:467 根据 -program 后缀分流到 handleProgramAction
    case 'combat-program':
    case 'puzzle-program':
    case 'minigame-program':
    case 'stealth-program':
      return handleWSChat(ctx, request, ws);
    default:
      sendError(ctx.webSocketService, ws, request.requestId, 'UNKNOWN_ACTION', `Unknown game action: ${action}`, false);
  }
}

// ── Game 模块处理器 ──

/** WS 初始化处理：解析参数 → 调用共享服务 → 通过WS发送响应 */
async function handleWSInitialize(
  ctx: GameHandlerContext,
  request: WSGameRequest,
  ws: WebSocket,
): Promise<void> {
  const { requestId, intentHint, payload } = request;
  const { webSocketService } = ctx;
  const { templateId, characterData, language } = payload as unknown as GameInitializePayload;
  // v2 新增: 获取 clientId 用于进度事件广播
  const clientId = webSocketService.getClientIdByWs(ws) ?? undefined;

  // save 创建后立即 subscribe 客户端，确保 Agent 进度事件能被接收
  const result = await processInitialize(
    { coordinatorAgent: ctx.coordinatorAgent, db: ctx.db, ...ctx.gameServiceDeps },
    {
      templateId,
      characterData: characterData as Parameters<typeof processInitialize>[1]['characterData'],
      language,
      requestId,
      clientId,
      onSaveCreated: (saveId) => {
        webSocketService.subscribeClient(ws, saveId);
      },
    },
  );

  if (!result.success) {
    const recoverable = result.errorCode === 'TEMPLATE_ID_REQUIRED' || result.errorCode === 'INVALID_CHARACTER_DATA';
    sendError(webSocketService, ws, requestId, result.errorCode ?? 'GAME_INIT_FAILED', result.error ?? '游戏初始化失败', recoverable);
    return;
  }

  // subscribe 已在 onSaveCreated 回调中完成

  // 统一面板变更推送机制：初始化场景的位置变更推送（替代原 'map:update' 事件）。
  // processInitialize 返回的 metadata 只含 saveId/currentLocationId/currentLocationName（不含 newLocations），
  // 额外查询 locationRepo.findBySaveId 获取全部初始地点并映射为 LocationPanelData[]，
  // 构造完整 LocationUpdate 后调 panelUpdateBroadcaster.pushPanelUpdate 推送（source='init'）。
  // 前端经 applyPanelUpdates 三分支调用（state.mapState 不存在时走 subStoreHandlers.onLocationUpdate 分支）。
  const saveId = (result.metadata as Record<string, unknown> | undefined)?.saveId as string | undefined;
  const currentLocationId = (result.metadata as Record<string, unknown> | undefined)?.currentLocationId as string | undefined;
  const currentLocationName = (result.metadata as Record<string, unknown> | undefined)?.currentLocationName as string | undefined;
  if (saveId && currentLocationId) {
    try {
      const locations = await ctx.gameServiceDeps.locationRepo.findBySaveId(saveId);
      const newLocations = locations.map(mapLocationToPanelData);
      ctx.panelUpdateBroadcaster.pushPanelUpdate(
        saveId,
        'location',
        { currentLocationId, currentLocationName, newLocations },
        'init',
      );
    } catch (error) {
      logger.warn('Failed to push initial location panel update', { saveId, error: getErrorMessage(error) });
    }
  }

  const wsResult: WSGameResult = {
    type: 'game:result',
    requestId,
    module: 'game',
    data: {
      success: true,
      data: result.data,
      metadata: result.metadata,
    },
    intentHint: intentHint || 'initialize',
  };
  webSocketService.sendToClient(ws, wsResult);
  // 模块I: 响应已发送，清理 pending 请求
  webSocketService.completePendingRequest(requestId);
}

/** WS 加载存档处理：加载存档 + 故事历史 + 订阅 */
async function handleWSLoad(
  ctx: GameHandlerContext,
  request: WSGameRequest,
  ws: WebSocket,
): Promise<void> {
  const { requestId, intentHint, payload } = request;
  const { webSocketService } = ctx;
  const saveId = (payload as unknown as GameLoadPayload).saveId;

  if (!saveId) {
    sendError(webSocketService, ws, requestId, 'SAVE_ID_REQUIRED', 'saveId is required', true);
    return;
  }

  const saveService = ctx.saveService;
  const storyEventRepo = new StoryEventRepository(ctx.db);
  const agentContextRepo = new AgentContextRepository(ctx.db);
  const saveRepo = new SaveRepository(ctx.db);
  const txManager = new KnexTransactionManager(ctx.db);
  const storyService = new StoryService(storyEventRepo, agentContextRepo, saveRepo, txManager);

  const [saveData, storyHistory] = await Promise.all([
    saveService.loadSave(saveId),
    storyService.getHistory(saveId, { page: 1, pageSize: 20 }),
  ]);

  // v2 模块H H11: 无效 saveId 不再返回 success: true，前端能正确感知错误
  if (!saveData) {
    sendError(webSocketService, ws, requestId, 'SAVE_NOT_FOUND', `Save not found: ${saveId}`, true, 'game');
    return;
  }

  // 订阅客户端到 saveId，接收后续广播事件
  webSocketService.subscribeClient(ws, saveId);

  const wsResult: WSGameResult = {
    type: 'game:result',
    requestId,
    module: 'game',
    data: {
      success: true,
      data: { save: saveData, storyHistory },
      metadata: { isLoad: true },
    },
    intentHint: intentHint || 'load',
  };
  webSocketService.sendToClient(ws, wsResult);
  // 模块I: 响应已发送，清理 pending 请求
  webSocketService.completePendingRequest(requestId);
}

/** WS 对话处理：解析参数 → 调用共享服务 → 通过WS发送响应 */
async function handleWSChat(
  ctx: GameHandlerContext,
  request: WSGameRequest,
  ws: WebSocket,
): Promise<void> {
  const { requestId, action = 'chat', intentHint, payload } = request;
  const { webSocketService } = ctx;
  const { message, saveId, data, npcId, targetNpcIds, playerAction, context, dataChanges } = payload as unknown as GameChatPayload;
  // v2 新增: 获取 clientId 用于进度事件广播
  const clientId = webSocketService.getClientIdByWs(ws) ?? undefined;

  const result = await processChat(
    { coordinatorAgent: ctx.coordinatorAgent, db: ctx.db, ...ctx.gameServiceDeps },
    {
      message,
      saveId,
      action,
      data,
      npcId,
      targetNpcIds,
      playerAction,
      context,
      dataChanges,
      requestId,
      clientId,
    },
  );

  if (!result.success) {
    if (result.errorCode === 'INPUT_BLOCKED') {
      sendError(webSocketService, ws, requestId, 'INPUT_BLOCKED', result.error || '输入异常', true);
      return;
    }
    const recoverable = result.errorCode === 'SAVE_ID_REQUIRED' || result.errorCode === 'SAVE_NOT_FOUND';
    sendError(webSocketService, ws, requestId, result.errorCode ?? 'UNKNOWN_ERROR', result.error ?? 'Unknown error', recoverable);
    return;
  }

  // partialSuccess 场景
  if (result.metadata?.partialSuccess) {
    const wsResult: WSGameResult = {
      type: 'game:result',
      requestId,
      module: 'game',
      data: { ...result.data, metadata: { partialSuccess: true } },
      intentHint,
    };
    webSocketService.sendToClient(ws, wsResult);
    // 模块I: 响应已发送，清理 pending 请求
    webSocketService.completePendingRequest(requestId);
    return;
  }

  const wsResult: WSGameResult = {
    type: 'game:result',
    requestId,
    module: 'game',
    data: {
      ...result.data,
      metadata: result.metadata,
    },
    intentHint,
  };
  webSocketService.sendToClient(ws, wsResult);
  // 模块I: 响应已发送，清理 pending 请求
  webSocketService.completePendingRequest(requestId);
}
