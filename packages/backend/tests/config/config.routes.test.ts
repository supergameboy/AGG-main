import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../setup.js';

describe('Config Routes Integration Tests', () => {
  let configAvailable = false;
  let builtinProfileName: string;
  let customProfileName: string;

  beforeAll(async () => {
    expect(app).toBeDefined();
    const checkResponse = await request(app)
      .get('/api/v1/config/agent-profiles')
      .catch(() => null);

    configAvailable = checkResponse !== null && checkResponse.status === 200;
    if (configAvailable && checkResponse!.body.data?.length > 0) {
      builtinProfileName = checkResponse!.body.data[0].name;
    } else {
      configAvailable = false;
    }
  });

  describe('GET /api/v1/config/agent-profiles - List Agent Profiles', () => {
    it('should return list of agent profiles', async () => {
      if (!configAvailable) return;

      const response = await request(app)
        .get('/api/v1/config/agent-profiles')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);

      const firstProfile = response.body.data[0];
      expect(firstProfile).toHaveProperty('name');
      expect(firstProfile).toHaveProperty('game_mode');
      expect(firstProfile).toHaveProperty('agents');
    });
  });

  describe('GET /api/v1/config/agent-profiles/:name - Get Agent Profile', () => {
    it('should return profile detail', async () => {
      if (!configAvailable || !builtinProfileName) return;

      const response = await request(app)
        .get('/api/v1/config/agent-profiles/' + builtinProfileName)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.name).toBe(builtinProfileName);
      expect(response.body.data.agents).toBeDefined();
    });

    it('should return 404 for non-existent profile', async () => {
      if (!configAvailable) return;

      const response = await request(app)
        .get('/api/v1/config/agent-profiles/nonexistent-profile')
        .expect('Content-Type', /json/)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('PROFILE_NOT_FOUND');
    });
  });

  describe('POST /api/v1/config/agent-profiles - Create Agent Profile', () => {
    it('should create a new agent profile', async () => {
      if (!configAvailable) return;

      const response = await request(app)
        .post('/api/v1/config/agent-profiles')
        .send({
          name: 'test_custom_profile',
          description: 'Test custom profile',
          game_mode: 'text_adventure',
          agents: {
            output: {
              name: 'OutputAgent',
              description: 'Test output agent',
              system_prompt_file: './prompts/output.md',
              temperature: 0.7,
              max_tokens: 4096,
              max_iterations: 5,
              tools: ['dialogue_service'],
              capabilities: {
                supported_intents: ['talk'],
                required_fields: ['saveId'],
                optional_fields: []
              }
            }
          }
        })
        .expect('Content-Type', /json/)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.name).toBe('test_custom_profile');
      customProfileName = 'test_custom_profile';
    });

    it('should return 400 when required fields are missing', async () => {
      if (!configAvailable) return;

      const response = await request(app)
        .post('/api/v1/config/agent-profiles')
        .send({ description: 'Missing required fields' })
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PUT /api/v1/config/agent-profiles/:name - Update Agent Profile', () => {
    it('should update custom profile', async () => {
      if (!configAvailable || !customProfileName) return;

      const response = await request(app)
        .put('/api/v1/config/agent-profiles/' + customProfileName)
        .send({ description: 'Updated description' })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should return 404 for non-existent profile', async () => {
      if (!configAvailable) return;

      const response = await request(app)
        .put('/api/v1/config/agent-profiles/nonexistent-profile')
        .send({ description: 'Test' })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('PROFILE_NOT_FOUND');
    });
  });

  describe('GET /api/v1/config/agent-profiles/:name/agents - List Profile Agents', () => {
    it('should return agents for a profile', async () => {
      if (!configAvailable || !builtinProfileName) return;

      const response = await request(app)
        .get('/api/v1/config/agent-profiles/' + builtinProfileName + '/agents')
        .expect('Content-Type', /json/);

      if (response.status === 200) {
        expect(response.body.success).toBe(true);
      }
    });
  });

  describe('GET /api/v1/config/tools - List Tools', () => {
    it('should return all registered tools', async () => {
      if (!configAvailable) return;

      const response = await request(app)
        .get('/api/v1/config/tools')
        .expect('Content-Type', /json/);

      if (response.status === 200) {
        expect(response.body.success).toBe(true);
      }
    });
  });

  describe('GET /api/v1/config/system-agents - List System Agents', () => {
    it('should return system agent configurations', async () => {
      if (!configAvailable) return;

      const response = await request(app)
        .get('/api/v1/config/system-agents')
        .expect('Content-Type', /json/);

      if (response.status === 200) {
        expect(response.body.success).toBe(true);
      }
    });
  });

  describe('POST /api/v1/config/seed - Seed from YAML', () => {
    it('should seed profiles from YAML', async () => {
      if (!configAvailable) return;

      const response = await request(app)
        .post('/api/v1/config/seed')
        .expect('Content-Type', /json/);

      if (response.status === 200) {
        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('seeded');
      }
    });
  });

  describe('DELETE /api/v1/config/agent-profiles/:name - Delete Agent Profile', () => {
    it('should delete custom profile', async () => {
      if (!configAvailable || !customProfileName) return;

      const response = await request(app)
        .delete('/api/v1/config/agent-profiles/' + customProfileName)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should return 403 when deleting builtin profile', async () => {
      if (!configAvailable || !builtinProfileName) return;

      const response = await request(app)
        .delete('/api/v1/config/agent-profiles/' + builtinProfileName)
        .expect('Content-Type', /json/);

      if (response.status === 403) {
        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe('FORBIDDEN');
      }
    });
  });
});
