/**
 * RecoveryCoordinator —— 错误恢复的编排者（M3 模块 6）。
 *
 * 设计文档：docs/design/solution-design-20260726-pi-reference-upgrade/
 *   solution-design-20260726-pi-reference-upgrade-模块M3-AgentRuntime拆分.md §12
 *
 * 职责：包装 ReActLoop.executeReActWithRecovery 纯函数，作为 recovery 状态的
 * 唯一写者（D3.4），将纯函数产出的 recoveryState 写回 AgentRuntimeState。
 *
 * 迁移自 AgentRuntime（行为等价，纯移动）：
 * executeReActWithRecovery / resetRecoveryRuntimeState
 *
 * 依赖方向：仅依赖 types.ts 接口 + ReActLoop 纯函数，零 import facade。
 * recoveryPlanner 由 ReActLoop 内部经 reactLoopDepsProvider 消费（§12.3）；
 * deps.recoveryPlanner 为构造期引用（策略变更由 facade 重建 reactLoopDeps 生效）。
 */

import { executeReActWithRecovery } from '../ReActLoop.js';
import type { ReActEngineResult } from '../ReActEngine.js';
import type {
  ExecuteRecoveryArgs,
  IRecoveryCoordinator,
  RecoveryCoordinatorDeps,
} from './types.js';

export class RecoveryCoordinator implements IRecoveryCoordinator {
  private readonly deps: RecoveryCoordinatorDeps;

  constructor(deps: RecoveryCoordinatorDeps) {
    this.deps = deps;
  }

  async executeWithRecovery(args: ExecuteRecoveryArgs): Promise<ReActEngineResult> {
    const { result, recoveryState } = await executeReActWithRecovery(
      this.deps.reactLoopDepsProvider(),
      args.reactContext,
      args.hooks,
      args.callToolFn,
      args.requestId,
      args.agentRunId,
      args.failureStage,
      args.reqCtx,
      this.deps.state.recovery,
    );
    // 单写点（D3.4）：recovery 状态仅由此写回
    this.deps.state.recovery = recoveryState;
    return result;
  }

  reset(): void {
    this.deps.state.recovery = {
      attempts: 0,
      readonlyMode: false,
    };
  }

  get attempts(): number {
    return this.deps.state.recovery.attempts;
  }

  get readonlyMode(): boolean {
    return this.deps.state.recovery.readonlyMode;
  }
}
