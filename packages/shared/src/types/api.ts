import { ID, PaginatedResponse } from './core';
import { 
  Character, 
  InventoryItem, 
  CharacterSkill,
  Quest,
  NPC,
  Location,
  Dialogue
} from './game';
import { AgentType, Binding } from './agent';
import type { ProgressPhase, ProgressDetail } from './progress';

export type SnapshotType = 'auto' | 'manual' | 'checkpoint';

export const SNAPSHOT_TYPE = {
  AUTO: 'auto' as const,
  MANUAL: 'manual' as const,
  CHECKPOINT: 'checkpoint' as const,
};

export interface CreateSaveRequest {
  name: string;
  template_id: ID;
}

export interface SaveResponse {
  id: ID;
  name: string;
  template_id: ID;
  game_mode: string;
  chapter: number;
  created_at: number;
  updated_at: number;
}

export interface CreateCharacterRequest {
  save_id: ID;
  name: string;
  race: string;
  class: string;
  background: string;
  attributes: Record<string, number>;
}

export interface UpdateCharacterRequest {
  attributes?: Partial<Record<string, number>>;
  experience?: number;
  gold?: number;
}

export interface SendDialogueRequest {
  save_id: ID;
  npc_id: ID;
  message: string;
}

export interface DialogueResponse {
  dialogue: Dialogue;
  options: string[];
  emotion?: string;
}

export interface CombatActionRequest {
  save_id: ID;
  action: 'attack' | 'skill' | 'item' | 'defend' | 'flee';
  target?: ID;
  skill_id?: ID;
  item_id?: ID;
}

export interface CombatStateResponse {
  inCombat: boolean;
  turn: number;
  playerTurn: boolean;
  enemies: CombatEnemy[];
  playerHP: number;
  playerMP: number;
  log: string[];
}

export interface CombatEnemy {
  id: ID;
  name: string;
  hp: number;
  maxHP: number;
  mp: number;
  maxMP: number;
  status: string[];
}

export interface InventoryResponse extends PaginatedResponse<InventoryItem> {}

export interface AddItemRequest {
  save_id: ID;
  item_id: ID;
  quantity: number;
}

export interface UseItemRequest {
  save_id: ID;
  item_id: ID;
  target?: ID;
}

export interface SkillsResponse extends PaginatedResponse<CharacterSkill> {}

export interface UseSkillRequest {
  save_id: ID;
  skill_id: ID;
  target?: ID;
}

export interface EquipmentResponse {
  equipped: Partial<Record<string, InventoryItem>>;
}

export interface EquipItemRequest {
  save_id: ID;
  item_id: ID;
  slot: string;
}

export interface QuestsResponse extends PaginatedResponse<Quest> {}

export interface AcceptQuestRequest {
  save_id: ID;
  quest_id: ID;
}

export interface CompleteQuestRequest {
  save_id: ID;
  quest_id: ID;
}

export interface MapResponse {
  currentLocation: ID;
  locations: Location[];
  discoveredLocations: ID[];
}

export interface MoveRequest {
  save_id: ID;
  location_id: ID;
}

export interface NPCResponse {
  npc: NPC;
  relation: number;
}

export interface BindingsResponse extends PaginatedResponse<Binding> {}

export interface UpdateBindingRequest {
  enabled?: boolean;
  priority?: number;
  context_condition?: Record<string, unknown>;
}

export interface ToolsResponse {
  tools: Array<{
    type: string;
    status: 'ready' | 'busy' | 'error';
    lastUpdate: number;
  }>;
}

export interface TokenStatsResponse {
  total: number;
  byAgent: Partial<Record<AgentType, number>>;
  byModel: Record<string, number>;
  period: {
    start: number;
    end: number;
  };
}

export interface LogsResponse extends PaginatedResponse<{
  id: ID;
  level: string;
  source: string;
  message: string;
  timestamp: number;
}> {}

export interface GameInitRequest {
  save_id: ID;
  character: CreateCharacterRequest;
}

export interface GameInitResponse {
  success: boolean;
  character: Character;
  welcomeMessage: string;
  initialOptions: string[];
}

export interface LLMConfigRequest {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export interface LLMConfigResponse {
  provider: string;
  model: string;
  configured: boolean;
}

export interface SettingsResponse {
  language: string;
  theme: string;
  autoSave: boolean;
  autoSaveInterval: number;
  developerMode: boolean;
  aiRandomGeneration: boolean;
}

export interface UpdateSettingsRequest {
  language?: string;
  theme?: string;
  autoSave?: boolean;
  autoSaveInterval?: number;
  developerMode?: boolean;
  aiRandomGeneration?: boolean;
}

export interface TemplateResponse {
  id: ID;
  name: string;
  description: string;
  version: string;
  author: string;
  tags: string[];
  game_mode: string;
  world_setting: Record<string, unknown>;
  character_creation: Record<string, unknown>;
  game_rules: Record<string, unknown>;
  ai_constraints: Record<string, unknown>;
  starting_scene: Record<string, unknown>;
  initial_data: Record<string, unknown>;
  ui_theme: Record<string, unknown>;
  ui_layout: Record<string, unknown>;
  numerical_complexity: string;
  special_rules: Record<string, unknown>;
  agent_profile?: string;
  is_builtin: boolean;
  created_at: number;
  updated_at: number;
}

export interface TemplatesResponse extends PaginatedResponse<TemplateResponse> {}

export interface CreateTemplateRequest {
  name: string;
  description: string;
  game_mode: string;
  world_setting: Record<string, unknown>;
  character_creation: Record<string, unknown>;
  game_rules: Record<string, unknown>;
  ai_constraints: Record<string, unknown>;
  starting_scene: Record<string, unknown>;
  initial_data: Record<string, unknown>;
}

export interface WebSocketEvents {
  'combat:turn_start': {
    save_id: ID;
    turn: number;
    playerTurn: boolean;
  };
  'quest:update': {
    save_id: ID;
    quest: Quest;
  };
  'event:triggered': {
    save_id: ID;
    event: Record<string, unknown>;
  };
  'agent_progress': {
    save_id?: ID;
    phase: ProgressPhase;
    agentType: string;
    agentRunId: string;
    taskDescription: string;
    parentTask: string | null;
    detail?: ProgressDetail;
    timestamp: number;
  };
}
