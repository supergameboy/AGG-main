import type { ID } from '../../../shared/src/types/core.js';
import type { DataProviders, ExpandContext, ContextFilter } from '../../../shared/src/types/context-manifest.js';
import type { TemplateRecord } from './template.js';
import type { TemplatePoolService } from './template-pool.js';
import type { Knex } from 'knex';
// P1-3: 注入 11 个领域 Repository 端口接口，消除 12 个方法的直接 db 调用
import type { ICharacterRepository } from '../game-systems/character/types.js';
import type { ILocationRepository } from '../game-systems/map/types.js';
import type { INPCRepository } from '../game-systems/npc/types.js';
import type { IQuestRepository } from '../game-systems/quest/types.js';
import type { ISkillPoolRepository } from '../game-systems/skill/types.js';
import type { IItemPoolRepository } from '../game-systems/inventory/types.js';
import type { IDialogueRepository } from '../game-systems/dialogue/types.js';
import type { IEventTriggerRepository } from '../game-systems/event/types.js';
import type { ICombatRepository } from '../game-systems/combat/types.js';
import type { IGameTimeRepository } from '../game-systems/time/types.js';
import type { ISaveStateRepository } from '../game-systems/save/types.js';
// 模块4: EntityGraphService 类型（关系数据.* tag 用）+ EntityType/RelationType 类型断言
import type { EntityGraphService } from '../game-systems/entity-graph/EntityGraphService.js';
import type { EntityType, RelationType } from '../game-systems/entity-graph/types.js';
// 审核 shadow provider 需要的具体 Repository 实现
import { CharacterRepository } from '../game-systems/character/CharacterRepository.js';
import { LocationRepository } from '../game-systems/map/LocationRepository.js';
import { NPCRepository } from '../game-systems/npc/NPCRepository.js';
import { ItemPoolRepository } from '../game-systems/inventory/ItemPoolRepository.js';

/**
 * DataProviders 组合根工厂。
 *
 * P1-3 重构: 原 12 个方法（savePoolProvider 9 + gameStateProvider 3）全部直接 db 调用，
 * 无 row mapper。改为注入 11 个领域 Repository，row mapper 由 Repository 统一处理。
 *
 * 重构附带修复 3 处原代码 BUG:
 * 1. listEvents 原查 `game_events` 表（不存在）→ 改为 eventTriggerRepo.findBySaveId 查 event_triggers 表
 * 2. getCombatState 原查 `combat_state` 表（不存在，实际是 combat_states）→ 改为 combatRepo.findBySaveId
 * 3. listDialogues 原 orderBy('created_at') 字段不存在（dialogues 表用 timestamp）→ 改为 findRecent(saveId, null, 20) 按 timestamp desc
 *
 * 由 init.ts 调用 buildDataProviders(deps) 创建，
 * 然后传入 coordinatorServiceTool.setGameDataExpander 的 contextBuilder。
 */

export interface DataProvidersDeps {
  getTemplateRecord: (templateId: ID) => TemplateRecord | null;
  templatePoolService: TemplatePoolService;
  // P1-3: 11 个领域 Repository（替代 db）
  characterRepo: ICharacterRepository;
  locationRepo: ILocationRepository;
  npcRepo: INPCRepository;
  questRepo: IQuestRepository;
  skillPoolRepo: ISkillPoolRepository;
  itemPoolRepo: IItemPoolRepository;
  dialogueRepo: IDialogueRepository;
  eventTriggerRepo: IEventTriggerRepository;
  combatRepo: ICombatRepository;
  gameTimeRepo: IGameTimeRepository;
  saveStateRepo: ISaveStateRepository;
  // 模块4: EntityGraphService 实例（关系数据.* tag 用）
  entityGraphService: EntityGraphService;
}

/**
 * 构建 DataProviders 实现（通过领域 Repository 访问数据）。
 */
export function buildDataProviders(deps: DataProvidersDeps): DataProviders {
  const {
    getTemplateRecord,
    templatePoolService,
    characterRepo,
    locationRepo,
    npcRepo,
    questRepo,
    skillPoolRepo,
    itemPoolRepo,
    dialogueRepo,
    eventTriggerRepo,
    combatRepo,
    gameTimeRepo,
    saveStateRepo,
    entityGraphService,
  } = deps;

  return {
    templateRecordProvider: {
      get: (templateId: ID) => getTemplateRecord(templateId),
    },

    templatePoolProvider: {
      listSkills: async (templateId: ID, filter?: ContextFilter) => {
        return templatePoolService.listSkills(templateId, toTemplatePoolFilter(filter));
      },
      listItems: async (templateId: ID, filter?: ContextFilter) => {
        return templatePoolService.listItems(templateId, toTemplatePoolFilter(filter));
      },
    },

    savePoolProvider: {
      listCharacters: async (saveId: ID, filter?: ContextFilter) => {
        // characterRepo.findBySaveIdWithNames 内部按 names 过滤（SQL whereIn）
        return characterRepo.findBySaveIdWithNames(saveId, filter?.names);
      },
      listLocations: async (saveId: ID, filter?: ContextFilter) => {
        const locations = await locationRepo.findBySaveId(saveId);
        return filterByName(locations, filter?.names);
      },
      listNpcs: async (saveId: ID, filter?: ContextFilter) => {
        const npcs = await npcRepo.findBySaveId(saveId, { visibility: 'all' });
        return filterByName(npcs, filter?.names);
      },
      listQuests: async (saveId: ID, filter?: ContextFilter) => {
        const quests = await questRepo.findBySaveId(saveId);
        return filterByName(quests, filter?.names);
      },
      listSkills: async (saveId: ID, filter?: ContextFilter) => {
        const skills = await skillPoolRepo.findBySaveId(saveId, {
          learned: filter?.learned,
          category: Array.isArray(filter?.category) ? filter.category[0] : filter?.category,
        });
        return filterByName(skills, filter?.names);
      },
      listItems: async (saveId: ID, filter?: ContextFilter) => {
        const items = await itemPoolRepo.findBySaveId(saveId);
        let filtered = items;
        if (filter?.taken !== undefined) {
          filtered = filtered.filter(i => i.taken === filter.taken);
        }
        if (filter?.names && filter.names.length > 0) {
          filtered = filtered.filter(i => filter.names!.includes(i.name));
        }
        if (filter?.category) {
          const cats = Array.isArray(filter.category) ? filter.category : [filter.category];
          filtered = filtered.filter(i => cats.includes(i.category));
        }
        return filtered;
      },
      listDialogues: async (saveId: ID) => {
        // P1-3 BUG 修复: 原 orderBy('created_at') 字段不存在，dialogues 表用 timestamp。
        // findRecent(saveId, null, 20) 按 timestamp desc + limit 20，匹配原语义。
        // npcId=null 查询全部对话（不限 NPC）。
        // filter 参数省略：dialogues 无 name 字段（用 speaker），原 whereIn('name') 是 BUG。
        const dialogues = await dialogueRepo.findRecent(saveId, null, 20);
        return dialogues;
      },
      listEvents: async (saveId: ID) => {
        // P1-3 BUG 修复: 原查 game_events 表不存在，event_triggers 表才有 save_id。
        // eventTriggerRepo.findBySaveId 查 event_triggers 表，返回 EventTrigger[]。
        // filter.names 不适用（EventTrigger 无 name 字段，原 whereIn('name') 是 BUG）。
        return eventTriggerRepo.findBySaveId(saveId);
      },
      getCombatState: async (saveId: ID) => {
        // P1-3 BUG 修复: 原查 combat_state 表不存在（实际是 combat_states）。
        // combatRepo.findBySaveId 查 combat_states 表，返回 CombatStateRow | null。
        return combatRepo.findBySaveId(saveId);
      },
    },

    gameStateProvider: {
      getFullStatus: async (saveId: ID) => {
        return characterRepo.findFullStatusBySaveId(saveId);
      },
      getGameTime: async (saveId: ID) => {
        return gameTimeRepo.findBySaveId(saveId);
      },
      getPacingState: async (saveId: ID) => {
        // save_game_state 多态键值对模式：data_type='pacing' 可有多条 data_key。
        // 原代码 .first() 取第一条，这里取数组第一个。
        const rows = await saveStateRepo.findBySaveIdAndType(saveId, 'pacing');
        return rows[0] ?? null;
      },
    },

    // 模块4: 关系数据.* tag 用，代理到 EntityGraphService 实例。
    // 注意：getNpcProfile/getLocationSummary 依赖 npcService/mapService 端口，
    //   init.ts L412 创建的 bootstrap 级 entityGraphService 实例 npcService=null/mapService=null，
    //   调用会抛错被 GameDataExpander 降级为 warn（局部降级，不阻断 manifest 路径）。
    //   若 GM 实际需要 NPC 关系数据，应通过模块1 的 createEntityGraphPort 路径
    //   （per-saveId 单缓存同时注入 NPCService+MapService），由 EntityGraphPort 暴露的方法消费。
    entityGraphProvider: {
      getNpcProfile: (saveId, npcId) => entityGraphService.getNpcProfile(saveId, npcId),
      getLocationSummary: (saveId, locationId) => entityGraphService.getLocationSummary(saveId, locationId),
      getEntityRelations: (saveId, entityType, entityId) =>
        entityGraphService.getEntityRelations(saveId, entityType as EntityType, entityId),
      getWorldStateSummary: (saveId) => entityGraphService.getWorldStateSummary(saveId),
      getFullGraph: (saveId) => entityGraphService.getFullGraph(saveId),
      getSubgraph: (saveId, centerNodeId, depth) =>
        entityGraphService.getSubgraph(saveId, centerNodeId, depth),
      getNodesByType: (saveId, type) =>
        entityGraphService.getNodesByType(saveId, type as EntityType),
      getPerceivesEdges: (saveId) => entityGraphService.getEdgesByRelation(saveId, 'PERCEIVES' as RelationType),
      getEntityAwareness: (saveId, entityType, entityId) =>
        entityGraphService.getEntityAwareness(saveId, entityType as EntityType, entityId),
    },
  };
}

/**
 * 构建 ExpandContext 的工厂函数（供 coordinatorServiceTool.setGameDataExpander 使用）。
 */
export function createExpandContextBuilder(dataProviders: DataProviders) {
  return (saveId: ID, templateId: string): ExpandContext => ({
    saveId,
    templateId,
    providers: dataProviders,
  });
}

/**
 * 按 name 字段过滤实体数组（ContextFilter.names 的通用过滤逻辑）。
 * Repository 方法不全部支持 names 参数，在 SavePool 层做 JS 过滤。
 * saveId 下的实体数量通常很少（<100），性能可接受。
 */
function filterByName<T extends { name: string }>(items: T[], names?: string[]): T[] {
  if (!names || names.length === 0) return items;
  return items.filter(i => names.includes(i.name));
}

function toTemplatePoolFilter(filter?: ContextFilter) {
  if (!filter) return undefined;
  const result: Record<string, unknown> = {};
  if (filter.category) result.category = filter.category;
  if (filter.recommendedClass) result.recommendedClass = filter.recommendedClass;
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * 构建基于 ShadowState 的 savePoolProvider（供审核使用）。
 *
 * 用 `stagingPool.createProxyDb()` 创建的代理 db 查询 Repository，
 * 读取操作经过 ShadowState（能看到本轮未提交的写入），
 * 确保审核 Checker 使用与 ShadowState 一致的数据时效。
 *
 * 审核场景使用，覆盖 NpcLocationChecker 和 ItemOwnershipChecker 需要的 4 个方法。
 */
export function buildShadowSavePoolProvider(
  proxyDb: Knex,
): DataProviders['savePoolProvider'] {
  const npcRepo: INPCRepository = new NPCRepository(proxyDb);
  const locationRepo: ILocationRepository = new LocationRepository(proxyDb);
  const characterRepo: ICharacterRepository = new CharacterRepository(proxyDb);
  const itemPoolRepo: IItemPoolRepository = new ItemPoolRepository(proxyDb);

  return {
    listCharacters: async (saveId: ID, filter?: ContextFilter) => {
      return characterRepo.findBySaveIdWithNames(saveId, filter?.names);
    },
    listNpcs: async (saveId: ID, filter?: ContextFilter) => {
      const npcs = await npcRepo.findBySaveId(saveId, { visibility: 'all' });
      return filterByName(npcs, filter?.names);
    },
    listLocations: async (saveId: ID, filter?: ContextFilter) => {
      const locations = await locationRepo.findBySaveId(saveId);
      return filterByName(locations, filter?.names);
    },
    listItems: async (saveId: ID, filter?: ContextFilter) => {
      const items = await itemPoolRepo.findBySaveId(saveId);
      let filtered = items;
      if (filter?.taken !== undefined) {
        filtered = filtered.filter((i: any) => i.taken === filter.taken);
      }
      if (filter?.names && filter.names.length > 0) {
        filtered = filtered.filter((i: any) => filter.names!.includes(i.name));
      }
      if (filter?.category) {
        const cats = Array.isArray(filter.category) ? filter.category : [filter.category];
        filtered = filtered.filter((i: any) => cats.includes(i.category));
      }
      return filtered;
    },
    // 审核不需要的方法 stub（调用即抛错，防止误用）
    listQuests: async () => { throw new Error('shadowSavePoolProvider.listQuests not implemented'); },
    listSkills: async () => { throw new Error('shadowSavePoolProvider.listSkills not implemented'); },
    listDialogues: async () => { throw new Error('shadowSavePoolProvider.listDialogues not implemented'); },
    listEvents: async () => { throw new Error('shadowSavePoolProvider.listEvents not implemented'); },
    getCombatState: async () => { throw new Error('shadowSavePoolProvider.getCombatState not implemented'); },
  };
}
