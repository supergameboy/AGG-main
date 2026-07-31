import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NPCService } from '../NPCService.js';
import type { INumericalService, DerivedAttributes } from '../../numerical/types.js';
import type { NPCRepository } from '../NPCRepository.js';
import type { INPCGoalRepository } from '../types.js';
import type { IMapService } from '../../map/types.js';
import type { ICharacterService } from '../../character/types.js';
import type { ISaveRepository } from '../../save/types.js';
import type { ITemplateProvider } from '../../shared/types.js';
import type { ITransactionManager } from '../../../database/TransactionManager.js';
import type { ID } from '@ai-rpg/shared';

/**
 * P0-2 单元测试：NPCService.updateNPC 传入 attributes 时自动派生 HP/MP。
 *
 * 直接测试 NPCService 类（不经 ServiceTool），精确 mock numericalService。
 *
 * 4 场景：
 * - T1 传入 attributes → 自动调用 calculateDerivedAttributes，写入 derived/maxHp/maxMp/currentHp/currentMp
 * - T2 显式传 maxHp → 覆盖派生值
 * - T3 未传 attributes → 维持现状（不调用 calculateDerivedAttributes）
 * - T4 传入 attributes 但 derived 无 maxHealth → 不写入 maxHp
 */

const SAVE_ID = 'save-npc-derived' as ID;
const NPC_ID = 'npc-1' as ID;

const MOCK_DERIVED: DerivedAttributes = {
  attack: 15,
  defense: 10,
  speed: 12,
  critRate: 5,
  critDamage: 50,
  dodgeRate: 5,
  blockRate: 0,
  magicAttack: 8,
  magicDefense: 6,
  maxHealth: 120,
  maxMana: 60,
};

describe('NPCService.updateNPC — P0-2 自动派生属性', () => {
  let service: NPCService;
  let mockNumericalService: { calculateDerivedAttributes: ReturnType<typeof vi.fn> };
  let mockNpcRepo: { findById: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockNumericalService = {
      calculateDerivedAttributes: vi.fn().mockReturnValue(MOCK_DERIVED),
    };

    mockNpcRepo = {
      findById: vi.fn().mockResolvedValue({ id: NPC_ID, name: '村长', saveId: SAVE_ID }),
      update: vi.fn().mockImplementation(async (id, _saveId, patch) => ({
        id,
        name: '村长',
        saveId: SAVE_ID,
        ...patch,
      })),
    };

    service = new NPCService(
      mockNpcRepo as unknown as NPCRepository,
      {} as INPCGoalRepository,
      {} as IMapService,
      {} as ICharacterService,
      {} as ISaveRepository,
      {} as ITemplateProvider,
      mockNumericalService as unknown as INumericalService,
      {} as ITransactionManager,
      { resolve: vi.fn().mockResolvedValue({ entityId: NPC_ID }) } as any,
    );
  });

  it('T1: 传入 attributes → 自动派生并满血初始化', async () => {
    const result = await service.updateNPC(SAVE_ID, NPC_ID, {
      attributes: '{"str":12,"dex":10}',
    });

    expect(mockNumericalService.calculateDerivedAttributes).toHaveBeenCalledTimes(1);
    expect(mockNpcRepo.update).toHaveBeenCalledTimes(1);
    const [, , patch] = mockNpcRepo.update.mock.calls[0];
    expect(patch.derivedAttributes).toEqual(MOCK_DERIVED);
    expect(patch.maxHp).toBe(120);
    expect(patch.maxMp).toBe(60);
    expect(patch.currentHp).toBe(120);
    expect(patch.currentMp).toBe(60);
    expect(result.maxHp).toBe(120);
  });

  it('T2: 显式传 maxHp → 覆盖派生值', async () => {
    await service.updateNPC(SAVE_ID, NPC_ID, {
      attributes: '{"str":12}',
      maxHp: 200,
    });

    const [, , patch] = mockNpcRepo.update.mock.calls[0];
    expect(mockNumericalService.calculateDerivedAttributes).toHaveBeenCalledTimes(1);
    expect(patch.maxHp).toBe(200);
    expect(patch.currentHp).toBe(200); // currentHp 未显式传 → 设为 maxHp
    expect(patch.maxMp).toBe(60); // maxMp 未显式传 → 用派生值
  });

  it('T3: 未传 attributes → 维持现状（纯透传）', async () => {
    await service.updateNPC(SAVE_ID, NPC_ID, {
      currentHp: 50,
      maxHp: 100,
    });

    expect(mockNumericalService.calculateDerivedAttributes).not.toHaveBeenCalled();
    const [, , patch] = mockNpcRepo.update.mock.calls[0];
    expect(patch.currentHp).toBe(50);
    expect(patch.maxHp).toBe(100);
    expect(patch.derivedAttributes).toBeUndefined();
  });

  it('T4: derived 无 maxHealth → 不写入 maxHp', async () => {
    mockNumericalService.calculateDerivedAttributes.mockReturnValue({
      ...MOCK_DERIVED,
      maxHealth: undefined,
      maxMana: undefined,
    });

    await service.updateNPC(SAVE_ID, NPC_ID, {
      attributes: '{"str":12}',
    });

    const [, , patch] = mockNpcRepo.update.mock.calls[0];
    expect(patch.derivedAttributes).toBeDefined();
    expect(patch.maxHp).toBeUndefined();
    expect(patch.maxMp).toBeUndefined();
    expect(patch.currentHp).toBeUndefined();
    expect(patch.currentMp).toBeUndefined();
  });
});
