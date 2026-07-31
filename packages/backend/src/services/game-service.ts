/**
 * Game Service — HTTP 与 WS 共享的业务逻辑层
 *
 * 从 routes/game.ts 和 ws-request-handler.ts 中提取的共享业务逻辑，
 * 确保 HTTP 路径和 WS 路径执行完全相同的游戏处理流程。
 */

import { randomUUID } from 'crypto';
import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { ISaveProvider } from '../game-systems/save/types.js';
// P0-2: CharacterService 改为 type import（GameServiceDeps 字段类型，不再 new 实例）
import type { CharacterService } from '../game-systems/character/CharacterService.js';
import { normalizeExplicitNpcId } from '../utils/npc-utils.js';
import { config } from '../utils/config.js';
import type { AgentMessage } from '../../../shared/src/types/agent.js';
import type { ExecutionTraceIds } from '../../../shared/src/types/execution-trace.js';
import { ID, Timestamp } from '../../../shared/src/types/core.js';
import type { Gender } from '../../../shared/src/types/game.js';
import type { Knex } from 'knex';
import type { AgentRuntime } from '../agents/AgentRuntime.js';
// P0-2: 端口接口导入（消除 game-service 直接 db 调用）
import type { ITransactionManager } from '../database/TransactionManager.js';
import type { ILocationRepository, ILocationConnectionRepository } from '../game-systems/map/types.js';
import type { ICombatHistoryRepository, ICombatRepository } from '../game-systems/combat/types.js';
import type { IDialogueRepository } from '../game-systems/dialogue/types.js';
import type { ICharacterSkillRepository, ISkillService } from '../game-systems/skill/types.js';
import type { IQuestRepository } from '../game-systems/quest/types.js';
import type { INPCRepository } from '../game-systems/npc/types.js';
import type { IInventoryRepository } from '../game-systems/inventory/types.js';
import type { IEntityGraphRepository, EntityGraphBuildContext } from '../game-systems/entity-graph/types.js';
import type { EntityGraphBuilder } from '../game-systems/entity-graph/EntityGraphBuilder.js';
import type { ICharacterRepository } from '../game-systems/character/types.js';
import type { ISaveRepository } from '../game-systems/save/types.js';
// 阶段四调整: G2 程序执行层 + ModeRouter 端口接口（type import，跨层 type import 合法）
// 原 ChallengeOrchestrator 拆分为 ChallengeProgram（纯程序执行）+ 服务层 E 路由编排
import type { IChallengeProgram } from '../programs/types.js';
import type { IModeRouter } from '../game-systems/shared/mode-router/types.js';
// 阶段三新增: G2 路径 StagingKnex 代理 + 请求级 Service 缓存（value import，组合根合法）
import { createStagingKnex } from '@ai-rpg/shared/tool-core';
import { RequestScope } from '../services/RequestScope.js';
// 2026-07-25 修复 B5: 请求级锁（saveId 串行化，防止 TOCTOU 竞态）
import { saveRequestLock } from '../services/SaveRequestLock.js';
// 阶段三新增: G2 路径挑战类型 + ToolContext（type import）
import type { ChallengeAction, ChallengeStepResult, ToolContext } from '@ai-rpg/shared';
import type { IStagingPool, IShadowStateLayer } from '@ai-rpg/shared/tool-core';
// 阶段四调整: G2 路径挑战模式 + 结束结果类型（type import，用于 NON_COMBAT_MODES + buildEndSummary）
import type { ChallengeMode, ChallengeEndResult } from '@ai-rpg/shared';

const logger = createChildLogger('game-service');

/**
 * 非战斗挑战模式拦截清单（DF-010 修复，从 ChallengeOrchestrator 迁移）
 *
 * 这些模式不走 G2 快速路径，由 Agent G 路径处理（GM 全权控制）：
 * - narrative_combat: GM 全权控制所有要素
 * - puzzle: 本次设计仅预留类型，未实现策略
 * - mini_game: 同上
 * - stealth: 同上
 */
const NON_COMBAT_MODES: ReadonlySet<ChallengeMode> = new Set([
  'narrative_combat',
  'puzzle',
  'mini_game',
  'stealth',
]);

/**
 * 挑战结束路由到 Agent 的载荷（替代原 OrchestratorStepResult.agentPayload）
 *
 * 期望效果：
 * - endResult：挑战结束结果（含 rewards）
 * - summary：结束摘要（供 Agent 快速理解发生了什么）
 */
interface ChallengeEndPayload {
  endResult: ChallengeEndResult;
  summary: string;
}

// ─── 类型定义 ───────────────────────────────────────────────

/**
 * rollbackSave 所需的 13 个 Repository 容器（覆盖 16 张表，entity_graph 4 表由同一 Repository 处理）。
 * P0-2: 消除 rollbackSave 直接 db delete，改为端口接口调用。
 * EG-M1-7: entityGraphRepo.deleteBySaveId 显式删除 4 张表（edges + nodes + boundaries + snapshots）。
 * D9: 所有 Repository 支持 trx 参数，在单个事务内执行保证原子性。
 */
export interface RollbackRepos {
  combatHistoryRepo: ICombatHistoryRepository;       // 1. combat_history
  combatStateRepo: ICombatRepository;                // 2. combat_states
  dialogueRepo: IDialogueRepository;                 // 3. dialogues
  characterSkillRepo: ICharacterSkillRepository;     // 4. character_skills
  questRepo: IQuestRepository;                       // 5. quests
  // 模块2 简化：删除 npcRelationRepo 字段（npc_relations 表已删除）
  npcRepo: INPCRepository;                           // 7. npcs
  inventoryRepo: IInventoryRepository;               // 8. inventory
  locationConnectionRepo: ILocationConnectionRepository; // 9. location_connections
  locationRepo: ILocationRepository;                 // 10. locations
  entityGraphRepo: IEntityGraphRepository;           // 11-13. entity_graph_edges + entity_graph_nodes + entity_graph_snapshots (模块3: information_boundaries 已删除)
  characterRepo: ICharacterRepository;               // 15. characters
  saveRepo: ISaveRepository;                         // 16. saves
}

/**
 * game-service 共享依赖（processInitialize + processChat 都需要）。
 * P0-2: 消除 game-service 直接 db 调用，改为端口接口注入。
 */
export interface GameServiceDeps {
  /**
   * P0-2: processInitialize 需要 createCharacter/getCharacter/updateLocationId。
   * 用 CharacterService 具体类而非 ICharacterService 端口接口，因 createCharacter
   * 是初始化路径的"创建"操作，不属于跨领域消费方所需的端口接口方法。
   * game-service 是服务层 E，依赖业务层 F 的具体类合法（向下依赖）。
   */
  characterService: CharacterService;
  /** P0-2: processInitialize 3 处 db 调用改为 LocationRepository + CharacterService API */
  locationRepo: ILocationRepository;
  /** S5: SaveService 端口接口注入（消除 game-service 内 new SaveService(db)） */
  saveService: ISaveProvider;
  /** P0-2: validateSkillUsage 迁移到 SkillService.validateUsage */
  skillService: ISkillService;
  /** P0-2: rollbackSave 14 表拆解到 Repository */
  rollbackRepos: RollbackRepos;
  /** P0-2: rollbackSave 在单事务内执行保证原子性 */
  txManager: ITransactionManager;
  /**
   * EG-M1-3: EntityGraphBuilder 全量图构建器（必填，无 ? 可选标记）。
   * processInitialize 在 ReAct flush 后调用 enrichFromExistingData 补充基础图。
   * 缺失注入时 TypeScript 编译错误（避免静默降级为新存档不构建基础图）。
   */
  entityGraphBuilder: EntityGraphBuilder;
  /**
   * EG-M1-3: EntityGraphBuildContext 11 个跨领域 ReadPort 聚合（必填）。
   * 供 EntityGraphBuilder.enrichFromExistingData 读取已落库的业务表数据。
   */
  entityGraphBuildContext: EntityGraphBuildContext;
  /**
   * 阶段四调整: ChallengeProgram 实例（G2 程序执行层，供 handleProgramAction 路由编排调用）。
   *
   * 期望效果：
   * - -program 后缀 action 分流到 G2 路径（非 LLM 快速路径）
   * - G2 路径不调用 LLM，委托 ICombatServiceTool 执行战斗回合
   * - 服务层 E 组合 ChallengeProgram 的多个方法实现路由编排
   * - G2 检测结束时同步切换到 Agent 路径（DF-024 修复）
   *
   * 设计变更（fractal-design-20260724-g2-program-execution-layer）:
   * - 原 ChallengeOrchestrator.executeStep 混合"程序执行 + 路由编排"
   * - 拆分后 ChallengeProgram 只做纯程序执行（queryState/executeTurn/checkEnd/collectEndResult）
   * - 路由编排（状态校验 + 结束检测 + routeToAgent 判定）迁移到服务层 E handleProgramAction
   */
  challengeProgram: IChallengeProgram;
  /**
   * 阶段三新增: ModeRouter 实例（game_mode + intentHint → candidateAgentTypes）。
   *
   * 期望效果：
   * - handleChat 入口兜底判定（仅当 action 无 -program/-LLM 后缀时）
   * - 根据 save.game_mode + save.active_challenge_mode 路由到候选 Agent
   * - challengeMode 为战斗模式时切换到 G2 路径
   */
  modeRouter: IModeRouter;
}

/** processInitialize 的依赖注入 */
export interface InitializeDeps extends GameServiceDeps {
  coordinatorAgent: AgentRuntime;
  db: Knex;
}

/** processInitialize 的请求参数 */
export interface InitializeParams {
  templateId: string;
  characterData: {
    name: string;
    gender: string;
    race: string;
    classType: string;
    background: string;
    attributes: Record<string, number>;
    [key: string]: unknown;
  };
  language?: string;
  requestId?: string;
  /** v2 新增: 发起请求的 WS 客户端 ID，用于进度事件广播 */
  clientId?: string;
  /** save 创建后的回调，用于在 Agent 执行前 subscribe WS 客户端 */
  onSaveCreated?: (saveId: string) => void;
}

/** processChat 的依赖注入 */
export interface ChatDeps extends GameServiceDeps {
  coordinatorAgent: AgentRuntime;
  db: Knex;
}

/** processChat 的请求参数 */
export interface ChatParams {
  message: string;
  saveId: string;
  action: string;
  data?: Record<string, unknown>;
  npcId?: string;
  targetNpcIds?: string[];
  playerAction?: Record<string, unknown>;
  context?: unknown;
  dataChanges?: unknown;
  requestId?: string;
  /** v2 新增: 发起请求的 WS 客户端 ID，用于进度事件广播 */
  clientId?: string;
}

/** 共享服务返回的统一结果 */
export interface ServiceResult {
  success: boolean;
  data?: Record<string, unknown>;
  errorCode?: string;
  error?: string;
  metadata?: {
    saveId?: ID;
    characterId?: string;
    isInitialization?: boolean;
    processingTime?: number;
    messageId?: string;
    processedAt?: string;
    partialSuccess?: boolean;
    skillValidationFailed?: boolean;
    // 阶段三新增: G2 路径元数据
    challengeEnded?: boolean;
    challengeResult?: 'victory' | 'defeat' | 'flee' | 'draw';
    routeToAgent?: boolean;
    /** 阶段五新增：当前挑战模式（供前端 UI 感知） */
    challengeMode?: ChallengeMode | null;
  };
}

// ─── processInitialize ──────────────────────────────────────

/**
 * 处理初始化请求：阶段A（确定性操作）→ 派发Agent（阶段B+C）
 *
 * 进度回传已通过 report_progress Hook 自动触发，无需手动回调
 */
export async function processInitialize(
  deps: InitializeDeps,
  params: InitializeParams,
): Promise<ServiceResult> {
  const { coordinatorAgent, characterService, locationRepo, saveService, rollbackRepos, txManager, entityGraphBuilder, entityGraphBuildContext } = deps;
  const { templateId, characterData, language, requestId, clientId } = params;
  let createdSaveId: ID | undefined;

  // 前置校验：templateId 必填
  if (!templateId) {
    return {
      success: false,
      errorCode: 'TEMPLATE_ID_REQUIRED',
      error: 'templateId is required for initialization',
      data: { action: 'initialize' },
    };
  }

  // 前置校验：characterData 必填字段
  const requiredFields = ['name', 'gender', 'race', 'classType', 'background', 'attributes'];
  const missingFields = requiredFields.filter(f => !characterData?.[f]);
  if (missingFields.length > 0) {
    return {
      success: false,
      errorCode: 'INVALID_CHARACTER_DATA',
      error: `Missing required fields: ${missingFields.join(', ')}`,
      data: { missingFields },
    };
  }

  try {
    // === 阶段A：游戏业务层确定性操作 ===

    // A0: 创建Save记录
    const characterName = characterData.name || '新游戏';
    const save = await saveService.createSave(characterName, templateId, 'text_adventure');
    createdSaveId = save.id as ID;
    logger.info('A0: Save record created', { saveId: createdSaveId, templateId });

    // 通知调用方 save 已创建（用于 WS subscribe），确保 Agent 进度事件能被客户端接收
    params.onSaveCreated?.(createdSaveId as string);

    // A1: 创建角色（玩家手动填写的确定性数据）
    // P0-2: 改为从 deps 获取 characterService（构造函数已改为 Repository 注入模式，
    // 不再在 processInitialize 内部 new NumericalService/CharacterService）
    const character = await characterService.createCharacter({
      saveId: createdSaveId,
      name: characterData.name,
      gender: characterData.gender as Gender,
      race: characterData.race,
      classType: characterData.classType,
      background: characterData.background,
      attributes: characterData.attributes,
    });
    const characterId = character.id;
    logger.info('A1: Character created', { characterId, characterName: characterData.name });

    // A1.1: 确保角色节点存在于实体图（初始化豁免，直接写图节点）
    // 【原因】A1 直接写 characters 表不触发 EntityGraphUpdater 派生图节点（初始化豁免路径），
    // 若不显式创建，ReAct 循环 add_item 派生的 OWNS 边会指向不存在的 character 节点，
    // 导致 flushWithAudit 审计失败（owner node missing），存档被回滚。
    // 【初始化豁免】符合 §13.1 第4点——非 Agent 路径显式豁免 StagingPool。
    await entityGraphBuilder.ensureCharacterNode(createdSaveId as string, character);
    logger.info('A1.1: Character node ensured in entity graph', { saveId: createdSaveId, characterId });

    // === 构建请求级 traceIds ===
    const requestTraceIds: Partial<ExecutionTraceIds> = {
      requestId: requestId ?? 'unknown',
      sessionId: createdSaveId as string,
    };

    // === 构建AgentMessage，只传递索引，不传模板数据 ===
    const agentMessageData: Record<string, unknown> = {
      saveId: createdSaveId,
      templateId,
      characterId,
      characterData,
      language: language || 'zh-CN',
      traceIds: requestTraceIds,
    };
    if (requestId) {
      agentMessageData.requestId = requestId;
    }

    const agentMessage: AgentMessage = {
      id: randomUUID() as ID,
      timestamp: Date.now() as Timestamp,
      from: 'game',
      to: 'gamemaster',
      type: 'request',
      saveId: createdSaveId,
      payload: {
        action: 'initialize',
        intentHint: 'initialize',
        data: agentMessageData,
      },
      metadata: {
        priority: 'normal',
        requiresResponse: true,
        timeout: config.timeout.chat,
        // v2 新增: 注入 WS 请求元信息，供 processMessage 入口创建 ProgressContext
        _wsRequestId: requestId,
        _wsClientId: clientId,
      },
    };

    // === 阶段B+C：交给Agent处理创造性操作 ===
    // v2 模块F D5: 请求级实例化——每个请求创建独立的 GM Agent 副本，不复用单例
    const scopedCoordinator = coordinatorAgent.createRequestScopedCopy() as AgentRuntime;
    const response = await scopedCoordinator.processMessage(agentMessage);

    if (!response.success) {
      if (createdSaveId) {
        await rollbackSave(rollbackRepos, txManager, createdSaveId);
      }
      return {
        success: false,
        errorCode: response.errorCode ?? 'GAME_INIT_FAILED',
        error: response.error ?? '游戏初始化失败',
        data: response.data as Record<string, unknown> | undefined,
      };
    }

    // EG-M1-4: 全量图构建 — 在 ReAct 循环 flush 后补充基础图
    // 【初始化豁免】enrichFromExistingData 不走 StagingPool（符合 §13.1 第4点"非 Agent 路径显式豁免"）
    // 原因：初始化路径，在 ReAct 循环 flush 后调用，StagingPool 已清空；
    //       图写入使用 upsert 语义（幂等），不需要事务保护；不是 Agent 工具，不参与 ReAct 循环。
    // 时序：processMessage 内部 ReAct 结束后已自动 flush（业务表 + 图更新已落库），
    //       此处读取已落库的业务数据全量构建基础图，补充 EntityGraphUpdater 可能遗漏的节点/边。
    // 错误处理：不捕获 — 若图构建失败说明存在真实缺陷（如 ReadPort adapter 字段映射错误），
    //          必须暴露而非掩盖。模块4 的定期纠错机制负责处理运行时漂移，不负责初始化失败兜底。
    await entityGraphBuilder.enrichFromExistingData(createdSaveId as string, entityGraphBuildContext);
    logger.info('EG-M1-4: EntityGraphBuilder.enrichFromExistingData completed', { saveId: createdSaveId });

    // Agent 完成后，更新角色位置到起始地点
    const currentChar = await characterService.getCharacter(createdSaveId);
    let initLocationId: string | null = currentChar.currentLocationId || null;
    let initLocationName: string | null = null;
    if (!initLocationId) {
      // P0-2: 改为 LocationRepository.findFirstBySaveId（消除 db('locations') 调用）
      const firstLocation = await locationRepo.findFirstBySaveId(createdSaveId);

      if (firstLocation) {
        initLocationId = firstLocation.id;
        initLocationName = firstLocation.name;
        // P0-2: 改为 CharacterService.updateLocationId（消除 db('characters') 调用）
        await characterService.updateLocationId(createdSaveId, firstLocation.id);
        logger.info('Updated character location after init', {
          saveId: createdSaveId,
          locationId: firstLocation.id,
          locationName: firstLocation.name,
        });
      } else {
        logger.error('No locations created after initialization - program error', {
          saveId: createdSaveId,
        });
        return {
          success: false,
          errorCode: 'NO_LOCATIONS_CREATED',
          error: '游戏初始化失败：未创建任何地点',
        };
      }
    } else {
      // 角色已有位置，获取位置名称
      // P0-2: 改为 LocationRepository.findById（消除 db('locations') 调用，同时加 save_id 过滤更安全）
      const loc = await locationRepo.findById(initLocationId, createdSaveId);
      if (loc) initLocationName = loc.name;
    }

    return {
      success: true,
      data: response.data as Record<string, unknown> | undefined,
      metadata: {
        saveId: createdSaveId,
        characterId,
        isInitialization: true,
        currentLocationId: initLocationId,
        currentLocationName: initLocationName,
      } as Record<string, unknown>,
    };
  } catch (error) {
    if (createdSaveId) {
      await rollbackSave(rollbackRepos, txManager, createdSaveId);
    }
    throw error;
  }
}

// ─── processChat ────────────────────────────────────────────

/**
 * 处理对话请求：对话持久化 → 派发Agent
 *
 * HTTP 和 WS 路径共享此逻辑，区别仅在于：
 * - WS 路径传入 requestId 以注入到 AgentMessage
 */
export async function processChat(
  deps: ChatDeps,
  params: ChatParams,
): Promise<ServiceResult> {
  const { coordinatorAgent, characterService, saveService, skillService, modeRouter } = deps;
  const { message, saveId, action = 'chat', data, npcId, targetNpcIds, playerAction, context, dataChanges, requestId, clientId } = params;
  const startTime = Date.now();

  // 1. 验证Save
  if (!saveId) {
    return {
      success: false,
      errorCode: 'SAVE_ID_REQUIRED',
      error: 'saveId is required',
      data: { action },
    };
  }
  const saveRecord = await saveService.getSave(saveId);
  if (!saveRecord) {
    return {
      success: false,
      errorCode: 'SAVE_NOT_FOUND',
      error: `Save not found: ${saveId}`,
      data: { saveId },
    };
  }

  // 阶段三新增: 路由分流 - -program 后缀 action 走 G2 快速路径
  // - -program: 路由 B → 服务层 E handleProgramAction → G2 ChallengeProgram（非 LLM 快速路径）
  // - chat / -LLM 后缀: 路由 B → 服务层 E → Agent G（保持原路径）
  // - 无后缀: 由 ModeRouter 兜底判定（见 step 1b）
  if (action.endsWith('-program')) {
    return await handleProgramAction(deps, params, startTime);
  }

  // 阶段三新增: ModeRouter 兜底判定（仅当 action 无 -program/-LLM 后缀时调用）
  // 期望效果：根据 save.game_mode + save.active_challenge_mode 推断 challengeMode
  // - challengeMode 为战斗模式（turn_based_combat / dynamic_combat）→ 切换到 G2 路径
  // - challengeMode 不存在或为非战斗模式 → 走常规 Agent 路径（保持原 processMessage 调用）
  // 注：ModeRouter 仅做"是否切换到 G2"的判定，不修改原 Agent 路径行为
  // 2026-07-25 修复 B3: 移除静默降级 fallback（违反"禁止 fallback 掩盖缺陷"原则）
  // ModeRouter 是纯查询，save 已在入口验证存在，失败只能是程序 BUG，必须让错误冒泡
  const isAgentPath = action === 'chat' || action.endsWith('-LLM');
  if (!isAgentPath) {
    const routeResult = await modeRouter.routeMode(saveId as ID, action);
    if (
      routeResult.challengeMode === 'turn_based_combat' ||
      routeResult.challengeMode === 'dynamic_combat'
    ) {
      // 切换到 G2 路径（ModeRouter 兜底判定）
      return await handleProgramAction(deps, params, startTime);
    }
  }

  // 2. 创建请求作用域 Agent
  // v2 模块H H12: coordinatorAgent null 时先不发消息入库，直接返回错误
  if (!coordinatorAgent) {
    return {
      success: false,
      errorCode: 'AGENT_UNAVAILABLE',
      error: 'Agent system not available',
      data: { saveId },
    };
  }
  const scopedCoordinator = coordinatorAgent.createRequestScopedCopy() as AgentRuntime;
  const requestRuntime = await coordinatorAgent.createRequestRuntime(saveId as ID);
  scopedCoordinator.applyRequestScope({
    stagingPool: requestRuntime.stagingPool,
    shadowState: requestRuntime.shadowState,
  });
  // NOTE: select_option 仅 HTTP 兼容路径，WS 路径下 action='dialogue-LLM'
  const playerNpcId = (action === 'select_option' || action === 'dialogue-LLM')
    ? normalizeExplicitNpcId(playerAction?.targetNpcId as string | undefined)
    : (normalizeExplicitNpcId(npcId) ?? targetNpcIds?.[0]);
  // P0-2: 改为 characterService.getCharacter（消除 db('characters') 直接调用）
  const characterData = await characterService.getCharacter(saveId as ID);
  const playerSpeaker = characterData?.name || 'player';

  // 3. 对话持久化（通过 StagingPool 统一写入）
  try {
    await requestRuntime.stagingPool.stage({
      table: 'dialogues',
      operation: 'insert',
      data: {
        id: `dlg_${playerNpcId || 'player'}_${Date.now()}`,
        save_id: saveId,
        npc_id: playerNpcId || null,
        speaker: playerSpeaker,
        content: message,
        emotion: 'neutral',
        message_type: 'player',
        timestamp: Date.now(),
      },
      where: {},
      toolType: 'game_route',
      method: 'player_message',
      source: 'gamemaster',
    });
  } catch (dialogueError) {
    logger.warn('Failed to save player message', { saveId, error: getErrorMessage(dialogueError) });
  }

  // 4. select_option 数据提升：将 data.optionId 提升为 playerAction.selectedOptionId，回填 npcId
  // NOTE: 此逻辑仅服务于 HTTP 兼容路径（测试脚本），WS 路径下 action='dialogue-LLM'，
  // 数据提升由 preprocessAction 中的 selectedDialogueOption 组装完成
  let enrichedPlayerAction = playerAction;
  if (action === 'select_option') {
    const optionId = data?.optionId as string | undefined;
    const optionText = data?.optionText as string | undefined;
    enrichedPlayerAction = {
      ...(playerAction || {}),
      ...(optionId ? { selectedOptionId: optionId } : {}),
      ...(optionText ? { optionText } : {}),
      // 强制归一 type 为 select_option（覆盖 playerAction 中可能存在的其他 type）
      type: 'select_option',
    };
    // 回填目标NPC：优先 playerAction.targetNpcId，其次顶层 npcId
    if (!(enrichedPlayerAction as Record<string, unknown>).targetNpcId && npcId) {
      (enrichedPlayerAction as Record<string, unknown>).targetNpcId = npcId;
    }
  }

  // 5. use_skill 前置校验：资源不足时直接返回对话消息，不走 Agent
  // NOTE: `action === 'ui_interaction'` 分支仅服务于 HTTP 兼容路径（测试脚本），
  // WS 路径下 action='skill-LLM'，不会命中 ui_interaction 分支
  const isUseSkill = action === 'use_skill' ||
    (action === 'ui_interaction' && data?.interactionType === 'use_skill') ||
    action === 'skill-LLM';
  if (isUseSkill) {
    const skillId = data?.skillId as string | undefined;
    const skillName = data?.skillName as string | undefined;

    if (skillId || skillName) {
      // P0-2: 改为 SkillService.validateUsage（消除 game-service 直接 db 调用）
      const validationError = await skillService.validateUsage(saveId, skillId, skillName);
      if (validationError) {
        await coordinatorAgent.flushRequestRuntime(requestRuntime);
        return {
          success: true,
          data: {
            dialogue: {
              messages: [
                {
                  speaker: playerSpeaker,
                  content: message,
                  emotion: 'neutral',
                  messageType: 'player',
                },
                {
                  speaker: '系统',
                  content: validationError,
                  emotion: 'neutral',
                  messageType: 'system',
                },
              ],
            },
            panelUpdates: {
              type: 'skill_validation_failed',
              message: validationError,
            },
          },
          metadata: { skillValidationFailed: true },
        };
      }
    }
  }

  // 6. 构建请求级 traceIds
  const requestTraceIds: Partial<ExecutionTraceIds> = {
    requestId: requestId ?? 'unknown',
    sessionId: saveId as string,
  };

  // 7. 构建AgentMessage（不设置 intentHint，由 preprocessAction 统一推断）
  const requestData: Record<string, unknown> = {
    ...(data || {}),
    ...(saveId != null ? { saveId } : {}),
    playerInput: message,
    playerSpeaker,
    ...(npcId ? { npcId } : {}),
    ...(targetNpcIds ? { targetNpcIds } : {}),
    ...(context ? { context } : {}),
    ...(enrichedPlayerAction ? { playerAction: enrichedPlayerAction } : {}),
    ...(dataChanges ? { dataChanges } : {}),
    traceIds: requestTraceIds,
  };
  if (requestId) {
    requestData.requestId = requestId;
  }

  const agentMessage: AgentMessage = {
    id: randomUUID() as ID,
    timestamp: Date.now() as Timestamp,
    from: 'game',
    to: 'gamemaster',
    type: 'request',
    saveId: saveId as ID,
    payload: { action, data: requestData },
    metadata: {
      priority: 'normal',
      requiresResponse: true,
      timeout: config.timeout.chat,
      // v2 新增: 注入 WS 请求元信息，供 processMessage 入口创建 ProgressContext
      _wsRequestId: requestId,
      _wsClientId: clientId,
    },
  };

  // 8. 调用Agent处理（玩家消息回声由 AgentRuntime.buildPlayerDialogueEcho 处理，通过 panelUpdates.dialogue 推送）
  const response = await scopedCoordinator.processMessage(agentMessage);

  if (!response.success) {
    const responseData = response.data;
    if (responseData?.blocked) {
      return {
        success: false,
        errorCode: 'INPUT_BLOCKED',
        error: response.error || '输入异常',
        data: { category: responseData.category },
      };
    }
    return {
      success: true,
      data: { ...response, metadata: { partialSuccess: true } } as Record<string, unknown>,
      metadata: { partialSuccess: true },
    };
  }

  return {
    success: true,
    data: response.data as Record<string, unknown> | undefined,
    metadata: {
      processingTime: Date.now() - startTime,
      messageId: agentMessage.id,
      processedAt: new Date().toISOString(),
      challengeMode: (saveRecord.active_challenge_mode as ChallengeMode | null | undefined) ?? null,
    },
  };
}

// ─── 辅助函数 ───────────────────────────────────────────────

/**
 * 回滚存档及其所有关联记录。
 * P0-2: 14 处直接 db delete 拆解到 13 个领域 Repository（entity_graph_edges+nodes 由同一 Repository 处理），
 * 在单个事务内执行保证原子性。
 * 删除顺序保持原有依赖顺序（最依赖的先删）。
 */
export async function rollbackSave(
  repos: RollbackRepos,
  txManager: ITransactionManager,
  saveId: ID,
): Promise<void> {
  try {
    await txManager.transaction(async (trx) => {
      // Delete in reverse dependency order (most dependent first)
      await repos.combatHistoryRepo.deleteBySaveId(saveId, trx);       // 1. combat_history
      await repos.combatStateRepo.deleteBySaveId(saveId, trx);         // 2. combat_states
      await repos.dialogueRepo.deleteBySaveId(saveId, null, trx);      // 3. dialogues (npcId=null 删除全部)
      await repos.characterSkillRepo.deleteBySaveId(saveId, trx);      // 4. character_skills
      await repos.questRepo.deleteBySaveId(saveId, trx);               // 5. quests
      // 模块2 简化：删除 npcRelationRepo.deleteBySaveId 调用（npc_relations 表已删除）
      await repos.npcRepo.deleteBySaveId(saveId, trx);                 // 7. npcs
      await repos.inventoryRepo.deleteBySaveId(saveId, trx);           // 8. inventory
      await repos.locationConnectionRepo.deleteBySaveId(saveId, trx);  // 9. location_connections
      await repos.locationRepo.deleteBySaveId(saveId, trx);            // 10. locations
      await repos.entityGraphRepo.deleteBySaveId(saveId, trx);         // 11-13. entity_graph_edges + entity_graph_nodes + entity_graph_snapshots (模块3: information_boundaries 已删除)
      await repos.characterRepo.deleteBySaveId(saveId, trx);           // 15. characters
      await repos.saveRepo.deleteBySaveId(saveId, trx);                // 16. saves
    });
    logger.info('Rolled back save and all related records', { saveId });
  } catch (rollbackError) {
    logger.error('Failed to rollback save record', { saveId, error: getErrorMessage(rollbackError) });
  }
}

// ─── 阶段三: G2 路径处理（-program 后缀 action + ModeRouter 兜底切换） ───

/**
 * G2 请求运行时类型（从 AgentRuntime.createRequestRuntime 返回值推断）
 *
 * 期望效果：
 * - 持有 stagingPool + shadowState 供 G2 和 Agent 共享
 * - handleProgramAction 创建 → handleChallengeEnd 复用 → finally flush
 */
type G2RequestRuntime = Awaited<ReturnType<AgentRuntime['createRequestRuntime']>>;

/**
 * 处理 -program 后缀 action（G2 快速路径编排）
 *
 * 期望效果（fractal-design-20260724-g2-program-execution-layer §5.1）:
 * - 1. 创建请求级 StagingPool + ShadowState（与 Agent 路径同一实例，DF-026 修复）
 * - 2. 解析 ChallengeAction（从 data.challengeAction 或 playerAction）
 * - 3. 构建 ToolContext（含 StagingKnex 代理 db，DF-034 修复）
 * - 4. 状态查询 + 校验（challengeProgram.queryState，路由编排职责）
 * - 5. 程序执行（challengeProgram.executeTurn，G2 纯程序执行，不调 LLM）
 * - 6. 检查结束（challengeProgram.checkEnd，路由编排职责）
 * - 7a. ended=true → 收集数据（challengeProgram.collectEndResult）+ 调用 handleChallengeEnd 切换到 Agent 路径
 * - 7b. ended=false → formatOrchestratorResult 返回数值结果
 * - 8. 成功路径显式 flush（失败路径不 flush，避免脏数据落盘）
 *
 * 架构约束:
 * - 服务层 E 承担路由编排职责（状态校验 + 结束检测 + routeToAgent 判定）
 * - G2 层 ChallengeProgram 仅做纯程序执行（不调 LLM，不持有状态）
 * - StagingPool per-request 生命周期，G2 和 Agent 共享同一实例
 *
 * 错误场景:
 * - challengeAction 缺失 → 返回 INVALID_CHALLENGE_ACTION 错误（不 flush）
 * - challengeProgram 抛错 → 返回 G2_ORCHESTRATION_FAILED 错误（不 flush，丢弃 StagingPool 部分写入）
 *
 * Flush 策略（fractal-analyzer P1-4 修复）:
 * - handleChallengeEnd 路径：processMessage 内部已 flush StagingPool，无需重复 flush
 * - 未结束路径：显式 flush G2 写入到 DB
 * - 失败路径：不 flush，StagingPool 实例随请求结束被 GC，部分写入不落盘
 */
async function handleProgramAction(
  deps: ChatDeps,
  params: ChatParams,
  startTime: number,
): Promise<ServiceResult> {
  const { coordinatorAgent, challengeProgram } = deps;
  const { saveId } = params;
  const saveIdTyped = saveId as ID;

  // 2026-07-25 修复 B5: saveId 级请求锁，防止 queryState → executeTurn 之间的 TOCTOU 竞态
  // 同一 saveId 的并发请求串行执行；不同 saveId 并行不影响性能
  return saveRequestLock.withLock(saveIdTyped, async () => {
  // 1. 创建请求级 StagingPool + ShadowState（与 Agent 路径同一实例）
  const requestRuntime = await coordinatorAgent.createRequestRuntime(saveIdTyped);
  const scopedCoordinator = coordinatorAgent.createRequestScopedCopy() as AgentRuntime;
  scopedCoordinator.applyRequestScope({
    stagingPool: requestRuntime.stagingPool,
    shadowState: requestRuntime.shadowState,
  });

  // 2026-07-25 修复 B4: 阶段跟踪 + 显式 clear + 错误码细分
  // 失败路径必须显式 clear StagingPool，避免脏数据残留影响下一次请求
  // 错误码细分让调用方可以区分失败阶段（状态查询/执行/结束判定）
  let stage: 'state_query' | 'execute' | 'end_check' | 'collect_end' = 'state_query';

  try {
    // 2. 解析 ChallengeAction
    const challengeAction = parseChallengeAction(params);
    if (!challengeAction) {
      return {
        success: false,
        errorCode: 'INVALID_CHALLENGE_ACTION',
        error: '-program action 缺少 challengeAction 数据（期望 data.challengeAction 或 playerAction 含 type+actorId）',
        data: { action: params.action, saveId },
      };
    }

    // 3. 构建 ToolContext（含 StagingKnex 代理 db）
    const toolContext = buildG2ToolContext(deps, saveIdTyped, requestRuntime);

    // 4. 状态查询 + 校验（路由编排，从 ChallengeOrchestrator 迁移）
    stage = 'state_query';
    const state = await challengeProgram.queryState(saveIdTyped, toolContext);
    if (!state) {
      throw new Error(`存档 ${saveIdTyped} 未处于挑战中，无法执行步骤`);
    }
    if (!state.active) {
      throw new Error(`存档 ${saveIdTyped} 挑战已结束（state.active=false），无法执行步骤`);
    }
    if (NON_COMBAT_MODES.has(state.mode)) {
      throw new Error(
        `挑战模式 ${state.mode} 不支持 G2 快速路径，请走 Agent G 路径（saveId=${saveIdTyped}）`,
      );
    }

    // 5. 程序执行（G2 纯程序执行，不调 LLM）
    stage = 'execute';
    const stepResult = await challengeProgram.executeTurn(saveIdTyped, challengeAction, toolContext);

    // 6. 检查结束（路由编排）
    stage = 'end_check';
    const endCheck = await challengeProgram.checkEnd(saveIdTyped, toolContext);

    // 7a. 若结束 → 收集数据 + 切换 G 路径（复用同一 StagingPool）
    if (endCheck.ended && endCheck.result) {
      stage = 'collect_end';
      const endResult = await challengeProgram.collectEndResult(
        saveIdTyped,
        endCheck.result,
        toolContext,
      );
      const summary = buildEndSummary(endResult, endCheck.result);
      // processMessage 内部会自己 flush StagingPool（AgentRuntime L1706-1709），无需重复 flush
      return await handleChallengeEnd(
        saveIdTyped,
        { endResult, summary },
        scopedCoordinator,
        startTime,
        params,
        state.mode,
      );
    }

    // 7b. 未结束 → flush G2 写入到 DB，然后返回数值结果给前端
    await coordinatorAgent.flushRequestRuntime(requestRuntime);
    return formatOrchestratorResult(stepResult, saveIdTyped, startTime, params, state.mode);
  } catch (error) {
    // 2026-07-25 修复 B4: 失败路径显式 clear StagingPool + 错误码细分 + 通知调用方
    const stagedWriteCount = requestRuntime.stagingPool.writeCount;
    requestRuntime.stagingPool.clear();

    // 错误码细分：让调用方可以区分失败阶段
    const errorCodeMap = {
      state_query: 'G2_STATE_QUERY_FAILED',
      execute: 'G2_EXECUTE_FAILED',
      end_check: 'G2_END_CHECK_FAILED',
      collect_end: 'G2_COLLECT_END_FAILED',
    } as const;
    const errorCode = errorCodeMap[stage];

    logger.error('handleProgramAction failed', {
      saveId,
      action: params.action,
      stage,
      errorCode,
      stagedWriteCount,
      error: getErrorMessage(error),
    });

    return {
      success: false,
      errorCode,
      error: getErrorMessage(error),
      data: {
        saveId,
        action: params.action,
        // 2026-07-25 修复 B4: 通知调用方有部分写入被丢弃
        partialWritesDiscarded: stagedWriteCount > 0,
        stagedWriteCount,
        failedStage: stage,
      },
    };
  }
  }); // end saveRequestLock.withLock
}

/**
 * G2 检测到挑战结束时切换到 Agent 路径处理剧情
 *
 * 期望效果（code-design §11.6 handleChallengeEnd）:
 * - 1. 校验 agentPayload.endResult 存在
 * - 2. 构造 Agent 上下文消息（挑战结束摘要 + 结果）
 * - 3. 调用 scopedCoordinator.processMessage 携带 intentHint: 'combat_end' + challengeEndResult
 * - 4. 返回 Agent 剧情响应
 *
 * 数据传递（DF-019 修复）:
 * - agentPayload.endResult 作为 agentContext.challengeEndResult 传递
 * - Agent 通过 context.deps.challengeEndResult 读取战斗结束数据
 * - StagingPool 影子状态对 Agent 可见（同请求内共享）
 *
 * 错误场景:
 * - agentPayload.endResult 缺失 → 抛错（挑战结束路由到 Agent 时缺少 endResult）
 * - Agent 处理失败 → 透传错误
 */
async function handleChallengeEnd(
  saveId: ID,
  payload: ChallengeEndPayload,
  scopedCoordinator: AgentRuntime,
  startTime: number,
  params: ChatParams,
  challengeMode: ChallengeMode,
): Promise<ServiceResult> {
  const { requestId, clientId } = params;

  // 1. 校验 payload.endResult 存在（类型已保证，但保留运行时校验语义）
  if (!payload.endResult) {
    throw new Error('挑战结束路由到 Agent 时缺少 endResult（saveId=' + saveId + '）');
  }

  const { endResult, summary } = payload;

  // 2. 构造 Agent 上下文消息
  const agentMessageText = `挑战结束：${summary}。请处理战斗结束后的剧情，结果为 ${endResult.result}。`;

  // 3. 构建请求级 traceIds
  const requestTraceIds: Partial<ExecutionTraceIds> = {
    requestId: requestId ?? 'unknown',
    sessionId: saveId as string,
  };

  // 4. 构建 AgentMessage（携带 intentHint: 'combat_end' + challengeEndResult）
  const requestData: Record<string, unknown> = {
    saveId,
    playerInput: agentMessageText,
    playerSpeaker: 'system',
    traceIds: requestTraceIds,
    // DF-019 修复: challengeEndResult 作为 agentContext 传递给 Agent
    challengeEndResult: endResult,
  };
  if (requestId) {
    requestData.requestId = requestId;
  }

  const agentMessage: AgentMessage = {
    id: randomUUID() as ID,
    timestamp: Date.now() as Timestamp,
    from: 'game',
    to: 'gamemaster',
    type: 'request',
    saveId,
    payload: {
      action: 'chat',
      intentHint: 'combat_end',
      data: requestData,
    },
    metadata: {
      priority: 'normal',
      requiresResponse: true,
      timeout: config.timeout.chat,
      _wsRequestId: requestId,
      _wsClientId: clientId,
    },
  };

  // 5. 调用 Agent 处理（复用同一 StagingPool，DF-026 修复）
  const response = await scopedCoordinator.processMessage(agentMessage);

  if (!response.success) {
    return {
      success: false,
      errorCode: response.errorCode ?? 'CHALLENGE_END_AGENT_FAILED',
      error: response.error ?? '挑战结束剧情处理失败',
      data: response.data as Record<string, unknown> | undefined,
    };
  }

  return {
    success: true,
    data: response.data as Record<string, unknown> | undefined,
    metadata: {
      saveId,
      processingTime: Date.now() - startTime,
      messageId: agentMessage.id,
      processedAt: new Date().toISOString(),
      challengeEnded: true,
      challengeResult: endResult.result,
      challengeMode,
    },
  };
}

/**
 * 构建结束摘要（供 Agent 快速理解发生了什么，从 ChallengeOrchestrator 迁移）
 *
 * 期望效果：
 * - 输入：ChallengeEndResult + result 类型
 * - 输出：人类可读的摘要字符串
 */
function buildEndSummary(
  endResult: ChallengeEndResult,
  result: ChallengeEndResult['result'],
): string {
  const rewards = endResult.rewards;
  const rewardParts: string[] = [];
  if (rewards?.experience) {
    rewardParts.push(`经验 +${rewards.experience}`);
  }
  if (rewards?.currency && Object.keys(rewards.currency).length > 0) {
    const currencyStr = Object.entries(rewards.currency)
      .map(([k, v]) => `${k} +${v}`)
      .join(', ');
    rewardParts.push(currencyStr);
  }

  const rewardText = rewardParts.length > 0 ? `；奖励：${rewardParts.join('，')}` : '';
  return `挑战结束，结果为 ${result}${rewardText}`;
}

/**
 * 格式化 G2 编排器数值结果（挑战未结束时返回给前端）
 *
 * 期望效果（code-design §11.6 formatOrchestratorResult）:
 * - 输入：ChallengeStepResult + saveId + startTime
 * - 输出：ServiceResult 含数值结果（actionResult / sideEffects / combatEnded / hint）
 * - 不调用 Agent，直接返回数值
 */
function formatOrchestratorResult(
  stepResult: ChallengeStepResult,
  saveId: ID,
  startTime: number,
  params: ChatParams,
  challengeMode: ChallengeMode,
): ServiceResult {
  return {
    success: true,
    data: {
      challengeStep: stepResult,
      saveId,
      action: params.action,
    },
    metadata: {
      saveId,
      processingTime: Date.now() - startTime,
      processedAt: new Date().toISOString(),
      routeToAgent: false,
      challengeMode,
    },
  };
}

/**
 * 从请求参数解析 ChallengeAction
 *
 * 期望效果:
 * - 优先从 data.challengeAction 解析（显式结构化传递）
 * - 回退到 playerAction（若含 type + actorId）
 * - 校验 type 和 actorId 必填（13.3 数据归属保守处理）
 * - 返回 null 表示无法解析（由调用方返回错误）
 *
 * 约束:
 * - actorId 必填（执行者 ID，13.3 数据归属）
 * - type 必填（动作类型）
 * - targetIds / skillId / itemId 支持 name/id 双兼容（13.2）
 */
function isChallengeAction(obj: unknown): obj is ChallengeAction {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return typeof o.type === 'string' && typeof o.actorId === 'string';
}

function parseChallengeAction(params: ChatParams): ChallengeAction | null {
  const { data, playerAction } = params;

  // 优先从 data.challengeAction 解析
  const explicit = data?.challengeAction;
  if (isChallengeAction(explicit)) {
    return explicit;
  }

  // 回退到 playerAction
  if (isChallengeAction(playerAction)) {
    return playerAction;
  }

  return null;
}

/**
 * 构建 G2 路径的 ToolContext（含 StagingKnex 代理 db）
 *
 * 期望效果（DF-034 修复: 统一 StagingKnex 代理方式）:
 * - 使用 createStagingKnex 包装原始 db，拦截写操作到 StagingPool
 * - requestScope.getDb() 返回代理 db，CombatServiceTool 内部 Repository 使用代理 db
 * - stagingPool + shadowState 注入到 context，供 BaseTool.buildEffectiveContext 使用
 *
 * 架构约束:
 * - G2 不直接持有 StagingPool 引用（通过 ToolContext.requestScope.getDb() 间接访问）
 * - StagingKnex 代理读操作先查 ShadowState，再 fallback DB
 * - StagingKnex 代理写操作自动拦截到 stagingPool.stage() + shadowState.apply()
 */
function buildG2ToolContext(
  deps: ChatDeps,
  saveId: ID,
  requestRuntime: G2RequestRuntime,
): ToolContext {
  // 创建 StagingKnex 代理 db（拦截写操作到 StagingPool + ShadowState）
  const stagingDb = createStagingKnex(deps.db, {
    stagingPool: requestRuntime.stagingPool,
    shadowState: requestRuntime.shadowState,
    toolType: 'g2-orchestrator',
    method: 'executeStep',
    source: 'gamemaster',
  });

  // 创建请求级 Service 缓存（持有代理 db）
  const requestScope = new RequestScope(stagingDb);

  return {
    saveId,
    agentType: 'gamemaster',
    timestamp: Date.now() as Timestamp,
    stagingPool: requestRuntime.stagingPool as IStagingPool,
    shadowState: requestRuntime.shadowState as IShadowStateLayer,
    requestScope,
  };
}
