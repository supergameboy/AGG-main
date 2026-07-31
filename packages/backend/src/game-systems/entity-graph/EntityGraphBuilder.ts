import type { IEntityGraphProvider } from '../shared/types.js';
import type {
  EntityGraphBuildContext,
  EntityType,
} from './types.js';
import type { OwnerType } from '../shared/entity-resolver/index.js';
import type { CharacterData } from '../character/types.js';
import { createChildLogger } from '../../utils/logger.js';
import { buildEntityNodeId } from '@ai-rpg/shared/utils/entity-graph-id';

const logger = createChildLogger('entity-graph-builder');

/**
 * EntityGraphBuilder（S5 重构 + 模块2 简化）。
 *
 * S5 之前：直接持有 db: Knex，12 张跨领域业务表访问（D3 严重违规）。
 * S5 之后：注入 IEntityGraphProvider（图写入）+ EntityGraphBuildContext（跨领域只读）。
 * 模块2 简化：删除 deriveExpectedGraph 方法，全量重建逻辑内联到 enrichFromExistingData。
 *
 * 跨领域访问改造：
 * - 12 张业务表 → 11 个 ReadPort 端口（event_triggers + events 合并为 IEventReadPort）
 * - db.schema.hasTable('factions') → factionPort.hasTable()
 * - db.schema.hasTable('npc_goals') → npcGoalPort.hasTable()
 * - getCharacterId(saveId, db) → characterPort.findBySaveId(saveId) 取首个
 *
 * 设计依据：A3 节 + D3 禁止跨领域表访问 + code-standards「一个概念只表达一次」。
 */
export class EntityGraphBuilder {
  constructor(private graphProvider: IEntityGraphProvider) {}

  /**
   * 全量构建图（初始化用 + Reconciler 兜底重建，upsert 语义幂等）。
   *
   * 从业务表当前状态派生期望图状态并 upsert 写入图数据。
   *
   * 【初始化豁免】不走 StagingPool（符合 §13.1 第4点）。
   * 原因：初始化路径在 ReAct 循环 flush 后调用；Reconciler 兜底路径在 flush 后触发，
   * 数据已落库，图写入使用 upsert 语义（幂等），通过 graphProvider 直写 DB。
   */
  async enrichFromExistingData(saveId: string, context: EntityGraphBuildContext): Promise<void> {
    // 1. Characters
    const characters = await context.characterPort.findBySaveId(saveId);
    for (const char of characters) {
      const charId = char.id as string;
      const charNodeId = buildEntityNodeId('character', saveId, charId);
      await this.graphProvider.upsertNode(
        saveId, 'character', charId, char.name as string,
        { race: char.race, class: char.class, level: char.level, age_group: char.age_group },
      );
      if (char.current_location_id) {
        const locNodeId = buildEntityNodeId('location', saveId, char.current_location_id as string);
        await this.graphProvider.upsertEdge(saveId, charNodeId, 'LOCATED_AT', locNodeId);
      }
    }

    // 2. NPCs
    const npcs = await context.npcPort.findBySaveId(saveId);
    for (const npc of npcs) {
      const npcId = npc.id as string;
      const npcNodeId = buildEntityNodeId('npc', saveId, npcId);
      await this.graphProvider.upsertNode(
        saveId, 'npc', npcId, npc.name as string,
        { role: npc.role, race: npc.race, level: npc.level },
      );
      if (npc.location_id) {
        const locNodeId = buildEntityNodeId('location', saveId, npc.location_id as string);
        await this.graphProvider.upsertEdge(saveId, npcNodeId, 'LOCATED_AT', locNodeId);
      }
      if (npc.in_party) {
        const partyLeaderId = characters[0]?.id as string;
        if (!partyLeaderId) {
          throw new Error(`NPC ${npcId} has in_party=true but no character found in save ${saveId}`);
        }
        const leaderNodeId = buildEntityNodeId('character', saveId, partyLeaderId);
        await this.graphProvider.upsertEdge(saveId, npcNodeId, 'PARTY_MEMBER', leaderNodeId);
      }
    }

    // 模块2 简化：删除 NPC Relations 派生段
    // （npc_relations 表已删除，PERCEIVES 边由 GM 通过 set_relationship 显式管理，
    //   不再派生 KNOWS/ALLIED_WITH/HOSTILE_TO 结构性关系边）

    // 4. Locations
    const locations = await context.locationPort.findBySaveId(saveId);
    for (const loc of locations) {
      const locId = loc.id as string;
      const locNodeId = buildEntityNodeId('location', saveId, locId);
      await this.graphProvider.upsertNode(
        saveId, 'location', locId, loc.name as string,
        {
          type: loc.type, terrain_type: loc.terrain_type, location_level: loc.location_level,
          parent_location_id: loc.parent_location_id,
          is_explored: loc.is_explored, danger_level: loc.danger_level,
        },
      );
      if (loc.parent_location_id && (loc.location_level as number) > 1) {
        const parentNodeId = buildEntityNodeId('location', saveId, loc.parent_location_id as string);
        await this.graphProvider.upsertEdge(saveId, locNodeId, 'BELONGS_TO', parentNodeId);
      }
    }

    // 5. Location Connections
    const connections = await context.locationConnectionPort.findBySaveId(saveId);
    for (const conn of connections) {
      const fromNodeId = buildEntityNodeId('location', saveId, conn.from_location_id as string);
      const toNodeId = buildEntityNodeId('location', saveId, conn.to_location_id as string);
      await this.graphProvider.upsertEdge(saveId, fromNodeId, 'CONNECTED_TO', toNodeId);
    }

    // 6. Inventory
    const inventory = await context.inventoryPort.findBySaveId(saveId);
    for (const item of inventory) {
      if (!item.owner_type || !item.owner_id) {
        throw new Error(`Inventory item ${item.id} missing owner_type/owner_id`);
      }
      const ownerType = item.owner_type as OwnerType;
      const ownerId = item.owner_id as string;
      const itemNodeId = buildEntityNodeId('item', saveId, item.id as string);
      const ownerNodeId = buildEntityNodeId(ownerType as EntityType, saveId, ownerId);
      await this.graphProvider.upsertNode(
        saveId, 'item', item.id as string,
        (item.name as string) || (item.item_id as string),
        { category: item.category, quality: item.quality },
      );
      await this.graphProvider.upsertEdge(saveId, ownerNodeId, 'OWNS', itemNodeId);
      if (item.equipped) {
        await this.graphProvider.upsertEdge(saveId, ownerNodeId, 'EQUIPPED_WITH', itemNodeId);
      }
    }

    // 7. Quests
    const quests = await context.questPort.findBySaveId(saveId);
    for (const quest of quests) {
      await this.graphProvider.upsertNode(
        saveId, 'quest', quest.id as string,
        (quest.title as string) || (quest.id as string),
        { status: quest.status, type: quest.type },
      );
    }

    // 8. Events (event_triggers + events 聚合查询)
    const triggerEvents = await context.eventPort.findTriggerEventsBySaveId(saveId);
    for (const event of triggerEvents) {
      await this.graphProvider.upsertNode(
        saveId, 'event', event.id as string,
        (event.name as string) || (event.id as string),
        { type: event.type, trigger_type: event.trigger_type },
      );
    }

    // 9. Factions (可选表)
    if (await context.factionPort.hasTable()) {
      const factions = await context.factionPort.findBySaveId(saveId);
      for (const faction of factions) {
        await this.graphProvider.upsertNode(
          saveId, 'faction', faction.id as string,
          faction.name as string, {},
        );
      }
    }

    // 10. Character Skills
    const charSkills = await context.characterSkillPort.findBySaveId(saveId);
    for (const cs of charSkills) {
      const skillId = cs.skill_id as string;
      const skillNodeId = buildEntityNodeId('skill', saveId, skillId);
      const skillName = (cs.name as string) || skillId;
      if (!cs.owner_type || !cs.owner_id) {
        throw new Error(`Character skill ${skillId} missing owner_type/owner_id`);
      }
      const ownerType = cs.owner_type as OwnerType;
      const ownerId = cs.owner_id as string;
      const ownerNodeId = buildEntityNodeId(ownerType as EntityType, saveId, ownerId);
      await this.graphProvider.upsertNode(
        saveId, 'skill', skillId, skillName,
        { category: cs.category, element: cs.element },
      );
      await this.graphProvider.upsertEdge(saveId, ownerNodeId, 'HAS_SKILL', skillNodeId);
    }

    // 11. NPC Goals (可选表)
    if (await context.npcGoalPort.hasTable()) {
      const goals = await context.npcGoalPort.findActiveBySaveId(saveId);
      for (const goal of goals) {
        const goalNodeId = buildEntityNodeId('goal', saveId, goal.id as string);
        const npcNodeId = buildEntityNodeId('npc', saveId, goal.npc_id as string);
        await this.graphProvider.upsertNode(
          saveId, 'goal', goal.id as string,
          goal.description as string,
          { type: goal.type, category: goal.category },
        );
        await this.graphProvider.upsertEdge(saveId, npcNodeId, 'PURSUES', goalNodeId);
      }
    }

    logger.info('Entity Graph enriched from existing data', { saveId });
  }

  /**
   * 确保角色节点存在于实体图中（初始化路径专用）。
   *
   * 【初始化豁免】不走 StagingPool（符合 §13.1 第4点）。
   * 原因：processInitialize 的 A1 步骤直接通过 CharacterService.createCharacter 写入
   * characters 表，不经过 StagingPool/EntityGraphUpdater，因此不会自动派生 character
   * 节点到 entity_graph_nodes。后续 ReAct 循环中 inventory_service.add_item 会通过
   * StagingPool 派生 OWNS 边指向 character 节点，若 character 节点缺失，审计会失败
   * （owner node missing）。
   *
   * 此方法在 A1 步骤后显式创建 character 节点，确保 ReAct 循环开始前图结构完整。
   * 使用 upsert 语义（幂等），重复调用无副作用。properties 与 enrichFromExistingData
   * 中 character 节点的 properties 保持一致（race/class/level/age_group）。
   *
   * @param saveId 存档 ID
   * @param character A1 步骤返回的 CharacterData
   */
  async ensureCharacterNode(
    saveId: string,
    character: CharacterData,
  ): Promise<void> {
    await this.graphProvider.upsertNode(
      saveId,
      'character',
      character.id,
      character.name,
      {
        race: character.race,
        class: character.class,
        level: character.level,
        age_group: character.ageGroup,
      },
    );
    if (character.currentLocationId) {
      const charNodeId = buildEntityNodeId('character', saveId, character.id);
      const locNodeId = buildEntityNodeId('location', saveId, character.currentLocationId);
      await this.graphProvider.upsertEdge(
        saveId,
        charNodeId,
        'LOCATED_AT',
        locNodeId,
      );
    }
  }

  // 模块2 简化：删除 mapDispositionToRelation 私有方法
  // （npc_relations 表已删除，不再需要 disposition → RelationType 映射）
}
