import { BaseTool } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import { ToolType } from '../../../../shared/src/types/agent.js';
import { validateRequired } from '../../utils/paramValidator.js';
import type { IAuditAgent, AuditContext } from './ProgramChecker.js';
import type { AuditRequest, TaskContract, SubAgentResult } from '../../../../shared/src/types/audit.js';
import type { ID } from '../../../../shared/src/types/core.js';

/**
 * AuditServiceTool - 审核服务工具暴露。
 *
 * 提供 audit_task / audit_world 两个方法供 GM 调用。
 * LLM 审按需触发（GM 通过此工具调用，支持 LLM 审模式）。
 */
export class AuditServiceTool extends BaseTool {
  private auditAgent: IAuditAgent | null = null;
  private auditContextBuilder: ((saveId: ID, templateId: string) => AuditContext) | null = null;

  setAuditAgent(agent: IAuditAgent, contextBuilder: (saveId: ID, templateId: string) => AuditContext): void {
    this.auditAgent = agent;
    this.auditContextBuilder = contextBuilder;
  }

  constructor() {
    super(
      'audit_service' as ToolType,
      'Audit Service',
      '审核服务 - 对子Agent输出进行程序审+LLM审，返回AuditResult含根因分类',
      '1.0.0',
    );
    this.registerMethods();
  }

  private registerMethods(): void {
    this.registerMethod({
      name: 'audit_task',
      description: '审核子Agent任务输出。程序审始终执行，LLM审按auditMode按需触发。返回pass/failures/rootCause。',
      parameters: {
        save_id: { type: 'string', required: true, description: '存档ID' },
        template_id: { type: 'string', required: true, description: '模板ID' },
        task_id: { type: 'string', required: true, description: '被审核任务ID' },
        task_description: { type: 'string', required: true, description: '任务描述' },
        action: { type: 'string', required: false, description: '任务动作（如skill_pool_init）' },
        agent_type: { type: 'string', required: true, description: '子Agent类型' },
        output: { type: 'string', required: true, description: '子Agent实际输出文本' },
        success: { type: 'boolean', required: false, description: '子Agent是否成功（默认true）' },
        error: { type: 'string', required: false, description: '子Agent错误信息（如有）' },
        audit_mode: { type: 'string', required: false, description: '审核模式: program/llm/both（默认program）' },
        expected_counts: { type: 'object', required: false, description: '期望实体数量，如{skills:5}' },
        expected_quality: { type: 'array', required: false, description: '期望质量标签数组' },
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, _context: ToolContext): Promise<ToolResponse> => {
        validateRequired(params, ['save_id', 'template_id', 'task_id', 'task_description', 'agent_type', 'output']);

        if (!this.auditAgent || !this.auditContextBuilder) {
          return {
            success: false,
            error: 'AuditAgent 未配置，请先调用 setAuditAgent',
          } as ToolResponse;
        }

        const saveId = params.save_id as ID;
        const templateId = params.template_id as string;
        const ctx = this.auditContextBuilder(saveId, templateId);

        const taskContract: TaskContract = {
          description: params.task_description as string,
          action: params.action as string | undefined,
          expected: {
            counts: params.expected_counts as Record<string, number> | undefined,
            quality: params.expected_quality as string[] | undefined,
          },
        };

        const actualOutput: SubAgentResult = {
          taskId: params.task_id as ID,
          agentType: params.agent_type as string,
          output: params.output as string,
          success: (params.success as boolean) ?? true,
          error: params.error as string | undefined,
        };

        const request: AuditRequest = {
          taskId: params.task_id as ID,
          taskContract,
          actualOutput,
          auditMode: (params.audit_mode as 'program' | 'llm' | 'both') ?? 'program',
        };

        const result = await this.auditAgent.audit(request, ctx);

        return {
          success: true,
          data: result,
        } as ToolResponse;
      },
    });

    this.registerMethod({
      name: 'audit_world',
      description: '世界级审核 - 长时间游戏后或发现矛盾时调用。7项ContinuityAuditor校验+实体关系图交叉验证。',
      parameters: {
        save_id: { type: 'string', required: true, description: '存档ID' },
        template_id: { type: 'string', required: true, description: '模板ID' },
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, _context: ToolContext): Promise<ToolResponse> => {
        validateRequired(params, ['save_id', 'template_id']);

        if (!this.auditAgent || !this.auditContextBuilder) {
          return {
            success: false,
            error: 'AuditAgent 未配置，请先调用 setAuditAgent',
          } as ToolResponse;
        }

        const saveId = params.save_id as ID;
        const templateId = params.template_id as string;
        const ctx = this.auditContextBuilder(saveId, templateId);

        const result = await this.auditAgent.auditWorld(saveId, ctx);

        return {
          success: true,
          data: result,
        } as ToolResponse;
      },
    });
  }
}
