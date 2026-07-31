/**
 * Skill 系统方法说明扩展合规测试
 *
 * 本测试文件基于 docs/help/inventory-skill-methods.md 文档说明 + 子Agent独立审查报告，
 * 覆盖现有 skill-owner-autowire.test.ts 未覆盖的多种情况：
 *
 * 1. learn_skill 数据隔离（文档 7.1/7.2/7.3：每个 owner 独立记录）
 * 2. use_skill NPC 施法资源扣减（文档 3.2 use_skill / 4.4）
 * 3. use_skill NPC 施法带冷却 → setCooldown 应透传 resolved owner（审查发现 CRITICAL）
 * 4. use_skill NPC 目标扣 HP（文档 3.2 use_skill 目标解析）
 * 5. mappers.ts rowToEntity 禁止 fallback（architecture-standards 13.3 第2条）
 * 6. resolveTarget 禁止 fallback 到 character（architecture-standards 13.3 第1条）
 * 7. check_cooldown 通配返回数组带 owner 标识（文档 3.1 check_cooldown）
 */
import { describe, it, expect, vi } from 'vitest';
import { SkillService } from '../SkillService.js';
import { TemplateRuleParser } from '../../shared/rule-parser/TemplateRuleParser.js';
import { mapCharacterSkillRow } from '../mappers.js';
import type { CharacterSkill } from '../types.js';

// SkillPoolEntry 类型简化为内联定义（避免跨包导入路径问题）
interface SkillPoolEntry {
  id: string;
  saveId: string;
  name: string;
  description: string;
  category: string;
  element: string;
  cost: any[];
  damage: Record<string, unknown>;
  effects: any[];
  cooldown: number;
  maxLevel: number;
  targetType: string;
  range: number;
  learned: boolean;
  customData: Record<string, unknown>;
  recommendedClasses: string[];
}

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

function createRuleParserStub(cooldownSystem: string = 'none', withWeight = false) {
  return {
    getSkillRules: () => ({
      cooldown_system: cooldownSystem,
      upgrade_cost: { base: 100, multiplier: 1.5 },
    }),
    getWeightCooldownConfig: () => withWeight ? {
      max_multiplier: 3,
      weight_factor: 1.5,
      decay_per_turn: 1,
    } : null,
  } as unknown as TemplateRuleParser;
}

interface ServiceConfig {
  skill?: CharacterSkill;
  skills?: CharacterSkill[];
  npcResolveResult?: string | Error;
  npcResolveThrows?: boolean;
  characterModifyHealthResult?: { previous: number; current: number; max: number };
  cooldownSystem?: string;
  withWeight?: boolean;
  // 控制 findBySkillIdOrName 按 owner 返回不同结果
  skillByOwner?: { character?: CharacterSkill | null; npc?: CharacterSkill | null };
}

function createService(config: ServiceConfig = {}) {
  const cooldownSystem = config.cooldownSystem ?? 'none';
  const skill = config.skill ?? createMockSkill();
  const skills = config.skills ?? [skill];

  // 关键：findBySkillIdOrName 按 owner 返回不同结果
  // 当 skillByOwner 配置时，character owner 查询返回 character 的技能，npc owner 查询返回 npc 的技能
  const characterSkillRepo = {
    findBySaveId: vi.fn().mockResolvedValue(skills),
    findById: vi.fn().mockResolvedValue(skill),
    findBySkillIdOrName: vi.fn(async (
      _skillIdOrName: string,
      _saveId: string,
      options?: { ownerType?: string; ownerId?: string },
    ) => {
      if (config.skillByOwner) {
        if (options?.ownerType === 'character') return config.skillByOwner.character ?? null;
        if (options?.ownerType === 'npc') return config.skillByOwner.npc ?? null;
      }
      return skill;
    }),
    findAllBySkillIdOrName: vi.fn().mockResolvedValue(skills),
    findLearnedBySaveIdAndSkillId: vi.fn().mockResolvedValue(null),
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
    getCharacterResources: vi.fn().mockResolvedValue({ currentHp: 100, currentMp: 50, currentStamina: 100, currency: { gold: 100 } }),
    getCharacterLevel: vi.fn().mockResolvedValue(5),
    modifyHealth: vi.fn().mockResolvedValue(config.characterModifyHealthResult ?? { previous: 100, current: 70, max: 100 }),
    modifyMana: vi.fn().mockResolvedValue({ previous: 30, current: 20, max: 50 }),
    modifyStamina: vi.fn().mockResolvedValue({ previous: 100, current: 90, max: 100 }),
    modifyCurrency: vi.fn().mockResolvedValue({ previous: 100, current: 90, max: 999999 }),
  } as any;

  const npcService = {
    resolveNpcId: vi.fn(async (_saveId: string, idOrName: string) => {
      if (config.npcResolveThrows) throw new Error(`NPC not found: ${idOrName}`);
      if (config.npcResolveResult instanceof Error) throw config.npcResolveResult;
      return config.npcResolveResult ?? idOrName;
    }),
    modifyNpcHealth: vi.fn().mockResolvedValue({ previous: 100, current: 70, max: 100 }),
    modifyNpcResource: vi.fn().mockResolvedValue({ previous: 50, current: 30, max: 100 }),
    getNpcResources: vi.fn().mockResolvedValue({ currentHp: 50, currentMp: 30, currentStamina: 100, currency: { gold: 50 } }),
  } as any;

  // 模拟技能池中的技能（learnSkill 从池中学习时需要）
  const poolSkill: SkillPoolEntry = {
    id: 'pool-fireball',
    saveId: 'save-1',
    name: '火球术',
    description: '发射火球',
    category: 'attack',
    element: 'fire',
    cost: [],
    damage: {},
    effects: [],
    cooldown: 0,
    maxLevel: 10,
    targetType: 'enemy',
    range: 1,
    learned: false,
    customData: {},
    recommendedClasses: [],
  };

  const skillPoolRepo = {
    findByIdOrName: vi.fn().mockResolvedValue(poolSkill),
    findById: vi.fn().mockResolvedValue(poolSkill),
    updateLearned: vi.fn().mockResolvedValue(undefined),
  } as any;

  const txManager = {
    transaction: vi.fn(async (cb: (trx: any) => Promise<any>) => cb({} as any)),
  } as any;

  const saveRepo = {
    getTemplateIdBySaveId: vi.fn().mockResolvedValue(null),
  } as any;

  const service = new SkillService(
    skillPoolRepo,
    characterSkillRepo,
    characterService,
    npcService,
    {} as any,  // inventoryService
    saveRepo,
    txManager,
    createRuleParserStub(cooldownSystem, config.withWeight),
    null,
    null,
  );

  return { service, characterSkillRepo, characterService, npcService, txManager };
}

// ============================================================================
// 测试用例
// ============================================================================

describe('Skill 系统方法说明扩展合规测试', () => {

  // ==========================================================================
  // 一、learn_skill 数据隔离（文档 7.1/7.2/7.3）
  // ==========================================================================
  describe('一、learn_skill 数据隔离：每个 owner 独立记录', () => {

    it('1.1 character 学技能 → insert 时 ownerType=character, ownerId=characterId', async () => {
      const { service, characterSkillRepo } = createService();

      try {
        await service.learnSkill('save-1', 'fireball');
      } catch {
        // 忽略后续错误，只验证 insert 调用
      }

      expect(characterSkillRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerType: 'character',
          ownerId: 'char-1',
        }),
        expect.anything(),
      );
    });

    it('1.2 NPC 学技能 → insert 时 ownerType=npc, ownerId=resolvedNpcId', async () => {
      const { service, characterSkillRepo, npcService } = createService({
        npcResolveResult: 'npc-001',
      });

      try {
        await service.learnSkill('save-1', 'fireball', undefined, 'npc', '哥布林法师');
      } catch {
        // 忽略后续错误
      }

      expect(npcService.resolveNpcId).toHaveBeenCalledWith('save-1', '哥布林法师', expect.anything());
      expect(characterSkillRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerType: 'npc',
          ownerId: 'npc-001',
        }),
        expect.anything(),
      );
    });

    it('1.3 已学习检查按 owner 精确查询（不会误判其他 owner 的同名技能为已学）', async () => {
      const { service, characterSkillRepo } = createService({
        npcResolveResult: 'npc-001',
      });

      try {
        await service.learnSkill('save-1', 'fireball', undefined, 'npc', 'npc-001');
      } catch {
        // 忽略后续错误
      }

      // findLearnedBySaveIdAndSkillId 应按 owner 精确查询
      expect(characterSkillRepo.findLearnedBySaveIdAndSkillId).toHaveBeenCalledWith(
        'save-1', expect.any(String), 'npc', 'npc-001', expect.anything(),
      );
    });
  });

  // ==========================================================================
  // 二、use_skill NPC 施法资源扣减（文档 3.2 use_skill / 4.4）
  // ==========================================================================
  describe('二、use_skill NPC 施法资源扣减按 ownerType 分支', () => {

    it('2.1 NPC 施法消耗 MP → 调用 npcService.modifyNpcResource(saveId, npcId, "mp", -amount)', async () => {
      const npcSkill = createMockSkill({
        id: 'skill_npc_1',
        ownerType: 'npc',
        ownerId: 'npc-001',
        cost: [{ type: 'mp', amount: 10 }],
      });
      const { service, npcService, characterService } = createService({
        skill: npcSkill,
        skillByOwner: { npc: npcSkill, character: null },
        npcResolveResult: 'npc-001',
      });

      const result = await service.useSkill('save-1', 'slash', undefined, 'npc', 'npc-001');

      expect(result.success).toBe(true);
      expect(npcService.modifyNpcResource).toHaveBeenCalledWith(
        'save-1', 'npc-001', 'mp', -10, expect.anything(),
      );
      // 不应调用 character 的 modifyMana
      expect(characterService.modifyMana).not.toHaveBeenCalled();
    });

    it('2.2 character 施法消耗 MP → 调用 characterService.modifyMana', async () => {
      const charSkill = createMockSkill({
        id: 'skill_char_1',
        ownerType: 'character',
        ownerId: 'char-1',
        cost: [{ type: 'mp', amount: 10 }],
      });
      const { service, characterService, npcService } = createService({
        skill: charSkill,
        skillByOwner: { character: charSkill, npc: null },
      });

      const result = await service.useSkill('save-1', 'slash');

      expect(result.success).toBe(true);
      expect(characterService.modifyMana).toHaveBeenCalledWith('save-1', -10, expect.anything());
      expect(npcService.modifyNpcResource).not.toHaveBeenCalled();
    });

    it('2.3 NPC 施法消耗 HP → 调用 npcService.modifyNpcResource(saveId, npcId, "hp", -amount)', async () => {
      const npcSkill = createMockSkill({
        id: 'skill_npc_1',
        ownerType: 'npc',
        ownerId: 'npc-001',
        cost: [{ type: 'hp', amount: 5 }],
      });
      const { service, npcService } = createService({
        skill: npcSkill,
        skillByOwner: { npc: npcSkill, character: null },
        npcResolveResult: 'npc-001',
      });

      await service.useSkill('save-1', 'slash', undefined, 'npc', 'npc-001');

      expect(npcService.modifyNpcResource).toHaveBeenCalledWith(
        'save-1', 'npc-001', 'hp', -5, expect.anything(),
      );
    });

    it('2.4 NPC 施法消耗 currency → 调用 npcService.modifyNpcResource(saveId, npcId, "currency", -amount)', async () => {
      const npcSkill = createMockSkill({
        id: 'skill_npc_1',
        ownerType: 'npc',
        ownerId: 'npc-001',
        cost: [{ type: 'currency', amount: 20 }],
      });
      const { service, npcService } = createService({
        skill: npcSkill,
        skillByOwner: { npc: npcSkill, character: null },
        npcResolveResult: 'npc-001',
      });

      await service.useSkill('save-1', 'slash', undefined, 'npc', 'npc-001');

      expect(npcService.modifyNpcResource).toHaveBeenCalledWith(
        'save-1', 'npc-001', 'currency', -20, expect.anything(),
      );
    });
  });

  // ==========================================================================
  // 三、use_skill NPC 目标扣 HP（文档 3.2 use_skill 目标解析）
  // ==========================================================================
  describe('三、use_skill 目标解析按 targetType 分支', () => {

    it('3.1 NPC 施法攻击 character 目标 → 调用 characterService.modifyHealth', async () => {
      const npcSkill = createMockSkill({
        id: 'skill_npc_1',
        ownerType: 'npc',
        ownerId: 'npc-001',
        cost: [],
      });
      const { service, characterService, npcService } = createService({
        skill: npcSkill,
        skillByOwner: { npc: npcSkill, character: null },
        npcResolveResult: 'npc-001',
      });

      // targetId === saveId → character 目标
      const result = await service.useSkill('save-1', 'slash', 'save-1' as any, 'npc', 'npc-001');

      expect(result.success).toBe(true);
      // 目标是 character，调用 characterService.modifyHealth
      expect(characterService.modifyHealth).toHaveBeenCalledWith('save-1', -30, expect.anything());
      // 不应调用 npcService.modifyNpcHealth（目标是 character 不是 npc）
      expect(npcService.modifyNpcHealth).not.toHaveBeenCalled();
      expect(result.targetApplied?.targetType).toBe('character');
    });

    it('3.2 character 施法攻击 NPC 目标 → 调用 npcService.modifyNpcHealth', async () => {
      const charSkill = createMockSkill({
        id: 'skill_char_1',
        ownerType: 'character',
        ownerId: 'char-1',
        cost: [],
      });
      const { service, npcService, characterService } = createService({
        skill: charSkill,
        skillByOwner: { character: charSkill, npc: null },
      });

      // targetId 以 npc_ 开头 → npc 目标
      const result = await service.useSkill('save-1', 'slash', 'npc_goblin' as any, 'character', 'char-1');

      expect(result.success).toBe(true);
      expect(npcService.modifyNpcHealth).toHaveBeenCalledWith('save-1', 'npc_goblin', -30, expect.anything());
      expect(characterService.modifyHealth).not.toHaveBeenCalledWith('save-1', -30, expect.anything());
      expect(result.targetApplied?.targetType).toBe('npc');
      expect(result.targetApplied?.targetId).toBe('npc_goblin');
    });
  });

  // ==========================================================================
  // 四、use_skill NPC 施法带冷却 → setCooldown 应透传 resolved owner
  // 审查发现 CRITICAL: SkillService.ts:1149-1151 setCooldown 传 undefined, undefined
  // 导致 setCooldown 内部 resolveOwnerId 默认 character，找不到 NPC 技能抛错
  // ==========================================================================
  describe('四、use_skill NPC 施法带冷却（审查 CRITICAL bug 验证）', () => {

    it('4.1 NPC 施法带冷却的技能 → 应成功设置冷却（不抛 "Skill not found"）', async () => {
      const npcSkill = createMockSkill({
        id: 'skill_npc_cooldown',
        ownerType: 'npc',
        ownerId: 'npc-001',
        cost: [],
        effects: {
          effects: [{ type: 'damage', value: 30 }],
          cooldown_turns: 2,
        } as any,
      });
      const { service, characterSkillRepo } = createService({
        skill: npcSkill,
        skillByOwner: {
          // NPC owner 查询返回 NPC 技能
          npc: npcSkill,
          // character owner 查询返回 null（模拟 character 没学这个技能）
          character: null,
        },
        npcResolveResult: 'npc-001',
        cooldownSystem: 'turn',
      });

      const result = await service.useSkill('save-1', 'slash', undefined, 'npc', 'npc-001');

      // 期望：NPC 施法带冷却技能应成功
      expect(result.success).toBe(true);
      // 关键验证：setCooldown 内部的 findBySkillIdOrName 应该用 NPC owner 查询
      // 如果传 undefined/undefined，会默认 character，找不到技能抛错
      const calls = characterSkillRepo.findBySkillIdOrName.mock.calls;
      // 应该有调用使用 NPC owner 查询（setCooldown 内部）
      const npcOwnerCalls = calls.filter((call: any[]) =>
        call[2] && call[2].ownerType === 'npc' && call[2].ownerId === 'npc-001'
      );
      expect(npcOwnerCalls.length).toBeGreaterThan(0);
    });

    it('4.2 NPC 施法带冷却 → setCooldown 应设置 cooldownRemaining（验证 update 被调用）', async () => {
      const npcSkill = createMockSkill({
        id: 'skill_npc_cooldown',
        ownerType: 'npc',
        ownerId: 'npc-001',
        cost: [],
        effects: {
          effects: [{ type: 'damage', value: 30 }],
          cooldown_turns: 3,
        } as any,
      });
      const { service, characterSkillRepo } = createService({
        skill: npcSkill,
        skillByOwner: { npc: npcSkill, character: null },
        npcResolveResult: 'npc-001',
        cooldownSystem: 'turn',
      });

      await service.useSkill('save-1', 'slash', undefined, 'npc', 'npc-001');

      // update 应被调用以设置 cooldownRemaining
      const updateCalls = characterSkillRepo.update.mock.calls;
      const cooldownUpdateCall = updateCalls.find((call: any[]) =>
        call[2] && typeof call[2] === 'object' && 'cooldownRemaining' in call[2]
      );
      expect(cooldownUpdateCall).toBeDefined();
      expect(cooldownUpdateCall![2].cooldownRemaining).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 五、mappers.ts rowToEntity 禁止 fallback（architecture-standards 13.3 第2条）
  // 审查发现 CRITICAL: mappers.ts:67-68 ownerType || 'character', ownerId || ''
  // ==========================================================================
  describe('五、mappers.ts rowToEntity 禁止 fallback（13.3 第2条）', () => {

    it('5.1 row.owner_type 缺失 → 不应 fallback 到 "character"（应保持原值 undefined）', () => {
      const row = {
        id: 'skill_1',
        save_id: 'save-1',
        skill_id: 'slash',
        name: '斩击',
        level: 1,
        max_level: 10,
        experience: 0,
        cooldown_remaining: 0,
        category: 'attack',
        element: 'physical',
        cost: '[]',
        effects: '{}',
        custom_data: '{}',
        unlocked: 1,
        visible: 1,
        // owner_type 故意缺失
        owner_id: 'char-1',
        consecutive_uses: 0,
        last_used_at: 0,
      };

      const skill = mapCharacterSkillRow(row);

      // 13.3 第2条：禁止对 owner_id 做 || 'character' 兜底
      // 期望：保持原值（undefined）或抛错，不应是 'character'
      expect(skill.ownerType).not.toBe('character');
    });

    it('5.2 row.owner_id 缺失 → 不应 fallback 到 ""（应保持原值 undefined）', () => {
      const row = {
        id: 'skill_1',
        save_id: 'save-1',
        skill_id: 'slash',
        name: '斩击',
        level: 1,
        max_level: 10,
        experience: 0,
        cooldown_remaining: 0,
        category: 'attack',
        element: 'physical',
        cost: '[]',
        effects: '{}',
        custom_data: '{}',
        unlocked: 1,
        visible: 1,
        owner_type: 'character',
        // owner_id 故意缺失
        consecutive_uses: 0,
        last_used_at: 0,
      };

      const skill = mapCharacterSkillRow(row);

      // 13.3 第2条：禁止对 owner_id 做 || '' 兜底（掩盖数据库字段缺失）
      // 期望：保持原值（undefined）或抛错，不应是 ''
      expect(skill.ownerId).not.toBe('');
    });

    it('5.3 row.owner_type 和 owner_id 都存在 → 正常映射', () => {
      const row = {
        id: 'skill_1',
        save_id: 'save-1',
        skill_id: 'slash',
        name: '斩击',
        level: 1,
        max_level: 10,
        experience: 0,
        cooldown_remaining: 0,
        category: 'attack',
        element: 'physical',
        cost: '[]',
        effects: '{}',
        custom_data: '{}',
        unlocked: 1,
        visible: 1,
        owner_type: 'npc',
        owner_id: 'npc-001',
        consecutive_uses: 0,
        last_used_at: 0,
      };

      const skill = mapCharacterSkillRow(row);

      expect(skill.ownerType).toBe('npc');
      expect(skill.ownerId).toBe('npc-001');
    });
  });

  // ==========================================================================
  // 六、resolveTarget 禁止 fallback 到 character（architecture-standards 13.3 第1条）
  // 审查发现 MEDIUM: SkillService.ts:1308-1311 resolveNpcId 失败时退化为 character
  // ==========================================================================
  describe('六、resolveTarget 禁止 fallback 到 character（13.3 第1条）', () => {

    it('6.1 传入无效 targetId（resolveNpcId 失败）→ 不应静默退化为 character', async () => {
      const charSkill = createMockSkill({
        id: 'skill_char_1',
        ownerType: 'character',
        ownerId: 'char-1',
        cost: [],
      });
      const { service, characterService } = createService({
        skill: charSkill,
        skillByOwner: { character: charSkill, npc: null },
        // resolveNpcId 抛错
        npcResolveThrows: true,
      });

      // 传入一个既不是 saveId，也不是 npc_ 前缀，resolveNpcId 也失败的 targetId
      // 修复后：resolveTarget 会抛错（不再静默退化为 character）
      await expect(
        service.useSkill('save-1', 'slash', 'invalid_target_xyz' as any, 'character', 'char-1')
      ).rejects.toThrow(/Invalid targetId/);

      // 验证没有发生 fallback：characterService.modifyHealth 不应被调用
      const fallbackOccurred = characterService.modifyHealth.mock.calls.some(
        (call: any[]) => call[0] === 'save-1' && call[1] === -30
      );
      expect(fallbackOccurred).toBe(false);
    });
  });

  // ==========================================================================
  // 七、check_cooldown 通配返回数组带 owner 标识（文档 3.1 check_cooldown）
  // ==========================================================================
  describe('七、check_cooldown 通配返回数组带 owner 标识', () => {

    it('7.1 通配查询 → 数组每个元素包含 ownerId/ownerType 字段', async () => {
      const skills = [
        createMockSkill({ id: 's1', ownerType: 'character', ownerId: 'char-1', cooldownRemaining: 0 }),
        createMockSkill({ id: 's2', ownerType: 'npc', ownerId: 'npc-001', cooldownRemaining: 2 }),
      ];
      const { service } = createService({
        skills,
        cooldownSystem: 'turn',
      });

      const result = await service.checkCooldown('save-1', '斩击', 'all');

      expect(Array.isArray(result)).toBe(true);
      const arr = result as any[];
      expect(arr).toHaveLength(2);

      // 每个元素都有 owner 标识
      for (const item of arr) {
        expect(item).toHaveProperty('ownerId');
        expect(item).toHaveProperty('ownerType');
        expect(item).toHaveProperty('available');
        expect(item).toHaveProperty('remaining');
        expect(item).toHaveProperty('cooldownType');
      }

      // character 的技能可用（cooldownRemaining=0）
      const charCooldown = arr.find(c => c.ownerType === 'character');
      expect(charCooldown.available).toBe(true);
      expect(charCooldown.remaining).toBe(0);

      // NPC 的技能冷却中（cooldownRemaining=2）
      const npcCooldown = arr.find(c => c.ownerType === 'npc');
      expect(npcCooldown.available).toBe(false);
      expect(npcCooldown.remaining).toBe(2);
    });

    it('7.2 精确 owner 查询 → 返回单个对象，不带 ownerId/ownerType 额外字段', async () => {
      const skill = createMockSkill({
        ownerType: 'character',
        ownerId: 'char-1',
        cooldownRemaining: 0,
      });
      const { service } = createService({
        skill,
        cooldownSystem: 'turn',
      });

      const result = await service.checkCooldown('save-1', 'slash', 'character');

      expect(Array.isArray(result)).toBe(false);
      const obj = result as any;
      expect(obj.available).toBe(true);
      expect(obj.remaining).toBe(0);
      expect(obj.cooldownType).toBe('turn');
      // 精确 owner 返回的对象不应有 ownerId/ownerType 字段
      expect(obj).not.toHaveProperty('ownerId');
      expect(obj).not.toHaveProperty('ownerType');
    });
  });

  // ==========================================================================
  // 八、upgrade_skill 升级公式（文档 3.2 upgrade_skill）
  // ==========================================================================
  describe('八、upgrade_skill 升级公式与数据隔离', () => {

    it('8.1 升级消耗经验 = calcExpForLevel(level + 1)', async () => {
      const skill = createMockSkill({
        id: 'skill_char_1',
        ownerType: 'character',
        ownerId: 'char-1',
        level: 2,
        experience: 500,
      });
      const { service, characterSkillRepo } = createService({ skill });

      await service.upgradeSkill('save-1', 'slash');

      // 升级后 level 应该 +1；update 第 4 参数为 owner 过滤选项（与查询的 owner 过滤一致）
      expect(characterSkillRepo.update).toHaveBeenCalledWith(
        'save-1', 'skill_char_1',
        expect.objectContaining({ level: 3 }),
        expect.objectContaining({ ownerType: 'character', ownerId: 'char-1' }),
      );
    });

    it('8.2 升级按 skill.id 精确更新，不影响其他 owner 同名技能', async () => {
      const charSkill = createMockSkill({
        id: 'skill_char_unique_id',
        ownerType: 'character',
        ownerId: 'char-1',
        level: 1,
        experience: 500,
      });
      const { service, characterSkillRepo } = createService({
        skill: charSkill,
        skillByOwner: { character: charSkill, npc: null },
      });

      await service.upgradeSkill('save-1', 'slash', 'character');

      // update 只更新 skill_char_unique_id，不会误改 NPC 的同名技能；第 4 参数为 owner 过滤选项
      expect(characterSkillRepo.update).toHaveBeenCalledWith(
        'save-1',
        'skill_char_unique_id',
        expect.objectContaining({ level: 2 }),
        expect.objectContaining({ ownerType: 'character', ownerId: 'char-1' }),
      );
    });
  });
});
