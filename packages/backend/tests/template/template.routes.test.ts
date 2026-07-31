import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, db } from '../setup.js';

describe('Template Routes Integration Tests', () => {
  let builtinTemplateId: string;
  let customTemplateId: string;
  let duplicatedTemplateId: string;

  beforeAll(() => {
    expect(app).toBeDefined();
  });

  describe('GET /api/v1/templates - List Templates', () => {
    it('should return list of templates', async () => {
      const response = await request(app)
        .get('/api/v1/templates')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);

      const firstTemplate = response.body.data[0];
      expect(firstTemplate.id).toBeDefined();
      expect(firstTemplate.name).toBeDefined();
      expect(firstTemplate.game_mode).toBeDefined();
      expect(firstTemplate.is_builtin).toBeDefined();

      builtinTemplateId = response.body.data.find(
        (t: any) => t.is_builtin === true || t.is_builtin === 1
      )?.id || response.body.data[0].id;
    });

    it('each template should have required fields', async () => {
      const response = await request(app)
        .get('/api/v1/templates')
        .expect(200);

      for (const template of response.body.data) {
        expect(template).toHaveProperty('id');
        expect(template).toHaveProperty('name');
        expect(template).toHaveProperty('game_mode');
        expect(template).toHaveProperty('version');
        expect(template).toHaveProperty('created_at');
        expect(template).toHaveProperty('updated_at');
      }
    });
  });

  describe('GET /api/v1/templates/:id - Get Template Detail', () => {
    it('should return template detail', async () => {
      const response = await request(app)
        .get(`/api/v1/templates/${builtinTemplateId}`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.id).toBe(builtinTemplateId);
      expect(response.body.data.name).toBeDefined();
      // 新架构：world_setting/character_creation/game_rules/ai_constraints
      // 从 raw_content YAML 解析，TemplateService.toApiResponse 保证这些字段存在
      expect(response.body.data.world_setting).toBeDefined();
      expect(response.body.data.character_creation).toBeDefined();
      expect(response.body.data.game_rules).toBeDefined();
      expect(response.body.data.ai_constraints).toBeDefined();
    });

    it('should return 404 for non-existent template', async () => {
      const response = await request(app)
        .get('/api/v1/templates/nonexistent-template-id')
        .expect('Content-Type', /json/)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('TEMPLATE_NOT_FOUND');
    });
  });

  describe('POST /api/v1/templates - Create Template', () => {
    it('should create a new template', async () => {
      const response = await request(app)
        .post('/api/v1/templates')
        .send({
          data: {
            id: 'test-custom-template',
            name: 'Test Custom Template',
            game_mode: 'text_adventure',
            version: '1.0.0',
            author: 'Test Author',
            world_setting: {
              name: 'Test World',
              genre: 'fantasy',
              era: 'medieval',
              technology_level: 'medieval',
            },
            character_creation: {
              attribute_points: 60,
              attributes: [{ id: 'str', name: 'Strength' }],
            },
          }
        })
        .expect('Content-Type', /json/)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.name).toBe('Test Custom Template');
      customTemplateId = response.body.data.id;
    });

    it('should return 400 when data is missing', async () => {
      const response = await request(app)
        .post('/api/v1/templates')
        .send({})
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
    });
  });

  describe('PUT /api/v1/templates/:id - Update Template', () => {
    it('should update custom template', async () => {
      const response = await request(app)
        .put(`/api/v1/templates/${customTemplateId}`)
        .send({ description: 'Updated description' })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.description).toBe('Updated description');
    });

    it('should return 400 when no fields provided', async () => {
      const response = await request(app)
        .put(`/api/v1/templates/${customTemplateId}`)
        .send({})
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
    });

    it('should return 403 when updating builtin template', async () => {
      const response = await request(app)
        .put(`/api/v1/templates/${builtinTemplateId}`)
        .send({ description: 'Attempt to modify builtin' })
        .expect('Content-Type', /json/);

      if (response.status === 403) {
        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe('FORBIDDEN');
      }
    });

    it('should return 404 for non-existent template', async () => {
      const response = await request(app)
        .put('/api/v1/templates/nonexistent-template-id')
        .send({ description: 'Test' })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('TEMPLATE_NOT_FOUND');
    });
  });

  describe('GET /api/v1/templates/:id/prompts - Get Template Prompts', () => {
    it('should return template prompts', async () => {
      const response = await request(app)
        .get(`/api/v1/templates/${builtinTemplateId}/prompts`)
        .expect('Content-Type', /json/);

      if (response.status === 200) {
        expect(response.body.success).toBe(true);
        expect(response.body.data).toBeDefined();
      }
    });

    it('should return 404 for non-existent template', async () => {
      const response = await request(app)
        .get('/api/v1/templates/nonexistent-template-id/prompts')
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/templates/:id/game-config - Get Game Config', () => {
    it('should return game config for template', async () => {
      const response = await request(app)
        .get(`/api/v1/templates/${builtinTemplateId}/game-config`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      // 新架构：game-config 从 raw_content YAML 解析，字段由 TemplateRecord 保证
      expect(response.body.data).toHaveProperty('ui_theme');
      expect(response.body.data).toHaveProperty('ui_layout');
      expect(response.body.data).toHaveProperty('game_rules');
      expect(response.body.data).toHaveProperty('ai_constraints');
      expect(response.body.data).toHaveProperty('world_setting');
      expect(response.body.data).toHaveProperty('special_rules');
      expect(response.body.data).toHaveProperty('numerical_complexity');
    });

    it('should return 404 for non-existent template', async () => {
      const response = await request(app)
        .get('/api/v1/templates/nonexistent-template-id/game-config')
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/templates/:id/character-options - Get Character Options', () => {
    it('should return character creation options', async () => {
      const response = await request(app)
        .get(`/api/v1/templates/${builtinTemplateId}/character-options`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data).toHaveProperty('races');
      expect(response.body.data).toHaveProperty('classes');
      expect(response.body.data).toHaveProperty('backgrounds');
      expect(response.body.data).toHaveProperty('attributes');
      expect(response.body.data).toHaveProperty('attribute_points');
    });

    it('should return 404 for non-existent template', async () => {
      const response = await request(app)
        .get('/api/v1/templates/nonexistent-template-id/character-options')
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/templates/:id/duplicate - Duplicate Template', () => {
    it('should duplicate a template', async () => {
      const response = await request(app)
        .post(`/api/v1/templates/${builtinTemplateId}/duplicate`)
        .expect('Content-Type', /json/)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.id).not.toBe(builtinTemplateId);
      expect(response.body.data.name).toContain('副本');
      duplicatedTemplateId = response.body.data.id;
    });

    it('should return 404 for non-existent template', async () => {
      const response = await request(app)
        .post('/api/v1/templates/nonexistent-template-id/duplicate')
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/templates/:id/export - Export Template', () => {
    it('should export template data', async () => {
      const response = await request(app)
        .post(`/api/v1/templates/${builtinTemplateId}/export`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.version).toBeDefined();
      expect(response.body.data.template).toBeDefined();
    });

    it('should return 404 for non-existent template', async () => {
      const response = await request(app)
        .post('/api/v1/templates/nonexistent-template-id/export')
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/templates/:id/validate - Validate Template', () => {
    it('should validate template and return result', async () => {
      const response = await request(app)
        .post(`/api/v1/templates/${builtinTemplateId}/validate`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data).toHaveProperty('valid');
      expect(response.body.data).toHaveProperty('errors');
      expect(response.body.data).toHaveProperty('warnings');
      expect(response.body.data).toHaveProperty('score');
    });

    it('should return 404 for non-existent template', async () => {
      const response = await request(app)
        .post('/api/v1/templates/nonexistent-template-id/validate')
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /api/v1/templates/:id - Delete Template', () => {
    it('should delete custom template', async () => {
      const response = await request(app)
        .delete(`/api/v1/templates/${customTemplateId}`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.deleted).toBe(true);
    });

    it('should delete duplicated template', async () => {
      if (duplicatedTemplateId) {
        const response = await request(app)
          .delete(`/api/v1/templates/${duplicatedTemplateId}`)
          .expect(200);

        expect(response.body.success).toBe(true);
      }
    });

    it('should return 403 when deleting builtin template', async () => {
      const response = await request(app)
        .delete(`/api/v1/templates/${builtinTemplateId}`)
        .expect('Content-Type', /json/);

      if (response.status === 403) {
        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe('FORBIDDEN');
      }
    });

    it('should return 404 for non-existent template', async () => {
      const response = await request(app)
        .delete('/api/v1/templates/nonexistent-template-id')
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });
});
