import { Knex } from 'knex';

/**
 * 002: inventory 表新增 equipped_index 列。
 *
 * 用途：饰品槽完全数组化改造（accessory1/accessory2 → accessory + capacity:2）。
 * - equipped_index 为 null：单槽位装备或未装备
 * - equipped_index = 0：数组化槽位首位（最新装备）
 * - equipped_index = N：数组化槽位第 N 位（越大越旧）
 *
 * 设计文档：docs/design/fractal-design-20260712-equip-item-accessory-array/总规划.md
 * 用户决策：清空数据库（测试阶段无数据包袱），无需数据迁移。
 *
 * 幂等性：001_init.ts 已包含 equipped_index 列定义，本迁移仅对历史库（001 之前创建）补充列。
 */
export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('inventory', 'equipped_index');
  if (!hasColumn) {
    await knex.raw('ALTER TABLE inventory ADD COLUMN equipped_index INTEGER');
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('inventory', 'equipped_index');
  if (hasColumn) {
    await knex.raw('ALTER TABLE inventory DROP COLUMN equipped_index');
  }
}
