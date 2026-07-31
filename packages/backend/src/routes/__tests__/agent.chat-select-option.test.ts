import express from 'express';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameRoutes } from '../game.js';
import { errorHandler } from '../../middlewares/errorhandler.js';

describe('Game routes select_option', () => {
  let db: Knex;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await db.schema.createTable('saves', (table) => {
      table.text('id').primary();
    });

    await db.schema.createTable('dialogues', (table) => {
      table.text('id').primary();
      table.text('save_id').notNullable();
      table.text('npc_id').nullable();
      table.text('speaker').notNullable();
      table.text('content').notNullable();
      table.text('emotion').notNullable();
      table.text('message_type').notNullable();
      table.bigInteger('timestamp').notNullable();
    });

    await db.schema.createTable('npcs', (table) => {
      table.text('id').primary();
      table.text('save_id').notNullable();
      table.text('template_npc_id').nullable();
      table.text('dialogue_history').nullable();
      table.bigInteger('updated_at').nullable();
    });

    await db('saves').insert({ id: 'save-1' });
    await db('npcs').insert({ id: 'npc-village-chief', save_id: 'save-1' });

    await db.schema.createTable('characters', (table) => {
      table.text('id').primary();
      table.text('save_id').notNullable();
      table.text('name').notNullable();
    });
    await db('characters').insert({ id: 'char-1', save_id: 'save-1', name: 'TestPlayer' });
  });

  afterEach(async () => {
    await db.destroy();
  });

  function createApp(processMessage: ReturnType<typeof vi.fn>) {
    const stagingPool = {
      flush: vi.fn().mockResolvedValue(undefined),
      writes: [],
      stage: vi.fn().mockResolvedValue(undefined),
    };
    const mockAgent = {
      processMessage,
      createRequestScopedCopy: vi.fn().mockReturnThis(),
      createRequestRuntime: vi.fn().mockResolvedValue({
        stagingPool,
        shadowState: {},
      }),
      applyRequestScope: vi.fn(),
      flushRequestRuntime: vi.fn().mockResolvedValue(undefined),
      getRuntimeSnapshot: vi.fn().mockReturnValue(null),
    };
    // P0-2: 提供 gameServiceDeps 最小 mock，覆盖 processChat 路径所需端口
    // - saveService.getSave: 返回 save 记录（验证 save 存在）
    // - characterService.getCharacter: 返回角色（获取 playerSpeaker）
    // - modeRouter.routeMode: 返回非战斗模式（select_option 走 Agent 路径）
    // - 其他端口：select_option 不触发 init/rollback/use_skill，无需实现
    const gameServiceDeps = {
      saveService: { getSave: vi.fn().mockResolvedValue({ id: 'save-1' }) },
      characterService: { getCharacter: vi.fn().mockResolvedValue({ id: 'char-1', name: 'TestPlayer' }) },
      modeRouter: { routeMode: vi.fn().mockResolvedValue({ candidateAgentTypes: ['gamemaster'], challengeMode: null }) },
    } as never;
    const app = express();
    app.use(express.json());
    app.use(
      '/api/v1/game',
      createGameRoutes(
        mockAgent as any,
        db,
        gameServiceDeps,
      )
    );
    app.use(errorHandler);
    return app;
  }

  it('POST /chat 在 select_option 时应提升 optionId 为结构化 playerAction.selectedOptionId', async () => {
    const processMessage = vi.fn().mockResolvedValue({
      success: true,
      data: { ok: true },
      messages: [],
    });

    const response = await request(createApp(processMessage))
      .post('/api/v1/game/chat')
      .send({
        message: '请求村长的帮助或建议',
        saveId: 'save-1',
        action: 'select_option',
        data: {
          optionId: 'option-help',
          optionText: '请求村长的帮助或建议',
        },
        playerAction: {
          type: 'select_option',
          targetNpcId: 'npc-village-chief',
        },
        targetNpcIds: ['npc-village-chief'],
      });

    expect(response.status).toBe(200);
    expect(processMessage).toHaveBeenCalledTimes(1);
    expect(processMessage.mock.calls[0][0].payload.data).toEqual(
      expect.objectContaining({
        optionId: 'option-help',
        optionText: '请求村长的帮助或建议',
        playerAction: expect.objectContaining({
          type: 'select_option',
          selectedOptionId: 'option-help',
          targetNpcId: 'npc-village-chief',
        }),
      })
    );
  });

  it('POST /chat 在 select_option 且只提供顶层 npcId 时应回填结构化 targetNpcId', async () => {
    const processMessage = vi.fn().mockResolvedValue({
      success: true,
      data: { ok: true },
      messages: [],
    });

    const response = await request(createApp(processMessage))
      .post('/api/v1/game/chat')
      .send({
        message: '请求村长的帮助或建议',
        saveId: 'save-1',
        action: 'select_option',
        npcId: 'npc-village-chief',
        data: {
          optionId: 'option-help',
          optionText: '请求村长的帮助或建议',
        },
      });

    expect(response.status).toBe(200);
    expect(processMessage.mock.calls[0][0].payload.data.playerAction).toEqual(
      expect.objectContaining({
        type: 'select_option',
        selectedOptionId: 'option-help',
        targetNpcId: 'npc-village-chief',
      })
    );
  });

  it('POST /chat 在 select_option 缺少目标 NPC 时应返回 400', async () => {
    const processMessage = vi.fn().mockResolvedValue({
      success: true,
      data: { ok: true },
      messages: [],
    });

    const response = await request(createApp(processMessage))
      .post('/api/v1/game/chat')
      .send({
        message: '请求帮助',
        saveId: 'save-1',
        action: 'select_option',
        data: {
          optionId: 'option-help',
          optionText: '请求帮助',
        },
        targetNpcIds: ['N/A'],
      });

    expect(response.status).toBe(400);
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('POST /chat 在 select_option 缺少 selectedOptionId 时应返回 400', async () => {
    const processMessage = vi.fn().mockResolvedValue({
      success: true,
      data: { ok: true },
      messages: [],
    });

    const response = await request(createApp(processMessage))
      .post('/api/v1/game/chat')
      .send({
        message: '请求帮助',
        saveId: 'save-1',
        action: 'select_option',
        playerAction: {
          type: 'select_option',
          targetNpcId: 'npc-village-chief',
        },
      });

    expect(response.status).toBe(400);
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('POST /chat 在 select_option 的 selectedOptionId 为空白字符串时应返回 400', async () => {
    const processMessage = vi.fn().mockResolvedValue({
      success: true,
      data: { ok: true },
      messages: [],
    });

    const response = await request(createApp(processMessage))
      .post('/api/v1/game/chat')
      .send({
        message: '请求帮助',
        saveId: 'save-1',
        action: 'select_option',
        npcId: 'npc-village-chief',
        data: {
          optionId: '   ',
          optionText: '请求帮助',
        },
      });

    expect(response.status).toBe(400);
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('POST /chat 在 select_option 时应强制归一 playerAction.type 为 select_option', async () => {
    const processMessage = vi.fn().mockResolvedValue({
      success: true,
      data: { ok: true },
      messages: [],
    });

    const response = await request(createApp(processMessage))
      .post('/api/v1/game/chat')
      .send({
        message: '请求帮助',
        saveId: 'save-1',
        action: 'select_option',
        data: {
          optionId: 'option-help',
          optionText: '请求帮助',
        },
        playerAction: {
          type: 'use_item',
          targetNpcId: 'npc-village-chief',
        },
      });

    expect(response.status).toBe(200);
    expect(processMessage.mock.calls[0][0].payload.data.playerAction).toEqual(
      expect.objectContaining({
        type: 'select_option',
        selectedOptionId: 'option-help',
        targetNpcId: 'npc-village-chief',
      })
    );
  });
});
