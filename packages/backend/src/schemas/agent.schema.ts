import { z } from 'zod';
import type { AgentType } from '../../../shared/src/types/agent.js';

function hasExplicitSelectOptionTarget(value: string | undefined): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== '' && normalized !== 'n/a' && normalized !== 'all';
}

function normalizeSelectOptionId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

// ==================== Agent路由系统 Zod Schema 定义 ====================
//
// 本文件为Agent API的6个端点提供完整的Zod Schema定义：
// - POST /chat        → ChatRequestBody
// - GET /status       → 无参数
// - GET /tools        → 无参数
// - GET /agents       → 无参数
// - GET /decisions    → DecisionsQueryParams
// - POST /message     → DirectMessageRequestBody
//
// 所有Schema导出供测试复用和中间件使用

// ==================== 1. POST /chat - 主聊天入口 ====================

/**
 * 聊天请求体Schema
 * 
 * @example
 * ```typescript
 * // 有效请求
 * { message: "你好" }
 * { message: "你好", saveId: "save_123", action: "chat", data: { key: "value" } }
 * 
 * // 无效请求
 * {}                                      // 缺少message
 * { message: "" }                         // message太短
 * { message: "hi", saveId: "" }           // saveId太短（如果提供）
 * ```
 */
export const chatSchema = z.object({
  message: z.string()
    .trim()
    .min(1, '消息内容不能为空')
    .max(5000, '消息内容不能超过5000字符')
    .describe('用户消息内容'),
  
  saveId: z.string()
    .min(1, '存档ID不能为空')
    .nullable()
    .optional()
    .describe('存档ID（可选）'),
  
  npcId: z.string()
    .optional()
    .describe('NPC ID（可选）'),

  targetNpcIds: z.array(z.string())
    .optional()
    .describe('目标 NPC ID 列表（可选）'),
  
  action: z.string()
    .default('chat')
    .describe('操作类型，默认为chat'),
  
  data: z.record(z.string(), z.unknown())
    .optional()
    .describe('附加数据（可选）'),

  playerAction: z.object({
    type: z.string().describe('动作类型, 如 use_item / select_option / attack'),
    itemId: z.string().optional(),
    itemName: z.string().optional(),
    targetNpcId: z.string().optional(),
    selectedOptionId: z.string().optional(),
  }).optional()
    .describe('玩家的结构化动作信息'),

  dataChanges: z.record(z.string(), z.unknown())
    .optional()
    .describe('前端已知的状态变化'),
}).superRefine((body, ctx) => {
  if (body.action !== 'select_option') {
    return;
  }

  const selectedOptionId = normalizeSelectOptionId(body.playerAction?.selectedOptionId)
    ?? normalizeSelectOptionId(body.data?.optionId);
  const explicitTargetNpcId = body.playerAction?.targetNpcId;
  const routeNpcId = body.npcId;

  if (!selectedOptionId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['playerAction', 'selectedOptionId'],
      message: 'select_option 必须提供 selectedOptionId',
    });
  }

  if (!hasExplicitSelectOptionTarget(explicitTargetNpcId) && !hasExplicitSelectOptionTarget(routeNpcId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['playerAction', 'targetNpcId'],
      message: 'select_option 必须提供明确的目标 NPC，不能从 targetNpcIds 自动推断',
    });
  }
});

/** ChatRequestBody 类型导出 */
export type ChatRequestBody = z.infer<typeof chatSchema>;

// ==================== 2. GET /status - 系统状态 ====================
// 无参数端点，无需Schema

// ==================== 3. GET /tools - 工具列表 ====================
// 无参数端点，无需Schema

// ==================== 4. GET /agents - Agent列表 ====================
// 无参数端点，无需Schema

// ==================== 5. GET /decisions - 决策日志查询 ====================

/**
 * 决策日志查询参数Schema（Query Parameters）
 * 
 * 注意：Express的req.query中所有值都是string或undefined，
 * 因此limit和offset需要从string转换为number
 * 
 * @example
 * ```typescript
 * // 有效查询
 * ?limit=10&offset=0&saveId=default
 * ?agentType=dialogue&limit=50
 * 
 * // 无效查询
 * ?limit=abc          // limit不是有效数字
 * ?limit=200          // limit超过最大值100
 * ?offset=-1          // offset不能为负数
 * ```
 */
export const decisionsQuerySchema = z.object({
  agentType: z.string()
    .optional()
    .describe('按Agent类型过滤'),
  
  limit: z.preprocess(
    (val) => {
      if (typeof val === 'string') {
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? undefined : parsed;
      }
      return val;
    },
    z.number({
      message: '必须是数字'
    })
      .int('必须是整数')
      .min(1, '最小值为1')
      .max(100, '最大值为100')
      .default(20)
  )
  .optional()
  .describe('每页数量，默认20，最大100'),
  
  offset: z.preprocess(
    (val) => {
      if (typeof val === 'string') {
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? undefined : parsed;
      }
      return val;
    },
    z.number({
      message: '必须是数字'
    })
      .int('必须是整数')
      .min(0, '不能为负数')
      .default(0)
  )
  .optional()
  .describe('偏移量，默认0'),
  
  saveId: z.string()
    .default('default')
    .describe('存档ID，默认为default')
});

/** DecisionsQueryParams 类型导出 */
export type DecisionsQueryParams = z.infer<typeof decisionsQuerySchema>;

// ==================== 6. POST /message - 直接消息 ====================

/**
 * 直接消息请求体Schema
 * 
 * @example
 * ```typescript
 * // 有效请求
 * { agentType: "dialogue", message: "你好" }
 * { agentType: "combat", message: "攻击", saveId: "save_123" }
 * 
 * // 无效请求
 * { message: "hello" }                       // 缺少agentType
 * { agentType: "invalid", message: "hi" }    // agentType不在枚举中
 * { agentType: "dialogue" }                  // 缺少message
 * ```
 */
export const directMessageSchema = z.object({
  agentType: z.enum([
    'gamemaster',
    'output',
    'challenge',
    'quest',
    'map',
    'npc_party',
    'inventory',
    'skill',
    'numerical',
    'event',
    'time'
  ] as [AgentType, ...AgentType[]], {
    message: '无效的Agent类型'
  })
  .describe('目标Agent类型'),
  
  message: z.string()
    .trim()
    .min(1, '消息内容不能为空')
    .max(5000, '消息内容不能超过5000字符')
    .describe('消息内容'),
  
  saveId: z.string()
    .nullable()
    .optional()
    .describe('存档ID（可选）')
});

/** DirectMessageRequestBody 类型导出 */
export type DirectMessageRequestBody = z.infer<typeof directMessageSchema>;

// ==================== Schema 导出汇总 ====================

/**
 * Agent路由Schema映射表
 * 用于validateAgentRoute便捷函数自动选择Schema
 */
export const agentSchemas = {
  chat: {
    body: chatSchema,
    method: 'POST' as const,
    path: '/chat' as const
  },
  decisions: {
    query: decisionsQuerySchema,
    method: 'GET' as const,
    path: '/decisions' as const
  },
  message: {
    body: directMessageSchema,
    method: 'POST' as const,
    path: '/message' as const
  }
} as const;

/** AgentSchemaMap 类型导出 */
export type AgentSchemaMap = typeof agentSchemas;

// ==================== Config路由 Schema ====================
//
// 本节为Config API的端点提供Zod Schema定义：
// - POST /config/agent-profiles        → CreateAgentProfileBody
// - PUT  /config/agent-profiles/:name  → UpdateAgentProfileBody
// - POST /config/reload                → ReloadConfigBody
// - POST /config/react-test            → ReactTestBody

/**
 * 创建Agent Profile请求体Schema
 *
 * @example
 * ```typescript
 * // 有效请求
 * { name: "冒险模式", game_mode: "adventure", agents: { dialogue: {...} } }
 *
 * // 无效请求
 * { name: "", game_mode: "adventure", agents: {} }    // name不能为空
 * { name: "test", game_mode: "", agents: {} }          // game_mode不能为空
 * { name: "test", game_mode: "adv", agents: {} }       // agents不能为空
 * ```
 */
export const createAgentProfileSchema = z.object({
  name: z.string()
    .min(1, 'Profile name is required')
    .describe('Profile名称'),

  game_mode: z.string()
    .min(1, 'game_mode is required')
    .describe('游戏模式'),

  agents: z.record(z.string(), z.unknown())
    .refine(
      (val) => Object.keys(val).length > 0,
      'At least one agent is required'
    )
    .describe('Agent配置映射'),
});

/** CreateAgentProfileBody 类型导出 */
export type CreateAgentProfileBody = z.infer<typeof createAgentProfileSchema>;

/**
 * 更新Agent Profile请求体Schema
 *
 * 使用passthrough()允许任意字段通过
 *
 * @example
 * ```typescript
 * // 有效请求
 * { agents: { dialogue: {...} } }
 * { game_mode: "combat", agents: { combat: {...} } }
 * ```
 */
export const updateAgentProfileSchema = z.object({})
  .passthrough();

/** UpdateAgentProfileBody 类型导出 */
export type UpdateAgentProfileBody = z.infer<typeof updateAgentProfileSchema>;

/**
 * 重载配置请求体Schema
 *
 * @example
 * ```typescript
 * // 有效请求
 * { profileName: "adventure" }
 *
 * // 无效请求
 * {}                        // 缺少profileName
 * { profileName: "" }       // profileName不能为空
 * ```
 */
export const reloadConfigSchema = z.object({
  profileName: z.string()
    .min(1, 'profileName is required')
    .describe('要重载的Profile名称'),
});

/** ReloadConfigBody 类型导出 */
export type ReloadConfigBody = z.infer<typeof reloadConfigSchema>;

/**
 * React测试请求体Schema
 *
 * @example
 * ```typescript
 * // 有效请求
 * { agentKey: "dialogue", saveId: "save_123", playerInput: "你好" }
 * { profileName: "adventure", agentKey: "combat", saveId: "save_456", playerInput: "攻击" }
 *
 * // 无效请求
 * { agentKey: "", saveId: "save_123", playerInput: "hi" }    // agentKey不能为空
 * { agentKey: "dialogue", saveId: "", playerInput: "hi" }     // saveId不能为空
 * ```
 */
export const reactTestSchema = z.object({
  profileName: z.string()
    .optional()
    .describe('Profile名称（可选）'),

  agentKey: z.string()
    .min(1, 'agentKey is required')
    .describe('Agent键名'),

  saveId: z.string()
    .min(1, 'saveId is required')
    .describe('存档ID'),

  playerInput: z.string()
    .min(1, 'playerInput is required')
    .describe('玩家输入内容'),
});

/** ReactTestBody 类型导出 */
export type ReactTestBody = z.infer<typeof reactTestSchema>;
