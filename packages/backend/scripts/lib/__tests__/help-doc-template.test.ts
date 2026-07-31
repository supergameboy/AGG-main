/**
 * HelpDocTemplate 单元测试（§10.3）：ToolDocModel → markdown 文本。
 *
 * 验证 frontmatter 机器字段重生成、description/summary 双引号包裹、
 * paramTypes 签名级摘要、since major.minor 提取、新文档骨架、合并渲染正文保留。
 */

import { describe, it, expect } from 'vitest';
import {
  renderFrontmatter,
  renderNewDocument,
  renderMergedDocument,
  summarizeParamType,
  formatParamTypeValue,
  majorMinor,
  escapeYamlDoubleQuoted,
} from '../help-doc-template.js';
import type { MethodDoc, ParamDoc, ToolDocModel } from '../tool-method-extractor.js';

function makeTool(overrides?: Partial<ToolDocModel>): ToolDocModel {
  return {
    toolType: 'map_service',
    toolVersion: '2.0.0',
    sourceFile: 'src/x.ts',
    methods: [],
    dynamicWarnings: [],
    ...overrides,
  };
}

function makeMethod(overrides?: Partial<MethodDoc>): MethodDoc {
  return {
    name: 'get_location',
    description: '获取地点详情(含层级: 子地点)',
    summary: '获取地点',
    isWrite: false,
    parameters: [],
    returnTypeName: 'LocationData',
    ...overrides,
  };
}

describe('escapeYamlDoubleQuoted', () => {
  it('转义引号、反斜杠、换行', () => {
    expect(escapeYamlDoubleQuoted('say "hi"\npath\\to')).toBe('"say \\"hi\\"\\npath\\\\to"');
  });
});

describe('majorMinor', () => {
  it('2.0.0 → 2.0；1.0 → 1.0；无法解析原样', () => {
    expect(majorMinor('2.0.0')).toBe('2.0');
    expect(majorMinor('1.0')).toBe('1.0');
    expect(majorMinor('abc')).toBe('abc');
  });
});

describe('summarizeParamType', () => {
  it('array<object{...}> 一层摘要', () => {
    const param: ParamDoc = {
      name: 'updates',
      type: 'array',
      required: true,
      item: {
        name: '',
        type: 'object',
        required: false,
        children: [
          { name: 'npcId', type: 'string', required: true },
          { name: 'value', type: 'number', required: false },
        ],
      },
    };
    expect(summarizeParamType(param)).toBe('array<object{npcId:string,value:number}>');
  });

  it('object{...} 一层摘要', () => {
    const param: ParamDoc = {
      name: 'opts',
      type: 'object',
      required: false,
      children: [{ name: 'x', type: 'number', required: false }],
    };
    expect(summarizeParamType(param)).toBe('object{x:number}');
  });

  it('无嵌套返回原类型', () => {
    expect(summarizeParamType({ name: 'id', type: 'string', required: false })).toBe('string');
  });
});

describe('formatParamTypeValue', () => {
  it('required + description', () => {
    const param: ParamDoc = { name: 'id', type: 'string', required: true, description: '地点ID' };
    expect(formatParamTypeValue(param)).toBe('string (required) - 地点ID');
  });
  it('optional 无 description', () => {
    const param: ParamDoc = { name: 'id', type: 'string', required: false };
    expect(formatParamTypeValue(param)).toBe('string (optional)');
  });
});

describe('renderFrontmatter', () => {
  it('机器字段全量生成，description/summary 双引号包裹', () => {
    const tool = makeTool();
    const method = makeMethod({
      parameters: [
        { name: 'locationId', type: 'string', required: false, description: '地点ID' },
      ],
    });
    const output = renderFrontmatter(tool, method, { unknownFields: [] });
    expect(output).toContain('tool: map_service');
    expect(output).toContain('method: get_location');
    expect(output).toContain('description: "获取地点详情(含层级: 子地点)"');
    expect(output).toContain('summary: "获取地点"');
    expect(output).toContain('paramTypes:\n  locationId: "string (optional) - 地点ID"');
    expect(output).toContain('returnType: "LocationData"');
    expect(output).toContain('since: "2.0"');
    expect(output.startsWith('---\n')).toBe(true);
    expect(output.endsWith('\n---')).toBe(true);
  });

  it('手工字段 whenToUse/returnsSummary 附加在机器字段之后', () => {
    const output = renderFrontmatter(makeTool(), makeMethod(), {
      whenToUse: ['场景一', '场景二'],
      returnsSummary: '返回地点数据',
      unknownFields: [['customField', '自定义值']],
    });
    const whenIdx = output.indexOf('whenToUse:');
    const sinceIdx = output.indexOf('since:');
    expect(whenIdx).toBeGreaterThan(sinceIdx);
    expect(output).toContain('whenToUse:\n  - 场景一\n  - 场景二');
    expect(output).toContain('returnsSummary: 返回地点数据');
    expect(output).toContain('customField: 自定义值');
  });

  it('无参数方法省略 paramTypes', () => {
    const output = renderFrontmatter(makeTool(), makeMethod({ parameters: [] }), { unknownFields: [] });
    expect(output).not.toContain('paramTypes:');
  });

  it('代码 description 缺失时回退 preserved.description', () => {
    const output = renderFrontmatter(makeTool(), makeMethod({ description: undefined }), {
      description: '保留的描述',
      unknownFields: [],
    });
    expect(output).toContain('description: "保留的描述"');
  });
});

describe('renderNewDocument', () => {
  it('生成 frontmatter + 正文骨架，含手工维护提示', () => {
    const output = renderNewDocument(makeTool(), makeMethod({
      parameters: [{ name: 'id', type: 'string', required: true, description: 'ID' }],
    }));
    expect(output).toContain('# map_service.get_location');
    expect(output).toContain('@manual: 本文件 frontmatter 由 generate-agent-help 自动维护');
    expect(output).toContain('## 功能');
    expect(output).toContain('## 参数详解');
    expect(output).toContain('| id | string | 是 | ID |');
    expect(output).toContain('## 返回值');
    expect(output).toContain('## 注意事项');
    expect(output.endsWith('\n')).toBe(true);
  });

  it('无参数方法骨架显示（无参数）', () => {
    const output = renderNewDocument(makeTool(), makeMethod({ parameters: [] }));
    expect(output).toContain('（无参数）');
  });
});

describe('renderMergedDocument', () => {
  it('正文字节级保留，frontmatter 重生成', () => {
    const body = '# 标题\n\n正文任意内容，含 <!-- 注释 --> 和 markdown。\n';
    const output = renderMergedDocument(makeTool(), makeMethod(), { unknownFields: [] }, body);
    expect(output).toContain('description: "获取地点详情(含层级: 子地点)"');
    expect(output.endsWith(`${body}`)).toBe(true) || expect(output.endsWith(`${body}\n`)).toBe(true);
  });

  it('body 无结尾换行时补单个换行', () => {
    const output = renderMergedDocument(makeTool(), makeMethod(), { unknownFields: [] }, 'body-no-newline');
    expect(output.endsWith('body-no-newline\n')).toBe(true);
  });

  it('body 已有结尾换行时不重复添加', () => {
    const output = renderMergedDocument(makeTool(), makeMethod(), { unknownFields: [] }, 'body\n');
    expect(output.endsWith('body\n')).toBe(true);
    expect(output.endsWith('body\n\n')).toBe(false);
  });
});
