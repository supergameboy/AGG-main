import express from 'express';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConfigRouter } from '../config.js';
import { errorHandler } from '../../middlewares/errorhandler.js';
import { runMigrations } from '../../migrations/runner.js';
import type { YamlAgentFactory } from '../../agents/config/YamlAgentFactory.js';
import type { ConfigLoader } from '../../agents/config/ConfigLoader.js';
import type { AgentProfile } from '../../../../shared/src/types/agent-config.js';

// === Mock 工厂 ===

function createMockConfigLoader(overrides?: Partial<ConfigLoader>): ConfigLoader {
  const defaultProfile: AgentProfile = {
    name: 'fantasy_rpg',
    game_mode: 'fantasy_rpg',
    description: 'Fantasy RPG profile',
    agents: {
      gamemaster: {
        name: 'GameMaster',
        description: 'Main game master agent',
        system_prompt_file: 'gamemaster.md',
        tools: ['dialogue_service', 'combat_service'],
        temperature: 0.7,
        max_iterations: 200,
        capabilities: { supported_intents: ['chat', 'initialize'], required_fields: [] },
      },
      dialogue: {
        name: 'Dialogue Agent',
        description: 'Handles dialogue',
        system_prompt_file: 'dialogue.md',
        tools: ['dialogue_service'],
        temperature: 0.8,
        max_iterations: 5,
        capabilities: { supported_intents: ['dialogue'], required_fields: [] },
      },
    },
  };

  return {
    getAllProfiles: vi.fn().mockReturnValue([defaultProfile]),
    getAllProfilesFromDB: vi.fn().mockResolvedValue([]),
    getProfileWithDBFallback: vi.fn().mockResolvedValue(defaultProfile),
    createProfile: vi.fn().mockResolvedValue(defaultProfile),
    updateProfile: vi.fn().mockResolvedValue(defaultProfile),
    deleteProfile: vi.fn().mockResolvedValue(undefined),
    getPermissions: vi.fn().mockReturnValue({
      agents: {
        gamemaster: { tools: ['dialogue_service', 'combat_service'] },
        dialogue: { tools: ['dialogue_service'] },
      },
    }),
    ...overrides,
  } as unknown as ConfigLoader;
}

function createMockAgentFactory(overrides?: Partial<YamlAgentFactory>): YamlAgentFactory {
  return {
    listAgents: vi.fn().mockReturnValue([
      { key: 'gamemaster', name: 'GameMaster', tools: ['dialogue_service', 'combat_service'] },
      { key: 'dialogue', name: 'Dialogue Agent', tools: ['dialogue_service'] },
    ]),
    getAgent: vi.fn().mockReturnValue(null),
    reloadProfile: vi.fn().mockResolvedValue(new Map([['gamemaster', {}]])),
    reloadAll: vi.fn().mockResolvedValue(new Map([['fantasy_rpg', new Map()]])),
    ...overrides,
  } as unknown as YamlAgentFactory;
}

// === App 工厂 ===

function createApp(agentFactory: YamlAgentFactory, configLoader: ConfigLoader) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/config', createConfigRouter(agentFactory, configLoader));
  app.use(errorHandler);
  return app;
}

// === 测试套件 ===

describe('Config API e2e', () => {
  let db: Knex;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  // ========================================
  // GET /agent-profiles — 列出所有 Agent 配置
  // ========================================

  describe('GET /agent-profiles', () => {
    it('返回所有 Agent 配置列表', async () => {
      const configLoader = createMockConfigLoader();
      const agentFactory = createMockAgentFactory();
      const app = createApp(agentFactory, configLoader);

      const res = await request(app).get('/api/v1/config/agent-profiles');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].name).toBe('fantasy_rpg');
      expect(res.body.data[0].game_mode).toBe('fantasy_rpg');
    });

    it('DB 无数据时 fallback 到 YAML 配置', async () => {
      const configLoader = createMockConfigLoader({
        getAllProfilesFromDB: vi.fn().mockRejectedValue(new Error('DB error')),
      });
      const agentFactory = createMockAgentFactory();
      const app = createApp(agentFactory, configLoader);

      const res = await request(app).get('/api/v1/config/agent-profiles');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });
  });

  // ========================================
  // GET /tools — 列出所有工具
  // ========================================

  describe('GET /tools', () => {
    it('返回工具列表', async () => {
      const configLoader = createMockConfigLoader();
      const agentFactory = createMockAgentFactory();
      const app = createApp(agentFactory, configLoader);

      const res = await request(app).get('/api/v1/config/tools');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      // ToolRegistry.getInstance() 可能返回空列表（测试环境未注册工具）
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // ========================================
  // GET /permissions — 获取权限配置
  // ========================================

  describe('GET /permissions', () => {
    it('返回权限配置', async () => {
      const configLoader = createMockConfigLoader();
      const agentFactory = createMockAgentFactory();
      const app = createApp(agentFactory, configLoader);

      const res = await request(app).get('/api/v1/config/permissions');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.agents).toBeDefined();
      expect(res.body.data.permissionList).toBeDefined();
      expect(res.body.data.totalAgents).toBe(2);
    });

    it('无 profile 时返回默认消息', async () => {
      const configLoader = createMockConfigLoader({
        getPermissions: vi.fn().mockReturnValue(null),
        getAllProfiles: vi.fn().mockReturnValue([]),
      });
      const agentFactory = createMockAgentFactory();
      const app = createApp(agentFactory, configLoader);

      const res = await request(app).get('/api/v1/config/permissions');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toBeDefined();
    });
  });
});
