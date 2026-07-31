import { Request, Response, NextFunction } from 'express';
import { ZodObject, ZodType } from 'zod';

// ==================== 基础验证中间件（保留原有功能） ====================

/**
 * 完整请求验证中间件（原有）
 * 验证 req.body, req.query, req.params
 * 
 * @param schema - Zod对象schema，应包含 body/query/params 字段
 * @returns Express中间件函数
 * 
 * @example
 * ```typescript
 * router.post('/users', validateRequest(z.object({
 *   body: userSchema,
 *   query: z.object({}).optional(),
 *   params: z.object({}).optional()
 * })), createUserHandler);
 * ```
 */
export function validateRequest(schema: ZodObject<any>) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      next(error);
    }
  };
}

// ==================== 增强的验证中间件（新增） ====================

/**
 * 只验证请求体（Body）的中间件
 * 适用于POST/PUT/PATCH等需要请求体的端点
 * 
 * @param schema - Zod类型schema，用于验证req.body
 * @returns Express中间件函数
 * 
 * @example
 * ```typescript
 * router.post('/chat', validateBody(chatSchema), chatHandler);
 * ```
 */
export function validateBody<T extends ZodType<any>>(schema: T) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      // 解析并验证body，将结果挂载到req.validatedBody供后续使用
      const result = await schema.parseAsync(req.body);
      (req as any).validatedBody = result;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * 只验证查询参数（Query）的中间件
 * 适用于GET端点的查询参数验证
 * 
 * 注意：Express的req.query中所有值都是string或string[]，
 * 如果需要数字类型，请在Schema中使用transform进行转换
 * 
 * @param schema - Zod类型schema，用于验证req.query
 * @returns Express中间件函数
 * 
 * @example
 * ```typescript
 * router.get('/decisions', validateQuery(decisionsQuerySchema), decisionsHandler);
 * ```
 */
export function validateQuery<T extends ZodType<any>>(schema: T) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      // 解析并验证query参数，将结果挂载到req.validatedQuery供后续使用
      const result = await schema.parseAsync(req.query);
      (req as any).validatedQuery = result;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * 只验证路径参数（Params）的中间件
 * 适用于包含动态路由参数的端点
 * 
 * @param schema - Zod类型schema，用于验证req.params
 * @returns Express中间件函数
 * 
 * @example
 * ```typescript
 * router.get('/users/:id', validateParams(userParamsSchema), getUserHandler);
 * ```
 */
export function validateParams<T extends ZodType<any>>(schema: T) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const result = await schema.parseAsync(req.params);
      (req as any).validatedParams = result;
      next();
    } catch (error) {
      next(error);
    }
  };
}

// ==================== Agent路由便捷函数 ====================

/**
 * 根据HTTP方法和路径自动选择Agent Schema的便捷工厂函数
 * 
 * 此函数为Agent路由系统提供统一的验证入口，
 * 自动根据method+path组合选择正确的Schema进行验证。
 * 
 * 支持的路由：
 * - POST /chat       → 验证body (chatSchema)
 * - GET /decisions   → 验证query (decisionsQuerySchema)
 * - POST /message    → 验证body (directMessageSchema)
 * 
 * @param method - HTTP方法（GET/POST/PUT/DELETE等）
 * @param path - 路由路径（如 '/chat', '/decisions'）
 * @returns Express中间件函数，如果未找到对应Schema则返回pass-through中间件
 * 
 * @example
 * ```typescript
 * import { agentSchemas } from '../schemas/agent.schema.js';
 * 
 * router.post('/chat', validateAgentRoute('POST', '/chat'), chatHandler);
 * router.get('/decisions', validateAgentRoute('GET', '/decisions'), decisionsHandler);
 * router.post('/message', validateAgentRoute('POST', '/message'), messageHandler);
 * 
 * // 不需要验证的端点也可以使用（会跳过验证）
 * router.get('/status', validateAgentRoute('GET', '/status'), statusHandler);
 * router.get('/tools', validateAgentRoute('GET', '/tools'), toolsHandler);
 * router.get('/agents', validateAgentRoute('GET', '/agents'), agentsHandler);
 * ```
 */
export function validateAgentRoute(
  method: string,
  path: string
): (req: Request, res: Response, next: NextFunction) => void {
  
  // 规范化输入
  const normalizedMethod = method.toUpperCase();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  
  // 路由到Schema映射表
  switch (`${normalizedMethod} ${normalizedPath}`) {
    case 'POST /chat':
      // 动态导入避免循环依赖，实际使用时可直接import
      return async (req: Request, _res: Response, next: NextFunction) => {
        try {
          // 动态导入chatSchema
          const { chatSchema } = await import('../schemas/agent.schema.js');
          const result = await chatSchema.parseAsync(req.body);
          (req as any).validatedBody = result;
          next();
        } catch (error) {
          next(error);
        }
      };
    
    case 'GET /decisions':
      return async (req: Request, _res: Response, next: NextFunction) => {
        try {
          const { decisionsQuerySchema } = await import('../schemas/agent.schema.js');
          const result = await decisionsQuerySchema.parseAsync(req.query);
          (req as any).validatedQuery = result;
          next();
        } catch (error) {
          next(error);
        }
      };
    
    case 'POST /message':
      return async (req: Request, _res: Response, next: NextFunction) => {
        try {
          const { directMessageSchema } = await import('../schemas/agent.schema.js');
          const result = await directMessageSchema.parseAsync(req.body);
          (req as any).validatedBody = result;
          next();
        } catch (error) {
          next(error);
        }
      };
    
    default:
      // 未匹配到Schema的端点，直接放行（不验证）
      return (_req: Request, _res: Response, next: NextFunction) => {
        next();
      };
  }
}
