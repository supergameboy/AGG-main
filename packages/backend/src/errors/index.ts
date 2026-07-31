/**
 * 错误处理模块
 * 
 * 统一的错误类型定义和处理
 * 
 * @example
 * ```typescript
 * import { ValidationError, NotFoundError, ErrorCode } from '@/errors';
 * 
 * // 抛出验证错误
 * throw new ValidationError('用户名不能为空', { field: 'username' });
 * 
 * // 抛出资源未找到错误
 * throw new NotFoundError.forResource('User', '123');
 * 
 * // 使用错误码
 * if (error.errorCode === ErrorCode.NOT_FOUND) {
 *   // 处理未找到错误
 * }
 * ```
 */

// 导出错误码
export { ErrorCode, ErrorCodeToHttpStatus, ErrorCodeDefaultMessage } from './errorCodes.js';

// 导出错误基类
export { AppError, type ErrorDetails } from './AppError.js';

// 导出所有错误类型
export {
  // 通用错误
  ValidationError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InternalServerError,
  ServiceUnavailableError,
  RequestTimeoutError,
  RateLimitExceededError,

  // LLM/AI 错误
  LLMError,
  LLMInvalidApiKeyError,
  LLMModelUnavailableError,
  LLMResponseParseError,
  LLMTokenLimitExceededError,
  LLMContentFilteredError,
  LLMTimeoutError,
  LLMConfigError,
  LLMNetworkError,
  ImageGenerationError,

  // 数据库错误
  DatabaseError,
  DatabaseConnectionError,
  DatabaseQueryError,
  DatabaseTransactionError,

  // 存档错误
  SaveNotFoundError,
  SaveAlreadyExistsError,
  SaveCorruptedError,
  SaveVersionIncompatibleError,

  // 角色错误
  CharacterNotFoundError,
  CharacterInvalidAttributesError,

  // 物品错误
  ItemNotFoundError,
  ItemInsufficientError,
  InventoryFullError,

  // 技能错误
  SkillNotFoundError,
  SkillOnCooldownError,
  SkillNotLearnedError,

  // 任务错误
  QuestNotFoundError,
  QuestConditionsNotMetError,

  // NPC 错误
  NPCNotFoundError,
  NPCNotInteractableError,

  // 战斗错误
  CombatNotFoundError,
  CombatInvalidActionError,

  // 模板错误
  TemplateNotFoundError,
  TemplateInvalidError,

  // Agent 错误
  AgentNotFoundError,
  AgentDispatchError,
  AgentTimeoutError,
  AgentPermissionDeniedError,

  // 工具错误
  ToolNotFoundError,
  ToolMethodNotFoundError,
  ToolExecutionError,
  ToolInvalidParamsError,

  // 配置错误
  ConfigNotFoundError,
  ConfigInvalidError,
  EnvMissingError,
} from './errorTypes.js';
