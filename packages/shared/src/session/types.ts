/**
 * 会话层 K 类型定义
 *
 * ClientSession: 客户端会话，独立于 WS 连接存在，支持重连恢复
 * InitPhase: 初始化阶段标识
 * AuthStrategy: 验证层 C 使用的鉴权策略判别联合
 * SESSION_MAX_IDLE_MS: 会话默认过期时间
 */

/**
 * 初始化阶段标识。
 * - 'character-creation': 角色创建中（用户正在输入角色信息）
 * - 'character-creating': 角色正在生成（LLM 正在生成角色）
 * - 'initializing': 游戏初始化中（LLM 正在生成初始世界状态）
 * - null: 非初始化中（正常游戏流程）
 *
 * 使用 `(string & {})` 技巧保留字面量联合的 IDE 补全，
 * 同时允许未来扩展新阶段（避免 `| string` 导致类型退化为 string）。
 */
export type InitPhase = 'character-creation' | 'character-creating' | 'initializing' | (string & {});

/**
 * 客户端会话。
 *
 * 会话独立于 WS 连接存在，支持重连恢复。
 * WS 断开后会话保留至 SESSION_MAX_IDLE_MS 过期。
 */
export interface ClientSession {
  /** 唯一标识（ClientIdGenerator.generate() 生成，格式 client_<uuid>） */
  readonly clientId: string;
  /** 创建时间戳（ms） */
  readonly createdAt: number;
  /** 最后活跃时间戳（ms），每次 WS 消息/请求时通过 updateActivity 更新 */
  lastActiveAt: number;
  /** 当前编辑的模板 ID（模板编辑会话），null 表示非模板编辑 */
  templateId: string | null;
  /** 当前游戏的存档 ID（游戏会话），null 表示未开始游戏。通过 bindSaveId/unbindSaveId 管理 */
  saveId: string | null;
  /** 初始化阶段标识，null 表示非初始化中 */
  initPhase: InitPhase | null;
  /**
   * 登录用户 ID。
   * 当前未使用（设计文档从未承诺任何写入/读取场景），为未来鉴权流程预留。
   */
  userId?: string;
  /**
   * 用户权限列表。
   * 当前未使用（设计文档从未承诺任何写入/读取场景），为未来鉴权流程预留。
   */
  permissions?: string[];
}

/**
 * 验证层 C 使用的鉴权策略判别联合。
 * 不同路由要求不同的会话状态（如 /game/save 要求 saveId 已绑定）。
 *
 * 当前全工程无任何消费方使用 AuthStrategy 类型做鉴权决策，为未来鉴权流程预留。
 */
export type AuthStrategy =
  | { readonly type: 'none' }
  | { readonly type: 'client-only' }
  | { readonly type: 'template'; readonly requireTemplateId: true }
  | { readonly type: 'init'; readonly requireTemplateId: true }
  | { readonly type: 'save'; readonly requireSaveId: true };

/** 会话默认过期时间：30 分钟无活动 */
export const SESSION_MAX_IDLE_MS = 30 * 60 * 1000;
