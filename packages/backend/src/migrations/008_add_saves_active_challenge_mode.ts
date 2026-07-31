import { Knex } from 'knex';

/**
 * 008: saves 表新增 active_challenge_mode 列。
 *
 * 设计文档: docs/design/fractal-design-20260723-game-combat-mode-separation/code-design-20260723-game-combat-mode-separation.md §9.2 (DF-007 修复)
 *
 * 改造目标：
 * - saves 表新增 active_challenge_mode 列，存储当前存档激活的挑战模式
 * - 用于跨请求持久化玩家选择的挑战模式（三层覆盖优先级：玩家选择 > GM 覆盖 > 模板默认）
 * - nullable + defaultTo null：未进入挑战时为 null，进入挑战时写入 ChallengeMode 值
 *
 * DF-007 修复：
 * - 路由层 ModeRouter 不再从内存读取当前挑战模式（会丢失）
 * - 改为从 saves.active_challenge_mode 列读取（持久化跨请求）
 *
 * 幂等性：检查列是否存在，存在则跳过。
 */
export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('saves', 'active_challenge_mode');
  if (!hasColumn) {
    await knex.raw('ALTER TABLE saves ADD COLUMN active_challenge_mode TEXT');
    console.log('008: added saves.active_challenge_mode column');
  } else {
    console.log('008: saves.active_challenge_mode column already exists, skipping');
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('saves', 'active_challenge_mode');
  if (hasColumn) {
    await knex.raw('ALTER TABLE saves DROP COLUMN active_challenge_mode');
    console.log('008: dropped saves.active_challenge_mode column');
  }
}
