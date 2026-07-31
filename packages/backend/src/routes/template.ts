import { Router, Request, Response, NextFunction } from 'express';
import { TemplateService } from '../services/template.js';
import { TemplatePoolService } from '../services/template-pool.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { Knex } from 'knex';
import type { ConfigLoader } from '../agents/config/ConfigLoader.js';
import type { AgentRuntime } from '../agents/AgentRuntime.js';
import type { AgentMessage } from '../../../shared/src/types/agent.js';
import type { ID, Timestamp } from '../../../shared/src/types/core.js';
import { GenerateOptionsTool, type GenerateType } from '../game-systems/character/GenerateOptionsTool.js';
import { ToolRegistry } from '../agents/ToolRegistry.js';
import { randomUUID } from 'crypto';

const logger = createChildLogger('routes:template');

// ===== AI生成选项缓存 =====
interface GeneratedOptionsData {
  races: unknown[];
  classes: unknown[];
  backgrounds: unknown[];
}

/** 扩展缓存数据类型，支持多种生成结果 */
interface CachedGeneratedOptions {
  data?: GeneratedOptionsData | unknown;
  /** 生成类型 */
  type?: GenerateType;
  status: 'pending' | 'completed' | 'failed';
  expiresAt: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30分钟

/** 合法的生成类型 */
const VALID_GENERATE_TYPES: GenerateType[] = [
  'race', 'class', 'background',
  'world_setting', 'npc', 'item', 'quest', 'scene',
  'races', 'classes', 'backgrounds',
];

const generatedOptionsCache = new Map<string, CachedGeneratedOptions>();

// ===== 模板池 LLM 生成结果缓存 =====
interface PoolGenResult {
  status: 'pending' | 'completed' | 'failed';
  type: 'skills' | 'items';
  data?: unknown;
  error?: string;
  createdAt: number;
}
const poolGenResultCache = new Map<string, PoolGenResult>();
const POOL_RESULT_TTL = 30 * 60 * 1000;

function cleanupCache(): void {
  const now = Date.now();
  for (const [key, value] of generatedOptionsCache) {
    if (value.expiresAt < now) generatedOptionsCache.delete(key);
  }
}

export function createTemplateRouter(db: Knex, configLoader?: ConfigLoader, coordinatorAgent?: AgentRuntime): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const templateService = new TemplateService(db, undefined, configLoader);
      const templates = await templateService.getTemplates();
      return res.json(successResponse(templates.map(TemplateService.toApiResponse), requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to list templates', { error: errorMessage });
      next(error);
      return;
    }
  });

  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { id } = req.params;
      const templateService = new TemplateService(db, undefined, configLoader);
      const template = await templateService.getTemplate(id);
      return res.json(successResponse(TemplateService.toApiResponse(template), requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get template', { id: req.params.id, error: errorMessage });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('TEMPLATE_NOT_FOUND', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { data } = req.body;
      if (!data) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'data is required', undefined, requestId));
      }
      const templateService = new TemplateService(db, undefined, configLoader);
      const template = await templateService.importTemplate(data);
      return res.status(201).json(successResponse(TemplateService.toApiResponse(template), requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to import template', { error: errorMessage });
      if (errorMessage.includes('validation failed')) {
        return res.status(400).json(errorResponse('VALIDATION_ERROR', errorMessage, undefined, requestId));
      }
      if (errorMessage.includes('Invalid JSON')) {
        return res.status(400).json(errorResponse('INVALID_JSON', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { id } = req.params;
      const updates = req.body;
      if (!updates || Object.keys(updates).length === 0) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'At least one field must be provided for update', undefined, requestId));
      }
      const templateService = new TemplateService(db, undefined, configLoader);
      const updated = await templateService.updateTemplate(id, updates);
      return res.json(successResponse(TemplateService.toApiResponse(updated), requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to update template', { id: req.params.id, error: errorMessage });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('TEMPLATE_NOT_FOUND', errorMessage, undefined, requestId));
      }
      if (errorMessage.includes('built-in')) {
        return res.status(403).json(errorResponse('FORBIDDEN', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { id } = req.params;
      const templateService = new TemplateService(db, undefined, configLoader);
      await templateService.deleteTemplate(id);
      return res.json(successResponse({ deleted: true, id }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to delete template', { id: req.params.id, error: errorMessage });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('TEMPLATE_NOT_FOUND', errorMessage, undefined, requestId));
      }
      if (errorMessage.includes('built-in')) {
        return res.status(403).json(errorResponse('FORBIDDEN', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.get('/:id/prompts', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { id } = req.params;
      const templateService = new TemplateService(db, undefined, configLoader);
      const prompts = await templateService.getTemplatePrompts(id);
      return res.json(successResponse(prompts, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get template prompts', { id: req.params.id, error: errorMessage });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('TEMPLATE_NOT_FOUND', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.post('/:id/export', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { id } = req.params;
      const templateService = new TemplateService(db, undefined, configLoader);
      const exportData = await templateService.exportTemplate(id);
      return res.json(successResponse(exportData, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to export template', { id: req.params.id, error: errorMessage });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('TEMPLATE_NOT_FOUND', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.post('/:id/duplicate', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { id } = req.params;
      const templateService = new TemplateService(db, undefined, configLoader);
      const duplicated = await templateService.duplicateTemplate(id);
      return res.status(201).json(successResponse(TemplateService.toApiResponse(duplicated), requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to duplicate template', { id: req.params.id, error: errorMessage });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('TEMPLATE_NOT_FOUND', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.get('/:id/game-config', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { id } = req.params;
      const templateService = new TemplateService(db, undefined, configLoader);
      const template = await templateService.getTemplate(id);
      const startingScene = template.startingScene as Record<string, unknown> | undefined;
      const skills = template.skills ?? [];
      const gameConfig = {
        ui_theme: template.uiTheme,
        ui_layout: template.uiLayout,
        game_rules: template.gameRules,
        ai_constraints: template.aiConstraints,
        world_setting: template.worldSetting,
        special_rules: template.specialRules,
        numerical_complexity: template.numericalComplexity,
        skills,
        items: template.items ?? [],
        npcs: (startingScene?.npcs as Record<string, unknown>[]) ?? [],
      };
      return res.json(successResponse(gameConfig, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get game config', { id: req.params.id, error: errorMessage });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('TEMPLATE_NOT_FOUND', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.get('/:id/character-options', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { id } = req.params;
      const templateService = new TemplateService(db, undefined, configLoader);
      const template = await templateService.getTemplate(id);
      const characterCreation = template.characterCreation;
      const characterOptions = {
        races: (characterCreation as Record<string, unknown>).races ?? [],
        classes: (characterCreation as Record<string, unknown>).classes ?? [],
        backgrounds: (characterCreation as Record<string, unknown>).backgrounds ?? [],
        attributes: (characterCreation as Record<string, unknown>).attributes ?? [],
        attribute_points: (characterCreation as Record<string, unknown>).attribute_points ?? 50,
        custom_options: (characterCreation as Record<string, unknown>).custom_options ?? [],
        age_mode: (characterCreation as Record<string, unknown>).age_mode ?? 'group',
        age_groups: (characterCreation as Record<string, unknown>).age_groups ?? [],
        age_number: (characterCreation as Record<string, unknown>).age_number ?? { min: 1, max: 999 },
      };
      return res.json(successResponse(characterOptions, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get character options', { id: req.params.id, error: errorMessage });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('TEMPLATE_NOT_FOUND', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.post('/:id/validate', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { id } = req.params;
      const templateService = new TemplateService(db, undefined, configLoader);
      const template = await templateService.getTemplate(id);
      const validationResult = templateService.validateTemplateDetailed(template);
      validationResult.errors = validationResult.errors || [];
      validationResult.warnings = validationResult.warnings || [];
      return res.json(successResponse(validationResult, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to validate template', { id: req.params.id, error: errorMessage });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('TEMPLATE_NOT_FOUND', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  // ===== AI生成角色选项 =====

  /**
   * POST /:id/generate-options
   * 触发AI异步生成，支持多种生成类型
   * 请求体: { type?: GenerateType, prompt?: string }
   * - type: 生成类型，默认为 'race'（兼容旧版，生成races/classes/backgrounds）
   * - prompt: 用户自定义提示词（可选）
   * 立即返回 session_id，前端轮询 GET /:id/generated-options/:sessionId 获取结果
   */
  router.post('/:id/generate-options', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { id } = req.params;
      const generateType = (req.body.type || 'race') as GenerateType;
      const userPrompt = req.body.prompt as string | undefined;

      // 验证生成类型
      if (!VALID_GENERATE_TYPES.includes(generateType)) {
        return res.status(400).json(errorResponse(
          'INVALID_REQUEST',
          `Invalid generate type: ${generateType}. Valid types: ${VALID_GENERATE_TYPES.join(', ')}`,
          undefined,
          requestId
        ));
      }

      const templateService = new TemplateService(db, undefined, configLoader);
      await templateService.getTemplate(id);

      const sessionId = `opt-${randomUUID()}`;

      generatedOptionsCache.set(sessionId, {
        status: 'pending',
        type: generateType,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });

      cleanupCache();

      (async () => {
        try {
          const toolRegistry = ToolRegistry.getInstance();
          const generateOptionsTool = toolRegistry.getTool('generate_options' as import('../../../shared/src/types/agent').ToolType) as GenerateOptionsTool | undefined;

          if (generateOptionsTool) {
            // 使用新的 generateByType 方法
            const generatedResult = await generateOptionsTool.generateByType(
              generateType,
              id,
              userPrompt
            );

            // 从 GeneratedResult 中提取 data
            const resultData = generatedResult.data;

            generatedOptionsCache.set(sessionId, {
              status: 'completed',
              type: generateType,
              data: resultData,
              expiresAt: Date.now() + CACHE_TTL_MS,
            });
            logger.info('AI generated options completed', { sessionId, templateId: id, type: generateType });
          } else {
            // fallback: 无工具实例时返回模板已有数据
            const template = await templateService.getTemplate(id);
            const characterCreation = (template.characterCreation || {}) as Record<string, unknown>;
            const fallbackData = {
              races: (characterCreation.races as unknown[]) ?? [],
              classes: (characterCreation.classes as unknown[]) ?? [],
              backgrounds: (characterCreation.backgrounds as unknown[]) ?? []
            };

            generatedOptionsCache.set(sessionId, {
              status: 'completed',
              type: generateType,
              data: fallbackData,
              expiresAt: Date.now() + CACHE_TTL_MS,
            });
            logger.info('AI generated options completed (fallback)', { sessionId, templateId: id, type: generateType });
          }
        } catch (err) {
          const errMsg = getErrorMessage(err);
          generatedOptionsCache.set(sessionId, {
            status: 'failed',
            type: generateType,
            expiresAt: Date.now() + CACHE_TTL_MS,
          });
          logger.error('AI generated options task error', { sessionId, templateId: id, type: generateType, error: errMsg });
        }
      })();

      return res.json(successResponse({ session_id: sessionId, type: generateType }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to trigger generate options', { id: req.params.id, error: errorMessage });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('TEMPLATE_NOT_FOUND', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  /**
   * GET /:id/generated-options/:sessionId
   * 获取AI生成的结果
   * 返回 status: pending | completed | failed | expired
   * completed 时额外返回 type 和 data
   */
  router.get('/:id/generated-options/:sessionId', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { sessionId } = req.params;

      cleanupCache();

      const cached = generatedOptionsCache.get(sessionId);

      if (!cached) {
        return res.json(successResponse({ status: 'expired' as const }, requestId));
      }

      if (cached.expiresAt < Date.now()) {
        generatedOptionsCache.delete(sessionId);
        return res.json(successResponse({ status: 'expired' as const }, requestId));
      }

      if (cached.status === 'completed') {
        return res.json(successResponse({
          status: 'completed' as const,
          type: cached.type || 'race',
          data: cached.data,
        }, requestId));
      }

      if (cached.status === 'failed') {
        return res.json(successResponse({ status: 'failed' as const, type: cached.type }, requestId));
      }

      // pending
      return res.json(successResponse({ status: 'pending' as const, type: cached.type }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get generated options', { id: req.params.id, sessionId: req.params.sessionId, error: errorMessage });
      next(error);
      return;
    }
  });

  logger.info('Template routes initialized');

  // =========================================================================
  // 模板池 REST CRUD
  // =========================================================================

  // ----- 技能池 -----

  router.get('/:id/pool/skills', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { id } = req.params;
      const poolService = new TemplatePoolService(db);
      const skills = await poolService.listSkills(id, {
        category: req.query.category as string | undefined,
        recommendedClass: req.query.recommendedClass as string | undefined,
      });
      return res.json(successResponse(skills, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to list template skills', { id: req.params.id, error: errorMessage });
      next(error);
      return;
    }
  });

  router.get('/:id/pool/skills/:skillId', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { id, skillId } = req.params;
      const poolService = new TemplatePoolService(db);
      const skill = await poolService.getSkill(id, skillId);
      if (!skill) {
        return res.status(404).json(errorResponse('NOT_FOUND', 'Skill not found', undefined, requestId));
      }
      return res.json(successResponse(skill, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get template skill', { id: req.params.id, skillId: req.params.skillId, error: errorMessage });
      next(error);
      return;
    }
  });

  router.post('/:id/pool/skills', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { id } = req.params;
      const poolService = new TemplatePoolService(db);
      const skill = await poolService.createSkill(id, req.body);
      return res.status(201).json(successResponse(skill, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to create template skill', { id: req.params.id, error: errorMessage });
      next(error);
      return;
    }
  });

  router.put('/:id/pool/skills/:skillId', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { id, skillId } = req.params;
      const poolService = new TemplatePoolService(db);
      const updated = await poolService.updateSkill(id, skillId, req.body);
      if (!updated) {
        return res.status(404).json(errorResponse('NOT_FOUND', 'Skill not found', undefined, requestId));
      }
      return res.json(successResponse(updated, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to update template skill', { id: req.params.id, skillId: req.params.skillId, error: errorMessage });
      next(error);
      return;
    }
  });

  router.delete('/:id/pool/skills/:skillId', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { id, skillId } = req.params;
      const poolService = new TemplatePoolService(db);
      const removed = await poolService.removeSkill(id, skillId);
      if (!removed) {
        return res.status(404).json(errorResponse('NOT_FOUND', 'Skill not found', undefined, requestId));
      }
      return res.json(successResponse({ deleted: true, id: skillId }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to delete template skill', { id: req.params.id, skillId: req.params.skillId, error: errorMessage });
      next(error);
      return;
    }
  });

  // ----- 物品池 -----

  router.get('/:id/pool/items', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { id } = req.params;
      const poolService = new TemplatePoolService(db);
      const items = await poolService.listItems(id, {
        category: req.query.category as string | undefined,
        equippedSlot: req.query.equippedSlot as string | undefined,
        recommendedClass: req.query.recommendedClass as string | undefined,
        quality: req.query.quality as string | undefined,
      });
      return res.json(successResponse(items, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to list template items', { id: req.params.id, error: errorMessage });
      next(error);
      return;
    }
  });

  router.get('/:id/pool/items/:itemId', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { id, itemId } = req.params;
      const poolService = new TemplatePoolService(db);
      const item = await poolService.getItem(id, itemId);
      if (!item) {
        return res.status(404).json(errorResponse('NOT_FOUND', 'Item not found', undefined, requestId));
      }
      return res.json(successResponse(item, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get template item', { id: req.params.id, itemId: req.params.itemId, error: errorMessage });
      next(error);
      return;
    }
  });

  router.post('/:id/pool/items', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { id } = req.params;
      const poolService = new TemplatePoolService(db);
      const item = await poolService.createItem(id, req.body);
      return res.status(201).json(successResponse(item, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to create template item', { id: req.params.id, error: errorMessage });
      next(error);
      return;
    }
  });

  router.put('/:id/pool/items/:itemId', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { id, itemId } = req.params;
      const poolService = new TemplatePoolService(db);
      const updated = await poolService.updateItem(id, itemId, req.body);
      if (!updated) {
        return res.status(404).json(errorResponse('NOT_FOUND', 'Item not found', undefined, requestId));
      }
      return res.json(successResponse(updated, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to update template item', { id: req.params.id, itemId: req.params.itemId, error: errorMessage });
      next(error);
      return;
    }
  });

  router.delete('/:id/pool/items/:itemId', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { id, itemId } = req.params;
      const poolService = new TemplatePoolService(db);
      const removed = await poolService.removeItem(id, itemId);
      if (!removed) {
        return res.status(404).json(errorResponse('NOT_FOUND', 'Item not found', undefined, requestId));
      }
      return res.json(successResponse({ deleted: true, id: itemId }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to delete template item', { id: req.params.id, itemId: req.params.itemId, error: errorMessage });
      next(error);
      return;
    }
  });

  // ----- 统计 -----

  router.get('/:id/pool/stats', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { id } = req.params;
      const poolService = new TemplatePoolService(db);
      const stats = await poolService.getPoolStats(id);
      return res.json(successResponse(stats, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get pool stats', { id: req.params.id, error: errorMessage });
      next(error);
      return;
    }
  });

  // ----- AI 生成（异步触发 + 轮询） -----

  router.post('/:id/pool/skills/generate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      if (!coordinatorAgent) {
        res.status(503).json(errorResponse('SERVICE_UNAVAILABLE', 'Agent system not available', { detail: 'Agent 系统未初始化' }));
        return;
      }

      const { categories, recommendedClasses, batchSize, seed } = req.body as {
        categories?: string[];
        recommendedClasses?: string[];
        batchSize?: number;
        seed?: string;
      };

      const resultId = randomUUID();
      poolGenResultCache.set(resultId, { status: 'pending', type: 'skills', createdAt: Date.now() });

      res.json({ result_id: resultId });

      (async () => {
        try {
          const agentMessage: AgentMessage = {
            id: randomUUID() as ID,
            timestamp: Date.now() as Timestamp,
            from: 'template-editor' as unknown as import('../../../shared/src/types/agent.js').AgentType,
            to: 'gamemaster',
            type: 'request',
            saveId: '0' as ID,
            payload: {
              action: 'generate_pool_skills',
              data: {
                templateId: id,
                intentHint: 'generate_pool_skills',
                categories,
                recommendedClasses,
                batchSize: batchSize ?? 10,
                seed,
              },
            },
            metadata: { priority: 'normal', requiresResponse: true },
          };

          // v2 模块F D5: 请求级实例化——每个请求创建独立的 GM Agent 副本
          const scopedAgent = coordinatorAgent.createRequestScopedCopy();
          const result = await scopedAgent.processMessage(agentMessage);
          const cached = poolGenResultCache.get(resultId);
          if (cached) {
            cached.status = result.success ? 'completed' : 'failed';
            cached.data = result.success ? result.data : undefined;
            cached.error = result.success ? undefined : result.error;
          }
        } catch (err) {
          const cached = poolGenResultCache.get(resultId);
          if (cached) {
            cached.status = 'failed';
            cached.error = getErrorMessage(err);
          }
        }
      })();
    } catch (error) {
      next(error);
    }
  });

  // POST /:id/pool/items/generate — 触发 LLM 生成物品池（不写 DB）
  router.post('/:id/pool/items/generate', async (req, res, next) => {
    try {
      const id = req.params.id;
      if (!coordinatorAgent) {
        res.status(503).json(errorResponse('SERVICE_UNAVAILABLE', 'Agent system not available', { detail: 'Agent 系统未初始化' }));
        return;
      }

      const { categories, recommendedClasses, batchSize, seed } = req.body as {
        categories?: string[];
        recommendedClasses?: string[];
        batchSize?: number;
        seed?: string;
      };

      const resultId = randomUUID();
      poolGenResultCache.set(resultId, { status: 'pending', type: 'items', createdAt: Date.now() });

      res.json({ result_id: resultId });

      (async () => {
        try {
          const agentMessage: AgentMessage = {
            id: randomUUID() as ID,
            timestamp: Date.now() as Timestamp,
            from: 'template-editor' as unknown as import('../../../shared/src/types/agent.js').AgentType,
            to: 'gamemaster',
            type: 'request',
            saveId: '0' as ID,
            payload: {
              action: 'generate_pool_items',
              data: {
                templateId: id,
                intentHint: 'generate_pool_items',
                categories,
                recommendedClasses,
                batchSize: batchSize ?? 10,
                seed,
              },
            },
            metadata: { priority: 'normal', requiresResponse: true },
          };

          // v2 模块F D5: 请求级实例化——每个请求创建独立的 GM Agent 副本
          const scopedAgent = coordinatorAgent.createRequestScopedCopy();
          const result = await scopedAgent.processMessage(agentMessage);
          const cached = poolGenResultCache.get(resultId);
          if (cached) {
            cached.status = result.success ? 'completed' : 'failed';
            cached.data = result.success ? result.data : undefined;
            cached.error = result.success ? undefined : result.error;
          }
        } catch (err) {
          const cached = poolGenResultCache.get(resultId);
          if (cached) {
            cached.status = 'failed';
            cached.error = getErrorMessage(err);
          }
        }
      })();
    } catch (error) {
      next(error);
    }
  });

  // GET /:id/pool/generate-status/:resultId — 轮询生成状态
  router.get('/:id/pool/generate-status/:resultId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { resultId } = req.params;
      const cached = poolGenResultCache.get(resultId);
      if (!cached) {
        res.status(404).json(errorResponse('NOT_FOUND', 'Result not found or expired', { detail: '结果不存在或已过期' }));
        return;
      }
      if (Date.now() - cached.createdAt > POOL_RESULT_TTL) {
        poolGenResultCache.delete(resultId);
        res.status(404).json(errorResponse('EXPIRED', 'Result expired', { detail: '结果已过期' }));
        return;
      }
      res.json({
        status: cached.status,
        type: cached.type,
        ...(cached.status === 'completed' && { data: cached.data }),
        ...(cached.status === 'failed' && { error: cached.error }),
      });
      if (cached.status === 'completed' || cached.status === 'failed') {
        poolGenResultCache.delete(resultId);
      }
    } catch (error) {
      next(error);
    }
  });

  // POST /:id/pool/skills/commit — 用户审核后批量写入技能
  router.post('/:id/pool/skills/commit', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const id = req.params.id;
      const skills = req.body.skills as Array<Record<string, unknown>> | undefined;
      if (!skills || !Array.isArray(skills) || skills.length === 0) {
        res.status(400).json(errorResponse('VALIDATION_ERROR', 'skills array is required', { detail: 'skills 数组不能为空' }, requestId));
        return;
      }
      const poolService = new TemplatePoolService(db);
      const created = await poolService.createSkills(id, skills.map(s => ({ ...s, source: 'generated' } as import('../services/template-pool.js').CreateTemplateSkillParams)));
      res.json(successResponse(created, requestId));
    } catch (error) {
      next(error);
    }
  });

  // POST /:id/pool/items/commit — 用户审核后批量写入物品
  router.post('/:id/pool/items/commit', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const id = req.params.id;
      const items = req.body.items as Array<Record<string, unknown>> | undefined;
      if (!items || !Array.isArray(items) || items.length === 0) {
        res.status(400).json(errorResponse('VALIDATION_ERROR', 'items array is required', { detail: 'items 数组不能为空' }, requestId));
        return;
      }
      const poolService = new TemplatePoolService(db);
      const created = await poolService.createItems(id, items.map(s => ({ ...s, source: 'generated' } as import('../services/template-pool.js').CreateTemplateItemParams)));
      res.json(successResponse(created, requestId));
    } catch (error) {
      next(error);
    }
  });

  // DELETE /:id/pool/skills/generated — 用户手动清除所有 generated 技能
  router.delete('/:id/pool/skills/generated', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const id = req.params.id;
      const deleted = await db('template_skill_pool')
        .where({ template_id: id, source: 'generated' })
        .del();
      res.json(successResponse({ deletedCount: deleted }, requestId));
    } catch (error) {
      next(error);
    }
  });

  // DELETE /:id/pool/items/generated — 用户手动清除所有 generated 物品
  router.delete('/:id/pool/items/generated', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const id = req.params.id;
      const deleted = await db('template_item_pool')
        .where({ template_id: id, source: 'generated' })
        .del();
      res.json(successResponse({ deletedCount: deleted }, requestId));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
