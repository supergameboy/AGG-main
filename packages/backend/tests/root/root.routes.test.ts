import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../setup.js';

describe('Root Level API Integration Tests', () => {
  beforeAll(() => {
    expect(app).toBeDefined();
  });

  describe('GET /api/v1/health', () => {
    it('should return 200 with health status', async () => {
      const response = await request(app)
        .get('/api/v1/health')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.status).toBe('ok');
      expect(response.body.data.database).toBe('connected');
      expect(response.body.data.migrations).toBeDefined();
      expect(typeof response.body.data.migrations.applied).toBe('number');
      expect(typeof response.body.data.migrations.pending).toBe('number');
      expect(response.body.data.websocket).toBeDefined();
    });

    it('should include meta with timestamp and requestId', async () => {
      const response = await request(app)
        .get('/api/v1/health')
        .expect(200);

      expect(response.body.meta).toBeDefined();
      expect(typeof response.body.meta.timestamp).toBe('number');
    });
  });

  describe('GET /api/v1/database/status', () => {
    it('should return 200 with database status', async () => {
      const response = await request(app)
        .get('/api/v1/database/status')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.connected).toBe(true);
      expect(response.body.data.migrations).toBeDefined();
      expect(Array.isArray(response.body.data.migrations.applied)).toBe(true);
      expect(Array.isArray(response.body.data.migrations.pending)).toBe(true);
      expect(typeof response.body.data.databasePath).toBe('string');
    });

    it('should have applied migrations with version numbers', async () => {
      const response = await request(app)
        .get('/api/v1/database/status')
        .expect(200);

      const applied = response.body.data.migrations.applied;
      expect(applied.length).toBeGreaterThan(0);
      for (const version of applied) {
        expect(typeof version).toBe('number');
      }
    });
  });
});
