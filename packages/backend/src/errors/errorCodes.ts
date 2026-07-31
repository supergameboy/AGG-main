/**
 * 错误码枚举定义
 * 
 * 错误码命名规范：
 * - 通用错误码：大写蛇形命名，如 VALIDATION_ERROR
 * - 业务错误码：模块前缀 + 错误类型，如 LLM_ERROR, SAVE_NOT_FOUND
 */

/**
 * 错误码枚举
 */
export enum ErrorCode {
  // ==================== 通用错误码 (1xxx) ====================
  
  /** 参数验证失败 */
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  
  /** 错误的请求 */
  BAD_REQUEST = 'BAD_REQUEST',
  
  /** 未授权访问 */
  UNAUTHORIZED = 'UNAUTHORIZED',
  
  /** 禁止访问 */
  FORBIDDEN = 'FORBIDDEN',
  
  /** 资源未找到 */
  NOT_FOUND = 'NOT_FOUND',
  
  /** 资源冲突 */
  CONFLICT = 'CONFLICT',
  
  /** 内部服务器错误 */
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  
  /** 服务不可用 */
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  
  /** 请求超时 */
  REQUEST_TIMEOUT = 'REQUEST_TIMEOUT',
  
  /** 请求过于频繁 */
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

  /** 请求体过大 */
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',

  // ==================== LLM/AI 相关错误码 (2xxx) ====================
  
  /** LLM 调用错误 */
  LLM_ERROR = 'LLM_ERROR',
  
  /** LLM API 密钥无效 */
  LLM_INVALID_API_KEY = 'LLM_INVALID_API_KEY',
  
  /** LLM 模型不可用 */
  LLM_MODEL_UNAVAILABLE = 'LLM_MODEL_UNAVAILABLE',
  
  /** LLM 响应解析失败 */
  LLM_RESPONSE_PARSE_ERROR = 'LLM_RESPONSE_PARSE_ERROR',
  
  /** LLM Token 超限 */
  LLM_TOKEN_LIMIT_EXCEEDED = 'LLM_TOKEN_LIMIT_EXCEEDED',
  
  /** LLM 内容过滤 */
  LLM_CONTENT_FILTERED = 'LLM_CONTENT_FILTERED',
  
  /** LLM 请求超时 */
  LLM_TIMEOUT = 'LLM_TIMEOUT',
  
  /** LLM 配置错误 */
  LLM_CONFIG_ERROR = 'LLM_CONFIG_ERROR',

  /** LLM 网络错误 */
  LLM_NETWORK_ERROR = 'LLM_NETWORK_ERROR',

  /** 图片生成错误 */
  IMAGE_GENERATION_ERROR = 'IMAGE_GENERATION_ERROR',

  // ==================== 数据库相关错误码 (3xxx) ====================
  
  /** 数据库错误 */
  DATABASE_ERROR = 'DATABASE_ERROR',
  
  /** 数据库连接失败 */
  DATABASE_CONNECTION_ERROR = 'DATABASE_CONNECTION_ERROR',
  
  /** 数据库查询错误 */
  DATABASE_QUERY_ERROR = 'DATABASE_QUERY_ERROR',
  
  /** 数据库事务错误 */
  DATABASE_TRANSACTION_ERROR = 'DATABASE_TRANSACTION_ERROR',
  
  /** 数据库迁移错误 */
  DATABASE_MIGRATION_ERROR = 'DATABASE_MIGRATION_ERROR',

  // ==================== 存档相关错误码 (4xxx) ====================
  
  /** 存档未找到 */
  SAVE_NOT_FOUND = 'SAVE_NOT_FOUND',
  
  /** 存档已存在 */
  SAVE_ALREADY_EXISTS = 'SAVE_ALREADY_EXISTS',
  
  /** 存档损坏 */
  SAVE_CORRUPTED = 'SAVE_CORRUPTED',
  
  /** 存档版本不兼容 */
  SAVE_VERSION_INCOMPATIBLE = 'SAVE_VERSION_INCOMPATIBLE',
  
  /** 存档数量已达上限 */
  SAVE_LIMIT_REACHED = 'SAVE_LIMIT_REACHED',

  // ==================== 角色相关错误码 (5xxx) ====================
  
  /** 角色未找到 */
  CHARACTER_NOT_FOUND = 'CHARACTER_NOT_FOUND',
  
  /** 角色属性无效 */
  CHARACTER_INVALID_ATTRIBUTES = 'CHARACTER_INVALID_ATTRIBUTES',
  
  /** 角色等级不足 */
  CHARACTER_LEVEL_INSUFFICIENT = 'CHARACTER_LEVEL_INSUFFICIENT',
  
  /** 角色技能不足 */
  CHARACTER_SKILL_INSUFFICIENT = 'CHARACTER_SKILL_INSUFFICIENT',

  // ==================== 物品相关错误码 (6xxx) ====================
  
  /** 物品未找到 */
  ITEM_NOT_FOUND = 'ITEM_NOT_FOUND',
  
  /** 物品数量不足 */
  ITEM_INSUFFICIENT = 'ITEM_INSUFFICIENT',
  
  /** 物品不可使用 */
  ITEM_NOT_USABLE = 'ITEM_NOT_USABLE',
  
  /** 物品不可装备 */
  ITEM_NOT_EQUIPPABLE = 'ITEM_NOT_EQUIPPABLE',
  
  /** 背包已满 */
  INVENTORY_FULL = 'INVENTORY_FULL',

  // ==================== 技能相关错误码 (7xxx) ====================
  
  /** 技能未找到 */
  SKILL_NOT_FOUND = 'SKILL_NOT_FOUND',
  
  /** 技能冷却中 */
  SKILL_ON_COOLDOWN = 'SKILL_ON_COOLDOWN',
  
  /** 技能等级不足 */
  SKILL_LEVEL_INSUFFICIENT = 'SKILL_LEVEL_INSUFFICIENT',
  
  /** 技能未学习 */
  SKILL_NOT_LEARNED = 'SKILL_NOT_LEARNED',

  // ==================== 任务相关错误码 (8xxx) ====================
  
  /** 任务未找到 */
  QUEST_NOT_FOUND = 'QUEST_NOT_FOUND',
  
  /** 任务不可接受 */
  QUEST_NOT_ACCEPTABLE = 'QUEST_NOT_ACCEPTABLE',
  
  /** 任务未激活 */
  QUEST_NOT_ACTIVE = 'QUEST_NOT_ACTIVE',
  
  /** 任务条件不满足 */
  QUEST_CONDITIONS_NOT_MET = 'QUEST_CONDITIONS_NOT_MET',
  
  /** 任务已完成 */
  QUEST_ALREADY_COMPLETED = 'QUEST_ALREADY_COMPLETED',

  // ==================== NPC 相关错误码 (9xxx) ====================
  
  /** NPC 未找到 */
  NPC_NOT_FOUND = 'NPC_NOT_FOUND',
  
  /** NPC 不可交互 */
  NPC_NOT_INTERACTABLE = 'NPC_NOT_INTERACTABLE',
  
  /** NPC 对话错误 */
  NPC_DIALOGUE_ERROR = 'NPC_DIALOGUE_ERROR',

  // ==================== 战斗相关错误码 (10xxx) ====================
  
  /** 战斗未找到 */
  COMBAT_NOT_FOUND = 'COMBAT_NOT_FOUND',
  
  /** 战斗已结束 */
  COMBAT_ALREADY_ENDED = 'COMBAT_ALREADY_ENDED',
  
  /** 战斗行动无效 */
  COMBAT_INVALID_ACTION = 'COMBAT_INVALID_ACTION',
  
  /** 战斗目标无效 */
  COMBAT_INVALID_TARGET = 'COMBAT_INVALID_TARGET',

  // ==================== 模板相关错误码 (11xxx) ====================
  
  /** 模板未找到 */
  TEMPLATE_NOT_FOUND = 'TEMPLATE_NOT_FOUND',
  
  /** 模板无效 */
  TEMPLATE_INVALID = 'TEMPLATE_INVALID',
  
  /** 模板已存在 */
  TEMPLATE_ALREADY_EXISTS = 'TEMPLATE_ALREADY_EXISTS',

  // ==================== Agent 相关错误码 (12xxx) ====================
  
  /** Agent 未找到 */
  AGENT_NOT_FOUND = 'AGENT_NOT_FOUND',
  
  /** Agent 调度错误 */
  AGENT_DISPATCH_ERROR = 'AGENT_DISPATCH_ERROR',
  
  /** Agent 超时 */
  AGENT_TIMEOUT = 'AGENT_TIMEOUT',
  
  /** Agent 权限不足 */
  AGENT_PERMISSION_DENIED = 'AGENT_PERMISSION_DENIED',

  // ==================== 工具相关错误码 (13xxx) ====================
  
  /** 工具未找到 */
  TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',
  
  /** 工具方法未找到 */
  TOOL_METHOD_NOT_FOUND = 'TOOL_METHOD_NOT_FOUND',
  
  /** 工具执行错误 */
  TOOL_EXECUTION_ERROR = 'TOOL_EXECUTION_ERROR',
  
  /** 工具参数无效 */
  TOOL_INVALID_PARAMS = 'TOOL_INVALID_PARAMS',

  // ==================== 配置相关错误码 (14xxx) ====================
  
  /** 配置未找到 */
  CONFIG_NOT_FOUND = 'CONFIG_NOT_FOUND',
  
  /** 配置无效 */
  CONFIG_INVALID = 'CONFIG_INVALID',
  
  /** 环境变量缺失 */
  ENV_MISSING = 'ENV_MISSING',
}

/**
 * 错误码对应的 HTTP 状态码映射
 */
export const ErrorCodeToHttpStatus: Record<ErrorCode, number> = {
  // 通用错误
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.BAD_REQUEST]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.REQUEST_TIMEOUT]: 408,
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 429,
  [ErrorCode.PAYLOAD_TOO_LARGE]: 413,

  // LLM 错误
  [ErrorCode.LLM_ERROR]: 500,
  [ErrorCode.LLM_INVALID_API_KEY]: 401,
  [ErrorCode.LLM_MODEL_UNAVAILABLE]: 503,
  [ErrorCode.LLM_RESPONSE_PARSE_ERROR]: 500,
  [ErrorCode.LLM_TOKEN_LIMIT_EXCEEDED]: 400,
  [ErrorCode.LLM_CONTENT_FILTERED]: 400,
  [ErrorCode.LLM_TIMEOUT]: 504,
  [ErrorCode.LLM_CONFIG_ERROR]: 500,
  [ErrorCode.LLM_NETWORK_ERROR]: 503,
  [ErrorCode.IMAGE_GENERATION_ERROR]: 500,

  // 数据库错误
  [ErrorCode.DATABASE_ERROR]: 500,
  [ErrorCode.DATABASE_CONNECTION_ERROR]: 503,
  [ErrorCode.DATABASE_QUERY_ERROR]: 500,
  [ErrorCode.DATABASE_TRANSACTION_ERROR]: 500,
  [ErrorCode.DATABASE_MIGRATION_ERROR]: 500,

  // 存档错误
  [ErrorCode.SAVE_NOT_FOUND]: 404,
  [ErrorCode.SAVE_ALREADY_EXISTS]: 409,
  [ErrorCode.SAVE_CORRUPTED]: 500,
  [ErrorCode.SAVE_VERSION_INCOMPATIBLE]: 400,
  [ErrorCode.SAVE_LIMIT_REACHED]: 400,

  // 角色错误
  [ErrorCode.CHARACTER_NOT_FOUND]: 404,
  [ErrorCode.CHARACTER_INVALID_ATTRIBUTES]: 400,
  [ErrorCode.CHARACTER_LEVEL_INSUFFICIENT]: 400,
  [ErrorCode.CHARACTER_SKILL_INSUFFICIENT]: 400,

  // 物品错误
  [ErrorCode.ITEM_NOT_FOUND]: 404,
  [ErrorCode.ITEM_INSUFFICIENT]: 400,
  [ErrorCode.ITEM_NOT_USABLE]: 400,
  [ErrorCode.ITEM_NOT_EQUIPPABLE]: 400,
  [ErrorCode.INVENTORY_FULL]: 400,

  // 技能错误
  [ErrorCode.SKILL_NOT_FOUND]: 404,
  [ErrorCode.SKILL_ON_COOLDOWN]: 400,
  [ErrorCode.SKILL_LEVEL_INSUFFICIENT]: 400,
  [ErrorCode.SKILL_NOT_LEARNED]: 400,

  // 任务错误
  [ErrorCode.QUEST_NOT_FOUND]: 404,
  [ErrorCode.QUEST_NOT_ACCEPTABLE]: 400,
  [ErrorCode.QUEST_NOT_ACTIVE]: 400,
  [ErrorCode.QUEST_CONDITIONS_NOT_MET]: 400,
  [ErrorCode.QUEST_ALREADY_COMPLETED]: 400,

  // NPC 错误
  [ErrorCode.NPC_NOT_FOUND]: 404,
  [ErrorCode.NPC_NOT_INTERACTABLE]: 400,
  [ErrorCode.NPC_DIALOGUE_ERROR]: 500,

  // 战斗错误
  [ErrorCode.COMBAT_NOT_FOUND]: 404,
  [ErrorCode.COMBAT_ALREADY_ENDED]: 400,
  [ErrorCode.COMBAT_INVALID_ACTION]: 400,
  [ErrorCode.COMBAT_INVALID_TARGET]: 400,

  // 模板错误
  [ErrorCode.TEMPLATE_NOT_FOUND]: 404,
  [ErrorCode.TEMPLATE_INVALID]: 400,
  [ErrorCode.TEMPLATE_ALREADY_EXISTS]: 409,

  // Agent 错误
  [ErrorCode.AGENT_NOT_FOUND]: 404,
  [ErrorCode.AGENT_DISPATCH_ERROR]: 500,
  [ErrorCode.AGENT_TIMEOUT]: 504,
  [ErrorCode.AGENT_PERMISSION_DENIED]: 403,

  // 工具错误
  [ErrorCode.TOOL_NOT_FOUND]: 404,
  [ErrorCode.TOOL_METHOD_NOT_FOUND]: 404,
  [ErrorCode.TOOL_EXECUTION_ERROR]: 500,
  [ErrorCode.TOOL_INVALID_PARAMS]: 400,

  // 配置错误
  [ErrorCode.CONFIG_NOT_FOUND]: 404,
  [ErrorCode.CONFIG_INVALID]: 400,
  [ErrorCode.ENV_MISSING]: 500,
};

/**
 * 错误码对应的默认消息
 */
export const ErrorCodeDefaultMessage: Record<ErrorCode, string> = {
  // 通用错误
  [ErrorCode.VALIDATION_ERROR]: '参数验证失败',
  [ErrorCode.BAD_REQUEST]: '错误的请求',
  [ErrorCode.UNAUTHORIZED]: '未授权访问',
  [ErrorCode.FORBIDDEN]: '禁止访问',
  [ErrorCode.NOT_FOUND]: '资源未找到',
  [ErrorCode.CONFLICT]: '资源冲突',
  [ErrorCode.INTERNAL_ERROR]: '服务器内部错误',
  [ErrorCode.SERVICE_UNAVAILABLE]: '服务不可用',
  [ErrorCode.REQUEST_TIMEOUT]: '请求超时',
  [ErrorCode.RATE_LIMIT_EXCEEDED]: '请求过于频繁',
  [ErrorCode.PAYLOAD_TOO_LARGE]: '请求体过大',

  // LLM 错误
  [ErrorCode.LLM_ERROR]: 'LLM 调用失败',
  [ErrorCode.LLM_INVALID_API_KEY]: 'LLM API 密钥无效',
  [ErrorCode.LLM_MODEL_UNAVAILABLE]: 'LLM 模型不可用',
  [ErrorCode.LLM_RESPONSE_PARSE_ERROR]: 'LLM 响应解析失败',
  [ErrorCode.LLM_TOKEN_LIMIT_EXCEEDED]: 'LLM Token 超限',
  [ErrorCode.LLM_CONTENT_FILTERED]: '内容被过滤',
  [ErrorCode.LLM_TIMEOUT]: 'LLM 请求超时',
  [ErrorCode.LLM_CONFIG_ERROR]: 'LLM 配置错误',
  [ErrorCode.LLM_NETWORK_ERROR]: 'LLM 网络连接失败',
  [ErrorCode.IMAGE_GENERATION_ERROR]: '图片生成失败',

  // 数据库错误
  [ErrorCode.DATABASE_ERROR]: '数据库错误',
  [ErrorCode.DATABASE_CONNECTION_ERROR]: '数据库连接失败',
  [ErrorCode.DATABASE_QUERY_ERROR]: '数据库查询错误',
  [ErrorCode.DATABASE_TRANSACTION_ERROR]: '数据库事务错误',
  [ErrorCode.DATABASE_MIGRATION_ERROR]: '数据库迁移错误',

  // 存档错误
  [ErrorCode.SAVE_NOT_FOUND]: '存档不存在',
  [ErrorCode.SAVE_ALREADY_EXISTS]: '存档已存在',
  [ErrorCode.SAVE_CORRUPTED]: '存档损坏',
  [ErrorCode.SAVE_VERSION_INCOMPATIBLE]: '存档版本不兼容',
  [ErrorCode.SAVE_LIMIT_REACHED]: '存档数量已达上限',

  // 角色错误
  [ErrorCode.CHARACTER_NOT_FOUND]: '角色不存在',
  [ErrorCode.CHARACTER_INVALID_ATTRIBUTES]: '角色属性无效',
  [ErrorCode.CHARACTER_LEVEL_INSUFFICIENT]: '角色等级不足',
  [ErrorCode.CHARACTER_SKILL_INSUFFICIENT]: '角色技能不足',

  // 物品错误
  [ErrorCode.ITEM_NOT_FOUND]: '物品不存在',
  [ErrorCode.ITEM_INSUFFICIENT]: '物品数量不足',
  [ErrorCode.ITEM_NOT_USABLE]: '物品不可使用',
  [ErrorCode.ITEM_NOT_EQUIPPABLE]: '物品不可装备',
  [ErrorCode.INVENTORY_FULL]: '背包已满',

  // 技能错误
  [ErrorCode.SKILL_NOT_FOUND]: '技能不存在',
  [ErrorCode.SKILL_ON_COOLDOWN]: '技能冷却中',
  [ErrorCode.SKILL_LEVEL_INSUFFICIENT]: '技能等级不足',
  [ErrorCode.SKILL_NOT_LEARNED]: '技能未学习',

  // 任务错误
  [ErrorCode.QUEST_NOT_FOUND]: '任务不存在',
  [ErrorCode.QUEST_NOT_ACCEPTABLE]: '任务不可接受',
  [ErrorCode.QUEST_NOT_ACTIVE]: '任务未激活',
  [ErrorCode.QUEST_CONDITIONS_NOT_MET]: '任务条件不满足',
  [ErrorCode.QUEST_ALREADY_COMPLETED]: '任务已完成',

  // NPC 错误
  [ErrorCode.NPC_NOT_FOUND]: 'NPC 不存在',
  [ErrorCode.NPC_NOT_INTERACTABLE]: 'NPC 不可交互',
  [ErrorCode.NPC_DIALOGUE_ERROR]: 'NPC 对话错误',

  // 战斗错误
  [ErrorCode.COMBAT_NOT_FOUND]: '战斗不存在',
  [ErrorCode.COMBAT_ALREADY_ENDED]: '战斗已结束',
  [ErrorCode.COMBAT_INVALID_ACTION]: '战斗行动无效',
  [ErrorCode.COMBAT_INVALID_TARGET]: '战斗目标无效',

  // 模板错误
  [ErrorCode.TEMPLATE_NOT_FOUND]: '模板不存在',
  [ErrorCode.TEMPLATE_INVALID]: '模板无效',
  [ErrorCode.TEMPLATE_ALREADY_EXISTS]: '模板已存在',

  // Agent 错误
  [ErrorCode.AGENT_NOT_FOUND]: 'Agent 不存在',
  [ErrorCode.AGENT_DISPATCH_ERROR]: 'Agent 调度错误',
  [ErrorCode.AGENT_TIMEOUT]: 'Agent 超时',
  [ErrorCode.AGENT_PERMISSION_DENIED]: 'Agent 权限不足',

  // 工具错误
  [ErrorCode.TOOL_NOT_FOUND]: '工具不存在',
  [ErrorCode.TOOL_METHOD_NOT_FOUND]: '工具方法不存在',
  [ErrorCode.TOOL_EXECUTION_ERROR]: '工具执行错误',
  [ErrorCode.TOOL_INVALID_PARAMS]: '工具参数无效',

  // 配置错误
  [ErrorCode.CONFIG_NOT_FOUND]: '配置不存在',
  [ErrorCode.CONFIG_INVALID]: '配置无效',
  [ErrorCode.ENV_MISSING]: '环境变量缺失',
};
