import { BaseEntity, ID, Timestamp } from './core';

export type Gender = 'male' | 'female' | 'custom';

export const GENDER_LABELS: Record<Gender, string> = {
  male: '男',
  female: '女',
  custom: '自定义',
};

export type AgeGroup = string;

export const DEFAULT_AGE_GROUP_LABELS: Record<string, string> = {
  young: '少年',
  youth: '青年',
  middle: '中年',
  elder: '老年',
};

export interface Character extends BaseEntity {
  save_id: ID;
  name: string;
  gender: Gender;
  customGender?: string;
  ageGroup?: AgeGroup;
  race: string;
  raceName: string;
  class: string;
  className: string;
  background: string;
  backgroundName: string;
  level: number;
  experience: number;
  attributes: CharacterAttributes;
  attributeNames: Record<string, string>;
  derivedAttributes: DerivedAttributes;
  currentHP: number;
  maxHP: number;
  currentMP: number;
  maxMP: number;
  gold: number;
  currency: Record<string, number>;
  currentLocationId?: string;
  statusEffects?: string[];
  status?: Record<string, unknown>;
  customData?: Record<string, unknown>;
}

export interface CharacterAttributes {
  [key: string]: number;
}

export interface DerivedAttributes {
  attack: number;
  defense: number;
  speed: number;
  critRate: number;
  critDamage: number;
  dodgeRate: number;
  blockRate: number;
  magicAttack: number;
  magicDefense: number;
  maxHealth?: number;
  maxMana?: number;
  [key: string]: number | undefined;
}

export type ItemCategory = 'weapon' | 'armor' | 'accessory' | 'consumable' | 'material' | 'tool' | 'quest' | 'misc';
export type ItemQuality = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

/**
 * 装备槽类型：标准槽位字面量 + 模板自定义槽位扩展。
 * 字面量联合提供 IDE 自动补全；`string & {}` 允许模板 YAML 定义的自定义槽位（如 xianxia 的法宝槽）。
 * 旧别名 accessory1/accessory2 已废弃，通过 resolveSlotAlias 映射为 accessory。
 */
export type EquipmentSlot = 'main_hand' | 'off_hand' | 'head' | 'body' | 'hands' | 'feet' | 'accessory' | (string & {});

export interface ItemEffect {
  type: string;
  value: number;
  target?: string;
  duration?: number;
}

export interface ItemValue {
  buy?: number;
  sell?: number;
  currency?: string;
}

export interface ItemPoolEntry {
  id: string;
  save_id: ID;
  name: string;
  description: string;
  category: ItemCategory;
  quality: ItemQuality;
  stats: Record<string, number>;
  effects: ItemEffect[];
  value: ItemValue;
  tags: string[];
  weight: number;
  max_stack: number;
  equipped_slot: string | null;
  durability: number;
  max_durability: number;
  taken: boolean;
  custom_data: Record<string, unknown>;
  recommended_classes: string[];
}

export interface InventoryItem extends BaseEntity {
  save_id: ID;
  item_id: ID;
  pool_id: string;
  name: string;
  description: string;
  category: ItemCategory;
  quantity: number;
  quality: ItemQuality;
  durability: number;
  max_durability: number;
  inventory_slot: number | null;
  equipped_slot: EquipmentSlot | null;
  equipped: boolean;
  equipped_index: number | null;
  weight: number;
  max_stack: number;
  stats: Record<string, number>;
  effects: ItemEffect[];
  value: ItemValue;
  tags: string[];
  custom_data: Record<string, unknown>;
  visible: boolean;
  owner_type: 'character' | 'npc';
  owner_id: string;
}

export type SkillType = 
  | 'attack' 
  | 'defense' 
  | 'healing' 
  | 'buff' 
  | 'debuff' 
  | 'utility' 
  | 'passive';

export interface SkillCostEntry {
  type: 'mp' | 'hp' | 'stamina' | 'currency' | 'item' | 'mana';
  amount: number;
  itemId?: string;
  currencyId?: string;
}

/** 模板技能池条目（按 template_id 隔离） */
export interface TemplateSkillPoolEntry {
  id: string;
  templateId: string;
  name: string;
  description: string;
  category: string;
  element: string;
  icon: string;
  cost: SkillCostEntry[];
  damage: Record<string, unknown>;
  effects: Array<Record<string, unknown>>;
  cooldown: number;
  maxLevel: number;
  targetType: string;
  range: number;
  customData: Record<string, unknown>;
  recommendedClasses: string[];
  source: 'manual' | 'generated';
  createdAt: number;
  updatedAt: number;
}

/** 模板物品池条目（按 template_id 隔离） */
export interface TemplateItemPoolEntry {
  id: string;
  templateId: string;
  name: string;
  description: string;
  category: ItemCategory;
  quality: ItemQuality;
  icon: string;
  stats: Record<string, number>;
  effects: ItemEffect[];
  value: ItemValue;
  tags: string[];
  weight: number;
  maxStack: number;
  equippedSlot: string | null;
  durability: number;
  maxDurability: number;
  customData: Record<string, unknown>;
  recommendedClasses: string[];
  source: 'manual' | 'generated';
  createdAt: number;
  updatedAt: number;
}

export interface SkillPoolEntry {
  id: string;
  saveId: string;
  name: string;
  description: string;
  category: string;
  element: string;
  cost: SkillCostEntry[];
  damage: Record<string, unknown>;
  effects: Array<Record<string, unknown>>;
  cooldown: number;
  maxLevel: number;
  targetType: string;
  range: number;
  learned: boolean;
  customData: Record<string, unknown>;
  recommendedClasses: string[];
  /** 创建时间戳（13.2 时间戳兼容：供 SkillPoolEntityResolver 消歧使用） */
  createdAt?: number;
}

export interface SkillRequirements {
  level?: number;
  attributes?: Partial<Record<string, number>>;
  skills?: ID[];
}

export interface CharacterSkill extends BaseEntity {
  save_id: ID;
  skill_id: ID;
  name?: string;
  description?: string;
  level: number;
  maxLevel?: number;
  experience: number;
  cooldownRemaining?: number;
  category?: string;
  element?: string;
  cost?: SkillCostEntry[];
  effects?: Record<string, unknown>;
  unlocked: boolean;
  customData?: Record<string, unknown>;
  owner_type?: 'character' | 'npc';
  owner_id?: string;
}

export interface Quest extends BaseEntity {
  save_id: ID;
  name: string;
  type: QuestType;
  description: string;
  status: QuestStatus;
  visible: boolean;
  prerequisite_quest_ids: string[];
  conditions?: QuestConditions;
  giver_npc_id?: ID;
  giver_location_id?: ID;
  quest_chain_id?: ID;
  objectives: QuestObjective[];
  rewards: QuestReward;
  time_limit: number;
  custom_data?: Record<string, unknown>;
}

export type QuestType = 'main' | 'side' | 'daily' | 'weekly' | 'chain' | 'repeatable';

export type QuestStatus = 'locked' | 'available' | 'active' | 'completed' | 'failed';

export interface QuestObjective {
  id: ID;
  quest_id: ID;
  type: ObjectiveType;
  description: string;
  target: string;
  current: number;
  required: number;
  completed: boolean;
  event_trigger?: EventTrigger;
}

export interface QuestReward {
  experience?: number;
  gold?: number;
  currency?: Record<string, number>;
  items?: Array<{ itemId: string; itemName?: string; quantity: number }>;
  skills?: Array<{ skillId: string; skillName?: string }>;
}

export type ObjectiveType = 'kill' | 'collect' | 'talk' | 'explore' | 'use_item';

export interface QuestConditions {
  accept?: QuestCondition[];
  complete?: QuestCondition[];
}

export interface QuestCondition {
  type: 'level' | 'has_item' | 'quest_completed' | 'location_visited' | 'talk_to_npc';
  value: unknown;
  description?: string;
}

// === Advanced Condition System ===

/** Comparison operators for condition evaluation */
export type ConditionOperator = '>=' | '<=' | '>' | '<' | '==' | '!=';

/** Advanced condition types extending the basic QuestCondition */
export type AdvancedConditionType =
  | 'level' | 'has_item' | 'quest_completed' | 'location_visited' | 'talk_to_npc'
  | 'has_skill' | 'has_status_effect' | 'in_combat' | 'resource_above' | 'resource_below'
  | 'cooldown_ready' | 'location_is' | 'faction_above' | 'attribute_above' | 'chance';

/** A single atomic condition */
export interface AdvancedCondition {
  type: AdvancedConditionType;
  /** The target/key to check (item ID, skill ID, status effect name, resource type, etc.) */
  key?: string;
  /** Comparison operator for numeric comparisons */
  operator?: ConditionOperator;
  /** Value to compare against */
  value?: unknown;
  /** For chance type: probability 0-1 */
  probability?: number;
  /** Human-readable description */
  description?: string;
}

/** Composite condition with logical operators */
export interface CompositeCondition {
  /** Logical operator */
  operator: 'AND' | 'OR' | 'NOT';
  /** Child conditions (NOT has 1, AND/OR have 2+) */
  conditions: ConditionExpression[];
}

/** A condition expression is either atomic or composite */
export type ConditionExpression = AdvancedCondition | CompositeCondition;

/** Type guard: checks if a ConditionExpression is a CompositeCondition */
export function isCompositeCondition(expr: ConditionExpression): expr is CompositeCondition {
  return 'operator' in expr && ('AND' === expr.operator || 'OR' === expr.operator || 'NOT' === expr.operator);
}

export interface EventTrigger {
  eventType: 'kill' | 'collect' | 'talk' | 'explore' | 'use_item' | 'enter_location' | 'craft';
  targetId?: string;
  targetName?: string;
}

export interface NPC extends BaseEntity {
  save_id: ID;
  name: string;
  title?: string;
  role: string;
  race?: string;
  description?: string;
  location_id: ID;
  level?: number;
  mood?: string;
  in_party?: boolean;
  reputation?: number;
  visible?: boolean;
  dialogue: ID;
  relations: NPCRelation[];
  schedule?: NPCSchedule[];
  currency: Record<string, number>;
  attributes: Record<string, unknown>;
  derivedAttributes: Record<string, unknown>;
  currentHp: number | null;
  maxHp: number | null;
  currentMp: number | null;
  maxMp: number | null;
  customData?: Record<string, unknown>;
}

export interface NPCRelation {
  target_id: ID;
  relation_value: number;
  relation_type: 'friend' | 'neutral' | 'enemy';
}

export interface NPCSchedule {
  time: string;
  location_id: ID;
  activity: string;
}

export type GoalCategory = 'survival' | 'wealth' | 'power' | 'knowledge' | 'relationship' | 'duty' | 'creative' | 'freedom';

export interface NPCGoal {
  id: string;
  saveId: string;
  npcId: string;
  type: 'long_term' | 'mid_term';
  category: GoalCategory;
  description: string;
  priority: number;
  status: 'active' | 'completed' | 'abandoned' | 'blocked' | 'archived';
  relatedEntityIds: string[];
  progress: string;
  createdAt: number;
  updatedAt: number;
}

export interface DriveProfile {
  survival: number;
  social: number;
  ambition: number;
  knowledge: number;
  duty: number;
  creativity: number;
}

export type LocationLevel = 1 | 2 | 3;

export const LOCATION_LEVEL_LABELS: Record<LocationLevel, string> = {
  1: '地图',
  2: '区域',
  3: '子地点',
};

export interface Location extends BaseEntity {
  save_id: ID;
  name: string;
  description: string;
  type: string;
  terrain_type?: string;
  location_level: LocationLevel;
  parent_location_id?: string;
  x: number;
  y: number;
  discovered: boolean;
  items: ID[];
  events: ID[];
  danger_level?: number;
  visible?: boolean;
  is_explored?: boolean;
  customData?: Record<string, unknown>;
}

export interface Dialogue extends BaseEntity {
  save_id: ID;
  npc_id: ID;
  speaker: 'player' | 'npc';
  content: string;
  emotion?: string;
  timestamp: Timestamp;
}

export const GAME_EVENT_TYPES = [
  'combat:turn_start',
  'quest:update',
  'event:triggered',
  'agent_progress',
  'config:reloaded',
  'panel:update',
  'map:entity_move',
  'dev:staging_write',
  'dev:staging_commit',
  'dev:event_bus_publish',
  'dev:audit_decision',
  'dev:runtime_snapshot',
  'dev:graph_change',
  'dev:llm_debug',
  'pacing:tension_change',
  'pacing:stage_change',
  'pacing:review_alert',
  'generate_progress',
] as const;

export type GameEventType = typeof GAME_EVENT_TYPES[number];

// === WebSocket 消息协议类型 ===

/** WS 连接状态 */
export type WSConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/** 初始化状态机状态 */
export type InitState = 'idle' | 'requesting' | 'progressing' | 'done' | 'failed';

/** 客户端→服务端：认证 */
export interface WSAuth {
  type: 'auth';
  clientId: string;
  token?: string;
}

/** 服务端→客户端：认证结果 */
export interface WSAuthResult {
  type: 'auth_result';
  success: boolean;
  clientId?: string;
  error?: string;
}

/** 服务端→客户端：订阅确认 */
export interface WSSubscribed {
  type: 'subscribed';
  saveId: string;
}

/** 服务端→客户端：取消订阅确认 */
export interface WSUnsubscribed {
  type: 'unsubscribed';
}

/** 客户端→服务端：游戏请求（三层路由：module.action.intentHint） */
export interface WSGameRequest {
  type: 'game:request';
  requestId: string;
  module: string;
  action: string;
  intentHint?: string;
  payload: Record<string, unknown>;
  clientId: string;
}

/** 服务端→客户端：进度事件 */
export interface WSGameEvent {
  type: 'game:event';
  requestId: string;
  module: string;
  eventType: string;
  data: Record<string, unknown>;
  intentHint?: string;
  timestamp: number;
}

/** 服务端→客户端：最终结果 */
export interface WSGameResult {
  type: 'game:result';
  requestId: string;
  module: string;
  data: Record<string, unknown>;
  intentHint?: string;
}

/** 服务端→客户端：错误 */
export interface WSGameError {
  type: 'game:error';
  requestId: string;
  module: string;
  error: string;
  errorType?: string;
  recoverable: boolean;
}

// ── Payload 类型定义（按 action 分组） ──

/** game.initialize payload */
export interface GameInitializePayload {
  templateId: string;
  characterData: Record<string, unknown>;
  language?: string;
}

/** game.chat / game.*-LLM payload */
export interface GameChatPayload {
  message: string;
  saveId: string;
  data?: Record<string, unknown>;
  npcId?: string;
  targetNpcIds?: string[];
  playerAction?: Record<string, unknown>;
  context?: unknown;
  dataChanges?: unknown;
}

/** game.load payload */
export interface GameLoadPayload {
  saveId: string;
}

/** 客户端→服务端：订阅存档 */
export interface WSSubscribe {
  type: 'subscribe';
  saveId: string;
}

/** 客户端→服务端：取消订阅 */
export interface WSUnsubscribe {
  type: 'unsubscribe';
}

/** 心跳 */
export interface WSPing { type: 'ping'; timestamp: number; }
export interface WSPong { type: 'pong'; timestamp: number; }

/** WS 消息联合类型 */
export type WSMessage =
  | WSAuth | WSAuthResult | WSSubscribed | WSUnsubscribed
  | WSGameRequest | WSGameEvent | WSGameResult | WSGameError
  | WSSubscribe | WSUnsubscribe | WSPing | WSPong;

export interface StoryEvent extends BaseEntity {
  save_id: ID;
  chapter: number;
  event_type: string;
  title: string;
  description: string;
  impact: string;
  timestamp: Timestamp;
}

export function parseCostArray(raw: unknown): SkillCostEntry[] {
  if (Array.isArray(raw)) return raw as SkillCostEntry[];
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
}

export function getCostByType(cost: SkillCostEntry[], type: SkillCostEntry['type']): number {
  return cost.find(c => c.type === type)?.amount ?? 0;
}

export function templateCostToEntries(cost: Record<string, number | undefined>): SkillCostEntry[] {
  const entries: SkillCostEntry[] = [];
  if (cost.mp) entries.push({ type: 'mp', amount: cost.mp });
  if (cost.hp) entries.push({ type: 'hp', amount: cost.hp });
  if (cost.stamina) entries.push({ type: 'stamina', amount: cost.stamina });
  for (const [key, value] of Object.entries(cost)) {
    if (!['mp', 'hp', 'stamina'].includes(key) && typeof value === 'number' && value > 0) {
      entries.push({ type: key as SkillCostEntry['type'], amount: value });
    }
  }
  return entries;
}

// BusEvent data interfaces for frontend WS consumption

/** trigger_resolved BusEvent.data structure */
export interface TriggerResolvedData {
  triggerId: string;
  eventId: string;
  eventType?: string;
  effects?: Array<{ type: string; params: Record<string, unknown> }>;
  archivedStoryEvent?: {
    chapter: string | null;
    eventType: string;
    title: string;
    importance: string;
  };
}

/** story_progress BusEvent.data structure */
export interface StoryProgressData {
  chapter: string | null;
  mainQuest: string | null;
  delta?: { field: string; oldValue: unknown; newValue: unknown }[];
}

/** quest_update BusEvent.data structure */
export interface QuestUpdateData {
  questId: string;
  questName: string;
  oldStatus: string;
  newStatus: string;
}
