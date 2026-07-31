import type { SkillCostEntry } from '@ai-rpg/shared';
export type { SkillCostEntry };

export type {
  ID,
  Timestamp,
  JSONValue,
  BaseEntity,
  PaginationParams,
  PaginatedResponse,
  APIResponse,
} from '@ai-rpg/shared';

export type {
  Character,
  CharacterAttributes,
  DerivedAttributes,
  Gender,
  AgeGroup,
  AgeMode,
  AgeNumberConfig,
  ItemCategory,
  ItemQuality,
  ItemEffect,
  ItemValue,
  ItemPoolEntry,
  TemplateSkillPoolEntry,
  TemplateItemPoolEntry,
  SkillPoolEntry,
  EquipmentSlot,
  SkillType,
  SkillRequirements,
  CharacterSkill,
  Quest,
  QuestType,
  QuestStatus,
  QuestObjective,
  QuestReward,
  ObjectiveType,
  QuestConditions,
  EventTrigger,
  NPC,
  NPCRelation,
  NPCSchedule,
  NPCGoal,
  GoalCategory,
  DriveProfile,
  Location,
  LocationLevel,
  Dialogue,
  StoryEvent,
} from '@ai-rpg/shared';

export type {
  AgentType,
  ToolType,
  AgentMessage,
  AgentContext,
  LLMMessage,
  ToolCall,
  ToolResult,
  AgentSchedule,
  Binding,
  WriteOperation,
  DecisionLog,
} from '@ai-rpg/shared';

export type {
  CreateSaveRequest,
  SaveResponse,
  CreateCharacterRequest,
  UpdateCharacterRequest,
  SendDialogueRequest,
  DialogueResponse,
  CombatActionRequest,
  CombatStateResponse,
  CombatEnemy,
  InventoryResponse,
  AddItemRequest,
  UseItemRequest,
  SkillsResponse,
  UseSkillRequest,
  EquipmentResponse,
  EquipItemRequest,
  QuestsResponse,
  AcceptQuestRequest,
  CompleteQuestRequest,
  MapResponse,
  MoveRequest,
  NPCResponse,
  BindingsResponse,
  UpdateBindingRequest,
  ToolsResponse,
  TokenStatsResponse,
  LogsResponse,
  GameInitRequest,
  GameInitResponse,
  LLMConfigRequest,
  LLMConfigResponse,
  SettingsResponse,
  UpdateSettingsRequest,
  TemplateResponse,
  TemplatesResponse,
  CreateTemplateRequest,
  WebSocketEvents,
} from '@ai-rpg/shared';

export type {
  GameMode,
  NumericalComplexity,
  WorldSetting,
  RaceDefinition,
  ClassDefinition,
  BackgroundDefinition,
  AgeGroupDefinition,
  AttributeDefinition,
  CustomOption,
  CharacterCreationRules,
  CombatRuleSet,
  SkillRuleSet,
  InventoryRuleSet,
  EquipmentSlotDefinition,
  QuestRuleSet,
  CustomRule,
  GameRules,
  AIBehavior,
  AIConstraints,
  NPCStats,
  NPCDefinition,
  TemplateSkillCost,
  TemplateSkillDamage,
  TemplateSkillEffect,
  SkillScalingEntry,
  SkillDefinition,
  ItemDefinition,
  TemplateQuestObjective,
  TemplateQuestReward,
  QuestDefinition,
  ExplorableArea,
  StartingScene,
  InitialDataConfig,
  GradientColors,
  UITheme,
  UILayout,
  SpecialRules,
  SaveRestrictionType,
  FailConditionType,
  StoryTemplate,
  AgentProfile,
  AgentConfig,
  AgentCapabilityConfig,
  PermissionConfig,
  AgentPermissionConfig,
  ValidationResult,
  ChallengeMode,
} from '@ai-rpg/shared';

export {
  GAME_EVENT_TYPES,
  DEFAULT_ATTRIBUTE_DEFINITIONS,
  DEFAULT_EQUIPMENT_SLOTS,
  createDefaultTemplate,
  generateId,
  FAIL_CONDITION_TYPES,
  GENDER_LABELS,
  DEFAULT_AGE_GROUP_LABELS,
  LOCATION_LEVEL_LABELS,
  parseScaling,
} from '@ai-rpg/shared';



export type {
  GameResponse,
  GameResponseMeta,
  DialogueOption,
  PanelUpdates,
  CharacterUpdate,
  InventoryUpdate,
  InventoryItemData,
  QuestUpdate,
  QuestData,
  QuestObjectiveData,
  LocationUpdate,
  LocationPanelData,
  LocationConnectionData,
  /** @deprecated Use LocationUpdate */
  MapUpdate,
  /** @deprecated Use LocationPanelData */
  MapLocationData,
  /** @deprecated Use LocationConnectionData */
  MapConnectionData,
  CombatUpdate,
  CombatEnemyData,
  SkillsUpdate,
  SkillData,
  NPCUpdate,
  NPCData,
  NPCInventoryItem,
  NPCSkill,
  UIInteractionType,
  UIInteractionData,
  UIParsedNode,
} from '@ai-rpg/shared';

export type {
  ProviderType,
  ApiFormat,
  ApiKeyEntry,
  ModelProvider,
  ModelConfigDefaults,
  ProviderPreset,
} from '@ai-rpg/shared';

import type { Character as CharacterType } from '@ai-rpg/shared';
import type { GameEventType as GameEventTypeBase } from '@ai-rpg/shared';
import type { ItemCategory as ItemCategoryBase, ItemQuality as ItemQualityBase, ItemEffect as ItemEffectBase, ItemValue as ItemValueBase, EquipmentSlot as EquipmentSlotBase } from '@ai-rpg/shared';
import type { ChallengeMode } from '@ai-rpg/shared';

export type ThemeMode = 'light' | 'dark' | 'system';

export type GameEventType = GameEventTypeBase;

export interface GameEvent<T = unknown> {
  type: GameEventType;
  payload: T;
  timestamp: number;
}

export interface Scene {
  id: string;
  name: string;
  description: string;
  location?: string;
  npcs?: string[];
  availableActions?: string[];
}

export interface PlayerState {
  character: CharacterType;
  currentLocation: string;
  statusEffects: string[];
}

export type PanelType =
  | 'character'
  | 'skills'
  | 'equipment'
  | 'inventory'
  | 'quests'
  | 'npc'
  | 'party'
  | 'log'
  | 'map'
  | 'combat'
  | 'devtools';

export type ModalType =
  | 'settings'
  | 'help'
  | 'item-detail'
  | 'quest-detail'
  | 'npc-dialogue'
  | 'combat'
  | null;

export type FrontendSkillType = 'attack' | 'defense' | 'healing' | 'buff' | 'debuff' | 'utility' | 'passive';

export interface FrontendInventoryItem {
  id: string;
  saveId: string;
  itemId: string;
  poolId: string;
  name: string;
  description: string;
  category: ItemCategoryBase;
  quantity: number;
  quality: ItemQualityBase;
  durability: number;
  maxDurability: number;
  inventorySlot: number | null;
  equippedSlot: EquipmentSlotBase | null;
  equippedIndex: number | null;
  equipped: boolean;
  weight: number;
  maxStack: number;
  stats: Record<string, number>;
  effects: ItemEffectBase[];
  value: ItemValueBase;
  tags: string[];
  customData: Record<string, unknown>;
  visible: boolean;
  ownerType: 'character' | 'npc';
  ownerId: string;
}

export interface FrontendCharacterSkill {
  id: string;
  skill_id: string;
  name: string;
  type: string;
  description?: string;
  level: number;
  maxLevel?: number;
  experience?: number;
  cost?: SkillCostEntry[];
  cooldown?: number;
  unlocked: boolean;
  element?: string;
  effects?: Record<string, unknown>;
  customData?: Record<string, unknown>;
  /** 实体归属类型，与 FrontendInventoryItem 对称 */
  ownerType: 'character' | 'npc';
  /** 实体归属 ID（character ID 或 NPC ID） */
  ownerId: string;
  /** 是否在前端可见（默认 true） */
  visible?: boolean;
}

export interface NPCVisibility {
  attributes: 'hidden' | 'vague' | 'visible';
  hpMp: 'hidden' | 'bar_only' | 'visible';
  equipment: 'hidden' | 'outline' | 'visible';
  inventory: 'hidden' | 'count_only' | 'visible';
  skills: 'hidden' | 'category' | 'visible';
}

export interface FrontendNPCInfo {
  id: string;
  name: string;
  role?: string;
  location?: string;
  locationId?: string;
  inParty?: boolean;
  affinity?: number;
  relation?: string;
  dialogue?: string;
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
  driveProfile?: import('@ai-rpg/shared').DriveProfile;
  goals?: import('@ai-rpg/shared').NPCGoal[];
  inventory?: import('@ai-rpg/shared').NPCInventoryItem[];
  skills?: import('@ai-rpg/shared').NPCSkill[];
  customData?: Record<string, unknown>;
  visible: boolean;
  attrInitialized: boolean;
  invInitialized: boolean;
  skillInitialized: boolean;
  visibility?: NPCVisibility;
}

export interface FrontendCombatEnemy {
  id: string;
  name: string;
  hp: number;
  maxHP: number;
  mp?: number;
  maxMP?: number;
  level?: number;
  status?: string[];
  isTargeted?: boolean;
}

export interface FrontendCombatLog {
  turn: number;
  message: string;
  type?: 'damage' | 'heal' | 'buff' | 'debuff' | 'info';
}

export interface FrontendCombatState {
  active: boolean;
  enemies: FrontendCombatEnemy[];
  playerHP: number;
  playerMaxHP: number;
  playerMP?: number;
  playerMaxMP?: number;
  currentTurn: number;
  isPlayerTurn: boolean;
  log: FrontendCombatLog[];
  availableActions: string[];
  /** 阶段五新增：当前挑战模式（narrative_combat / turn_based_combat / dynamic_combat / puzzle / mini_game / stealth）；非挑战状态为 null */
  challengeMode?: ChallengeMode | null;
}

export interface FrontendLocation {
  id: string;
  name: string;
  description?: string;
  type?: string;
  parentLocationId?: string;
  locationLevel?: import('@ai-rpg/shared').LocationLevel;
  x?: number;
  y?: number;
  discovered?: boolean;
  current?: boolean;
  dangerLevel?: number;
  customData?: Record<string, unknown>;
}

/** @deprecated Use FrontendLocation */
export type FrontendMapLocation = FrontendLocation;

export interface FrontendLocationConnection {
  from: string;
  to: string;
  direction?: string;
  connectionType?: string;
  distance?: number;
  travelTime?: number;
}

/** @deprecated Use FrontendLocationConnection */
export type FrontendMapConnection = FrontendLocationConnection;

export interface FrontendLocationState {
  locations: FrontendLocation[];
  connections: FrontendLocationConnection[];
  currentLocationId: string | null;
  discoveredLocationIds: string[];
  selectedMapId?: string | null;
  viewMode?: 'world' | 'region';
}

/** @deprecated Use FrontendLocationState */
export type FrontendMapState = FrontendLocationState;
