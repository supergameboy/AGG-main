import { describe, it, expect } from 'vitest';
import { resolveSkillDisplay, resolveNPCDisplay } from '../customDataResolver';

describe('customDataResolver — 面板集成场景', () => {
  describe('Skill 面板集成', () => {
    it('LLM enrich 后的技能完整展示数据', () => {
      const skill = {
        id: 'skill-1',
        skill_id: 'skill-1',
        name: '烈焰斩',
        type: 'attack',
        description: '基础攻击',
        level: 3,
        cost: [{ type: 'mp' as const, amount: 15 }],
        cooldown: 2,
        unlocked: true,
        element: 'fire',
        customData: {
          displayType: '火焰攻击',
          displayEffects: '造成30点火焰伤害，有20%概率点燃目标',
          displayElement: '烈焰',
          tags: ['fire', 'attack', 'melee'],
          visualDesc: '剑刃燃起烈焰，划出一道火弧',
          class_requirement: ['warrior', 'paladin'],
          level_requirement: 5,
          locale: 'zh-CN',
        },
      } as any;

      const display = resolveSkillDisplay(skill);

      expect(display.displayType).toBe('火焰攻击');
      expect(display.displayEffects).toBe('造成30点火焰伤害，有20%概率点燃目标');
      expect(display.displayElement).toBe('烈焰');
      expect(display.tags).toEqual(['fire', 'attack', 'melee']);
      expect(display.visualDesc).toBe('剑刃燃起烈焰，划出一道火弧');
      expect(display.classRequirement).toEqual(['warrior', 'paladin']);
      expect(display.levelRequirement).toBe(5);
    });

    it('未 enrich 的技能回退到标准字段', () => {
      const skill = {
        id: 'skill-2',
        skill_id: 'skill-2',
        name: '治疗术',
        type: 'healing',
        element: 'holy',
        customData: {},
      } as any;

      const display = resolveSkillDisplay(skill);

      expect(display.displayType).toBe('healing');
      expect(display.displayElement).toBe('holy');
      expect(display.displayEffects).toBeUndefined();
      expect(display.tags).toBeUndefined();
    });

    it('YAML 模板中的技能有 class_requirement 但无 displayType', () => {
      const skill = {
        id: 'skill-3',
        skill_id: 'skill-3',
        name: '潜行',
        type: 'utility',
        customData: {
          class_requirement: ['rogue'],
          level_requirement: 1,
          locale: 'zh-CN',
        },
      } as any;

      const display = resolveSkillDisplay(skill);

      expect(display.displayType).toBe('utility');
      expect(display.classRequirement).toEqual(['rogue']);
      expect(display.levelRequirement).toBe(1);
    });

    it('部分 customData 字段存在、部分不存在', () => {
      const skill = {
        id: 'skill-4',
        skill_id: 'skill-4',
        name: '冰冻箭',
        type: 'attack',
        element: 'ice',
        customData: {
          displayType: '冰霜攻击',
        },
      } as any;

      const display = resolveSkillDisplay(skill);

      expect(display.displayType).toBe('冰霜攻击');
      expect(display.displayElement).toBe('ice');
      expect(display.displayEffects).toBeUndefined();
      expect(display.tags).toBeUndefined();
    });
  });

  describe('NPC 面板集成', () => {
    it('初始化 NPC 有完整 customData', () => {
      const npc = {
        id: 'npc-1',
        name: '铁匠格雷格',
        role: 'blacksmith',
        customData: {
          disposition: 'friendly',
          attitude: 'neutral',
          is_starting_scene_npc: true,
        },
      } as any;

      const display = resolveNPCDisplay(npc);

      expect(display.disposition).toBe('friendly');
      expect(display.attitude).toBe('neutral');
      expect(display.isStartingSceneNpc).toBe(true);
    });

    it('运行时 NPC 有坐标信息', () => {
      const npc = {
        id: 'npc-2',
        name: '巡逻兵',
        customData: {
          x: 150,
          y: 300,
          disposition: 'hostile',
        },
      } as any;

      const display = resolveNPCDisplay(npc);

      expect(display.disposition).toBe('hostile');
      expect(display.positionX).toBe(150);
      expect(display.positionY).toBe(300);
    });

    it('NPC 无 customData 时所有展示字段为 undefined', () => {
      const npc = {
        id: 'npc-3',
        name: '路人',
      } as any;

      const display = resolveNPCDisplay(npc);

      expect(display.disposition).toBeUndefined();
      expect(display.attitude).toBeUndefined();
      expect(display.isStartingSceneNpc).toBeUndefined();
      expect(display.positionX).toBeUndefined();
      expect(display.positionY).toBeUndefined();
    });
  });
});
