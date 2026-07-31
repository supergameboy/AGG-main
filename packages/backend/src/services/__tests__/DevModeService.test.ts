import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DevModeService, type DevPresetData } from '../DevModeService.js';
import type { AgentTraceData } from '../TraceCollector.js';
import fs from 'fs';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockLlmMetricsService() {
  return {
    getTokenUsageForSave: vi.fn().mockResolvedValue({ input: 0, output: 0, total: 0, cacheHit: 0, cacheMiss: 0 }),
  };
}

function createMockTemplateService() {
  return {
    getTemplate: vi.fn(),
    getTemplates: vi.fn().mockResolvedValue([{ id: 'medieval-fantasy' }]),
  };
}

function makeCharacterCreationTemplate() {
  return {
    characterCreation: {
      races: [
        { id: 'human', available_classes: ['warrior', 'mage'] },
        { id: 'elf', available_classes: ['mage', 'ranger'] },
      ],
      classes: [
        { id: 'warrior' },
        { id: 'mage' },
        { id: 'ranger' },
      ],
      backgrounds: [
        { id: 'noble' },
        { id: 'commoner' },
        { id: 'outcast' },
      ],
      attributes: [
        { id: 'strength', min_value: 1, max_value: 20 },
        { id: 'dexterity', min_value: 1, max_value: 20 },
        { id: 'intelligence', min_value: 1, max_value: 20 },
      ],
      custom_options: [
        { id: 'eye_color' },
        { id: 'hair_style' },
      ],
    },
  };
}

function makeValidPresetData(overrides?: Partial<DevPresetData>): DevPresetData {
  return {
    templateId: null,
    name: 'Test Warrior',
    gender: 'male',
    race: 'human',
    classType: 'warrior',
    background: 'noble',
    attributes: { strength: 16, dexterity: 12, intelligence: 8 },
    language: 'zh',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DevModeService', () => {
  let service: DevModeService;
  let mockTemplateService: ReturnType<typeof createMockTemplateService>;
  let mockLlmMetricsService: ReturnType<typeof createMockLlmMetricsService>;

  beforeEach(() => {
    mockTemplateService = createMockTemplateService();
    mockLlmMetricsService = createMockLlmMetricsService();
    service = new DevModeService(mockTemplateService as never, mockLlmMetricsService as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Request context management
  // -------------------------------------------------------------------------

  describe('createRequestContext', () => {
    it('creates context with requestId', () => {
      const requestId = service.createRequestContext();

      expect(requestId).toBeTruthy();
      expect(typeof requestId).toBe('string');

      const context = service.getRequestContext(requestId);
      expect(context).toBeDefined();
      expect(context!.requestId).toBe(requestId);
      expect(context!.createdAt).toBeGreaterThan(0);
    });

    it('enforces MAX_CONTEXTS limit (100)', () => {
      // Fill up to the max limit
      const ids: string[] = [];
      for (let i = 0; i < 100; i++) {
        ids.push(service.createRequestContext());
      }

      // Creating one more should evict the oldest
      const newId = service.createRequestContext();

      // The oldest context should have been evicted
      const oldestContext = service.getRequestContext(ids[0]);
      expect(oldestContext).toBeUndefined();

      // The new context should exist
      const newContext = service.getRequestContext(newId);
      expect(newContext).toBeDefined();

      // Total should still be 100
      const remainingIds = [...ids.slice(1), newId];
      let existingCount = 0;
      for (const id of remainingIds) {
        if (service.getRequestContext(id) !== undefined) {
          existingCount++;
        }
      }
      expect(existingCount).toBe(100);
    });
  });

  describe('setCoordinatorDecisions', () => {
    it('stores decisions', () => {
      const requestId = service.createRequestContext();
      const decisions = [
        { intent: 'combat', routedAgents: ['challenge', 'narrative'] },
      ];

      service.setCoordinatorDecisions(requestId, decisions);

      const context = service.getRequestContext(requestId);
      expect(context!.coordinatorDecisions).toEqual(decisions);
    });
  });

  describe('setAgentTrace', () => {
    it('stores trace data', () => {
      const requestId = service.createRequestContext();
      const trace: AgentTraceData = {
        requestId,
        agentTraces: [],
        coordinatorDecisions: [],
      };

      service.setAgentTrace(requestId, trace);

      const context = service.getRequestContext(requestId);
      expect(context!.agentTrace).toEqual(trace);
    });
  });

  describe('getRequestContext', () => {
    it('retrieves context', () => {
      const requestId = service.createRequestContext();
      const context = service.getRequestContext(requestId);

      expect(context).toBeDefined();
      expect(context!.requestId).toBe(requestId);
    });

    it('returns undefined for non-existent context', () => {
      const context = service.getRequestContext('non-existent-id');
      expect(context).toBeUndefined();
    });
  });

  describe('cleanupRequestContext', () => {
    it('removes context and clears timer', () => {
      const requestId = service.createRequestContext();

      // Verify context exists
      expect(service.getRequestContext(requestId)).toBeDefined();

      service.cleanupRequestContext(requestId);

      // Verify context is removed
      expect(service.getRequestContext(requestId)).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Redundant read detection
  // -------------------------------------------------------------------------

  describe('detectRedundantReads', () => {
    it('counts duplicate read operations', () => {
      const traces = [
        {
          toolCalls: [
            { tool: 'get_npc_state', isReadOperation: true, args: { npcId: 'blacksmith' } },
            { tool: 'get_npc_state', isReadOperation: true, args: { npcId: 'blacksmith' } },
            { tool: 'get_scene', isReadOperation: true, args: { sceneId: 'tavern' } },
            { tool: 'get_scene', isReadOperation: true, args: { sceneId: 'tavern' } },
            { tool: 'get_scene', isReadOperation: true, args: { sceneId: 'tavern' } },
          ],
        },
      ];

      const count = service.detectRedundantReads(traces);
      // get_npc_state:blacksmith appears 2x → 1 redundant
      // get_scene:tavern appears 3x → 2 redundant
      expect(count).toBe(3);
    });

    it('returns 0 for no duplicates', () => {
      const traces = [
        {
          toolCalls: [
            { tool: 'get_npc_state', isReadOperation: true, args: { npcId: 'blacksmith' } },
            { tool: 'get_scene', isReadOperation: true, args: { sceneId: 'tavern' } },
            { tool: 'apply_damage', isReadOperation: false, args: { target: 'goblin' } },
          ],
        },
      ];

      const count = service.detectRedundantReads(traces);
      expect(count).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Preset listing
  // -------------------------------------------------------------------------

  describe('listPresets', () => {
    it('returns empty when no presets dir', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      const result = service.listPresets();
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Preset loading
  // -------------------------------------------------------------------------

  describe('loadPreset', () => {
    it('throws for invalid format', async () => {
      await expect(service.loadPreset('invalid-no-slash')).rejects.toThrow(
        'Invalid preset format: "invalid-no-slash"',
      );
    });

    it('throws for non-existent preset', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      await expect(service.loadPreset('medieval-fantasy/unknown')).rejects.toThrow(
        'Preset not found: "medieval-fantasy/unknown"',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Preset validation
  // -------------------------------------------------------------------------

  describe('validatePreset', () => {
    beforeEach(() => {
      mockTemplateService.getTemplate.mockResolvedValue(makeCharacterCreationTemplate());
    });

    it('returns errors for invalid race', async () => {
      const preset = makeValidPresetData({ race: 'dwarf' });
      const result = await service.validatePreset(preset, 'medieval-fantasy');

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Race "dwarf" not in template'),
        ]),
      );
    });

    it('returns errors for invalid classType', async () => {
      const preset = makeValidPresetData({ classType: 'necromancer' });
      const result = await service.validatePreset(preset, 'medieval-fantasy');

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Class "necromancer" not in template'),
        ]),
      );
    });

    it('returns errors for invalid background', async () => {
      const preset = makeValidPresetData({ background: 'pirate' });
      const result = await service.validatePreset(preset, 'medieval-fantasy');

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Background "pirate" not in template'),
        ]),
      );
    });

    it('returns valid for correct data', async () => {
      const preset = makeValidPresetData();
      const result = await service.validatePreset(preset, 'medieval-fantasy');

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('returns warnings for missing attributes', async () => {
      const preset = makeValidPresetData({
        attributes: { strength: 16 },
      });
      const result = await service.validatePreset(preset, 'medieval-fantasy');

      expect(result.valid).toBe(true);
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Attribute "dexterity" not specified'),
          expect.stringContaining('Attribute "intelligence" not specified'),
        ]),
      );
    });
  });
});
