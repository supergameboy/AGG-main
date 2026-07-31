import { describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@ai-rpg/shared/types/tool';
import { SkillLoaderTool } from '../skill-service.js';
import { RequestScope } from '../../../services/RequestScope.js';
import type { Knex } from 'knex';

function createToolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    saveId: 'save-1' as ToolContext['saveId'],
    agentType: 'gamemaster',
    timestamp: Date.now() as ToolContext['timestamp'],
    requestScope: new RequestScope({} as unknown as Knex),
    ...overrides,
  };
}

function createTool(): SkillLoaderTool {
  const tool = new SkillLoaderTool();
  tool.setPermission({
    toolType: 'skill_loader',
    agentType: 'gamemaster',
    readAllowed: true,
    writeAllowed: false,
  });
  return tool;
}

describe('SkillLoaderTool', () => {
  it('load_skill 不应复用上一请求的缓存结果，而应基于当前请求上下文重新构建帮助内容', async () => {
    const tool = createTool();
    tool.setSkillRegistry({
      loadSkillContent: vi.fn().mockResolvedValue('技能正文'),
      getSkillByName: vi.fn().mockReturnValue({
        version: '1.0',
        recommendedTools: ['map_service.move_to'],
      }),
    } as never);
    tool.setHelpRegistry({
      getHelp: vi.fn().mockResolvedValue('移动帮助正文'),
      formatHelpForPrompt: vi
        .fn()
        .mockImplementation((content: string, toolType: string, method: string) =>
          `<tool_help tool="${toolType}" method="${method}">${content}</tool_help>`,
        ),
      getHelpSummary: vi.fn().mockReturnValue([]),
    } as never);

    const firstResult = await tool.execute(
      'load_skill',
      { skillName: 'location-pool-init' },
      createToolContext({
        agentTools: ['map_service'],
        injectedMethods: [],
      }),
    );
    const secondResult = await tool.execute(
      'load_skill',
      { skillName: 'location-pool-init' },
      createToolContext({
        agentTools: [],
        injectedMethods: [],
      }),
    );

    expect(firstResult).toEqual({
      success: true,
      data: {
        content: [
          '<skill name="location-pool-init" version="1.0">',
          '技能正文',
          '</skill>',
          '',
          '【推荐工具帮助文档】以下是你在此技能中需要使用的工具的详细帮助：',
          '',
          '<tool_help tool="map_service" method="move_to">移动帮助正文</tool_help>',
        ].join('\n'),
      },
    });
    expect(secondResult).toEqual({
      success: true,
      data: {
        content: '<skill name="location-pool-init" version="1.0">\n技能正文\n</skill>',
      },
    });
  });
});
