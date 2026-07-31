import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, db } from '../setup.js';

describe('Save Routes Integration Tests', () => {
  let createdSaveId: string;
  let copiedSaveId: string;
  let snapshotId: string;

  beforeAll(() => {
    expect(app).toBeDefined();
    expect(db).toBeDefined();
  });

  describe('POST /api/v1/saves - Create Save', () => {
    it('should create a new save with required name field', async () => {
      const response = await request(app)
        .post('/api/v1/saves')
        .send({ name: 'Test Save' })
        .expect('Content-Type', /json/)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.name).toBe('Test Save');
      expect(response.body.data.id).toBeDefined();
      createdSaveId = response.body.data.id;
      expect(createdSaveId).toBeDefined();
      expect(createdSaveId.length).toBeGreaterThan(0);
    });

    it('should return 400 when name is missing', async () => {
      const response = await request(app)
        .post('/api/v1/saves')
        .send({})
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
    });

    it('should return 400 when name is not a string', async () => {
      const response = await request(app)
        .post('/api/v1/saves')
        .send({ name: 123 })
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should create save with optional templateId', async () => {
      const response = await request(app)
        .post('/api/v1/saves')
        .send({ name: 'Save With Template', templateId: 'test-template' })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('Save With Template');
    });
  });

  describe('GET /api/v1/saves - List Saves', () => {
    it('should return list of saves with total', async () => {
      const response = await request(app)
        .get('/api/v1/saves')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data.saves)).toBe(true);
      expect(typeof response.body.data.total).toBe('number');
      expect(response.body.data.saves.length).toBeGreaterThan(0);
    });

    it('should support query parameters for filtering', async () => {
      const response = await request(app)
        .get('/api/v1/saves')
        .query({ limit: '5', offset: '0' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.saves)).toBe(true);
      expect(typeof response.body.data.total).toBe('number');
    });

    it('should support nameContains filter', async () => {
      const response = await request(app)
        .get('/api/v1/saves')
        .query({ nameContains: 'Test' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.saves)).toBe(true);
    });
  });

  describe('GET /api/v1/saves/:saveId - Get Save Detail', () => {
    it('should return save detail with character data', async () => {
      const response = await request(app)
        .get(`/api/v1/saves/${createdSaveId}`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.id).toBe(createdSaveId);
      expect(response.body.data.name).toBe('Test Save');
    });

    it('should return 404 for non-existent save', async () => {
      const response = await request(app)
        .get('/api/v1/saves/save-nonexistent-12345')
        .expect('Content-Type', /json/)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SAVE_NOT_FOUND');
    });
  });

  describe('PATCH /api/v1/saves/:saveId - Update Save Metadata', () => {
    it('should update save metadata', async () => {
      const response = await request(app)
        .patch(`/api/v1/saves/${createdSaveId}`)
        .send({ chapter: 'Chapter 1', location: 'Village' })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.chapter).toBe('Chapter 1');
      expect(response.body.data.location).toBe('Village');
    });

    it('should return 400 when no fields provided', async () => {
      const response = await request(app)
        .patch(`/api/v1/saves/${createdSaveId}`)
        .send({})
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
    });

    it('should return 404 for non-existent save', async () => {
      const response = await request(app)
        .patch('/api/v1/saves/save-nonexistent-12345')
        .send({ chapter: 'Test' })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SAVE_NOT_FOUND');
    });
  });

  describe('PUT /api/v1/saves/:saveId - Save (Manual Save)', () => {
    it('should save and create snapshot', async () => {
      const response = await request(app)
        .put(`/api/v1/saves/${createdSaveId}`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.saved).toBe(true);
      expect(response.body.data.saveId).toBe(createdSaveId);
    });

    it('should return 404 for non-existent save', async () => {
      const response = await request(app)
        .put('/api/v1/saves/save-nonexistent-12345')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SAVE_NOT_FOUND');
    });
  });

  describe('POST /api/v1/saves/:saveId/auto - Auto Save', () => {
    it('should auto save and return autoSaved status', async () => {
      const response = await request(app)
        .post(`/api/v1/saves/${createdSaveId}/auto`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(typeof response.body.data.autoSaved).toBe('boolean');
      expect(response.body.data.saveId).toBe(createdSaveId);
      // autoSaved may be false with reason 'no_changes' if no significant changes
      if (!response.body.data.autoSaved) {
        expect(response.body.data.reason).toBeDefined();
      }
    });
  });

  describe('POST /api/v1/saves/:saveId/copy - Copy Save', () => {
    it('should copy save with all associated data', async () => {
      const response = await request(app)
        .post(`/api/v1/saves/${createdSaveId}/copy`)
        .send({ name: 'Copied Save' })
        .expect('Content-Type', /json/)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.name).toBe('Copied Save');
      expect(response.body.data.id).not.toBe(createdSaveId);
      copiedSaveId = response.body.data.id;
    });

    it('should copy save with default name when no name provided', async () => {
      const response = await request(app)
        .post(`/api/v1/saves/${createdSaveId}/copy`)
        .send({})
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toContain('副本');
    });

    it('should return 404 for non-existent source save', async () => {
      const response = await request(app)
        .post('/api/v1/saves/save-nonexistent-12345/copy')
        .send({ name: 'Test Copy' })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SAVE_NOT_FOUND');
    });
  });

  describe('POST /api/v1/saves/:saveId/export - Export Save', () => {
    it('should export save data with version info', async () => {
      const response = await request(app)
        .post(`/api/v1/saves/${createdSaveId}/export`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.version).toBeDefined();
      expect(typeof response.body.data.exportedAt).toBe('number');
      expect(response.body.data.save).toBeDefined();
    });

    it('should return 404 for non-existent save', async () => {
      const response = await request(app)
        .post('/api/v1/saves/save-nonexistent-12345/export')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SAVE_NOT_FOUND');
    });
  });

  describe('POST /api/v1/saves/import - Import Save', () => {
    it('should import save from exported data', async () => {
      const exportResponse = await request(app)
        .post(`/api/v1/saves/${createdSaveId}/export`)
        .expect(200);

      const importResponse = await request(app)
        .post('/api/v1/saves/import')
        .send({ data: exportResponse.body.data })
        .expect('Content-Type', /json/)
        .expect(201);

      expect(importResponse.body.success).toBe(true);
      expect(importResponse.body.data.imported).toBe(true);
      expect(importResponse.body.data.saveId).toBeDefined();
    });

    it('should return 400 when data is missing', async () => {
      const response = await request(app)
        .post('/api/v1/saves/import')
        .send({})
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
    });
  });

  describe('Snapshots', () => {
    it('should create a snapshot', async () => {
      const response = await request(app)
        .post(`/api/v1/saves/${createdSaveId}/snapshots`)
        .send({ chapterName: 'Chapter 1 Complete', snapshotType: 'manual' })
        .expect('Content-Type', /json/)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.id).toBeDefined();
      expect(response.body.data.save_id).toBe(createdSaveId);
      expect(response.body.data.type).toBe('manual');
      expect(response.body.data.name).toBeDefined();
      snapshotId = response.body.data.id;
    });

    it('should return 404 when creating snapshot for non-existent save', async () => {
      const response = await request(app)
        .post('/api/v1/saves/save-nonexistent-12345/snapshots')
        .send({ chapterName: 'Test' })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SAVE_NOT_FOUND');
    });

    it('should list snapshots for a save', async () => {
      const response = await request(app)
        .get(`/api/v1/saves/${createdSaveId}/snapshots`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      // Verify snapshot fields use snake_case
      const firstSnapshot = response.body.data[0];
      expect(firstSnapshot.save_id).toBe(createdSaveId);
      expect(firstSnapshot.type).toBeDefined();
      expect(firstSnapshot.name).toBeDefined();
    });

    it('should list snapshots filtered by type', async () => {
      const response = await request(app)
        .get(`/api/v1/saves/${createdSaveId}/snapshots`)
        .query({ type: 'manual' })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      // All returned snapshots should be of type 'manual'
      for (const snap of response.body.data) {
        expect(snap.type).toBe('manual');
      }
    });

    it('should get a single snapshot', async () => {
      const response = await request(app)
        .get(`/api/v1/saves/${createdSaveId}/snapshots/${snapshotId}`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      // loadSnapshot returns CompleteSaveData which includes save fields
      expect(response.body.data.id).toBeDefined();
    });

    it('should return 404 for non-existent snapshot', async () => {
      const response = await request(app)
        .get(`/api/v1/saves/${createdSaveId}/snapshots/snapshot-nonexistent`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SNAPSHOT_NOT_FOUND');
    });

    it('should restore from snapshot', async () => {
      const response = await request(app)
        .post(`/api/v1/saves/${createdSaveId}/snapshots/${snapshotId}/restore`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      // restoreSnapshot returns SaveRecord
      expect(response.body.data.id).toBe(createdSaveId);
    });

    it('should return 404 for restoring non-existent snapshot', async () => {
      const response = await request(app)
        .post(`/api/v1/saves/${createdSaveId}/snapshots/snapshot-nonexistent/restore`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should delete a snapshot', async () => {
      // Create a snapshot to delete
      const createResponse = await request(app)
        .post(`/api/v1/saves/${createdSaveId}/snapshots`)
        .send({ snapshotType: 'manual' })
        .expect(201);

      const snapToDeleteId = createResponse.body.data.id;

      const response = await request(app)
        .delete(`/api/v1/saves/${createdSaveId}/snapshots/${snapToDeleteId}`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.success).toBe(true);
    });

    it('should return 404 when deleting non-existent snapshot', async () => {
      const response = await request(app)
        .delete(`/api/v1/saves/${createdSaveId}/snapshots/snapshot-nonexistent`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SNAPSHOT_NOT_FOUND');
    });
  });

  describe('DELETE /api/v1/saves/:saveId - Delete Save', () => {
    it('should delete a save', async () => {
      const response = await request(app)
        .delete(`/api/v1/saves/${copiedSaveId}`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.deleted).toBe(true);
      expect(response.body.data.saveId).toBe(copiedSaveId);
    });

    it('should confirm save is deleted (404 on get)', async () => {
      await request(app)
        .get(`/api/v1/saves/${copiedSaveId}`)
        .expect(404);
    });
  });
});
