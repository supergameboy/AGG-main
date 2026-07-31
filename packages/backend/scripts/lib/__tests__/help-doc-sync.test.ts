/**
 * HelpDocSync 单元测试（§10.3）：字段级所有权合并 + 漂移报告。
 *
 * 用临时目录作为 helpDir，验证 created/updated/unchanged/orphaned/manualSkipped/
 * 损坏文档 errorCount+1 不覆盖/--prune 删除/生成确定性 等核心契约。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncHelpDocs } from '../help-doc-sync.js';
import type { ToolDocModel } from '../tool-method-extractor.js';

let helpDir: string;

function makeModel(overrides?: Partial<ToolDocModel>): ToolDocModel {
  return {
    toolType: 'map_service',
    toolVersion: '2.0.0',
    sourceFile: 'src/game-systems/map/MapServiceTool.ts',
    methods: [
      {
        name: 'get_location',
        description: '获取地点详情',
        summary: '获取地点',
        isWrite: false,
        parameters: [
          { name: 'locationId', type: 'string', required: false, description: '地点ID' },
        ],
        returnTypeName: 'LocationData',
      },
    ],
    dynamicWarnings: [],
    ...overrides,
  };
}

function writeHelp(relativePath: string, content: string): string {
  const absolute = path.join(helpDir, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, 'utf8');
  return absolute;
}

function readHelp(relativePath: string): string {
  return fs.readFileSync(path.join(helpDir, relativePath), 'utf8');
}

beforeEach(() => {
  helpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'help-sync-'));
});

afterEach(() => {
  fs.rmSync(helpDir, { recursive: true, force: true });
});

describe('syncHelpDocs', () => {
  it('文件不存在 → created，--write 落盘骨架', () => {
    const report = syncHelpDocs([makeModel()], { mode: 'write', helpDir });
    expect(report.created).toEqual(['map_service/get_location.md']);
    expect(report.updated).toEqual([]);
    expect(report.errorCount).toBe(0);
    const written = readHelp('map_service/get_location.md');
    expect(written).toContain('tool: map_service');
    expect(written).toContain('method: get_location');
    expect(written).toContain('# map_service.get_location');
    expect(written).toContain('@manual-frontmatter');
  });

  it('check 模式 created 不落盘', () => {
    const report = syncHelpDocs([makeModel()], { mode: 'check', helpDir });
    expect(report.created).toEqual(['map_service/get_location.md']);
    expect(fs.existsSync(path.join(helpDir, 'map_service/get_location.md'))).toBe(false);
  });

  it('机器字段漂移 → updated，手工字段 whenToUse/returnsSummary 保留', () => {
    const existing = [
      '---',
      'tool: map_service',
      'method: get_location',
      'description: 旧描述',
      'summary: 旧摘要',
      'whenToUse:',
      '  - 场景一',
      '  - 场景二',
      'returnsSummary: 返回地点数据',
      'paramTypes:',
      '  locationId: string (optional) - 旧参数说明',
      'returnType: "LocationData"',
      'since: "1.0"',
      '---',
      '',
      '# map_service.get_location',
      '',
      '正文内容保持不动。',
      '',
    ].join('\n');
    writeHelp('map_service/get_location.md', existing);

    const report = syncHelpDocs([makeModel()], { mode: 'write', helpDir });
    expect(report.updated).toEqual(['map_service/get_location.md']);

    const written = readHelp('map_service/get_location.md');
    expect(written).toContain('description: "获取地点详情"');
    expect(written).toContain('summary: "获取地点"');
    expect(written).toContain('whenToUse:\n  - 场景一\n  - 场景二');
    expect(written).toContain('returnsSummary: 返回地点数据');
    expect(written).toContain('since: "2.0"');
    // 正文字节级保留
    expect(written).toContain('正文内容保持不动。');
  });

  it('未知自定义字段原样保留', () => {
    const existing = [
      '---',
      'tool: map_service',
      'method: get_location',
      'description: 旧描述',
      'customField: 自定义值',
      'anotherUnknown: 42',
      '---',
      '',
      'body',
      '',
    ].join('\n');
    writeHelp('map_service/get_location.md', existing);

    syncHelpDocs([makeModel()], { mode: 'write', helpDir });
    const written = readHelp('map_service/get_location.md');
    expect(written).toContain('customField: 自定义值');
    expect(written).toContain('anotherUnknown: 42');
  });

  it('正文含 @manual-frontmatter → manualSkipped，文件不被修改', () => {
    const existing = [
      '---',
      'tool: map_service',
      'method: get_location',
      'description: 完全手工维护',
      '---',
      '',
      '<!-- @manual-frontmatter -->',
      '手工正文',
      '',
    ].join('\n');
    const absolute = writeHelp('map_service/get_location.md', existing);
    const before = fs.statSync(absolute).mtimeMs;

    const report = syncHelpDocs([makeModel()], { mode: 'write', helpDir });
    expect(report.manualSkipped).toEqual(['map_service/get_location.md']);
    expect(report.updated).toEqual([]);
    expect(report.errorCount).toBe(0);
    expect(fs.statSync(absolute).mtimeMs).toBe(before);
    expect(readHelp('map_service/get_location.md')).toBe(existing);
  });

  it('损坏 frontmatter → errorCount+1，文件不被覆盖', () => {
    const broken = '---\ntool: map_service\n  bad-indent: [unclosed\n---\nbody\n';
    const absolute = writeHelp('map_service/get_location.md', broken);

    const report = syncHelpDocs([makeModel()], { mode: 'write', helpDir });
    expect(report.errorCount).toBe(1);
    expect(report.errors).toHaveLength(1);
    expect(report.updated).toEqual([]);
    expect(readHelp('map_service/get_location.md')).toBe(broken);
    void absolute;
  });

  it('无 frontmatter 的现有文档 → 前置插入生成的 frontmatter，正文保留', () => {
    writeHelp('map_service/get_location.md', '# 纯手工文档\n\n没有 frontmatter。\n');

    const report = syncHelpDocs([makeModel()], { mode: 'write', helpDir });
    expect(report.updated).toEqual(['map_service/get_location.md']);
    const written = readHelp('map_service/get_location.md');
    expect(written.startsWith('---\ntool: map_service')).toBe(true);
    expect(written).toContain('# 纯手工文档\n\n没有 frontmatter。');
  });

  it('文档存在但代码无对应方法 → orphaned；--write 保留；--write --prune 删除', () => {
    writeHelp('map_service/stale_method.md', '---\ntool: map_service\nmethod: stale_method\n---\n旧文档\n');

    const reportWrite = syncHelpDocs([makeModel()], { mode: 'write', helpDir });
    expect(reportWrite.orphaned).toEqual(['map_service/stale_method.md']);
    expect(reportWrite.errorCount).toBe(1);
    expect(fs.existsSync(path.join(helpDir, 'map_service/stale_method.md'))).toBe(true);

    const reportPrune = syncHelpDocs([makeModel()], { mode: 'write', helpDir, prune: true });
    expect(reportPrune.orphaned).toEqual(['map_service/stale_method.md']);
    expect(fs.existsSync(path.join(helpDir, 'map_service/stale_method.md'))).toBe(false);
  });

  it('serviceFilter 仅处理指定 service，其它目录不动', () => {
    writeHelp('npc_service/get_npc.md', '---\ntool: npc_service\nmethod: get_npc\n---\n正文\n');
    const report = syncHelpDocs([makeModel()], {
      mode: 'write',
      helpDir,
      serviceFilter: 'map_service',
    });
    // npc_service 文档存在但 serviceFilter 限定 map_service → 不计入 orphaned
    expect(report.orphaned).toEqual([]);
    expect(fs.existsSync(path.join(helpDir, 'npc_service/get_npc.md'))).toBe(true);
  });

  it('生成确定性：同输入两次输出一致，第二次 unchanged', () => {
    const model = makeModel();
    const first = syncHelpDocs([model], { mode: 'write', helpDir });
    expect(first.created).toEqual(['map_service/get_location.md']);

    const second = syncHelpDocs([model], { mode: 'write', helpDir });
    expect(second.created).toEqual([]);
    expect(second.updated).toEqual([]);
    expect(second.unchanged).toEqual(['map_service/get_location.md']);
  });

  it('代码 summary 缺失时保留现有文档 summary（§9.5 降级）', () => {
    const modelNoSummary = makeModel({
      methods: [
        {
          name: 'get_location',
          description: '获取地点详情',
          isWrite: false,
          parameters: [],
        },
      ],
    });
    const existing = [
      '---',
      'tool: map_service',
      'method: get_location',
      'description: 旧描述',
      'summary: 手工策展的摘要',
      '---',
      '',
      'body',
      '',
    ].join('\n');
    writeHelp('map_service/get_location.md', existing);

    syncHelpDocs([modelNoSummary], { mode: 'write', helpDir });
    const written = readHelp('map_service/get_location.md');
    expect(written).toContain('summary: "手工策展的摘要"');
  });

  it('dynamicWarnings 透传到报告', () => {
    const model = makeModel({
      dynamicWarnings: ['src/x.ts: 非静态字段 x'],
    });
    const report = syncHelpDocs([model], { mode: 'check', helpDir });
    expect(report.dynamicWarnings).toEqual([
      { file: model.sourceFile, warning: 'src/x.ts: 非静态字段 x' },
    ]);
  });
});
