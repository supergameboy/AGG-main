/**
 * WS Template 模块处理器
 *
 * 处理模板 CRUD、模板池操作、AI 生成等 template 相关的 WS 请求。
 */

import type { WebSocket } from 'ws';
import type { WSGameRequest, AgentMessage, ID, Timestamp } from '@ai-rpg/shared';
import type { GenerateOptionsTool, GenerateType } from '../game-systems/character/GenerateOptionsTool.js';
import type { GameHandlerContext } from './ws-request-handler.js';
import { randomUUID } from 'crypto';
import { TemplateService } from './template.js';
import { TemplatePoolService } from './template-pool.js';
import { sendResult, sendError, requireTemplateId } from './ws-request-handler.js';
import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';

const logger = createChildLogger('ws-template-handler');

export async function handleTemplateModule(request: WSGameRequest, ws: WebSocket, ctx: GameHandlerContext): Promise<void> {
  const { action, requestId, payload } = request;
  const { webSocketService } = ctx;
  const templateService = new TemplateService(ctx.db);

  try {
    let result: unknown;
    switch (action) {
      case 'list': {
        const templates = await templateService.getTemplates();
        // 前端契约是 snake_case（StoryTemplate），与 HTTP 路由一致经 toApiResponse 转换
        result = { templates: templates.map(TemplateService.toApiResponse) };
        break;
      }
      case 'get': {
        if (!requireTemplateId(webSocketService, ws, requestId, payload)) return;
        result = TemplateService.toApiResponse(await templateService.getTemplate(payload.templateId));
        break;
      }
      case 'create':
      case 'import': {
        result = TemplateService.toApiResponse(await templateService.importTemplate(payload));
        break;
      }
      case 'update': {
        if (!requireTemplateId(webSocketService, ws, requestId, payload)) return;
        const { templateId: _id, ...updateData } = payload;
        result = TemplateService.toApiResponse(await templateService.updateTemplate(payload.templateId, updateData));
        break;
      }
      case 'delete': {
        if (!requireTemplateId(webSocketService, ws, requestId, payload)) return;
        await templateService.deleteTemplate(payload.templateId);
        result = { deleted: true };
        break;
      }
      case 'duplicate': {
        if (!requireTemplateId(webSocketService, ws, requestId, payload)) return;
        result = TemplateService.toApiResponse(await templateService.duplicateTemplate(payload.templateId));
        break;
      }
      case 'export': {
        if (!requireTemplateId(webSocketService, ws, requestId, payload)) return;
        result = await templateService.exportTemplate(payload.templateId);
        break;
      }
      case 'game-config': {
        if (!requireTemplateId(webSocketService, ws, requestId, payload)) return;
        const template = await templateService.getTemplate(payload.templateId);
        const startingScene = template.startingScene as Record<string, unknown> | undefined;
        result = {
          ui_theme: template.uiTheme,
          ui_layout: template.uiLayout,
          game_rules: template.gameRules,
          ai_constraints: template.aiConstraints,
          world_setting: template.worldSetting,
          special_rules: template.specialRules,
          numerical_complexity: template.numericalComplexity,
          skills: template.skills ?? [],
          items: template.items ?? [],
          npcs: (startingScene?.npcs as Record<string, unknown>[]) ?? [],
        };
        break;
      }
      case 'character-options': {
        if (!requireTemplateId(webSocketService, ws, requestId, payload)) return;
        const template = await templateService.getTemplate(payload.templateId);
        const characterCreation = template.characterCreation as Record<string, unknown>;
        result = {
          races: characterCreation?.races ?? [],
          classes: characterCreation?.classes ?? [],
          backgrounds: characterCreation?.backgrounds ?? [],
          attributes: characterCreation?.attributes ?? [],
          attribute_points: characterCreation?.attribute_points ?? 50,
          custom_options: characterCreation?.custom_options ?? [],
          age_mode: characterCreation?.age_mode ?? 'group',
          age_groups: characterCreation?.age_groups ?? [],
          age_number: characterCreation?.age_number ?? { min: 1, max: 999 },
        };
        break;
      }
      case 'validate': {
        if (!requireTemplateId(webSocketService, ws, requestId, payload)) return;
        const template = await templateService.getTemplate(payload.templateId);
        result = templateService.validateTemplateDetailed(template);
        break;
      }
      case 'pool:skills': {
        if (!requireTemplateId(webSocketService, ws, requestId, payload)) return;
        const poolService = new TemplatePoolService(ctx.db);
        result = await poolService.listSkills(payload.templateId, {
          category: payload.category as string | undefined,
          recommendedClass: payload.recommendedClass as string | undefined,
        });
        break;
      }
      case 'pool:items': {
        if (!requireTemplateId(webSocketService, ws, requestId, payload)) return;
        const poolService = new TemplatePoolService(ctx.db);
        result = await poolService.listItems(payload.templateId, {
          category: payload.category as string | undefined,
          equippedSlot: payload.equippedSlot as string | undefined,
          recommendedClass: payload.recommendedClass as string | undefined,
          quality: payload.quality as string | undefined,
        });
        break;
      }
      case 'pool:add-skill': {
        if (!requireTemplateId(webSocketService, ws, requestId, payload)) return;
        const data = payload.data as Record<string, unknown>;
        if (!data) {
          sendError(webSocketService, ws, requestId, 'DATA_REQUIRED', 'data is required', true, 'template');
          return;
        }
        const poolService = new TemplatePoolService(ctx.db);
        result = await poolService.createSkill(payload.templateId, data as unknown as import('./template-pool.js').CreateTemplateSkillParams);
        break;
      }
      case 'pool:update-skill': {
        if (!requireTemplateId(webSocketService, ws, requestId, payload)) return;
        const skillId = payload.skillId as string;
        const data = payload.data as Record<string, unknown>;
        if (!skillId) {
          sendError(webSocketService, ws, requestId, 'SKILL_ID_REQUIRED', 'skillId is required', true, 'template');
          return;
        }
        if (!data) {
          sendError(webSocketService, ws, requestId, 'DATA_REQUIRED', 'data is required', true, 'template');
          return;
        }
        const poolService = new TemplatePoolService(ctx.db);
        result = await poolService.updateSkill(payload.templateId, skillId, data as Partial<import('./template-pool.js').CreateTemplateSkillParams>);
        break;
      }
      case 'pool:delete-skill': {
        if (!requireTemplateId(webSocketService, ws, requestId, payload)) return;
        const skillId = payload.skillId as string;
        if (!skillId) {
          sendError(webSocketService, ws, requestId, 'SKILL_ID_REQUIRED', 'skillId is required', true, 'template');
          return;
        }
        const poolService = new TemplatePoolService(ctx.db);
        await poolService.removeSkill(payload.templateId, skillId);
        result = { deleted: true };
        break;
      }
      case 'pool:add-item': {
        if (!requireTemplateId(webSocketService, ws, requestId, payload)) return;
        const data = payload.data as Record<string, unknown>;
        if (!data) {
          sendError(webSocketService, ws, requestId, 'DATA_REQUIRED', 'data is required', true, 'template');
          return;
        }
        const poolService = new TemplatePoolService(ctx.db);
        result = await poolService.createItem(payload.templateId, data as unknown as import('./template-pool.js').CreateTemplateItemParams);
        break;
      }
      case 'pool:update-item': {
        if (!requireTemplateId(webSocketService, ws, requestId, payload)) return;
        const itemId = payload.itemId as string;
        const data = payload.data as Record<string, unknown>;
        if (!itemId) {
          sendError(webSocketService, ws, requestId, 'ITEM_ID_REQUIRED', 'itemId is required', true, 'template');
          return;
        }
        if (!data) {
          sendError(webSocketService, ws, requestId, 'DATA_REQUIRED', 'data is required', true, 'template');
          return;
        }
        const poolService = new TemplatePoolService(ctx.db);
        result = await poolService.updateItem(payload.templateId, itemId, data as Partial<import('./template-pool.js').CreateTemplateItemParams>);
        break;
      }
      case 'pool:delete-item': {
        if (!requireTemplateId(webSocketService, ws, requestId, payload)) return;
        const itemId = payload.itemId as string;
        if (!itemId) {
          sendError(webSocketService, ws, requestId, 'ITEM_ID_REQUIRED', 'itemId is required', true, 'template');
          return;
        }
        const poolService = new TemplatePoolService(ctx.db);
        await poolService.removeItem(payload.templateId, itemId);
        result = { deleted: true };
        break;
      }
      case 'pool:generate-skills': {
        if (!requireTemplateId(webSocketService, ws, requestId, payload)) return;
        const tplId = payload.templateId;
        const { categories, recommendedClasses, batchSize, seed } = payload as {
          categories?: string[]; recommendedClasses?: string[]; batchSize?: number; seed?: string;
        };
        const resultId = randomUUID();
        // v2 新增: 获取 clientId 用于进度事件广播
        const clientId = webSocketService.getClientIdByWs(ws) ?? '';
        // 立即返回 resultId，异步生成完成后通过 WS 事件推送
        sendResult(webSocketService, ws, requestId, 'template', { result_id: resultId, status: 'pending' }, request.intentHint);
        (async () => {
          try {
            const agentMessage: AgentMessage = {
              id: randomUUID() as ID, timestamp: Date.now() as Timestamp,
              from: 'template-editor' as unknown as import('@ai-rpg/shared').AgentType,
              to: 'gamemaster', type: 'request', saveId: '0' as ID,
              payload: {
                action: 'generate_pool_skills',
                data: { templateId: tplId, intentHint: 'generate_pool_skills', categories, recommendedClasses, batchSize: batchSize ?? 10, seed },
              },
              metadata: {
                priority: 'normal',
                requiresResponse: true,
                // v2 新增: 注入 WS 请求元信息，供 processMessage 入口创建 ProgressContext
                _wsRequestId: requestId,
                _wsClientId: clientId,
              },
            };
            // v2 模块F D5: 请求级实例化——每个请求创建独立的 GM Agent 副本
            const scopedAgent = ctx.coordinatorAgent.createRequestScopedCopy();
            const agentResult = await scopedAgent.processMessage(agentMessage);
            // v2 模块E P1-8: 异步 IIFE 使用 broadcastToClient 而非 sendToClient
            webSocketService.broadcastToClient(clientId, 'generate_progress', {
              resultId, status: agentResult.success ? 'completed' : 'failed', type: 'skills', data: agentResult.success ? agentResult.data : undefined, error: agentResult.success ? undefined : agentResult.error,
            }, requestId);
          } catch (err) {
            // v2 模块E P1-18/H10: 异步 IIFE catch 块添加 logger.error
            logger.error('Async skill generation failed', {
              resultId,
              error: getErrorMessage(err),
            });
            webSocketService.broadcastToClient(clientId, 'generate_progress', {
              resultId, status: 'failed', type: 'skills', error: getErrorMessage(err),
            }, requestId);
          }
        })();
        return;
      }
      case 'pool:generate-items': {
        if (!requireTemplateId(webSocketService, ws, requestId, payload)) return;
        const tplId = payload.templateId;
        const { categories, recommendedClasses, batchSize, seed } = payload as {
          categories?: string[]; recommendedClasses?: string[]; batchSize?: number; seed?: string;
        };
        const resultId = randomUUID();
        // v2 新增: 获取 clientId 用于进度事件广播
        const clientId = webSocketService.getClientIdByWs(ws) ?? '';
        sendResult(webSocketService, ws, requestId, 'template', { result_id: resultId, status: 'pending' }, request.intentHint);
        (async () => {
          try {
            const agentMessage: AgentMessage = {
              id: randomUUID() as ID, timestamp: Date.now() as Timestamp,
              from: 'template-editor' as unknown as import('@ai-rpg/shared').AgentType,
              to: 'gamemaster', type: 'request', saveId: '0' as ID,
              payload: {
                action: 'generate_pool_items',
                data: { templateId: tplId, intentHint: 'generate_pool_items', categories, recommendedClasses, batchSize: batchSize ?? 10, seed },
              },
              metadata: {
                priority: 'normal',
                requiresResponse: true,
                // v2 新增: 注入 WS 请求元信息，供 processMessage 入口创建 ProgressContext
                _wsRequestId: requestId,
                _wsClientId: clientId,
              },
            };
            // v2 模块F D5: 请求级实例化——每个请求创建独立的 GM Agent 副本
            const scopedAgent = ctx.coordinatorAgent.createRequestScopedCopy();
            const agentResult = await scopedAgent.processMessage(agentMessage);
            // v2 模块E P1-8: 异步 IIFE 使用 broadcastToClient 而非 sendToClient
            webSocketService.broadcastToClient(clientId, 'generate_progress', {
              resultId, status: agentResult.success ? 'completed' : 'failed', type: 'items', data: agentResult.success ? agentResult.data : undefined, error: agentResult.success ? undefined : agentResult.error,
            }, requestId);
          } catch (err) {
            // v2 模块E P1-18/H10: 异步 IIFE catch 块添加 logger.error
            logger.error('Async item generation failed', {
              resultId,
              error: getErrorMessage(err),
            });
            webSocketService.broadcastToClient(clientId, 'generate_progress', {
              resultId, status: 'failed', type: 'items', error: getErrorMessage(err),
            }, requestId);
          }
        })();
        return;
      }
      case 'pool:generate-status': {
        const resultId = payload.resultId as string;
        if (!resultId) {
          sendError(webSocketService, ws, requestId, 'RESULT_ID_REQUIRED', 'resultId is required', true, 'template');
          return;
        }
        // WS 模式下不需要轮询，generate_progress 事件会主动推送
        // 此 action 保留兼容，返回提示信息
        sendResult(webSocketService, ws, requestId, 'template', { resultId, hint: 'Use generate_progress WS events instead of polling' }, request.intentHint);
        return;
      }
      case 'pool:commit-skills': {
        if (!requireTemplateId(webSocketService, ws, requestId, payload)) return;
        const skills = payload.skills as Array<Record<string, unknown>>;
        if (!skills || !Array.isArray(skills) || skills.length === 0) {
          sendError(webSocketService, ws, requestId, 'SKILLS_REQUIRED', 'skills array is required and must not be empty', true, 'template');
          return;
        }
        const poolService = new TemplatePoolService(ctx.db);
        result = await poolService.createSkills(payload.templateId, skills.map(s => ({ ...s, source: 'generated' } as import('./template-pool.js').CreateTemplateSkillParams)));
        break;
      }
      case 'pool:commit-items': {
        if (!requireTemplateId(webSocketService, ws, requestId, payload)) return;
        const items = payload.items as Array<Record<string, unknown>>;
        if (!items || !Array.isArray(items) || items.length === 0) {
          sendError(webSocketService, ws, requestId, 'ITEMS_REQUIRED', 'items array is required and must not be empty', true, 'template');
          return;
        }
        const poolService = new TemplatePoolService(ctx.db);
        result = await poolService.createItems(payload.templateId, items.map(s => ({ ...s, source: 'generated' } as import('./template-pool.js').CreateTemplateItemParams)));
        break;
      }
      case 'pool:stats': {
        if (!requireTemplateId(webSocketService, ws, requestId, payload)) return;
        const poolService = new TemplatePoolService(ctx.db);
        result = await poolService.getPoolStats(payload.templateId);
        break;
      }
      case 'pool:generate-options': {
        if (!requireTemplateId(webSocketService, ws, requestId, payload)) return;
        const tplId = payload.templateId;
        const generateType = (payload.type || 'race') as GenerateType;
        const userPrompt = payload.prompt as string | undefined;
        const sessionId = `opt-${randomUUID()}`;
        // v2 新增: 获取 clientId 用于异步 IIFE 广播
        const clientId = webSocketService.getClientIdByWs(ws) ?? '';
        // 立即返回 sessionId，异步生成完成后通过 WS 事件推送
        sendResult(webSocketService, ws, requestId, 'template', { session_id: sessionId, status: 'pending' }, request.intentHint);
        (async () => {
          try {
            const toolRegistry = ctx.toolRegistry;
            const generateOptionsTool = toolRegistry.getTool('generate_options' as import('@ai-rpg/shared').ToolType) as GenerateOptionsTool | undefined;
            if (generateOptionsTool) {
              const generatedResult = await generateOptionsTool.generateByType(generateType, tplId, userPrompt);
              // v2 模块E P1-8: 异步 IIFE 使用 broadcastToClient
              webSocketService.broadcastToClient(clientId, 'generate_progress', {
                sessionId, status: 'completed', type: generateType, data: generatedResult.data,
              }, requestId);
            } else {
              // fallback: 返回模板已有数据
              const template = await new TemplateService(ctx.db).getTemplate(tplId);
              const characterCreation = (template.characterCreation || {}) as Record<string, unknown>;
              const fallbackData = {
                races: (characterCreation.races as unknown[]) ?? [],
                classes: (characterCreation.classes as unknown[]) ?? [],
                backgrounds: (characterCreation.backgrounds as unknown[]) ?? [],
              };
              webSocketService.broadcastToClient(clientId, 'generate_progress', {
                sessionId, status: 'completed', type: generateType, data: fallbackData,
              }, requestId);
            }
          } catch (err) {
            // v2 模块E P1-18/H10: 异步 IIFE catch 块添加 logger.error
            logger.error('Async options generation failed', {
              sessionId,
              error: getErrorMessage(err),
            });
            webSocketService.broadcastToClient(clientId, 'generate_progress', {
              sessionId, status: 'failed', type: generateType, error: getErrorMessage(err),
            }, requestId);
          }
        })();
        return;
      }
      default:
        sendError(webSocketService, ws, requestId, 'UNKNOWN_ACTION', `Unknown template action: ${action}`, false, 'template');
        return;
    }

    sendResult(webSocketService, ws, requestId, 'template', result, request.intentHint);
  } catch (error) {
    sendError(webSocketService, ws, requestId, 'TEMPLATE_ERROR', getErrorMessage(error), false, 'template');
  }
}
