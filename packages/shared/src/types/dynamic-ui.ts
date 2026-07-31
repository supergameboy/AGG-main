import { AgentType, DialogueOption } from './agent';
import { SkillCostEntry, QuestConditions, EventTrigger, QuestReward } from './game';
export type { QuestConditions, EventTrigger } from './game';

// @deprecated UIType 已删除，前端根据 :::组件 语法自动识别渲染
// export type UIType = ...

// @deprecated DynamicUIResponse 已被 GameResponse 替代
// export interface DynamicUIResponse { ... }

export interface GameResponse {
  uiDirective?: string;
  uiIntensity?: 'full' | 'partial' | 'minimal' | 'none';
  // 统一面板变更推送机制：panelUpdates 字段已移除，所有面板数据变更统一走 'panel:update' 事件
  // message/speaker/options 字段已移除，dialogue 数据走 panelUpdates.dialogue（'dialogue' 面板）
  data?: Record<string, unknown>;
  meta?: GameResponseMeta;
}

export interface GameResponseMeta {
  agentType?: AgentType;
  duration?: number;
  partialSuccess?: boolean;
  isInitialization?: boolean;
}

export interface PanelUpdates {
  character?: CharacterUpdate;
  inventory?: InventoryUpdate;
  quest?: QuestUpdate;
  location?: LocationUpdate;
  /** @deprecated Use location */
  map?: MapUpdate;
  combat?: CombatUpdate;
  skills?: SkillsUpdate;
  npc?: NPCUpdate;
  dialogue?: DialogueUpdate;
}

export interface CharacterUpdate {
  currentHP?: number;
  maxHP?: number;
  currentMP?: number;
  maxMP?: number;
  exp?: number;
  level?: number;
  gold?: number;
  currency?: Record<string, number>;
  attributes?: Record<string, number>;
  statusEffects?: string[];
}

export interface InventoryUpdate {
  added?: InventoryItemData[];
  removed?: string[];
  updated?: InventoryItemData[];
  capacity?: number;
  replace?: boolean;
}

export interface InventoryItemData {
  id: string;
  saveId?: string;
  itemId: string;
  poolId?: string;
  name: string;
  description?: string;
  quantity: number;
  quality?: string;
  category?: string;
  equipped?: boolean;
  inventorySlot?: number;
  equippedSlot?: string;
  stats?: Record<string, number>;
  effects?: Array<{ type: string; value: number; target?: string; duration?: number }>;
  value?: { buy?: number; sell?: number; currency?: string };
  tags?: string[];
  weight?: number;
  durability?: number;
  maxDurability?: number;
  maxStack?: number;
  customData?: Record<string, unknown>;
  ownerType?: 'character' | 'npc';
  ownerId?: string;
  visible?: boolean;
}

export interface QuestUpdate {
  added?: QuestData[];
  updated?: QuestData[];
  completed?: string[];
}

export interface QuestData {
  id: string;
  name: string;
  type: string;
  description?: string;
  status: string;
  visible?: boolean;
  giverNpcId?: string;
  giverLocationId?: string;
  questChainId?: string;
  prerequisiteQuestIds?: string[];
  conditions?: QuestConditions;
  objectives: QuestObjectiveData[];
  rewards?: QuestReward;
  timeLimit?: number;
  customData?: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
}

export interface QuestObjectiveData {
  id: string;
  type: string;
  description: string;
  target: string;
  current: number;
  required: number;
  completed: boolean;
  eventTrigger?: EventTrigger;
}



export interface LocationUpdate {
  currentLocationId?: string;
  currentLocationName?: string;
  newLocations?: LocationPanelData[];
  newConnections?: LocationConnectionData[];
  discoveredLocationIds?: string[];
}

/** @deprecated Use LocationUpdate */
export type MapUpdate = LocationUpdate;

export interface LocationPanelData {
  id: string;
  name: string;
  description?: string;
  type?: string;
  parentLocationId?: string;
  locationLevel?: import('./game').LocationLevel;
  x?: number;
  y?: number;
  dangerLevel?: number;
  customData?: Record<string, unknown>;
}

/** @deprecated Use LocationPanelData */
export type MapLocationData = LocationPanelData;

export interface LocationConnectionData {
  from: string;
  to: string;
  direction?: string;
  connectionType?: string;
  distance?: number;
  travelTime?: number;
}

/** @deprecated Use LocationConnectionData */
export type MapConnectionData = LocationConnectionData;

export interface CombatLogData {
  turn?: number;
  message: string;
  type?: 'damage' | 'heal' | 'buff' | 'debuff' | 'info';
}

export interface CombatUpdate {
  active?: boolean;
  playerHP?: number;
  playerMaxHP?: number;
  playerMP?: number;
  playerMaxMP?: number;
  enemies?: CombatEnemyData[];
  isPlayerTurn?: boolean;
  log?: CombatLogData[];
  availableActions?: string[];
}

export interface CombatEnemyData {
  id: string;
  name: string;
  hp: number;
  maxHP: number;
  mp?: number;
  maxMP?: number;
  level?: number;
  status?: string[];
}

export interface SkillsUpdate {
  learned?: SkillData[];
  updated?: SkillData[];
  replace?: boolean;
}

export interface SkillData {
  id: string;
  name: string;
  type: string;
  description?: string;
  skillId?: string;
  level?: number;
  maxLevel?: number;
  experience?: number;
  element?: string;
  cost?: SkillCostEntry[];
  cooldownRemaining?: number;
  cooldown?: number;
  unlocked?: boolean;
  visible?: boolean;
  effects?: Record<string, unknown>;
  customData?: Record<string, unknown>;
  /**
   * 数据归属类型。与 InventoryItemData.ownerType 对称。
   * §13.3: 必填，前端按此字段过滤 character 技能面板。
   */
  ownerType?: 'character' | 'npc';
  /**
   * 数据归属 ID（character ID 或 NPC ID）。
   * 与 InventoryItemData.ownerId 对称。
   */
  ownerId?: string;
}

export interface NPCInventoryItem {
  id: string;
  itemId: string;
  name: string;
  category: string;
  equipped: boolean;
  equippedSlot?: string | null;
  quantity: number;
}

export interface NPCSkill {
  id: string;
  skillId: string;
  name: string;
  category: string;
  level: number;
  element?: string;
  cost?: SkillCostEntry[];
}

export interface NPCUpdate {
  nearby?: NPCData[];
  partyChanges?: NPCData[];
}

export interface NPCVisibility {
  attributes: 'hidden' | 'vague' | 'visible';
  hpMp: 'hidden' | 'bar_only' | 'visible';
  equipment: 'hidden' | 'outline' | 'visible';
  inventory: 'hidden' | 'count_only' | 'visible';
  skills: 'hidden' | 'category' | 'visible';
}

export interface NPCData {
  id: string;
  name: string;
  role?: string;
  relation?: string;
  inParty?: boolean;
  affinity?: number;
  /**
   * location 的 ID（如 `loc_白杨村广场_xxx`）。
   *
   * 后端推送 NPCData 时优先填充此字段，前端合并到 FrontendNPCInfo.locationId。
   * 与 `location` 字段同时存在时，消费方应优先使用 `locationId`。
   */
  locationId?: string;
  /**
   * @deprecated 语义模糊字段，实际携带 location ID（与 `locationId` 同值）。
   * 保留兼容旧代码，新代码应使用 `locationId`。未来版本将废弃。
   */
  location?: string;
  services?: Array<{ type: string; name: string } | string>;
  level?: number;
  description?: string;
  mood?: number;
  race?: string;
  title?: string;
  currency?: Record<string, number>;
  attributes?: Record<string, unknown>;
  derivedAttributes?: Record<string, unknown>;
  currentHp?: number | null;
  maxHp?: number | null;
  currentMp?: number | null;
  maxMp?: number | null;
  driveProfile?: import('./game').DriveProfile;
  goals?: import('./game').NPCGoal[];
  inventory?: NPCInventoryItem[];
  skills?: NPCSkill[];
  customData?: Record<string, unknown>;
  visible?: boolean;
  attrInitialized?: boolean;
  invInitialized?: boolean;
  skillInitialized?: boolean;
  visibility?: NPCVisibility;
}

/**
 * 对话消息类型枚举（单一数据源）。
 * 类型 `DialogueMessageEntry['messageType']` 从此常量派生，
 * 避免运行时校验数组与类型定义重复（code-standards 第二章"一个概念只表达一次"）。
 *
 * - 'npc': NPC 对话（默认）
 * - 'narrator': 旁白/场景描写
 * - 'system': 系统消息
 * - 'player_meta': 玩家消息回声（前端跳过，已由 sendMessage 乐观更新添加）
 */
export const DIALOGUE_MESSAGE_TYPES = ['npc', 'narrator', 'system', 'player_meta'] as const;
export type DialogueMessageType = typeof DIALOGUE_MESSAGE_TYPES[number];

/**
 * 对话消息条目（DialogueUpdate.addedMessages 数组项类型）。
 * 前后端共享，前端按 id 去重，保证跨客户端一致与重连重放可去重。
 */
export interface DialogueMessageEntry {
  /** 消息唯一 ID，后端用 randomUUID() 生成 */
  id: string;
  /** 说话者名称 */
  speaker: string;
  /** 消息内容 */
  content: string;
  /** 情绪标记（可选） */
  emotion?: string;
  /** 消息类型（见 DIALOGUE_MESSAGE_TYPES） */
  messageType?: DialogueMessageType;
}

/**
 * 对话面板更新载荷。
 * - addedMessages: 增量添加的对话消息列表，前端逐条调用 useDialogueStore.addDialogueMessage 添加（按 id 去重）
 * - options: 快速选项数组，replace 语义（覆盖现有 dialogueOptions）
 * 两字段皆可选，但至少一个非空才有意义（构造方负责保证）。
 */
export interface DialogueUpdate {
  addedMessages?: DialogueMessageEntry[];
  options?: DialogueOption[];
}

export type UIInteractionType =
  | 'use_item'
  | 'equip_item'
  | 'unequip_item'
  | 'drop_item'
  | 'examine_item'
  | 'learn_skill'
  | 'use_skill'
  | 'view_skill'
  | 'travel'
  | 'travel_to'
  | 'talk_npc'
  | 'accept_quest'
  | 'complete_quest'
  | 'abandon_quest'
  | 'buy_item'
  | 'sell_item'
  | 'craft_item'
  | 'enhance_item'
  | 'deposit_item'
  | 'withdraw_item'
  | 'select'
  | 'custom';

export interface UIInteractionData {
  interactionType: UIInteractionType;
  target?: string;
  displayName?: string;
  params?: Record<string, unknown>;
}

export interface UIParsedNode {
  type: 'component' | 'text' | 'markdown' | 'mermaid';
  component?: string;
  attrs?: Record<string, unknown>;
  children?: UIParsedNode[];
  content?: string;
}
