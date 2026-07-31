import { describe, it, expect } from 'vitest';
import {
  resolveSkillDisplay,
  resolveNPCDisplay,
} from '../customDataResolver';

describe('customDataResolver', () => {
  // ============================================================
  // resolveSkillDisplay
  // ============================================================
  describe('resolveSkillDisplay', () => {
    it('从 customData 读取 displayType，回退到标准 type', () => {
      const skill = {
        id: 's1',
        skill_id: 's1',
        name: '火球术',
        type: 'attack',
        customData: { displayType: '火焰攻击' },
      } as any;

      const display = resolveSkillDisplay(skill);
      expect(display.displayType).toBe('火焰攻击');
    });

    it('customData 无 displayType 时回退到标准 type', () => {
      const skill = {
        id: 's1',
        skill_id: 's1',
        name: '火球术',
        type: 'attack',
        customData: {},
      } as any;

      const display = resolveSkillDisplay(skill);
      expect(display.displayType).toBe('attack');
    });

    it('无 customData 时回退到标准 type', () => {
      const skill = {
        id: 's1',
        skill_id: 's1',
        name: '火球术',
        type: 'attack',
      } as any;

      const display = resolveSkillDisplay(skill);
      expect(display.displayType).toBe('attack');
    });

    it('从 customData 读取 displayEffects', () => {
      const skill = {
        id: 's1',
        skill_id: 's1',
        name: '火球术',
        type: 'attack',
        customData: { displayEffects: '造成25点火焰伤害' },
      } as any;

      const display = resolveSkillDisplay(skill);
      expect(display.displayEffects).toBe('造成25点火焰伤害');
    });

    it('从 customData 读取 tags 数组', () => {
      const skill = {
        id: 's1',
        skill_id: 's1',
        name: '火球术',
        type: 'attack',
        customData: { tags: ['fire', 'aoe', 'attack'] },
      } as any;

      const display = resolveSkillDisplay(skill);
      expect(display.tags).toEqual(['fire', 'aoe', 'attack']);
    });

    it('customData.tags 不是数组时返回 undefined', () => {
      const skill = {
        id: 's1',
        skill_id: 's1',
        name: '火球术',
        type: 'attack',
        customData: { tags: 'fire' },
      } as any;

      const display = resolveSkillDisplay(skill);
      expect(display.tags).toBeUndefined();
    });

    it('从 customData 读取 visualDesc', () => {
      const skill = {
        id: 's1',
        skill_id: 's1',
        name: '火球术',
        type: 'attack',
        customData: { visualDesc: '一团炽热的火球从掌心飞出' },
      } as any;

      const display = resolveSkillDisplay(skill);
      expect(display.visualDesc).toBe('一团炽热的火球从掌心飞出');
    });

    it('从 customData 读取 displayElement，回退到标准 element', () => {
      const skill = {
        id: 's1',
        skill_id: 's1',
        name: '火球术',
        type: 'attack',
        element: 'fire',
        customData: { displayElement: '烈焰' },
      } as any;

      const display = resolveSkillDisplay(skill);
      expect(display.displayElement).toBe('烈焰');
    });

    it('customData 无 displayElement 时回退到标准 element', () => {
      const skill = {
        id: 's1',
        skill_id: 's1',
        name: '火球术',
        type: 'attack',
        element: 'fire',
        customData: {},
      } as any;

      const display = resolveSkillDisplay(skill);
      expect(display.displayElement).toBe('fire');
    });

    it('从 customData 读取 class_requirement', () => {
      const skill = {
        id: 's1',
        skill_id: 's1',
        name: '火球术',
        type: 'attack',
        customData: { class_requirement: ['mage', 'wizard'] },
      } as any;

      const display = resolveSkillDisplay(skill);
      expect(display.classRequirement).toEqual(['mage', 'wizard']);
    });

    it('从 customData 读取 level_requirement', () => {
      const skill = {
        id: 's1',
        skill_id: 's1',
        name: '火球术',
        type: 'attack',
        customData: { level_requirement: 5 },
      } as any;

      const display = resolveSkillDisplay(skill);
      expect(display.levelRequirement).toBe(5);
    });

    it('customData 中非字符串的 displayType 返回 undefined', () => {
      const skill = {
        id: 's1',
        skill_id: 's1',
        name: '火球术',
        type: 'attack',
        customData: { displayType: 123 },
      } as any;

      const display = resolveSkillDisplay(skill);
      expect(display.displayType).toBe('attack');
    });

    it('customData 中非数字的 level_requirement 返回 undefined', () => {
      const skill = {
        id: 's1',
        skill_id: 's1',
        name: '火球术',
        type: 'attack',
        customData: { level_requirement: 'high' },
      } as any;

      const display = resolveSkillDisplay(skill);
      expect(display.levelRequirement).toBeUndefined();
    });
  });

  // ============================================================
  // resolveNPCDisplay
  // ============================================================
  describe('resolveNPCDisplay', () => {
    it('从 customData 读取 disposition', () => {
      const npc = {
        id: 'n1',
        name: '老村长',
        customData: { disposition: 'friendly' },
      } as any;

      const display = resolveNPCDisplay(npc);
      expect(display.disposition).toBe('friendly');
    });

    it('从 customData 读取 attitude', () => {
      const npc = {
        id: 'n1',
        name: '老村长',
        customData: { attitude: 'neutral' },
      } as any;

      const display = resolveNPCDisplay(npc);
      expect(display.attitude).toBe('neutral');
    });

    it('从 customData 读取 is_starting_scene_npc', () => {
      const npc = {
        id: 'n1',
        name: '老村长',
        customData: { is_starting_scene_npc: true },
      } as any;

      const display = resolveNPCDisplay(npc);
      expect(display.isStartingSceneNpc).toBe(true);
    });

    it('无 customData 时所有展示字段为 undefined', () => {
      const npc = {
        id: 'n1',
        name: '老村长',
      } as any;

      const display = resolveNPCDisplay(npc);
      expect(display.disposition).toBeUndefined();
      expect(display.attitude).toBeUndefined();
      expect(display.isStartingSceneNpc).toBeUndefined();
    });

    it('customData 为空对象时所有展示字段为 undefined', () => {
      const npc = {
        id: 'n1',
        name: '老村长',
        customData: {},
      } as any;

      const display = resolveNPCDisplay(npc);
      expect(display.disposition).toBeUndefined();
    });

    it('customData 中非字符串的 disposition 返回 undefined', () => {
      const npc = {
        id: 'n1',
        name: '老村长',
        customData: { disposition: 123 },
      } as any;

      const display = resolveNPCDisplay(npc);
      expect(display.disposition).toBeUndefined();
    });

    it('customData 中非布尔值的 is_starting_scene_npc 返回 undefined', () => {
      const npc = {
        id: 'n1',
        name: '老村长',
        customData: { is_starting_scene_npc: 'yes' },
      } as any;

      const display = resolveNPCDisplay(npc);
      expect(display.isStartingSceneNpc).toBeUndefined();
    });

    it('从 customData 读取坐标 x 和 y', () => {
      const npc = {
        id: 'n1',
        name: '老村长',
        customData: { x: 100, y: 200 },
      } as any;

      const display = resolveNPCDisplay(npc);
      expect(display.positionX).toBe(100);
      expect(display.positionY).toBe(200);
    });

    it('customData 中非数字的坐标返回 undefined', () => {
      const npc = {
        id: 'n1',
        name: '老村长',
        customData: { x: 'left', y: 'top' },
      } as any;

      const display = resolveNPCDisplay(npc);
      expect(display.positionX).toBeUndefined();
      expect(display.positionY).toBeUndefined();
    });
  });
});
