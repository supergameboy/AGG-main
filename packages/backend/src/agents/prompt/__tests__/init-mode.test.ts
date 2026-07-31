import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { PromptModule } from '../index.js';
import type { PromptContext } from '../types.js';
import type { ToolRegistryPort } from '../tool-set.js';
import { RulesEngine } from '../../../services/rules-engine.js';
import { SkillRegistry } from '../../../services/skill-registry.js';

let rulesEngine: RulesEngine;
let skillRegistry: SkillRegistry;

beforeAll(async () => {
  rulesEngine = new RulesEngine(resolve('config', 'agent-rules'));
  skillRegistry = new SkillRegistry(resolve('config', 'agent-skills'));
  await rulesEngine.loadAllRules();
  await skillRegistry.loadAllSkills();
});

// ============================================================
// RulesLayer 规则注入测试（替代原 ModeRulesLayer 测试）
// ============================================================

describe('RulesLayer rule injection (intentHint-based)', () => {
  let promptModule: PromptModule;
  const mockToolRegistry: ToolRegistryPort = {
    getAvailableTools: vi.fn().mockReturnValue([]),
    getPermission: vi.fn().mockReturnValue({ readAllowed: true, writeAllowed: false }),
  };

  const promptsDir = 'config/agent-profiles/prompts';

  beforeEach(() => {
    promptModule = new PromptModule({ toolRegistry: mockToolRegistry, promptsDir, rulesEngine, skillRegistry });
  });

  it('alwaysApply 规则对所有 Agent 生效', async () => {
    const ctx: PromptContext = {
      agentKey: 'inventory',
      agentConfig: { tools: [] },
      excludedMethods: [],
      language: 'zh-CN',
      message: { payload: { action: 'chat', intentHint: 'chat', data: {} } },
      templateContext: null,
      domain: {},
      options: {},
    };

    const result = await promptModule.build(ctx);
    expect(result.systemPrompt).toBeDefined();
    // core-safety 和 id-format 是 alwaysApply 规则，对所有 Agent 生效
    expect(result.systemPrompt).toContain('core-safety');
    expect(result.systemPrompt).toContain('id-format');
  });

  it('hooked 规则在 intentHint 匹配时注入', async () => {
    const ctx: PromptContext = {
      agentKey: 'gamemaster',
      agentConfig: { tools: [] },
      excludedMethods: [],
      language: 'zh-CN',
      message: { payload: { action: 'initialize', intentHint: 'initialize', data: {} } },
      templateContext: null,
      domain: {},
      options: {},
    };

    const result = await promptModule.build(ctx);
    expect(result.systemPrompt).toBeDefined();
    // init-convergence 是 hooked 规则，hook: initialize
    expect(result.systemPrompt).toContain('init-convergence');
  });

  it('hooked 规则在 intentHint 不匹配时不注入', async () => {
    const ctx: PromptContext = {
      agentKey: 'gamemaster',
      agentConfig: { tools: [] },
      excludedMethods: [],
      language: 'zh-CN',
      message: { payload: { action: 'chat', intentHint: 'chat', data: {} } },
      templateContext: null,
      domain: {},
      options: {},
    };

    const result = await promptModule.build(ctx);
    expect(result.systemPrompt).toBeDefined();
    // chat intentHint 不匹配 init-convergence 的 hook
    expect(result.systemPrompt).not.toContain('init-convergence');
  });

  it('gamemaster 专属 alwaysApply 规则只对 gamemaster 生效', async () => {
    const gmCtx: PromptContext = {
      agentKey: 'gamemaster',
      agentConfig: { tools: [] },
      excludedMethods: [],
      language: 'zh-CN',
      message: { payload: { action: 'chat', intentHint: 'chat', data: {} } },
      templateContext: null,
      domain: {},
      options: {},
    };

    const inventoryCtx: PromptContext = {
      ...gmCtx,
      agentKey: 'inventory',
    };

    const gmResult = await promptModule.build(gmCtx);
    const inventoryResult = await promptModule.build(inventoryCtx);

    // injection-defense 是 gamemaster 专属规则
    expect(gmResult.systemPrompt).toContain('injection-defense');
    expect(inventoryResult.systemPrompt).not.toContain('injection-defense');
  });

  it('多个 Agent 的 alwaysApply 规则均可加载', async () => {
    const agentKeys = ['challenge', 'event', 'inventory', 'npc_party', 'quest', 'skill', 'time'];

    for (const agentKey of agentKeys) {
      const ctx: PromptContext = {
        agentKey,
        agentConfig: { tools: [] },
        excludedMethods: [],
        language: 'zh-CN',
        message: { payload: { action: 'chat', intentHint: 'chat', data: {} } },
        templateContext: null,
        domain: {},
        options: {},
      };

      const result = await promptModule.build(ctx);
      expect(result.systemPrompt).toBeDefined();
      // 所有 Agent 都应有 core-safety 规则
      expect(result.systemPrompt).toContain('core-safety');
    }
  });

  it('initialize 和 chat 的规则注入不同', async () => {
    const initCtx: PromptContext = {
      agentKey: 'gamemaster',
      agentConfig: { tools: [] },
      excludedMethods: [],
      language: 'zh-CN',
      message: { payload: { action: 'initialize', intentHint: 'initialize', data: {} } },
      templateContext: null,
      domain: {},
      options: {},
    };

    const chatCtx: PromptContext = {
      ...initCtx,
      message: { payload: { action: 'chat', intentHint: 'chat', data: {} } },
    };

    const initResult = await promptModule.build(initCtx);
    const chatResult = await promptModule.build(chatCtx);

    // initialize 有 init-convergence hooked 规则
    expect(initResult.systemPrompt).toContain('init-convergence');
    expect(chatResult.systemPrompt).not.toContain('init-convergence');
    // 两者都有 alwaysApply 规则
    expect(initResult.systemPrompt).toContain('core-safety');
    expect(chatResult.systemPrompt).toContain('core-safety');
  });

  it('当无 intentHint 时只注入 alwaysApply 规则', async () => {
    const ctx: PromptContext = {
      agentKey: 'inventory',
      agentConfig: { tools: [] },
      excludedMethods: [],
      language: 'zh-CN',
      message: { payload: {} },
      templateContext: null,
      domain: {},
      options: {},
    };

    const result = await promptModule.build(ctx);
    expect(result.systemPrompt).toBeDefined();
    expect(result.systemPrompt).toContain('core-safety');
  });

  it('action=ui_interaction + intentHint=initialize 时触发 init-convergence', async () => {
    const ctx: PromptContext = {
      agentKey: 'gamemaster',
      agentConfig: { tools: [] },
      excludedMethods: [],
      language: 'zh-CN',
      message: { payload: { action: 'ui_interaction', intentHint: 'initialize', data: {} } },
      templateContext: null,
      domain: {},
      options: {},
    };

    const result = await promptModule.build(ctx);
    expect(result.systemPrompt).toContain('init-convergence');
  });
});

// ============================================================
// intentHint 与 action 分离测试
// ============================================================

describe('intentHint and action separation', () => {
  it('intentHint=initialize 优先于 action 判断初始化模式', async () => {
    const promptModule = new PromptModule({
      toolRegistry: {
        getAvailableTools: vi.fn().mockReturnValue([]),
        getPermission: vi.fn().mockReturnValue({ readAllowed: true, writeAllowed: false }),
      },
      promptsDir: 'config/agent-profiles/prompts',
      rulesEngine,
      skillRegistry,
    });

    // action 不是 initialize，但 intentHint 是 initialize
    const ctx: PromptContext = {
      agentKey: 'gamemaster',
      agentConfig: { tools: [] },
      excludedMethods: [],
      language: 'zh-CN',
      message: { payload: { action: 'init_game', intentHint: 'initialize', data: {} } },
      templateContext: null,
      domain: {},
      options: {},
    };

    const result = await promptModule.build(ctx);
    expect(result.systemPrompt).toContain('init-convergence');
  });

  it('intentHint=dialogue 时注入 dialogue-rules hooked 规则', async () => {
    const promptModule = new PromptModule({
      toolRegistry: {
        getAvailableTools: vi.fn().mockReturnValue([]),
        getPermission: vi.fn().mockReturnValue({ readAllowed: true, writeAllowed: false }),
      },
      promptsDir: 'config/agent-profiles/prompts',
      rulesEngine,
      skillRegistry,
    });

    const ctx: PromptContext = {
      agentKey: 'gamemaster',
      agentConfig: { tools: [] },
      excludedMethods: [],
      language: 'zh-CN',
      message: { payload: { action: 'select_option', intentHint: 'dialogue', data: {} } },
      templateContext: null,
      domain: {},
      options: {},
    };

    const result = await promptModule.build(ctx);
    expect(result.systemPrompt).toContain('dialogue-rules');
  });
});