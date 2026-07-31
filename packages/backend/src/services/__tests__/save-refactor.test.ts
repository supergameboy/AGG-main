import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import knex, { type Knex } from 'knex';
import { SaveService, SaveRepository, SaveSnapshotRepository, SaveGameTimeRepository, SaveStateRepository, SaveDataPort } from '../../game-systems/save/index.js';
import { KnexTransactionManager } from '../../database/TransactionManager.js';
import type { ID } from '../../../../shared/src/types/core.js';

const SAVE_ID = 'save-test-001' as ID;

async function createTestDb(): Promise<Knex> {
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });

  await db.schema.createTable('saves', (table) => {
    table.text('id').primary();
    table.text('name').notNullable();
    table.text('template_id').notNullable();
    table.text('game_mode').notNullable();
    table.text('language');
    table.bigInteger('updated_at').notNullable();
  });

  return db;
}

describe('SaveService — getSaveLanguage / getSaveTemplateId / updateSaveLanguage', () => {
  let db: Knex;
  let service: SaveService;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(() => {
    const saveRepo = new SaveRepository(db);
    const snapshotRepo = new SaveSnapshotRepository(db);
    const stateRepo = new SaveStateRepository(db);
    const gameTimeRepo = new SaveGameTimeRepository(db);
    const saveDataPort = new SaveDataPort(db);
    const txManager = new KnexTransactionManager(db);
    service = new SaveService(saveRepo, snapshotRepo, stateRepo, gameTimeRepo, saveDataPort, txManager);
  });

  // ─── getSaveLanguage ───

  describe('getSaveLanguage', () => {
    it('应返回存档的语言', async () => {
      await db('saves').insert({
        id: SAVE_ID,
        name: 'Test Save',
        template_id: 'tpl-1',
        game_mode: 'text_adventure',
        language: 'zh-CN',
        updated_at: Date.now(),
      });

      const language = await service.getSaveLanguage(SAVE_ID);
      expect(language).toBe('zh-CN');
    });

    it('存档不存在时应返回 undefined', async () => {
      const language = await service.getSaveLanguage('nonexistent' as ID);
      expect(language).toBeUndefined();
    });

    it('language 列为空时应返回 undefined', async () => {
      const saveId = 'save-no-lang' as ID;
      await db('saves').insert({
        id: saveId,
        name: 'No Lang Save',
        template_id: 'tpl-2',
        game_mode: 'text_adventure',
        language: null,
        updated_at: Date.now(),
      });

      const language = await service.getSaveLanguage(saveId);
      expect(language).toBeUndefined();
    });
  });

  // ─── getSaveTemplateId ───

  describe('getSaveTemplateId', () => {
    it('应返回存档的模板 ID', async () => {
      const saveId = 'save-tpl-test' as ID;
      await db('saves').insert({
        id: saveId,
        name: 'Template Test Save',
        template_id: 'tpl-medieval',
        game_mode: 'turn_based_rpg',
        language: 'en',
        updated_at: Date.now(),
      });

      const templateId = await service.getSaveTemplateId(saveId);
      expect(templateId).toBe('tpl-medieval');
    });

    it('存档不存在时应返回 undefined', async () => {
      const templateId = await service.getSaveTemplateId('nonexistent' as ID);
      expect(templateId).toBeUndefined();
    });
  });

  // ─── updateSaveLanguage ───

  describe('updateSaveLanguage', () => {
    it('应更新存档语言', async () => {
      const saveId = 'save-update-lang' as ID;
      const before = Date.now();
      await db('saves').insert({
        id: saveId,
        name: 'Update Lang Save',
        template_id: 'tpl-1',
        game_mode: 'text_adventure',
        language: 'en',
        updated_at: before,
      });

      await service.updateSaveLanguage(saveId, 'ja');

      const row = await db('saves').where({ id: saveId }).first();
      expect(row.language).toBe('ja');
      expect(row.updated_at).toBeGreaterThanOrEqual(before);
    });

    it('存档不存在时不应报错（knex 无匹配行静默通过）', async () => {
      await expect(
        service.updateSaveLanguage('nonexistent' as ID, 'fr'),
      ).resolves.toBeUndefined();
    });
  });
});
