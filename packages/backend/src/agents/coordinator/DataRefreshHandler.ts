import type { PanelUpdates, NPCData, CharacterUpdate, InventoryItemData, InventoryUpdate, MapUpdate, NPCUpdate, QuestUpdate, QuestData, QuestObjectiveData, LocationPanelData, LocationConnectionData, SkillsUpdate, SkillData } from '../../../../shared/src/types/dynamic-ui.js';
import type { ID } from '../../../../shared/src/types/core.js';
import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import { mapLocationToPanelData } from '@ai-rpg/shared/utils';
import type { LocationData, LocationConnection } from '../../game-systems/map/types.js';
import type { ICharacterRepository, CharacterData } from '../../game-systems/character/types.js';
import type { IInventoryRepository, InventoryItem, OwnerType } from '../../game-systems/inventory/types.js';
import type { ILocationRepository, ILocationConnectionRepository } from '../../game-systems/map/types.js';
import type { INPCRepository, NPCProfile } from '../../game-systems/npc/types.js';
import type { IQuestRepository, IQuestObjectiveRepository, Quest, QuestObjective } from '../../game-systems/quest/types.js';
import type { ICharacterSkillRepository, CharacterSkill } from '../../game-systems/skill/types.js';

const logger = createChildLogger('data-refresh-handler');

/**
 * DataRefreshHandler 依赖的 Repository 容器（P0-1 技术债修复 + FOLLOWUP-1 触发补全）。
 *
 * 设计偏差（S4-P0-1-DEV-1）: 原设计 §5.6 列 5 个 Repository，但 D7（一表一 Repository）
 * 将 location_connections 和 quest_objectives 拆为独立 Repository，因此实际需要 7 个。
 *  - locationConnectionRepo: 查询地点连接（createMapRefreshConfig 需要）
 *  - questObjectiveRepo: 查询任务目标（createQuestRefreshConfig 需要）
 *
 * FOLLOWUP-1 新增: characterSkillRepo 查询已学技能（createSkillsRefreshConfig 需要）。
 */
export interface RefreshRepos {
  characterRepo: ICharacterRepository;
  inventoryRepo: IInventoryRepository;
  locationRepo: ILocationRepository;
  locationConnectionRepo: ILocationConnectionRepository;
  npcRepo: INPCRepository;
  questRepo: IQuestRepository;
  questObjectiveRepo: IQuestObjectiveRepository;
  characterSkillRepo: ICharacterSkillRepository;
}

export interface DataRefreshConfig<T extends PanelUpdates[keyof PanelUpdates] = PanelUpdates[keyof PanelUpdates]> {
  panelKey: keyof PanelUpdates;
  triggerToolTypes: string[];
  refresh: (repos: RefreshRepos, saveId: ID, existing: T | undefined) => Promise<T | null>;
  logLabel: string;
}

export class DataRefreshHandler {
  private repos: RefreshRepos;
  private configs: Array<DataRefreshConfig<any>> = [];

  constructor(repos: RefreshRepos) {
    this.repos = repos;
  }

  /**
   * 默认工厂: 注册 6 个 RefreshConfig（character/inventory/map/npc/quest/skills）。
   * 替代 ResponseBuilder 内手动 register 的重复代码。
   */
  static createDefault(repos: RefreshRepos): DataRefreshHandler {
    const handler = new DataRefreshHandler(repos);
    handler.register(createCharacterRefreshConfig());
    handler.register(createInventoryRefreshConfig());
    handler.register(createMapRefreshConfig());
    handler.register(createNPCRefreshConfig());
    handler.register(createQuestRefreshConfig());
    handler.register(createSkillsRefreshConfig());
    return handler;
  }

  register<T extends PanelUpdates[keyof PanelUpdates]>(config: DataRefreshConfig<T>): void {
    this.configs.push(config as DataRefreshConfig<any>);
  }

  async refreshAll(
    writeOperations: Array<{ toolType: string }>,
    saveId: ID | undefined,
    panelUpdates: PanelUpdates,
  ): Promise<void> {
    if (!saveId) return;

    for (const config of this.configs) {
      const shouldRefresh = writeOperations.some(op =>
        config.triggerToolTypes.includes(op.toolType)
      );
      if (!shouldRefresh) continue;

      try {
        const existing = panelUpdates[config.panelKey];
        const result = await config.refresh(this.repos, saveId, existing as any);
        if (result !== null && result !== undefined) {
          (panelUpdates as Record<string, unknown>)[config.panelKey] = result;
        }
      } catch (err) {
        logger.warn(`Failed to refresh ${config.logLabel} after write`, {
          error: getErrorMessage(err)
        });
      }
    }
  }

  async refreshAllPanels(
    saveId: ID | undefined,
    panelUpdates: PanelUpdates,
  ): Promise<void> {
    if (!saveId) return;

    for (const config of this.configs) {
      try {
        const existing = panelUpdates[config.panelKey];
        const result = await config.refresh(this.repos, saveId, existing as any);
        if (result !== null && result !== undefined) {
          (panelUpdates as Record<string, unknown>)[config.panelKey] = result;
        }
      } catch (err) {
        logger.warn(`Failed to refresh ${config.logLabel}`, {
          error: getErrorMessage(err)
        });
      }
    }
  }
}

// =============================================================================
// 实体 → UI 类型映射器（DataRefreshHandler 作为 UI 适配器，负责 domain entity → UI type）
// Repository 负责 row → entity，DataRefreshHandler 负责 entity → UI type。
// =============================================================================

function mapInventoryItemToItemData(item: InventoryItem): InventoryItemData {
  return {
    id: item.id,
    saveId: item.saveId,
    itemId: item.itemId,
    poolId: item.poolId,
    name: item.name,
    description: item.description,
    quantity: item.quantity,
    quality: item.quality,
    category: item.category,
    equipped: item.equipped,
    inventorySlot: item.inventorySlot ?? undefined,
    equippedSlot: item.equippedSlot ?? undefined,
    stats: item.stats,
    effects: item.effects,
    value: item.value,
    tags: item.tags,
    weight: item.weight,
    durability: item.durability,
    maxDurability: item.maxDurability,
    maxStack: item.maxStack,
    customData: item.customData,
    ownerType: item.ownerType,
    ownerId: item.ownerId,
    visible: item.visible,
  };
}

function mapNpcProfileToNpcData(npc: NPCProfile): NPCData {
  const locationId = npc.locationId ?? undefined;
  return {
    id: npc.id,
    name: npc.name,
    role: npc.role,
    race: npc.race,
    level: npc.level,
    locationId,
    location: locationId,
    description: npc.description,
    services: npc.services.map(s => s.name),
    affinity: npc.reputation,
    mood: npc.mood,
    inParty: npc.inParty,
    title: npc.title,
    customData: npc.customData,
    visible: npc.visible,
    attrInitialized: npc.attrInitialized,
    invInitialized: npc.invInitialized,
    skillInitialized: npc.skillInitialized,
    visibility: npc.visibility,
    attributes: npc.attributes,
    derivedAttributes: npc.derivedAttributes,
    currentHp: npc.currentHp,
    maxHp: npc.maxHp,
    currentMp: npc.currentMp,
    maxMp: npc.maxMp,
  };
}

function mapConnectionToConnectionData(conn: LocationConnection): LocationConnectionData {
  return {
    from: conn.fromLocationId,
    to: conn.toLocationId,
    direction: conn.customData?.direction as string | undefined,
    connectionType: conn.connectionType,
    distance: conn.distance ?? undefined,
    travelTime: conn.distance ?? undefined,
  };
}

function mapQuestToQuestData(quest: Quest, objectives: QuestObjective[]): QuestData {
  return {
    id: quest.id,
    name: quest.name,
    type: quest.type,
    description: quest.description,
    status: quest.status,
    visible: quest.visible,
    giverNpcId: quest.giverNpcId ?? undefined,
    giverLocationId: quest.giverLocationId ?? undefined,
    questChainId: quest.questChainId ?? undefined,
    prerequisiteQuestIds: quest.prerequisiteQuestIds,
    conditions: quest.conditions,
    objectives: objectives.map(mapObjectiveToObjectiveData),
    rewards: quest.rewards,
    timeLimit: quest.timeLimit,
    customData: quest.customData,
    createdAt: quest.createdAt,
    updatedAt: quest.updatedAt,
  };
}

function mapObjectiveToObjectiveData(obj: QuestObjective): QuestObjectiveData {
  return {
    id: obj.id,
    type: obj.type,
    description: obj.description,
    target: obj.target,
    current: obj.current,
    required: obj.required,
    completed: obj.completed,
    eventTrigger: obj.eventTrigger,
  };
}

/**
 * 填充地点的子地点 ID 列表。
 * 使用 locationRepo.findAllParentLinks 查询所有 (id, parentLocationId) 对，
 * 然后构建 parent→children 映射并回填到 locations 数组。
 */
function fillChildLocationIds(
  parentLinks: Array<{ id: ID; parentLocationId: ID | null }>,
  locations: LocationData[],
): void {
  const childMap = new Map<ID, ID[]>();
  for (const link of parentLinks) {
    if (!link.parentLocationId) continue;
    if (!childMap.has(link.parentLocationId)) childMap.set(link.parentLocationId, []);
    childMap.get(link.parentLocationId)!.push(link.id);
  }

  for (const loc of locations) {
    loc.childLocationIds = childMap.get(loc.id) ?? [];
    loc.isParent = loc.childLocationIds.length > 0;
  }
}

// =============================================================================
// RefreshConfig 工厂函数（注入 Repository，通过 RefreshRepos 容器调用）
// =============================================================================

export function createCharacterRefreshConfig(): DataRefreshConfig<CharacterUpdate> {
  return {
    panelKey: 'character',
    triggerToolTypes: ['inventory_service', 'numerical_service', 'skill_service', 'character_service'],
    async refresh(repos, saveId, existing) {
      // 使用 findEntityBySaveId 获取已映射的 CharacterData（currency 等 JSON 字段已解析）
      const character: CharacterData | null = await repos.characterRepo.findEntityBySaveId(saveId);
      if (!character) return null;

      const characterUpdate: Record<string, unknown> = { ...(existing ?? {}) };
      characterUpdate.gold = character.currency.gold ?? 0;
      characterUpdate.currency = character.currency;
      characterUpdate.currentHP = character.currentHP;
      characterUpdate.maxHP = character.maxHP;
      characterUpdate.currentMP = character.currentMP;
      characterUpdate.maxMP = character.maxMP;
      characterUpdate.exp = character.experience;
      characterUpdate.level = character.level;

      logger.info('Refreshed character status from Repository after character/inventory/numerical/skill write', {
        saveId, currency: character.currency
      });

      return characterUpdate as CharacterUpdate;
    },
    logLabel: 'character status',
  };
}

export function createInventoryRefreshConfig(): DataRefreshConfig<InventoryUpdate> {
  return {
    panelKey: 'inventory',
    triggerToolTypes: ['inventory_service'],
    async refresh(repos, saveId) {
      // 原代码 where({ save_id, owner_type: 'character' }) 不限定 owner_id，
      // 使用 findBySaveIdAndOwnerType 精确匹配此语义。
      const items: InventoryItem[] = await repos.inventoryRepo.findBySaveIdAndOwnerType(
        saveId,
        'character' as OwnerType,
      );

      const added = items.map(mapInventoryItemToItemData);
      logger.info('Refreshed inventory from Repository after inventory write', {
        saveId,
        totalItems: added.length,
      });

      return { added, replace: true };
    },
    logLabel: 'inventory data',
  };
}

export function createMapRefreshConfig(): DataRefreshConfig<MapUpdate> {
  return {
    panelKey: 'map',
    triggerToolTypes: ['map_service', 'npc_service'],
    async refresh(repos, saveId, existing) {
      const allLocations: LocationData[] = await repos.locationRepo.findBySaveId(saveId);
      const existingMapUpdate: MapUpdate = existing ?? {};
      const existingNewLocationIds = new Set(
        (existingMapUpdate.newLocations ?? []).map((l) => l.id)
      );

      // 填充子地点 ID（替代原 fillChildLocationIds 直接 db 查询）
      const parentLinks = await repos.locationRepo.findAllParentLinks(saveId);
      fillChildLocationIds(parentLinks, allLocations);

      const newLocations: LocationPanelData[] = allLocations
        .filter((loc) => !existingNewLocationIds.has(loc.id))
        .map(mapLocationToPanelData);

      // 查询角色当前位置（替代原 db('characters').select('current_location_id').first()）
      const character = await repos.characterRepo.findEntityBySaveId(saveId);
      const currentLocationId = character?.currentLocationId ?? undefined;

      // 查询所有地点连接（替代原 db('location_connections').select(...)）
      const connections: LocationConnection[] = await repos.locationConnectionRepo.findAll(saveId);
      const newConnections: LocationConnectionData[] = connections.map(mapConnectionToConnectionData);

      if (newLocations.length === 0 && newConnections.length === 0 && allLocations.length === 0 && !currentLocationId) return null;

      const result: MapUpdate = {
        ...existingMapUpdate,
        newLocations: [...(existingMapUpdate.newLocations ?? []), ...newLocations],
        newConnections: [...(existingMapUpdate.newConnections ?? []), ...newConnections],
        discoveredLocationIds: [
          ...(existingMapUpdate.discoveredLocationIds ?? []),
          ...newLocations.map((l) => l.id),
        ],
        ...(currentLocationId ? { currentLocationId } : {}),
      };

      logger.info('Refreshed locations from Repository after map write', {
        saveId, totalLocations: allLocations.length, newLocations: newLocations.length, currentLocationId
      });

      return result;
    },
    logLabel: 'locations',
  };
}

export function createNPCRefreshConfig(): DataRefreshConfig<NPCUpdate> {
  return {
    panelKey: 'npc',
    triggerToolTypes: ['npc_service'],
    async refresh(repos, saveId, existing) {
      const npcProfiles: NPCProfile[] = await repos.npcRepo.findBySaveId(saveId);

      const existingNpcUpdate: NPCUpdate = existing ?? {};

      const dbNPCs: NPCData[] = npcProfiles.map(mapNpcProfileToNpcData);

      const mergedNearby = [...(existingNpcUpdate.nearby ?? [])];
      for (const dbNpc of dbNPCs) {
        const existingIdx = mergedNearby.findIndex((n) => n.id === dbNpc.id);
        if (existingIdx >= 0) {
          const existingNpc = mergedNearby[existingIdx];
          const mergedRecord = { ...(existingNpc as unknown as Record<string, unknown>) };
          for (const [key, value] of Object.entries(dbNpc)) {
            if (value !== undefined && value !== null && value !== '') {
              mergedRecord[key] = value;
            }
          }
          mergedNearby[existingIdx] = mergedRecord as unknown as NPCData;
        } else {
          mergedNearby.push(dbNpc);
        }
      }

      logger.info('Refreshed NPC data from Repository after npc_service write', {
        saveId, totalNPCs: npcProfiles.length, nearbyCount: mergedNearby.length
      });

      return { ...existingNpcUpdate, nearby: mergedNearby };
    },
    logLabel: 'NPC data',
  };
}

export function createQuestRefreshConfig(): DataRefreshConfig<QuestUpdate> {
  return {
    panelKey: 'quest',
    triggerToolTypes: ['quest_service'],
    async refresh(repos, saveId, existing) {
      const quests: Quest[] = await repos.questRepo.findBySaveId(saveId);

      if (quests.length === 0) return null;

      const questIds = quests.map(q => q.id);
      // 批量查询所有任务目标（替代原 db('quest_objectives').whereIn('quest_id', questIds)）
      const objectives: QuestObjective[] = await repos.questObjectiveRepo.findByQuestIds(saveId, questIds);

      const objectivesByQuest = new Map<string, QuestObjective[]>();
      for (const obj of objectives) {
        const qid = obj.questId;
        if (!objectivesByQuest.has(qid)) objectivesByQuest.set(qid, []);
        objectivesByQuest.get(qid)!.push(obj);
      }

      const existingUpdate: QuestUpdate = existing ?? {};
      const existingById = new Map<string, QuestData>();
      for (const q of [...(existingUpdate.updated ?? []), ...(existingUpdate.added ?? [])]) {
        existingById.set(q.id, q);
      }

      const updated: QuestData[] = [];
      for (const quest of quests) {
        const questObjectives = objectivesByQuest.get(quest.id) ?? [];
        const questData = mapQuestToQuestData(quest, questObjectives);

        // 如果已有数据，增量合并
        const existingQuest = existingById.get(quest.id);
        if (existingQuest) {
          Object.assign(existingQuest, questData);
          updated.push(existingQuest);
        } else {
          updated.push(questData);
        }
      }

      logger.info('Refreshed quest data from Repository after quest_service write', {
        saveId, totalQuests: quests.length, updatedCount: updated.length
      });

      return { ...existingUpdate, updated };
    },
    logLabel: 'quest data',
  };
}

export function createSkillsRefreshConfig(): DataRefreshConfig<SkillsUpdate> {
  return {
    panelKey: 'skills',
    triggerToolTypes: ['skill_service'],
    async refresh(repos, saveId) {
      // 使用 findBySaveIdAndOwnerType 取代 findBySaveId({ ownerType })，
      // 修复 §13.3 违反：findBySaveId 加固后只传 ownerType 不传 ownerId 会抛错。
      // 期望效果：返回该 saveId 下所有 ownerType='character' 的技能记录（含多个 character 合并视图），
      // 前端按 ownerType='character' 过滤展示。
      const skills: CharacterSkill[] = await repos.characterSkillRepo.findBySaveIdAndOwnerType(
        saveId,
        'character'
      );
      const learned = skills.map(mapCharacterSkillToSkillData);
      logger.info('Refreshed skills from Repository after skill_service write', {
        saveId, totalSkills: learned.length,
      });
      return { learned, replace: true };
    },
    logLabel: 'skills data',
  };
}

function mapCharacterSkillToSkillData(skill: CharacterSkill): SkillData {
  return {
    id: skill.id,
    name: skill.name,
    type: skill.category,
    description: skill.description,
    skillId: skill.skillId,
    level: skill.level,
    maxLevel: skill.maxLevel,
    experience: skill.experience,
    element: skill.element,
    cost: skill.cost,
    cooldownRemaining: skill.cooldownRemaining,
    unlocked: skill.unlocked,
    visible: skill.visible,
    effects: skill.effects,
    customData: skill.customData,
    ownerType: skill.ownerType,
    ownerId: skill.ownerId,
  };
}
