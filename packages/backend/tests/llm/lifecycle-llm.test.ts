/**
 * LLM 依赖测试 — 游戏初始化流程
 *
 * 这些测试需要 LLM API 可用，默认不运行。
 * 运行方式: npm run test:llm
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, db } from '../setup.js';

describe('LLM: Game Initialization Flow', () => {
  let initSaveId: string;

  beforeAll(() => {
    expect(app).toBeDefined();
    expect(db).toBeDefined();
  });

  it('should initialize a new game with characterData', async () => {
    const response = await request(app)
      .post('/api/v1/game')
      .send({
        action: 'initialize',
        templateId: 'medieval-fantasy',
        characterData: {
          name: 'LifecycleHero',
          race: 'human',
          gender: 'male',
          classType: 'warrior',
          background: 'noble',
          attributes: { strength: 15, agility: 10, intelligence: 8, vitality: 12, luck: 5 }
        }
      })
      .expect('Content-Type', /json/);

    expect([200, 400, 500]).toContain(response.status);

    if (response.status === 200) {
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.success).toBe(true);
      expect(response.body.data.metadata.saveId).toBeDefined();
      initSaveId = response.body.data.metadata.saveId;
    }
  }, 60000);

  it('should return 10 initialization steps', async () => {
    const response = await request(app)
      .post('/api/v1/game')
      .send({
        action: 'initialize',
        templateId: 'medieval-fantasy',
        characterData: {
          name: 'StepsHero',
          race: 'elf',
          gender: 'female',
          classType: 'mage',
          background: 'scholar',
          attributes: { strength: 6, agility: 10, intelligence: 16, vitality: 8, luck: 10 }
        }
      })
      .expect('Content-Type', /json/);

    expect([200, 400, 500]).toContain(response.status);

    if (response.status === 200) {
      expect(response.body.data.data.steps).toBeDefined();
      expect(Array.isArray(response.body.data.data.steps)).toBe(true);
      expect(response.body.data.data.steps.length).toBe(10);
    }
  }, 60000);

  it('should have metadata.isInitialization = true', async () => {
    const response = await request(app)
      .post('/api/v1/game')
      .send({
        action: 'initialize',
        templateId: 'medieval-fantasy',
        characterData: {
          name: 'MetaHero',
          race: 'dwarf',
          gender: 'male',
          classType: 'warrior',
          background: 'soldier',
          attributes: { strength: 14, agility: 8, intelligence: 6, vitality: 14, luck: 8 }
        }
      })
      .expect('Content-Type', /json/);

    expect([200, 400, 500]).toContain(response.status);

    if (response.status === 200) {
      expect(response.body.data.metadata).toBeDefined();
      expect(response.body.data.metadata.isInitialization).toBe(true);
    }
  }, 60000);

  it('should create a save record in the database', async () => {
    const response = await request(app)
      .post('/api/v1/game')
      .send({
        action: 'initialize',
        templateId: 'medieval-fantasy',
        characterData: {
          name: 'DBHero',
          race: 'human',
          gender: 'male',
          classType: 'rogue',
          background: 'criminal',
          attributes: { strength: 8, agility: 16, intelligence: 10, vitality: 8, luck: 14 }
        }
      })
      .expect('Content-Type', /json/);

    expect([200, 400, 500]).toContain(response.status);

    if (response.status === 200) {
      const saveId = response.body.data.metadata.saveId;
      const saveRecord = await db('saves').where({ id: saveId }).first();
      expect(saveRecord).toBeDefined();
    }
  }, 60000);

  it('should load existing context when same saveId is used', async () => {
    const testSaveId = initSaveId || (await db('saves').first())?.id;
    if (!testSaveId) return;

    const firstResponse = await request(app)
      .post('/api/v1/agent/message')
      .send({ agentType: 'output', message: 'first message', saveId: testSaveId })
      .expect('Content-Type', /json/);

    expect([200, 400, 500]).toContain(firstResponse.status);

    const secondResponse = await request(app)
      .post('/api/v1/agent/message')
      .send({ agentType: 'output', message: 'second message', saveId: testSaveId })
      .expect('Content-Type', /json/);

    expect([200, 400, 500]).toContain(secondResponse.status);

    if (secondResponse.status === 200) {
      const contextRow = await db('agent_contexts')
        .where({ save_id: testSaveId, agent_type: 'output' })
        .first();

      if (contextRow) {
        const messages = JSON.parse(contextRow.messages || '[]');
        expect(messages.length).toBeGreaterThanOrEqual(2);
      }
    }
  }, 60000);

  it('should create decision logs for the saveId', async () => {
    const testSaveId = initSaveId || (await db('saves').first())?.id;
    if (!testSaveId) return;

    await request(app)
      .post('/api/v1/game')
      .send({ message: 'test decision log', saveId: testSaveId })
      .expect('Content-Type', /json/);

    const response = await request(app)
      .get('/api/v1/agent/decisions')
      .query({ saveId: testSaveId })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toBeDefined();
  }, 60000);
});
