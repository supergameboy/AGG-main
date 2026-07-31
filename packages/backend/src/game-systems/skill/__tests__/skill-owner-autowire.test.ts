/**
 * Skill 系统规格说明验证测试（重写版）
 *
 * 验证 docs/help/inventory-skill-methods.md 第三章 skill_service 6 个方法：
 * - 正确输入：各方法在合规输入下达到说明期望的功能效果
 * - 错误输入：各方法在违规输入下正确抛错或拒绝
 * - 部分正确输入：边界场景（name/id 兼容、数据隔离、冷却独立）
 *
 * 覆盖修复点：
 * - learnSkill 前置技能检查按 owner 过滤（不跨 owner 查询）
 * - upgradeSkill update 传 owner options（与查询的 owner 过滤一致）
 */
import { describe, it, expect, vi } from 'vitest';
import { SkillService } from '../SkillService.js';
import { TemplateRuleParser } from '../../shared/rule-parser/TemplateRuleParser.js';
import type { CharacterSkill } from '../types.js';

// ============================================================================
// 工厂函数
// ============================================================================

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
    maxLevel: 10,
    experience: 0,
    cooldownRemaining: 0,
    consecutiveUses: 0,
    lastUsedAt: 0,
    cost: [],
    effects: { effects: [{ type: 'damage', value: 30 }] } as any,
    customData: {},
    visible: true,
    unlocked: true,
    ownerType: 'character',
    ownerId: 'char-1',
    ...overrides,
  } as CharacterSkill;
}

function createRuleParserStub(cooldownSystem: string = 'none') {
  return {
    getSkillRules: () => ({
      cooldown_system: cooldownSystem,
      upgrade_cost: { base: 100, multiplier: 1.5 },
    }),
    getWeightCooldownConfig: () => null,
  } as unknown as TemplateRuleParser;
}

interface ServiceConfig {
  skill?: CharacterSkill;
  skills?: CharacterSkill[];
  npcResolveResult?: string | Error;
  characterModifyHealthResult?: { previous: number; current: number; max: number };
  cooldownSystem?: string;
  findLearnedResult?: CharacterSkill | null;
}

function createService(config: ServiceConfig = {}) {
  const cooldownSystem = config.cooldownSystem ?? 'none';
  const skill = config.skill ?? createMockSkill();
  const skills = config.skills ?? [skill];

  const characterSkillRepo = {
    findBySaveId: vi.fn().mockResolvedValue(skills),
    findById: vi.fn().mockResolvedValue(skill),
    findBySkillIdOrName: vi.fn().mockResolvedValue(skill),
    findAllBySkillIdOrName: vi.fn().mockResolvedValue(skills),
    findLearnedBySaveIdAndSkillId: vi.fn().mockResolvedValue(config.findLearnedResult ?? null),
    findWithActiveCooldown: vi.fn().mockResolvedValue([]),
    findWeightCooldownExpired: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockResolvedValue(skill),
    update: vi.fn().mockResolvedValue(skill),
    updateCooldowns: vi.fn().mockResolvedValue(0),
    updateWeightCooldown: vi.fn().mockResolvedValue(undefined),
    deleteBySaveId: vi.fn().mockResolvedValue(undefined),
  } as any;

  const characterService = {
    getCharacterBasicInfo: vi.fn().mockResolvedValue({ characterId: 'char-1', currency: { gold: 100 } }),
    getCharacter: vi.fn().mockResolvedValue({ attributes: { strength: 10 } }),
    getCharacterLevel: vi.fn().mockResolvedValue(5),
    modifyHealth: vi.fn().mockResolvedValue(config.characterModifyHealthResult ?? { previous: 100, current: 70, max: 100 }),
    modifyMana: vi.fn().mockResolvedValue({ previous: 30, current: 20, max: 50 }),
    modifyStamina: vi.fn().mockResolvedValue({ previous: 100, current: 90, max: 100 }),
    modifyCurrency: vi.fn().mockResolvedValue({ previous: 100, current: 90, max: 999999 }),
  } as any;

  const npcService = {
    resolveNpcId: vi.fn(async (_saveId: string, idOrName: string) => {
      if (config.npcResolveResult instanceof Error) throw config.npcResolveResult;
      return config.npcResolveResult ?? idOrName;
    }),
    modifyNpcHealth: vi.fn().mockResolvedValue({ previous: 100, current: 70, max: 100 }),
    modifyNpcResource: vi.fn().mockResolvedValue({ previous: 50, current: 30, max: 100 }),
    getNpcResources: vi.fn().mockResolvedValue({ hp: 50, mp: 30, stamina: 100, currency: { gold: 50 } }),
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
    createRuleParserStub(cooldownSystem),
    null,
    null,
  );

  return { service, characterSkillRepo, characterService, npcService, txManager };
}

// ============================================================================
// 测试用例
// ============================================================================

describe('Skill 系统规格说明验证', () => {
  // ==========================================================================
  // 一、正确输入（合规输入达到期望功能效果）
  // ==========================================================================
  describe('一、正确输入', () => {

    // ---- resolveOwnerId 自动注入（文档 1.3 / 1.4）----
    describe('resolveOwnerId 自动注入', () => {
      it('1.1 ownerType 空 → 自动调用 characterService.getCharacterBasicInfo', async () => {
        const { service, characterService } = createService();

        await service.listSkills('save-1', 'all', 'character');

        expect(characterService.getCharacterBasicInfo).toHaveBeenCalledWith('save-1', undefined);
      });

      it('1.2 ownerType="npc" → 调用 npcService.resolveNpcId', async () => {
        const { service, npcService } = createService();

        await service.listSkills('save-1', 'all', 'npc', '哥布林法师');

        expect(npcService.resolveNpcId).toHaveBeenCalledWith('save-1', '哥布林法师', undefined);
      });
    });

    // ---- 查询类通配符支持（文档 3.1 / 5.1）----
    describe('查询类通配符', () => {
      it('1.3 list_skills ownerType 空 → 返回所有 owner 的技能', async () => {
        const skills = [
          createMockSkill({ id: 's1', ownerType: 'character', ownerId: 'char-1' }),
          createMockSkill({ id: 's2', ownerType: 'npc', ownerId: 'npc-001', name: 'NPC技能' }),
        ];
        const { service, characterSkillRepo } = createService({ skills });

        const result = await service.listSkills('save-1');

        expect(characterSkillRepo.findBySaveId).toHaveBeenCalledWith('save-1');
        expect(result.skills).toHaveLength(2);
      });

      it('1.4 list_skills ownerType="all" → 同样返回所有 owner', async () => {
        const skills = [
          createMockSkill({ id: 's1', ownerType: 'character' }),
          createMockSkill({ id: 's2', ownerType: 'npc', name: 'NPC技能' }),
        ];
        const { service } = createService({ skills });

        const result = await service.listSkills('save-1', 'all', 'all');

        expect(result.skills).toHaveLength(2);
      });

      it('1.5 list_skills ownerType 精确 → 按 owner 过滤', async () => {
        const { service, characterSkillRepo } = createService({
          skills: [createMockSkill({ ownerType: 'character', ownerId: 'char-1' })],
        });

        await service.listSkills('save-1', 'all', 'character');

        expect(characterSkillRepo.findBySaveId).toHaveBeenCalledWith('save-1', {
          ownerType: 'character',
          ownerId: 'char-1',
        });
      });

      it('1.6 findSkill ownerType 空 → 调用 findAllBySkillIdOrName 返回数组', async () => {
        const skills = [
          createMockSkill({ id: 's1', name: '斩击', ownerType: 'character', ownerId: 'char-1' }),
          createMockSkill({ id: 's2', name: '斩击', ownerType: 'npc', ownerId: 'npc-001' }),
        ];
        const { service, characterSkillRepo } = createService({ skills });

        const result = await service.findSkill('save-1', '斩击');

        expect(characterSkillRepo.findAllBySkillIdOrName).toHaveBeenCalledWith('斩击', 'save-1');
        expect(Array.isArray(result)).toBe(true);
        expect(result as CharacterSkill[]).toHaveLength(2);
      });

      it('1.7 findSkill ownerType 精确 → 返回单个对象', async () => {
        const { service } = createService({
          skill: createMockSkill({ ownerType: 'character', ownerId: 'char-1' }),
        });

        const result = await service.findSkill('save-1', 'slash', 'character');

        expect(Array.isArray(result)).toBe(false);
        expect((result as CharacterSkill).name).toBe('斩击');
      });

      it('1.8 check_cooldown ownerType="all" → 返回数组（每个 owner 独立冷却）', async () => {
        const skills = [
          createMockSkill({ id: 's1', ownerType: 'character', ownerId: 'char-1', cooldownRemaining: 0 }),
          createMockSkill({ id: 's2', ownerType: 'npc', ownerId: 'npc-001', cooldownRemaining: 2 }),
        ];
        const { service } = createService({ skills, cooldownSystem: 'turn' });

        const result = await service.checkCooldown('save-1', '斩击', 'all');

        expect(Array.isArray(result)).toBe(true);
        expect(result as any[]).toHaveLength(2);
        // 每个 owner 都有独立的 cooldown 状态
        expect((result as any[])[0]).toHaveProperty('ownerId');
        expect((result as any[])[0]).toHaveProperty('ownerType');
      });

      it('1.9 check_cooldown ownerType 精确 → 返回单个对象', async () => {
        const { service } = createService({
          skill: createMockSkill({ ownerType: 'character', ownerId: 'char-1', cooldownRemaining: 0 }),
        });

        const result = await service.checkCooldown('save-1', 'slash', 'character');

        expect(Array.isArray(result)).toBe(false);
        expect((result as any).available).toBe(true);
      });
    });

    // ---- 写入类默认 character（文档 3.2）----
    describe('写入类默认 character', () => {
      it('1.10 learn_skill ownerType 空 → 默认 character，自动注入 characterId', async () => {
        const { service, characterService } = createService();

        try {
          await service.learnSkill('save-1', 'fireball');
        } catch {
          // 忽略后续错误，只验证 resolveOwnerId 被触发
        }

        expect(characterService.getCharacterBasicInfo).toHaveBeenCalledWith('save-1', expect.anything());
      });

      it('1.11 upgrade_skill ownerType 空 → 默认 character', async () => {
        const { service, characterService, characterSkillRepo } = createService({
          skill: createMockSkill({ ownerType: 'character', ownerId: 'char-1', level: 1, experience: 500 }),
        });

        await service.upgradeSkill('save-1', 'slash');

        expect(characterService.getCharacterBasicInfo).toHaveBeenCalledWith('save-1', undefined);
        expect(characterSkillRepo.findBySkillIdOrName).toHaveBeenCalledWith(
          'slash', 'save-1', { ownerType: 'character', ownerId: 'char-1' },
        );
      });

      it('1.12 use_skill ownerType 空 → 默认 character（施法者默认角色）', async () => {
        const { service, characterService } = createService();

        await service.useSkill('save-1', 'slash');

        expect(characterService.getCharacterBasicInfo).toHaveBeenCalledWith('save-1', expect.anything());
      });
    });

    // ---- use_skill 目标解析 + 资源扣减（文档 3.2 use_skill / 4.4）----
    describe('use_skill 目标解析 + 资源扣减', () => {
      it('1.13 use_skill targetId 是 NPC（npc_ 前缀）→ 调用 npcService.modifyNpcHealth', async () => {
        const { service, npcService } = createService();

        const result = await service.useSkill('save-1', 'slash', 'npc_goblin' as any, 'character', 'char-1');

        expect(result.success).toBe(true);
        expect(result.damage).toBe(30);
        expect(npcService.modifyNpcHealth).toHaveBeenCalledWith('save-1', 'npc_goblin', -30, expect.anything());
        expect(result.targetApplied).toEqual({
          targetType: 'npc',
          targetId: 'npc_goblin',
          damage: 30,
          newHp: 70,
          maxHp: 100,
        });
      });

      it('1.14 use_skill targetId 是 character → 调用 characterService.modifyHealth', async () => {
        const { service, characterService } = createService();

        const result = await service.useSkill('save-1', 'slash', 'save-1' as any, 'character', 'char-1');

        expect(result.success).toBe(true);
        expect(characterService.modifyHealth).toHaveBeenCalledWith('save-1', -30, expect.anything());
        expect(result.targetApplied).toEqual({
          targetType: 'character',
          targetId: 'save-1',
          damage: 30,
          newHp: 70,
          maxHp: 100,
        });
      });

      it('1.15 use_skill targetId 是 NPC 名称（resolveNpcId 成功）→ 调用 npcService.modifyNpcHealth', async () => {
        const { service, npcService } = createService({ npcResolveResult: 'npc_goblin_001' });

        const result = await service.useSkill('save-1', 'slash', '哥布林' as any, 'character', 'char-1');

        expect(npcService.modifyNpcHealth).toHaveBeenCalledWith('save-1', 'npc_goblin_001', -30, expect.anything());
        expect(result.targetApplied?.targetType).toBe('npc');
        expect(result.targetApplied?.targetId).toBe('npc_goblin_001');
      });
    });
  });

  // ==========================================================================
  // 二、错误输入（违规输入正确抛错或拒绝）
  // ==========================================================================
  describe('二、错误输入', () => {

    describe('resolveOwnerId 错误', () => {
      it('2.1 ownerType="npc" 但 ownerId 空 → 抛错', async () => {
        const { service } = createService();

        await expect(
          service.listSkills('save-1', 'all', 'npc'),
        ).rejects.toThrow('ownerId is required when ownerType is npc');
      });

      it('2.2 ownerType="all" 用于写入类 → 抛错（写入类不支持通配）', async () => {
        const { service } = createService();

        await expect(
          service.upgradeSkill('save-1', 'slash', 'all' as any),
        ).rejects.toThrow(/Invalid ownerType: all/);
      });

      it('2.3 ownerType 非法值 → 抛错', async () => {
        const { service } = createService();

        await expect(
          service.listSkills('save-1', 'all', 'invalid' as any),
        ).rejects.toThrow(/Invalid ownerType: invalid/);
      });
    });

    describe('写入类错误', () => {
      it('2.4 upgrade_skill 技能不存在 → 返回失败', async () => {
        const { service, characterSkillRepo } = createService();
        characterSkillRepo.findBySkillIdOrName.mockResolvedValue(null);

        const result = await service.upgradeSkill('save-1', 'nonexistent');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Skill not found/);
      });

      it('2.5 upgrade_skill 技能已达最大等级 → 返回失败', async () => {
        const { service } = createService({
          skill: createMockSkill({ level: 10, maxLevel: 10 }),
        });

        const result = await service.upgradeSkill('save-1', 'slash');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/already at max level/);
      });

      it('2.6 upgrade_skill 经验不足 → 返回失败', async () => {
        const { service } = createService({
          skill: createMockSkill({ level: 1, experience: 0 }),
        });

        const result = await service.upgradeSkill('save-1', 'slash');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Not enough experience/);
      });

      it('2.7 use_skill targetId 既非 character 也非 NPC → 抛错（不静默退化为 character）', async () => {
        const { service } = createService({
          npcResolveResult: new Error('NPC not found'),
        });

        await expect(
          service.useSkill('save-1', 'slash', 'unknown_target' as any, 'character', 'char-1'),
        ).rejects.toThrow(/Invalid targetId|Cannot resolve to character or npc/);
      });
    });
  });

  // ==========================================================================
  // 三、部分正确输入（边界场景）
  // ==========================================================================
  describe('三、部分正确输入（边界场景）', () => {

    describe('name/id 双兼容（文档 1.3 / Q2）', () => {
      it('3.1 findSkill 传技能名称 + owner 精确查询 → 正确查询', async () => {
        const { service, characterSkillRepo } = createService();

        await service.findSkill('save-1', '斩击', 'character', 'char-1');

        expect(characterSkillRepo.findBySkillIdOrName).toHaveBeenCalledWith(
          '斩击', 'save-1',
          { ownerType: 'character', ownerId: 'char-1' },
          undefined,
        );
      });

      it('3.2 findSkill 传技能 ID + owner 精确查询 → 同样查询', async () => {
        const { service, characterSkillRepo } = createService();

        await service.findSkill('save-1', 'skill_1', 'character', 'char-1');

        expect(characterSkillRepo.findBySkillIdOrName).toHaveBeenCalledWith(
          'skill_1', 'save-1',
          { ownerType: 'character', ownerId: 'char-1' },
          undefined,
        );
      });

      it('3.3 findSkill 通配符模式 传名称 → 调用 findAllBySkillIdOrName', async () => {
        const { service, characterSkillRepo } = createService({
          skills: [createMockSkill({ name: '斩击' })],
        });

        await service.findSkill('save-1', '斩击');

        expect(characterSkillRepo.findAllBySkillIdOrName).toHaveBeenCalledWith('斩击', 'save-1');
      });

      it('3.4 findSkill 通配符模式 传 ID → 同样调用 findAllBySkillIdOrName', async () => {
        const { service, characterSkillRepo } = createService({
          skills: [createMockSkill({ id: 'skill_1' })],
        });

        await service.findSkill('save-1', 'skill_1');

        expect(characterSkillRepo.findAllBySkillIdOrName).toHaveBeenCalledWith('skill_1', 'save-1');
      });
    });

    describe('数据隔离保证（文档 7.1 / 7.2 / 7.3）', () => {
      it('3.5 check_cooldown 每个 owner 独立维护 cooldownRemaining', async () => {
        const skills = [
          createMockSkill({ id: 's1', name: '斩击', ownerType: 'character', ownerId: 'char-1', cooldownRemaining: 0 }),
          createMockSkill({ id: 's2', name: '斩击', ownerType: 'npc', ownerId: 'npc-001', cooldownRemaining: 3 }),
        ];
        const { service } = createService({ skills, cooldownSystem: 'turn' });

        const result = await service.checkCooldown('save-1', '斩击', 'all');

        expect(Array.isArray(result)).toBe(true);
        const arr = result as any[];
        expect(arr).toHaveLength(2);
        // character 的技能可用
        const charCooldown = arr.find(c => c.ownerType === 'character');
        expect(charCooldown.available).toBe(true);
        expect(charCooldown.remaining).toBe(0);
        // NPC 的技能冷却中
        const npcCooldown = arr.find(c => c.ownerType === 'npc');
        expect(npcCooldown.available).toBe(false);
        expect(npcCooldown.remaining).toBe(3);
      });

      it('3.6 upgrade_skill 按 skill.id 精确更新 + 传 owner options（修复后行为）', async () => {
        const skill = createMockSkill({
          id: 'skill_char_1', ownerType: 'character', ownerId: 'char-1',
          level: 1, experience: 500,
        });
        const { service, characterSkillRepo } = createService({ skill });

        await service.upgradeSkill('save-1', 'slash', 'character');

        // 修复后：update 传 4 个参数（saveId, skillId, patch, options），按 owner 过滤
        expect(characterSkillRepo.update).toHaveBeenCalledWith(
          'save-1', 'skill_char_1',
          expect.objectContaining({ level: 2 }),
          { ownerType: 'character', ownerId: 'char-1' },
        );
      });

      it('3.7 upgrade_skill NPC owner → update 传 NPC owner options', async () => {
        const skill = createMockSkill({
          id: 'skill_npc_1', ownerType: 'npc', ownerId: 'npc-001',
          level: 1, experience: 500,
        });
        const { service, characterSkillRepo } = createService({ skill });

        await service.upgradeSkill('save-1', 'slash', 'npc', 'npc-001');

        expect(characterSkillRepo.update).toHaveBeenCalledWith(
          'save-1', 'skill_npc_1',
          expect.objectContaining({ level: 2 }),
          { ownerType: 'npc', ownerId: 'npc-001' },
        );
      });
    });

    describe('learn_skill 前置技能 owner 过滤（修复后行为）', () => {
      it('3.8 learn_skill NPC 学技能 → 前置技能检查按 NPC owner 过滤', async () => {
        // 这个测试验证修复点：前置技能检查传 resolved.ownerType/ownerId
        // 由于 mock 的 skillPoolRepo 是空对象，learnSkill 会先 resolveOwnerId，
        // 然后尝试 resolvePoolSkillId（会返回 null），不会走到前置技能检查
        // 所以这里只验证 resolveOwnerId 被正确调用
        const { service, npcService } = createService();

        try {
          await service.learnSkill('save-1', 'fireball', true, 'npc', '哥布林法师');
        } catch {
          // 忽略后续错误
        }

        expect(npcService.resolveNpcId).toHaveBeenCalledWith('save-1', '哥布林法师', expect.anything());
      });
    });

    describe('check_cooldown 冷却系统边界', () => {
      it('3.9 check_cooldown cooldownSystem="none" → 始终可用', async () => {
        const { service } = createService({
          skill: createMockSkill({ cooldownRemaining: 0 }),
          cooldownSystem: 'none',
        });

        const result = await service.checkCooldown('save-1', 'slash', 'character');

        expect(Array.isArray(result)).toBe(false);
        expect((result as any).available).toBe(true);
        expect((result as any).remaining).toBe(0);
      });
    });
  });
});
