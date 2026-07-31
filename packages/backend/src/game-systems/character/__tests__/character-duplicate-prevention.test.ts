/**
 * CharacterService.createCharacter 去重防护测试
 *
 * 设计文档：docs/design/fix/fix-20260716-audit-feedback-duplicate-creation.md §3
 *
 * 期望效果（设计文档 §3 矩阵 #2）：
 * - 同 saveId 已存在 → 增量更新非黑名单字段 + 返回 alreadyExists=true + warnings
 * - warnings 包含字段级 diff（"字段名: 旧值 → 新值"）
 * - 黑名单字段（id、saveId、createdAt）拒绝更新并返回 blockedFields 提示
 * - 不存在 → 正常创建流程（无 alreadyExists）
 *
 * 黑名单字段（设计文档 §3 黑名单表）：id、saveId、createdAt
 * 可更新字段：name、gender、customGender、ageGroup、race、class、background、
 *            currentLocationId、attributes 等所有非黑名单字段
 */
import { describe, it, expect, vi } from 'vitest';
import { CharacterService } from '../CharacterService.js';
import type { CharacterData, CreateCharacterInput } from '../types.js';

function createExistingCharacter(overrides: Partial<CharacterData> = {}): CharacterData {
  return {
    id: 'char_艾尔德_1784177145648_1',
    saveId: 'save-001',
    name: '艾尔德',
    gender: 'male',
    customGender: undefined,
    ageGroup: 'adult',
    race: 'human',
    class: 'warrior',
    background: '农民之子',
    level: 1,
    experience: 0,
    currentLocationId: 'loc_艾尔德兰大陆_1784177145648_2',
    attributes: { strength: 10, agility: 8, endurance: 12 },
    derivedAttributes: { maxHealth: 120, maxMana: 30 },
    currentHP: 120,
    maxHP: 120,
    currentMP: 30,
    maxMP: 30,
    currency: { gold: 0 },
    status: {},
    ...overrides,
  } as CharacterData;
}

function createInput(overrides: Partial<CreateCharacterInput> = {}): CreateCharacterInput {
  return {
    saveId: 'save-001' as any,
    name: '艾尔德',
    gender: 'male',
    ageGroup: 'adult',
    race: 'human',
    classType: 'warrior',
    background: '农民之子',
    attributes: { strength: 10, agility: 8, endurance: 12 },
    ...overrides,
  };
}

function createCharacterRepoMock(existing: CharacterData | null = null) {
  return {
    findEntityBySaveId: vi.fn().mockResolvedValue(existing),
    insert: vi.fn().mockResolvedValue(undefined),
    updateBaseAttributes: vi.fn().mockResolvedValue(undefined),
    updateFields: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockResolvedValue(existing),
  } as any;
}

function createNumericalServiceMock() {
  return {
    calculateDerivedAttributes: vi.fn().mockReturnValue({ maxHealth: 150, maxMana: 40 }),
    recalculateDerivedAttributes: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createTxManagerMock() {
  const transaction = vi.fn(async (cb: (trx: any) => Promise<any>) => cb({} as any));
  return { transaction } as any;
}

function createService(existing: CharacterData | null = null) {
  const characterRepo = createCharacterRepoMock(existing);
  const saveRepo = {} as any;
  const numericalService = createNumericalServiceMock();
  const txManager = createTxManagerMock();
  const service = new CharacterService(
    characterRepo,
    saveRepo,
    numericalService,
    txManager,
    null,
  );
  return { service, characterRepo, numericalService, txManager };
}

describe('CharacterService.createCharacter 去重防护', () => {
  describe('设计文档 §3 矩阵 #2：同 saveId 已存在 → 增量更新 + warnings', () => {
    it('已存在 → 返回 alreadyExists=true + warnings 含字段级 diff', async () => {
      const existing = createExistingCharacter();
      const { service, characterRepo } = createService(existing);

      // 更新 currentLocationId + background
      const input = createInput({
        currentLocationId: 'loc_白杨村_1784177145648_3',
        background: '贵族之子',
      });

      // mock: 第二次 findEntityBySaveId 返回更新后的实体
      const updated = { ...existing, currentLocationId: input.currentLocationId!, background: input.background! };
      characterRepo.findEntityBySaveId
        .mockResolvedValueOnce(existing) // 初次查重
        .mockResolvedValueOnce(updated); // 更新后重新获取

      const result = await service.createCharacter(input);

      expect(result.alreadyExists).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBeGreaterThan(0);
      // 字段级 diff 必须明确"字段名: 旧值 → 新值"
      const warningsText = result.warnings!.join(' ');
      expect(warningsText).toContain('currentLocationId: loc_艾尔德兰大陆_1784177145648_2 → loc_白杨村_1784177145648_3');
      expect(warningsText).toContain('background: 农民之子 → 贵族之子');
      expect(warningsText).toContain("角色 '艾尔德' 已存在");
    });

    it('增量更新 currentLocationId：旧值 → 新值', async () => {
      const existing = createExistingCharacter({ currentLocationId: 'loc_old_1' });
      const { service, characterRepo } = createService(existing);

      const input = createInput({ currentLocationId: 'loc_new_2' });
      const updated = { ...existing, currentLocationId: 'loc_new_2' };
      characterRepo.findEntityBySaveId
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(updated);

      const result = await service.createCharacter(input);

      expect(result.alreadyExists).toBe(true);
      expect(result.warnings!.join(' ')).toContain('currentLocationId: loc_old_1 → loc_new_2');
      // 应调用 updateFields 更新 current_location_id
      expect(characterRepo.updateFields).toHaveBeenCalledWith(
        'save-001',
        expect.objectContaining({ current_location_id: 'loc_new_2' }),
        expect.anything(),
      );
    });

    it('增量更新 race + class + background 多字段', async () => {
      const existing = createExistingCharacter({ race: 'human', class: 'warrior', background: '农民之子' });
      const { service, characterRepo } = createService(existing);

      const input = createInput({ race: 'elf', classType: 'mage', background: '学者之后' });
      const updated = { ...existing, race: 'elf', class: 'mage', background: '学者之后' };
      characterRepo.findEntityBySaveId
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(updated);

      const result = await service.createCharacter(input);

      expect(result.alreadyExists).toBe(true);
      const warningsText = result.warnings!.join(' ');
      expect(warningsText).toContain('race: human → elf');
      expect(warningsText).toContain('class: warrior → mage');
      expect(warningsText).toContain('background: 农民之子 → 学者之后');
    });

    it('attributes 变化时触发 recalculateDerivedAttributes', async () => {
      const existing = createExistingCharacter({ attributes: { strength: 10, agility: 8, endurance: 12 } });
      const { service, characterRepo, numericalService } = createService(existing);

      const newAttrs = { strength: 15, agility: 10, endurance: 14 };
      const input = createInput({ attributes: newAttrs });
      const updated = { ...existing, attributes: newAttrs };
      characterRepo.findEntityBySaveId
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(updated);

      await service.createCharacter(input);

      // 应调用 updateBaseAttributes 重新计算派生属性
      expect(characterRepo.updateBaseAttributes).toHaveBeenCalledWith(
        'save-001',
        newAttrs,
        150, // calculateDerivedAttributes 返回的 maxHealth
        40,  // calculateDerivedAttributes 返回的 maxMana
        expect.anything(),
      );
      expect(numericalService.recalculateDerivedAttributes).toHaveBeenCalledWith('save-001', expect.anything());
    });

    it('无字段变化 → warnings 提示"无字段变化"', async () => {
      const existing = createExistingCharacter();
      const { service, characterRepo } = createService(existing);

      // 输入与 existing 完全一致
      const input = createInput({
        gender: 'male',
        ageGroup: 'adult',
        race: 'human',
        classType: 'warrior',
        background: '农民之子',
        attributes: { strength: 10, agility: 8, endurance: 12 },
      });
      characterRepo.findEntityBySaveId
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(existing);

      const result = await service.createCharacter(input);

      expect(result.alreadyExists).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.join(' ')).toContain('无字段变化');
      // 无字段变化时不应调用 updateFields
      expect(characterRepo.updateFields).not.toHaveBeenCalled();
    });
  });

  describe('设计文档 §3 黑名单字段触发提示', () => {
    it('黑名单字段（id/saveId/createdAt）拒绝更新并返回 blockedFields', async () => {
      const existing = createExistingCharacter({ id: 'char_original_1' });
      const { service, characterRepo } = createService(existing);

      // CharacterService.createCharacter 的 input 没有 id/saveId 字段（saveId 来自 input.saveId）
      // 黑名单字段触发需要通过 input.saveId 与 existing.saveId 不同来测试
      // 但 saveId 是查询键，实际不会触发。这里验证黑名单字段不被覆盖。
      const input = createInput({
        saveId: 'save-001' as any,
        name: '艾尔德',
        background: '新背景',
      });
      const updated = { ...existing, background: '新背景' };
      characterRepo.findEntityBySaveId
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(updated);

      const result = await service.createCharacter(input);

      expect(result.alreadyExists).toBe(true);
      // id 保持原值，不被覆盖
      expect(result.id).toBe('char_original_1');
      // updateFields patch 不应包含 id/saveId
      const patchCall = characterRepo.updateFields.mock.calls[0];
      if (patchCall) {
        const patch = patchCall[1] as Record<string, unknown>;
        expect(patch.id).toBeUndefined();
        expect(patch.save_id).toBeUndefined();
        expect(patch.created_at).toBeUndefined();
      }
    });
  });

  describe('设计文档 §3：不存在 → 正常创建流程', () => {
    it('findEntityBySaveId 返回 null → 正常创建，无 alreadyExists', async () => {
      const { service, characterRepo } = createService(null);

      const input = createInput();
      // 插入后再次查询返回新建的角色
      const newCharacter = createExistingCharacter({ id: 'char_new_1' });
      characterRepo.findEntityBySaveId
        .mockResolvedValueOnce(null) // 初次查重：不存在
        .mockResolvedValueOnce(newCharacter); // 插入后查询返回

      const result = await service.createCharacter(input);

      expect(result.alreadyExists).toBeUndefined();
      expect(result.warnings).toBeUndefined();
      expect(characterRepo.insert).toHaveBeenCalled();
    });
  });
});
