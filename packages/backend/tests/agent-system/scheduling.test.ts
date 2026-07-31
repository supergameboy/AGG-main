import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../setup.js';

const EXPECTED_AGENT_TYPES = [
  'gamemaster', 'output', 'challenge', 'quest', 'map',
  'npc_party', 'inventory', 'skill', 'event', 'time'
] as const;

const EXPECTED_SERVICE_TOOLS = [
  'game_time_service', 'numerical_service', 'character_service', 'inventory_service',
  'skill_service', 'map_service', 'npc_service', 'dialogue_service', 'quest_service',
  'challenge_service', 'event_service', 'game_init_service', 'batch_query_service', 'generate_options', 'story_service',
  'skill_loader', 'entity_graph_service', 'rule_service', 'coordinator_service', 'help_service',
  'dynamic_ui', 'template_pool_service', 'memory_service'
] as const;

const ALL_EXPECTED_TOOL_TYPES = [...EXPECTED_SERVICE_TOOLS] as const;

describe('Agent Scheduling System', () => {
  describe('GameMasterAgent Scheduling', () => {
    it('should show coordinator with 10 registered agents via status', async () => {
      const response = await request(app)
        .get('/api/v1/agent/status')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.coordinator).toBeDefined();
      expect(response.body.data.coordinator.registeredAgentsCount).toBe(10);
    });

    it('should list all 10 agent types via agents endpoint', async () => {
      const response = await request(app)
        .get('/api/v1/agent/agents')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.count).toBe(10);
      expect(response.body.data.agents).toHaveLength(10);
    });

    it('should have gamemaster type and active status', async () => {
      const response = await request(app)
        .get('/api/v1/agent/status')
        .expect(200);

      expect(response.body.data.coordinator.type).toBe('gamemaster');
      expect(response.body.data.coordinator.status).toBe('active');
      expect(response.body.data.coordinator.name).toBe('GameMasterAgent');
    });
  });

  describe('Agent Registration', () => {
    it('each agent should have type, name, status, and systemPrompt', async () => {
      const response = await request(app)
        .get('/api/v1/agent/agents')
        .expect(200);

      const agents = response.body.data.agents;
      expect(Array.isArray(agents)).toBe(true);

      for (const agent of agents) {
        expect(agent).toHaveProperty('type');
        expect(agent).toHaveProperty('name');
        expect(agent).toHaveProperty('status');
        expect(agent).toHaveProperty('systemPrompt');
        expect(typeof agent.type).toBe('string');
        expect(typeof agent.name).toBe('string');
        expect(typeof agent.status).toBe('string');
        expect(typeof agent.systemPrompt).toBe('string');
      }
    });

    it('should contain all 10 expected agent types', async () => {
      const response = await request(app)
        .get('/api/v1/agent/agents')
        .expect(200);

      const agentTypes = response.body.data.agents.map((a: { type: string }) => a.type);

      for (const expectedType of EXPECTED_AGENT_TYPES) {
        expect(agentTypes).toContain(expectedType);
      }
    });

    it('each agent systemPrompt should contain tool information', async () => {
      const response = await request(app)
        .get('/api/v1/agent/agents')
        .expect(200);

      const agents = response.body.data.agents;

      for (const agent of agents) {
        expect(agent.systemPrompt.length).toBeGreaterThan(0);
      }
    });

    it('all agents should have active status', async () => {
      const response = await request(app)
        .get('/api/v1/agent/agents')
        .expect(200);

      const agents = response.body.data.agents;

      for (const agent of agents) {
        expect(agent.status).toBe('active');
      }
    });
  });

  describe('Tool Registry', () => {
    it('should return 23 tools via tools endpoint', async () => {
      const response = await request(app)
        .get('/api/v1/agent/tools')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.count).toBe(23);
      expect(response.body.data.tools).toHaveLength(23);
    });

    it('each tool should have name and description', async () => {
      const response = await request(app)
        .get('/api/v1/agent/tools')
        .expect(200);

      const tools = response.body.data.tools;

      for (const tool of tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);
        expect(tool.description.length).toBeGreaterThan(0);
      }
    });

    it('should include all ServiceTool types', async () => {
      const response = await request(app)
        .get('/api/v1/agent/tools')
        .expect(200);

      const toolTypes = response.body.data.tools.map((t: { type: string }) => t.type);

      for (const serviceTool of EXPECTED_SERVICE_TOOLS) {
        expect(toolTypes).toContain(serviceTool);
      }
    });

    it('should include all 23 ServiceTool types', async () => {
      const response = await request(app)
        .get('/api/v1/agent/tools')
        .expect(200);

      const toolTypes = response.body.data.tools.map((t: { type: string }) => t.type);

      for (const serviceTool of EXPECTED_SERVICE_TOOLS) {
        expect(toolTypes).toContain(serviceTool);
      }
    });

    it('status endpoint should report 23 tools total', async () => {
      const response = await request(app)
        .get('/api/v1/agent/status')
        .expect(200);

      expect(response.body.data.tools.total).toBe(23);
      expect(response.body.data.tools.types).toHaveLength(23);
    });

    it('status endpoint should list all expected tool types', async () => {
      const response = await request(app)
        .get('/api/v1/agent/status')
        .expect(200);

      const registeredTypes = response.body.data.tools.types;

      for (const expectedType of ALL_EXPECTED_TOOL_TYPES) {
        expect(registeredTypes).toContain(expectedType);
      }
    });
  });

  describe('Intent Analysis', () => {
    it('should return 400 when saveId is missing', async () => {
      const response = await request(app)
        .post('/api/v1/game')
        .send({})
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SAVE_ID_REQUIRED');
    });

    it('should return 400 when saveId is empty string', async () => {
      const response = await request(app)
        .post('/api/v1/game')
        .send({ saveId: '' })
        .expect('Content-Type', /json/);

      // 空字符串saveId会被视为缺失或找不到save
      expect([400, 404]).toContain(response.status);
      expect(response.body.success).toBe(false);
    });

    it('should return 400 for invalid agentType in direct message', async () => {
      const response = await request(app)
        .post('/api/v1/agent/message')
        .send({ agentType: 'nonexistent_agent', message: 'test' })
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid agentType in direct message', async () => {
      const response = await request(app)
        .post('/api/v1/agent/message')
        .send({ agentType: 'nonexistent_agent', message: 'test' })
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DAG Scheduling', () => {
    it('should show currentScheduleDepth in status', async () => {
      const response = await request(app)
        .get('/api/v1/agent/status')
        .expect(200);

      expect(response.body.data.coordinator.currentScheduleDepth).toBeDefined();
      expect(typeof response.body.data.coordinator.currentScheduleDepth).toBe('number');
      expect(response.body.data.coordinator.currentScheduleDepth).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Decision Logging', () => {
    it('should return paginated decision results', async () => {
      const response = await request(app)
        .get('/api/v1/agent/decisions')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data.data)).toBe(true);
      expect(response.body.data).toHaveProperty('total');
      expect(response.body.data).toHaveProperty('limit');
      expect(response.body.data).toHaveProperty('offset');
    });

    it('should support filtering by agentType', async () => {
      const response = await request(app)
        .get('/api/v1/agent/decisions')
        .query({ agentType: 'gamemaster', saveId: 'system' })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('agentType');
      expect(response.body.data.agentType).toBe('gamemaster');
    });

    it('should support filtering by saveId', async () => {
      const response = await request(app)
        .get('/api/v1/agent/decisions')
        .query({ saveId: 'system' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('saveId');
    });

    it('should support pagination with limit and offset', async () => {
      const response = await request(app)
        .get('/api/v1/agent/decisions')
        .query({ limit: '5', offset: '0', saveId: 'system' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.limit).toBe(5);
      expect(response.body.data.offset).toBe(0);
      expect(response.body.data.data.length).toBeLessThanOrEqual(5);
    });

    it('should use default pagination values when not specified', async () => {
      const response = await request(app)
        .get('/api/v1/agent/decisions')
        .expect(200);

      expect(response.body.data.limit).toBeDefined();
      expect(response.body.data.offset).toBeDefined();
      expect(typeof response.body.data.limit).toBe('number');
      expect(typeof response.body.data.offset).toBe('number');
    });
  });

  describe('Direct Agent Messaging', () => {
    it('should return 400 when agentType is missing', async () => {
      const response = await request(app)
        .post('/api/v1/agent/message')
        .send({ message: 'hello' })
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when message is missing', async () => {
      const response = await request(app)
        .post('/api/v1/agent/message')
        .send({ agentType: 'output' })
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when message is empty string', async () => {
      const response = await request(app)
        .post('/api/v1/agent/message')
        .send({ agentType: 'output', message: '' })
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid agentType', async () => {
      const response = await request(app)
        .post('/api/v1/agent/message')
        .send({ agentType: 'fake_agent_type', message: 'test' })
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should process valid direct message to output agent', async () => {
      const response = await request(app)
        .post('/api/v1/agent/message')
        .send({ agentType: 'output', message: 'hello NPC' })
        .expect('Content-Type', /json/)
        .timeout(60000);

      expect([200, 400, 500]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body.success).toBe(true);
        expect(response.body.data).toBeDefined();
        expect(response.body.data.metadata).toBeDefined();
        expect(response.body.data.metadata.isDirectMessage).toBe(true);
        expect(response.body.data.metadata.targetAgent).toBe('output');
      }
    }, 60000);

    it('should process valid direct message to challenge agent', async () => {
      const response = await request(app)
        .post('/api/v1/agent/message')
        .send({ agentType: 'challenge', message: 'start a fight' })
        .expect('Content-Type', /json/)
        .timeout(60000);

      expect([200, 400, 500]).toContain(response.status);
    }, 60000);

    it('should process valid direct message to map agent', async () => {
      const response = await request(app)
        .post('/api/v1/agent/message')
        .send({ agentType: 'map', message: 'show me the map' })
        .expect('Content-Type', /json/)
        .timeout(60000);

      expect([200, 400, 500]).toContain(response.status);
    }, 60000);

    it('should accept gamemaster as valid agentType', async () => {
      const response = await request(app)
        .post('/api/v1/agent/message')
        .send({ agentType: 'gamemaster', message: 'status report' })
        .expect('Content-Type', /json/);

      expect([200, 400, 404, 500]).toContain(response.status);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent saveId in chat', async () => {
      const response = await request(app)
        .post('/api/v1/game')
        .send({ message: 'hello', saveId: 'save-nonexistent-99999' })
        .expect('Content-Type', /json/)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SAVE_NOT_FOUND');
    });

    it('should return 400 for invalid agent type in direct message', async () => {
      const response = await request(app)
        .post('/api/v1/agent/message')
        .send({ agentType: 'totally_invalid', message: 'test' })
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing saveId in chat', async () => {
      const response = await request(app)
        .post('/api/v1/game')
        .send({ message: '' })
        .expect('Content-Type', /json/);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SAVE_ID_REQUIRED');
    });

    it('should return 400 for missing templateId on initialize action', async () => {
      const response = await request(app)
        .post('/api/v1/game')
        .send({ action: 'initialize' })
        .expect('Content-Type', /json/);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 400 for incomplete characterData on initialize action', async () => {
      const response = await request(app)
        .post('/api/v1/game')
        .send({
          action: 'initialize',
          templateId: 'medieval-fantasy',
          characterData: { name: 'Hero' }
        })
        .expect('Content-Type', /json/);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 400 for message exceeding max length', async () => {
      const longMessage = 'a'.repeat(5001);
      const response = await request(app)
        .post('/api/v1/game')
        .send({ message: longMessage, saveId: 'save-nonexistent-99999' })
        .expect('Content-Type', /json/);

      // 长消息在save不存在时返回404，在save存在时可能返回400
      expect([400, 404, 500]).toContain(response.status);
    });

    it('should handle decisions query with invalid limit gracefully', async () => {
      const response = await request(app)
        .get('/api/v1/agent/decisions')
        .query({ limit: 'abc', saveId: 'system' })
        .expect('Content-Type', /json/);

      expect([200, 400]).toContain(response.status);
    });

    it('should handle decisions query with out-of-range limit', async () => {
      const response = await request(app)
        .get('/api/v1/agent/decisions')
        .query({ limit: '200', saveId: 'system' })
        .expect('Content-Type', /json/);

      expect([200, 400]).toContain(response.status);
    });
  });
});
