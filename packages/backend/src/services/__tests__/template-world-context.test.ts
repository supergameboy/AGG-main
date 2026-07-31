import { describe, expect, it } from 'vitest';
import { TemplateService } from '../template.js';
import type { TemplateRecord } from '../template.js';

function makeTemplate(overrides: Partial<TemplateRecord> = {}): TemplateRecord {
  return {
    id: 'tpl-1',
    name: 'Test World',
    description: 'A test world',
    version: '1.0',
    author: 'test',
    tags: [],
    gameMode: 'turn_based_rpg',
    worldSetting: {
      name: 'Eldoria',
      era: 'Medieval',
      magic_system: 'Elemental',
      technology_level: 'Low',
    },
    characterCreation: {},
    gameRules: { combat: 'turn-based', death: 'respawn' },
    aiConstraints: { tone: 'serious', language: 'en' },
    startingScene: {
      description: 'A dark forest at midnight',
      explorable_areas: [
        { id: 'loc-1', name: 'Dark Forest' },
        { id: 'loc-2', name: 'Abandoned Tower' },
      ],
      location: 'loc-1',
    },
    initialData: {},
    skills: [],
    items: [],
    npcs: [],
    locations: [],
    uiTheme: {},
    uiLayout: {},
    numericalComplexity: 'standard',
    specialRules: {
      has_kp: true,
      permadeath: false,
      save_restriction: 'free',
      custom_rules: ['No fast travel'],
    },
    combat: {},
    agentProfile: '',
    isBuiltin: false,
    source: 'yaml',
    createdAt: 0 as any,
    updatedAt: 0 as any,
    ...overrides,
  };
}

describe('TemplateService.buildWorldContext', () => {
  it('should include World Setting, Rules, AI Constraints, and Special Rules', () => {
    const service = Object.create(TemplateService.prototype) as TemplateService;
    const template = makeTemplate();
    const result = service.buildWorldContext(template);

    expect(result).toContain('## World Setting');
    expect(result).toContain('Eldoria');
    expect(result).toContain('## Rules');
    expect(result).toContain('combat');
    expect(result).toContain('## AI Constraints');
    expect(result).toContain('tone');
    expect(result).toContain('## Special Rules');
    expect(result).toContain('Has KP');
    expect(result).toContain('No fast travel');
  });

  it('should NOT include Starting Scene', () => {
    const service = Object.create(TemplateService.prototype) as TemplateService;
    const template = makeTemplate();
    const result = service.buildWorldContext(template);

    expect(result).not.toContain('## Starting Scene');
    expect(result).not.toContain('A dark forest at midnight');
  });

  it('should NOT include Known Locations', () => {
    const service = Object.create(TemplateService.prototype) as TemplateService;
    const template = makeTemplate();
    const result = service.buildWorldContext(template);

    expect(result).not.toContain('## Known Locations');
    expect(result).not.toContain('Dark Forest');
    expect(result).not.toContain('Abandoned Tower');
  });

  it('should omit Special Rules section when specialRules is empty', () => {
    const service = Object.create(TemplateService.prototype) as TemplateService;
    const template = makeTemplate({ specialRules: {} });
    const result = service.buildWorldContext(template);

    expect(result).not.toContain('## Special Rules');
  });

  it('should omit Special Rules section when specialRules is undefined', () => {
    const service = Object.create(TemplateService.prototype) as TemplateService;
    const template = makeTemplate({ specialRules: undefined as any });
    const result = service.buildWorldContext(template);

    expect(result).not.toContain('## Special Rules');
  });

  it('should include custom rules when present', () => {
    const service = Object.create(TemplateService.prototype) as TemplateService;
    const template = makeTemplate({
      specialRules: {
        has_kp: false,
        permadeath: true,
        save_restriction: 'restricted',
        custom_rules: ['Rule A', 'Rule B'],
      },
    });
    const result = service.buildWorldContext(template);

    expect(result).toContain('Rule A; Rule B');
  });

  it('should handle missing world_setting fields gracefully', () => {
    const service = Object.create(TemplateService.prototype) as TemplateService;
    const template = makeTemplate({ worldSetting: {} });
    const result = service.buildWorldContext(template);

    expect(result).toContain('Unknown');
    expect(result).toContain('Unspecified');
    expect(result).toContain('None');
  });
});

describe('TemplateService.buildSystemContext vs buildWorldContext', () => {
  it('buildSystemContext should include Starting Scene and Known Locations', () => {
    const service = Object.create(TemplateService.prototype) as TemplateService;
    const template = makeTemplate();
    const result = service.buildSystemContext(template);

    expect(result).toContain('## Starting Scene');
    expect(result).toContain('## Known Locations');
  });

  it('buildWorldContext should NOT include Starting Scene and Known Locations', () => {
    const service = Object.create(TemplateService.prototype) as TemplateService;
    const template = makeTemplate();
    const result = service.buildWorldContext(template);

    expect(result).not.toContain('## Starting Scene');
    expect(result).not.toContain('## Known Locations');
  });

  it('both should include World Setting, Rules, AI Constraints, Special Rules', () => {
    const service = Object.create(TemplateService.prototype) as TemplateService;
    const template = makeTemplate();
    const systemCtx = service.buildSystemContext(template);
    const worldCtx = service.buildWorldContext(template);

    for (const section of ['## World Setting', '## Rules', '## AI Constraints', '## Special Rules']) {
      expect(systemCtx).toContain(section);
      expect(worldCtx).toContain(section);
    }
  });
});
