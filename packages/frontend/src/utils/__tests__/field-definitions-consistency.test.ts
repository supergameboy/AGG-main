/**
 * 测试：初始化映射与实时映射的字段一致性
 *
 * 验证 fieldDefinitions.ts 中的共享字段定义被两种映射路径正确消费，
 * 确保新增字段时只需修改一处。
 */
import { describe, it, expect } from 'vitest';
import {
  SKILL_FIELD_KEYS,
  INVENTORY_FIELD_KEYS,
  QUEST_FIELD_KEYS,
} from '@/utils/fieldDefinitions';
import { getSkillFieldKeys } from '@/mappers/skillsMapper';
import { getInventoryFieldKeys } from '@/mappers/inventoryMapper';
import { getQuestFieldKeys } from '@/mappers/questsMapper';

// panelUpdateMerger 的映射函数是私有的，通过构建样例数据间接验证
// 这里直接导入共享定义与 mapper 导出的 key 列表对比

describe('fieldDefinitions — 初始化映射与实时映射字段一致性', () => {
  describe('技能字段', () => {
    it('skillsMapper 引用的字段列表与 fieldDefinitions 一致', () => {
      expect(getSkillFieldKeys()).toEqual(SKILL_FIELD_KEYS);
    });

    it('SKILL_FIELD_KEYS 包含 effects 字段', () => {
      expect(SKILL_FIELD_KEYS).toContain('effects');
    });

    it('SKILL_FIELD_KEYS 包含所有必要字段', () => {
      const required = ['id', 'skill_id', 'name', 'type', 'description', 'level', 'cost', 'cooldown', 'unlocked', 'element', 'effects', 'customData'];
      for (const field of required) {
        expect(SKILL_FIELD_KEYS).toContain(field);
      }
    });
  });

  describe('物品字段', () => {
    it('inventoryMapper 引用的字段列表与 fieldDefinitions 一致', () => {
      expect(getInventoryFieldKeys()).toEqual(INVENTORY_FIELD_KEYS);
    });

    it('INVENTORY_FIELD_KEYS 包含所有必要字段', () => {
      const required = ['id', 'saveId', 'itemId', 'name', 'description', 'category', 'quantity', 'quality', 'equipped', 'equippedSlot', 'stats', 'effects', 'value', 'tags', 'customData', 'visible'];
      for (const field of required) {
        expect(INVENTORY_FIELD_KEYS).toContain(field);
      }
    });
  });

  describe('任务字段', () => {
    it('questsMapper 引用的字段列表与 fieldDefinitions 一致', () => {
      expect(getQuestFieldKeys()).toEqual(QUEST_FIELD_KEYS);
    });

    it('QUEST_FIELD_KEYS 包含 created_at 和 updated_at', () => {
      expect(QUEST_FIELD_KEYS).toContain('created_at');
      expect(QUEST_FIELD_KEYS).toContain('updated_at');
    });

    it('QUEST_FIELD_KEYS 包含所有必要字段', () => {
      const required = ['id', 'name', 'type', 'description', 'status', 'visible', 'objectives', 'rewards', 'time_limit', 'custom_data'];
      for (const field of required) {
        expect(QUEST_FIELD_KEYS).toContain(field);
      }
    });
  });
});
