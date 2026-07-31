import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../migrations/runner.js';
import { ShadowStateLayer } from '../ShadowStateLayer.js';
import { StagingPool } from '../StagingPool.js';
import { createStagingKnex } from '@ai-rpg/shared/tool-core';
import type { IDevTraceHook } from '@ai-rpg/shared/tool-core';

// AP-L1: StagingPool 构造函数注入 IDevTraceHook，测试提供最小 mock
const mockDevTraceHook: IDevTraceHook = {
  emit: vi.fn(),
};

describe('StagingKnex pool isolation', () => {
  let db: Knex;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('应隔离 template/save 池表的 shadow 读写，并覆盖技能与物品池快照', async () => {
    const now = Date.now();

    await db('templates').insert({
      id: 'template-1',
      raw_content: 'id: template-1\nname: Template 1\n',
      source: 'editor',
      is_builtin: 0,
      created_at: now,
      updated_at: now,
    });
    await db('saves').insert({
      id: 'save-1',
      name: 'Save 1',
      template_id: 'template-1',
      game_mode: 'turn_based_rpg',
      chapter: '',
      location: '',
      level: 1,
      main_quest: '',
      play_time: 0,
      thumbnail: '',
      created_at: now,
      updated_at: now,
    });

    await db('template_skill_pool').insert({
      id: 'shared-skill',
      template_id: 'template-1',
      name: '模板火球术',
      description: '模板技能',
      category: 'attack',
      source: 'template',
      created_at: now,
      updated_at: now,
    });
    await db('skill_pool').insert({
      id: 'shared-skill',
      save_id: 'save-1',
      name: '存档火球术',
      description: '存档技能',
      category: 'attack',
      learned: 0,
      created_at: now,
      updated_at: now,
    });
    await db('template_item_pool').insert({
      id: 'shared-item',
      template_id: 'template-1',
      name: '模板长剑',
      description: '模板物品',
      category: 'weapon',
      source: 'template',
      created_at: now,
      updated_at: now,
    });
    await db('item_pool').insert({
      id: 'shared-item',
      save_id: 'save-1',
      name: '存档长剑',
      description: '存档物品',
      category: 'weapon',
      taken: 0,
      created_at: now,
      updated_at: now,
    });

    const shadowState = new ShadowStateLayer(
      db,
      {
        save_id: 'save-1',
        template_id: 'template-1',
      },
      [
        { table: 'skill_pool', scopeField: 'save_id' },
        { table: 'item_pool', scopeField: 'save_id' },
        { table: 'template_skill_pool', scopeField: 'template_id' },
        { table: 'template_item_pool', scopeField: 'template_id' },
      ],
    );
    await shadowState.ensureSnapshot();

    const stagingPool = new StagingPool(mockDevTraceHook);
    stagingPool.bindShadowState(shadowState);

    const stagingDb = createStagingKnex(db, {
      stagingPool,
      shadowState,
      toolType: 'template_pool_service',
      method: 'repair_pool',
      source: 'gamemaster',
    });

    await stagingDb('template_skill_pool')
      .where({ template_id: 'template-1', id: 'shared-skill' })
      .update({ description: '模板技能-修正后' });
    await stagingDb('skill_pool')
      .where({ save_id: 'save-1', id: 'shared-skill' })
      .update({ learned: 1 });
    await stagingDb('template_item_pool')
      .where({ template_id: 'template-1', id: 'shared-item' })
      .update({ description: '模板物品-修正后' });
    await stagingDb('item_pool')
      .where({ save_id: 'save-1', id: 'shared-item' })
      .update({ taken: 1 });

    const templateSkill = await stagingDb('template_skill_pool')
      .where({ template_id: 'template-1', id: 'shared-skill' })
      .first();
    const saveSkill = await stagingDb('skill_pool')
      .where({ save_id: 'save-1', id: 'shared-skill' })
      .first();
    const templateItem = await stagingDb('template_item_pool')
      .where({ template_id: 'template-1', id: 'shared-item' })
      .first();
    const saveItem = await stagingDb('item_pool')
      .where({ save_id: 'save-1', id: 'shared-item' })
      .first();

    expect(templateSkill).toEqual(expect.objectContaining({
      id: 'shared-skill',
      template_id: 'template-1',
      description: '模板技能-修正后',
      name: '模板火球术',
    }));
    expect(saveSkill).toEqual(expect.objectContaining({
      id: 'shared-skill',
      save_id: 'save-1',
      learned: 1,
      description: '存档技能',
      name: '存档火球术',
    }));
    expect(templateItem).toEqual(expect.objectContaining({
      id: 'shared-item',
      template_id: 'template-1',
      description: '模板物品-修正后',
      name: '模板长剑',
    }));
    expect(saveItem).toEqual(expect.objectContaining({
      id: 'shared-item',
      save_id: 'save-1',
      taken: 1,
      description: '存档物品',
      name: '存档长剑',
    }));
  });
});
