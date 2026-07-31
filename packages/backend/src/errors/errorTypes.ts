import { ZodError } from 'zod';
import { AppError, ErrorDetails } from './AppError.js';
import { ErrorCode } from './errorCodes.js';

// ==================== 通用错误类型 ====================

/**
 * 验证错误 (400)
 * 用于参数验证失败等场景
 */
export class ValidationError extends AppError {
  constructor(message?: string, details?: ErrorDetails) {
    super(ErrorCode.VALIDATION_ERROR, message, details);
  }

  /**
   * 从 Zod 验证错误创建
   */
  static fromZodError(zodError: ZodError): ValidationError {
    const errors = zodError.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    }));
    return new ValidationError('参数验证失败', { errors });
  }
}

/**
 * 错误请求错误 (400)
 * 用于请求格式错误、参数缺失等场景
 */
export class BadRequestError extends AppError {
  constructor(message?: string, details?: ErrorDetails) {
    super(ErrorCode.BAD_REQUEST, message, details);
  }
}

/**
 * 未授权错误 (401)
 * 用于未登录、Token 无效等场景
 */
export class UnauthorizedError extends AppError {
  constructor(message?: string, details?: ErrorDetails) {
    super(ErrorCode.UNAUTHORIZED, message, details);
  }
}

/**
 * 禁止访问错误 (403)
 * 用于权限不足、资源不可访问等场景
 */
export class ForbiddenError extends AppError {
  constructor(message?: string, details?: ErrorDetails) {
    super(ErrorCode.FORBIDDEN, message, details);
  }
}

/**
 * 资源未找到错误 (404)
 * 用于资源不存在等场景
 */
export class NotFoundError extends AppError {
  constructor(message?: string, details?: ErrorDetails) {
    super(ErrorCode.NOT_FOUND, message, details);
  }

  /**
   * 创建资源未找到错误
   */
  static forResource(resourceType: string, identifier: string | number): NotFoundError {
    return new NotFoundError(`${resourceType}不存在`, { resourceType, identifier });
  }
}

/**
 * 资源冲突错误 (409)
 * 用于资源已存在、版本冲突等场景
 */
export class ConflictError extends AppError {
  constructor(message?: string, details?: ErrorDetails) {
    super(ErrorCode.CONFLICT, message, details);
  }
}

/**
 * 内部服务器错误 (500)
 * 用于未预期的服务器错误
 */
export class InternalServerError extends AppError {
  constructor(message?: string, details?: ErrorDetails) {
    super(ErrorCode.INTERNAL_ERROR, message, details, false);
  }
}

/**
 * 服务不可用错误 (503)
 * 用于服务维护、过载等场景
 */
export class ServiceUnavailableError extends AppError {
  constructor(message?: string, details?: ErrorDetails) {
    super(ErrorCode.SERVICE_UNAVAILABLE, message, details);
  }
}

/**
 * 请求超时错误 (408)
 */
export class RequestTimeoutError extends AppError {
  constructor(message?: string, details?: ErrorDetails) {
    super(ErrorCode.REQUEST_TIMEOUT, message, details);
  }
}

/**
 * 请求频率超限错误 (429)
 */
export class RateLimitExceededError extends AppError {
  constructor(message?: string, details?: ErrorDetails) {
    super(ErrorCode.RATE_LIMIT_EXCEEDED, message, details);
  }
}

// ==================== LLM/AI 相关错误类型 ====================

/**
 * LLM 错误基类
 */
export class LLMError extends AppError {
  constructor(
    errorCode: ErrorCode = ErrorCode.LLM_ERROR,
    message?: string,
    details?: ErrorDetails
  ) {
    super(errorCode, message, details);
  }
}

/**
 * LLM API 密钥无效错误
 */
export class LLMInvalidApiKeyError extends LLMError {
  constructor(provider?: string) {
    super(ErrorCode.LLM_INVALID_API_KEY, 'LLM API 密钥无效', { provider });
  }
}

/**
 * LLM 模型不可用错误
 */
export class LLMModelUnavailableError extends LLMError {
  constructor(model?: string, details?: ErrorDetails) {
    super(ErrorCode.LLM_MODEL_UNAVAILABLE, 'LLM 模型不可用', { model, ...details });
  }
}

/**
 * LLM 响应解析错误
 */
export class LLMResponseParseError extends LLMError {
  constructor(message?: string, details?: ErrorDetails) {
    super(ErrorCode.LLM_RESPONSE_PARSE_ERROR, message || 'LLM 响应解析失败', details);
  }
}

/**
 * LLM Token 超限错误
 */
export class LLMTokenLimitExceededError extends LLMError {
  constructor(tokenCount?: number, limit?: number) {
    super(ErrorCode.LLM_TOKEN_LIMIT_EXCEEDED, 'LLM Token 超限', { tokenCount, limit });
  }
}

/**
 * LLM 内容过滤错误
 */
export class LLMContentFilteredError extends LLMError {
  constructor(reason?: string) {
    super(ErrorCode.LLM_CONTENT_FILTERED, '内容被过滤', { reason });
  }
}

/**
 * LLM 超时错误
 */
export class LLMTimeoutError extends LLMError {
  constructor(timeout?: number) {
    super(ErrorCode.LLM_TIMEOUT, 'LLM 请求超时', { timeout });
  }
}

/**
 * LLM 配置错误
 */
export class LLMConfigError extends LLMError {
  constructor(message?: string, details?: ErrorDetails) {
    super(ErrorCode.LLM_CONFIG_ERROR, message || 'LLM 配置错误', details);
  }
}

export class LLMNetworkError extends LLMError {
  constructor(message?: string, details?: ErrorDetails) {
    super(ErrorCode.LLM_NETWORK_ERROR, message || 'LLM 网络连接失败', details);
  }
}

/**
 * 图片生成错误
 */
export class ImageGenerationError extends AppError {
  constructor(message?: string, details?: ErrorDetails) {
    super(ErrorCode.IMAGE_GENERATION_ERROR, message, details);
  }
}

// ==================== 数据库相关错误类型 ====================

/**
 * 数据库错误基类
 */
export class DatabaseError extends AppError {
  constructor(
    errorCode: ErrorCode = ErrorCode.DATABASE_ERROR,
    message?: string,
    details?: ErrorDetails
  ) {
    super(errorCode, message, details, false);
  }
}

/**
 * 数据库连接错误
 */
export class DatabaseConnectionError extends DatabaseError {
  constructor(message?: string, details?: ErrorDetails) {
    super(ErrorCode.DATABASE_CONNECTION_ERROR, message || '数据库连接失败', details);
  }
}

/**
 * 数据库查询错误
 */
export class DatabaseQueryError extends DatabaseError {
  constructor(message?: string, query?: string, details?: ErrorDetails) {
    super(ErrorCode.DATABASE_QUERY_ERROR, message || '数据库查询错误', { query, ...details });
  }
}

/**
 * 数据库事务错误
 */
export class DatabaseTransactionError extends DatabaseError {
  constructor(message?: string, details?: ErrorDetails) {
    super(ErrorCode.DATABASE_TRANSACTION_ERROR, message || '数据库事务错误', details);
  }
}

// ==================== 存档相关错误类型 ====================

/**
 * 存档未找到错误
 */
export class SaveNotFoundError extends NotFoundError {
  constructor(saveId?: string) {
    super('存档不存在', { saveId });
  }
}

/**
 * 存档已存在错误
 */
export class SaveAlreadyExistsError extends ConflictError {
  constructor(saveId?: string) {
    super('存档已存在', { saveId });
  }
}

/**
 * 存档损坏错误
 */
export class SaveCorruptedError extends AppError {
  constructor(saveId?: string, reason?: string) {
    super(ErrorCode.SAVE_CORRUPTED, '存档损坏', { saveId, reason });
  }
}

/**
 * 存档版本不兼容错误
 */
export class SaveVersionIncompatibleError extends AppError {
  constructor(saveId?: string, version?: string, expectedVersion?: string) {
    super(ErrorCode.SAVE_VERSION_INCOMPATIBLE, '存档版本不兼容', { 
      saveId, 
      version, 
      expectedVersion 
    });
  }
}

// ==================== 角色相关错误类型 ====================

/**
 * 角色未找到错误
 */
export class CharacterNotFoundError extends NotFoundError {
  constructor(characterId?: string) {
    super('角色不存在', { characterId });
  }
}

/**
 * 角色属性无效错误
 */
export class CharacterInvalidAttributesError extends ValidationError {
  constructor(details?: ErrorDetails) {
    super('角色属性无效', details);
  }
}

// ==================== 物品相关错误类型 ====================

/**
 * 物品未找到错误
 */
export class ItemNotFoundError extends NotFoundError {
  constructor(itemId?: string) {
    super('物品不存在', { itemId });
  }
}

/**
 * 物品数量不足错误
 */
export class ItemInsufficientError extends BadRequestError {
  constructor(itemId?: string, required?: number, available?: number) {
    super('物品数量不足', { itemId, required, available });
  }
}

/**
 * 背包已满错误
 */
export class InventoryFullError extends BadRequestError {
  constructor() {
    super('背包已满');
  }
}

// ==================== 技能相关错误类型 ====================

/**
 * 技能未找到错误
 */
export class SkillNotFoundError extends NotFoundError {
  constructor(skillId?: string) {
    super('技能不存在', { skillId });
  }
}

/**
 * 技能冷却中错误
 */
export class SkillOnCooldownError extends BadRequestError {
  constructor(skillId?: string, remainingTime?: number) {
    super('技能冷却中', { skillId, remainingTime });
  }
}

/**
 * 技能未学习错误
 */
export class SkillNotLearnedError extends BadRequestError {
  constructor(skillId?: string) {
    super('技能未学习', { skillId });
  }
}

// ==================== 任务相关错误类型 ====================

/**
 * 任务未找到错误
 */
export class QuestNotFoundError extends NotFoundError {
  constructor(questId?: string) {
    super('任务不存在', { questId });
  }
}

/**
 * 任务条件不满足错误
 */
export class QuestConditionsNotMetError extends BadRequestError {
  constructor(questId?: string, conditions?: ErrorDetails) {
    super('任务条件不满足', { questId, conditions });
  }
}

// ==================== NPC 相关错误类型 ====================

/**
 * NPC 未找到错误
 */
export class NPCNotFoundError extends NotFoundError {
  constructor(npcId?: string) {
    super('NPC 不存在', { npcId });
  }
}

/**
 * NPC 不可交互错误
 */
export class NPCNotInteractableError extends BadRequestError {
  constructor(npcId?: string, reason?: string) {
    super('NPC 不可交互', { npcId, reason });
  }
}

// ==================== 战斗相关错误类型 ====================

/**
 * 战斗未找到错误
 */
export class CombatNotFoundError extends NotFoundError {
  constructor(combatId?: string) {
    super('战斗不存在', { combatId });
  }
}

/**
 * 战斗行动无效错误
 */
export class CombatInvalidActionError extends BadRequestError {
  constructor(action?: string, reason?: string) {
    super('战斗行动无效', { action, reason });
  }
}

// ==================== 模板相关错误类型 ====================

/**
 * 模板未找到错误
 */
export class TemplateNotFoundError extends NotFoundError {
  constructor(templateId?: string) {
    super('模板不存在', { templateId });
  }
}

/**
 * 模板无效错误
 */
export class TemplateInvalidError extends ValidationError {
  constructor(templateId?: string, reason?: string) {
    super('模板无效', { templateId, reason });
  }
}

// ==================== Agent 相关错误类型 ====================

/**
 * Agent 未找到错误
 */
export class AgentNotFoundError extends NotFoundError {
  constructor(agentType?: string) {
    super('Agent 不存在', { agentType });
  }
}

/**
 * Agent 调度错误
 */
export class AgentDispatchError extends AppError {
  constructor(message?: string, details?: ErrorDetails) {
    super(ErrorCode.AGENT_DISPATCH_ERROR, message, details);
  }
}

/**
 * Agent 超时错误
 */
export class AgentTimeoutError extends AppError {
  constructor(agentType?: string, timeout?: number) {
    super(ErrorCode.AGENT_TIMEOUT, 'Agent 超时', { agentType, timeout });
  }
}

/**
 * Agent 权限不足错误
 */
export class AgentPermissionDeniedError extends ForbiddenError {
  constructor(agentType?: string, toolType?: string, method?: string) {
    super('Agent 权限不足', { agentType, toolType, method });
  }
}

// ==================== 工具相关错误类型 ====================

/**
 * 工具未找到错误
 */
export class ToolNotFoundError extends NotFoundError {
  constructor(toolType?: string) {
    super('工具不存在', { toolType });
  }
}

/**
 * 工具方法未找到错误
 */
export class ToolMethodNotFoundError extends NotFoundError {
  constructor(toolType?: string, method?: string) {
    super('工具方法不存在', { toolType, method });
  }
}

/**
 * 工具执行错误
 */
export class ToolExecutionError extends AppError {
  constructor(toolType?: string, method?: string, reason?: string) {
    super(ErrorCode.TOOL_EXECUTION_ERROR, '工具执行错误', { toolType, method, reason });
  }
}

/**
 * 工具参数无效错误
 */
export class ToolInvalidParamsError extends ValidationError {
  constructor(toolType?: string, method?: string, details?: ErrorDetails) {
    super('工具参数无效', { toolType, method, ...details });
  }
}

// ==================== 配置相关错误类型 ====================

/**
 * 配置未找到错误
 */
export class ConfigNotFoundError extends NotFoundError {
  constructor(configKey?: string) {
    super('配置不存在', { configKey });
  }
}

/**
 * 配置无效错误
 */
export class ConfigInvalidError extends ValidationError {
  constructor(configKey?: string, reason?: string) {
    super('配置无效', { configKey, reason });
  }
}

/**
 * 环境变量缺失错误
 */
export class EnvMissingError extends AppError {
  constructor(envKey?: string) {
    super(ErrorCode.ENV_MISSING, '环境变量缺失', { envKey });
  }
}
