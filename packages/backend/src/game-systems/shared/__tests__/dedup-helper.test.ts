import { describe, expect, it } from 'vitest';
import {
  computeDedupUpdate,
  formatDedupWarnings,
  type FieldDiff,
  type BlockedField,
} from '../dedup-helper.js';

/**
 * dedup-helper 核心逻辑测试
 *
 * 设计文档：docs/design/fix/fix-20260716-audit-feedback-duplicate-creation.md
 * 章节：§3 去重防护统一理想效果 + §3.1 黑名单字段触发提示
 *
 * 本测试验证所有 6 个 Service 共享的去重核心逻辑：
 * 1. 非黑名单字段增量更新（仅更新发生变化的字段）
 * 2. 黑名单字段拒绝更新并记录
 * 3. 字段级 diff 生成（"字段名: 旧值 → 新值"）
 * 4. warnings 格式化（含 blockedFields + updatedFields）
 *
 * 各 Service 测试（map/character/skill/npc/inventory-duplicate-prevention.test.ts）
 * 验证 Service 正确调用 dedup-helper 并透传结果。
 */

describe('dedup-helper 核心逻辑', () => {
  describe('computeDedupUpdate - 增量更新计算', () => {
    it('用例1: 无字段变化 - 返回空 updatedFields', () => {
      const existing = { name: '白杨村', description: '一个村庄', type: 'village' };
      const incoming = { name: '白杨村', description: '一个村庄', type: 'village' };
      const blacklist = ['id', 'saveId', 'createdAt'];

      const result = computeDedupUpdate(existing, incoming, blacklist);

      expect(result.updatedFields).toEqual([]);
      expect(result.blockedFields).toEqual([]);
    });

    it('用例2: 单字段变化 - 返回单个 FieldDiff', () => {
      const existing = { name: '白杨村', description: '旧描述', type: 'village' };
      const incoming = { name: '白杨村', description: '新描述', type: 'village' };
      const blacklist = ['id', 'saveId', 'createdAt'];

      const result = computeDedupUpdate(existing, incoming, blacklist);

      expect(result.updatedFields).toHaveLength(1);
      expect(result.updatedFields[0].field).toBe('description');
      expect(result.updatedFields[0].oldValue).toBe('旧描述');
      expect(result.updatedFields[0].newValue).toBe('新描述');
    });

    it('用例3: 多字段变化 - 返回多个 FieldDiff', () => {
      const existing = { name: '白杨村', description: '旧描述', type: 'village', dangerLevel: 1 };
      const incoming = { name: '白杨村', description: '新描述', type: 'town', dangerLevel: 3 };
      const blacklist = ['id', 'saveId', 'createdAt'];

      const result = computeDedupUpdate(existing, incoming, blacklist);

      expect(result.updatedFields).toHaveLength(3);
      const fields = result.updatedFields.map(f => f.field);
      expect(fields).toContain('description');
      expect(fields).toContain('type');
      expect(fields).toContain('dangerLevel');
    });

    it('用例4: undefined 值跳过（Agent 未传入该字段）', () => {
      const existing = { name: '白杨村', description: '旧描述' };
      const incoming = { name: '白杨村', description: undefined };
      const blacklist = ['id', 'saveId', 'createdAt'];

      const result = computeDedupUpdate(existing, incoming, blacklist);

      expect(result.updatedFields).toEqual([]);
    });

    it('用例5: 数值类型变化 - 正确识别', () => {
      const existing = { quantity: 1, level: 5 };
      const incoming = { quantity: 3, level: 5 };
      const blacklist = ['id'];

      const result = computeDedupUpdate(existing, incoming, blacklist);

      expect(result.updatedFields).toHaveLength(1);
      expect(result.updatedFields[0].field).toBe('quantity');
      expect(result.updatedFields[0].oldValue).toBe(1);
      expect(result.updatedFields[0].newValue).toBe(3);
    });

    it('用例6: 布尔类型变化 - 正确识别', () => {
      const existing = { visible: false, unlocked: true };
      const incoming = { visible: true, unlocked: true };
      const blacklist = ['id'];

      const result = computeDedupUpdate(existing, incoming, blacklist);

      expect(result.updatedFields).toHaveLength(1);
      expect(result.updatedFields[0].field).toBe('visible');
      expect(result.updatedFields[0].oldValue).toBe(false);
      expect(result.updatedFields[0].newValue).toBe(true);
    });

    it('用例7: 对象类型变化 - JSON 序列化比较', () => {
      const existing = { stats: { hp: 100, mp: 50 }, effects: [] };
      const incoming = { stats: { hp: 120, mp: 50 }, effects: [] };
      const blacklist = ['id'];

      const result = computeDedupUpdate(existing, incoming, blacklist);

      expect(result.updatedFields).toHaveLength(1);
      expect(result.updatedFields[0].field).toBe('stats');
    });

    it('用例8: 数组类型变化 - JSON 序列化比较', () => {
      const existing = { tags: ['a', 'b'] };
      const incoming = { tags: ['a', 'b', 'c'] };
      const blacklist = ['id'];

      const result = computeDedupUpdate(existing, incoming, blacklist);

      expect(result.updatedFields).toHaveLength(1);
      expect(result.updatedFields[0].field).toBe('tags');
    });
  });

  describe('computeDedupUpdate - 黑名单字段处理', () => {
    /**
     * 设计文档 §3.1 黑名单字段触发提示：
     * 当 Agent 传入的参数包含黑名单字段时，不抛错，不静默忽略，而是：
     * 1. 拒绝更新黑名单字段：保留原值不覆盖
     * 2. 增量更新非黑名单字段：正常 diff 更新
     * 3. warnings 必须同时返回 blockedFields + updatedFields
     */
    it('黑名单1: 黑名单字段拒绝更新 - 记录到 blockedFields', () => {
      const existing = { id: 'loc_001', saveId: 'save_001', name: '白杨村', description: '旧描述' };
      const incoming = { id: 'loc_002', saveId: 'save_001', name: '白杨村', description: '新描述' };
      const blacklist = ['id', 'saveId', 'createdAt'];

      const result = computeDedupUpdate(existing, incoming, blacklist);

      expect(result.blockedFields).toHaveLength(1);
      expect(result.blockedFields[0].field).toBe('id');
      expect(result.blockedFields[0].rejectedValue).toBe('loc_002');
      expect(result.blockedFields[0].preservedValue).toBe('loc_001');
    });

    it('黑名单2: 黑名单字段值未变化 - 不记录到 blockedFields', () => {
      const existing = { id: 'loc_001', saveId: 'save_001', name: '白杨村' };
      const incoming = { id: 'loc_001', saveId: 'save_001', name: '白杨村' };
      const blacklist = ['id', 'saveId'];

      const result = computeDedupUpdate(existing, incoming, blacklist);

      expect(result.blockedFields).toEqual([]);
    });

    it('黑名单3: 多个黑名单字段触发 - 全部记录', () => {
      const existing = { id: 'loc_001', saveId: 'save_001', createdAt: 1000, name: '白杨村' };
      const incoming = { id: 'loc_002', saveId: 'save_002', createdAt: 2000, name: '白杨村' };
      const blacklist = ['id', 'saveId', 'createdAt'];

      const result = computeDedupUpdate(existing, incoming, blacklist);

      expect(result.blockedFields).toHaveLength(3);
      const fields = result.blockedFields.map(f => f.field);
      expect(fields).toContain('id');
      expect(fields).toContain('saveId');
      expect(fields).toContain('createdAt');
    });

    it('黑名单4: 黑名单字段 + 非黑名单字段同时变化 - 同时返回 blockedFields + updatedFields', () => {
      const existing = { id: 'loc_001', saveId: 'save_001', description: '旧描述', dangerLevel: 1 };
      const incoming = { id: 'loc_002', saveId: 'save_001', description: '新描述', dangerLevel: 3 };
      const blacklist = ['id', 'saveId', 'createdAt'];

      const result = computeDedupUpdate(existing, incoming, blacklist);

      expect(result.blockedFields).toHaveLength(1);
      expect(result.blockedFields[0].field).toBe('id');
      expect(result.updatedFields).toHaveLength(2);
      const updatedFields = result.updatedFields.map(f => f.field);
      expect(updatedFields).toContain('description');
      expect(updatedFields).toContain('dangerLevel');
    });
  });

  describe('formatDedupWarnings - warnings 格式化', () => {
    /**
     * 设计文档 §3 warning 消息格式规范：
     * - 单字段更新："地点 '白杨村' 已存在，已增量更新 parentLocationId: loc_旧 → loc_新"
     * - 多字段更新："地点 '白杨村' 已存在，已增量更新 parentLocationId: loc_旧 → loc_新, description: 旧描述 → 新描述"
     * - 数值合并："物品 '木制法杖' 已存在，quantity: 1 → 3（增量合并 +2）"
     * - 布尔切换："技能 '火球术' 已学习，visible: false → true"
     */
    it('格式1: 单字段更新 - warnings 包含字段级 diff', () => {
      const updatedFields: FieldDiff[] = [
        { field: 'parentLocationId', oldValue: 'loc_旧', newValue: 'loc_新' },
      ];
      const blockedFields: BlockedField[] = [];

      const warnings = formatDedupWarnings('地点', '白杨村', updatedFields, blockedFields);

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("地点 '白杨村' 已存在");
      expect(warnings[0]).toContain('已增量更新');
      expect(warnings[0]).toContain('parentLocationId: loc_旧 → loc_新');
    });

    it('格式2: 多字段更新 - warnings 包含所有字段级 diff', () => {
      const updatedFields: FieldDiff[] = [
        { field: 'parentLocationId', oldValue: 'loc_旧', newValue: 'loc_新' },
        { field: 'description', oldValue: '旧描述', newValue: '新描述' },
      ];
      const blockedFields: BlockedField[] = [];

      const warnings = formatDedupWarnings('地点', '白杨村', updatedFields, blockedFields);

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('parentLocationId: loc_旧 → loc_新');
      expect(warnings[0]).toContain('description: 旧描述 → 新描述');
      expect(warnings[0]).toContain(',');
    });

    it('格式3: 数值更新 - warnings 包含数值 diff', () => {
      const updatedFields: FieldDiff[] = [
        { field: 'quantity', oldValue: 1, newValue: 3 },
      ];
      const blockedFields: BlockedField[] = [];

      const warnings = formatDedupWarnings('物品', '木制法杖', updatedFields, blockedFields);

      expect(warnings[0]).toContain("物品 '木制法杖' 已存在");
      expect(warnings[0]).toContain('quantity: 1 → 3');
    });

    it('格式4: 布尔更新 - warnings 包含布尔 diff', () => {
      const updatedFields: FieldDiff[] = [
        { field: 'visible', oldValue: false, newValue: true },
      ];
      const blockedFields: BlockedField[] = [];

      const warnings = formatDedupWarnings('技能', '火球术', updatedFields, blockedFields);

      expect(warnings[0]).toContain("技能 '火球术' 已存在");
      expect(warnings[0]).toContain('visible: false → true');
    });

    it('格式5: 黑名单触发 - warnings 包含 blockedFields 信息', () => {
      const updatedFields: FieldDiff[] = [
        { field: 'description', oldValue: '旧', newValue: '新' },
      ];
      const blockedFields: BlockedField[] = [
        { field: 'id', rejectedValue: 'loc_新', preservedValue: 'loc_旧' },
      ];

      const warnings = formatDedupWarnings('地点', '白杨村', updatedFields, blockedFields);

      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toContain('已增量更新');
      expect(warnings[1]).toContain('黑名单字段');
      expect(warnings[1]).toContain('id: loc_旧 (拒绝值: loc_新)');
    });

    it('格式6: 仅黑名单触发（无字段更新）- warnings 仅包含 blockedFields', () => {
      const updatedFields: FieldDiff[] = [];
      const blockedFields: BlockedField[] = [
        { field: 'id', rejectedValue: 'loc_新', preservedValue: 'loc_旧' },
      ];

      const warnings = formatDedupWarnings('地点', '白杨村', updatedFields, blockedFields);

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('黑名单字段');
      expect(warnings[0]).not.toContain('已增量更新');
    });

    it('格式7: 无字段变化无黑名单 - warnings 提示数据已存在', () => {
      const updatedFields: FieldDiff[] = [];
      const blockedFields: BlockedField[] = [];

      const warnings = formatDedupWarnings('地点', '白杨村', updatedFields, blockedFields);

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("地点 '白杨村' 已存在");
      expect(warnings[0]).toContain('无字段变化');
    });

    it('格式8: null 值格式化为 "null"', () => {
      const updatedFields: FieldDiff[] = [
        { field: 'parentLocationId', oldValue: null, newValue: 'loc_新' },
      ];
      const blockedFields: BlockedField[] = [];

      const warnings = formatDedupWarnings('地点', '白杨村', updatedFields, blockedFields);

      expect(warnings[0]).toContain('parentLocationId: null → loc_新');
    });

    it('格式9: 对象值格式化为 JSON', () => {
      const updatedFields: FieldDiff[] = [
        { field: 'stats', oldValue: { hp: 100 }, newValue: { hp: 120 } },
      ];
      const blockedFields: BlockedField[] = [];

      const warnings = formatDedupWarnings('物品', '铁剑', updatedFields, blockedFields);

      expect(warnings[0]).toContain('stats: {"hp":100} → {"hp":120}');
    });
  });

  describe('设计文档黑名单场景验证', () => {
    /**
     * 设计文档 §3 黑名单字段表：
     * | MapService.createLocation | id、saveId、createdAt、locationLevel |
     * | CharacterService.createCharacter | id、saveId、createdAt |
     * | InventoryService.addPoolItem | id、saveId、itemId、createdAt |
     * | SkillService.addPoolSkill | id、saveId、skillId、createdAt |
     * | SkillService.learnSkill | id、saveId、skillId、ownerId、ownerType、createdAt |
     * | NPCService.createNPC | id、saveId、npcId、createdAt |
     * | InventoryService.addItem | id、saveId、itemId、ownerId、ownerType、createdAt、equippedSlot、equippedIndex |
     */

    it('场景1: MapService 黑名单 - locationLevel 拒绝更新', () => {
      const existing = { id: 'loc_001', saveId: 'save_001', createdAt: 1000, locationLevel: 2, name: '白杨村' };
      const incoming = { id: 'loc_001', saveId: 'save_001', createdAt: 1000, locationLevel: 3, name: '白杨村' };
      const blacklist = ['id', 'saveId', 'createdAt', 'locationLevel'];

      const result = computeDedupUpdate(existing, incoming, blacklist);

      expect(result.blockedFields).toHaveLength(1);
      expect(result.blockedFields[0].field).toBe('locationLevel');
      expect(result.blockedFields[0].preservedValue).toBe(2);
      expect(result.blockedFields[0].rejectedValue).toBe(3);
    });

    it('场景2: SkillService.learnSkill 黑名单 - ownerId 拒绝更新', () => {
      const existing = { id: 'skill_001', saveId: 'save_001', skillId: 'pool_fireball', ownerId: 'char_001', ownerType: 'character', createdAt: 1000, visible: false };
      const incoming = { id: 'skill_001', saveId: 'save_001', skillId: 'pool_fireball', ownerId: 'char_002', ownerType: 'character', createdAt: 1000, visible: true };
      const blacklist = ['id', 'saveId', 'skillId', 'ownerId', 'ownerType', 'createdAt'];

      const result = computeDedupUpdate(existing, incoming, blacklist);

      expect(result.blockedFields).toHaveLength(1);
      expect(result.blockedFields[0].field).toBe('ownerId');
      expect(result.blockedFields[0].preservedValue).toBe('char_001');
      expect(result.blockedFields[0].rejectedValue).toBe('char_002');
      // visible 是非黑名单字段，应更新
      expect(result.updatedFields).toHaveLength(1);
      expect(result.updatedFields[0].field).toBe('visible');
    });

    it('场景3: InventoryService.addItem 黑名单 - equippedSlot 拒绝更新', () => {
      const existing = { id: 'item_001', saveId: 'save_001', itemId: 'pool_sword', ownerId: 'char_001', ownerType: 'character', createdAt: 1000, equippedSlot: null, equippedIndex: null, quantity: 1 };
      const incoming = { id: 'item_001', saveId: 'save_001', itemId: 'pool_sword', ownerId: 'char_001', ownerType: 'character', createdAt: 1000, equippedSlot: 'main_hand', equippedIndex: 0, quantity: 3 };
      const blacklist = ['id', 'saveId', 'itemId', 'ownerId', 'ownerType', 'createdAt', 'equippedSlot', 'equippedIndex'];

      const result = computeDedupUpdate(existing, incoming, blacklist);

      expect(result.blockedFields).toHaveLength(2);
      const blockedFieldNames = result.blockedFields.map(f => f.field);
      expect(blockedFieldNames).toContain('equippedSlot');
      expect(blockedFieldNames).toContain('equippedIndex');
      // quantity 是非黑名单字段，应更新
      expect(result.updatedFields).toHaveLength(1);
      expect(result.updatedFields[0].field).toBe('quantity');
    });

    it('场景4: MapService.createLocation - isExplored/childLocationIds/connections 可更新（非黑名单）', () => {
      const existing = { id: 'loc_001', saveId: 'save_001', createdAt: 1000, locationLevel: 2, isExplored: false, childLocationIds: [], connections: [] };
      const incoming = { id: 'loc_001', saveId: 'save_001', createdAt: 1000, locationLevel: 2, isExplored: true, childLocationIds: ['loc_002'], connections: ['loc_003'] };
      const blacklist = ['id', 'saveId', 'createdAt', 'locationLevel'];

      const result = computeDedupUpdate(existing, incoming, blacklist);

      expect(result.blockedFields).toEqual([]);
      expect(result.updatedFields).toHaveLength(3);
      const updatedFieldNames = result.updatedFields.map(f => f.field);
      expect(updatedFieldNames).toContain('isExplored');
      expect(updatedFieldNames).toContain('childLocationIds');
      expect(updatedFieldNames).toContain('connections');
    });

    it('场景5: SkillService.learnSkill - level/exp 可更新（非黑名单）', () => {
      const existing = { id: 'skill_001', saveId: 'save_001', skillId: 'pool_fireball', ownerId: 'char_001', ownerType: 'character', createdAt: 1000, level: 1, exp: 0 };
      const incoming = { id: 'skill_001', saveId: 'save_001', skillId: 'pool_fireball', ownerId: 'char_001', ownerType: 'character', createdAt: 1000, level: 3, exp: 100 };
      const blacklist = ['id', 'saveId', 'skillId', 'ownerId', 'ownerType', 'createdAt'];

      const result = computeDedupUpdate(existing, incoming, blacklist);

      expect(result.blockedFields).toEqual([]);
      expect(result.updatedFields).toHaveLength(2);
      const updatedFieldNames = result.updatedFields.map(f => f.field);
      expect(updatedFieldNames).toContain('level');
      expect(updatedFieldNames).toContain('exp');
    });
  });
});
