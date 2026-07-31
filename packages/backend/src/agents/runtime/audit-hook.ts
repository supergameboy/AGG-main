/**
 * on_task_complete hook 回调实现 - 审核挂起-恢复模式核心。
 *
 * 设计文档：docs/design/fix/fix-20260716-audit-hook-suspend-resume-refactor.md
 *
 * 职责：
 * 1. 去重检查（auditedKeys）→ 命中返回 auditSkipped=true（仅一轮审核，EC4）
 * 2. 未命中 → 调用 auditAgent.auditForReport() → 返回 auditReport
 * 3. 抛错不 catch（EC5：由 dispatch 通过 ERROR_PROPAGATING_HOOKS 白名单穿透到 ReActLoop catch，进入 after_agent_fail）
 *
 * 架构约束：
 * - Agent 核心 G → 业务层 F 禁止 value import（architecture-standards #5）
 * - 本文件仅 type import IAuditAgent/AuditContext，实例由 AgentRuntime 通过 deps 注入
 */
import type { ID } from '../../../../shared/src/types/core.js';
import type { TaskContent } from '../../../../shared/src/types/audit.js';
import type { IStagingPool, IShadowStateLayer } from '@ai-rpg/shared/tool-core';
import type { IAuditAgent, AuditContext } from '../../game-systems/audit/ProgramChecker.js';
import type { HookPayloadFor, OnTaskCompletePatch, TypedAgentHook } from './types.js';

/**
 * on_task_complete hook 的 payload 结构（由 ReActLoop 在提交点传入）。
 *
 * 设计文档接口签名 #5 的 OnTaskCompletePayload，扩展 shadowState（实际构建 AuditContext 需要）。
 */
export interface OnTaskCompletePayload {
  saveId: string;
  templateId: string;
  stagingPool: IStagingPool;
  shadowState: IShadowStateLayer;
  taskContent: TaskContent;
  agentType: string;
  agentRunId: string;
  /** reactEngine.execute 返回值 */
  result: unknown;
}

/**
 * AuditContext 构建器签名（与 agent-deps.ts auditContextBuilder 一致）。
 * init.ts 闭包捕获 dataProviders/db/graphAuditor 等共享依赖；
 * per-request 的 stagingPool/shadowState 由本 hook 从 payload 传入。
 */
export type AuditContextBuilder = (
  saveId: ID,
  templateId: ID,
  perRequest: { stagingPool: IStagingPool; shadowState: IShadowStateLayer },
) => AuditContext;

/**
 * 创建 on_task_complete hook 回调。
 *
 * 期望效果（设计文档 EC1-EC8）：
 * 1. 去重检查：auditedKeys.has(auditKey) → 返回 { patch: { auditSkipped: true } }
 * 2. 未命中：调用 auditAgent.auditForReport() → 返回 { patch: { auditReport } }
 * 3. 抛错：不 try/catch，错误向上抛（EC5：由 dispatch 通过 ERROR_PROPAGATING_HOOKS 白名单穿透到 ReActLoop catch）
 *
 * 返回类型为 `TypedAgentHook<'on_task_complete'>`（M4 子任务B 平权迁移）：
 * patch 类型与 hook 名编译期绑定，调用方无需 cast。
 * payload 经 HookPayloadMap 单点窄化（见函数内注释），与 default-agent-hooks /
 * result-normalizer 的 5 处既有多型 hook 同一形态（对称一致）。
 *
 * @param deps.auditAgent 无状态审核 Agent（由 AgentRuntime 通过 agentDeps 注入）
 * @param deps.auditContextBuilder AuditContext 构建器（与 agent-deps.ts 签名一致）
 * @param deps.auditedKeys per-request 生命周期去重 Set（请求开始时清理）
 */
export function createOnTaskCompleteHook(deps: {
  auditAgent: IAuditAgent;
  auditContextBuilder: AuditContextBuilder;
  auditedKeys: Set<string>;
}): TypedAgentHook<'on_task_complete'> {
  const { auditAgent, auditContextBuilder, auditedKeys } = deps;

  return async (context) => {
    // payload 单点窄化（HookPayloadMap 单一数据源）：dispatcher 注册表以 AgentHook
    // 擦除形态异构存储全部 hook（strictFunctionTypes 下具体 payload 上下文无法逆
    // 变赋值给宽类型 AgentHook），类型边界只能在此收窄——这是 hook 链路上不可消除
    // 的唯一断言点，与 default-agent-hooks/result-normalizer 的 5 处同型。
    const payload = context.payload as HookPayloadFor<'on_task_complete'> | undefined;
    if (!payload) {
      // 无 payload 说明 ReActLoop 调用方传递断裂，抛错暴露（禁止 fallback 掩盖缺陷）
      throw new Error('on_task_complete hook payload is undefined — ReActLoop 调用方传递断裂');
    }

    const { saveId, templateId, stagingPool, shadowState, taskContent, result } = payload;

    // 1. 去重检查（EC4：一个 taskContent 仅审核一轮）
    const auditKey = `${taskContent.agentRunId}::${taskContent.description}`;
    if (auditedKeys.has(auditKey)) {
      return { patch: { auditSkipped: true } };
    }

    // 2. 构建 AuditContext（per-request stagingPool/shadowState 从 payload 传入）
    const ctx = auditContextBuilder(
      saveId,
      templateId,
      { stagingPool, shadowState },
    );

    // 3. 调用 auditAgent.auditForReport（不 try/catch，EC5）
    const auditReport = await auditAgent.auditForReport({
      saveId,
      taskContent,
      ctx,
      result,
    });

    // 4. 标记已审核（去重）
    auditedKeys.add(auditKey);

    // 5. 返回 patch（loop 主体读取 auditReport.issues.length 决定 continue/return）
    const patch: OnTaskCompletePatch = { auditReport };
    return { patch };
  };
}
