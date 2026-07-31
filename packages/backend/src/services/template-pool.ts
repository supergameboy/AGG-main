import type { Knex } from 'knex';
import { createChildLogger } from '../utils/logger.js';
import { parseJsonField } from '../utils/pool-helpers.js';
import { ID, Timestamp, generateDeterministicId } from '../../../shared/src/types/core.js';
import { parseCostArray } from '../../../shared/src/types/game.js';
import type {
  TemplateSkillPoolEntry,
  TemplateItemPoolEntry,
  SkillCostEntry,
  ItemEffect,
  ItemValue,
  ItemCategory,
  ItemQuality,
} from '../../../shared/src/types/game.js';
import type { ITemplatePoolProvider } from '../game-systems/shared/types.js';

const logger = createChildLogger('template-pool');

// YAML 字段校验用合法枚举（与 shared/types/game.ts 的 ItemCategory/ItemQuality 保持一致）
const VALID_ITEM_CATEGORIES = ['weapon', 'armor', 'accessory', 'consumable', 'material', 'tool', 'quest', 'misc'] as const;
const VALID_ITEM_QUALITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;

// ---------------------------------------------------------------------------
// 创建参数接口
// ---------------------------------------------------------------------------

export interface CreateTemplateSkillParams {
  name: string;
  description?: string;
  category?: string;
  element?: string;
  icon?: string;
  cost?: SkillCostEntry[];
  damage?: Record<string, unknown>;
  effects?: Array<Record<string, unknown>>;
  cooldown?: number;
  maxLevel?: number;
  targetType?: string;
  range?: number;
  customData?: Record<string, unknown>;
  recommendedClasses?: string[];
  source?: 'manual' | 'generated';
}

export interface CreateTemplateItemParams {
  name: string;
  description?: string;
  category?: ItemCategory;
  quality?: ItemQuality;
  icon?: string;
  stats?: Record<string, number>;
  effects?: ItemEffect[];
  value?: ItemValue;
  tags?: string[];
  weight?: number;
  maxStack?: number;
  equippedSlot?: string | null;
  durability?: number;
  maxDurability?: number;
  customData?: Record<string, unknown>;
  recommendedClasses?: string[];
  source?: 'manual' | 'generated';
}

// ---------------------------------------------------------------------------
// TemplatePoolService
// ---------------------------------------------------------------------------

export class TemplatePoolService implements ITemplatePoolProvider {
  private db: Knex;
  private logger: ReturnType<typeof createChildLogger>;

  constructor(db: Knex) {
    this.db = db;
    this.logger = logger;
  }

  // =========================================================================
  // 技能池
  // =========================================================================

  async createSkill(templateId: ID, params: CreateTemplateSkillParams, trx?: Knex): Promise<TemplateSkillPoolEntry> {
    // 注：单条 createSkill 保留供 TemplatePoolServiceTool.add_template_pool_skills 批量写入路径使用
    // 游戏模块回写模板池统一走 upsertSkill（findByName + update/create）
    const db = trx ?? this.db;
    const id = generateDeterministicId('tskill', templateId, params.name) as ID;
    const now = Date.now() as Timestamp;

    await db('template_skill_pool').insert({
      template_id: templateId,
      id,
      name: params.name,
      description: params.description ?? '',
      category: params.category ?? 'attack',
      element: params.element ?? 'physical',
      icon: params.icon ?? '',
      cost: JSON.stringify(params.cost ?? []),
      damage: JSON.stringify(params.damage ?? {}),
      effects: JSON.stringify(params.effects ?? []),
      cooldown: params.cooldown ?? 0,
      max_level: params.maxLevel ?? 10,
      target_type: params.targetType ?? 'single',
      range: params.range ?? 1,
      custom_data: JSON.stringify(params.customData ?? {}),
      recommended_classes: JSON.stringify(params.recommendedClasses ?? []),
      source: params.source ?? 'manual',
      created_at: now,
      updated_at: now,
    });

    this.logger.info('Template skill created', { templateId, skillId: id, name: params.name });

    const row = await db('template_skill_pool')
      .where({ template_id: templateId, id })
      .first();
    return this.rowToPoolSkill(row);
  }

  /**
   * 按名称 upsert 技能池条目（程序内部固定调用，游戏模块回写模板池统一入口）。
   * - 存在同名条目：用新数据覆盖（updateSkill）
   * - 不存在：创建新条目（createSkill）
   * 设计原则：create 和 upsert 合并为统一方法，固定调用（程序层面）。
   * LLM 工具层面不动（learn_skill / create_skill / add_pool_skill 等保持不变）。
   */
  async upsertSkill(templateId: ID, params: CreateTemplateSkillParams): Promise<TemplateSkillPoolEntry> {
    const existing = await this.findSkillByName(templateId, params.name);
    if (existing) {
      const updated = await this.updateSkill(templateId, existing.id, params);
      return updated ?? existing;
    }
    return this.createSkill(templateId, params);
  }

  async createSkills(templateId: ID, paramsList: CreateTemplateSkillParams[], trx?: Knex): Promise<TemplateSkillPoolEntry[]> {
    const db = trx ?? this.db;
    const now = Date.now() as Timestamp;
    const rows = paramsList.map(params => ({
      template_id: templateId,
      id: generateDeterministicId('tskill', templateId, params.name) as ID,
      name: params.name,
      description: params.description ?? '',
      category: params.category ?? 'attack',
      element: params.element ?? 'physical',
      icon: params.icon ?? '',
      cost: JSON.stringify(params.cost ?? []),
      damage: JSON.stringify(params.damage ?? {}),
      effects: JSON.stringify(params.effects ?? []),
      cooldown: params.cooldown ?? 0,
      max_level: params.maxLevel ?? 10,
      target_type: params.targetType ?? 'single',
      range: params.range ?? 1,
      custom_data: JSON.stringify(params.customData ?? {}),
      recommended_classes: JSON.stringify(params.recommendedClasses ?? []),
      source: params.source ?? 'manual',
      created_at: now,
      updated_at: now,
    }));

    await db('template_skill_pool').insert(rows);

    this.logger.info('Template skills batch created', { templateId, count: rows.length });

    const inserted = await db('template_skill_pool')
      .where({ template_id: templateId })
      .where('created_at', now)
      .orderBy('created_at', 'asc');
    return inserted.map(row => this.rowToPoolSkill(row));
  }

  async listSkills(
    templateId: ID,
    options?: { category?: string; recommendedClass?: string },
  ): Promise<TemplateSkillPoolEntry[]> {
    let query = this.db('template_skill_pool').where({ template_id: templateId });

    if (options?.category) {
      query = query.where({ category: options.category });
    }

    const rows = await query.orderBy('created_at', 'asc');

    let results = rows.map(row => this.rowToPoolSkill(row));

    if (options?.recommendedClass) {
      const cls = options.recommendedClass;
      results = results.filter(
        entry => entry.recommendedClasses.includes(cls) || entry.recommendedClasses.length === 0,
      );
    }

    return results;
  }

  async getSkill(templateId: ID, skillId: string): Promise<TemplateSkillPoolEntry | null> {
    const row = await this.db('template_skill_pool')
      .where({ template_id: templateId, id: skillId })
      .first();
    if (!row) return null;
    return this.rowToPoolSkill(row);
  }

  async findSkillByName(templateId: ID, name: string): Promise<TemplateSkillPoolEntry | null> {
    const row = await this.db('template_skill_pool')
      .where({ template_id: templateId, name })
      .first();
    if (!row) return null;
    return this.rowToPoolSkill(row);
  }

  async updateSkill(templateId: ID, skillId: string, updates: Partial<CreateTemplateSkillParams>): Promise<TemplateSkillPoolEntry | null> {
    const row: Record<string, unknown> = { updated_at: Date.now() as Timestamp };

    if (updates.name !== undefined) row.name = updates.name;
    if (updates.description !== undefined) row.description = updates.description;
    if (updates.category !== undefined) row.category = updates.category;
    if (updates.element !== undefined) row.element = updates.element;
    if (updates.icon !== undefined) row.icon = updates.icon;
    if (updates.cost !== undefined) row.cost = JSON.stringify(updates.cost);
    if (updates.damage !== undefined) row.damage = JSON.stringify(updates.damage);
    if (updates.effects !== undefined) row.effects = JSON.stringify(updates.effects);
    if (updates.cooldown !== undefined) row.cooldown = updates.cooldown;
    if (updates.maxLevel !== undefined) row.max_level = updates.maxLevel;
    if (updates.targetType !== undefined) row.target_type = updates.targetType;
    if (updates.range !== undefined) row.range = updates.range;
    if (updates.customData !== undefined) row.custom_data = JSON.stringify(updates.customData);
    if (updates.recommendedClasses !== undefined) row.recommended_classes = JSON.stringify(updates.recommendedClasses);
    if (updates.source !== undefined) row.source = updates.source;

    const updated = await this.db('template_skill_pool')
      .where({ template_id: templateId, id: skillId })
      .update(row);

    if (updated === 0) return null;

    this.logger.info('Template skill updated', { templateId, skillId });
    return this.getSkill(templateId, skillId);
  }

  async removeSkill(templateId: ID, skillId: string): Promise<boolean> {
    const deleted = await this.db('template_skill_pool')
      .where({ template_id: templateId, id: skillId })
      .delete();
    if (deleted > 0) {
      this.logger.info('Template skill removed', { templateId, skillId });
    }
    return deleted > 0;
  }

  async clearSkills(templateId: ID): Promise<number> {
    const deleted = await this.db('template_skill_pool')
      .where({ template_id: templateId })
      .delete();
    this.logger.info('Template skills cleared', { templateId, count: deleted });
    return deleted;
  }

  /**
   * 用 YAML 模板数据预填技能池（系统级操作，非 LLM 路径）。
   * - 先删除该 templateId 下 source='manual' 的旧数据（保留 LLM 生成的 source='generated' 数据）
   * - 再从 YAML skills 数组批量写入新数据，source='manual'
   * - 幂等：多次调用结果一致（先清后写）
   * 由 TemplateService.syncYamlToDb 在 YAML 同步后调用。
   */
  async replaceYamlSkills(templateId: ID, yamlSkills: Array<Record<string, unknown>>): Promise<number> {
    if (yamlSkills.length === 0) {
      // YAML 中无 skills 定义，仅清除旧数据
      const deleted = await this.db('template_skill_pool')
        .where({ template_id: templateId, source: 'manual' })
        .delete();
      if (deleted > 0) {
        this.logger.info('YAML skills cleared (no new data)', { templateId, count: deleted });
      }
      return 0;
    }

    const now = Date.now() as Timestamp;
    const rows = yamlSkills.map(skill => {
      // YAML skill 缺失 name 和 id 时抛错——Math.random() 生成的 ID 无意义且不可重现，掩盖 YAML 数据缺陷
      const skillSeed = skill.name ?? skill.id;
      if (!skillSeed) {
        throw new Error(`YAML skill 缺失 name 和 id 字段，无法生成 ID: ${JSON.stringify(skill).substring(0, 200)}`);
      }
      return {
        template_id: templateId,
        id: generateDeterministicId('tskill', templateId, String(skillSeed)) as ID,
        name: String(skill.name ?? ''),
        description: String(skill.description ?? ''),
        category: String(skill.category ?? 'attack'),
        element: String(skill.element ?? 'physical'),
        icon: String(skill.icon ?? ''),
        cost: JSON.stringify(skill.cost ?? []),
        damage: JSON.stringify(skill.damage ?? {}),
        effects: JSON.stringify(skill.effects ?? []),
        cooldown: Number(skill.cooldown ?? 0),
        max_level: Number(skill.max_level ?? skill.maxLevel ?? 10),
        target_type: String(skill.target_type ?? skill.targetType ?? 'single'),
        range: Number(skill.range ?? 1),
        custom_data: JSON.stringify(skill.custom_data ?? skill.customData ?? {}),
        recommended_classes: JSON.stringify(skill.recommended_classes ?? skill.recommendedClasses ?? []),
        source: 'manual',
        created_at: now,
        updated_at: now,
      };
    });

    await this.db.transaction(async (trx) => {
      await trx('template_skill_pool')
        .where({ template_id: templateId, source: 'manual' })
        .delete();
      await trx('template_skill_pool').insert(rows);
    });

    this.logger.info('YAML skills prefilled', { templateId, count: rows.length });
    return rows.length;
  }

  // =========================================================================
  // 物品池
  // =========================================================================

  async createItem(templateId: ID, params: CreateTemplateItemParams, trx?: Knex): Promise<TemplateItemPoolEntry> {
    const db = trx ?? this.db;
    const id = generateDeterministicId('titem', templateId, params.name) as ID;
    const now = Date.now() as Timestamp;

    await db('template_item_pool').insert({
      template_id: templateId,
      id,
      name: params.name,
      description: params.description ?? '',
      category: params.category ?? 'misc',
      quality: params.quality ?? 'common',
      icon: params.icon ?? '',
      stats: JSON.stringify(params.stats ?? {}),
      effects: JSON.stringify(params.effects ?? []),
      value: JSON.stringify(params.value ?? {}),
      tags: JSON.stringify(params.tags ?? []),
      weight: params.weight ?? 1,
      max_stack: params.maxStack ?? 99,
      equipped_slot: params.equippedSlot ?? null,
      durability: params.durability ?? 100,
      max_durability: params.maxDurability ?? 100,
      custom_data: JSON.stringify(params.customData ?? {}),
      recommended_classes: JSON.stringify(params.recommendedClasses ?? []),
      source: params.source ?? 'manual',
      created_at: now,
      updated_at: now,
    });

    this.logger.info('Template item created', { templateId, itemId: id, name: params.name });

    const row = await db('template_item_pool')
      .where({ template_id: templateId, id })
      .first();
    return this.rowToPoolItem(row);
  }

  /**
   * 按名称 upsert 物品池条目（程序内部固定调用，游戏模块回写模板池统一入口）。
   * - 存在同名条目：用新数据覆盖（updateItem）
   * - 不存在：创建新条目（createItem）
   * 设计原则：create 和 upsert 合并为统一方法，固定调用（程序层面）。
   */
  async upsertItem(templateId: ID, params: CreateTemplateItemParams): Promise<TemplateItemPoolEntry> {
    const existing = await this.findItemByName(templateId, params.name);
    if (existing) {
      const updated = await this.updateItem(templateId, existing.id, params);
      return updated ?? existing;
    }
    return this.createItem(templateId, params);
  }

  async createItems(templateId: ID, paramsList: CreateTemplateItemParams[], trx?: Knex): Promise<TemplateItemPoolEntry[]> {
    const db = trx ?? this.db;
    const now = Date.now() as Timestamp;
    const rows = paramsList.map(params => ({
      template_id: templateId,
      id: generateDeterministicId('titem', templateId, params.name) as ID,
      name: params.name,
      description: params.description ?? '',
      category: params.category ?? 'misc',
      quality: params.quality ?? 'common',
      icon: params.icon ?? '',
      stats: JSON.stringify(params.stats ?? {}),
      effects: JSON.stringify(params.effects ?? []),
      value: JSON.stringify(params.value ?? {}),
      tags: JSON.stringify(params.tags ?? []),
      weight: params.weight ?? 1,
      max_stack: params.maxStack ?? 99,
      equipped_slot: params.equippedSlot ?? null,
      durability: params.durability ?? 100,
      max_durability: params.maxDurability ?? 100,
      custom_data: JSON.stringify(params.customData ?? {}),
      recommended_classes: JSON.stringify(params.recommendedClasses ?? []),
      source: params.source ?? 'manual',
      created_at: now,
      updated_at: now,
    }));

    await db('template_item_pool').insert(rows);

    this.logger.info('Template items batch created', { templateId, count: rows.length });

    const inserted = await db('template_item_pool')
      .where({ template_id: templateId })
      .where('created_at', now)
      .orderBy('created_at', 'asc');
    return inserted.map(row => this.rowToPoolItem(row));
  }

  async listItems(
    templateId: ID,
    options?: { category?: string; equippedSlot?: string; recommendedClass?: string; quality?: string },
  ): Promise<TemplateItemPoolEntry[]> {
    let query = this.db('template_item_pool').where({ template_id: templateId });

    if (options?.category) {
      query = query.where({ category: options.category });
    }
    if (options?.equippedSlot) {
      query = query.where({ equipped_slot: options.equippedSlot });
    }
    if (options?.quality) {
      query = query.where({ quality: options.quality });
    }

    const rows = await query.orderBy('created_at', 'asc');

    let results = rows.map(row => this.rowToPoolItem(row));

    if (options?.recommendedClass) {
      const cls = options.recommendedClass;
      results = results.filter(
        entry => entry.recommendedClasses.includes(cls) || entry.recommendedClasses.length === 0,
      );
    }

    return results;
  }

  async getItem(templateId: ID, itemId: string): Promise<TemplateItemPoolEntry | null> {
    const row = await this.db('template_item_pool')
      .where({ template_id: templateId, id: itemId })
      .first();
    if (!row) return null;
    return this.rowToPoolItem(row);
  }

  async findItemByName(templateId: ID, name: string): Promise<TemplateItemPoolEntry | null> {
    const row = await this.db('template_item_pool')
      .where({ template_id: templateId, name })
      .first();
    if (!row) return null;
    return this.rowToPoolItem(row);
  }

  async updateItem(templateId: ID, itemId: string, updates: Partial<CreateTemplateItemParams>): Promise<TemplateItemPoolEntry | null> {
    const row: Record<string, unknown> = { updated_at: Date.now() as Timestamp };

    if (updates.name !== undefined) row.name = updates.name;
    if (updates.description !== undefined) row.description = updates.description;
    if (updates.category !== undefined) row.category = updates.category;
    if (updates.quality !== undefined) row.quality = updates.quality;
    if (updates.icon !== undefined) row.icon = updates.icon;
    if (updates.stats !== undefined) row.stats = JSON.stringify(updates.stats);
    if (updates.effects !== undefined) row.effects = JSON.stringify(updates.effects);
    if (updates.value !== undefined) row.value = JSON.stringify(updates.value);
    if (updates.tags !== undefined) row.tags = JSON.stringify(updates.tags);
    if (updates.weight !== undefined) row.weight = updates.weight;
    if (updates.maxStack !== undefined) row.max_stack = updates.maxStack;
    if (updates.equippedSlot !== undefined) row.equipped_slot = updates.equippedSlot;
    if (updates.durability !== undefined) row.durability = updates.durability;
    if (updates.maxDurability !== undefined) row.max_durability = updates.maxDurability;
    if (updates.customData !== undefined) row.custom_data = JSON.stringify(updates.customData);
    if (updates.recommendedClasses !== undefined) row.recommended_classes = JSON.stringify(updates.recommendedClasses);
    if (updates.source !== undefined) row.source = updates.source;

    const updated = await this.db('template_item_pool')
      .where({ template_id: templateId, id: itemId })
      .update(row);

    if (updated === 0) return null;

    this.logger.info('Template item updated', { templateId, itemId });
    return this.getItem(templateId, itemId);
  }

  async removeItem(templateId: ID, itemId: string): Promise<boolean> {
    const deleted = await this.db('template_item_pool')
      .where({ template_id: templateId, id: itemId })
      .delete();
    if (deleted > 0) {
      this.logger.info('Template item removed', { templateId, itemId });
    }
    return deleted > 0;
  }

  async clearItems(templateId: ID): Promise<number> {
    const deleted = await this.db('template_item_pool')
      .where({ template_id: templateId })
      .delete();
    this.logger.info('Template items cleared', { templateId, count: deleted });
    return deleted;
  }

  /**
   * 用 YAML 模板数据预填物品池（系统级操作，非 LLM 路径）。
   * - 先删除该 templateId 下 source='manual' 的旧数据（保留 LLM 生成的 source='generated' 数据）
   * - 再从 YAML items 数组批量写入新数据，source='manual'
   * - 幂等：多次调用结果一致（先清后写）
   * 由 TemplateService.syncYamlToDb 在 YAML 同步后调用。
   */
  async replaceYamlItems(templateId: ID, yamlItems: Array<Record<string, unknown>>): Promise<number> {
    if (yamlItems.length === 0) {
      const deleted = await this.db('template_item_pool')
        .where({ template_id: templateId, source: 'manual' })
        .delete();
      if (deleted > 0) {
        this.logger.info('YAML items cleared (no new data)', { templateId, count: deleted });
      }
      return 0;
    }

    const now = Date.now() as Timestamp;
    const rows = yamlItems.map(item => {
      // YAML item 缺失 name 和 id 时抛错——Math.random() 生成的 ID 无意义且不可重现，掩盖 YAML 数据缺陷
      const itemSeed = item.name ?? item.id;
      if (!itemSeed) {
        throw new Error(`YAML item 缺失 name 和 id 字段，无法生成 ID: ${JSON.stringify(item).substring(0, 200)}`);
      }
      // I5: 校验 category/quality 枚举值，禁止 as 强制转换绕过类型检查
      const category = String(item.category ?? 'misc');
      if (!VALID_ITEM_CATEGORIES.includes(category as typeof VALID_ITEM_CATEGORIES[number])) {
        throw new Error(`YAML item category 非法: ${category}，合法值: ${VALID_ITEM_CATEGORIES.join(', ')}`);
      }
      const quality = String(item.quality ?? 'common');
      if (!VALID_ITEM_QUALITIES.includes(quality as typeof VALID_ITEM_QUALITIES[number])) {
        throw new Error(`YAML item quality 非法: ${quality}，合法值: ${VALID_ITEM_QUALITIES.join(', ')}`);
      }
      return {
        template_id: templateId,
        id: generateDeterministicId('titem', templateId, String(itemSeed)) as ID,
        name: String(item.name ?? ''),
        description: String(item.description ?? ''),
        category: category as ItemCategory,
        quality: quality as ItemQuality,
        icon: String(item.icon ?? ''),
        stats: JSON.stringify(item.stats ?? {}),
        effects: JSON.stringify(item.effects ?? []),
        value: JSON.stringify(item.value ?? {}),
        tags: JSON.stringify(item.tags ?? []),
        weight: Number(item.weight ?? 1),
        max_stack: Number(item.max_stack ?? item.maxStack ?? 99),
        equipped_slot: (item.equipped_slot ?? item.equippedSlot ?? null) as string | null,
        durability: Number(item.durability ?? 100),
        max_durability: Number(item.max_durability ?? item.maxDurability ?? 100),
        custom_data: JSON.stringify(item.custom_data ?? item.customData ?? {}),
        recommended_classes: JSON.stringify(item.recommended_classes ?? item.recommendedClasses ?? []),
        source: 'manual',
        created_at: now,
        updated_at: now,
      };
    });

    await this.db.transaction(async (trx) => {
      await trx('template_item_pool')
        .where({ template_id: templateId, source: 'manual' })
        .delete();
      await trx('template_item_pool').insert(rows);
    });

    this.logger.info('YAML items prefilled', { templateId, count: rows.length });
    return rows.length;
  }

  // =========================================================================
  // 统计
  // =========================================================================

  async getPoolStats(templateId: ID): Promise<{
    skillCount: number;
    itemCount: number;
    skillCategories: Record<string, number>;
    itemCategories: Record<string, number>;
  }> {
    const [skillRows, itemRows] = await Promise.all([
      this.db('template_skill_pool').where({ template_id: templateId }).select('category'),
      this.db('template_item_pool').where({ template_id: templateId }).select('category'),
    ]);

    const skillCategories: Record<string, number> = {};
    for (const r of skillRows) {
      const cat = r.category as string;
      skillCategories[cat] = (skillCategories[cat] ?? 0) + 1;
    }

    const itemCategories: Record<string, number> = {};
    for (const r of itemRows) {
      const cat = r.category as string;
      itemCategories[cat] = (itemCategories[cat] ?? 0) + 1;
    }

    return {
      skillCount: skillRows.length,
      itemCount: itemRows.length,
      skillCategories,
      itemCategories,
    };
  }

  // =========================================================================
  // 行映射：DB snake_case → TS camelCase
  // =========================================================================

  private rowToPoolSkill(row: Record<string, unknown>): TemplateSkillPoolEntry {
    return {
      id: row.id as string,
      templateId: row.template_id as string,
      name: row.name as string,
      description: (row.description as string) || '',
      category: (row.category as string) || 'attack',
      element: (row.element as string) || 'physical',
      icon: (row.icon as string) || '',
      cost: parseCostArray(row.cost),
      damage: parseJsonField<Record<string, unknown>>(row.damage, {}),
      effects: parseJsonField<Array<Record<string, unknown>>>(row.effects, []),
      cooldown: row.cooldown as number,
      maxLevel: row.max_level as number,
      targetType: (row.target_type as string) || 'single',
      range: row.range as number,
      customData: parseJsonField<Record<string, unknown>>(row.custom_data, {}),
      recommendedClasses: parseJsonField<string[]>(row.recommended_classes, []),
      source: (row.source as 'manual' | 'generated') || 'manual',
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  private rowToPoolItem(row: Record<string, unknown>): TemplateItemPoolEntry {
    return {
      id: row.id as string,
      templateId: row.template_id as string,
      name: row.name as string,
      description: (row.description as string) || '',
      category: (row.category as ItemCategory) || 'misc',
      quality: (row.quality as ItemQuality) || 'common',
      icon: (row.icon as string) || '',
      stats: parseJsonField<Record<string, number>>(row.stats, {}),
      effects: parseJsonField<ItemEffect[]>(row.effects, []),
      value: parseJsonField<ItemValue>(row.value, {}),
      tags: parseJsonField<string[]>(row.tags, []),
      weight: row.weight as number,
      maxStack: row.max_stack as number,
      equippedSlot: (row.equipped_slot as string) || null,
      durability: row.durability as number,
      maxDurability: row.max_durability as number,
      customData: parseJsonField<Record<string, unknown>>(row.custom_data, {}),
      recommendedClasses: parseJsonField<string[]>(row.recommended_classes, []),
      source: (row.source as 'manual' | 'generated') || 'manual',
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }
}
