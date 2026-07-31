import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentConfig } from '@ai-rpg/shared';
import { HelpRegistry } from '../help-registry.js';

describe('HelpRegistry summary metadata', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'help-registry-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('应从 frontmatter 读取 summary / whenToUse / returnsSummary', async () => {
    const serviceDir = join(tempDir, 'map_service');
    await mkdir(serviceDir, { recursive: true });
    await writeFile(
      join(serviceDir, 'move_to.md'),
      [
        '---',
        'tool: map_service',
        'method: move_to',
        'description: 移动到目标地点',
        'summary: 查询并执行地点移动',
        'whenToUse: ["玩家明确表达移动意图时"]',
        'returnsSummary: 返回移动结果与目标地点摘要',
        '---',
        '',
        '# map_service.move_to',
        '完整帮助正文',
      ].join('\n'),
    );

    const registry = new HelpRegistry(tempDir);
    await registry.loadAllHelp();

    expect(registry.getHelpSummary('map_service')).toEqual([
      expect.objectContaining({
        tool: 'map_service',
        method: 'move_to',
        description: '移动到目标地点',
        summary: '查询并执行地点移动',
        whenToUse: ['玩家明确表达移动意图时'],
        returnsSummary: '返回移动结果与目标地点摘要',
      }),
    ]);
  });
});

describe('AgentConfig tool budget', () => {
  it('应支持 toolBudget 配置', () => {
    const config: AgentConfig = {
      name: 'output',
      description: 'output',
      system_prompt_file: './prompts/output.md',
      tools: ['dialogue_service', 'help_service'],
      toolBudget: {
        maxVisibleTools: 6,
        maxVisibleHelpDocs: 4,
        maxToolSummaryTokens: 800,
        maxHelpSummaryTokens: 600,
        maxOnDemandLoadsPerTurn: 2,
      },
    };

    expect(config.toolBudget?.maxOnDemandLoadsPerTurn).toBe(2);
  });
});
