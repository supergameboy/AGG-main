/**
 * WS Save 模块处理器
 *
 * 处理存档 CRUD、快照、故事历史等 save 相关的 WS 请求。
 */

import type { WebSocket } from 'ws';
import type { WSGameRequest, SaveRestrictionType } from '@ai-rpg/shared';
import type { GameHandlerContext } from './ws-request-handler.js';
import { StoryService } from '../game-systems/story/StoryService.js';
import { StoryEventRepository } from '../game-systems/story/StoryEventRepository.js';
import { AgentContextRepository } from '../game-systems/story/AgentContextRepository.js';
import { SaveRepository } from '../game-systems/save/index.js';
import { KnexTransactionManager } from '../database/TransactionManager.js';
import { sendResult, sendError, requireSaveId } from './ws-request-handler.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';

export async function handleSaveModule(request: WSGameRequest, ws: WebSocket, ctx: GameHandlerContext): Promise<void> {
  const { action, requestId, payload } = request;
  const { webSocketService } = ctx;
  const saveService = ctx.saveService;

  try {
    let result: unknown;
    switch (action) {
      case 'list': {
        const options: Record<string, unknown> = {};
        if (payload.templateId) options.templateId = payload.templateId;
        if (payload.gameMode) options.gameMode = payload.gameMode;
        if (payload.type) options.type = payload.type;
        if (payload.limit) options.limit = payload.limit;
        if (payload.offset) options.offset = payload.offset;
        result = await saveService.listSaves(options as Parameters<typeof saveService.listSaves>[0]);
        break;
      }
      case 'get':
      case 'load': {
        if (!requireSaveId(webSocketService, ws, requestId, payload)) return;
        const saveId = payload.saveId;
        result = await saveService.loadSave(saveId);
        break;
      }
      case 'save': {
        if (!requireSaveId(webSocketService, ws, requestId, payload)) return;
        await saveService.saveSave(payload.saveId);
        result = { saved: true };
        break;
      }
      case 'delete': {
        if (!requireSaveId(webSocketService, ws, requestId, payload)) return;
        await saveService.deleteSave(payload.saveId);
        result = { deleted: true };
        break;
      }
      case 'export': {
        if (!requireSaveId(webSocketService, ws, requestId, payload)) return;
        result = await saveService.exportSave(payload.saveId);
        break;
      }
      case 'import': {
        const importData = payload.data;
        if (!importData) {
          sendError(webSocketService, ws, requestId, 'IMPORT_DATA_REQUIRED', 'data is required', true, 'save');
          return;
        }
        result = await saveService.importSave(importData);
        break;
      }
      case 'snapshot:list': {
        if (!requireSaveId(webSocketService, ws, requestId, payload)) return;
        result = await saveService.getSnapshots(payload.saveId);
        break;
      }
      case 'snapshot:create': {
        if (!requireSaveId(webSocketService, ws, requestId, payload)) return;
        result = await saveService.createSnapshot(payload.saveId, payload.snapshotType as 'manual' | 'auto' | 'checkpoint' | undefined, payload.chapterName as string | undefined);
        break;
      }
      case 'snapshot:restore': {
        const snapId = payload.snapshotId as string;
        if (!snapId) {
          sendError(webSocketService, ws, requestId, 'SNAPSHOT_ID_REQUIRED', 'snapshotId is required', true, 'save');
          return;
        }
        result = await saveService.restoreSnapshot(snapId);
        break;
      }
      case 'snapshot:delete': {
        const sId = payload.saveId as string;
        const snapId = payload.snapshotId as string;
        if (!sId || !snapId) {
          sendError(webSocketService, ws, requestId, 'PARAMS_REQUIRED', 'saveId and snapshotId are required', true, 'save');
          return;
        }
        result = await saveService.deleteSnapshot(sId, snapId);
        break;
      }
      case 'story-history': {
        if (!requireSaveId(webSocketService, ws, requestId, payload)) return;
        const storyEventRepo = new StoryEventRepository(ctx.db);
        const agentContextRepo = new AgentContextRepository(ctx.db);
        const saveRepo = new SaveRepository(ctx.db);
        const txManager = new KnexTransactionManager(ctx.db);
        const storyService = new StoryService(storyEventRepo, agentContextRepo, saveRepo, txManager);
        const page = typeof payload.page === 'number' ? payload.page : undefined;
        const pageSize = typeof payload.pageSize === 'number' ? payload.pageSize : undefined;
        result = await storyService.getHistory(payload.saveId, { page, pageSize });
        break;
      }
      case 'create': {
        const name = payload.name as string;
        if (!name) {
          sendError(webSocketService, ws, requestId, 'NAME_REQUIRED', 'name is required', true, 'save');
          return;
        }
        result = await saveService.createSave(name, payload.templateId as string | undefined, payload.gameMode as string | undefined, payload.type as SaveRestrictionType | undefined);
        break;
      }
      case 'update': {
        if (!requireSaveId(webSocketService, ws, requestId, payload)) return;
        const { saveId: _sid, ...updates } = payload;
        result = await saveService.updateSave(payload.saveId, updates as Parameters<typeof saveService.updateSave>[1]);
        break;
      }
      case 'copy': {
        if (!requireSaveId(webSocketService, ws, requestId, payload)) return;
        result = await saveService.copySave(payload.saveId, payload.name as string | undefined);
        break;
      }
      case 'autoSave': {
        if (!requireSaveId(webSocketService, ws, requestId, payload)) return;
        result = await saveService.autoSave(payload.saveId);
        break;
      }
      case 'translate': {
        const trId = payload.saveId as string;
        const targetLanguage = payload.targetLanguage as string;
        if (!trId || !targetLanguage) {
          sendError(webSocketService, ws, requestId, 'PARAMS_REQUIRED', 'saveId and targetLanguage are required', true, 'save');
          return;
        }
        await saveService.updateSaveLanguage(trId, targetLanguage);
        result = { success: true, saveId: trId, targetLanguage };
        break;
      }
      default:
        sendError(webSocketService, ws, requestId, 'UNKNOWN_ACTION', `Unknown save action: ${action}`, false, 'save');
        return;
    }

    sendResult(webSocketService, ws, requestId, 'save', result, request.intentHint);
  } catch (error) {
    sendError(webSocketService, ws, requestId, 'SAVE_ERROR', getErrorMessage(error), false, 'save');
  }
}
