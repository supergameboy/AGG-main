/**
 * G2 程序执行层端口接口（fractal-design-20260724-g2-program-execution-layer §6.1）
 *
 * 期望效果：
 * - 定义 IChallengeProgram 接口，供服务层 E 路由编排调用
 * - 纯程序执行，不含路由编排
 * - 原子方法：queryState / executeTurn / checkEnd / collectEndResult
 * - 不调用 LLM，不持有状态
 * - 服务层 E 组合多个方法实现路由编排
 *
 * 架构约束（architecture-standards §1.2 G2 层）:
 * - G2 层零 value import agents/（禁止反向依赖 Agent 核心 G）
 * - G2 层零 LLM 调用（纯代码执行）
 * - G2 层不持有状态（挑战状态由 StagingPool 影子状态 + DB 持有）
 * - G2 层仅 type import 工具层 I 端口接口（如 ICombatServiceTool）
 */

import type { ID } from '@ai-rpg/shared';
import type {
  ChallengeAction,
  ChallengeState,
  ChallengeStepResult,
  ChallengeEndResult,
} from '@ai-rpg/shared';
import type { ToolContext } from '@ai-rpg/shared';

/**
 * 挑战程序执行端口接口（G2 程序执行层）
 *
 * 期望效果：
 * - 纯程序执行，不含路由编排
 * - 原子方法：queryState / executeTurn / checkEnd / collectEndResult
 * - 不调用 LLM，不持有状态
 * - 服务层 E 组合多个方法实现路由编排
 *
 * 路由规则（fractal-design §5.1）:
 * - action 后缀为 -program → 服务层 E 调用 G2 程序执行
 * - action 为 chat / -LLM 后缀 → 走 Agent G 路径（不经过 G2）
 */
export interface IChallengeProgram {
  /**
   * 查询挑战状态（纯查询）
   *
   * 期望效果：
   * - 输入：saveId + 工具上下文
   * - 输出：当前 ChallengeState 或 null（未在挑战中）
   * - 无副作用（纯查询）
   */
  queryState(saveId: ID, context: ToolContext): Promise<ChallengeState | null>;

  /**
   * 执行挑战回合（程序执行）
   *
   * 期望效果：
   * - 输入：saveId + 挑战动作 + 工具上下文
   * - 输出：挑战步骤的数值结果（含 actionResult / sideEffects / combatEnded）
   * - 副作用：通过 StagingPool 影子状态读写 ChallengeState
   * - 错误：saveId 未处于挑战中时由下层抛错
   */
  executeTurn(
    saveId: ID,
    action: ChallengeAction,
    context: ToolContext,
  ): Promise<ChallengeStepResult>;

  /**
   * 检查挑战结束条件（纯查询）
   *
   * 期望效果：
   * - 输入：saveId + 工具上下文
   * - 输出：是否结束 + 结束结果类型（victory/defeat/flee/draw）
   * - 无副作用（纯查询）
   */
  checkEnd(saveId: ID, context: ToolContext): Promise<ChallengeEndCheck>;

  /**
   * 收集挑战结束数据（纯查询）
   *
   * 期望效果：
   * - 输入：saveId + 结束结果类型 + 工具上下文
   * - 输出：挑战结束结果（含 rewards）
   * - 无副作用（纯查询）
   */
  collectEndResult(
    saveId: ID,
    result: ChallengeEndResult['result'],
    context: ToolContext,
  ): Promise<ChallengeEndResult>;
}

/**
 * 挑战结束检查结果
 *
 * 期望效果：
 * - ended：是否结束
 * - result：结束结果类型（ended=true 时必填）
 */
export interface ChallengeEndCheck {
  /** 是否结束 */
  ended: boolean;
  /** 结束结果类型（ended=true 时必填） */
  result?: ChallengeEndResult['result'];
}
