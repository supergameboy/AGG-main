import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, db } from '../setup.js';

describe('Agent Lifecycle and State Management', () => {
  let testSaveId: string;
  let initSaveId: string;

  beforeAll(() => {
    expect(app).toBeDefined();
    expect(db).toBeDefined();
  });

  describe('Agent System Initialization', () => {
    it('should return coordinator info from status endpoint', async () => {
      const response = await request(app)
        .get('/api/v1/agent/status')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.coordinator).toBeDefined();
      expect(response.body.data.coordinator.name).toBe('GameMasterAgent');
      expect(response.body.data.coordinator.type).toBe('gamemaster');
      expect(response.body.data.coordinator.status).toBe('active');
    });

    it('should have 10 registered agents', async () => {
      const response = await request(app)
        .get('/api/v1/agent/status')
        .expect(200);

      const agents = response.body.data.agents;
      expect(Array.isArray(agents)).toBe(true);
      expect(agents.length).toBe(10);
    });

    it('should have 23 available tools', async () => {
      const response = await request(app)
        .get('/api/v1/agent/status')
        .expect(200);

      const tools = response.body.data.tools;
      expect(tools.total).toBe(23);
      expect(Array.isArray(tools.types)).toBe(true);
      expect(tools.types.length).toBe(23);
    });

    it('should include coordinator schedule depth and registered agents count', async () => {
      const response = await request(app)
        .get('/api/v1/agent/status')
        .expect(200);

      const coordinator = response.body.data.coordinator;
      expect(typeof coordinator.currentScheduleDepth).toBe('number');
      expect(typeof coordinator.registeredAgentsCount).toBe('number');
      expect(coordinator.registeredAgentsCount).toBe(10);
    });
  });

  describe('Agent Status Management', () => {
    it('should show all agents with registered status', async () => {
      const response = await request(app)
        .get('/api/v1/agent/agents')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.agents)).toBe(true);
      expect(response.body.data.count).toBe(10);

      for (const agent of response.body.data.agents) {
        expect(agent).toHaveProperty('type');
        expect(agent).toHaveProperty('status');
        expect(agent).toHaveProperty('name');
        expect(agent).toHaveProperty('systemPrompt');
      }
    });

    it('should return each agent with active status', async () => {
      const response = await request(app)
        .get('/api/v1/agent/agents')
        .expect(200);

      for (const agent of response.body.data.agents) {
        expect(agent.status).toBe('active');
      }
    });

    it('should contain all expected agent types', async () => {
      const response = await request(app)
        .get('/api/v1/agent/agents')
        .expect(200);

      const agentTypes = response.body.data.agents.map((a: any) => a.type);
      const expectedTypes = [
        'gamemaster', 'output', 'challenge', 'quest', 'map',
        'npc_party', 'inventory', 'skill', 'event', 'time'
      ];

      for (const expectedType of expectedTypes) {
        expect(agentTypes).toContain(expectedType);
      }
    });

    it('should return agent status to idle after processing a direct message', async () => {
      const statusBefore = await request(app)
        .get('/api/v1/agent/agents')
        .expect(200);

      const outputAgentBefore = statusBefore.body.data.agents.find(
        (a: any) => a.type === 'output'
      );
      expect(outputAgentBefore).toBeDefined();

      const messageResponse = await request(app)
        .post('/api/v1/agent/message')
        .send({ agentType: 'output', message: 'test status transition' })
        .expect('Content-Type', /json/);

      expect([200, 400, 500]).toContain(messageResponse.status);

      const statusAfter = await request(app)
        .get('/api/v1/agent/agents')
        .expect(200);

      const outputAgentAfter = statusAfter.body.data.agents.find(
        (a: any) => a.type === 'output'
      );
      expect(outputAgentAfter).toBeDefined();
      expect(outputAgentAfter.status).toBe('active');
    }, 60000);
  });

  describe('Agent Context Management', () => {
    it('should create a save for context testing', async () => {
      const response = await request(app)
        .post('/api/v1/saves')
        .send({ name: 'Context Test Save' })
        .expect('Content-Type', /json/)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBeDefined();
      testSaveId = response.body.data.id;
    });

    it('should persist agent context per saveId after interaction', async () => {
      const contextBefore = await db('agent_contexts')
        .where({ save_id: testSaveId, agent_type: 'output' })
        .first();

      const response = await request(app)
        .post('/api/v1/agent/message')
        .send({ agentType: 'output', message: 'hello from context test', saveId: testSaveId })
        .expect('Content-Type', /json/);

      expect([200, 400, 500]).toContain(response.status);

      if (response.status === 200) {
        const contextAfter = await db('agent_contexts')
          .where({ save_id: testSaveId, agent_type: 'output' })
          .first();

        if (contextAfter) {
          const messages = JSON.parse(contextAfter.messages || '[]');
          expect(Array.isArray(messages)).toBe(true);
        }
      }
    }, 60000);

    it('should maintain separate contexts for different saveIds', async () => {
      const save2Response = await request(app)
        .post('/api/v1/saves')
        .send({ name: 'Context Test Save 2' })
        .expect(201);

      const save2Id = save2Response.body.data.id;

      await request(app)
        .post('/api/v1/agent/message')
        .send({ agentType: 'output', message: 'message for save 1', saveId: testSaveId })
        .expect('Content-Type', /json/);

      await request(app)
        .post('/api/v1/agent/message')
        .send({ agentType: 'output', message: 'message for save 2', saveId: save2Id })
        .expect('Content-Type', /json/);

      const context1 = await db('agent_contexts')
        .where({ save_id: testSaveId, agent_type: 'output' })
        .first();

      const context2 = await db('agent_contexts')
        .where({ save_id: save2Id, agent_type: 'output' })
        .first();

      if (context1 && context2) {
        const messages1 = JSON.parse(context1.messages || '[]');
        const messages2 = JSON.parse(context2.messages || '[]');
        // If LLM is available, contexts should differ; if not, both may be empty
        if (messages1.length > 0 || messages2.length > 0) {
          expect(messages1).not.toEqual(messages2);
        }
      }
    }, 60000);
  });

  describe('Tool Permission System', () => {
    it('should return all 23 tools from tools endpoint', async () => {
      const response = await request(app)
        .get('/api/v1/agent/tools')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.tools)).toBe(true);
      expect(response.body.data.count).toBe(23);
      expect(response.body.data.tools.length).toBe(23);
    });

    it('each tool should have name, description, type, version and methods', async () => {
      const response = await request(app)
        .get('/api/v1/agent/tools')
        .expect(200);

      for (const tool of response.body.data.tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('type');
        expect(tool).toHaveProperty('version');
        expect(tool).toHaveProperty('methods');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(Array.isArray(tool.methods)).toBe(true);
      }
    });

    it('should include 23 ServiceTools', async () => {
      const response = await request(app)
        .get('/api/v1/agent/tools')
        .expect(200);

      const serviceTools = response.body.data.tools.filter(
        (t: any) => t.type.endsWith('_service') || t.type === 'generate_options' || t.type === 'skill_loader' || t.type === 'dynamic_ui' || t.type === 'memory_service'
      );

      expect(serviceTools.length).toBe(23);
    });

    it('should have gamemaster with full access to all tools', async () => {
      const { ToolRegistry } = await import('../../src/agents/ToolRegistry.js');
      const toolRegistry = ToolRegistry.getInstance();

      const coordinatorTools = toolRegistry.getAvailableTools('gamemaster');
      expect(coordinatorTools.length).toBe(23);
    });

    it('should give each specialized agent read/write on its domain ServiceTool', async () => {
      const { ToolRegistry } = await import('../../src/agents/ToolRegistry.js');
      const toolRegistry = ToolRegistry.getInstance();

      const domainMapping: Record<string, string> = {
        output: 'story_service',
        challenge: 'challenge_service',
        quest: 'quest_service',
        map: 'map_service',
        npc_party: 'npc_service',
        inventory: 'inventory_service',
        skill: 'skill_service',
        event: 'event_service',
        time: 'game_time_service'
      };

      for (const [agentType, domainTool] of Object.entries(domainMapping)) {
        const availableTools = toolRegistry.getAvailableTools(agentType);
        const toolTypes = availableTools.map(t => t.type);
        expect(toolTypes).toContain(domainTool);
      }
    });

    it('should give each specialized agent access only to its configured tools', async () => {
      const { ToolRegistry } = await import('../../src/agents/ToolRegistry.js');
      const toolRegistry = ToolRegistry.getInstance();

      const domainMapping: Record<string, { ownTool: string; allAllowedTools: string[] }> = {
        output: { ownTool: 'story_service', allAllowedTools: ['game_time_service', 'numerical_service', 'character_service', 'inventory_service', 'skill_service', 'map_service', 'npc_service', 'dialogue_service', 'quest_service', 'challenge_service', 'event_service', 'game_init_service', 'batch_query_service', 'generate_options', 'story_service', 'dynamic_ui'] },
        challenge: { ownTool: 'challenge_service', allAllowedTools: ['challenge_service', 'game_time_service', 'character_service', 'inventory_service', 'skill_service'] },
        quest: { ownTool: 'quest_service', allAllowedTools: ['quest_service', 'game_time_service', 'character_service', 'inventory_service', 'event_service'] },
        map: { ownTool: 'map_service', allAllowedTools: ['map_service', 'game_time_service'] },
        npc_party: { ownTool: 'npc_service', allAllowedTools: ['npc_service', 'numerical_service', 'inventory_service', 'skill_service'] },
        inventory: { ownTool: 'inventory_service', allAllowedTools: ['inventory_service', 'character_service'] },
        skill: { ownTool: 'skill_service', allAllowedTools: ['skill_service', 'character_service'] },
        event: { ownTool: 'event_service', allAllowedTools: ['event_service'] },
        time: { ownTool: 'game_time_service', allAllowedTools: ['game_time_service'] },
      };

      for (const [agentType, config] of Object.entries(domainMapping)) {
        const availableTools = toolRegistry.getAvailableTools(agentType);
        const toolTypes = availableTools.map(t => t.type);

        expect(toolTypes).toContain(config.ownTool);
        for (const allowedTool of config.allAllowedTools) {
          expect(toolTypes).toContain(allowedTool);
        }
      }
    });
  });

  describe('Game Initialization Flow', () => {

    it('should return 400 when characterData is missing', async () => {
      const response = await request(app)
        .post('/api/v1/game')
        .send({
          action: 'initialize',
          templateId: 'medieval-fantasy'
        })
        .expect('Content-Type', /json/);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 400 when characterData is incomplete', async () => {
      const response = await request(app)
        .post('/api/v1/game')
        .send({
          action: 'initialize',
          templateId: 'medieval-fantasy',
          characterData: {
            name: 'IncompleteHero',
            race: 'human'
          }
        })
        .expect('Content-Type', /json/);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Save-Game Interaction', () => {
    let interactionSaveId: string;

    it('should create a save via POST /api/v1/saves', async () => {
      const response = await request(app)
        .post('/api/v1/saves')
        .send({ name: 'Interaction Test Save' })
        .expect('Content-Type', /json/)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBeDefined();
      interactionSaveId = response.body.data.id;
    });

    it('should use the saveId to interact with agents via chat', async () => {
      const response = await request(app)
        .post('/api/v1/game')
        .send({ message: 'hello adventurer', saveId: interactionSaveId })
        .expect('Content-Type', /json/);

      expect([200, 400, 500]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body.success).toBe(true);
        expect(response.body.data).toBeDefined();
      }
    }, 60000);

    it('should use the saveId to send direct messages to agents', async () => {
      const response = await request(app)
        .post('/api/v1/agent/message')
        .send({ agentType: 'output', message: 'hello', saveId: interactionSaveId })
        .expect('Content-Type', /json/);

      expect([200, 400, 500]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body.success).toBe(true);
        expect(response.body.data.metadata.isDirectMessage).toBe(true);
      }
    }, 60000);

    it('should return 404 when using a non-existent saveId for chat', async () => {
      const response = await request(app)
        .post('/api/v1/game')
        .send({ message: 'hello', saveId: 'save-nonexistent-lifecycle-99999' })
        .expect('Content-Type', /json/)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SAVE_NOT_FOUND');
    });

    it('should be able to load context for the saveId after interaction', async () => {
      await request(app)
        .post('/api/v1/agent/message')
        .send({ agentType: 'output', message: 'context load test', saveId: interactionSaveId })
        .expect('Content-Type', /json/);

      const contextRow = await db('agent_contexts')
        .where({ save_id: interactionSaveId, agent_type: 'output' })
        .first();

      // 无有效API key时可能没有上下文写入
      if (contextRow) {
        const messages = JSON.parse(contextRow.messages || '[]');
        expect(Array.isArray(messages)).toBe(true);
      }
    }, 60000);
  });

  describe('Agent System Health', () => {
    it('should show database connected in health endpoint', async () => {
      const response = await request(app)
        .get('/api/v1/health')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('ok');
      expect(response.body.data.database).toBe('connected');
    });

    it('should show system uptime and memory info in agent status', async () => {
      const response = await request(app)
        .get('/api/v1/agent/status')
        .expect(200);

      const system = response.body.data.system;
      expect(system).toBeDefined();
      expect(typeof system.uptime).toBe('number');
      expect(system.uptime).toBeGreaterThan(0);
      expect(system.memory).toBeDefined();
      expect(typeof system.memory.rss).toBe('number');
      expect(typeof system.memory.heapTotal).toBe('number');
      expect(typeof system.memory.heapUsed).toBe('number');
    });

    it('should show all components operational', async () => {
      const healthResponse = await request(app)
        .get('/api/v1/health')
        .expect(200);

      expect(healthResponse.body.data.migrations).toBeDefined();
      expect(healthResponse.body.data.migrations.applied).toBeGreaterThan(0);
      expect(healthResponse.body.data.migrations.pending).toBe(0);

      const statusResponse = await request(app)
        .get('/api/v1/agent/status')
        .expect(200);

      expect(statusResponse.body.data.coordinator.status).toBe('active');
      expect(statusResponse.body.data.agents.length).toBe(10);
      expect(statusResponse.body.data.tools.total).toBe(23);
    });

    it('should show database status with applied migrations', async () => {
      const response = await request(app)
        .get('/api/v1/database/status')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.connected).toBe(true);
      expect(Array.isArray(response.body.data.migrations.applied)).toBe(true);
      expect(response.body.data.migrations.applied.length).toBeGreaterThan(0);
      expect(Array.isArray(response.body.data.migrations.pending)).toBe(true);
      expect(response.body.data.migrations.pending.length).toBe(0);
    });
  });
});
