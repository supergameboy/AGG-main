/**
 * OAuth 路由（M2-B3 D6）：登录发起 / 状态查询 / 注销 / Provider 列表
 *
 * 为什么采用"异步轮询 + 状态查询"而非 HTTP 长挂起：
 * device_code 流程的用户授权耗时不可控（秒~分钟级），HTTP 请求挂起会占用连接且
 * 前端无法恢复展示。改为 POST login 立即 202 返回设备码，后台轮询 GitHub；
 * 前端以 GET status（2s 轮询）观察状态机迁移。
 *
 * 会话 Map 存于路由闭包（单进程内存语义）：进程重启 pending 会话丢失（重新发起即可，
 * 幂等）；凭证本体在 oauth_credentials 表，不受重启影响。
 * success/failed 状态幂等保留至 logout / 新 login。
 *
 * 设计文档: docs/design/solution-design-20260726-pi-reference-upgrade/solution-design-20260731-m2b3-github-copilot-oauth.md
 */

import { Router, Request, Response, NextFunction } from 'express';
import {
  OAuthCredentialService,
  getOAuthProvider,
  listOAuthProviders,
  LOGIN_CANCELLED_MESSAGE,
} from '@ai-rpg/ai';
import { successResponse, errorResponse } from '../utils/response.js';
import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';

const logger = createChildLogger('routes:oauth');

/** 登录会话状态机：idle → pending → success/failed；logout/新 login 重置 */
type OAuthLoginStatus = 'idle' | 'pending' | 'success' | 'failed';

interface OAuthSessionState {
  status: OAuthLoginStatus;
  /** failed 时的错误信息（status 响应附带给前端展示） */
  error?: string;
  /** pending 时附带设备码（前端刷新后恢复展示用） */
  login?: { userCode: string; verificationUri: string };
  /** 后台轮询的中止句柄（logout / 重复 login 时触发） */
  abortController?: AbortController;
}

export function createOAuthRouter(oauthCredentialService: OAuthCredentialService): Router {
  const router = Router();
  const sessions = new Map<string, OAuthSessionState>();

  function getState(providerId: string): OAuthSessionState {
    return sessions.get(providerId) ?? { status: 'idle' };
  }

  function abortPending(providerId: string): void {
    const state = sessions.get(providerId);
    if (state?.status === 'pending') {
      state.abortController?.abort();
    }
  }

  router.post('/:providerId/login', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    const { providerId } = req.params;
    try {
      if (!getOAuthProvider(providerId)) {
        return res.status(404).json(errorResponse(
          'OAUTH_PROVIDER_NOT_FOUND',
          `OAuth provider '${providerId}' is not registered`,
          undefined,
          requestId,
        ));
      }

      // pending 中重复调用：中止旧轮询后重启（旧轮询 catch 见所有权校验，不会覆盖新状态）
      abortPending(providerId);

      const session = await oauthCredentialService.beginLogin(providerId);
      if (session.flow !== 'device_code') {
        return res.status(501).json(errorResponse(
          'OAUTH_FLOW_UNSUPPORTED',
          `OAuth provider '${providerId}' 使用 auth_url 流程，本端点暂未开放（契约预留）`,
          undefined,
          requestId,
        ));
      }

      const abortController = new AbortController();
      sessions.set(providerId, {
        status: 'pending',
        login: {
          userCode: session.info.userCode,
          verificationUri: session.info.verificationUri,
        },
        abortController,
      });

      // 后台轮询（fire-and-forget）：HTTP 请求立即返回，状态经 GET status 观察
      void oauthCredentialService
        .completeDeviceLogin(providerId, session, abortController.signal)
        .then(() => {
          // 所有权校验：会话已被 logout/新 login 取代时不覆盖
          if (sessions.get(providerId)?.abortController !== abortController) return;
          sessions.set(providerId, { status: 'success' });
          logger.info('OAuth login completed', { providerId });
        })
        .catch((error: unknown) => {
          const message = getErrorMessage(error);
          if (message === LOGIN_CANCELLED_MESSAGE) {
            // 取消语义：状态由发起方（logout 置 idle / 新 login 置 pending）负责
            logger.info('OAuth login polling cancelled', { providerId });
            return;
          }
          if (sessions.get(providerId)?.abortController !== abortController) return;
          sessions.set(providerId, { status: 'failed', error: message });
          logger.warn('OAuth login failed', { providerId, error: message });
        });

      return res.status(202).json(successResponse({
        userCode: session.info.userCode,
        verificationUri: session.info.verificationUri,
        intervalSeconds: session.info.intervalSeconds,
        expiresInSeconds: session.info.expiresInSeconds,
      }, requestId));
    } catch (error) {
      logger.error('Failed to begin OAuth login', { providerId, error: getErrorMessage(error) });
      next(error);
      return;
    }
  });

  router.get('/:providerId/status', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    const { providerId } = req.params;
    try {
      if (!getOAuthProvider(providerId)) {
        return res.status(404).json(errorResponse(
          'OAUTH_PROVIDER_NOT_FOUND',
          `OAuth provider '${providerId}' is not registered`,
          undefined,
          requestId,
        ));
      }

      const state = getState(providerId);
      const hasCredentials = await oauthCredentialService.hasCredentials(providerId);
      return res.json(successResponse({
        status: state.status,
        hasCredentials,
        ...(state.error !== undefined ? { error: state.error } : {}),
        ...(state.login !== undefined ? { login: state.login } : {}),
      }, requestId));
    } catch (error) {
      logger.error('Failed to get OAuth status', { providerId, error: getErrorMessage(error) });
      next(error);
      return;
    }
  });

  router.post('/:providerId/logout', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    const { providerId } = req.params;
    try {
      if (!getOAuthProvider(providerId)) {
        return res.status(404).json(errorResponse(
          'OAUTH_PROVIDER_NOT_FOUND',
          `OAuth provider '${providerId}' is not registered`,
          undefined,
          requestId,
        ));
      }

      abortPending(providerId);
      await oauthCredentialService.logout(providerId);
      sessions.delete(providerId);
      logger.info('OAuth logged out', { providerId });
      return res.json(successResponse({ loggedOut: true }, requestId));
    } catch (error) {
      logger.error('Failed to logout OAuth', { providerId, error: getErrorMessage(error) });
      next(error);
      return;
    }
  });

  router.get('/providers', async (_req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const providers = await Promise.all(
        listOAuthProviders().map(async (provider) => ({
          id: provider.id,
          name: provider.name,
          hasCredentials: await oauthCredentialService.hasCredentials(provider.id),
          status: getState(provider.id).status,
        })),
      );
      return res.json(successResponse(providers, requestId));
    } catch (error) {
      logger.error('Failed to list OAuth providers', { error: getErrorMessage(error) });
      next(error);
      return;
    }
  });

  logger.info('OAuth routes initialized');

  return router;
}
