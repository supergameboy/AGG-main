import { apiClient } from './client';
import type { SnapshotType } from '../../../shared/src/types/api';
import type { SaveRestrictionType } from '../../../shared/src/types/template';

export interface SaveRecord {
  id: string;
  name: string;
  type: SaveRestrictionType;
  template_id: string | null;
  game_mode: string;
  chapter: string;
  location: string;
  level: number;
  main_quest: string;
  play_time: number;
  thumbnail: string;
  created_at: number;
  updated_at: number;
  description?: string;
  last_played_at?: number;
  current_snapshot_id?: string | null;
  snapshot_count?: number;
  language?: string;
  /** 阶段五新增：当前活跃挑战模式（与后端 SaveRecord.active_challenge_mode 对齐） */
  active_challenge_mode?: string | null;
}

export interface CompleteSaveData extends SaveRecord {
  character: {
    id: string;
    name: string;
    race?: string;
    raceName?: string;
    class?: string;
    className?: string;
    background?: string;
    backgroundName?: string;
    level: number;
    gold: number;
    currency?: Record<string, number>;
    attributes: Record<string, number>;
    attributeNames?: Record<string, string>;
    current_location_id: string;
  } | null;
  inventory: Array<{
    id: string;
    item_id: string;
    name: string;
    quantity: number;
    equipped: boolean;
    category?: string;
    quality?: number;
    durability?: number;
    max_durability?: number;
    equipped_slot?: string;
    weight?: number;
  }>;
  equipment: Array<Record<string, unknown>>;
  skills: Array<{
    id: string;
    skill_id: string;
    name: string;
    level: number;
  }>;
  game_state: Record<string, unknown>;
  quests?: any[];
  npcs?: any[];
  npc_relations?: any[];
  locations?: any[];
  location_connections?: any[];
  discovered_locations?: any[];
  dialogues?: Array<{
    id: string;
    saveId: string;
    npcId: string | null;
    speaker: string;
    content: string;
    emotion: string;
    messageType: string;
    timestamp: number;
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
  id: string;
  save_id: string;
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
  created_at: number;
}

export interface ListSavesParams {
  template_id?: string;
  game_mode?: string;
  type?: string;
  nameContains?: string;
  limit?: number;
  offset?: number;
}

export interface ListSavesResult {
  saves: SaveRecord[];
  total: number;
}

export interface ListSnapshotsParams {
  type?: SnapshotType;
}

export const saveApi = {
  list: async (params?: ListSavesParams): Promise<ListSavesResult> => {
    const query: Record<string, string> = {};
    if (params?.template_id) query.template_id = params.template_id;
    if (params?.game_mode) query.game_mode = params.game_mode;
    if (params?.type) query.type = params.type;
    if (params?.nameContains) query.nameContains = params.nameContains;
    if (params?.limit !== undefined) query.limit = String(params.limit);
    if (params?.offset !== undefined) query.offset = String(params.offset);
    const searchParams = new URLSearchParams(query).toString();
    const url = searchParams ? `/saves?${searchParams}` : '/saves';
    const result = await apiClient.get(url);
    // 后端返回 { saves, total }，拦截器已解包
    if (result && typeof result === 'object' && 'saves' in (result as unknown as Record<string, unknown>)) {
      return result as unknown as ListSavesResult;
    }
    // 兼容：如果返回的是数组（旧格式），包装为 ListSavesResult
    if (Array.isArray(result)) {
      return { saves: result as unknown as SaveRecord[], total: result.length };
    }
    return result as unknown as ListSavesResult;
  },

  getById: async (saveId: string): Promise<CompleteSaveData> => {
    return apiClient.get(`/saves/${saveId}`);
  },

  create: async (name: string, templateId?: string): Promise<SaveRecord> => {
    return apiClient.post('/saves', { name, template_id: templateId });
  },

  save: async (saveId: string): Promise<{ saved: boolean; saveId: string }> => {
    return apiClient.put(`/saves/${saveId}`);
  },

  updateMetadata: async (
    saveId: string,
    metadata: Partial<
      Pick<
        SaveRecord,
        'name' | 'chapter' | 'location' | 'main_quest' | 'thumbnail' | 'game_mode' | 'type'
      >
    >
  ): Promise<SaveRecord> => {
    return apiClient.patch(`/saves/${saveId}`, metadata);
  },

  delete: async (saveId: string): Promise<{ deleted: boolean; saveId: string }> => {
    return apiClient.delete(`/saves/${saveId}`);
  },

  copy: async (saveId: string, name?: string): Promise<SaveRecord> => {
    return apiClient.post(`/saves/${saveId}/copy`, name ? { name } : {});
  },

  autoSave: async (saveId: string): Promise<{ autoSaved: boolean; saveId: string; reason?: string }> => {
    return apiClient.post(`/saves/${saveId}/auto`);
  },

  exportSave: async (
    saveId: string
  ): Promise<{ version: string; exportedAt: number; save: unknown }> => {
    return apiClient.post(`/saves/${saveId}/export`);
  },

  importSave: async (data: unknown): Promise<{ imported: boolean; saveId: string }> => {
    return apiClient.post('/saves/import', { data });
  },

  createSnapshot: async (
    saveId: string,
    snapshotType?: SnapshotType,
    chapterName?: string
  ): Promise<SnapshotRecord> => {
    return apiClient.post(`/saves/${saveId}/snapshots`, {
      ...(chapterName ? { chapterName } : {}),
      ...(snapshotType ? { snapshotType } : {}),
    });
  },

  listSnapshots: async (saveId: string, params?: ListSnapshotsParams): Promise<SnapshotRecord[]> => {
    const query: Record<string, string> = {};
    if (params?.type) query.type = params.type;
    const searchParams = new URLSearchParams(query).toString();
    const url = searchParams ? `/saves/${saveId}/snapshots?${searchParams}` : `/saves/${saveId}/snapshots`;
    return apiClient.get(url);
  },

  getSnapshot: async (saveId: string, snapshotId: string): Promise<CompleteSaveData> => {
    return apiClient.get(`/saves/${saveId}/snapshots/${snapshotId}`);
  },

  restoreSnapshot: async (saveId: string, snapshotId: string): Promise<SaveRecord> => {
    return apiClient.post(`/saves/${saveId}/snapshots/${snapshotId}/restore`);
  },

  deleteSnapshot: async (saveId: string, snapshotId: string): Promise<{ success: boolean }> => {
    return apiClient.delete(`/saves/${saveId}/snapshots/${snapshotId}`);
  },

  translateSave: async (saveId: string, targetLanguage: string): Promise<{ success: boolean; saveId: string; sourceLanguage: string; targetLanguage: string }> => {
    return apiClient.post(`/saves/${saveId}/translate`, { targetLanguage });
  },
};
