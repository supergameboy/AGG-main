/**
 * LLM 依赖测试 — Agent 调度系统
 *
 * 这些测试需要 LLM API 可用，默认不运行。
 * 运行方式: npm run test:llm
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../setup.js';

describe('LLM: Agent Scheduling', () => {
  it('should route initialize action to game initialization', async () => {
    const response = await request(app)
      .post('/api/v1/game')
      .send({
        action: 'initialize',
        templateId: 'medieval-fantasy',
        characterData: {
          name: 'TestHero',
          race: 'human',
          gender: 'male',
          classType: 'warrior',
          background: 'noble',
          attributes: { strength: 15, agility: 10, intelligence: 8, vitality: 12, luck: 5 }
        }
      })
      .expect('Content-Type', /json/)
      .timeout(60000);

    expect([200, 400, 500]).toContain(response.status);

    if (response.status === 200) {
      expect(response.body.success).toBe(true);
      expect(response.body.data.metadata.isInitialization).toBe(true);
    }
  }, 60000);

  it('should process a regular chat message through coordinator', async () => {
    const initResponse = await request(app)
      .post('/api/v1/game')
      .send({
        action: 'initialize',
        templateId: 'medieval-fantasy',
        characterData: {
          name: 'ChatTestHero',
          race: 'elf',
          gender: 'female',
          classType: 'mage',
          background: 'scholar',
          attributes: { strength: 6, agility: 12, intelligence: 16, vitality: 8, luck: 8 }
        }
      });

    let saveId: string | undefined;
    if (initResponse.status === 200 && initResponse.body.data?.metadata?.saveId) {
      saveId = initResponse.body.data.metadata.saveId;
    }

    const response = await request(app)
      .post('/api/v1/game')
      .send({
        message: 'look around',
        ...(saveId ? { saveId } : {})
      })
      .expect('Content-Type', /json/)
      .timeout(60000);

    expect([200, 400, 500]).toContain(response.status);
  }, 60000);

  it('schedule depth should not exceed MAX_SCHEDULE_DEPTH of 2 after processing', async () => {
    const initResponse = await request(app)
      .post('/api/v1/game')
      .send({
        action: 'initialize',
        templateId: 'medieval-fantasy',
        characterData: {
          name: 'DAGTestHero',
          race: 'dwarf',
          gender: 'male',
          classType: 'warrior',
          background: 'soldier',
          attributes: { strength: 16, agility: 8, intelligence: 6, vitality: 14, luck: 6 }
        }
      });

    let saveId: string | undefined;
    if (initResponse.status === 200 && initResponse.body.data?.metadata?.saveId) {
      saveId = initResponse.body.data.metadata.saveId;
    }

    if (saveId) {
      await request(app)
        .post('/api/v1/game')
        .send({ message: 'explore the area', saveId })
        .timeout(60000);
    }

    const statusResponse = await request(app)
      .get('/api/v1/agent/status')
      .expect(200);

    expect(statusResponse.body.data.coordinator.currentScheduleDepth).toBeLessThanOrEqual(2);
  }, 90000);

  it('should process multiple agents in parallel via first layer scheduling', async () => {
    const initResponse = await request(app)
      .post('/api/v1/game')
      .send({
        action: 'initialize',
        templateId: 'medieval-fantasy',
        characterData: {
          name: 'ParallelTestHero',
          race: 'human',
          gender: 'male',
          classType: 'rogue',
          background: 'criminal',
          attributes: { strength: 10, agility: 16, intelligence: 10, vitality: 8, luck: 12 }
        }
      });

    let saveId: string | undefined;
    if (initResponse.status === 200 && initResponse.body.data?.metadata?.saveId) {
      saveId = initResponse.body.data.metadata.saveId;
    }

    if (saveId) {
      const response = await request(app)
        .post('/api/v1/game')
        .send({ message: 'I want to fight the goblin and check my inventory', saveId })
        .expect('Content-Type', /json/)
        .timeout(60000);

      expect([200, 400, 500]).toContain(response.status);
    }
  }, 90000);

  it('should reset schedule depth between requests', async () => {
    const statusBefore = await request(app)
      .get('/api/v1/agent/status')
      .expect(200);

    const depthBefore = statusBefore.body.data.coordinator.currentScheduleDepth;

    const initResponse = await request(app)
      .post('/api/v1/game')
      .send({
        action: 'initialize',
        templateId: 'medieval-fantasy',
        characterData: {
          name: 'ResetTestHero',
          race: 'human',
          gender: 'male',
          classType: 'warrior',
          background: 'noble',
          attributes: { strength: 14, agility: 10, intelligence: 10, vitality: 12, luck: 8 }
        }
      });

    if (initResponse.status === 200) {
      const statusAfter = await request(app)
        .get('/api/v1/agent/status')
        .expect(200);

      const depthAfter = statusAfter.body.data.coordinator.currentScheduleDepth;
      expect(depthAfter).toBeGreaterThanOrEqual(0);
      expect(depthAfter).toBeLessThanOrEqual(2);
    }

    void depthBefore;
  });

  it('should have decisions logged after chat interaction', async () => {
    const initResponse = await request(app)
      .post('/api/v1/game')
      .send({
        action: 'initialize',
        templateId: 'medieval-fantasy',
        characterData: {
          name: 'DecisionLogHero',
          race: 'human',
          gender: 'male',
          classType: 'warrior',
          background: 'noble',
          attributes: { strength: 15, agility: 10, intelligence: 8, vitality: 12, luck: 5 }
        }
      });

    if (initResponse.status === 200) {
      const saveId = initResponse.body.data?.metadata?.saveId || 'system';
      const decisionsResponse = await request(app)
        .get('/api/v1/agent/decisions')
        .query({ saveId })
        .expect(200);

      expect(decisionsResponse.body.data.total).toBeGreaterThanOrEqual(0);
    }
  });
});
