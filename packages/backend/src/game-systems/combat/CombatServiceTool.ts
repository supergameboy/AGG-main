import { BaseTool } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import { ToolType } from '../../../../shared/src/types/agent.js';
import { CombatService } from './CombatService.js';
import { CombatRepository } from './CombatRepository.js';
import { CombatHistoryRepository } from './CombatHistoryRepository.js';
import { KnexTransactionManager } from '../../database/TransactionManager.js';
import { TemplateRuleParser } from '../shared/rule-parser/TemplateRuleParser.js';
import { SaveRepository } from '../save/SaveRepository.js';
import { eventBus } from '@ai-rpg/shared/messaging';
import type { CharacterServiceTool } from '../character/CharacterServiceTool.js';
import type { InventoryServiceTool } from '../inventory/InventoryServiceTool.js';
import type { SkillServiceTool } from '../skill/SkillServiceTool.js';
import type { NumericalServiceTool } from '../numerical/NumericalServiceTool.js';
import type { CombatResult, IChallengeStrategy } from './types.js';
import {
  isChallengeMode,
  FALLBACK_CHALLENGE_MODE,
} from '@ai-rpg/shared';
import type {
  ID,
  ChallengeState,
  ChallengeAction,
  ChallengeStepResult,
  ChallengeEndResult,
  ChallengeMode,
  EnemyStrategy,
} from '@ai-rpg/shared';
import type { ITemplateProvider } from '../shared/types.js';
import {
  NarrativeCombatStrategy,
  TurnBasedCombatStrategy,
  DynamicCombatStrategy,
} from './strategies/index.js';

// ============================================================================
// CombatServiceTool 端口接口（code-design §3.1 末尾，DF-029 修复）
// ============================================================================

/**
 * ChallengeServiceTool 端口接口（供 G2 层 type import）
 *
 * DF-029 修复：定义在工具层 I（CombatServiceTool.ts），不在业务层 F（types.ts）。
 * G2 层 ChallengeProgram 通过此端口接口访问工具层 I，
 * 不暴露 Agent 路径专用方法（如 startCombat 经 Agent 调用）。
 * 仅暴露 G2 路径需要的方法：queryChallengeState / executeTurnForOrchestrator / checkChallengeEnd / collectChallengeData。
 *
 * 架构约束（architecture-standards §1.1）：
 * - 符合"G2 层 → 工具层 I（仅 type import 端口接口）"
 * - G2 层禁止 value import 工具层具体类
 * - G2 层禁止反向依赖 Agent 核心 G / LLM 层 H
 *
 * 期望效果：
 * - G2 层通过此端口接口跨请求查询挑战状态（DB 持久化，非内存）
 * - G2 层执行回合不经过 Agent，返回 ChallengeStepResult
 * - G2 层检测挑战结束 / 收集战斗数据均通过此接口
 */
export interface ICombatServiceTool {
  /** G2 调用：查询挑战状态（从 DB 读取，跨请求可见，DF-021 修复） */
  queryChallengeState(
    saveId: ID,
    context: ToolContext
  ): Promise<ChallengeState | null>;

  /** G2 调用：执行回合（不经过 Agent），返回 ChallengeStepResult */
  executeTurnForOrchestrator(
    saveId: ID,
    action: ChallengeAction,
    context: ToolContext
  ): Promise<ChallengeStepResult>;

  /** G2 调用：检测挑战是否结束（纯查询） */
  checkChallengeEnd(
    saveId: ID,
    context: ToolContext
  ): Promise<{ ended: boolean; result?: ChallengeEndResult['result'] }>;

  /** G2 调用：收集战斗数据（结束时） */
  collectChallengeData(
    saveId: ID,
    result: ChallengeEndResult['result'],
    context: ToolContext
  ): Promise<ChallengeEndResult>;
}

/** 适配 LLM 传入的简化格式 { result: "victory" } → 标准格式 { victory: true, ... } */
export function normalizeCombatResult(raw: unknown): CombatResult {
  if (!raw || typeof raw !== 'object') {
    return { victory: false, fled: false, defeat: true, experience: 0, currency: {}, drops: [], turnsElapsed: 0, participantResults: [] };
  }
  const params = raw as Record<string, unknown>;
  // 已经是标准格式（有 victory 布尔字段）
  if (typeof params.victory === 'boolean') {
    return params as unknown as CombatResult;
  }
  // 适配 LLM 传入的简化格式 { result: "victory" }
  const resultStr = params.result;
  if (typeof resultStr === 'string') {
    return {
      victory: resultStr === 'victory',
      fled: resultStr === 'fled',
      defeat: resultStr === 'defeat',
      experience: 0,
      currency: {},
      drops: [],
      turnsElapsed: 0,
      participantResults: [],
    };
  }
  // 无法识别的格式（如空对象），返回默认 defeat
  return { victory: false, fled: false, defeat: true, experience: 0, currency: {}, drops: [], turnsElapsed: 0, participantResults: [] };
}

/**
 * Combat 领域 ServiceTool（S3-2 Phase C 重构后的组合根，D8）。
 * 每次请求时在 createCombatService 内创建 Repository + TransactionManager + 跨领域 Service，
 * 注入 CombatService（9 参数构造）。
 * 跨领域 Character/Inventory/Skill/Numerical 通过构造注入的 ServiceTool 获取。
 * eventBus 为 shared 模块级单例，直接 import 注入（与 QuestServiceTool 模式一致）。
 */
export class CombatServiceTool extends BaseTool implements ICombatServiceTool {
  private readonly characterServiceTool: CharacterServiceTool;
  private readonly inventoryServiceTool: InventoryServiceTool;
  private readonly skillServiceTool: SkillServiceTool;
  private readonly numericalServiceTool: NumericalServiceTool;
  private templateService: ITemplateProvider | null = null;

  constructor(
    characterServiceTool: CharacterServiceTool,
    inventoryServiceTool: InventoryServiceTool,
    skillServiceTool: SkillServiceTool,
    numericalServiceTool: NumericalServiceTool,
  ) {
    super(
      'challenge_service' as ToolType,
      'Challenge Service',
      '战斗与挑战管理服务。详细使用方法请调用 get_tool_help 工具。',
      '1.0.0'
    );

    this.characterServiceTool = characterServiceTool;
    this.inventoryServiceTool = inventoryServiceTool;
    this.skillServiceTool = skillServiceTool;
    this.numericalServiceTool = numericalServiceTool;
    this.registerMethods();
    this.registerHandledActions();
  }

  /**
   * 注入模板服务（setter 注入，与 DialogueServiceTool/SkillServiceTool 模式一致）。
   * 用于 resolveChallengeMode 三层覆盖解析的模板默认层（default_challenge_mode）。
   * 未注入时跳过模板默认层，直接落到兜底模式。
   */
  setTemplateService(templateService: ITemplateProvider): void {
    this.templateService = templateService;
  }

  /**
   * 轻量检查是否存在进行中的战斗（P1.2）。
   * 仅查 combat_states 表，不创建完整 CombatService（避免 22 次 DB query + 11 次 YAML 解析）。
   * 供 init.ts isInCombat 闭包调用，替代原 combatServiceFactory + getCombatState 的重链路。
   */
  async hasActiveCombat(context: ToolContext): Promise<boolean> {
    const db = context.requestScope.getDb();
    const combatRepo = new CombatRepository(db);
    return combatRepo.existsBySaveId(context.saveId);
  }

  /**
   * 创建 CombatService 实例（组合根入口，D8）。
   * private：仅内部 handler 复用（P1.2 后无外部消费者，inCombat 检查改用 hasActiveCombat）。
   * 通过 requestScope 在请求内共享，避免跨领域级联重复创建。
   *
   * challengeMode 必须由调用方显式决策后传入（2026-07-25 模式选择链修复，删除默认值）：
   * - start_combat：经 resolveChallengeMode（三层覆盖优先级）
   * - 战斗中方法 + G2 路径：经 resolveActiveCombatMode（持久化 mode）
   * 缓存键含 mode，避免同请求内不同模式互相污染。
   */
  private async createCombatService(
    context: ToolContext,
    challengeMode: ChallengeMode,
  ): Promise<CombatService> {
    return context.requestScope.getOrCompute(`combat:${challengeMode}`, () => this.buildCombatService(context, challengeMode));
  }

  /**
   * 三层覆盖优先级解析挑战模式（architecture-design §3.3.3，DF-007）。
   *
   * 决策链（start_combat 开启新挑战时使用）：
   * 1. 玩家显式选择（工具参数 mode，WS 消息携带）
   * 2. GM 覆盖（saves.active_challenge_mode，select_challenge_mode 工具写入）
   * 3. 模板默认（template.default_challenge_mode，经 ITemplateProvider）
   * 4. 兜底 turn_based_combat
   *
   * 非法值不抛错（模式值来源可能是 LLM 传入），按优先级继续向下解析。
   * save 不存在时抛错（13.3 禁止 fallback 掩盖缺陷）。
   */
  private async resolveChallengeMode(
    context: ToolContext,
    playerChoice?: unknown,
  ): Promise<ChallengeMode> {
    // 优先级 1：玩家显式选择
    if (isChallengeMode(playerChoice)) {
      return playerChoice;
    }

    const db = context.requestScope.getDb();
    const saveRepo = new SaveRepository(db);
    const save = await saveRepo.findById(context.saveId);
    if (!save) {
      throw new Error(`存档不存在: ${context.saveId}`);
    }

    // 优先级 2：GM 覆盖（saves.active_challenge_mode，DF-007 持久化跨请求）
    if (isChallengeMode(save.active_challenge_mode)) {
      return save.active_challenge_mode;
    }

    // 优先级 3：模板默认（default_challenge_mode）
    if (this.templateService) {
      const templateDefault = await this.templateService.getDefaultChallengeMode(save.template_id);
      if (templateDefault) {
        return templateDefault;
      }
    }

    // 兜底
    return FALLBACK_CHALLENGE_MODE;
  }

  /**
   * 读取进行中挑战的持久化模式（G2 路径 + 战斗中方法使用）。
   *
   * 挑战开始时 resolveChallengeMode 的决策结果已持久化到 combat_states.mode 列
   * （CombatRepository.upsert 从 state 提取写入），此处直接读取，跨请求可见。
   *
   * 无进行中挑战或 mode 值非法时返回兜底模式：
   * - 无挑战：查询类方法（get_combat_state 等）只需构造任意策略即可（不依赖策略行为）
   * - 非法值：防御存量脏数据，由调用方方法内的 state 校验抛错
   */
  private async resolveActiveCombatMode(context: ToolContext): Promise<ChallengeMode> {
    const db = context.requestScope.getDb();
    const combatRepo = new CombatRepository(db);
    const row = await combatRepo.findBySaveId(context.saveId);
    if (row && isChallengeMode(row.mode)) {
      return row.mode;
    }
    return FALLBACK_CHALLENGE_MODE;
  }

  /**
   * 构建 CombatService（按 mode 选择策略，code-design §5.2）
   *
   * 期望效果：
   * - 创建 Repository / TransactionManager / RuleParser
   * - 通过跨域 ServiceTool 创建 CharacterService / InventoryService / SkillService / NumericalService
   * - 根据 challengeMode 选择策略实现类（narrative / turn_based / dynamic）
   * - 叙事模式不创建跨域依赖（GM 全权控制）
   * - 非战斗模式（puzzle / mini_game / stealth）抛错（由 Agent G 路径处理）
   * - 返回注入策略的 CombatService
   *
   * 设计偏差（小偏差，已在 Plan §四 记录）:
   * - 设计 §5.2 使用 `context.deps.characterService` 等，实际通过 ServiceTool 链式调用获取
   */
  private async buildCombatService(
    context: ToolContext,
    challengeMode: ChallengeMode,
  ): Promise<CombatService> {
    const db = context.requestScope.getDb();
    const combatRepo = new CombatRepository(db);
    const historyRepo = new CombatHistoryRepository(db);
    const txManager = new KnexTransactionManager(db);
    const saveRepo = new SaveRepository(db);
    const ruleParser = context.templateId
      ? await TemplateRuleParser.fromTemplateId(db, context.templateId)
      : await TemplateRuleParser.fromSaveId(db, context.saveId);

    let strategy: IChallengeStrategy;

    switch (challengeMode) {
      case 'narrative_combat': {
        // 叙事模式：无跨域依赖（GM 全权控制），但需 SaveRepository 在 endChallenge 时重置 active_challenge_mode
        strategy = new NarrativeCombatStrategy(saveRepo);
        break;
      }
      case 'turn_based_combat': {
        // 回合制：全量跨域依赖
        const characterService = await this.characterServiceTool.createCharacterService(context);
        const inventoryService = await this.inventoryServiceTool.createInventoryService(context);
        const skillService = await this.skillServiceTool.createSkillService(context);
        const numericalService = await this.numericalServiceTool.createNumericalService(context);
        strategy = new TurnBasedCombatStrategy(
          characterService, inventoryService, skillService, numericalService,
          combatRepo, historyRepo, ruleParser, eventBus, txManager, saveRepo,
        );
        break;
      }
      case 'dynamic_combat': {
        // 动态：同回合制依赖
        const characterService = await this.characterServiceTool.createCharacterService(context);
        const inventoryService = await this.inventoryServiceTool.createInventoryService(context);
        const skillService = await this.skillServiceTool.createSkillService(context);
        const numericalService = await this.numericalServiceTool.createNumericalService(context);
        strategy = new DynamicCombatStrategy(
          characterService, inventoryService, skillService, numericalService,
          combatRepo, historyRepo, ruleParser, eventBus, txManager, saveRepo,
        );
        break;
      }
      case 'puzzle':
      case 'mini_game':
      case 'stealth': {
        // 非战斗挑战：本次设计仅预留类型，不走 buildCombatService
        // 这些挑战模式由 Agent G 路径处理（GM 全权控制）
        throw new Error(`非战斗挑战模式 ${challengeMode} 不走 buildCombatService，请走 Agent G 路径`);
      }
      default: {
        // 类型安全：穷尽性检查
        const _exhaustive: never = challengeMode;
        throw new Error(`不支持的挑战模式: ${_exhaustive}`);
      }
    }

    // CombatService 保留 ruleParser（fleeAttempt）+ inventoryService（useItemInCombat）可选依赖
    // 仅在战斗模式（非 narrative）下传入，叙事模式不需要
    if (challengeMode === 'narrative_combat') {
      return new CombatService(strategy, combatRepo, txManager);
    }
    const inventoryService = await this.inventoryServiceTool.createInventoryService(context);
    return new CombatService(strategy, combatRepo, txManager, ruleParser, inventoryService);
  }

  // ============================================================================
  // ICombatServiceTool 接口实现（G2 路径端口接口，code-design §5.2）
  //
  // 期望效果：
  // - G2 层 ChallengeProgram 通过此端口接口跨请求访问挑战状态
  // - 不经过 Agent 路径（G2 为非 LLM 快速路径）
  // - 委托 CombatService 的 G2 专用方法（getChallengeState/executeStepOnly/checkEnd/endChallenge）
  // - 策略模式按持久化 mode 构建（resolveActiveCombatMode，2026-07-25 模式选择链修复）
  // ============================================================================

  /** G2 调用：查询挑战状态（从 DB 读取，跨请求可见，DF-021 修复） */
  async queryChallengeState(
    saveId: ID,
    context: ToolContext,
  ): Promise<ChallengeState | null> {
    const mode = await this.resolveActiveCombatMode(context);
    const service = await this.createCombatService(context, mode);
    return service.getChallengeState(saveId);
  }

  /** G2 调用：执行回合（不经过 Agent），返回 ChallengeStepResult */
  async executeTurnForOrchestrator(
    saveId: ID,
    action: ChallengeAction,
    context: ToolContext,
  ): Promise<ChallengeStepResult> {
    const mode = await this.resolveActiveCombatMode(context);
    const service = await this.createCombatService(context, mode);
    return service.executeStepOnly(saveId, action);
  }

  /** G2 调用：检测挑战是否结束（纯查询） */
  async checkChallengeEnd(
    saveId: ID,
    context: ToolContext,
  ): Promise<{ ended: boolean; result?: ChallengeEndResult['result'] }> {
    const mode = await this.resolveActiveCombatMode(context);
    const service = await this.createCombatService(context, mode);
    return service.checkEnd(saveId);
  }

  /** G2 调用：收集战斗数据（结束时） */
  async collectChallengeData(
    saveId: ID,
    result: ChallengeEndResult['result'],
    context: ToolContext,
  ): Promise<ChallengeEndResult> {
    const mode = await this.resolveActiveCombatMode(context);
    const service = await this.createCombatService(context, mode);
    return service.endChallenge(saveId, result);
  }

  private registerMethods(): void {
    this.registerMethod({
      name: 'start_combat',
      description: '开始新战斗(初始化完整状态+读取角色属性)',
      parameters: {
        enemies: {
          type: 'array',
          required: true,
          description: '敌人模板数组。每个元素必须包含: name(名称), level(等级), currentHP或hp(当前生命值), maxHP或maxHp(最大生命值), attack(攻击力), defense(防御力), speed(速度,可选)',
          items: {
            name: { type: 'string', required: true, description: '敌人名称' },
            level: { type: 'number', required: true, description: '敌人等级' },
            currentHP: { type: 'number', required: false, description: '当前生命值(也可用hp)' },
            hp: { type: 'number', required: false, description: '当前生命值(别名)' },
            maxHP: { type: 'number', required: false, description: '最大生命值(也可用maxHp)' },
            maxHp: { type: 'number', required: false, description: '最大生命值(别名)' },
            attack: { type: 'number', required: true, description: '攻击力' },
            defense: { type: 'number', required: true, description: '防御力' },
            speed: { type: 'number', required: false, description: '速度' },
          }
        },
        mode: {
          type: 'string',
          required: false,
          description: '挑战模式显式选择(可选,三层覆盖优先级最高层。不传则依次解析: GM覆盖(saves.active_challenge_mode) > 模板默认(default_challenge_mode) > 兜底turn_based_combat)',
          enum: ['narrative_combat', 'turn_based_combat', 'dynamic_combat', 'puzzle', 'mini_game', 'stealth'],
        }
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '战斗初始状态(CombatState)，含参与者/回合/战斗ID' },
          error: { type: 'string' as const, description: '失败时的错误信息' }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        try {
          // 三层覆盖优先级解析（玩家选择 > GM覆盖 > 模板默认 > 兜底），决策结果经策略构造注入
          const mode = await this.resolveChallengeMode(context, params.mode);
          const service = await this.createCombatService(context, mode);
          const state = await service.startCombat(
            context.saveId,
            params.enemies as import('./types.js').EnemyTemplate[]
          );
          return { success: true, data: state, writeOperation: { toolType: this.type, method: 'start_combat', params, result: state, timestamp: context.timestamp } };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to start combat';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'get_combat_state',
      description: '获取当前战斗状态',
      parameters: {},
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '当前战斗状态，无活跃战斗时active=false', properties: { active: { type: 'boolean' as const, description: '是否有活跃战斗' }, message: { type: 'string' as const, description: '无战斗时的提示信息' }, hint: { type: 'string' as const, description: '操作提示' } } },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const activeMode = await this.resolveActiveCombatMode(context);
        const service = await this.createCombatService(context, activeMode);
        try {
          const { state, hint } = await service.getCombatState(context.saveId);
          if (!state) {
            return { success: true, data: { active: false, message: 'No active combat', hint } };
          }
          return { success: true, data: { ...state, hint } };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to get combat state';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'execute_turn',
      description: '执行一个回合(玩家行动+敌人AI反击)',
      parameters: {
        action: {
          type: 'object',
          required: true,
          description: '玩家行动',
          properties: {
            type: { type: 'string', required: true, description: '行动类型', enum: ['attack', 'skill', 'defend', 'item', 'flee'] },
            targetId: { type: 'string', required: false, description: '目标ID(多敌人时指定)' },
            skillName: { type: 'string', required: false, description: '技能名称(skill行动时必填)' },
            skillId: { type: 'string', required: false, description: '技能ID(用于精确伤害计算)' },
            itemId: { type: 'string', required: false, description: '物品ID(item行动时必填)' }
          }
        }
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '回合执行结果', properties: { turnResults: { type: 'array' as const, description: '本回合所有行动结果(TurnResult[])', items: { type: 'object' as const } }, combatState: { type: 'object' as const, description: '当前战斗状态(CombatState)' }, combatEnded: { type: 'boolean' as const, description: '战斗是否已结束' }, hint: { type: 'string' as const, description: '战斗结束时的提示' } } },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const activeMode = await this.resolveActiveCombatMode(context);
        const service = await this.createCombatService(context, activeMode);
        try {
          let action = params.action;
          if (typeof action === 'string') action = { type: action };
          const actionObj = action as Record<string, unknown> | null;
          if (actionObj && typeof actionObj === 'object' && !actionObj.type && actionObj.actionType) {
            action = { ...actionObj, type: actionObj.actionType };
          }
          if (!action || typeof action !== 'object' || !(action as Record<string, unknown>).type) {
            return { success: false, error: 'action.type 必填 (attack/skill/defend/item/flee)' };
          }
          const results = await service.executeTurn(context.saveId, action as import('./types.js').CombatAction);
          const { state: combatState } = await service.getCombatState(context.saveId);
          const combatEnded = combatState ? !combatState.active : true;
          const resultData: Record<string, unknown> = {
              turnResults: results,
              combatState,
              combatEnded,
            };
          if (combatEnded) {
            resultData.hint = '战斗已自动结束，无需再调用 end_combat';
          }
          return {
            success: true,
            data: resultData,
            writeOperation: { toolType: this.type, method: 'execute_turn', params, result: resultData, timestamp: context.timestamp }
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to execute turn';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'calculate_damage',
      description: '伤害计算(纯计算，不修改状态)',
      parameters: {
        attacker: { type: 'object', required: true, description: '攻击者CombatParticipant数据' },
        defender: { type: 'object', required: true, description: '防御者CombatParticipant数据' },
        skill: { type: 'object', required: false, description: '技能信息(可选)' }
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '伤害计算明细(DamageBreakdown)，含基础攻击/技能倍率/防御减免/暴击/最终伤害' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, _context: ToolContext): Promise<ToolResponse> => {
        try {
          const activeMode = await this.resolveActiveCombatMode(_context);
          const service = await this.createCombatService(_context, activeMode);
          const breakdown = service.calculateDamage(
            params.attacker as import('./types.js').CombatParticipant,
            params.defender as import('./types.js').CombatParticipant,
            params.skill as { baseDamage?: number; multiplier?: number } | undefined
          );
          return { success: true, data: breakdown };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to calculate damage';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'flee_attempt',
      description: '逃跑尝试(概率计算)',
      parameters: {},
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '逃跑尝试结果', properties: { success: { type: 'boolean' as const, description: '是否逃跑成功' }, chance: { type: 'number' as const, description: '逃跑概率' }, message: { type: 'string' as const, description: '结果描述' } } },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const activeMode = await this.resolveActiveCombatMode(context);
        const service = await this.createCombatService(context, activeMode);
        try {
          const result = await service.fleeAttempt(context.saveId);
          return { success: true, data: result, writeOperation: { toolType: this.type, method: 'flee_attempt', params: _params, result, timestamp: context.timestamp } };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to flee';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'end_combat',
      description: '结束战斗(更新角色HP/MP、记录日志)',
      parameters: {
        result: { type: 'object', required: true, description: '战斗结果(victory/fled/defeat)' }
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '战斗结束确认', properties: { message: { type: 'string' as const, description: '结束确认信息' } } },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const activeMode = await this.resolveActiveCombatMode(context);
        const service = await this.createCombatService(context, activeMode);
        try {
          const combatResult = normalizeCombatResult(params.result);
          await service.endCombat(context.saveId, combatResult);
          const resultData = { message: 'Combat ended successfully' };
          return { success: true, data: resultData, writeOperation: { toolType: this.type, method: 'end_combat', params, result: resultData, timestamp: context.timestamp } };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to end combat';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'defend',
      description: '防御姿态(下回合减伤50%)',
      parameters: {},
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '防御行动结果(TurnResult)' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const activeMode = await this.resolveActiveCombatMode(context);
        const service = await this.createCombatService(context, activeMode);
        try {
          const result = await service.defend(context.saveId);
          return { success: true, data: result, writeOperation: { toolType: this.type, method: 'defend', params: _params, result, timestamp: context.timestamp } };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to defend';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'use_item_in_combat',
      description: '战斗中使用消耗品(仅consumable类别可用)',
      parameters: {
        itemId: { type: 'string', required: true, description: '物品ID' }
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '使用物品结果(TurnResult)' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const activeMode = await this.resolveActiveCombatMode(context);
        const service = await this.createCombatService(context, activeMode);
        try {
          const result = await service.useItemInCombat(context.saveId, params.itemId as string);
          return { success: true, data: result, writeOperation: { toolType: this.type, method: 'use_item_in_combat', params, result, timestamp: context.timestamp } };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to use item in combat';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'get_combat_log',
      description: '获取战斗日志',
      parameters: {
        limit: { type: 'number', required: false, description: '返回条数上限(默认50)' }
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '战斗日志', properties: { log: { type: 'array' as const, description: '战斗日志条目(CombatLogEntry[])', items: { type: 'object' as const } }, totalEntries: { type: 'number' as const, description: '日志总条数' }, hint: { type: 'string' as const, description: '操作提示' } } },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const activeMode = await this.resolveActiveCombatMode(context);
        const service = await this.createCombatService(context, activeMode);
        try {
          const { log, hint } = await service.getCombatLog(context.saveId, params.limit as number | undefined);
          return { success: true, data: { log, totalEntries: log.length, hint } };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to get combat log';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'get_status_effects',
      description: '获取当前所有参与者的状态效果',
      parameters: {},
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '所有参与者状态效果', properties: { effects: { type: 'array' as const, description: '参与者状态效果列表', items: { type: 'object' as const } }, hint: { type: 'string' as const, description: '操作提示' } } },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const activeMode = await this.resolveActiveCombatMode(context);
        const service = await this.createCombatService(context, activeMode);
        try {
          const { effects, hint } = await service.getStatusEffects(context.saveId);
          return { success: true, data: { effects, hint } };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to get status effects';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'check_combat_end',
      description: '检查战斗是否结束',
      parameters: {},
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '战斗结束检查结果', properties: { ended: { type: 'boolean' as const, description: '战斗是否已结束' }, result: { type: 'object' as const, description: '战斗结果(CombatResult，仅ended=true时存在)' } } },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const activeMode = await this.resolveActiveCombatMode(context);
        const service = await this.createCombatService(context, activeMode);
        try {
          const check = await service.checkCombatEnd(context.saveId);
          return { success: true, data: check };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to check combat end';
          return { success: false, error: errorMessage };
        }
      }
    });

    // === 阶段三新增工具方法（code-design §5.2） ===

    this.registerMethod({
      name: 'select_challenge_mode',
      description: '设置挑战模式覆盖(GM覆盖,持久化到saves.active_challenge_mode)',
      parameters: {
        mode: {
          type: 'string',
          required: true,
          description: '挑战模式(narrative_combat/turn_based_combat/dynamic_combat/puzzle/mini_game/stealth)',
          enum: ['narrative_combat', 'turn_based_combat', 'dynamic_combat', 'puzzle', 'mini_game', 'stealth'],
        },
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '确认信息', properties: { mode: { type: 'string' as const, description: '已设置的挑战模式' }, message: { type: 'string' as const, description: '确认信息' } } },
          error: { type: 'string' as const },
        },
        required: ['success'],
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        try {
          const mode = params.mode as ChallengeMode;
          // 通过 SaveRepository 端口接口更新 saves.active_challenge_mode（D3: 禁止跨领域表直接访问）
          // 13.1: context.requestScope.getDb() 返回 StagingKnex 代理
          const db = context.requestScope.getDb();
          const saveRepo = new SaveRepository(db);
          await saveRepo.updateFields(context.saveId, { active_challenge_mode: mode });
          const resultData = { mode, message: `挑战模式已设置为 ${mode}，后续 startCombat 将使用此覆盖` };
          return {
            success: true,
            data: resultData,
            writeOperation: { toolType: this.type, method: 'select_challenge_mode', params, result: resultData, timestamp: context.timestamp },
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to set challenge mode';
          return { success: false, error: errorMessage };
        }
      },
    });

    this.registerMethod({
      name: 'generate_enemy_strategy',
      description: '生成敌人策略(战斗开始时由combat_director调用,一次性写入,禁止覆盖)',
      parameters: {
        strategy: {
          type: 'object',
          required: true,
          description: '敌人策略对象',
          properties: {
            aggression: { type: 'string', required: true, description: '进攻倾向', enum: ['aggressive', 'defensive', 'tactical'] },
            targetPreference: { type: 'string', required: true, description: '目标选择策略', enum: ['nearest', 'weakest', 'strongest', 'healer'] },
            skillPriority: { type: 'array', required: false, description: '技能优先级(技能ID或名称,13.2 name/id兼容)', items: { type: 'string' } },
            fleeThreshold: { type: 'number', required: false, description: '逃跑HP阈值(百分比,0=死战不逃)' },
            preferItems: { type: 'boolean', required: false, description: '是否优先使用物品' },
            description: { type: 'string', required: true, description: '战术说明(人类可读)' },
          },
        },
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '确认信息', properties: { message: { type: 'string' as const, description: '确认信息' }, strategyDescription: { type: 'string' as const, description: '策略描述' } } },
          error: { type: 'string' as const },
        },
        required: ['success'],
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const activeMode = await this.resolveActiveCombatMode(context);
        const service = await this.createCombatService(context, activeMode);
        try {
          const strategy = params.strategy as EnemyStrategy;
          const challengeState = await service.updateEnemyStrategy(context.saveId, strategy);
          const resultData = {
            message: '敌人策略已写入，后续 processEnemyTurn 将使用此策略',
            strategyDescription: strategy.description,
          };
          return {
            success: true,
            data: resultData,
            writeOperation: { toolType: this.type, method: 'generate_enemy_strategy', params, result: challengeState, timestamp: context.timestamp },
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to generate enemy strategy';
          return { success: false, error: errorMessage };
        }
      },
    });

    this.registerMethod({
      name: 'narrate_combat',
      description: '叙事战斗专用:GM描述战斗动作(不修改数值,仅推进叙事)',
      parameters: {
        action: { type: 'string', required: true, description: '动作描述(如"挥剑斩向哥布林")' },
        description: { type: 'string', required: true, description: 'GM对动作结果的叙事描述' },
        targetId: { type: 'string', required: false, description: '目标参与者ID或名称(13.2 name/id兼容,从ChallengeState.participants匹配)' },
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '叙事结果', properties: { description: { type: 'string' as const, description: 'GM叙事描述' }, combatEnded: { type: 'boolean' as const, description: '战斗是否结束(叙事模式始终false,由GM决定)' }, hint: { type: 'string' as const, description: '操作提示' } } },
          error: { type: 'string' as const },
        },
        required: ['success'],
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createCombatService(context, 'narrative_combat');
        try {
          // 叙事战斗：构建 ChallengeAction 委托 strategy.executeStep
          const { state } = await service.getCombatState(context.saveId);
          if (!state) {
            return { success: false, error: '无进行中的战斗，请先调用 start_combat' };
          }
          if (!state.active) {
            return { success: false, error: '战斗已结束' };
          }

          // targetId name/id 兼容：从 ChallengeState.participants 内存匹配
          // 设计偏差：resolveEntityRef 适用于 DB 查询场景，参与者内存匹配无需使用（Plan 阶段二 P0-3 已记录同类偏差）
          let resolvedTargetId: ID | undefined;
          if (params.targetId) {
            const targetRef = String(params.targetId);
            const challengeState = await service.getChallengeState(context.saveId);
            const participants = challengeState?.participants ?? [];
            const matched = participants.find(p => p.id === targetRef || p.name === targetRef);
            if (!matched) {
              return { success: false, error: `未找到目标参与者: ${targetRef}` };
            }
            resolvedTargetId = matched.id;
          }

          const challengeAction: ChallengeAction = {
            type: 'narrate',
            actorId: state.participants[0]?.id ?? ('gm' as ID),
            targetIds: resolvedTargetId ? [resolvedTargetId] : undefined,
            description: params.description as string,
          };

          const stepResult = await service.executeStepOnly(context.saveId, challengeAction);
          const resultData = {
            description: stepResult.actionResult.description,
            combatEnded: stepResult.combatEnded,
            hint: stepResult.hint ?? '叙事战斗由 GM 控制，可继续 narrate_combat 或 end_combat 结束',
          };
          return {
            success: true,
            data: resultData,
            writeOperation: { toolType: this.type, method: 'narrate_combat', params, result: resultData, timestamp: context.timestamp },
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to narrate combat';
          return { success: false, error: errorMessage };
        }
      },
    });

    this.registerMethod({
      name: 'roll_dice',
      description: '投骰子(解析NdM格式+随机数生成,叙事战斗专用)',
      parameters: {
        dice: { type: 'string', required: true, description: '骰子表达式(如"1d20","3d6+2","2d8-1")' },
        reason: { type: 'string', required: false, description: '投骰原因(记录到日志)' },
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '骰子结果', properties: { dice: { type: 'string' as const, description: '原始骰子表达式' }, rolls: { type: 'array' as const, description: '每个骰子点数', items: { type: 'number' as const } }, total: { type: 'number' as const, description: '总和(含修正值)' }, modifier: { type: 'number' as const, description: '修正值(+N/-N)' }, reason: { type: 'string' as const, description: '投骰原因' } } },
          error: { type: 'string' as const },
        },
        required: ['success'],
      },
      handler: async (params: Record<string, unknown>, _context: ToolContext): Promise<ToolResponse> => {
        try {
          const dice = params.dice as string;
          const reason = (params.reason as string) ?? '';

          // 解析 NdM[+/-K] 格式
          const match = dice.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
          if (!match) {
            return { success: false, error: `骰子格式无效: ${dice}（期望格式如 1d20 / 3d6+2 / 2d8-1）` };
          }

          const count = parseInt(match[1], 10);
          const sides = parseInt(match[2], 10);
          const modifier = match[3] ? parseInt(match[3], 10) : 0;

          if (count < 1 || count > 100) {
            return { success: false, error: `骰子数量超出范围(1-100): ${count}` };
          }
          if (sides < 2 || sides > 1000) {
            return { success: false, error: `骰子面数超出范围(2-1000): ${sides}` };
          }

          const rolls: number[] = [];
          for (let i = 0; i < count; i++) {
            rolls.push(Math.floor(Math.random() * sides) + 1);
          }
          const sum = rolls.reduce((a, b) => a + b, 0);
          const total = sum + modifier;

          const resultData = { dice, rolls, total, modifier, reason };
          return { success: true, data: resultData };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to roll dice';
          return { success: false, error: errorMessage };
        }
      },
    });

    this.registerMethod({
      name: 'queue_action',
      description: '动态战斗专用:玩家排队动作(存入actionQueue,后续executeStep执行)',
      parameters: {
        action: {
          type: 'object',
          required: true,
          description: '排队的动作',
          properties: {
            type: { type: 'string', required: true, description: '动作类型', enum: ['attack', 'skill', 'defend', 'item', 'flee'] },
            actorId: { type: 'string', required: true, description: '执行者参与者ID' },
            targetIds: { type: 'array', required: false, description: '目标参与者ID或名称列表(13.2 name/id兼容)', items: { type: 'string' } },
            skillId: { type: 'string', required: false, description: '技能ID或名称(13.2 name/id兼容)' },
            itemId: { type: 'string', required: false, description: '物品ID或名称(13.2 name/id兼容)' },
          },
        },
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '排队确认', properties: { queuePosition: { type: 'number' as const, description: '队列位置(1-based)' }, message: { type: 'string' as const, description: '确认信息' } } },
          error: { type: 'string' as const },
        },
        required: ['success'],
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createCombatService(context, 'dynamic_combat');
        try {
          const { state } = await service.getCombatState(context.saveId);
          if (!state) {
            return { success: false, error: '无进行中的战斗，请先调用 start_combat' };
          }
          if (!state.active) {
            return { success: false, error: '战斗已结束' };
          }

          // 获取 ChallengeState 读取 metadata.actionQueue
          const challengeState = await service.getChallengeState(context.saveId);
          if (!challengeState) {
            return { success: false, error: '无法读取挑战状态' };
          }

          // 初始化/读取 actionQueue
          const metadata = (challengeState.metadata ?? {}) as Record<string, unknown>;
          const actionQueue = (metadata.actionQueue as ChallengeAction[]) ?? [];

          // 将排队动作加入队列
          // 注意：name/id 解析延迟到 executeStep 时由策略层处理（策略层持有 resolvers Map）
          const queuedAction: ChallengeAction = {
            type: (params.action as Record<string, unknown>).type as string,
            actorId: (params.action as Record<string, unknown>).actorId as ID,
            targetIds: (params.action as Record<string, unknown>).targetIds as (ID | string)[] | undefined,
            skillId: (params.action as Record<string, unknown>).skillId as ID | string | undefined,
            itemId: (params.action as Record<string, unknown>).itemId as ID | string | undefined,
          };

          actionQueue.push(queuedAction);

          // 写入 metadata.actionQueue 并持久化（经 StagingKnex 代理走 StagingPool）
          await service.updateMetadata(context.saveId, { actionQueue });

          const queuePosition = actionQueue.length;
          const resultData = {
            queuePosition,
            message: `动作已排队，当前位置 ${queuePosition}，后续 execute_turn 将按队列执行`,
          };
          return {
            success: true,
            data: resultData,
            writeOperation: { toolType: this.type, method: 'queue_action', params, result: resultData, timestamp: context.timestamp },
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to queue action';
          return { success: false, error: errorMessage };
        }
      },
    });
  }

  private registerHandledActions(): void {
    // 标准action映射
    this.addActionHandler('start_combat', 'start_combat', 10, '开始新战斗');
    this.addActionHandler('get_combat', 'get_combat_state', 10, '获取当前战斗状态');
    this.addActionHandler('execute_turn', 'execute_turn', 10, '执行一个回合');
    this.addActionHandler('calculate_damage', 'calculate_damage', 10, '伤害计算');
    this.addActionHandler('flee', 'flee_attempt', 10, '逃跑尝试');
    this.addActionHandler('end_combat', 'end_combat', 10, '结束战斗');
    this.addActionHandler('defend', 'defend', 10, '防御姿态');
    this.addActionHandler('use_item', 'use_item_in_combat', 10, '战斗中使用物品');
    this.addActionHandler('combat_log', 'get_combat_log', 10, '获取战斗日志');
    this.addActionHandler('status_effects', 'get_status_effects', 10, '获取状态效果');
    this.addActionHandler('check_end', 'check_combat_end', 10, '检查战斗是否结束');
    // 阶段三新增 action 映射（code-design §5.2）
    this.addActionHandler('select_challenge_mode', 'select_challenge_mode', 10, '设置挑战模式覆盖');
    this.addActionHandler('generate_enemy_strategy', 'generate_enemy_strategy', 10, '生成敌人策略');
    this.addActionHandler('narrate_combat', 'narrate_combat', 10, '叙事战斗动作');
    this.addActionHandler('roll_dice', 'roll_dice', 10, '投骰子');
    this.addActionHandler('queue_action', 'queue_action', 10, '排队动作');
    // 别名映射(priority=5)
    this.addActionHandler('attack', 'execute_turn', 5, '攻击(别名)');
    this.addActionHandler('fight', 'start_combat', 5, '开战(别名)');
  }
}
