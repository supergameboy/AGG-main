/**
 * WS System 模块处理器
 *
 * 处理 ping、status 等 system 相关的 WS 请求。
 */

import type { WebSocket } from 'ws';
import type { WSGameRequest } from '@ai-rpg/shared';
import type { GameHandlerContext } from './ws-request-handler.js';
import { sendResult, sendError } from './ws-request-handler.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';

export async function handleSystemModule(request: WSGameRequest, ws: WebSocket, ctx: GameHandlerContext): Promise<void> {
  const { action, requestId } = request;
  const { webSocketService } = ctx;

  try {
    let result: unknown;
    switch (action) {
      case 'ping': {
        result = { pong: true, timestamp: Date.now() };
        break;
      }
      case 'status': {
        result = {
          status: 'ok',
          uptime: process.uptime(),
          timestamp: Date.now(),
          connections: webSocketService.getConnectedCount(),
        };
        break;
      }
      default:
        sendError(webSocketService, ws, requestId, 'UNKNOWN_ACTION', `Unknown system action: ${action}`, false, 'system');
        return;
    }

    sendResult(webSocketService, ws, requestId, 'system', result, request.intentHint);
  } catch (error) {
    sendError(webSocketService, ws, requestId, 'SYSTEM_ERROR', getErrorMessage(error), false, 'system');
  }
}
