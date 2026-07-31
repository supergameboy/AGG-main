import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, db } from '../setup.js';

describe('Cross-Module Integration Tests', () => {
  let saveId: string;
  let templateId: string;
  let snapshotId: string;

  beforeAll(() => {
    expect(app).toBeDefined();
  });

  describe('Full Game Initialization Flow', () => {
    it('Step 1: Get available templates', async () => {
      const response = await request(app)
        .get('/api/v1/templates')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      templateId = response.body.data[0].id;
    });

    it('Step 2: Get character options from template', async () => {
      const response = await request(app)
        .get(`/api/v1/templates/${templateId}/character-options`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.races).toBeDefined();
      expect(response.body.data.classes).toBeDefined();
      expect(response.body.data.backgrounds).toBeDefined();
      expect(response.body.data.attributes).toBeDefined();
    });

    it('Step 3: Get game config from template', async () => {
      const response = await request(app)
        .get(`/api/v1/templates/${templateId}/game-config`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.ui_theme).toBeDefined();
      expect(response.body.data.game_rules).toBeDefined();
    });

    it('Step 6: Load complete save data', async () => {
      if (!saveId) return;

      const response = await request(app)
        .get(`/api/v1/saves/${saveId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(saveId);
      expect(response.body.data.character).toBeDefined();
    });
  });

  describe('Save Lifecycle Flow', () => {
    it('should complete full save lifecycle: create → update → snapshot → restore → delete', async () => {
      const createResponse = await request(app)
        .post('/api/v1/saves')
        .send({ name: 'Lifecycle Test Save' })
        .expect(201);

      const lifecycleSaveId = createResponse.body.data.id;
      expect(lifecycleSaveId).toBeDefined();

      const updateResponse = await request(app)
        .patch(`/api/v1/saves/${lifecycleSaveId}`)
        .send({ chapter: 'Chapter 1', location: 'Forest' })
        .expect(200);

      expect(updateResponse.body.data.chapter).toBe('Chapter 1');
      expect(updateResponse.body.data.location).toBe('Forest');

      const saveResponse = await request(app)
        .put(`/api/v1/saves/${lifecycleSaveId}`)
        .expect(200);

      expect(saveResponse.body.data.saved).toBe(true);

      const snapshotResponse = await request(app)
        .post(`/api/v1/saves/${lifecycleSaveId}/snapshots`)
        .send({ chapterName: 'Chapter 1 Checkpoint' })
        .expect(201);

      const snapId = snapshotResponse.body.data.id;
      expect(snapId).toBeDefined();

      const patchResponse2 = await request(app)
        .patch(`/api/v1/saves/${lifecycleSaveId}`)
        .send({ chapter: 'Chapter 2', location: 'Castle' })
        .expect(200);

      expect(patchResponse2.body.data.chapter).toBe('Chapter 2');

      const restoreResponse = await request(app)
        .post(`/api/v1/saves/${lifecycleSaveId}/snapshots/${snapId}/restore`)
        .expect(200);

      expect(restoreResponse.body.success).toBe(true);

      const deleteResponse = await request(app)
        .delete(`/api/v1/saves/${lifecycleSaveId}`)
        .expect(200);

      expect(deleteResponse.body.data.deleted).toBe(true);

      await request(app)
        .get(`/api/v1/saves/${lifecycleSaveId}`)
        .expect(404);
    });
  });

  describe('Template Lifecycle Flow', () => {
    it('should complete full template lifecycle: create → update → duplicate → export → delete', async () => {
      const createResponse = await request(app)
        .post('/api/v1/templates')
        .send({
          data: {
            id: 'lifecycle-test-template',
            name: 'Lifecycle Test Template',
            game_mode: 'text_adventure',
            version: '1.0.0',
            world_setting: { name: 'Test World', genre: 'fantasy' },
            character_creation: { attribute_points: 50, attributes: [{ id: 'str', name: 'Strength' }] },
          }
        })
        .expect(201);

      const customId = createResponse.body.data.id;
      expect(customId).toBeDefined();

      const updateResponse = await request(app)
        .put(`/api/v1/templates/${customId}`)
        .send({ description: 'Updated lifecycle template' })
        .expect(200);

      expect(updateResponse.body.data.description).toBe('Updated lifecycle template');

      const validateResponse = await request(app)
        .post(`/api/v1/templates/${customId}/validate`)
        .expect(200);

      expect(validateResponse.body.data).toHaveProperty('valid');
      expect(validateResponse.body.data).toHaveProperty('score');

      const duplicateResponse = await request(app)
        .post(`/api/v1/templates/${customId}/duplicate`)
        .expect(201);

      const dupId = duplicateResponse.body.data.id;
      expect(dupId).not.toBe(customId);

      const exportResponse = await request(app)
        .post(`/api/v1/templates/${customId}/export`)
        .expect(200);

      expect(exportResponse.body.data.version).toBeDefined();
      expect(exportResponse.body.data.template).toBeDefined();

      await request(app)
        .delete(`/api/v1/templates/${dupId}`)
        .expect(200);

      await request(app)
        .delete(`/api/v1/templates/${customId}`)
        .expect(200);
    });
  });

  describe('Save Export/Import Round-trip', () => {
    it('should export and re-import a save', async () => {
      const createResponse = await request(app)
        .post('/api/v1/saves')
        .send({ name: 'Export Import Test' })
        .expect(201);

      const exportImportSaveId = createResponse.body.data.id;

      await request(app)
        .patch(`/api/v1/saves/${exportImportSaveId}`)
        .send({ chapter: 'Export Chapter', location: 'Export Location' })
        .expect(200);

      const exportResponse = await request(app)
        .post(`/api/v1/saves/${exportImportSaveId}/export`)
        .expect(200);

      expect(exportResponse.body.data.version).toBeDefined();
      expect(exportResponse.body.data.save).toBeDefined();

      const importResponse = await request(app)
        .post('/api/v1/saves/import')
        .send({ data: exportResponse.body.data })
        .expect(201);

      expect(importResponse.body.data.imported).toBe(true);
      expect(importResponse.body.data.saveId).toBeDefined();
      expect(importResponse.body.data.saveId).not.toBe(exportImportSaveId);

      await request(app)
        .delete(`/api/v1/saves/${exportImportSaveId}`)
        .expect(200);

      await request(app)
        .delete(`/api/v1/saves/${importResponse.body.data.saveId}`)
        .expect(200);
    });
  });

  describe('Agent System Status Check', () => {
    it('should verify all agent system components are operational', async () => {
      const statusResponse = await request(app)
        .get('/api/v1/agent/status')
        .expect(200);

      expect(statusResponse.body.data.coordinator.status).toBe('active');
      expect(statusResponse.body.data.agents.length).toBe(10);
      expect(statusResponse.body.data.tools.total).toBe(23);

      const toolsResponse = await request(app)
        .get('/api/v1/agent/tools')
        .expect(200);

      expect(toolsResponse.body.data.count).toBeGreaterThan(0);

      const agentsResponse = await request(app)
        .get('/api/v1/agent/agents')
        .expect(200);

      expect(agentsResponse.body.data.count).toBe(10);
    });
  });

  describe('Error Response Format Consistency', () => {
    it('all 404 errors should have consistent format', async () => {
      const endpoints = [
        { method: 'get', url: '/api/v1/saves/save-nonexistent' },
        { method: 'get', url: '/api/v1/templates/nonexistent-id' },
      ];

      for (const endpoint of endpoints) {
        const response = await request(app)[endpoint.method](endpoint.url)
          .expect(404);

        expect(response.body.success).toBe(false);
        expect(response.body.error).toBeDefined();
        expect(response.body.error.code).toBeDefined();
        expect(response.body.error.message).toBeDefined();
        expect(typeof response.body.error.code).toBe('string');
        expect(typeof response.body.error.message).toBe('string');
      }
    });

    it('all 400 errors should have consistent format', async () => {
      const endpoints = [
        { method: 'post', url: '/api/v1/saves', body: {} },
        { method: 'post', url: '/api/v1/game', body: {} },
      ];

      for (const endpoint of endpoints) {
        const response = await request(app)[endpoint.method](endpoint.url)
          .send(endpoint.body)
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.error).toBeDefined();
        expect(response.body.error.code).toBeDefined();
      }
    });

    it('success responses should have meta field', async () => {
      const response = await request(app)
        .get('/api/v1/health')
        .expect(200);

      expect(response.body.meta).toBeDefined();
      expect(typeof response.body.meta.timestamp).toBe('number');
    });
  });
});
