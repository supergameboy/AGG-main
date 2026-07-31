import type { ID } from '../../../../shared/src/types/core.js';
import type { DataProviders } from '../../../../shared/src/types/context-manifest.js';
import type { AuditRequest, AuditFailure, AuditDimension, AuditResult, AuditReport, TaskContent } from '../../../../shared/src/types/audit.js';
import type { IStagingPool, IShadowStateLayer } from '@ai-rpg/shared/tool-core';
// 模块2 简化：删除 IEntityGraphAuditor/IEntityGraphProvider 导入（EntityGraphAuditor + GraphConsistencyChecker 已删除）
import type { Knex } from 'knex';

/**
 * 审核上下文 - 审核执行时所需的环境信息。
 * 复用模块L的 DataProviders（单一数据源原则），扩展审核专用的 stagingPool/shadowState。
 * 类型严格：复用现有 IStagingPool/IShadowStateLayer 接口，禁止 any/unknown 规避。
 */
export interface AuditContext {
  saveId: ID;
  templateId: ID;
  db: Knex;
  dataProviders: DataProviders;
  auditProviders: AuditProviders;
}

/**
 * 审核专用 Provider 集合。
 *
 * 模块2 简化：删除 graphAuditorProvider + auditGraphProviderFactory
 *（EntityGraphAuditor + GraphConsistencyChecker 已删除，无消费者）。
 */
export interface AuditProviders {
  stagingPoolProvider: IStagingPool;
  shadowStateProvider: IShadowStateLayer;
  /**
   * 基于 ShadowState 的 savePool 数据源（可选）。
   * 审核 Checker 通过此 provider 读取时走 StagingKnex 代理 → ShadowState，
   * 能看到本轮 ReAct 循环未提交的写入。
   * 不存在时 fallback 到 ctx.dataProviders.savePoolProvider（落库后快照）。
   */
  shadowSavePoolProvider?: DataProviders['savePoolProvider'];
}

/**
 * ProgramChecker - 程序化审核规则接口。
 * 无LLM依赖，纯逻辑。返回AuditFailure[]，空数组表示通过。
 */
export interface ProgramChecker {
  readonly dimension: AuditDimension;
  /**
   * 程序化检查 - 无LLM依赖，纯逻辑。
   * 返回AuditFailure[]，空数组表示通过。
   */
  check(request: AuditRequest, ctx: AuditContext): Promise<AuditFailure[]>;
  /**
   * 是否可并行执行（B-7 约束）。
   * 默认 true。依赖 stagingPool 写入完成的 Checker（如 graph_consistency）设为 false，串行执行。
   */
  readonly parallelizable?: boolean;
}

/**
 * LLMChecker - LLM内容质量审核接口。
 * Q-4 输入隔离：只接收 AuditRequestForLLM（剥离 expected.names），不接收完整 AuditRequest。
 */
export interface LLMChecker {
  check(request: import('../../../../shared/src/types/audit.js').AuditRequestForLLM, ctx: AuditContext, programFailures: AuditFailure[]): Promise<AuditFailure[]>;
}

/**
 * RootCauseClassifier - 失败根因分类接口。
 */
export interface RootCauseClassifier {
  classify(programFailures: AuditFailure[], llmFailures: AuditFailure[], request: AuditRequest, ctx: AuditContext): Promise<import('../../../../shared/src/types/audit.js').AuditRootCause | undefined>;
}

/**
 * AuditAgent - 无状态审核Agent接口。
 */
export interface IAuditAgent {
  audit(request: AuditRequest, ctx: AuditContext): Promise<AuditResult>;
  auditWorld(saveId: ID, ctx: AuditContext): Promise<AuditResult>;
  /**
   * 包装 audit() 输出 AuditReport - 供 on_task_complete hook 调用。
   * 按 agentType 自动选择 auditMode/auditScope，调用现有 audit() 后包装为 AuditReport。
   * 抛错不 catch（EC5：由 dispatch 现有 catch 机制处理）。
   */
  auditForReport(params: {
    saveId: string;
    taskContent: TaskContent;
    ctx: AuditContext;
    /** reactEngine.execute 返回值（actualOutput 来源） */
    result: unknown;
  }): Promise<AuditReport>;
}
