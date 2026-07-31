import type { Knex } from 'knex';
import { ID } from '../../../../shared/src/types/core.js';
import type { CharacterCreationRules } from '../../../../shared/src/types/template.js';
import type { PanelUpdates } from '../../../../shared/src/types/dynamic-ui.js';
import type { Gender, AgeGroup } from '../../../../shared/src/types/game.js';

export type { CharacterCreationRules };

export interface InitStepResult {
  step: number;
  stepName: string;
  success: boolean;
  durationMs: number;
  data?: Record<string, unknown>;
  error?: string;
}

export interface DialogueOption {
  id: string;
  text: string;
  npcId: string;
}

export interface FullInitResult {
  saveId: ID;
  templateId: string | null;
  steps: InitStepResult[];
  totalDurationMs: number;
  success: boolean;
  characterData?: Record<string, unknown>;
  startingScene?: Record<string, unknown>;
  uiDirective?: string;
  panelUpdates?: PanelUpdates;
  dialogueOptions?: DialogueOption[];
  uiTheme?: Record<string, unknown>;
  uiLayout?: Record<string, unknown>;
  gameRules?: Record<string, unknown>;
  aiConstraints?: Record<string, unknown>;
  worldSetting?: Record<string, unknown>;
  specialRules?: Record<string, unknown>;
  numericalComplexity?: string;
}

export interface FullInitOptions {
  /** When true, skip Step 8 (generate_intro) and Step 9 (generate_welcome_ui).
   *  These steps will be handled by GameMasterAgent scheduling DialogueAgent and UIAgent instead.
   *  Default: false (execute all steps including 8-9)
   */
  skipAgentSteps?: boolean;
}

export interface CharacterInputData {
  name: string;
  gender: Gender;
  customGender?: string;
  ageGroup?: AgeGroup;
  race: string;
  classType: string;
  background: string;
  attributes: Record<string, number>;
  customOptions?: Record<string, string | number | boolean>;
}

export interface GameInitInput {
  saveId: ID;
  templateId?: string;
  characterData: CharacterInputData;
  language?: string;
}

export interface TemplateInitialData {
  skills?: Record<string, string[]>;
  items_by_class?: Record<string, Array<{ item_id: string; quantity: number }>>;
  items_by_background?: Record<string, Array<{ item_id: string; quantity: number }>>;
  equipment?: Record<string, Record<string, string>>;
  gold?: Record<string, number>;
  npc_templates?: Array<{
    template_npc_id: string;
    location?: string;
    overrides?: Record<string, unknown>;
  }>;
}

export interface TemplateNPCDef {
  id?: string;
  name: string;
  title?: string;
  description?: string;
  role?: string;
  race?: string;
  location?: string;
  default_location?: string;
  level?: number;
  stats?: {
    level?: number;
    attributes?: Record<string, number>;
    [key: string]: unknown;
  };
  attributes?: Record<string, unknown>;
  services?: Array<{ type: string; name: string }>;
  appearance?: string;
  personality?: string;
  dialogue?: string | string[];
  custom_data?: Record<string, unknown>;
  visible?: boolean;
  currency?: Record<string, number>;
}

export interface TemplateStartingScene {
  location?: string;
  description?: string;
  location_description?: string;
  atmosphere?: string;
  time_of_day?: string;
  sub_locations?: TemplateSubLocation[];
  terrain_type?: string;
  npcs?: TemplateNPCDef[];
  items?: Array<{
    item_id: string;
    name?: string;
    quantity?: number;
  }>;
  quests?: Array<{
    id: string;
    name: string;
    description: string;
    type?: string;
    objectives?: Array<{
      id?: string;
      description: string;
      type?: string;
      target?: string;
      required?: number;
    }>;
  }>;
  explorable_areas?: Array<{
    id: string;
    name: string;
    description: string;
    type: string;
    danger_level?: number;
    sub_locations?: TemplateSubLocation[];
    connections?: string[];
  }>;
  events?: Array<{
    id?: string;
    name: string;
    description?: string;
    type: string;
    trigger_type: string;
    trigger_data?: Record<string, unknown>;
    effects?: unknown[];
    priority?: number;
    repeatable?: boolean;
    cooldown?: number;
    custom_data?: Record<string, unknown>;
  }>;
}

export interface TemplateSubLocation {
  id: string;
  name: string;
  description: string;
  type: string;
  danger_level?: number;
  is_starting?: boolean;
  services?: Array<{ type: string; name: string }>;
  connections?: string[];
}

export interface TemplateItemDefinition {
  id?: string;
  name?: string;
  description?: string;
  category?: string;
  quality?: string;
  stats?: Record<string, number>;
  effects?: string[];
  value?: Record<string, unknown>;
  custom_data?: Record<string, unknown>;
}

export interface TemplateSkillDefinition {
  id: string;
  name: string;
  description?: string;
  category?: string;
  element?: string;
  target_type?: string;
  cost?: Record<string, number>;
  damage?: Record<string, unknown>;
  effects?: Array<Record<string, unknown>>;
  cooldown?: number;
  range?: number;
  max_level?: number;
  icon?: string;
  custom_data?: Record<string, unknown>;
}

export interface TemplateLocationDefinition {
  id: string;
  name: string;
  description?: string;
  type?: string;
  level?: number;
  terrain_type?: string;
  danger_level?: number;
  connections?: string[];
  sub_locations?: TemplateLocationDefinition[];
  custom_data?: Record<string, unknown>;
}

export interface TemplateData {
  id: string;
  name: string;
  game_mode?: string;
  initial_data: TemplateInitialData;
  character_creation: Partial<CharacterCreationRules>;
  starting_scene: TemplateStartingScene;
  world_setting: Record<string, unknown>;
  items?: TemplateItemDefinition[];
  skills?: TemplateSkillDefinition[];
  locations?: TemplateLocationDefinition[];
  game_rules?: Record<string, unknown>;
  ai_constraints?: Record<string, unknown>;
  ui_theme?: Record<string, unknown>;
  ui_layout?: Record<string, unknown>;
  special_rules?: Record<string, unknown>;
  numerical_complexity?: string;
}

export interface IntroData {
  title: string;
  content: string;
  atmosphere: string;
}

export interface WelcomeUIData {
  characterPanel: Record<string, unknown>;
  currentTime: Record<string, unknown>;
  locationInfo: Record<string, unknown>;
  availableActions: string[];
}

// === S4 新增：Service 端口接口 ===

/**
 * GameInit 领域初始化状态（跨领域只读查询所需的最小字段集）。
 * 用于 GM 查询存档初始化完整度。
 */
export interface InitializationStatus {
  characters: number;
  locations: number;
  npcs: number;
  skills: number;
  items: number;
  quests: number;
  isComplete: boolean;
}

/**
 * GameInit 领域 Service 端口接口。
 * GameInit 是纯编排领域，跨 7 表做 count 检查和简单 update。
 *
 * 修订记录（2026-07-09）：原设计接口签名与实际实现不匹配，已更新为匹配实际方法签名。
 * - getInitializationStatus 返回完整初始化状态（含 isInitialized/character/counts/missing）
 * - step1_initStats 参数为 (saveId, characterData, templateData)，非 (saveId, templateId)
 */
export interface IGameInitService {
  getInitializationStatus(saveId: ID): Promise<{
    isInitialized: boolean;
    character: boolean;
    counts: {
      locations: number;
      npcs: number;
      skills: number;
      items: number;
      quests: number;
    };
    missing: string[];
  }>;
  step1_initStats(
    saveId: ID,
    characterData: CharacterInputData,
    templateData: TemplateData,
    trx?: Knex.Transaction,
  ): Promise<Record<string, unknown>>;
}
