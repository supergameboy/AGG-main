import { describe, it, expect } from 'vitest';
import {
  resolveQuestDisplay,
  resolveMapLocationDisplay,
} from '../customDataResolver';

describe('customDataResolver — Quest+Map', () => {
  // ============================================================
  // resolveQuestDisplay
  // ============================================================
  describe('resolveQuestDisplay', () => {
    it('从 Quest.prerequisite_quest_ids 读取前置任务ID列表', () => {
      const quest = {
        id: 'q1',
        name: '寻找龙之剑',
        type: 'main' as const,
        description: '找到传说中的龙之剑',
        status: 'available' as const,
        objectives: [],
        rewards: {},
        prerequisite_quest_ids: ['q0'],
      } as any;

      const display = resolveQuestDisplay(quest);
      expect(display.prerequisiteQuestIds).toEqual(['q0']);
    });

    it('无 prerequisite_quest_ids 时返回空数组', () => {
      const quest = {
        id: 'q1',
        name: '寻找龙之剑',
        type: 'main' as const,
        description: '找到传说中的龙之剑',
        status: 'available' as const,
        objectives: [],
        rewards: {},
      } as any;

      const display = resolveQuestDisplay(quest);
      expect(display.prerequisiteQuestIds).toEqual([]);
    });

    it('prerequisite_quest_ids 为空数组时返回空数组', () => {
      const quest = {
        id: 'q1',
        name: '寻找龙之剑',
        type: 'main' as const,
        description: '找到传说中的龙之剑',
        status: 'available' as const,
        objectives: [],
        rewards: {},
        prerequisite_quest_ids: [],
      } as any;

      const display = resolveQuestDisplay(quest);
      expect(display.prerequisiteQuestIds).toEqual([]);
    });

    it('多个前置任务ID', () => {
      const quest = {
        id: 'q1',
        name: '寻找龙之剑',
        type: 'main' as const,
        description: '找到传说中的龙之剑',
        status: 'available' as const,
        objectives: [],
        rewards: {},
        prerequisite_quest_ids: ['q0', 'q2'],
      } as any;

      const display = resolveQuestDisplay(quest);
      expect(display.prerequisiteQuestIds).toEqual(['q0', 'q2']);
    });
  });

  // ============================================================
  // resolveMapLocationDisplay
  // ============================================================
  describe('resolveMapLocationDisplay', () => {
    it('从 customData 读取 danger_level', () => {
      const location = {
        id: 'loc1',
        name: '暗影森林',
        customData: { danger_level: 5 },
      } as any;

      const display = resolveMapLocationDisplay(location);
      expect(display.dangerLevel).toBe(5);
    });

    it('从 customData 读取 is_starting_location', () => {
      const location = {
        id: 'loc1',
        name: '新手村',
        customData: { is_starting_location: true },
      } as any;

      const display = resolveMapLocationDisplay(location);
      expect(display.isStartingLocation).toBe(true);
    });

    it('从 customData 读取 is_explorable_area', () => {
      const location = {
        id: 'loc1',
        name: '迷雾沼泽',
        customData: { is_explorable_area: true },
      } as any;

      const display = resolveMapLocationDisplay(location);
      expect(display.isExplorableArea).toBe(true);
    });

    it('从 customData 读取 is_main_map', () => {
      const location = {
        id: 'loc1',
        name: '主世界',
        customData: { is_main_map: true },
      } as any;

      const display = resolveMapLocationDisplay(location);
      expect(display.isMainMap).toBe(true);
    });

    it('无 customData 时所有展示字段为 undefined', () => {
      const location = {
        id: 'loc1',
        name: '普通地点',
      } as any;

      const display = resolveMapLocationDisplay(location);
      expect(display.dangerLevel).toBeUndefined();
      expect(display.isStartingLocation).toBeUndefined();
      expect(display.isExplorableArea).toBeUndefined();
      expect(display.isMainMap).toBeUndefined();
    });

    it('customData 中非数字的 danger_level 返回 undefined', () => {
      const location = {
        id: 'loc1',
        name: '暗影森林',
        customData: { danger_level: 'high' },
      } as any;

      const display = resolveMapLocationDisplay(location);
      expect(display.dangerLevel).toBeUndefined();
    });

    it('customData 中非布尔值的 is_starting_location 返回 undefined', () => {
      const location = {
        id: 'loc1',
        name: '新手村',
        customData: { is_starting_location: 'yes' },
      } as any;

      const display = resolveMapLocationDisplay(location);
      expect(display.isStartingLocation).toBeUndefined();
    });

    it('标准 dangerLevel 字段作为兜底', () => {
      const location = {
        id: 'loc1',
        name: '暗影森林',
        dangerLevel: 3,
        customData: {},
      } as any;

      const display = resolveMapLocationDisplay(location);
      expect(display.dangerLevel).toBe(3);
    });

    it('customData.danger_level 优先于标准 dangerLevel', () => {
      const location = {
        id: 'loc1',
        name: '暗影森林',
        dangerLevel: 3,
        customData: { danger_level: 7 },
      } as any;

      const display = resolveMapLocationDisplay(location);
      expect(display.dangerLevel).toBe(7);
    });
  });
});
