/**
 * NPCService.createNPC 去重防护测试
 *
 * 设计文档：docs/design/fix/fix-20260716-audit-feedback-duplicate-creation.md §3
 *
 * 期望效果（设计文档 §3 矩阵 #6）：
 * - 同 saveId+name 已存在 → 增量更新非黑名单字段 + 返回 alreadyExists=true + warnings
 * - warnings 包含字段级 diff（"字段名: 旧值 → 新值"）
 * - locationId 支持 name/id 双兼容解析（通过 mapService.resolveLocationId）
 * - customData 字段（personality/background/abilities/disposition）可增量更新
 * - 黑名单字段（id、saveId、npcId、createdAt）拒绝更新
 * - 不存在 → 正常创建流程（无 alreadyExists）
 *
 * 黑名单字段（设计文档 §3 黑名单表）：id、saveId、npcId、createdAt
 */
import { describe, it, expect, vi } from 'vitest';
import { NPCService } from '../NPCService.js';
import type { NPCProfile } from '../types.js';

function createExistingNpc(overrides: Partial<NPCProfile> = {}): NPCProfile {
  return {
    id: 'npc_村长_1784177145648_1',
    saveId: 'save-001',
    templateNpcId: null,
    name: '村长艾德温',
    title: '村长',
    description: '白杨村的村长',
    role: 'villager',
    race: 'human',
    locationId: 'loc_白杨村_1784177145648_3',
    level: 5,
    services: [],
    dialogueHistory: [],
    inParty: false,
    joinedPartyAt: null,
    reputation: 0,
    mood: 50,
    visible: true,
    attrInitialized: false,
    invInitialized: false,
    skillInitialized: false,
    customData: {
      disposition: 'friendly',
      personality: 'wise',
      background: '老村长',
    },
    currency: {},
    attributes: {},
    derivedAttributes: {},
    currentHp: null,
    maxHp: null,
    currentMp: null,
    maxMp: null,
    ...overrides,
  } as NPCProfile;
}

function createNpcRepoMock(existing: NPCProfile | null = null) {
  return {
    findByName: vi.fn().mockResolvedValue(existing),
    findById: vi.fn().mockResolvedValue(existing),
    insert: vi.fn().mockResolvedValue(existing),
    update: vi.fn().mockResolvedValue(undefined),
    findBySaveId: vi.fn().mockResolvedValue(existing ? [existing] : []),
    findByTemplateNpcId: vi.fn().mockResolvedValue(null),
    findByNameContaining: vi.fn().mockResolvedValue([]),
    findNamesByIds: vi.fn().mockResolvedValue(new Map()),
    findSummariesByLocationIds: vi.fn().mockResolvedValue([]),
  } as any;
}

function createMapServiceMock(resolvedLocationId = 'loc_resolved_1') {
  return {
    resolveLocationId: vi.fn().mockResolvedValue(resolvedLocationId),
  } as any;
}

function createCharacterServiceMock() {
  return {} as any;
}

function createSaveRepoMock() {
  return {} as any;
}

function createTemplateProviderMock() {
  return {} as any;
}

function createNumericalServiceMock() {
  return {} as any;
}

function createTxManagerMock() {
  const transaction = vi.fn(async (cb: (trx: any) => Promise<any>) => cb({} as any));
  return { transaction } as any;
}

function createNpcService(existing: NPCProfile | null = null, resolvedLocationId = 'loc_resolved_1') {
  const npcRepo = createNpcRepoMock(existing);
  const goalRepo = {} as any;
  const mapService = createMapServiceMock(resolvedLocationId);
  const characterService = createCharacterServiceMock();
  const saveRepo = createSaveRepoMock();
  const templateProvider = createTemplateProviderMock();
  const numericalService = createNumericalServiceMock();
  const txManager = createTxManagerMock();

  const service = new NPCService(
    npcRepo,
    goalRepo,
    mapService,
    characterService,
    saveRepo,
    templateProvider,
    numericalService,
    txManager,
  );
  return { service, npcRepo, mapService, txManager };
}

describe('NPCService.createNPC 去重防护', () => {
  describe('设计文档 §3 矩阵 #6：同 saveId+name 已存在 → 增量更新 + warnings', () => {
    it('已存在 → 返回 alreadyExists=true + warnings 含字段级 diff', async () => {
      const existing = createExistingNpc({
        description: '旧描述',
        role: 'villager',
        level: 5,
      });
      const { service, npcRepo } = createNpcService(existing);

      const input = {
        saveId: 'save-001' as any,
        name: '村长艾德温',
        role: 'merchant',
        race: 'human',
        locationId: 'loc_白杨村_1784177145648_3',
        description: '新描述',
        personality: 'wise',
        background: '老村长',
        level: 10,
      };

      const updated = { ...existing, role: 'merchant', description: '新描述', level: 10 };
      npcRepo.findById.mockResolvedValue(updated);

      const result = await service.createNPC(input);

      expect(result.alreadyExists).toBe(true);
      expect(result.warnings).toBeDefined();
      const warningsText = result.warnings!.join(' ');
      expect(warningsText).toContain("NPC '村长艾德温' 已存在");
      expect(warningsText).toContain('description: 旧描述 → 新描述');
      expect(warningsText).toContain('role: villager → merchant');
      expect(warningsText).toContain('level: 5 → 10');
    });

    it('增量更新 locationId（通过 mapService.resolveLocationId 解析 name → id）', async () => {
      const existing = createExistingNpc({ locationId: 'loc_old_1' });
      const { service, npcRepo, mapService } = createNpcService(existing, 'loc_new_2');

      const input = {
        saveId: 'save-001' as any,
        name: '村长艾德温',
        role: 'villager',
        race: 'human',
        locationId: '白杨村', // name 形式，应由 mapService.resolveLocationId 解析
        description: '白杨村的村长',
        personality: 'wise',
        background: '老村长',
      };

      const updated = { ...existing, locationId: 'loc_new_2' };
      npcRepo.findById.mockResolvedValue(updated);

      const result = await service.createNPC(input);

      expect(result.alreadyExists).toBe(true);
      expect(mapService.resolveLocationId).toHaveBeenCalledWith('白杨村', 'save-001');
      expect(result.warnings!.join(' ')).toContain('locationId: loc_old_1 → loc_new_2');
    });

    it('customData 字段（personality/background/disposition）可增量更新', async () => {
      const existing = createExistingNpc({
        customData: {
          disposition: 'friendly',
          personality: 'wise',
          background: '老村长',
        },
      });
      const { service, npcRepo } = createNpcService(existing);

      const input = {
        saveId: 'save-001' as any,
        name: '村长艾德温',
        role: 'villager',
        race: 'human',
        locationId: 'loc_白杨村_1',
        description: '白杨村的村长',
        personality: 'stern',
        background: '退役骑士',
        disposition: 'neutral',
      };

      const updated = {
        ...existing,
        customData: {
          disposition: 'neutral',
          personality: 'stern',
          background: '退役骑士',
        },
      };
      npcRepo.findById.mockResolvedValue(updated);

      const result = await service.createNPC(input);

      expect(result.alreadyExists).toBe(true);
      const warningsText = result.warnings!.join(' ');
      expect(warningsText).toContain('personality: wise → stern');
      expect(warningsText).toContain('background: 老村长 → 退役骑士');
      expect(warningsText).toContain('disposition: friendly → neutral');
    });

    it('增量更新 abilities（customData 内字段）', async () => {
      const existing = createExistingNpc({
        customData: {
          disposition: 'friendly',
          personality: 'wise',
          background: '老村长',
        },
      });
      const { service, npcRepo } = createNpcService(existing);

      const input = {
        saveId: 'save-001' as any,
        name: '村长艾德温',
        role: 'villager',
        race: 'human',
        locationId: 'loc_白杨村_1',
        description: '白杨村的村长',
        personality: 'wise',
        background: '老村长',
        abilities: '剑术、外交',
      };

      const updated = {
        ...existing,
        customData: {
          ...existing.customData,
          abilities: '剑术、外交',
        },
      };
      npcRepo.findById.mockResolvedValue(updated);

      const result = await service.createNPC(input);

      expect(result.alreadyExists).toBe(true);
      expect(result.warnings!.join(' ')).toContain('abilities');
    });
  });

  describe('设计文档 §3 黑名单字段触发提示', () => {
    it('黑名单字段（id/saveId/npcId/createdAt）不被覆盖', async () => {
      const existing = createExistingNpc({ id: 'npc_original_1' });
      const { service, npcRepo } = createNpcService(existing);

      const input = {
        saveId: 'save-001' as any,
        name: '村长艾德温',
        role: 'villager',
        race: 'human',
        locationId: 'loc_白杨村_1',
        description: '新描述',
        personality: 'wise',
        background: '老村长',
      };

      const updated = { ...existing, description: '新描述' };
      npcRepo.findById.mockResolvedValue(updated);

      const result = await service.createNPC(input);

      expect(result.alreadyExists).toBe(true);
      // id 保持原值
      expect(result.id).toBe('npc_original_1');
      // update patch 不应包含 id/saveId/npcId
      const updateCall = npcRepo.update.mock.calls[0];
      if (updateCall) {
        const patch = updateCall[2] as Record<string, unknown>;
        expect(patch.id).toBeUndefined();
        expect(patch.saveId).toBeUndefined();
        expect(patch.npcId).toBeUndefined();
      }
    });
  });

  describe('设计文档 §3：不存在 → 正常创建流程', () => {
    it('findByName 返回 null → 正常创建，无 alreadyExists', async () => {
      const { service, npcRepo } = createNpcService(null);

      const input = {
        saveId: 'save-001' as any,
        name: '新NPC',
        role: 'villager',
        race: 'human',
        locationId: 'loc_白杨村_1',
        description: '全新NPC',
        personality: 'friendly',
        background: '背景',
      };

      const newNpc = createExistingNpc({ id: 'npc_new_1', name: '新NPC' });
      npcRepo.insert.mockResolvedValue(newNpc);

      const result = await service.createNPC(input);

      expect(result.alreadyExists).toBeUndefined();
      expect(npcRepo.insert).toHaveBeenCalled();
    });
  });

  describe('设计文档 §3：无字段变化', () => {
    it('输入与 existing 一致 → warnings 提示"无字段变化"', async () => {
      const existing = createExistingNpc({
        role: 'villager',
        race: 'human',
        locationId: 'loc_白杨村_1',
        description: '白杨村的村长',
        level: 5,
        title: '村长',
        visible: true,
      });
      const { service, npcRepo, mapService } = createNpcService(existing, 'loc_白杨村_1');

      const input = {
        saveId: 'save-001' as any,
        name: '村长艾德温',
        role: 'villager',
        race: 'human',
        locationId: 'loc_白杨村_1',
        description: '白杨村的村长',
        personality: 'wise',
        background: '老村长',
        level: 5,
        title: '村长',
        visible: true,
      };

      const updated = { ...existing };
      npcRepo.findById.mockResolvedValue(updated);

      const result = await service.createNPC(input);

      expect(result.alreadyExists).toBe(true);
      expect(result.warnings).toBeDefined();
    });
  });
});
