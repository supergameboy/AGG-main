/**
 * P0 修复前置：NPC 新增 modifyNpcHealth 端口
 *
 * 设计意图：
 * - 与 ICharacterService.modifyHealth 对称
 * - 供 SkillService.useSkill 传入 targetId 时应用伤害到 NPC HP
 * - 支持 trx 透传，事务内执行避免 read-modify-write race condition
 *
 * 测试场景：
 * - T1: delta 为负 → 扣 HP，clamp 到 0
 * - T2: delta 为正 → 加 HP，clamp 到 maxHp
 * - T3: NPC 不存在 → 抛错
 * - T4: 传入 trx → 在已有事务内执行，不新开事务
 */
import { describe, it, expect, vi } from 'vitest';
import { NPCService } from '../NPCService.js';
import type { NPCProfile } from '../types.js';

function createNpcMock(overrides: Partial<NPCProfile> = {}): NPCProfile {
  return {
    id: 'npc-1',
    saveId: 'save-1',
    templateNpcId: null,
    name: '测试NPC',
    role: 'warrior',
    title: null,
    race: 'human',
    level: 1,
    attributes: {},
    derivedAttributes: {},
    currentHp: 50,
    maxHp: 100,
    currentMp: 30,
    maxMp: 50,
    attrInitialized: true,
    invInitialized: true,
    skillInitialized: true,
    visibility: 'visible',
    locationId: 'loc-1',
    services: [],
    mood: 'neutral',
    inParty: false,
    joinedPartyAt: null,
    dialogueHistory: [],
    customData: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as NPCProfile;
}

function createNpcRepoMock(npc: NPCProfile | null = createNpcMock()) {
  return {
    findById: vi.fn().mockResolvedValue(npc),
    update: vi.fn().mockResolvedValue(npc),
  } as any;
}

function createTxManagerMock() {
  const transaction = vi.fn(async (cb: (trx: any) => Promise<any>) => cb({} as any));
  return { transaction } as any;
}

function createService(npc: NPCProfile | null = createNpcMock()) {
  const npcRepo = createNpcRepoMock(npc);
  const txManager = createTxManagerMock();
  const service = new NPCService(
    npcRepo,
    {} as any,  // goalRepo
    {} as any,  // mapService
    {} as any,  // characterService
    {} as any,  // saveRepo
    {} as any,  // templateProvider
    {} as any,  // numericalService
    txManager,
  );
  return { service, npcRepo, txManager };
}

describe('NPCService.modifyNpcHealth（新增端口）', () => {
  describe('T1: delta 为负 → 扣 HP', () => {
    it('currentHp 50, delta -30 → currentHp 20', async () => {
      const npc = createNpcMock({ currentHp: 50, maxHp: 100 });
      const { service, npcRepo } = createService(npc);

      const result = await service.modifyNpcHealth('save-1', 'npc-1', -30);

      expect(result).toEqual({ previous: 50, current: 20, max: 100 });
      expect(npcRepo.update).toHaveBeenCalledTimes(1);
      const [, , patch] = npcRepo.update.mock.calls[0];
      expect(patch.currentHp).toBe(20);
    });

    it('currentHp 20, delta -50 → clamp 到 0（不死负数）', async () => {
      const npc = createNpcMock({ currentHp: 20, maxHp: 100 });
      const { service, npcRepo } = createService(npc);

      const result = await service.modifyNpcHealth('save-1', 'npc-1', -50);

      expect(result.current).toBe(0);
      const [, , patch] = npcRepo.update.mock.calls[0];
      expect(patch.currentHp).toBe(0);
    });
  });

  describe('T2: delta 为正 → 加 HP', () => {
    it('currentHp 50, delta +30 → currentHp 80', async () => {
      const npc = createNpcMock({ currentHp: 50, maxHp: 100 });
      const { service } = createService(npc);

      const result = await service.modifyNpcHealth('save-1', 'npc-1', 30);

      expect(result).toEqual({ previous: 50, current: 80, max: 100 });
    });

    it('currentHp 80, delta +50 → clamp 到 maxHp 100', async () => {
      const npc = createNpcMock({ currentHp: 80, maxHp: 100 });
      const { service } = createService(npc);

      const result = await service.modifyNpcHealth('save-1', 'npc-1', 50);

      expect(result.current).toBe(100);
    });
  });

  describe('T3: NPC 不存在 → 抛错', () => {
    it('findById 返回 null → 抛 NPC not found 错误', async () => {
      const { service } = createService(null);

      await expect(
        service.modifyNpcHealth('save-1', 'npc-not-exist', -10)
      ).rejects.toThrow(/NPC not found|未找到/);
    });
  });

  describe('T4: trx 透传', () => {
    it('传入 trx → 在已有事务内执行，不调用 txManager.transaction', async () => {
      const npc = createNpcMock({ currentHp: 50, maxHp: 100 });
      const { service, npcRepo, txManager } = createService(npc);
      const mockTrx = { isMock: true } as any;

      await service.modifyNpcHealth('save-1', 'npc-1', -10, mockTrx);

      // txManager.transaction 不应被调用（已有 trx）
      expect(txManager.transaction).not.toHaveBeenCalled();
      // npcRepo.findById 应该收到 trx
      expect(npcRepo.findById).toHaveBeenCalledWith('npc-1', 'save-1', mockTrx);
      // npcRepo.update 应该收到 trx
      expect(npcRepo.update).toHaveBeenCalledWith('npc-1', 'save-1', expect.any(Object), mockTrx);
    });

    it('未传 trx → 用 txManager 开新事务', async () => {
      const npc = createNpcMock({ currentHp: 50, maxHp: 100 });
      const { service, txManager } = createService(npc);

      await service.modifyNpcHealth('save-1', 'npc-1', -10);

      expect(txManager.transaction).toHaveBeenCalledTimes(1);
    });
  });
});
