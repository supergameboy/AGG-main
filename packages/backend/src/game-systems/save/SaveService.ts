import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import { ID, Timestamp, generateReadableId } from '../../../../shared/src/types/core.js';
import { SnapshotType, SNAPSHOT_TYPE } from '../../../../shared/src/types/api.js';
import { SaveRestrictionType, SAVE_RESTRICTION_TYPE } from '../../../../shared/src/types/template.js';
import type { ITransactionManager } from '../../database/TransactionManager.js';
import type {
  ISaveRepository,
  ISaveSnapshotRepository,
  ISaveStateRepository,
  ISaveGameTimeRepository,
  ISaveDataPort,
  ISaveProvider,
  SaveRecord,
  CompleteSaveData,
  SnapshotRecord,
  SnapshotQueryOptions,
  AutoSaveOptions,
  SaveQueryOptions,
  SaveUpdateData,
  SaveRestrictionResult,
  SaveRow,
  SaveSnapshotRow,
  SaveDataBundle,
} from './types.js';

/**
 * SaveService：存档领域 Service，实现 ISaveProvider 端口接口（20 方法）。
 *
 * 设计依据（§四 B5）：
 * - 从 services/save.ts 迁移到 game-systems/save/SaveService.ts（L0-3 方案A，无过渡期）
 * - 移除 db: Knex 字段，129 处 db 调用全部迁移到 4 Repository + ISaveDataPort
 * - 事务由 txManager 管理（D9/D10），Repository/Port 方法接收 trx 透传
 * - 跨领域 13 表访问通过 ISaveDataPort 端口（D3 根治）
 *
 * 保留的业务逻辑（不迁移到 Repository/Port）：
 * - hasSignificantChanges / stripKeys（纯逻辑，无 db）
 * - createSnapshot 命名逻辑（autoNum / manualNum 计数 + 名称生成）
 * - checkSaveRestriction 限制规则判断
 * - autoSave 快照数量限制逻辑
 * - restoreSnapshot 字段白名单过滤（数据完整性保障）
 */
export class SaveService implements ISaveProvider {
  private readonly logger: ReturnType<typeof createChildLogger>;

  constructor(
    private readonly saveRepo: ISaveRepository,
    private readonly snapshotRepo: ISaveSnapshotRepository,
    private readonly stateRepo: ISaveStateRepository,
    private readonly gameTimeRepo: ISaveGameTimeRepository,
    private readonly saveDataPort: ISaveDataPort,
    private readonly txManager: ITransactionManager,
  ) {
    this.logger = createChildLogger('save');
  }

  async createSave(
    name: string,
    templateId?: ID,
    gameMode?: string,
    restrictionType: SaveRestrictionType = SAVE_RESTRICTION_TYPE.FREE,
  ): Promise<SaveRecord> {
    try {
      const now = Date.now() as Timestamp;
      const saveId = generateReadableId('save', name || 'game') as ID;

      const saveData: SaveRow = {
        id: saveId,
        name,
        type: restrictionType,
        template_id: templateId || 'default',
        game_mode: gameMode || 'text_adventure',
        chapter: '',
        location: '',
        level: 1,
        main_quest: '',
        play_time: 0,
        thumbnail: '',
        created_at: now,
        updated_at: now,
        last_played_at: now,
        current_snapshot_id: null,
        snapshot_count: 0,
        language: 'zh-CN',
      };

      await this.saveRepo.insert(saveData);

      this.logger.info('Save created', { saveId, name, templateId, restrictionType });

      const created = await this.saveRepo.findById(saveId);
      return created!;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to create save', { name, error: errorMessage });
      throw error;
    }
  }

  async getSave(saveId: ID): Promise<SaveRecord | null> {
    const save = await this.saveRepo.findById(saveId);
    return save ?? null;
  }

  async loadSave(saveId: ID): Promise<CompleteSaveData> {
    try {
      const save = await this.saveRepo.findById(saveId);
      if (!save) {
        throw new Error(`Save not found: ${saveId}`);
      }

      // 通过 ISaveDataPort 批量加载 19 张跨领域表数据
      const bundle = await this.saveDataPort.loadAllSaveData(saveId);
      const stateRows = await this.stateRepo.findBySaveId(saveId);
      const gameTimeRow = await this.gameTimeRepo.findBySaveId(saveId);

      // === 角色数据处理 ===
      let character: Record<string, unknown> | undefined;
      if (bundle.characters.length > 0) {
        const charRow = bundle.characters[0];
        character = charRow;

        // 从模板获取角色创建信息（种族/职业/背景名称）
        const templateId = save.template_id;
        if (templateId) {
          const cc = await this.saveDataPort.getTemplateCharacterCreation(templateId) as {
            races?: { id: string; name: string }[];
            classes?: { id: string; name: string }[];
            backgrounds?: { id: string; name: string }[];
            attributes?: { id: string; name: string }[];
          } | null;
          if (cc) {
            const race = (cc.races ?? []).find(r => r.id === charRow.race);
            if (race) character.raceName = race.name;

            const cls = (cc.classes ?? []).find(c => c.id === charRow.class);
            if (cls) character.className = cls.name;

            const bg = (cc.backgrounds ?? []).find(b => b.id === charRow.background);
            if (bg) character.backgroundName = bg.name;

            const attributeNames: Record<string, string> = {};
            for (const attr of cc.attributes ?? []) {
              attributeNames[attr.id] = attr.name;
            }
            character.attributeNames = attributeNames;
          }
        }

        // 解析 JSON 字段
        if (typeof character.attributes === 'string') {
          character.attributes = JSON.parse(character.attributes as string);
        }
        if (typeof character.derived_attributes === 'string') {
          character.derived_attributes = JSON.parse(character.derived_attributes as string);
        }
        if (typeof character.status === 'string' && character.status !== '{}') {
          character.status = JSON.parse(character.status as string);
        }
        if (typeof character.custom_data === 'string' && character.custom_data !== '{}') {
          character.custom_data = JSON.parse(character.custom_data as string);
        }

        character.level = character.level ?? 1;
        const charCurrency =
          typeof character.currency === 'string'
            ? JSON.parse(character.currency as string)
            : (character.currency as Record<string, number>) ?? {};
        character.currency = charCurrency;
      }

      // === Inventory 数据 ===
      const inventory = bundle.inventory.filter(
        (item) => item.owner_type === 'character',
      );

      // === Character Skills 数据 ===
      // §13.3 修复：与 inventory 对称，过滤出 owner_type='character' 的技能记录。
      // 期望效果：前端角色面板仅展示玩家技能，NPC 技能不混入。
      const characterSkills = bundle.character_skills.filter(
        (skill) => skill.owner_type === 'character',
      );

      // === 游戏状态数据 ===
      const gameState: Record<string, unknown> = {};
      for (const row of stateRows) {
        gameState[`${row.data_type}.${row.data_key}`] = JSON.parse(row.data_value);
      }

      // === 任务数据（含目标） ===
      const quests = bundle.quests;
      if (quests.length > 0) {
        const questObjectives: Record<string, unknown[]> = {};
        for (const obj of bundle.quest_objectives) {
          const questId = obj.quest_id as string;
          if (!questObjectives[questId]) {
            questObjectives[questId] = [];
          }
          questObjectives[questId].push(obj);
        }
        for (const quest of quests) {
          (quest as Record<string, unknown>).objectives = questObjectives[quest.id as string] || [];
          if (typeof quest.rewards === 'string') {
            quest.rewards = JSON.parse(quest.rewards as string);
          }
          if (typeof quest.custom_data === 'string') {
            quest.custom_data = JSON.parse(quest.custom_data as string);
          }
        }
      }

      // === NPC 数据（含目标分组） ===
      const npcs = bundle.npcs;
      const goalsByNpcId = new Map<string, unknown[]>();
      for (const goal of bundle.npc_goals) {
        if (typeof goal.related_entity_ids === 'string') {
          goal.related_entity_ids = JSON.parse(goal.related_entity_ids as string);
        }
        const npcId = goal.npc_id as string;
        const arr = goalsByNpcId.get(npcId) ?? [];
        arr.push(goal);
        goalsByNpcId.set(npcId, arr);
      }
      for (const npc of npcs) {
        if (typeof npc.services === 'string') npc.services = JSON.parse(npc.services as string);
        if (typeof npc.dialogue_history === 'string') npc.dialogue_history = JSON.parse(npc.dialogue_history as string);
        if (typeof npc.custom_data === 'string') npc.custom_data = JSON.parse(npc.custom_data as string);
        if (typeof npc.currency === 'string') npc.currency = JSON.parse(npc.currency as string);
        if (typeof npc.attributes === 'string') npc.attributes = JSON.parse(npc.attributes as string);
        if (typeof npc.derived_attributes === 'string') npc.derived_attributes = JSON.parse(npc.derived_attributes as string);
        const customData = npc.custom_data as Record<string, unknown> | undefined;
        if (customData?.driveProfile) {
          (npc as Record<string, unknown>).driveProfile = customData.driveProfile;
        }
        (npc as Record<string, unknown>).goals = goalsByNpcId.get(npc.id as string) ?? [];
      }

      // === 地点数据（含连接和已发现） ===
      const locations = bundle.locations;
      for (const loc of locations) {
        if (typeof loc.items === 'string') loc.items = JSON.parse(loc.items as string);
        if (typeof loc.events === 'string') loc.events = JSON.parse(loc.events as string);
        if (typeof loc.custom_data === 'string') loc.custom_data = JSON.parse(loc.custom_data as string);
      }

      // 地点连接（过滤只含当前 save 地点的连接）
      let locationConnections: Record<string, unknown>[] = [];
      if (locations.length > 0) {
        const locationIds = locations.map((l) => l.id as string);
        locationConnections = bundle.location_connections.filter(
          (conn) =>
            locationIds.includes(conn.from_location_id as string) ||
            locationIds.includes(conn.to_location_id as string),
        );
        for (const conn of locationConnections) {
          if (typeof conn.custom_data === 'string') conn.custom_data = JSON.parse(conn.custom_data as string);
        }
      }

      // === 对话历史 ===
      const dialogues = bundle.dialogues.length > 0
        ? bundle.dialogues
            .filter((row) => row.timestamp !== undefined)
            .sort((a, b) => (a.timestamp as number) - (b.timestamp as number))
            .map((row) => ({
              id: row.id as ID,
              saveId: row.save_id as ID,
              npcId: (row.npc_id as ID | null) ?? null,
              speaker: row.speaker as string,
              content: row.content as string,
              emotion: row.emotion as string,
              messageType: (row.message_type as string) || 'npc',
              timestamp: row.timestamp as Timestamp,
            }))
        : undefined;

      const completeSave: CompleteSaveData = {
        ...save,
        character: character || undefined,
        inventory: inventory.length > 0 ? inventory : undefined,
        item_pool: bundle.item_pool.length > 0 ? bundle.item_pool : undefined,
        skill_pool: bundle.skill_pool.length > 0 ? bundle.skill_pool : undefined,
        skills: characterSkills.length > 0 ? characterSkills : undefined,
        game_state: Object.keys(gameState).length > 0 ? gameState : undefined,
        quests: quests.length > 0 ? quests : undefined,
        npcs: npcs.length > 0 ? npcs : undefined,
        // 模块2 简化：删除 npc_relations 序列化（表已删除）
        locations: locations.length > 0 ? locations : undefined,
        location_connections: locationConnections.length > 0 ? locationConnections : undefined,
        discovered_locations: bundle.discovered_locations.length > 0 ? bundle.discovered_locations : undefined,
        dialogues: dialogues,
        gameTime: gameTimeRow
          ? {
              totalMinutes: gameTimeRow.total_minutes,
              day: gameTimeRow.day_number,
              hour: Math.floor((gameTimeRow.total_minutes % 1440) / 60),
              minute: gameTimeRow.total_minutes % 60,
              periodOfDay: (() => {
                const h = Math.floor((gameTimeRow.total_minutes % 1440) / 60);
                if (h >= 6 && h < 12) return 'morning';
                if (h >= 12 && h < 18) return 'afternoon';
                if (h >= 18 && h < 22) return 'evening';
                return 'night';
              })(),
              season: 'spring',
            }
          : undefined,
      };

      this.logger.info('Save loaded', {
        saveId,
        hasCharacter: !!character,
        inventoryCount: inventory?.length || 0,
      });

      return completeSave;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to load save', { saveId, error: errorMessage });
      throw error;
    }
  }

  async saveSave(saveId: ID): Promise<void> {
    try {
      await this.createSnapshot(saveId, SNAPSHOT_TYPE.MANUAL);
      this.logger.info('Save saved with snapshot', { saveId });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to save save', { saveId, error: errorMessage });
      throw error;
    }
  }

  async deleteSave(saveId: ID): Promise<void> {
    try {
      await this.txManager.transaction(async (trx) => {
        // 按外键依赖顺序删除：先删跨领域数据（含子表），再删 save 领域表，最后删 saves
        await this.saveDataPort.deleteAllSaveData(saveId, trx);
        await this.snapshotRepo.deleteBySaveId(saveId, trx);
        await this.stateRepo.deleteBySaveId(saveId, trx);
        await this.gameTimeRepo.deleteBySaveId(saveId, trx);
        await this.saveRepo.deleteBySaveId(saveId, trx);
      });

      this.logger.info('Save deleted with all related data', { saveId });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to delete save', { saveId, error: errorMessage });
      throw error;
    }
  }

  async listSaves(options?: SaveQueryOptions): Promise<{ saves: SaveRecord[]; total: number }> {
    try {
      const result = await this.saveRepo.list(options);
      this.logger.debug(`Listed ${result.rows.length} saves`, { options, total: result.total });
      return {
        saves: result.rows,
        total: result.total,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to list saves', { error: errorMessage });
      throw error;
    }
  }

  async getSaveLanguage(saveId: ID): Promise<string | undefined> {
    return this.saveRepo.getLanguage(saveId);
  }

  async getSaveTemplateId(saveId: ID): Promise<string | undefined> {
    const templateId = await this.saveRepo.getTemplateIdBySaveId(saveId);
    return templateId ?? undefined;
  }

  async updateSaveLanguage(saveId: ID, language: string): Promise<void> {
    await this.saveRepo.updateLanguage(saveId, language);
  }

  async autoSave(saveId: ID): Promise<{ saved: boolean; reason?: string }> {
    try {
      const now = Date.now() as Timestamp;

      const save = await this.saveRepo.findById(saveId);
      if (!save) {
        throw new Error(`Save not found: ${saveId}`);
      }

      const restriction = await this.checkSaveRestriction(saveId, 'auto');
      if (!restriction.allowed) {
        return { saved: false, reason: restriction.reason };
      }

      const completeData = await this.loadSave(saveId);

      const currentSnapshotId = save.current_snapshot_id;
      if (currentSnapshotId) {
        const latestSnapshot = await this.snapshotRepo.findById(currentSnapshotId);
        if (latestSnapshot) {
          const latestData = JSON.parse(latestSnapshot.snapshot_data) as CompleteSaveData;
          const hasChanges = this.hasSignificantChanges(latestData, completeData);
          if (!hasChanges) {
            const lastPlayedAt = save.last_played_at || save.updated_at || save.created_at;
            const elapsedSeconds = Math.floor((now - lastPlayedAt) / 1000);
            const cappedSeconds = Math.min(elapsedSeconds, 600);
            await this.saveRepo.updatePlayTime(saveId, now, now, cappedSeconds > 0 ? cappedSeconds : undefined);
            return { saved: false, reason: 'no_changes' };
          }
        }
      }

      const lastPlayedAt = save.last_played_at || save.updated_at || save.created_at;
      const elapsedSeconds = Math.floor((now - lastPlayedAt) / 1000);
      const cappedSeconds = Math.min(elapsedSeconds, 600);
      await this.saveRepo.updatePlayTime(saveId, now, now, cappedSeconds > 0 ? cappedSeconds : undefined);

      await this.createSnapshot(saveId, SNAPSHOT_TYPE.AUTO);

      // 清理旧自动快照（保留最新 5 个）
      const autoSnapshots = await this.snapshotRepo.findBySaveIdAndType(saveId, SNAPSHOT_TYPE.AUTO);
      if (autoSnapshots.length > 5) {
        const toDelete = autoSnapshots.slice(0, autoSnapshots.length - 5);
        for (const snap of toDelete) {
          await this.snapshotRepo.deleteById(snap.id);
        }
        await this.saveRepo.updateSnapshot(saveId, null, -toDelete.length);
      }

      this.logger.debug('Auto save completed', { saveId });
      return { saved: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to auto save', { saveId, error: errorMessage });
      this.logger.warn('Auto-save failed silently');
      return { saved: false, reason: errorMessage };
    }
  }

  async exportSave(saveId: ID): Promise<Record<string, unknown>> {
    try {
      const saveData = await this.loadSave(saveId);

      const exportData: Record<string, unknown> = {
        version: '1.0.0',
        exportedAt: Date.now(),
        save: saveData,
      };

      this.logger.info('Save exported', { saveId });
      return exportData;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to export save', { saveId, error: errorMessage });
      throw error;
    }
  }

  async importSave(data: unknown): Promise<ID> {
    try {
      const importData = data as Record<string, unknown>;
      const saveData = importData.save as Partial<SaveRecord>;

      if (!saveData || !saveData.name) {
        throw new Error('Invalid import data: missing save information');
      }

      const newSaveId = await this.createSave(
        `${saveData.name} (Imported)`,
        saveData.template_id,
        saveData.game_mode,
      );

      const saveDataExt = saveData as Record<string, unknown>;
      if (saveDataExt.game_state && typeof saveDataExt.game_state === 'object') {
        const gameState = saveDataExt.game_state as Record<string, unknown>;
        for (const [key, value] of Object.entries(gameState)) {
          const [dataType, dataKey] = key.split('.');
          if (dataType && dataKey) {
            await this.stateRepo.upsert(newSaveId.id, dataType, dataKey, JSON.stringify(value));
          }
        }
      }

      this.logger.info('Save imported', {
        newSaveId: newSaveId.id,
        originalName: saveData.name,
      });

      return newSaveId.id;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to import save', { error: errorMessage });
      throw error;
    }
  }

  async createSnapshot(
    saveId: ID,
    snapshotType: SnapshotType = SNAPSHOT_TYPE.MANUAL,
    chapterName?: string,
  ): Promise<SnapshotRecord> {
    try {
      const completeData = await this.loadSave(saveId);
      const now = Date.now() as Timestamp;
      const snapshotId = generateReadableId('snap', String(saveId).substring(0, 8)) as ID;
      const chapter = chapterName || completeData.chapter;
      const snapshotJson = JSON.stringify(completeData);

      const autoNum = (await this.snapshotRepo.countBySaveIdAndType(saveId, SNAPSHOT_TYPE.AUTO)) + 1;
      const manualNum = (await this.snapshotRepo.countBySaveIdAndType(saveId, SNAPSHOT_TYPE.MANUAL)) + 1;

      let name: string;
      if (snapshotType === SNAPSHOT_TYPE.AUTO) {
        name = `${chapter || '未命名章节'} - 自动保存 ${autoNum}`;
      } else if (snapshotType === SNAPSHOT_TYPE.CHECKPOINT) {
        name = `${chapter || '未命名章节'} - 检查点`;
      } else {
        name = `${chapter || '未命名章节'} - 手动保存 ${manualNum}`;
      }

      const snapshotRow: SaveSnapshotRow = {
        id: snapshotId,
        save_id: saveId,
        name,
        type: snapshotType,
        game_mode: completeData.game_mode,
        chapter,
        location: completeData.location,
        level: completeData.level,
        main_quest: completeData.main_quest,
        play_time: completeData.play_time,
        thumbnail: completeData.thumbnail,
        description: null,
        snapshot_data: snapshotJson,
        created_at: now,
      };

      await this.snapshotRepo.insert(snapshotRow);
      await this.saveRepo.updateSnapshot(saveId, snapshotId, 1);

      const result: SnapshotRecord = {
        id: snapshotId,
        save_id: saveId,
        name,
        type: snapshotType,
        game_mode: completeData.game_mode,
        chapter,
        location: completeData.location,
        level: completeData.level,
        main_quest: completeData.main_quest,
        play_time: completeData.play_time,
        thumbnail: completeData.thumbnail,
        snapshot_data: snapshotJson,
        created_at: now,
      };

      this.logger.info('Snapshot created', { saveId, snapshotId, type: snapshotType, chapter });
      return result;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to create snapshot', { saveId, error: errorMessage });
      throw error;
    }
  }

  async getSnapshots(saveId: ID, options?: SnapshotQueryOptions): Promise<SnapshotRecord[]> {
    try {
      const rows = await this.snapshotRepo.findBySaveId(saveId, options ? { type: options.type } : undefined);

      const results: SnapshotRecord[] = rows.map((snap: SaveSnapshotRow) => ({
        id: snap.id,
        save_id: snap.save_id,
        name: snap.name || '',
        type: (snap.type as SnapshotType) || SNAPSHOT_TYPE.AUTO,
        game_mode: snap.game_mode || '',
        chapter: snap.chapter || '',
        location: snap.location || '',
        level: snap.level ?? 0,
        main_quest: snap.main_quest || '',
        play_time: snap.play_time ?? 0,
        thumbnail: snap.thumbnail || '',
        description: snap.description ?? undefined,
        snapshot_data: '',
        created_at: snap.created_at,
      }));

      this.logger.info('Snapshots listed', { saveId, count: results.length });
      return results;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get snapshots', { saveId, error: errorMessage });
      throw error;
    }
  }

  async loadSnapshot(snapshotId: ID): Promise<CompleteSaveData> {
    try {
      const snapshot = await this.snapshotRepo.findById(snapshotId);
      if (!snapshot) {
        throw new Error(`Snapshot not found: ${snapshotId}`);
      }

      const data = JSON.parse(snapshot.snapshot_data) as CompleteSaveData;
      this.logger.info('Snapshot loaded', { snapshotId });
      return data;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to load snapshot', { snapshotId, error: errorMessage });
      throw error;
    }
  }

  async deleteSnapshot(saveId: ID, snapshotId: ID): Promise<{ success: boolean }> {
    try {
      const save = await this.saveRepo.findById(saveId);
      if (!save) {
        throw new Error(`Save not found: ${saveId}`);
      }

      if (save.type === SAVE_RESTRICTION_TYPE.IRONMAN) {
        throw new Error('Cannot delete snapshots in ironman mode');
      }

      const snapshot = await this.snapshotRepo.findById(snapshotId);
      if (!snapshot || snapshot.save_id !== saveId) {
        throw new Error(`Snapshot not found: ${snapshotId}`);
      }

      await this.snapshotRepo.deleteById(snapshotId);

      const newCount = Math.max(0, (save.snapshot_count ?? 1) - 1);
      if (save.current_snapshot_id === snapshotId) {
        const latestSnapshot = await this.snapshotRepo.findLatestBySaveId(saveId);
        await this.saveRepo.updateFields(saveId, {
          snapshot_count: newCount,
          current_snapshot_id: latestSnapshot?.id ?? null,
        });
      } else {
        await this.saveRepo.updateFields(saveId, { snapshot_count: newCount });
      }

      this.logger.info('Snapshot deleted', { saveId, snapshotId });
      return { success: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to delete snapshot', { saveId, snapshotId, error: errorMessage });
      throw error;
    }
  }

  async enhanceAutoSave(saveId: ID, options?: AutoSaveOptions): Promise<void> {
    try {
      const now = Date.now() as Timestamp;
      const maxSnapshots = options?.maxSnapshots ?? 5;
      const triggerReason = options?.triggerReason ?? 'timer';

      const save = await this.saveRepo.findById(saveId);
      if (save) {
        const lastPlayedAt = save.last_played_at || save.updated_at || save.created_at;
        const elapsedSeconds = Math.floor((now - lastPlayedAt) / 1000);
        const cappedSeconds = Math.min(elapsedSeconds, 600);
        await this.saveRepo.updatePlayTime(saveId, now, now, cappedSeconds > 0 ? cappedSeconds : undefined);
      }

      await this.createSnapshot(saveId, SNAPSHOT_TYPE.AUTO);

      if (maxSnapshots > 0) {
        const autoSnapshots = await this.snapshotRepo.findBySaveIdAndType(saveId, SNAPSHOT_TYPE.AUTO);
        if (autoSnapshots.length > maxSnapshots) {
          const toDelete = autoSnapshots.slice(0, autoSnapshots.length - maxSnapshots);
          for (const snap of toDelete) {
            await this.snapshotRepo.deleteById(snap.id);
          }
          await this.saveRepo.updateSnapshot(saveId, null, -toDelete.length);
        }
      }

      await this.stateRepo.upsert(saveId, 'autosave', 'last_trigger', JSON.stringify(triggerReason));

      this.logger.info('Enhanced auto-save completed', { saveId, triggerReason, maxSnapshots });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to enhance auto-save', { saveId, error: errorMessage });
      this.logger.warn('Enhanced auto-save failed silently');
    }
  }

  async copySave(sourceSaveId: ID, newName?: string): Promise<SaveRecord> {
    try {
      const sourceSave = await this.saveRepo.findById(sourceSaveId);
      if (!sourceSave) {
        throw new Error(`Save not found: ${sourceSaveId}`);
      }

      const now = Date.now() as Timestamp;
      const newSaveId = generateReadableId('save', sourceSave.name || 'copy') as ID;

      const newSaveData: SaveRow = {
        id: newSaveId,
        name: newName || `${sourceSave.name} (副本)`,
        type: 'manual',
        template_id: sourceSave.template_id,
        game_mode: sourceSave.game_mode,
        chapter: sourceSave.chapter,
        location: sourceSave.location,
        level: sourceSave.level,
        main_quest: sourceSave.main_quest,
        play_time: sourceSave.play_time,
        thumbnail: sourceSave.thumbnail,
        language: sourceSave.language,
        created_at: now,
        updated_at: now,
        last_played_at: sourceSave.last_played_at ?? null,
        current_snapshot_id: sourceSave.current_snapshot_id ?? null,
        snapshot_count: sourceSave.snapshot_count ?? 0,
      };

      await this.txManager.transaction(async (trx) => {
        await this.saveRepo.insert(newSaveData, trx);
        await this.saveDataPort.copyAllSaveData(sourceSaveId, newSaveId, trx);
      });

      this.logger.info('Save copied with all related data', { sourceSaveId, newSaveId });
      const created = await this.saveRepo.findById(newSaveId);
      return created!;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to copy save', { sourceSaveId, error: errorMessage });
      throw error;
    }
  }

  async updateSave(saveId: ID, updates: SaveUpdateData): Promise<SaveRecord> {
    try {
      const existing = await this.saveRepo.findById(saveId);
      if (!existing) {
        throw new Error(`Save not found: ${saveId}`);
      }

      const allowedFields: (keyof SaveUpdateData)[] = [
        'name', 'chapter', 'location',
        'main_quest', 'thumbnail', 'game_mode', 'type',
      ];

      const updateData: Partial<SaveRow> = { updated_at: Date.now() as Timestamp };
      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          (updateData as Record<string, unknown>)[field] = updates[field];
        }
      }

      if (updates.description !== undefined) {
        (updateData as Record<string, unknown>).description = updates.description;
      }

      await this.saveRepo.updateFields(saveId, updateData);

      const updated = await this.saveRepo.findById(saveId);
      this.logger.info('Save metadata updated', { saveId, updatedFields: Object.keys(updates) });
      return updated!;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to update save', { saveId, error: errorMessage });
      throw error;
    }
  }

  async checkSaveRestriction(
    saveId: ID,
    action: 'create' | 'update' | 'delete' | 'auto' | 'manual',
  ): Promise<SaveRestrictionResult> {
    try {
      const saveRow = await this.saveRepo.findById(saveId);
      if (!saveRow) {
        return { allowed: true, maxAutoSnapshots: 5, maxManualSnapshots: Infinity };
      }

      const restrictionType = (saveRow.type as SaveRestrictionType) || SAVE_RESTRICTION_TYPE.FREE;

      if (restrictionType === SAVE_RESTRICTION_TYPE.FREE) {
        return { allowed: true, maxAutoSnapshots: 5, maxManualSnapshots: Infinity };
      }

      if (restrictionType === SAVE_RESTRICTION_TYPE.CHECKPOINT_ONLY) {
        if (action === 'update' || action === 'manual') {
          const hasCheckpoint = await this.saveDataPort.hasCheckpointContext(saveId);
          if (!hasCheckpoint) {
            return { allowed: false, reason: 'save_restriction: checkpoint_only', maxAutoSnapshots: 5, maxManualSnapshots: 0 };
          }
        }
        return { allowed: true, maxAutoSnapshots: 5, maxManualSnapshots: 0 };
      }

      if (restrictionType === SAVE_RESTRICTION_TYPE.MANUAL_ONLY) {
        if (action === 'auto') {
          return { allowed: false, reason: 'save_restriction: manual_only', maxAutoSnapshots: 0, maxManualSnapshots: Infinity };
        }
        return { allowed: true, maxAutoSnapshots: 0, maxManualSnapshots: Infinity };
      }

      if (restrictionType === SAVE_RESTRICTION_TYPE.IRONMAN) {
        if (action === 'manual') {
          return { allowed: false, reason: 'save_restriction: ironman', maxAutoSnapshots: 1, maxManualSnapshots: 0 };
        }
        if (action === 'create') {
          const existingCount = await this.saveRepo.countByTemplateId(saveRow.template_id ?? '');
          if (existingCount > 0) {
            return { allowed: false, reason: 'Ironman mode allows only one save per template', maxAutoSnapshots: 1, maxManualSnapshots: 0 };
          }
        }
        return { allowed: true, maxAutoSnapshots: 1, maxManualSnapshots: 0 };
      }

      return { allowed: true, maxAutoSnapshots: 5, maxManualSnapshots: Infinity };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to check save restriction', { saveId, action, error: errorMessage });
      return { allowed: true };
    }
  }

  async restoreSnapshot(snapshotId: ID): Promise<SaveRecord> {
    try {
      const snapshot = await this.snapshotRepo.findById(snapshotId);
      if (!snapshot) {
        throw new Error(`Snapshot not found: ${snapshotId}`);
      }

      const snapshotData = JSON.parse(snapshot.snapshot_data) as CompleteSaveData;
      const saveId = snapshot.save_id;

      const existingSave = await this.saveRepo.findById(saveId);
      if (!existingSave) {
        throw new Error(`Save not found: ${saveId}`);
      }

      // 将 CompleteSaveData 转换为 SaveDataBundle（应用字段白名单过滤）
      const bundle = this.buildRestoreBundle(saveId, snapshotData);

      await this.txManager.transaction(async (trx) => {
        // 更新 saves 表主记录
        await this.saveRepo.updateFields(
          saveId,
          {
            name: snapshotData.name,
            chapter: snapshotData.chapter,
            location: snapshotData.location,
            level: snapshotData.level,
            main_quest: snapshotData.main_quest,
            play_time: snapshotData.play_time,
            current_snapshot_id: snapshotId,
            updated_at: Date.now() as Timestamp,
          },
          trx,
        );

        // 恢复 save_game_state
        await this.stateRepo.deleteBySaveId(saveId, trx);
        if (snapshotData.game_state) {
          const gameState = snapshotData.game_state as Record<string, unknown>;
          for (const [key, value] of Object.entries(gameState)) {
            const [dataType, dataKey] = key.split('.');
            if (dataType && dataKey) {
              await this.stateRepo.upsert(saveId, dataType, dataKey, JSON.stringify(value), trx);
            }
          }
        }

        // 恢复 13 张跨领域表（通过 ISaveDataPort，字段白名单已在 buildRestoreBundle 中应用）
        await this.saveDataPort.restoreAllSaveData(saveId, bundle, trx);
      });

      const restoredSave = await this.saveRepo.findById(saveId);
      this.logger.info('Snapshot restored to save', { snapshotId, saveId });
      return restoredSave!;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to restore snapshot', { snapshotId, error: errorMessage });
      throw error;
    }
  }

  // === 私有业务逻辑方法 ===

  private hasSignificantChanges(oldData: CompleteSaveData, newData: CompleteSaveData): boolean {
    const ignoreKeys = new Set(['updated_at', 'play_time', 'last_played_at', 'playtime', 'current_snapshot_id', 'snapshot_count']);
    const oldStripped = this.stripKeys(oldData, ignoreKeys);
    const newStripped = this.stripKeys(newData, ignoreKeys);
    return JSON.stringify(oldStripped) !== JSON.stringify(newStripped);
  }

  private stripKeys(obj: object, keysToIgnore: Set<string>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (keysToIgnore.has(key)) continue;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.stripKeys(value, keysToIgnore);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * 将 CompleteSaveData 转换为 SaveDataBundle，应用字段白名单过滤和 JSON 序列化。
   *
   * 快照数据包含非表字段（如 raceName, className, attributeNames）和已解析的 JSON 对象，
   * 直接写入数据库会导致 SQLite 报错。此方法在写入前过滤非表字段并重新序列化 JSON 字段。
   */
  private buildRestoreBundle(saveId: ID, snapshotData: CompleteSaveData): SaveDataBundle {
    const filterAndSerialize = (
      data: Record<string, unknown>,
      allowedFields: Set<string>,
      jsonFields: Set<string>,
    ): Record<string, unknown> => {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        if (!allowedFields.has(key)) continue;
        if (jsonFields.has(key) && typeof value === 'object' && value !== null) {
          result[key] = JSON.stringify(value);
        } else {
          result[key] = value;
        }
      }
      return result;
    };

    // 字段白名单定义（与原 services/save.ts 一致）
    const CHARACTER_FIELDS = new Set([
      'id', 'save_id', 'current_location_id', 'name', 'race', 'class', 'background',
      'level', 'experience', 'attributes', 'derived_attributes', 'current_hp', 'max_hp',
      'current_mp', 'max_mp', 'base_max_hp', 'base_max_mp', 'currency', 'status', 'custom_data', 'created_at', 'updated_at',
      'gender', 'custom_gender',
    ]);
    const CHARACTER_JSON_FIELDS = new Set([
      'attributes', 'derived_attributes', 'currency', 'status', 'custom_data',
    ]);
    const INVENTORY_FIELDS = new Set([
      'id', 'save_id', 'item_id', 'pool_id', 'name', 'description', 'category', 'equipped', 'quantity',
      'inventory_slot', 'custom_data', 'created_at', 'updated_at', 'quality', 'durability', 'max_durability',
      'equipped_slot', 'weight', 'max_stack', 'owner_id', 'owner_type', 'visible',
      'stats', 'effects', 'value', 'tags',
    ]);
    const INVENTORY_JSON_FIELDS = new Set([
      'custom_data', 'stats', 'effects', 'value', 'tags',
    ]);
    const CHARACTER_SKILLS_FIELDS = new Set([
      'id', 'save_id', 'skill_id', 'category', 'effects', 'element', 'experience',
      'cost', 'max_level', 'name', 'description', 'custom_data', 'level',
      'cooldown_remaining', 'created_at', 'updated_at', 'unlocked', 'owner_id', 'owner_type',
      'pool_id', 'visible', 'consecutive_uses', 'last_used_at',
    ]);
    const CHARACTER_SKILLS_JSON_FIELDS = new Set([
      'effects', 'custom_data', 'cost',
    ]);
    const QUEST_FIELDS = new Set([
      'id', 'save_id', 'name', 'description', 'type', 'status',
      'visible', 'giver_npc_id', 'rewards', 'time_limit', 'custom_data',
      'prerequisite_quest_ids', 'conditions', 'giver_location_id', 'quest_chain_id',
      'created_at', 'updated_at',
    ]);
    const QUEST_JSON_FIELDS = new Set([
      'rewards', 'custom_data', 'prerequisite_quest_ids', 'conditions',
    ]);
    const QUEST_OBJECTIVE_FIELDS = new Set([
      'id', 'save_id', 'quest_id', 'description', 'type', 'target', 'required', 'current', 'completed',
      'event_trigger',
    ]);
    const NPC_FIELDS = new Set([
      'id', 'save_id', 'template_npc_id', 'name', 'title', 'description', 'role', 'race',
      'location_id', 'level', 'services', 'dialogue_history', 'custom_data',
      'created_at', 'updated_at', 'in_party', 'joined_party_at', 'reputation', 'mood',
      'visible', 'currency', 'attr_initialized', 'inv_initialized', 'skill_initialized',
      'attributes', 'derived_attributes', 'current_hp', 'max_hp', 'current_mp', 'max_mp',
    ]);
    const NPC_JSON_FIELDS = new Set([
      'services', 'dialogue_history', 'custom_data',
      'currency', 'attributes', 'derived_attributes',
    ]);
    const NPC_GOAL_FIELDS = new Set([
      'id', 'save_id', 'npc_id', 'type', 'category', 'description', 'priority',
      'status', 'related_entity_ids', 'progress', 'created_at', 'updated_at',
    ]);
    const NPC_GOAL_JSON_FIELDS = new Set([
      'related_entity_ids',
    ]);
    // 模块2 简化：删除 NPC_RELATION_FIELDS 常量（npc_relations 表已删除）
    const LOCATION_FIELDS = new Set([
      'id', 'save_id', 'name', 'description', 'type', 'terrain_type', 'items', 'events',
      'custom_data', 'x', 'y', 'is_explored', 'created_at', 'updated_at', 'danger_level',
      'location_level', 'parent_location_id', 'visible',
    ]);
    const LOCATION_JSON_FIELDS = new Set([
      'items', 'events', 'custom_data',
    ]);
    const LOCATION_CONNECTION_FIELDS = new Set([
      'id', 'save_id', 'from_location_id', 'to_location_id', 'connection_type', 'distance', 'custom_data',
    ]);
    const LOCATION_CONNECTION_JSON_FIELDS = new Set([
      'custom_data',
    ]);
    const DISCOVERED_LOCATION_FIELDS = new Set([
      'id', 'save_id', 'location_id', 'discovered_at',
    ]);
    const ITEM_POOL_FIELDS = new Set([
      'id', 'save_id', 'name', 'description', 'category', 'quality',
      'stats', 'effects', 'value', 'tags', 'weight', 'max_stack',
      'equipped_slot', 'durability', 'max_durability', 'taken',
      'custom_data', 'recommended_classes', 'created_at', 'updated_at',
    ]);
    const ITEM_POOL_JSON_FIELDS = new Set([
      'stats', 'effects', 'value', 'tags', 'custom_data', 'recommended_classes',
    ]);
    const SKILL_POOL_FIELDS = new Set([
      'id', 'save_id', 'name', 'description', 'category', 'element',
      'cost', 'damage', 'effects', 'cooldown', 'max_level',
      'target_type', 'range', 'learned', 'custom_data', 'recommended_classes',
      'created_at', 'updated_at',
    ]);
    const SKILL_POOL_JSON_FIELDS = new Set([
      'cost', 'damage', 'effects', 'custom_data', 'recommended_classes',
    ]);
    const DIALOGUE_FIELDS = new Set([
      'id', 'save_id', 'npc_id', 'speaker', 'content', 'emotion', 'timestamp', 'message_type',
    ]);

    // 构建 bundle
    const characters: Record<string, unknown>[] = snapshotData.character
      ? [filterAndSerialize(snapshotData.character as Record<string, unknown>, CHARACTER_FIELDS, CHARACTER_JSON_FIELDS)]
      : [];

    const inventory: Record<string, unknown>[] = snapshotData.inventory
      ? (snapshotData.inventory as Record<string, unknown>[]).map((item) =>
          filterAndSerialize({ ...item, save_id: saveId }, INVENTORY_FIELDS, INVENTORY_JSON_FIELDS),
        )
      : [];

    const item_pool: Record<string, unknown>[] = snapshotData.item_pool
      ? (snapshotData.item_pool as Record<string, unknown>[]).map((item) =>
          filterAndSerialize({ ...item, save_id: saveId }, ITEM_POOL_FIELDS, ITEM_POOL_JSON_FIELDS),
        )
      : [];

    const skill_pool: Record<string, unknown>[] = snapshotData.skill_pool
      ? (snapshotData.skill_pool as Record<string, unknown>[]).map((skill) =>
          filterAndSerialize({ ...skill, save_id: saveId }, SKILL_POOL_FIELDS, SKILL_POOL_JSON_FIELDS),
        )
      : [];

    const character_skills: Record<string, unknown>[] = snapshotData.skills
      ? (snapshotData.skills as Record<string, unknown>[]).map((skill) =>
          filterAndSerialize({ ...skill, save_id: saveId }, CHARACTER_SKILLS_FIELDS, CHARACTER_SKILLS_JSON_FIELDS),
        )
      : [];

    // quests + quest_objectives（objectives 从 quest.objectives 提取）
    const questRows: Record<string, unknown>[] = [];
    const objectiveRows: Record<string, unknown>[] = [];
    if (snapshotData.quests) {
      for (const quest of snapshotData.quests as Record<string, unknown>[]) {
        const { objectives, ...questData } = quest;
        questRows.push(filterAndSerialize({ ...questData, save_id: saveId }, QUEST_FIELDS, QUEST_JSON_FIELDS));
        if (objectives && Array.isArray(objectives)) {
          for (const obj of objectives as Record<string, unknown>[]) {
            objectiveRows.push(
              filterAndSerialize({ ...obj, save_id: saveId }, QUEST_OBJECTIVE_FIELDS, new Set()),
            );
          }
        }
      }
    }

    // npcs + npc_goals（goals 从 npc.goals 提取，模块2 简化：删除 npc_relations 处理）
    const npcRows: Record<string, unknown>[] = [];
    const npcGoalRows: Record<string, unknown>[] = [];
    if (snapshotData.npcs) {
      for (const npc of snapshotData.npcs as Record<string, unknown>[]) {
        const { goals, ...npcData } = npc;
        npcRows.push(filterAndSerialize({ ...npcData, save_id: saveId }, NPC_FIELDS, NPC_JSON_FIELDS));
        if (goals && Array.isArray(goals)) {
          for (const goal of goals as Record<string, unknown>[]) {
            npcGoalRows.push(
              filterAndSerialize({ ...goal, save_id: saveId }, NPC_GOAL_FIELDS, NPC_GOAL_JSON_FIELDS),
            );
          }
        }
      }
    }

    // 模块2 简化：删除 npc_relations 序列化（npc_relations 表已删除，关系数据由 PERCEIVES 边维护）

    // locations + location_connections + discovered_locations
    const locations: Record<string, unknown>[] = snapshotData.locations
      ? (snapshotData.locations as Record<string, unknown>[]).map((loc) =>
          filterAndSerialize({ ...loc, save_id: saveId }, LOCATION_FIELDS, LOCATION_JSON_FIELDS),
        )
      : [];

    const location_connections: Record<string, unknown>[] = snapshotData.location_connections
      ? (snapshotData.location_connections as Record<string, unknown>[]).map((conn) =>
          filterAndSerialize({ ...conn, save_id: saveId }, LOCATION_CONNECTION_FIELDS, LOCATION_CONNECTION_JSON_FIELDS),
        )
      : [];

    const discovered_locations: Record<string, unknown>[] = snapshotData.discovered_locations
      ? (snapshotData.discovered_locations as Record<string, unknown>[]).map((dl) =>
          filterAndSerialize({ ...dl, save_id: saveId }, DISCOVERED_LOCATION_FIELDS, new Set()),
        )
      : [];

    // dialogues（camelCase → snake_case 转换）
    const dialogues: Record<string, unknown>[] = snapshotData.dialogues
      ? (snapshotData.dialogues as Record<string, unknown>[]).map((dlg) => {
          const snakeDlg: Record<string, unknown> = {
            ...dlg,
            save_id: saveId,
            npc_id: (dlg.npc_id as string | null) ?? (dlg.npcId as string | null) ?? null,
            message_type: (dlg.message_type as string) ?? (dlg.messageType as string) ?? 'npc',
          };
          return filterAndSerialize(snakeDlg, DIALOGUE_FIELDS, new Set());
        })
      : [];

    return {
      characters,
      inventory,
      item_pool,
      skill_pool,
      character_skills,
      quests: questRows,
      quest_objectives: objectiveRows,
      npcs: npcRows,
      npc_goals: npcGoalRows,
      // 模块2 简化：删除 npc_relations 字段（表已删除）
      locations,
      location_connections,
      discovered_locations,
      dialogues,
      // 非快照表：空数组，restoreAllSaveData 会跳过
      agent_contexts: [],
      decision_logs: [],
      agent_schedules: [],
      save_data_indexes: [],
      save_write_logs: [],
    };
  }
}
