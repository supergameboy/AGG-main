import type { Knex } from 'knex';
import type { ID } from '../../../../shared/src/types/core.js';
import type { ISaveDataPort, SaveDataBundle } from './types.js';

/**
 * ISaveDataPort 实现：门面端口模式，为 save 领域提供跨领域表的批量操作入口。
 *
 * 设计依据（§四 B6）：
 * - 聚合 19 张跨领域业务表的批量 CRUD（load/delete/copy/restore）
 * - 不违反 D3：Port 是 save 领域的边界，封装跨领域访问，SaveService 不再直接访问这些表
 * - 事务由 Service 层管理（D9），Port 方法接收 trx 参数透传
 *
 * 实现说明：
 * SaveDataBundle 存储 Record<string, unknown>[]（原始行），不做 row → entity 映射。
 * JSON 字段解析和业务逻辑由 SaveService 层处理。
 */
export class SaveDataPort implements ISaveDataPort {
  constructor(private readonly db: Knex) {}

  async loadAllSaveData(saveId: ID, trx?: Knex.Transaction): Promise<SaveDataBundle> {
    const q = trx ?? this.db;

    const [
      characters,
      inventory,
      item_pool,
      skill_pool,
      character_skills,
      quests,
      quest_objectives,
      npcs,
      npc_goals,
      locations,
      location_connections,
      discovered_locations,
      dialogues,
      agent_contexts,
      decision_logs,
      agent_schedules,
      save_data_indexes,
      save_write_logs,
    ] = await Promise.all([
      q('characters').where({ save_id: saveId }).select(),
      q('inventory').where({ save_id: saveId }).select(),
      q('item_pool').where({ save_id: saveId }).select(),
      q('skill_pool').where({ save_id: saveId }).select(),
      q('character_skills').where({ save_id: saveId }).select(),
      q('quests').where({ save_id: saveId }).select(),
      q('quest_objectives').where({ save_id: saveId }).select(),
      q('npcs').where({ save_id: saveId }).select(),
      q('npc_goals').where({ save_id: saveId }).select(),
      // 模块2 简化：删除 npc_relations 表查询（表已删除）
      q('locations').where({ save_id: saveId }).select(),
      q('location_connections').where({ save_id: saveId }).select(),
      q('discovered_locations').where({ save_id: saveId }).select(),
      q('dialogues').where({ save_id: saveId }).select(),
      q('agent_contexts').where({ save_id: saveId }).select(),
      q('decision_logs').where({ save_id: saveId }).select(),
      q('agent_schedules').where({ save_id: saveId }).select(),
      q('save_data_indexes').where({ save_id: saveId }).select(),
      q('save_write_logs').where({ save_id: saveId }).select(),
    ]);

    return {
      characters: characters as Record<string, unknown>[],
      inventory: inventory as Record<string, unknown>[],
      item_pool: item_pool as Record<string, unknown>[],
      skill_pool: skill_pool as Record<string, unknown>[],
      character_skills: character_skills as Record<string, unknown>[],
      quests: quests as Record<string, unknown>[],
      quest_objectives: quest_objectives as Record<string, unknown>[],
      npcs: npcs as Record<string, unknown>[],
      npc_goals: npc_goals as Record<string, unknown>[],
      // 模块2 简化：删除 npc_relations 字段映射（表已删除）
      locations: locations as Record<string, unknown>[],
      location_connections: location_connections as Record<string, unknown>[],
      discovered_locations: discovered_locations as Record<string, unknown>[],
      dialogues: dialogues as Record<string, unknown>[],
      agent_contexts: agent_contexts as Record<string, unknown>[],
      decision_logs: decision_logs as Record<string, unknown>[],
      agent_schedules: agent_schedules as Record<string, unknown>[],
      save_data_indexes: save_data_indexes as Record<string, unknown>[],
      save_write_logs: save_write_logs as Record<string, unknown>[],
    };
  }

  async deleteAllSaveData(saveId: ID, trx?: Knex.Transaction): Promise<void> {
    const q = trx ?? this.db;

    // 按外键依赖顺序删除：先删子表再删父表
    // quest_objectives 依赖 quests（通过 quest_id）
    await q('quest_objectives').where({ save_id: saveId }).del();

    // dialogues 外键引用 npcs，必须在 npcs 之前删除
    await q('dialogues').where({ save_id: saveId }).del();

    // discovered_locations 依赖 locations
    await q('discovered_locations').where({ save_id: saveId }).del();

    // location_connections 依赖 locations
    await q('location_connections').where({ save_id: saveId }).del();
    await q('locations').where({ save_id: saveId }).del();

    // npc_goals 依赖 npcs（模块2 简化：npc_relations 表已删除）
    await q('npc_goals').where({ save_id: saveId }).del();
    await q('npcs').where({ save_id: saveId }).del();

    // 其余表按 save_id 直接删除
    await q('characters').where({ save_id: saveId }).del();
    await q('inventory').where({ save_id: saveId }).del();
    await q('item_pool').where({ save_id: saveId }).del();
    await q('skill_pool').where({ save_id: saveId }).del();
    await q('character_skills').where({ save_id: saveId }).del();
    await q('quests').where({ save_id: saveId }).del();
    await q('agent_contexts').where({ save_id: saveId }).del();
    await q('decision_logs').where({ save_id: saveId }).del();
    await q('agent_schedules').where({ save_id: saveId }).del();
    await q('save_data_indexes').where({ save_id: saveId }).del();
    await q('save_write_logs').where({ save_id: saveId }).del();
  }

  async copyAllSaveData(sourceSaveId: ID, newSaveId: ID, trx?: Knex.Transaction): Promise<void> {
    const q = trx ?? this.db;

    // 按表逐一读取源数据，替换 save_id 后插入
    const tables: string[] = [
      'characters', 'inventory', 'item_pool', 'skill_pool', 'character_skills',
      'quests', 'quest_objectives', 'npcs', 'npc_goals',
      // 模块2 简化：删除 npc_relations 表（表已删除）
      'locations', 'location_connections', 'discovered_locations',
      'dialogues', 'agent_contexts', 'decision_logs', 'agent_schedules',
      'save_data_indexes', 'save_write_logs',
    ];

    for (const table of tables) {
      const rows = await q(table).where({ save_id: sourceSaveId }).select();
      if (rows.length === 0) continue;
      const newRows = rows.map((row: Record<string, unknown>) => ({ ...row, save_id: newSaveId }));
      await q(table).insert(newRows);
    }
  }

  async restoreAllSaveData(saveId: ID, data: SaveDataBundle, trx?: Knex.Transaction): Promise<void> {
    const q = trx ?? this.db;
    const has = (arr: unknown[]) => arr.length > 0;

    // 快照恢复：只处理 14 张快照表，不触碰 agent_contexts/decision_logs/
    // agent_schedules/save_data_indexes/save_write_logs（这些不在快照中，保留现有数据）
    //
    // 删除+插入按外键依赖顺序：
    // - 子表先删，父表后删
    // - 父表先插，子表后插
    // - 仅当父表有数据时整组删除+插入；独立表单独判断

    // === Quests 组（quest_objectives 依赖 quests） ===
    if (has(data.quests)) {
      await q('quest_objectives').where({ save_id: saveId }).del();
      await q('quests').where({ save_id: saveId }).del();
      await q('quests').insert(data.quests.map(r => ({ ...r, save_id: saveId })));
      if (has(data.quest_objectives)) {
        await q('quest_objectives').insert(data.quest_objectives.map(r => ({ ...r, save_id: saveId })));
      }
    }

    // === NPCs 组（dialogues/npc_goals 依赖 npcs，模块2 简化：npc_relations 表已删除） ===
    if (has(data.npcs)) {
      await q('dialogues').where({ save_id: saveId }).del();
      await q('npc_goals').where({ save_id: saveId }).del();
      // 模块2 简化：删除 npc_relations 表清理（表已删除）
      await q('npcs').where({ save_id: saveId }).del();
      await q('npcs').insert(data.npcs.map(r => ({ ...r, save_id: saveId })));
      if (has(data.npc_goals)) {
        await q('npc_goals').insert(data.npc_goals.map(r => ({ ...r, save_id: saveId })));
      }
      // 模块2 简化：删除 npc_relations 插入（表已删除）
      if (has(data.dialogues)) {
        await q('dialogues').insert(data.dialogues.map(r => ({ ...r, save_id: saveId })));
      }
    } else if (has(data.dialogues)) {
      // dialogues 可独立恢复（无 npcs 时）
      await q('dialogues').where({ save_id: saveId }).del();
      await q('dialogues').insert(data.dialogues.map(r => ({ ...r, save_id: saveId })));
    }

    // === Locations 组（discovered_locations/location_connections 依赖 locations） ===
    if (has(data.locations)) {
      await q('discovered_locations').where({ save_id: saveId }).del();
      await q('location_connections').where({ save_id: saveId }).del();
      await q('locations').where({ save_id: saveId }).del();
      await q('locations').insert(data.locations.map(r => ({ ...r, save_id: saveId })));
      if (has(data.location_connections)) {
        await q('location_connections').insert(data.location_connections.map(r => ({ ...r, save_id: saveId })));
      }
      if (has(data.discovered_locations)) {
        await q('discovered_locations').insert(data.discovered_locations.map(r => ({ ...r, save_id: saveId })));
      }
    }

    // === 独立表（无外键依赖） ===
    if (has(data.characters)) {
      await q('characters').where({ save_id: saveId }).del();
      await q('characters').insert(data.characters.map(r => ({ ...r, save_id: saveId })));
    }
    if (has(data.inventory)) {
      await q('inventory').where({ save_id: saveId }).del();
      await q('inventory').insert(data.inventory.map(r => ({ ...r, save_id: saveId })));
    }
    if (has(data.item_pool)) {
      await q('item_pool').where({ save_id: saveId }).del();
      await q('item_pool').insert(data.item_pool.map(r => ({ ...r, save_id: saveId })));
    }
    if (has(data.skill_pool)) {
      await q('skill_pool').where({ save_id: saveId }).del();
      await q('skill_pool').insert(data.skill_pool.map(r => ({ ...r, save_id: saveId })));
    }
    if (has(data.character_skills)) {
      await q('character_skills').where({ save_id: saveId }).del();
      await q('character_skills').insert(data.character_skills.map(r => ({ ...r, save_id: saveId })));
    }
  }

  async getTemplateCharacterCreation(templateId: ID, trx?: Knex.Transaction): Promise<Record<string, unknown> | null> {
    const q = trx ?? this.db;
    const row = await q('templates').where({ id: templateId }).first();
    if (!row) return null;
    const cc = typeof row.character_creation === 'string'
      ? JSON.parse(row.character_creation)
      : row.character_creation;
    return cc as Record<string, unknown> | null;
  }

  async hasCheckpointContext(saveId: ID, trx?: Knex.Transaction): Promise<boolean> {
    const q = trx ?? this.db;
    const row = await q('agent_contexts')
      .where({ save_id: saveId })
      .where('state', 'like', '%_checkpoint%')
      .first();
    return !!row;
  }
}
