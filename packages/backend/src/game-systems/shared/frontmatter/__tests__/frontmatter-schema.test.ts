import { describe, it, expect } from 'vitest';
import {
  skillFrontmatterSchema,
  ruleFrontmatterSchema,
  helpFrontmatterSchema,
  FrontmatterValidationError,
  parseAndValidate,
  validateAttributes,
} from '../frontmatter-schema.js';

function wrap(frontmatter: string, body = '# Body'): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

describe('skillFrontmatterSchema', () => {
  const validSkill = [
    'name: test-skill',
    'description: A test skill',
    'targetAgent: ["gamemaster"]',
    'whenToUse: When testing',
    'completionCriteria: Test passes',
  ].join('\n');

  it('accepts fully valid frontmatter', () => {
    const doc = parseAndValidate(wrap(validSkill), skillFrontmatterSchema);
    expect(doc.attributes.name).toBe('test-skill');
    expect(doc.attributes.targetAgent).toEqual(['gamemaster']);
    expect(doc.body).toBe('# Body');
  });

  it.each([
    ['name', 'description: d\ntargetAgent: ["*"]\nwhenToUse: w\ncompletionCriteria: c'],
    ['description', 'name: n\ntargetAgent: ["*"]\nwhenToUse: w\ncompletionCriteria: c'],
    ['targetAgent', 'name: n\ndescription: d\nwhenToUse: w\ncompletionCriteria: c'],
    ['whenToUse', 'name: n\ndescription: d\ntargetAgent: ["*"]\ncompletionCriteria: c'],
    ['completionCriteria', 'name: n\ndescription: d\ntargetAgent: ["*"]\nwhenToUse: w'],
  ])('rejects missing required field %s', (field, frontmatter) => {
    try {
      parseAndValidate(wrap(frontmatter), skillFrontmatterSchema, { filePath: 's.md' });
      expect.unreachable();
    } catch (error) {
      const e = error as FrontmatterValidationError;
      expect(e.code).toBe('SCHEMA_VALIDATION_FAILED');
      expect(e.issues.some((issue) => issue.path === field)).toBe(true);
    }
  });

  it('fills defaults for trigger/version/enabled/recommendedTools/relatedRules', () => {
    const doc = parseAndValidate(wrap(validSkill), skillFrontmatterSchema);
    expect(doc.attributes.trigger).toEqual([]);
    expect(doc.attributes.version).toBe('1.0');
    expect(doc.attributes.enabled).toBe(true);
    expect(doc.attributes.recommendedTools).toEqual([]);
    expect(doc.attributes.relatedRules).toEqual([]);
  });

  it('keeps unknown fields (passthrough)', () => {
    const doc = parseAndValidate(wrap(`${validSkill}\ncustomField: custom-value`), skillFrontmatterSchema);
    expect(doc.attributes.customField).toBe('custom-value');
  });
});

describe('ruleFrontmatterSchema', () => {
  const validRule = [
    'name: test-rule',
    'alwaysApply: true',
    'targetAgent: ["*"]',
    'description: A test rule',
  ].join('\n');

  it('accepts fully valid frontmatter', () => {
    const doc = parseAndValidate(wrap(validRule), ruleFrontmatterSchema);
    expect(doc.attributes.name).toBe('test-rule');
    expect(doc.attributes.alwaysApply).toBe(true);
  });

  it('normalizes hook string to array', () => {
    const doc = parseAndValidate(wrap(`${validRule}\nhook: initialize`), ruleFrontmatterSchema);
    expect(doc.attributes.hook).toEqual(['initialize']);
  });

  it('normalizes hook: null to empty array (defect fix)', () => {
    const doc = parseAndValidate(wrap(`${validRule}\nhook: null`), ruleFrontmatterSchema);
    expect(doc.attributes.hook).toEqual([]);
  });

  it('keeps hook array as-is', () => {
    const doc = parseAndValidate(wrap(`${validRule}\nhook: [a, b]`), ruleFrontmatterSchema);
    expect(doc.attributes.hook).toEqual(['a', 'b']);
  });

  it('rejects non-boolean alwaysApply', () => {
    try {
      parseAndValidate(wrap('name: n\nalwaysApply: yes-string\ntargetAgent: ["*"]\ndescription: d'), ruleFrontmatterSchema);
      expect.unreachable();
    } catch (error) {
      const e = error as FrontmatterValidationError;
      expect(e.issues.some((issue) => issue.path === 'alwaysApply')).toBe(true);
    }
  });

  it('fills defaults for priority/enabled/hook', () => {
    const doc = parseAndValidate(wrap(validRule), ruleFrontmatterSchema);
    expect(doc.attributes.priority).toBe(0);
    expect(doc.attributes.enabled).toBe(true);
    expect(doc.attributes.hook).toEqual([]);
  });
});

describe('helpFrontmatterSchema', () => {
  const validHelp = [
    'tool: map_service',
    'method: move_to',
    'description: 移动到目标地点',
  ].join('\n');

  it('accepts fully valid frontmatter', () => {
    const doc = parseAndValidate(wrap(validHelp), helpFrontmatterSchema);
    expect(doc.attributes.tool).toBe('map_service');
    expect(doc.attributes.method).toBe('move_to');
  });

  it('parses paramTypes nested map (data corruption fix)', () => {
    const doc = parseAndValidate(
      wrap(`${validHelp}\nparamTypes:\n  locationId: string (required) - 目标地点ID`),
      helpFrontmatterSchema,
    );
    expect(doc.attributes.paramTypes).toEqual({
      locationId: 'string (required) - 目标地点ID',
    });
  });

  it('optional fields default to undefined', () => {
    const doc = parseAndValidate(wrap(validHelp), helpFrontmatterSchema);
    expect(doc.attributes.summary).toBeUndefined();
    expect(doc.attributes.whenToUse).toBeUndefined();
    expect(doc.attributes.returnsSummary).toBeUndefined();
    expect(doc.attributes.paramTypes).toBeUndefined();
    expect(doc.attributes.returnType).toBeUndefined();
    expect(doc.attributes.since).toBeUndefined();
  });

  it('parses whenToUse block list', () => {
    const doc = parseAndValidate(
      wrap(`${validHelp}\nwhenToUse:\n  - 玩家明确表达移动意图时\n  - 需要切换场景时`),
      helpFrontmatterSchema,
    );
    expect(doc.attributes.whenToUse).toEqual(['玩家明确表达移动意图时', '需要切换场景时']);
  });
});

describe('错误格式', () => {
  it('collects all issues when multiple fields invalid', () => {
    try {
      parseAndValidate(wrap('name: ""\ndescription: ""'), helpFrontmatterSchema, { filePath: 'h.md' });
      expect.unreachable();
    } catch (error) {
      const e = error as FrontmatterValidationError;
      expect(e.issues.length).toBeGreaterThanOrEqual(3); // name/description 空 + tool/method 缺失
      expect(e.code).toBe('SCHEMA_VALIDATION_FAILED');
    }
  });

  it('error message contains filePath, path and message', () => {
    try {
      parseAndValidate(wrap('method: move_to'), helpFrontmatterSchema, { filePath: 'docs/h.md' });
      expect.unreachable();
    } catch (error) {
      const e = error as FrontmatterValidationError;
      expect(e.message).toContain('docs/h.md');
      expect(e.message).toContain('tool');
      expect(e.filePath).toBe('docs/h.md');
    }
  });

  it('validateAttributes validates pre-parsed attributes', () => {
    const output = validateAttributes(
      { tool: 't', method: 'm', description: 'd', extra: 1 },
      helpFrontmatterSchema,
    );
    expect(output.tool).toBe('t');
    expect(output.extra).toBe(1);
  });

  it('issue carries expected/received hints', () => {
    try {
      validateAttributes({ tool: 't', method: 'm', description: 123 }, helpFrontmatterSchema, 'h.md');
      expect.unreachable();
    } catch (error) {
      const e = error as FrontmatterValidationError;
      const issue = e.issues.find((i) => i.path === 'description');
      expect(issue).toBeDefined();
      expect(issue!.expected).toBe('string');
      expect(issue!.received).toBe('123');
    }
  });
});
