import { describe, expect, it } from 'vitest';
import {
  ALL_AGENT_TYPES,
  ROUTABLE_DOMAIN_AGENT_TYPES,
  DOMAIN_ENRICHMENT_AGENT_TYPES,
  DOMAIN_AGENT_TYPES,
} from '../types.js';

/**
 * Agent类型配置验证
 *
 * 验收标准:
 * 1. ALL_AGENT_TYPES 包含 'output'，不包含 'dialogue' 和 'ui'
 * 2. ROUTABLE_DOMAIN_AGENT_TYPES 不包含 'output'（由 Layer 3 确定性调度）
 * 3. DOMAIN_ENRICHMENT_AGENT_TYPES 不包含 'gamemaster' 和 'output'
 * 4. DOMAIN_AGENT_TYPES 排除 gamemaster 和 output
 */
describe('types.ts Agent类型配置', () => {
  describe('ALL_AGENT_TYPES', () => {
    it('应包含 output', () => {
      expect(ALL_AGENT_TYPES).toContain('output');
    });

    it('不应包含 dialogue', () => {
      expect(ALL_AGENT_TYPES).not.toContain('dialogue');
    });

    it('不应包含 ui', () => {
      expect(ALL_AGENT_TYPES).not.toContain('ui');
    });
  });

  describe('ROUTABLE_DOMAIN_AGENT_TYPES', () => {
    it('不应包含 output（由 Layer 3 确定性调度）', () => {
      expect(ROUTABLE_DOMAIN_AGENT_TYPES).not.toContain('output');
    });

    it('不应包含 gamemaster', () => {
      expect(ROUTABLE_DOMAIN_AGENT_TYPES).not.toContain('gamemaster');
    });
  });

  describe('DOMAIN_ENRICHMENT_AGENT_TYPES', () => {
    it('不应包含 gamemaster', () => {
      expect(DOMAIN_ENRICHMENT_AGENT_TYPES).not.toContain('gamemaster');
    });

    it('不应包含 output', () => {
      expect(DOMAIN_ENRICHMENT_AGENT_TYPES).not.toContain('output');
    });

    it('应包含 inventory, npc_party, quest, map, skill', () => {
      expect(DOMAIN_ENRICHMENT_AGENT_TYPES).toContain('inventory');
      expect(DOMAIN_ENRICHMENT_AGENT_TYPES).toContain('npc_party');
      expect(DOMAIN_ENRICHMENT_AGENT_TYPES).toContain('quest');
      expect(DOMAIN_ENRICHMENT_AGENT_TYPES).toContain('map');
      expect(DOMAIN_ENRICHMENT_AGENT_TYPES).toContain('skill');
    });
  });

  describe('DOMAIN_AGENT_TYPES', () => {
    it('不应包含 gamemaster', () => {
      expect(DOMAIN_AGENT_TYPES).not.toContain('gamemaster');
    });

    it('不应包含 output', () => {
      expect(DOMAIN_AGENT_TYPES).not.toContain('output');
    });
  });
});
