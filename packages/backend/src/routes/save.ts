import { Router, Request, Response, NextFunction } from 'express';
import type { SaveQueryOptions, SaveUpdateData } from '../game-systems/save/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { Knex } from 'knex';
import { SNAPSHOT_TYPE } from '../../../shared/src/types/api.js';
import type { SnapshotType } from '../../../shared/src/types/api.js';
import type { SaveRestrictionType } from '../../../shared/src/types/template.js';
import type { AgentRuntime } from '../agents/AgentRuntime.js';
import { StoryService } from '../game-systems/story/StoryService.js';
import { StoryEventRepository } from '../game-systems/story/StoryEventRepository.js';
import { AgentContextRepository } from '../game-systems/story/AgentContextRepository.js';
import { SaveRepository, SaveSnapshotRepository, SaveGameTimeRepository, SaveStateRepository, SaveDataPort, SaveService } from '../game-systems/save/index.js';
import { KnexTransactionManager } from '../database/TransactionManager.js';

const logger = createChildLogger('routes:save');

export function createSaveRoutes(db: Knex, coordinatorAgent?: AgentRuntime): Router {
  const router = Router();

  // 组合根：创建 SaveService 实例（4 Repository + SaveDataPort + txManager）
  const saveRepo = new SaveRepository(db);
  const snapshotRepo = new SaveSnapshotRepository(db);
  const stateRepo = new SaveStateRepository(db);
  const gameTimeRepo = new SaveGameTimeRepository(db);
  const saveDataPort = new SaveDataPort(db);
  const txManager = new KnexTransactionManager(db);
  const saveService = new SaveService(saveRepo, snapshotRepo, stateRepo, gameTimeRepo, saveDataPort, txManager);

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const options: SaveQueryOptions = {};
      if (req.query.template_id) options.templateId = req.query.template_id as string;
      if (req.query.game_mode) options.gameMode = req.query.game_mode as string;
      if (req.query.type) options.type = req.query.type as string;
      if (req.query.nameContains) options.nameContains = req.query.nameContains as string;
      if (req.query.limit) options.limit = parseInt(req.query.limit as string, 10);
      if (req.query.offset) options.offset = parseInt(req.query.offset as string, 10);
      const result = await saveService.listSaves(options);
      return res.json(successResponse({ saves: result.saves, total: result.total }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to list saves', { error: errorMessage });
      next(error);
      return;
    }
  });

  router.get('/:saveId', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { saveId } = req.params;
      const save = await saveService.loadSave(saveId);
      return res.json(successResponse(save, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to load save', { saveId: req.params.saveId, error: errorMessage });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('SAVE_NOT_FOUND', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.get('/:saveId/story/history', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { saveId } = req.params;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : undefined;
      const storyEventRepo = new StoryEventRepository(db);
      const agentContextRepo = new AgentContextRepository(db);
      const saveRepo = new SaveRepository(db);
      const txManager = new KnexTransactionManager(db);
      const storyService = new StoryService(storyEventRepo, agentContextRepo, saveRepo, txManager);
      const history = await storyService.getHistory(saveId, { page, pageSize });
      return res.json(successResponse(history, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get story history', {
        saveId: req.params.saveId,
        error: errorMessage,
      });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('SAVE_NOT_FOUND', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { name, template_id, game_mode } = req.body;
      if (!name || typeof name !== 'string') {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'name is required and must be a string', undefined, requestId));
      }

      if (template_id) {
        const existingSave = await db('saves').where({ template_id: template_id }).first();
        if (existingSave) {
          const restriction = await saveService.checkSaveRestriction(existingSave.id, 'create');
          if (!restriction.allowed) {
            return res.status(403).json(errorResponse('SAVE_RESTRICTED', restriction.reason || 'Save creation is restricted by template rules', undefined, requestId));
          }
        }
      }

      const save = await saveService.createSave(name, template_id, game_mode, req.body.type as SaveRestrictionType | undefined);
      return res.status(201).json(successResponse(save, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to create save', { error: errorMessage });
      next(error);
      return;
    }
  });

  router.put('/:saveId', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { saveId } = req.params;

      const restriction = await saveService.checkSaveRestriction(saveId, 'update');
      if (!restriction.allowed) {
        return res.status(403).json(errorResponse('SAVE_RESTRICTED', restriction.reason || 'Save update is restricted by template rules', undefined, requestId));
      }

      await saveService.saveSave(saveId);
      return res.json(successResponse({ saved: true, saveId }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to save save', { saveId: req.params.saveId, error: errorMessage });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('SAVE_NOT_FOUND', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.patch('/:saveId', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { saveId } = req.params;
      const updates: SaveUpdateData = req.body;
      if (!updates || Object.keys(updates).length === 0) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'At least one field must be provided for update', undefined, requestId));
      }
      const updated = await saveService.updateSave(saveId, updates);
      return res.json(successResponse(updated, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to update save', { saveId: req.params.saveId, error: errorMessage });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('SAVE_NOT_FOUND', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.delete('/:saveId', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { saveId } = req.params;
      const saveExists = await db('saves').where({ id: saveId }).first();
      if (!saveExists) {
        return res.status(404).json(errorResponse('SAVE_NOT_FOUND', `Save not found: ${saveId}`, undefined, requestId));
      }
      await saveService.deleteSave(saveId);
      return res.json(successResponse({ deleted: true, saveId }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to delete save', { saveId: req.params.saveId, error: errorMessage });
      next(error);
      return;
    }
  });

  router.post('/:saveId/copy', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { saveId } = req.params;
      const { name } = req.body;
      const copiedSave = await saveService.copySave(saveId, name);
      return res.status(201).json(successResponse(copiedSave, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to copy save', { saveId: req.params.saveId, error: errorMessage });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('SAVE_NOT_FOUND', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.post('/:saveId/auto', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { saveId } = req.params;

      const restriction = await saveService.checkSaveRestriction(saveId, 'auto');
      if (!restriction.allowed) {
        return res.status(403).json(errorResponse('SAVE_RESTRICTED', restriction.reason || 'Auto-save is restricted by template rules', undefined, requestId));
      }

      const result = await saveService.autoSave(saveId);
      return res.json(successResponse({ autoSaved: result.saved, saveId, reason: result.reason }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to auto save', { saveId: req.params.saveId, error: errorMessage });
      next(error);
      return;
    }
  });

  router.post('/:saveId/export', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { saveId } = req.params;
      const exportData = await saveService.exportSave(saveId);
      return res.json(successResponse(exportData, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to export save', { saveId: req.params.saveId, error: errorMessage });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('SAVE_NOT_FOUND', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.post('/import', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { data } = req.body;
      if (!data) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'data is required', undefined, requestId));
      }
      const saveId = await saveService.importSave(data);
      return res.status(201).json(successResponse({ imported: true, saveId }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to import save', { error: errorMessage });
      if (errorMessage.includes('Invalid import data')) {
        return res.status(400).json(errorResponse('INVALID_IMPORT_DATA', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.post('/:saveId/snapshots', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { saveId } = req.params;
      const { chapterName, snapshotType } = req.body;
      const snapshot = await saveService.createSnapshot(saveId, snapshotType as SnapshotType || SNAPSHOT_TYPE.MANUAL, chapterName);
      return res.status(201).json(successResponse(snapshot, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to create snapshot', { saveId: req.params.saveId, error: errorMessage });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('SAVE_NOT_FOUND', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.get('/:saveId/snapshots', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { saveId } = req.params;
      const options: { type?: SnapshotType } = {};
      if (req.query.type) options.type = req.query.type as SnapshotType;
      const snapshots = await saveService.getSnapshots(saveId, options);
      return res.json(successResponse(snapshots, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get snapshots', { saveId: req.params.saveId, error: errorMessage });
      next(error);
      return;
    }
  });

  router.get('/:saveId/snapshots/:snapshotId', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { snapshotId } = req.params;
      const snapshot = await saveService.loadSnapshot(snapshotId);
      return res.json(successResponse(snapshot, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to load snapshot', { snapshotId: req.params.snapshotId, error: errorMessage });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('SNAPSHOT_NOT_FOUND', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.post('/:saveId/snapshots/:snapshotId/restore', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { snapshotId } = req.params;
      const restoredSave = await saveService.restoreSnapshot(snapshotId);
      return res.json(successResponse(restoredSave, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to restore snapshot', { snapshotId: req.params.snapshotId, error: errorMessage });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('NOT_FOUND', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.delete('/:saveId/snapshots/:snapshotId', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { saveId, snapshotId } = req.params;
      const result = await saveService.deleteSnapshot(saveId, snapshotId);
      return res.json(successResponse(result, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to delete snapshot', { saveId: req.params.saveId, snapshotId: req.params.snapshotId, error: errorMessage });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('SNAPSHOT_NOT_FOUND', errorMessage, undefined, requestId));
      }
      if (errorMessage.includes('ironman')) {
        return res.status(403).json(errorResponse('SAVE_RESTRICTED', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.post('/:saveId/translate', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { saveId } = req.params;
      const { targetLanguage } = req.body;

      if (!targetLanguage || typeof targetLanguage !== 'string') {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'targetLanguage is required and must be a string', undefined, requestId));
      }

      if (!coordinatorAgent) {
        return res.status(503).json(errorResponse('SERVICE_UNAVAILABLE', 'GameMasterAgent is not available', undefined, requestId));
      }

      const save = await db('saves').where({ id: saveId }).first();
      if (!save) {
        return res.status(404).json(errorResponse('SAVE_NOT_FOUND', `Save not found: ${saveId}`, undefined, requestId));
      }

      const sourceLanguage = save.language || 'zh-CN';
      if (sourceLanguage === targetLanguage) {
        return res.json(successResponse({ success: true, saveId }, requestId));
      }

      const result = await coordinatorAgent.handleLanguageTranslation(saveId, sourceLanguage, targetLanguage);

      if (!result.success) {
        return res.status(500).json(errorResponse('TRANSLATION_FAILED', result.error || 'Translation failed', undefined, requestId));
      }

      return res.json(successResponse({ success: true, saveId, sourceLanguage, targetLanguage }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to translate save', { saveId: req.params.saveId, error: errorMessage });
      next(error);
      return;
    }
  });

  logger.info('Save routes initialized');

  return router;
}
