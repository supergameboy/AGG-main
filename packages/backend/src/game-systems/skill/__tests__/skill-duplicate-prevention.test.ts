/**
 * SkillService 去重防护测试（addPoolSkill + learnSkill）
 *
 * 设计文档：docs/design/fix/fix-20260716-audit-feedback-duplicate-creation.md §3
 *
 * 期望效果（设计文档 §3 矩阵 #4 + #5）：
 * - addPoolSkill: 同 saveId+name 已存在 → 增量更新非黑名单字段 + alreadyExists=true + warnings
 * - learnSkill: 同 saveId+ownerId+skillId 已学习 → 增量更新 visible/level/exp + alreadyLearned=true + warnings
 * - warnings 包含字段级 diff（"字段名: 旧值 → 新值"）
 * - learnSkill 的 level、exp 可更新（非黑名单字段）
 * - 黑名单字段拒绝更新
 *
 * 黑名单字段（设计文档 §3 黑名单表）：
 * - addPoolSkill: id、saveId、skillId、createdAt
 * - learnSkill: id、saveId、skillId、ownerId、ownerType、createdAt
 */
import { describe, it, expect, vi } from 'vitest';
import { SkillService } from '../SkillService.js';
import type { SkillPoolEntry, CharacterSkill } from '../types.js';

function createExistingPoolSkill(overrides: Partial<SkillPoolEntry> = {}): SkillPoolEntry {
  return {
    id: 'pool_火球术_1784177145648_1',
    saveId: 'save-001',
    name: '火球术',
    description: '发射一颗火球',
    category: 'attack',
    element: 'fire',
    cost: [],
    damage: { base: 50 },
    effects: [],
    cooldown: 3,
    maxLevel: 10,
    targetType: 'single',
    range: 5,
    learned: false,
    customData: {},
    recommendedClasses: ['mage'],
    ...overrides,
  } as SkillPoolEntry;
}

function createExistingLearnedSkill(overrides: Partial<CharacterSkill> = {}): CharacterSkill {
  return {
    id: 'skill_火球术_1784177145648_1',
    saveId: 'save-001',
    skillId: 'pool_火球术_1784177145648_1',
    name: '火球术',
    description: '发射一颗火球',
    level: 1,
    maxLevel: 10,
    experience: 0,
    cooldownRemaining: 0,
    category: 'attack',
    element: 'fire',
    cost: [],
    effects: { effects: [] },
    customData: {},
    unlocked: true,
    visible: false,
    ownerType: 'character',
    ownerId: 'char_1',
    consecutiveUses: 0,
    lastUsedAt: 0,
    ...overrides,
  } as CharacterSkill;
}

function createSkillPoolRepoMock(existing: SkillPoolEntry | null = null) {
  return {
    findByName: vi.fn().mockResolvedValue(existing),
    findById: vi.fn().mockResolvedValue(existing),
    findByIdOrName: vi.fn().mockResolvedValue(existing),
    insert: vi.fn().mockResolvedValue(existing),
    update: vi.fn().mockResolvedValue(undefined),
    updateLearned: vi.fn().mockResolvedValue(undefined),
    findBySaveId: vi.fn().mockResolvedValue(existing ? [existing] : []),
    delete: vi.fn().mockResolvedValue(true),
  } as any;
}

function createCharacterSkillRepoMock(existing: CharacterSkill | null = null) {
  return {
    findLearnedBySaveIdAndSkillId: vi.fn().mockResolvedValue(existing),
    findById: vi.fn().mockResolvedValue(existing),
    insert: vi.fn().mockResolvedValue(existing),
    update: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createCharacterServiceMock() {
  return {
    getCharacterBasicInfo: vi.fn().mockResolvedValue({ characterId: 'char_1', attributes: {}, currency: {} }),
    getCharacterLevel: vi.fn().mockResolvedValue(5),
  } as any;
}

function createTxManagerMock() {
  const transaction = vi.fn(async (cb: (trx: any) => Promise<any>) => cb({} as any));
  return { transaction } as any;
}

function createSkillService(
  existingPool: SkillPoolEntry | null = null,
  existingLearned: CharacterSkill | null = null,
) {
  const skillPoolRepo = createSkillPoolRepoMock(existingPool);
  const characterSkillRepo = createCharacterSkillRepoMock(existingLearned);
  const characterService = createCharacterServiceMock();
  const npcService = {
    resolveNpcId: vi.fn().mockResolvedValue('npc_1'),
  } as any;
  const inventoryService = {} as any;
  const saveRepo = {
    getTemplateIdBySaveId: vi.fn().mockResolvedValue(null),
  } as any;
  const txManager = createTxManagerMock();
  const ruleParser = {} as any;
  const templateService = null;
  const templatePoolService = null;

  const service = new SkillService(
    skillPoolRepo,
    characterSkillRepo,
    characterService,
    npcService,
    inventoryService,
    saveRepo,
    txManager,
    ruleParser,
    templateService,
    templatePoolService,
  );
  return { service, skillPoolRepo, characterSkillRepo, characterService, npcService, txManager };
}

describe('SkillService 去重防护', () => {
  describe('addPoolSkill: 设计文档 §3 矩阵 #4 - 同 saveId+name 已存在 → 增量更新', () => {
    it('已存在 → 返回 alreadyExists=true + warnings 含字段级 diff', async () => {
      const existing = createExistingPoolSkill({
        description: '旧描述',
        cooldown: 3,
        damage: { base: 50 },
      });
      const { service, skillPoolRepo } = createSkillService(existing);

      const input = {
        name: '火球术',
        description: '发射一颗更猛烈的火球',
        cooldown: 5,
        damage: { base: 80 },
      };

      const updated = { ...existing, description: '发射一颗更猛烈的火球', cooldown: 5, damage: { base: 80 } };
      skillPoolRepo.findById.mockResolvedValue(updated);

      const result = await service.addPoolSkill('save-001' as any, input);

      expect(result.alreadyExists).toBe(true);
      expect(result.warnings).toBeDefined();
      const warningsText = result.warnings!.join(' ');
      expect(warningsText).toContain("技能池 '火球术' 已存在");
      expect(warningsText).toContain('description: 旧描述 → 发射一颗更猛烈的火球');
      expect(warningsText).toContain('cooldown: 3 → 5');
      expect(warningsText).toContain('damage:');
    });

    it('增量更新 description + category + cooldown 多字段', async () => {
      const existing = createExistingPoolSkill({
        description: '旧',
        category: 'attack',
        cooldown: 3,
      });
      const { service, skillPoolRepo } = createSkillService(existing);

      const input = {
        name: '火球术',
        description: '新',
        category: 'defense',
        cooldown: 10,
      };

      const updated = { ...existing, description: '新', category: 'defense', cooldown: 10 };
      skillPoolRepo.findById.mockResolvedValue(updated);

      const result = await service.addPoolSkill('save-001' as any, input);

      expect(result.alreadyExists).toBe(true);
      const warningsText = result.warnings!.join(' ');
      expect(warningsText).toContain('description: 旧 → 新');
      expect(warningsText).toContain('category: attack → defense');
      expect(warningsText).toContain('cooldown: 3 → 10');
    });

    it('无字段变化 → warnings 提示"无字段变化"', async () => {
      const existing = createExistingPoolSkill({
        description: '不变',
        cooldown: 3,
        category: 'attack',
        element: 'fire',
      });
      const { service, skillPoolRepo } = createSkillService(existing);

      const input = {
        name: '火球术',
        description: '不变',
        cooldown: 3,
        category: 'attack',
        element: 'fire',
      };

      const updated = { ...existing };
      skillPoolRepo.findById.mockResolvedValue(updated);

      const result = await service.addPoolSkill('save-001' as any, input);

      expect(result.alreadyExists).toBe(true);
      expect(result.warnings!.join(' ')).toContain('无字段变化');
      // 无字段变化时不应调用 update
      expect(skillPoolRepo.update).not.toHaveBeenCalled();
    });

    it('不存在 → 正常创建流程，无 alreadyExists', async () => {
      const { service, skillPoolRepo } = createSkillService(null);

      const input = {
        name: '新技能',
        description: '全新技能',
        category: 'attack',
      };

      const newSkill = createExistingPoolSkill({ id: 'pool_新技能_1', name: '新技能' });
      skillPoolRepo.insert.mockResolvedValue(newSkill);

      const result = await service.addPoolSkill('save-001' as any, input);

      expect(result.alreadyExists).toBeUndefined();
      expect(skillPoolRepo.insert).toHaveBeenCalled();
    });
  });

  describe('learnSkill: 设计文档 §3 矩阵 #5 - 同 saveId+ownerId+skillId 已学习 → 增量更新', () => {
    it('已学习 → 返回 alreadyLearned=true + warnings 含字段级 diff（visible）', async () => {
      const existingPool = createExistingPoolSkill({ id: 'pool_火球术_1' });
      const existingLearned = createExistingLearnedSkill({
        skillId: 'pool_火球术_1',
        visible: false,
      });

      const { service, skillPoolRepo, characterSkillRepo, characterService } = createSkillService(existingPool, existingLearned);

      // learnSkill 内部会调用 resolvePoolSkillId → skillPoolRepo.findByIdOrName
      // 然后调用 getPoolSkill → skillPoolRepo.findById
      // 然后调用 findLearnedBySaveIdAndSkillId → characterSkillRepo.findLearnedBySaveIdAndSkillId
      const updatedLearned = { ...existingLearned, visible: true };
      characterSkillRepo.findLearnedBySaveIdAndSkillId.mockResolvedValue(existingLearned);
      characterSkillRepo.findById.mockResolvedValue(updatedLearned);

      // visible=true 更新
      const result = await service.learnSkill('save-001' as any, 'pool_火球术_1', true, 'character', 'char_1');

      expect(result.success).toBe(true);
      expect(result.alreadyLearned).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.join(' ')).toContain('visible: false → true');
      expect(result.warnings!.join(' ')).toContain("技能 '火球术' 已存在");
    });

    it('learnSkill level + exp 可更新（非黑名单字段）', async () => {
      const existingPool = createExistingPoolSkill({ id: 'pool_火球术_1' });
      const existingLearned = createExistingLearnedSkill({
        skillId: 'pool_火球术_1',
        level: 1,
        experience: 0,
        visible: true,
      });

      const { service, characterSkillRepo } = createSkillService(existingPool, existingLearned);

      const updatedLearned = { ...existingLearned, level: 3, experience: 500 };
      characterSkillRepo.findLearnedBySaveIdAndSkillId.mockResolvedValue(existingLearned);
      characterSkillRepo.findById.mockResolvedValue(updatedLearned);

      // fullParams 传入 level + exp
      const result = await service.learnSkill(
        'save-001' as any,
        'pool_火球术_1',
        true,
        'character',
        'char_1',
        { level: 3, exp: 500 },
      );

      expect(result.success).toBe(true);
      expect(result.alreadyLearned).toBe(true);
      const warningsText = result.warnings!.join(' ');
      expect(warningsText).toContain('level: 1 → 3');
      expect(warningsText).toContain('experience: 0 → 500');
    });

    it('learnSkill visible + level 同时更新', async () => {
      const existingPool = createExistingPoolSkill({ id: 'pool_火球术_1' });
      const existingLearned = createExistingLearnedSkill({
        skillId: 'pool_火球术_1',
        visible: false,
        level: 1,
      });

      const { service, characterSkillRepo } = createSkillService(existingPool, existingLearned);

      const updatedLearned = { ...existingLearned, visible: true, level: 5 };
      characterSkillRepo.findLearnedBySaveIdAndSkillId.mockResolvedValue(existingLearned);
      characterSkillRepo.findById.mockResolvedValue(updatedLearned);

      const result = await service.learnSkill(
        'save-001' as any,
        'pool_火球术_1',
        true, // visible: false → true
        'character',
        'char_1',
        { level: 5 },
      );

      expect(result.alreadyLearned).toBe(true);
      const warningsText = result.warnings!.join(' ');
      expect(warningsText).toContain('visible: false → true');
      expect(warningsText).toContain('level: 1 → 5');
    });

    it('learnSkill 无字段变化 → warnings 提示', async () => {
      const existingPool = createExistingPoolSkill({ id: 'pool_火球术_1' });
      const existingLearned = createExistingLearnedSkill({
        skillId: 'pool_火球术_1',
        visible: true,
        level: 1,
        experience: 0,
      });

      const { service, characterSkillRepo } = createSkillService(existingPool, existingLearned);

      characterSkillRepo.findLearnedBySaveIdAndSkillId.mockResolvedValue(existingLearned);
      characterSkillRepo.findById.mockResolvedValue(existingLearned);

      // 不传 level/exp，visible=true 与 existing 一致
      const result = await service.learnSkill(
        'save-001' as any,
        'pool_火球术_1',
        true,
        'character',
        'char_1',
      );

      expect(result.alreadyLearned).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.join(' ')).toContain('无字段变化');
    });
  });
});
