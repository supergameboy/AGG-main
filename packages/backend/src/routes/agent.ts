import { Router, Request, Response, NextFunction } from 'express';
import type { AgentRuntime } from '../agents/AgentRuntime.js';
import { ToolRegistry } from '../agents/ToolRegistry.js';
import { DecisionLogService } from '../services/decision-log.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { createChildLogger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { AgentMessage, AgentType } from '../../../shared/src/types/agent.js';
import { randomUUID } from 'crypto';
import { ID, Timestamp } from '../../../shared/src/types/core.js';
import type { Knex } from 'knex';
import { validateBody, validateQuery } from '../middlewares/validate.js';
import {
  decisionsQuerySchema,
  directMessageSchema
} from '../schemas/agent.schema.js';

const logger = createChildLogger('routes:agent');

interface DirectMessageRequestBody {
  agentType: AgentType;
  message: string;
  saveId?: string;
  action?: string;
}

export function createAgentRoutes(
  coordinatorAgent: AgentRuntime,
  decisionLogService: DecisionLogService,
  _db: Knex
): Router {
  const router = Router();

  /**
   * GET /api/v1/agent/status - 获取系统状态
   * 返回GameMasterAgent的运行状态、已注册的Agent和Tool信息
   */
  router.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const requestId = res.locals.requestId as string | undefined;
      logger.info('Fetching system status');

      const toolRegistry = ToolRegistry.getInstance();

      const statusData = {
        coordinator: {
          status: 'active',
          type: coordinatorAgent.type,
          name: coordinatorAgent.name,
          currentScheduleDepth: coordinatorAgent.getCurrentScheduleDepth(),
          registeredAgentsCount: coordinatorAgent.getRegisteredAgents().length
        },
        agents: coordinatorAgent.getRegisteredAgents().map(agentType => ({
          type: agentType,
          status: 'registered'
        })),
        tools: {
          total: toolRegistry.getToolCount(),
          types: toolRegistry.getRegisteredToolTypes()
        },
        system: {
          timestamp: Date.now(),
          uptime: process.uptime(),
          memory: process.memoryUsage()
        }
      };

      logger.info('System status retrieved', {
        agentsCount: statusData.agents.length,
        toolsCount: statusData.tools.total
      });

      return res.json(successResponse(statusData, requestId));

    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to fetch system status', { error: errorMessage });
      next(error);
      return; // 显式返回以满足TypeScript类型检查
    }
  });

  /**
   * GET /api/v1/agent/tools - 列出所有可用工具
   * 返回所有注册的工具定义信息
   */
  router.get('/tools', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const requestId = res.locals.requestId as string | undefined;
      logger.info('Fetching available tools');

      const toolRegistry = ToolRegistry.getInstance();
      const tools = toolRegistry.getAllTools();

      logger.info('Tools retrieved', { count: tools.length });

      return res.json(successResponse({
        tools,
        count: tools.length
      }, requestId));

    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to fetch tools', { error: errorMessage });
      next(error);
      return; // 显式返回以满足TypeScript类型检查
    }
  });

  /**
   * GET /api/v1/agent/agents - 列出所有注册的Agent
   * 返回所有已注册到GameMasterAgent的专业Agent信息
   */
  router.get('/agents', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const requestId = res.locals.requestId as string | undefined;
      logger.info('Fetching registered agents');

      const registeredAgentTypes = coordinatorAgent.getRegisteredAgents();
      const agents = registeredAgentTypes.map(agentType => {
        const agent = coordinatorAgent.getAgent(agentType);
        return {
          type: agentType,
          name: agent?.name || 'Unknown',
          status: agent ? 'active' : 'inactive',
          systemPrompt: agent?.systemPrompt ? `${agent.systemPrompt.substring(0, 100)}...` : ''
        };
      });

      logger.info('Agents retrieved', { count: agents.length });

      return res.json(successResponse({
        agents,
        count: agents.length
      }, requestId));

    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to fetch agents', { error: errorMessage });
      next(error);
      return; // 显式返回以满足TypeScript类型检查
    }
  });

  /**
   * GET /api/v1/agent/decisions - 查询决策日志
   * 支持按agentType、分页等条件查询决策记录
   *
   * 验证：使用decisionsQuerySchema验证查询参数（limit/offset/saveId等）
   */
  router.get('/decisions', validateQuery(decisionsQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestId = res.locals.requestId as string | undefined;
      // 使用验证后的查询参数（从中间件的req.validatedQuery获取）
      const {
        agentType,
        limit = 20,
        offset = 0,
        saveId = 'system'
      } = (req as any).validatedQuery || req.query;

      const limitNum = parseInt(limit as string);
      const offsetNum = parseInt(offset as string);
      const saveIdStr = saveId as string;

      logger.info('Fetching decision logs', {
        agentType,
        limit: limitNum,
        offset: offsetNum,
        saveId: saveIdStr
      });

      // 使用DecisionLogService进行真实查询
      let result;

      if (agentType) {
        // 按agentType查询
        const decisions = await decisionLogService.getDecisionsByAgent(
          saveIdStr as any,
          agentType as any
        );
        result = {
          data: decisions.slice(offsetNum, offsetNum + limitNum),
          total: decisions.length,
          limit: limitNum,
          offset: offsetNum,
          saveId: saveIdStr,
          agentType: agentType
        };
      } else {
        // 通用分页查询
        const paginatedResult = await decisionLogService.getDecisions(saveIdStr as any, {
          pageSize: limitNum,
          page: Math.floor(offsetNum / limitNum) + 1
        });
        result = {
          data: paginatedResult.data,
          total: paginatedResult.total,
          limit: limitNum,
          offset: offsetNum,
          saveId: saveIdStr,
          totalPages: paginatedResult.totalPages
        };
      }

      logger.info('Decision logs query completed', {
        agentType,
        returnedCount: result.data.length,
        total: result.total
      });

      return res.json(successResponse(result, requestId));

    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to fetch decision logs', { error: errorMessage });
      next(error);
      return; // 显式返回以满足TypeScript类型检查
    }
  });

  /**
   * POST /api/v1/agent/message - 直接发送消息到指定Agent（调试用）
   * 绕过GameMasterAgent的路由逻辑，直接与指定Agent通信
   *
   * 验证：使用directMessageSchema验证请求体（agentType和message必填）
   */
  router.post('/message', validateBody(directMessageSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestId = res.locals.requestId as string | undefined;
      // 使用验证后的数据（从中间件的req.validatedBody获取）
      const body: DirectMessageRequestBody = (req as any).validatedBody || req.body;

      logger.info('Received direct message request', {
        targetAgent: body.agentType,
        messageLength: body.message.length,
        saveId: body.saveId
      });

      // 获取目标Agent
      const targetAgent = coordinatorAgent.getAgent(body.agentType);

      if (!targetAgent) {
        logger.warn('Target agent not found', { agentType: body.agentType });
        return res.status(404).json(
          errorResponse('AGENT_NOT_FOUND', `Agent not found: ${body.agentType}`, {
            availableAgents: coordinatorAgent.getRegisteredAgents()
          }, requestId)
        );
      }

      // 构建消息
      const agentMessage: AgentMessage = {
        id: randomUUID() as ID,
        timestamp: Date.now() as Timestamp,
        from: 'output',
        to: body.agentType,
        type: 'request',
        saveId: body.saveId as ID,
        payload: {
          action: body.action || 'direct_message',
          data: {
            content: body.message,
            action: body.action,
          }
        },
        metadata: {
          priority: 'normal',
          requiresResponse: true,
          timeout: config.timeout.directMessage // 超时已禁用（config.timeout.directMessage = 0）
        }
      };

      logger.debug('Sending direct message to agent', {
        targetAgent: body.agentType,
        messageId: agentMessage.id
      });

      // 直接调用目标Agent处理消息
      const startTime = Date.now();
      const response = await targetAgent.processMessage(agentMessage);
      const processingTime = Date.now() - startTime;

      logger.info('Direct message processed', {
        targetAgent: body.agentType,
        success: response.success,
        processingTime
      });

      if (!response.success) {
        return res.status(500).json(
          errorResponse('AGENT_PROCESSING_ERROR', response.error || 'Failed to process message', {
            agentType: body.agentType,
            processingTime
          }, requestId)
        );
      }

      return res.json(successResponse({
        ...response,
        metadata: {
          processingTime,
          targetAgent: body.agentType,
          messageId: agentMessage.id,
          processedAt: new Date().toISOString(),
          isDirectMessage: true
        }
      }, requestId));

    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Unexpected error in direct message endpoint', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      });
      next(error);
      return; // 显式返回以满足TypeScript类型检查
    }
  });

  logger.info('Agent routes initialized');

  return router;
}
