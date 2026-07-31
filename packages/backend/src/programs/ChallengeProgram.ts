/**
 * ChallengeProgram 实现（G2 程序执行层，fractal-design-20260724-g2-program-execution-layer §6.3）
 *
 * 期望效果：
 * - 纯程序执行，不含路由编排
 * - 委托 ICombatServiceTool 处理数值计算（不调 LLM）
 * - 不持有状态（无实例字段持有 ChallengeState）
 * - 原子方法：queryState / executeTurn / checkEnd / collectEndResult
 *
 * 架构合规:
 * - 零 value import agents/（G2→G 禁止依赖 #8）
 * - 零 import @ai-rpg/ai（G2→H 禁止依赖 #9）
 * - 零 value import game-systems/（G2→F 禁止，仅 type import ICombatServiceTool 端口接口）
 * - 不持有状态
 *
 * 与原 ChallengeOrchestrator 的关系:
 * - 原 ChallengeOrchestrator.executeStep 混合了"程序执行"和"路由编排"
 * - 拆分后 ChallengeProgram 只做程序执行
 * - 路由编排（状态查询 + 校验 + 结束检测 + routeToAgent）迁移到服务层 E handleProgramAction
 *
 * StagingPool 访问（保持与原 ChallengeOrchestrator 一一致）:
 * - 不直接调用 IStagingPool.queryShadowState / updateShadowState
 * - 通过 ICombatServiceTool 的方法间接访问（CombatServiceTool 内部使用 StagingKnex 代理）
 */

import type { ID } from '@ai-rpg/shared';
import type {
  ChallengeAction,
  ChallengeState,
  ChallengeStepResult,
  ChallengeEndResult,
} from '@ai-rpg/shared';
import type { ToolContext } from '@ai-rpg/shared';
import type { IChallengeProgram, ChallengeEndCheck } from './types.js';
// DF-029 修复：ICombatServiceTool 定义在工具层 I（CombatServiceTool.ts），不在业务层 F types.ts
// G2 层仅 type import 工具层端口接口（lint 规则 G2→F 允许 type import ICombatServiceTool）
import type { ICombatServiceTool } from '../game-systems/combat/CombatServiceTool.js';

/**
 * 挑战程序实现（G2 程序执行层）
 *
 * 期望效果：
 * - 接收服务层 E 的路由编排调用
 * - 委托 ICombatServiceTool 处理数值计算（不调 LLM）
 * - 不持有状态（挑战状态由 StagingPool 影子状态 + DB 持有）
 *
 * 架构合规:
 * - 零 value import agents/（G2→G 禁止依赖 #8）
 * - 零 import @ai-rpg/ai（G2→H 禁止依赖 #9）
 * - 零 value import game-systems/（G2→F 禁止，仅 type import ICombatServiceTool 端口接口）
 * - 不持有状态（无实例字段持有 ChallengeState）
 */
export class ChallengeProgram implements IChallengeProgram {
  constructor(
    private readonly combatServiceTool: ICombatServiceTool,
  ) {}

  /**
   * 查询挑战状态（纯查询）
   *
   * 期望效果：
   * - 输入：saveId + 工具上下文
   * - 输出：当前 ChallengeState 或 null（未在挑战中）
   * - 无副作用（纯查询）
   * - 委托 ICombatServiceTool.queryChallengeState（经 StagingKnex 代理读取 ShadowState）
   */
  async queryState(saveId: ID, context: ToolContext): Promise<ChallengeState | null> {
    return this.combatServiceTool.queryChallengeState(saveId, context);
  }

  /**
   * 执行挑战回合（程序执行）
   *
   * 期望效果：
   * - 输入：saveId + 挑战动作 + 工具上下文
   * - 输出：挑战步骤的数值结果（含 actionResult / sideEffects / combatEnded）
   * - 副作用：通过 StagingPool 影子状态读写 ChallengeState
   * - 委托 ICombatServiceTool.executeTurnForOrchestrator（不调 LLM）
   */
  async executeTurn(
    saveId: ID,
    action: ChallengeAction,
    context: ToolContext,
  ): Promise<ChallengeStepResult> {
    return this.combatServiceTool.executeTurnForOrchestrator(saveId, action, context);
  }

  /**
   * 检查挑战结束条件（纯查询）
   *
   * 期望效果：
   * - 输入：saveId + 工具上下文
   * - 输出：是否结束 + 结束结果类型（victory/defeat/flee/draw）
   * - 无副作用（纯查询）
   * - 委托 ICombatServiceTool.checkChallengeEnd（经 StagingKnex 代理读取 ShadowState）
   */
  async checkEnd(saveId: ID, context: ToolContext): Promise<ChallengeEndCheck> {
    return this.combatServiceTool.checkChallengeEnd(saveId, context);
  }

  /**
   * 收集挑战结束数据（纯查询）
   *
   * 期望效果：
   * - 输入：saveId + 结束结果类型 + 工具上下文
   * - 输出：挑战结束结果（含 rewards）
   * - 无副作用（纯查询）
   * - 委托 ICombatServiceTool.collectChallengeData（经 StagingKnex 代理读取 ShadowState）
   */
  async collectEndResult(
    saveId: ID,
    result: ChallengeEndResult['result'],
    context: ToolContext,
  ): Promise<ChallengeEndResult> {
    return this.combatServiceTool.collectChallengeData(saveId, result, context);
  }
}
