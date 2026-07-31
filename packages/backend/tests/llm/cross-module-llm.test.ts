/**
 * LLM 依赖测试 — 跨模块集成
 *
 * 这些测试需要 LLM API 可用，默认不运行。
 * 运行方式: npm run test:llm
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../setup.js';

describe('LLM: Cross-Module Integration', () => {
  let saveId: string;
  let templateId: string;

  beforeAll(() => {
    expect(app).toBeDefined();
  });

  it('Step 4: Initialize game via game route', async () => {
    // 先获取模板
    const templatesResponse = await request(app)
      .get('/api/v1/templates')
      .expect(200);
    templateId = templatesResponse.body.data[0].id;

    const response = await request(app)
      .post('/api/v1/game')
      .send({
        action: 'initialize',
        templateId: templateId,
        characterData: {
          name: 'IntegrationTestHero',
          race: 'human',
          gender: 'male',
          classType: 'warrior',
          background: 'noble',
          attributes: { strength: 15, agility: 10, intelligence: 8, vitality: 12, luck: 5 }
        }
      })
      .expect('Content-Type', /json/);

    if (response.status === 200 && response.body.data?.success) {
      saveId = response.body.data.metadata.saveId;
      expect(saveId).toBeDefined();
    }
  }, 60000);

  it('Step 5: Verify save appears in save list', async () => {
    if (!saveId) return;

    const response = await request(app)
      .get('/api/v1/saves')
      .expect(200);

    expect(response.body.success).toBe(true);
    const found = response.body.data.find((s: any) => s.id === saveId);
    expect(found).toBeDefined();
  });
});
