/**
 * ToolMethodExtractor 单元测试（§10.3）：从 TS 源码静态提取 registerMethod 结构。
 *
 * 用临时 fixture 文件验证 toolType 取自 super() 第一参（非文件名）、
 * registerMethod 全字段、嵌套 parameters、动态字段降级、多类文件、无 registerMethod 文件。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractToolDocModels, collectToolSourceFiles } from '../tool-method-extractor.js';

let root: string;
let srcDir: string;

function writeSource(relativePath: string, content: string): string {
  const absolute = path.join(srcDir, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, 'utf8');
  return absolute;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'extractor-'));
  srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('extractToolDocModels', () => {
  it('toolType 取自 super() 第一个字符串参数，而非文件名（CombatServiceTool → challenge_service 实证）', () => {
    const file = writeSource(
      'game-systems/combat/CombatServiceTool.ts',
      `import { BaseTool } from '@ai-rpg/shared/tool-core';
export class CombatServiceTool extends BaseTool {
  constructor() {
    super('challenge_service', 'Challenge Service', '挑战服务', '1.0.0');
  }
  private registerMethods(): void {
    this.registerMethod({
      name: 'start_combat',
      description: '开始战斗',
      summary: '开始战斗',
      isWrite: true,
      parameters: { type: 'object', properties: { enemyId: { type: 'string' } } },
    });
  }
}
`,
    );
    const models = extractToolDocModels([file], root);
    expect(models).toHaveLength(1);
    expect(models[0]!.toolType).toBe('challenge_service');
    expect(models[0]!.toolVersion).toBe('1.0.0');
    expect(models[0]!.methods).toHaveLength(1);
    expect(models[0]!.methods[0]!.name).toBe('start_combat');
    expect(models[0]!.methods[0]!.isWrite).toBe(true);
  });

  it('registerMethod 全字段提取（扁平 parameters 形态）', () => {
    const file = writeSource(
      'game-systems/map/MapServiceTool.ts',
      `import { BaseTool } from '@ai-rpg/shared/tool-core';
export class MapServiceTool extends BaseTool {
  constructor() {
    super('map_service', 'Map Service', '地图服务', '2.0.0');
  }
  private registerMethods(): void {
    this.registerMethod({
      name: 'get_location',
      description: '获取地点详情',
      summary: '获取地点',
      isWrite: false,
      parameters: {
        locationId: { type: 'string', required: false, description: '地点ID' },
        locationName: { type: 'string', required: false, description: '地点名称' },
      },
    });
  }
}
`,
    );
    const models = extractToolDocModels([file], root);
    const method = models[0]!.methods[0]!;
    expect(method.parameters).toHaveLength(2);
    expect(method.parameters[0]).toMatchObject({ name: 'locationId', type: 'string', required: false });
    expect(method.parameters[1]).toMatchObject({ name: 'locationName', type: 'string', required: false });
  });

  it('JSON-schema 形态 parameters 提取（memory_service 实证）：required 数组覆盖必填', () => {
    const file = writeSource(
      'agents/memory/agent-memory-service-tool.ts',
      `import { BaseTool } from '@ai-rpg/shared/tool-core';
export class AgentMemoryServiceTool extends BaseTool {
  constructor() {
    super('memory_service', 'Memory Service', '记忆服务', '1.0.0');
  }
  private registerMethods(): void {
    this.registerMethod({
      name: 'save_episodic_memory',
      description: '保存情景记忆',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '事实描述' },
          type: { type: 'string', description: '记忆类型' },
          importance: { type: 'number', description: '重要性1-5' },
        },
        required: ['content', 'type'],
      },
      isWrite: true,
    });
  }
}
`,
    );
    const models = extractToolDocModels([file], root);
    const method = models[0]!.methods[0]!;
    expect(method.parameters).toHaveLength(3);
    const byName = Object.fromEntries(method.parameters.map((p) => [p.name, p]));
    expect(byName['content']!.required).toBe(true);
    expect(byName['type']!.required).toBe(true);
    expect(byName['importance']!.required).toBe(false);
  });

  it('嵌套 parameters 递归提取 items/properties', () => {
    const file = writeSource(
      'game-systems/npc/NPCServiceTool.ts',
      `import { BaseTool } from '@ai-rpg/shared/tool-core';
export class NPCServiceTool extends BaseTool {
  constructor() {
    super('npc_service', 'NPC Service', 'NPC服务', '1.0.0');
  }
  private registerMethods(): void {
    this.registerMethod({
      name: 'batch_op',
      description: '批量操作',
      parameters: {
        updates: {
          type: 'array',
          required: true,
          description: '更新列表',
          items: {
            type: 'object',
            properties: {
              npcId: { type: 'string', description: 'NPC ID' },
              value: { type: 'number', description: '数值' },
            },
          },
        },
      },
    });
  }
}
`,
    );
    const models = extractToolDocModels([file], root);
    const updates = models[0]!.methods[0]!.parameters[0]!;
    expect(updates.type).toBe('array');
    expect(updates.item).toBeDefined();
    expect(updates.item!.type).toBe('object');
    expect(updates.item!.children).toHaveLength(2);
    expect(updates.item!.children![0]).toMatchObject({ name: 'npcId', type: 'string' });
  });

  it('动态 description 记入 dynamicWarnings，字段为 undefined', () => {
    const file = writeSource(
      'agents/tools/coordinator-service.ts',
      `import { BaseTool } from '@ai-rpg/shared/tool-core';
const desc = buildDesc();
export class CoordinatorServiceTool extends BaseTool {
  constructor() {
    super('coordinator_service', 'Coordinator', '协调器', '1.0.0');
  }
  private registerMethods(): void {
    this.registerMethod({
      name: 'spawn_agent',
      description: desc,
      isWrite: true,
    });
  }
}
`,
    );
    const models = extractToolDocModels([file], root);
    const method = models[0]!.methods[0]!;
    expect(method.description).toBeUndefined();
    expect(models[0]!.dynamicWarnings.some((w) => w.includes('description'))).toBe(true);
  });

  it('returns.properties.data.description 的 (TypeName) 提取为 returnTypeName', () => {
    const file = writeSource(
      'game-systems/map/MapServiceTool.ts',
      `import { BaseTool } from '@ai-rpg/shared/tool-core';
export class MapServiceTool extends BaseTool {
  constructor() {
    super('map_service', 'Map', '地图', '1.0.0');
  }
  private registerMethods(): void {
    this.registerMethod({
      name: 'get_location',
      description: '获取地点',
      returns: {
        type: 'object',
        properties: {
          data: { type: 'object', description: '地点数据 (LocationData)' },
        },
      },
    });
  }
}
`,
    );
    const models = extractToolDocModels([file], root);
    expect(models[0]!.methods[0]!.returnTypeName).toBe('LocationData');
  });

  it('一个文件多个 BaseTool 子类 → 逐个提取', () => {
    const file = writeSource(
      'agents/tools/multi.ts',
      `import { BaseTool } from '@ai-rpg/shared/tool-core';
export class ToolA extends BaseTool {
  constructor() { super('service_a', 'A', 'a', '1.0.0'); }
  private m(): void { this.registerMethod({ name: 'a1', description: 'a1' }); }
}
export class ToolB extends BaseTool {
  constructor() { super('service_b', 'B', 'b', '1.0.0'); }
  private m(): void { this.registerMethod({ name: 'b1', description: 'b1' }); }
}
`,
    );
    const models = extractToolDocModels([file], root);
    expect(models.map((m) => m.toolType).sort()).toEqual(['service_a', 'service_b']);
  });

  it('无 registerMethod 的工具 → methods=[] 正常返回', () => {
    const file = writeSource(
      'agents/tools/empty.ts',
      `import { BaseTool } from '@ai-rpg/shared/tool-core';
export class EmptyTool extends BaseTool {
  constructor() { super('empty_service', 'Empty', 'empty', '1.0.0'); }
}
`,
    );
    const models = extractToolDocModels([file], root);
    expect(models).toHaveLength(1);
    expect(models[0]!.methods).toEqual([]);
  });

  it('非 BaseTool 子类不提取', () => {
    const file = writeSource(
      'services/plain.ts',
      `export class PlainService {
  doWork(): void {}
}
`,
    );
    const models = extractToolDocModels([file], root);
    expect(models).toEqual([]);
  });
});

describe('collectToolSourceFiles', () => {
  it('收集 .ts 排除 .test.ts/.d.ts/__tests__', () => {
    writeSource('game-systems/map/MapServiceTool.ts', 'export const a = 1;');
    writeSource('game-systems/map/__tests__/map.test.ts', 'export const b = 1;');
    writeSource('game-systems/map/types.d.ts', 'export declare const c: number;');
    writeSource('services/plain.ts', 'export const d = 1;');

    const files = collectToolSourceFiles(srcDir).map((f) => path.basename(f));
    expect(files).toContain('MapServiceTool.ts');
    expect(files).toContain('plain.ts');
    expect(files).not.toContain('map.test.ts');
    expect(files).not.toContain('types.d.ts');
  });
});
