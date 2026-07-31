import { Knex } from 'knex';

/**
 * 007: combat_states 表新增 mode 列。
 *
 * 设计文档: docs/design/fractal-design-20260723-game-combat-mode-separation/code-design-20260723-game-combat-mode-separation.md §9.1
 *
 * 改造目标：
 * - combat_states 表新增 mode 列，存储 ChallengeMode 值
 * - 默认值 'turn_based_combat'（兼容存量战斗记录，回退的代码都是有问题的——存量数据全部视为回合制战斗）
 * - 路由层 ModeRouter 通过此列判定是否在挑战中（mode != null 即在挑战中）
 *
 * 幂等性：检查列是否存在，存在则跳过。
 *
 * 注意：SQLite ALTER TABLE 添加 NOT NULL 列必须提供 DEFAULT 值。
 *       turn_based_combat 作为默认值符合现有数据语义（存量 combat_states 全部是回合制战斗）。
 */
export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('combat_states', 'mode');
  if (!hasColumn) {
    await knex.raw(
      "ALTER TABLE combat_states ADD COLUMN mode TEXT NOT NULL DEFAULT 'turn_based_combat'"
    );
    console.log('007: added combat_states.mode column');
  } else {
    console.log('007: combat_states.mode column already exists, skipping');
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('combat_states', 'mode');
  if (hasColumn) {
    // SQLite 旧版本不支持 DROP COLUMN，使用重建表策略
    // 但本迁移为开发阶段迁移，down 仅用于回滚测试，不要求保留数据
    await knex.raw('ALTER TABLE combat_states DROP COLUMN mode');
    console.log('007: dropped combat_states.mode column');
  }
}
