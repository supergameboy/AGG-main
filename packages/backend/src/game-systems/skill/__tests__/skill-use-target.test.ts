/**
 * P0 修复测试：use_skill.targetId 应用伤害到目标 HP
 *
 * 偏差背景：
 * - schema 接受 targetId 参数（描述「目标ID(可选，战斗中使用)」）
 * - handler 把 targetId 传入 service.useSkill(saveId, skillId, targetId, ...)
 * - SkillService.useSkill 函数签名 `_targetId`（下划线前缀=未使用）
 * - damage 计算后只放进返回值，未 apply 到目标 HP
 * - LLM 传 targetId 期望技能作用于目标，实际等于没传
 *
 * 修复方案：
 * - 移除 `_targetId` 下划线前缀，让 useSkill 真正使用 targetId
 * - 传入 targetId 时按 ID 前缀区分 character/npc：
 *   - 'npc_' 开头或能 resolveNpcId → NPC，调用 npcService.modifyNpcHealth
 *   - 否则 → character，调用 characterService.modifyHealth
 * - 返回值新增 targetApplied 字段
 *
 * 测试场景：
 * - T1: targetId 不传 → 不调用 modifyHealth/modifyNpcHealth，返回值无 targetApplied
 * - T2: targetId = 'npc_xxx' → 调用 npcService.modifyNpcHealth，delta = -damage
 * - T3: targetId = saveId（character 自己）→ 调用 characterService.modifyHealth
 * - T4: targetId 是 NPC 名称（resolveNpcId 成功解析为 NPC）→ 调用 npcService.modifyNpcHealth
 */
import { describe, it, expect, vi } from 'vitest';
import { SkillService } from '../SkillService.js';
import { TemplateRuleParser } from '../../shared/rule-parser/TemplateRuleParser.js';
import type { CharacterSkill } from '../types.js';

function createMockSkill(overrides: Partial<CharacterSkill> = {}): CharacterSkill {
  return {
    id: 'skill_1',
    saveId: 'save-1',
    skillId: 'slash',
    name: '斩击',
    description: '物理攻击',
    category: 'attack',
    element: 'physical' as any,
    level: 1,
    cooldownRemaining: 0,
    cooldownType: 'turn' as any,
    consecutiveUses: 0,
    lastUsedAt: 0,
    cost: [],  // 无消耗，简化测试路径
    effects: { effects: [{ type: 'damage', value: 30 }] } as any,
    customData: {},
    visible: true,
    ownerType: 'character',
    ownerId: 'char-1',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as CharacterSkill;
}

function createRuleParserStub() {
  return {
    getSkillRules: () => ({
      cooldown_system: 'none',
      upgrade_cost: { base: 100, multiplier: 1.5 },
    }),
    getWeightCooldownConfig: () => null,
  } as unknown as TemplateRuleParser;
}

function createService(overrides: {
  npcResolveResult?: string | Error;
  characterModifyHealthResult?: { previous: number; current: number; max: number };
  npcModifyHealthResult?: { previous: number; current: number; max: number };
  skill?: CharacterSkill;
} = {}) {
  const skill = overrides.skill ?? createMockSkill();
  const characterSkillRepo = {
    findById: vi.fn().mockResolvedValue(skill),
    findBySkillIdOrName: vi.fn().mockResolvedValue(skill),
    update: vi.fn().mockResolvedValue(undefined),
  } as any;

  const characterModifyHealthResult = overrides.characterModifyHealthResult ?? { previous: 100, current: 70, max: 100 };
  const npcModifyHealthResult = overrides.npcModifyHealthResult ?? { previous: 100, current: 70, max: 100 };

  const characterService = {
    getCharacterBasicInfo: vi.fn().mockResolvedValue({ characterId: 'char-1', currency: { gold: 100 } }),
    getCharacter: vi.fn().mockResolvedValue({ attributes: { strength: 10 } }),
    modifyHealth: vi.fn().mockResolvedValue(characterModifyHealthResult),
  } as any;

  const npcService = {
    resolveNpcId: vi.fn(async (_saveId: string, idOrName: string) => {
      if (overrides.npcResolveResult instanceof Error) {
        throw overrides.npcResolveResult;
      }
      return overrides.npcResolveResult ?? idOrName;
    }),
    modifyNpcHealth: vi.fn().mockResolvedValue(npcModifyHealthResult),
  } as any;

  const txManager = {
    transaction: vi.fn(async (cb: (trx: any) => Promise<any>) => cb({} as any)),
  } as any;

  const service = new SkillService(
    {} as any,  // skillPoolRepo
    characterSkillRepo,
    characterService,
    npcService,
    {} as any,  // inventoryService
    {} as any,  // saveRepo
    txManager,
    createRuleParserStub(),
    null,  // templateService（让 damage 走 customData 分支）
    null,  // templatePoolService
  );

  return { service, characterService, npcService, characterSkillRepo, txManager };
}

describe('P0 修复：use_skill.targetId 应用伤害到目标 HP', () => {
  describe('T1: targetId 不传 → 不应用伤害', () => {
    it('useSkill 不传 targetId → modifyHealth/modifyNpcHealth 不被调用', async () => {
      const { service, characterService, npcService } = createService();

      const result = await service.useSkill('save-1', 'slash', undefined, 'character', 'char-1');

      expect(result.success).toBe(true);
      expect(result.damage).toBe(30);  // effects damage
      expect(result.targetApplied).toBeUndefined();
      expect(characterService.modifyHealth).not.toHaveBeenCalled();
      expect(npcService.modifyNpcHealth).not.toHaveBeenCalled();
    });
  });

  describe('T2: targetId 是 NPC（npc_ 前缀）→ 调用 modifyNpcHealth', () => {
    it('targetId="npc_goblin" → npcService.modifyNpcHealth 被调用，delta=-30', async () => {
      const { service, npcService } = createService();

      const result = await service.useSkill('save-1', 'slash', 'npc_goblin' as any, 'character', 'char-1');

      expect(result.success).toBe(true);
      expect(result.damage).toBe(30);
      expect(npcService.modifyNpcHealth).toHaveBeenCalledTimes(1);
      const [saveId, npcId, delta] = npcService.modifyNpcHealth.mock.calls[0];
      expect(saveId).toBe('save-1');
      expect(npcId).toBe('npc_goblin');
      expect(delta).toBe(-30);
      expect(result.targetApplied).toEqual({
        targetType: 'npc',
        targetId: 'npc_goblin',
        damage: 30,
        newHp: 70,
        maxHp: 100,
      });
    });
  });

  describe('T3: targetId 是 character（saveId）→ 调用 modifyHealth', () => {
    it('targetId="save-1" → characterService.modifyHealth 被调用', async () => {
      const { service, characterService } = createService();

      const result = await service.useSkill('save-1', 'slash', 'save-1' as any, 'character', 'char-1');

      expect(result.success).toBe(true);
      expect(characterService.modifyHealth).toHaveBeenCalledTimes(1);
      const [saveId, delta] = characterService.modifyHealth.mock.calls[0];
      expect(saveId).toBe('save-1');
      expect(delta).toBe(-30);
      expect(result.targetApplied).toEqual({
        targetType: 'character',
        targetId: 'save-1',
        damage: 30,
        newHp: 70,
        maxHp: 100,
      });
    });
  });

  describe('T4: targetId 是 NPC 名称（resolveNpcId 成功）→ 调用 modifyNpcHealth', () => {
    it('targetId="哥布林" 且 resolveNpcId 成功 → modifyNpcHealth 被调用', async () => {
      const { service, npcService } = createService({
        npcResolveResult: 'npc_goblin_001',
      });

      const result = await service.useSkill('save-1', 'slash', '哥布林' as any, 'character', 'char-1');

      expect(result.success).toBe(true);
      expect(npcService.modifyNpcHealth).toHaveBeenCalledTimes(1);
      const [, npcId, delta] = npcService.modifyNpcHealth.mock.calls[0];
      expect(npcId).toBe('npc_goblin_001');  // 使用 resolveNpcId 解析后的真实 ID
      expect(delta).toBe(-30);
      expect(result.targetApplied?.targetType).toBe('npc');
    });

    it('targetId="未知目标" 且 resolveNpcId 失败 → 抛错暴露无效目标（禁止静默退化为 character）', async () => {
      const { service, characterService, npcService } = createService({
        npcResolveResult: new Error('NPC not found'),
      });

      await expect(
        service.useSkill('save-1', 'slash', '未知目标' as any, 'character', 'char-1'),
      ).rejects.toThrow('Invalid targetId: 未知目标');

      // resolveNpcId 失败即无效目标，不静默退化为 character（fallback 掩盖缺陷）
      expect(npcService.modifyNpcHealth).not.toHaveBeenCalled();
      expect(characterService.modifyHealth).not.toHaveBeenCalled();
    });
  });
});
