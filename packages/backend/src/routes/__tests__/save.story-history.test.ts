import express from 'express';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSaveRoutes } from '../save.js';
import { errorHandler } from '../../middlewares/errorhandler.js';

describe('Save routes story history', () => {
  let db: Knex;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await db.schema.createTable('saves', (table) => {
      table.text('id').primary();
      table.text('chapter').nullable();
      table.text('location').nullable();
      table.text('main_quest').nullable();
      table.integer('level').nullable();
      table.integer('updated_at').nullable();
    });

    await db.schema.createTable('story_events', (table) => {
      table.text('id').primary();
      table.text('save_id').notNullable();
      table.text('chapter').defaultTo('');
      table.text('event_type').notNullable();
      table.text('title').notNullable();
      table.text('description').defaultTo('');
      table.text('importance').notNullable().defaultTo('minor');
      table.text('participants').defaultTo('[]');
      table.text('impact').defaultTo('{}');
      table.integer('timestamp').notNullable();
    });

    await db.schema.createTable('agent_contexts', (table) => {
      table.text('save_id').notNullable();
      table.text('agent_type').notNullable();
      table.text('messages').defaultTo('[]');
      table.text('state').nullable();
      table.primary(['save_id', 'agent_type']);
    });

    await db('saves').insert({
      id: 'save-1',
      chapter: 'chapter_2',
      location: 'village-square',
      main_quest: '调查灰雾异动',
      level: 3,
      updated_at: Date.now(),
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/saves', createSaveRoutes(db));
    app.use(errorHandler);
    return app;
  }

  it('GET /:saveId/story/history 应返回持久化重大记录分页结果', async () => {
    await db('story_events').insert([
      {
        id: 'evt-1',
        save_id: 'save-1',
        chapter: 'chapter_2',
        event_type: 'major_record',
        title: '玩家确认灰雾源头线索',
        description: '村长给出关键线索',
        importance: 'critical',
        participants: '["npc-chief"]',
        impact: '{"source":"post_review"}',
        timestamp: 200,
      },
      {
        id: 'evt-2',
        save_id: 'save-1',
        chapter: 'chapter_2',
        event_type: 'quest',
        title: '主线推进',
        description: '解锁新阶段',
        importance: 'major',
        participants: '[]',
        impact: '{"sourceTriggerId":"trigger-1"}',
        timestamp: 100,
      },
    ]);

    const response = await request(createApp())
      .get('/api/v1/saves/save-1/story/history?page=1&pageSize=1');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        events: [
          expect.objectContaining({
            id: 'evt-1',
            save_id: 'save-1',
            event_type: 'major_record',
            importance: 'critical',
          }),
        ],
        pagination: {
          page: 1,
          pageSize: 1,
          total: 2,
          totalPages: 2,
        },
      })
    );
  });
});
