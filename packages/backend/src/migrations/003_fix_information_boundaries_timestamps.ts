import { Knex } from 'knex';

/**
 * 003: 修复 information_boundaries 表 schema 漂移。
 *
 * 背景：前次修复（2026-07-16 03:10）直接修改了 001_init.ts 的 information_boundaries
 * 表定义（last_updated_at → created_at + updated_at），但未创建新迁移来更新已有数据库。
 * 由于 runner.ts 跳过已应用的迁移，已有数据库仍保留旧 schema。
 *
 * 本迁移采用幂等模式（参考 002_add_equipped_index.ts）：
 * - 旧库（有 last_updated_at）：补 created_at/updated_at 列，迁移数据，删除 last_updated_at
 * - 新库（无 last_updated_at）：no-op
 * - 异常状态（两列都在/都不在）：抛错，避免掩盖问题
 *
 * 设计文档: docs/debug/bug-hunt-20260716-information-boundaries-migration-drift.md
 */
export async function up(knex: Knex): Promise<void> {
  const tableExists = await knex.schema.hasTable('information_boundaries');
  if (!tableExists) {
    return;
  }

  const hasLastUpdatedAt = await knex.schema.hasColumn('information_boundaries', 'last_updated_at');
  const hasCreatedAt = await knex.schema.hasColumn('information_boundaries', 'created_at');
  const hasUpdatedAt = await knex.schema.hasColumn('information_boundaries', 'updated_at');

  if (!hasLastUpdatedAt && hasCreatedAt && hasUpdatedAt) {
    return;
  }

  if (hasLastUpdatedAt && hasCreatedAt) {
    throw new Error(
      '003_fix_information_boundaries_timestamps: abnormal schema state - both last_updated_at and created_at exist. Manual investigation required.',
    );
  }

  if (!hasLastUpdatedAt && (!hasCreatedAt || !hasUpdatedAt)) {
    throw new Error(
      '003_fix_information_boundaries_timestamps: abnormal schema state - neither old nor new timestamp columns fully present. Manual investigation required.',
    );
  }

  await knex.raw('ALTER TABLE information_boundaries ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0');
  await knex.raw('ALTER TABLE information_boundaries ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0');
  await knex.raw('UPDATE information_boundaries SET created_at = last_updated_at, updated_at = last_updated_at');
  await knex.raw('ALTER TABLE information_boundaries DROP COLUMN last_updated_at');
}

export async function down(knex: Knex): Promise<void> {
  const tableExists = await knex.schema.hasTable('information_boundaries');
  if (!tableExists) {
    return;
  }

  const hasLastUpdatedAt = await knex.schema.hasColumn('information_boundaries', 'last_updated_at');
  if (hasLastUpdatedAt) {
    return;
  }

  await knex.raw('ALTER TABLE information_boundaries ADD COLUMN last_updated_at INTEGER NOT NULL DEFAULT 0');
  await knex.raw('UPDATE information_boundaries SET last_updated_at = updated_at');
  await knex.raw('ALTER TABLE information_boundaries DROP COLUMN created_at');
  await knex.raw('ALTER TABLE information_boundaries DROP COLUMN updated_at');
}
