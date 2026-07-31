import { Router, Request, Response, NextFunction } from 'express';
import { ModelConfigService, PROVIDER_PRESETS, getOAuthProvider } from '@ai-rpg/ai';
import { successResponse, errorResponse } from '../utils/response.js';
import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { ProviderType } from '@ai-rpg/shared';

const logger = createChildLogger('routes:model-config');

const VALID_PROVIDER_TYPES: ProviderType[] = [
  'openai', 'gemini', 'deepseek', 'glm', 'kimi',
  'anthropic', 'qwen', 'ernie', 'spark', 'siliconflow', 'custom',
  'github-copilot',
];

function validateProviderData(data: Record<string, unknown>, requestId: string | undefined): { valid: boolean; error?: ReturnType<typeof errorResponse> } {
  const providerType = data.providerType || data.provider_type;
  if (!providerType || !VALID_PROVIDER_TYPES.includes(providerType as ProviderType)) {
    return { valid: false, error: errorResponse('VALIDATION_ERROR', `provider_type must be one of: ${VALID_PROVIDER_TYPES.join(', ')}`, undefined, requestId) };
  }
  const baseUrl = data.baseUrl || data.base_url;
  if (!baseUrl || typeof baseUrl !== 'string') {
    return { valid: false, error: errorResponse('VALIDATION_ERROR', 'base_url is required and must be a string', undefined, requestId) };
  }
  // M2-B3 D8：OAuth 托管型放宽 apiKeys 非空约束（真实 key 由 OAuth 登录产出，
  // createProvider 自动写占位 entry）；其余类型校验不变
  if (!getOAuthProvider(providerType as string)) {
    const apiKeys = data.apiKeys || data.api_keys;
    if (!Array.isArray(apiKeys) || apiKeys.length === 0) {
      return { valid: false, error: errorResponse('VALIDATION_ERROR', 'api_keys must be a non-empty array', undefined, requestId) };
    }
  }
  const defaultModel = data.defaultModel || data.default_model;
  if (!defaultModel || typeof defaultModel !== 'string') {
    return { valid: false, error: errorResponse('VALIDATION_ERROR', 'default_model is required and must be a string', undefined, requestId) };
  }
  return { valid: true };
}

export function createModelConfigRouter(modelConfigService: ModelConfigService): Router {
  const router = Router();
  const service = modelConfigService;

  router.get('/providers', async (_req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const providers = await service.listProviders();
      return res.json(successResponse(providers, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to list providers', { error: errorMessage });
      next(error);
      return;
    }
  });

  router.get('/providers/:id', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const provider = await service.getProvider(req.params.id);
      return res.json(successResponse(provider, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get provider', { id: req.params.id, error: errorMessage });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('PROVIDER_NOT_FOUND', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.post('/providers', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const validation = validateProviderData(req.body, requestId);
      if (!validation.valid) {
        return res.status(400).json(validation.error);
      }
      const provider = await service.createProvider(req.body);
      return res.status(201).json(successResponse(provider, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to create provider', { error: errorMessage });
      if (errorMessage.includes('validation') || errorMessage.includes('required') || errorMessage.includes('invalid')) {
        return res.status(400).json(errorResponse('VALIDATION_ERROR', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.put('/providers/:id', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const hasProviderType = (req.body.providerType || req.body.provider_type);
      if (hasProviderType) {
        const validation = validateProviderData(req.body, requestId);
        if (!validation.valid) {
          return res.status(400).json(validation.error);
        }
      } else {
        const baseUrl = req.body.baseUrl || req.body.base_url;
        if (baseUrl !== undefined && typeof baseUrl !== 'string') {
          return res.status(400).json(errorResponse('VALIDATION_ERROR', 'base_url must be a string', undefined, requestId));
        }
        const apiKeys = req.body.apiKeys || req.body.api_keys;
        if (apiKeys !== undefined && (!Array.isArray(apiKeys) || apiKeys.length === 0)) {
          return res.status(400).json(errorResponse('VALIDATION_ERROR', 'api_keys must be a non-empty array', undefined, requestId));
        }
        const defaultModel = req.body.defaultModel || req.body.default_model;
        if (defaultModel !== undefined && typeof defaultModel !== 'string') {
          return res.status(400).json(errorResponse('VALIDATION_ERROR', 'default_model must be a string', undefined, requestId));
        }
      }
      const provider = await service.updateProvider(req.params.id, req.body);
      return res.json(successResponse(provider, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to update provider', { id: req.params.id, error: errorMessage });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('PROVIDER_NOT_FOUND', errorMessage, undefined, requestId));
      }
      if (errorMessage.includes('validation') || errorMessage.includes('required') || errorMessage.includes('invalid')) {
        return res.status(400).json(errorResponse('VALIDATION_ERROR', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.delete('/providers/:id', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      await service.deleteProvider(req.params.id);
      return res.json(successResponse({ deleted: req.params.id }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to delete provider', { id: req.params.id, error: errorMessage });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('PROVIDER_NOT_FOUND', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.post('/providers/:id/test', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const result = await service.testConnection(req.params.id, req.body);
      return res.json(successResponse(result, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to test provider connection', { id: req.params.id, error: errorMessage });
      if (errorMessage.includes('not found')) {
        return res.status(404).json(errorResponse('PROVIDER_NOT_FOUND', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.post('/test-connection', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const result = await service.testConnectionWithConfig(req.body);
      return res.json(successResponse(result, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to test connection with config', { error: errorMessage });
      if (errorMessage.includes('validation') || errorMessage.includes('required')) {
        return res.status(400).json(errorResponse('VALIDATION_ERROR', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  router.get('/presets', (_req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      return res.json(successResponse(PROVIDER_PRESETS, requestId));
    } catch (error) {
      next(error);
      return;
    }
  });

  router.get('/defaults', async (_req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const defaults = await service.getDefaults();
      return res.json(successResponse(defaults, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get defaults', { error: errorMessage });
      next(error);
      return;
    }
  });

  router.put('/defaults', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const defaults = await service.setDefaults(req.body);
      return res.json(successResponse(defaults, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to set defaults', { error: errorMessage });
      if (errorMessage.includes('validation') || errorMessage.includes('required') || errorMessage.includes('invalid')) {
        return res.status(400).json(errorResponse('VALIDATION_ERROR', errorMessage, undefined, requestId));
      }
      next(error);
      return;
    }
  });

  logger.info('Model config routes initialized');

  return router;
}
