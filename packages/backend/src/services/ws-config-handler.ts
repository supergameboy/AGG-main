/**
 * WS Config 模块处理器
 *
 * 处理配置 profile 的 CRUD、重载等 config 相关的 WS 请求。
 */

import type { WebSocket } from 'ws';
import type { WSGameRequest } from '@ai-rpg/shared';
import type { GameHandlerContext } from './ws-request-handler.js';
import { sendResult, sendError } from './ws-request-handler.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';

export async function handleConfigModule(request: WSGameRequest, ws: WebSocket, ctx: GameHandlerContext): Promise<void> {
  const { action, requestId, payload } = request;
  const { configLoader, webSocketService } = ctx;

  try {
    let result: unknown;
    switch (action) {
      case 'list': {
        let profiles = await configLoader.getAllProfilesFromDB().catch(() => []);
        if (!Array.isArray(profiles) || profiles.length === 0) {
          profiles = configLoader.getAllProfiles();
        }
        result = { profiles };
        break;
      }
      case 'get': {
        const name = payload.name as string;
        if (!name) {
          sendError(webSocketService, ws, requestId, 'NAME_REQUIRED', 'name is required', true, 'config');
          return;
        }
        const profile = await configLoader.getProfileWithDBFallback(name);
        if (!profile) {
          sendError(webSocketService, ws, requestId, 'PROFILE_NOT_FOUND', `Profile not found: ${name}`, false, 'config');
          return;
        }
        result = profile;
        break;
      }
      case 'create': {
        const profile = payload as Record<string, unknown>;
        if (!profile.name || !profile.game_mode || !profile.agents) {
          sendError(webSocketService, ws, requestId, 'VALIDATION_ERROR', 'name, game_mode, and agents are required', true, 'config');
          return;
        }
        result = await configLoader.createProfile(profile as never);
        break;
      }
      case 'update': {
        const name = payload.name as string;
        if (!name) {
          sendError(webSocketService, ws, requestId, 'NAME_REQUIRED', 'name is required', true, 'config');
          return;
        }
        const { name: _n, ...updates } = payload;
        result = await configLoader.updateProfile(name, updates as never);
        break;
      }
      case 'delete': {
        const delName = payload.name as string;
        if (!delName) {
          sendError(webSocketService, ws, requestId, 'NAME_REQUIRED', 'name is required', true, 'config');
          return;
        }
        await configLoader.deleteProfile(delName);
        result = { deleted: delName };
        break;
      }
      case 'reload': {
        const reloadedProfiles = await configLoader.reloadAll();
        result = { reloaded: true, profileCount: reloadedProfiles.length, timestamp: Date.now() };
        break;
      }
      default:
        sendError(webSocketService, ws, requestId, 'UNKNOWN_ACTION', `Unknown config action: ${action}`, false, 'config');
        return;
    }

    sendResult(webSocketService, ws, requestId, 'config', result, request.intentHint);
  } catch (error) {
    sendError(webSocketService, ws, requestId, 'CONFIG_ERROR', getErrorMessage(error), false, 'config');
  }
}
