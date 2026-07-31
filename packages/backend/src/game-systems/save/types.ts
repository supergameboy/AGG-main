import type { Knex } from 'knex';
import type { ID, Timestamp } from '../../../../shared/src/types/core.js';
import type { SnapshotType } from '../../../../shared/src/types/api.js';
import type { SaveRestrictionType } from '../../../../shared/src/types/template.js';

// === 业务类型（从 services/save.ts 迁移，供 ISaveProvider 和消费方使用） ===

export interface SaveRecord {
  id: ID;
  name: string;
  type: SaveRestrictionType;
  template_id: ID;
  game_mode: string;
  chapter: string;
  location: string;
  level: number;
  main_quest: string;
  play_time: number;
  thumbnail: string;
  language: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  description?: string;
  last_played_at?: Timestamp;
  playtime?: number;
  current_snapshot_id?: ID | null;
  snapshot_count?: number;
  /**
   * 当前存档激活的挑战模式（DF-007 修复：跨请求持久化）。
   * - nullable：未进入挑战时为 null
   * - 进入挑战时写入 ChallengeMode 值（如 'turn_based_combat'）
   * - 三层覆盖优先级：玩家选择 > GM 覆盖 > 模板默认
   */
  active_challenge_mode?: string | null;
}

export interface CompleteSaveData extends SaveRecord {
  character?: Record<string, unknown>;
  inventory?: unknown[];
  item_pool?: unknown[];
  skill_pool?: unknown[];
  skills?: unknown[];
  contexts?: Record<string, unknown>;
  game_state?: Record<string, unknown>;
  quests?: unknown[];
  npcs?: unknown[];
  // 模块2 简化：删除 npc_relations 字段（npc_relations 表已删除）
  locations?: unknown[];
  location_connections?: unknown[];
  discovered_locations?: unknown[];
  dialogues?: Array<{
    id: ID;
    saveId: ID;
    npcId: ID | null;
    speaker: string;
    content: string;
    emotion: string;
    messageType: string;
    timestamp: Timestamp;
  }>;
  gameTime?: {
    totalMinutes: number;
    day: number;
    hour: number;
    minute: number;
    periodOfDay: string;
    season: string;
  };
}

export interface SnapshotRecord {
  id: ID;
  save_id: ID;
  name: string;
  type: SnapshotType;
  game_mode: string;
  chapter: string;
  location: string;
  level: number;
  main_quest: string;
  play_time: number;
  thumbnail: string;
  description?: string;
  snapshot_data: string;
  created_at: Timestamp;
}

export interface SnapshotQueryOptions {
  type?: SnapshotType;
}

export interface AutoSaveOptions {
  interval?: number;
  maxSnapshots?: number;
  triggerReason?: string;
}

export interface SaveQueryOptions {
  templateId?: string;
  gameMode?: string;
  type?: string;
  nameContains?: string;
  limit?: number;
  offset?: number;
}

export interface SaveUpdateData {
  name?: string;
  description?: string;
  chapter?: string;
  location?: string;
  main_quest?: string;
  thumbnail?: string;
  game_mode?: string;
  type?: SaveRestrictionType;
}

export interface SaveRestrictionResult {
  allowed: boolean;
  reason?: string;
  maxAutoSnapshots?: number;
  maxManualSnapshots?: number;
}

// === SaveRow（saves 表完整 schema，16 字段） ===

export interface SaveRow {
  id: string;
  name: string;
  type: string;
  template_id: string | null;
  game_mode: string;
  chapter: string | null;
  location: string | null;
  level: number;
  main_quest: string | null;
  play_time: number;
  thumbnail: string;
  created_at: number;
  updated_at: number;
  last_played_at: number | null;
  current_snapshot_id: string | null;
  snapshot_count: number;
  language: string;
  /** DF-007: 跨请求持久化挑战模式（GM 覆盖） */
  active_challenge_mode?: string | null;
}

export interface SaveListOptions {
  templateId?: string;
  gameMode?: string;
  type?: string;
  nameContains?: string;
  limit?: number;
  offset?: number;
}

// === ISaveRepository（saves 表，16 方法：7 已有 + 9 新增） ===

export interface ISaveRepository {
  // 已有（7 方法）
  getTemplateIdBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<string | null>;
  getChapterBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<string | null>;
  getStoryContext(saveId: ID, trx?: Knex.Transaction): Promise<{ chapter: string | null; mainQuest: string | null } | null>;
  updateStoryState(saveId: ID, chapter: string, mainQuest: string, trx?: Knex.Transaction): Promise<void>;
  getMainQuestBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<string | null>;
  getSaveContextInfo(saveId: ID, trx?: Knex.Transaction): Promise<{ chapter: string | null; location: string | null; mainQuest: string | null; level: number | null } | null>;
  deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void>;

  // 新增（9 方法）
  insert(data: SaveRow, trx?: Knex.Transaction): Promise<void>;
  findById(saveId: ID, trx?: Knex.Transaction): Promise<SaveRecord | null>;
  list(options?: SaveListOptions, trx?: Knex.Transaction): Promise<{ rows: SaveRecord[]; total: number }>;
  getLanguage(saveId: ID, trx?: Knex.Transaction): Promise<string | undefined>;
  updateLanguage(saveId: ID, language: string, trx?: Knex.Transaction): Promise<void>;
  updatePlayTime(saveId: ID, updatedAt: number, lastPlayedAt: number, playTimeIncrement?: number, trx?: Knex.Transaction): Promise<void>;
  updateSnapshot(saveId: ID, snapshotId: string | null, snapshotCountDelta: number, trx?: Knex.Transaction): Promise<void>;
  updateFields(saveId: ID, updates: Partial<SaveRow>, trx?: Knex.Transaction): Promise<void>;
  countByTemplateId(templateId: string, trx?: Knex.Transaction): Promise<number>;
}

// === SaveState（save_game_state 表） ===

export interface SaveStateRow {
  id: string;
  save_id: string;
  data_type: string;
  data_key: string;
  data_value: string;
  updated_at: number;
}

export interface ISaveStateRepository {
  findBySaveIdAndTypeAndKey(saveId: ID, dataType: string, dataKey: string, trx?: Knex.Transaction): Promise<SaveStateRow | null>;
  findBySaveIdAndType(saveId: ID, dataType: string, trx?: Knex.Transaction): Promise<SaveStateRow[]>;
  upsert(saveId: ID, dataType: string, dataKey: string, dataValue: string, trx?: Knex.Transaction): Promise<void>;
  deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void>;

  // S5 新增
  findBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<SaveStateRow[]>;
}

// === SaveSnapshot（save_snapshots 表） ===

export interface SaveSnapshotRow {
  id: string;
  save_id: string;
  name: string | null;
  type: string;
  game_mode: string | null;
  chapter: string | null;
  location: string | null;
  level: number | null;
  main_quest: string | null;
  play_time: number | null;
  thumbnail: string | null;
  description: string | null;
  snapshot_data: string;
  created_at: number;
}

export interface SaveSnapshotQueryOptions {
  type?: string;
}

export interface ISaveSnapshotRepository {
  insert(data: SaveSnapshotRow, trx?: Knex.Transaction): Promise<void>;
  findById(snapshotId: ID, trx?: Knex.Transaction): Promise<SaveSnapshotRow | null>;
  findBySaveId(saveId: ID, options?: SaveSnapshotQueryOptions, trx?: Knex.Transaction): Promise<SaveSnapshotRow[]>;
  findBySaveIdAndType(saveId: ID, type: string, trx?: Knex.Transaction): Promise<SaveSnapshotRow[]>;
  countBySaveIdAndType(saveId: ID, type: string, trx?: Knex.Transaction): Promise<number>;
  deleteById(snapshotId: ID, trx?: Knex.Transaction): Promise<void>;
  findLatestBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<SaveSnapshotRow | null>;
  deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void>;
}

// === SaveGameTime（save_game_time 表） ===

export interface SaveGameTimeRow {
  id: string;
  save_id: string;
  total_minutes: number;
  day_number: number;
  last_action: string;
  last_action_at: number;
  custom_data: string;
  updated_at: number;
}

export interface ISaveGameTimeRepository {
  findBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<SaveGameTimeRow | null>;
  upsert(data: SaveGameTimeRow, trx?: Knex.Transaction): Promise<void>;
  deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void>;
  update(saveId: ID, updates: Partial<SaveGameTimeRow>, trx?: Knex.Transaction): Promise<void>;
}

// === SaveDataPort（跨领域 19 表聚合端口） ===

export interface SaveDataBundle {
  characters: Record<string, unknown>[];
  inventory: Record<string, unknown>[];
  item_pool: Record<string, unknown>[];
  skill_pool: Record<string, unknown>[];
  character_skills: Record<string, unknown>[];
  quests: Record<string, unknown>[];
  quest_objectives: Record<string, unknown>[];
  npcs: Record<string, unknown>[];
  npc_goals: Record<string, unknown>[];
  // 模块2 简化：删除 npc_relations 字段（npc_relations 表已删除）
  locations: Record<string, unknown>[];
  location_connections: Record<string, unknown>[];
  discovered_locations: Record<string, unknown>[];
  dialogues: Record<string, unknown>[];
  agent_contexts: Record<string, unknown>[];
  decision_logs: Record<string, unknown>[];
  agent_schedules: Record<string, unknown>[];
  save_data_indexes: Record<string, unknown>[];
  save_write_logs: Record<string, unknown>[];
}

export interface ISaveDataPort {
  loadAllSaveData(saveId: ID, trx?: Knex.Transaction): Promise<SaveDataBundle>;
  deleteAllSaveData(saveId: ID, trx?: Knex.Transaction): Promise<void>;
  copyAllSaveData(sourceSaveId: ID, newSaveId: ID, trx?: Knex.Transaction): Promise<void>;
  restoreAllSaveData(saveId: ID, data: SaveDataBundle, trx?: Knex.Transaction): Promise<void>;
  getTemplateCharacterCreation(templateId: ID, trx?: Knex.Transaction): Promise<Record<string, unknown> | null>;
  hasCheckpointContext(saveId: ID, trx?: Knex.Transaction): Promise<boolean>;
}

// === ISaveProvider（SaveService 端口接口，20 方法） ===

export interface ISaveProvider {
  loadSave(saveId: ID): Promise<CompleteSaveData>;
  createSave(name: string, templateId?: ID, gameMode?: string, restrictionType?: SaveRestrictionType): Promise<SaveRecord>;
  autoSave(saveId: ID): Promise<{ saved: boolean; reason?: string }>;
  createSnapshot(saveId: ID, snapshotType?: SnapshotType, chapterName?: string): Promise<SnapshotRecord>;
  restoreSnapshot(snapshotId: ID): Promise<SaveRecord>;
  getSnapshots(saveId: ID, options?: SnapshotQueryOptions): Promise<SnapshotRecord[]>;
  loadSnapshot(snapshotId: ID): Promise<CompleteSaveData>;
  deleteSnapshot(saveId: ID, snapshotId: ID): Promise<{ success: boolean }>;
  deleteSave(saveId: ID): Promise<void>;
  saveSave(saveId: ID): Promise<void>;
  listSaves(options?: SaveQueryOptions): Promise<{ saves: SaveRecord[]; total: number }>;
  getSave(saveId: ID): Promise<SaveRecord | null>;
  updateSave(saveId: ID, updates: SaveUpdateData): Promise<SaveRecord>;
  copySave(sourceSaveId: ID, newName?: string): Promise<SaveRecord>;
  exportSave(saveId: ID): Promise<Record<string, unknown>>;
  importSave(data: unknown): Promise<ID>;
  getSaveLanguage(saveId: ID): Promise<string | undefined>;
  updateSaveLanguage(saveId: ID, language: string): Promise<void>;
  getSaveTemplateId(saveId: ID): Promise<string | undefined>;
  checkSaveRestriction(saveId: ID, action: 'create' | 'update' | 'delete' | 'auto' | 'manual'): Promise<SaveRestrictionResult>;
  enhanceAutoSave(saveId: ID, options?: AutoSaveOptions): Promise<void>;
}
