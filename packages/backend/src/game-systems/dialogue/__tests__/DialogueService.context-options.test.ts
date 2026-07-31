import { describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { DialogueService } from '../DialogueService.js';
import type { IDialogueRepository, DialogueMessageRecord } from '../types.js';
import type { INPCService } from '../../npc/types.js';
import type { IQuestService } from '../../quest/types.js';
import type { IInventoryService } from '../../inventory/types.js';
import type { ITransactionManager } from '../../../database/TransactionManager.js';

/**
 * S3-3 Phase D: 测试适配。
 * 原 integration test 直接 new DialogueService(db)，重构后改为 mock 依赖注入，
 * 验证 getDialogueContext 返回的选项携带正确 npcId（Service 逻辑层测试）。
 */

function createMockDeps(): {
  dialogueRepo: IDialogueRepository;
  npcService: INPCService;
  questService: IQuestService;
  inventoryService: IInventoryService;
  txManager: ITransactionManager;
} {
  const dialogueRepo: IDialogueRepository = {
    findWithPagination: vi.fn().mockResolvedValue({ rows: [] as DialogueMessageRecord[], total: 0 }),
    findRecent: vi.fn().mockResolvedValue([] as DialogueMessageRecord[]),
    countBySaveIdAndNpcId: vi.fn().mockResolvedValue(0),
    findAllBySaveId: vi.fn().mockResolvedValue([] as DialogueMessageRecord[]),
    search: vi.fn().mockResolvedValue([] as DialogueMessageRecord[]),
    insert: vi.fn().mockResolvedValue(undefined),
    deleteBySaveId: vi.fn().mockResolvedValue(undefined),
    groupCountByEmotion: vi.fn().mockResolvedValue([]),
  };

  const npcService: INPCService = {
    listNPCs: vi.fn().mockResolvedValue([]),
    getNPCsByLocationIds: vi.fn().mockResolvedValue([]),
    getNPCNamesByIds: vi.fn().mockResolvedValue(new Map()),
    getNPC: vi.fn().mockResolvedValue({
      id: 'npc-village-chief',
      saveId: 'save-1',
      templateNpcId: null,
      name: '村长艾德温',
      title: '',
      description: '',
      role: '村长',
      race: '',
      locationId: null,
      level: 1,
      services: [],
      dialogueHistory: [],
      inParty: false,
      joinedPartyAt: null,
      reputation: 0,
      mood: 0,
      visible: true,
      attrInitialized: false,
      invInitialized: false,
      skillInitialized: false,
      customData: {},
      currency: {},
      attributes: {},
      derivedAttributes: {},
      currentHp: null,
      maxHp: null,
      currentMp: null,
      maxMp: null,
    }),
    getActiveGoals: vi.fn().mockResolvedValue([]),
    compressMemories: vi.fn().mockResolvedValue({} as never),
    modifyNpcResource: vi.fn().mockResolvedValue(undefined),
    getNpcResources: vi.fn().mockResolvedValue({ currentMp: null, currentHp: null, currentStamina: null, currency: {} }),
    getNpcAttributes: vi.fn().mockResolvedValue({}),
    resolveNpcId: vi.fn().mockResolvedValue('npc-village-chief'),
    appendDialogueHistory: vi.fn().mockResolvedValue(undefined),
  } as unknown as INPCService;

  const questService: IQuestService = {
    isQuestCompleted: vi.fn().mockResolvedValue(false),
    createQuest: vi.fn().mockResolvedValue({} as never),
  } as unknown as IQuestService;

  const inventoryService: IInventoryService = {
    hasItem: vi.fn().mockResolvedValue(false),
  } as unknown as IInventoryService;

  const txManager: ITransactionManager = {
    transaction: vi.fn(async <T>(work: (trx: Knex.Transaction) => Promise<T>): Promise<T> => {
      const mockTrx = {} as Knex.Transaction;
      return work(mockTrx);
    }),
  };

  return { dialogueRepo, npcService, questService, inventoryService, txManager };
}

describe('DialogueService dialogue option ownership', () => {
  it('getDialogueContext 返回的每个选项都应携带所属 npcId', async () => {
    const { dialogueRepo, npcService, questService, inventoryService, txManager } = createMockDeps();
    const service = new DialogueService(
      dialogueRepo,
      npcService,
      questService,
      inventoryService,
      txManager,
    );

    const context = await service.getDialogueContext('save-1' as never, 'npc-village-chief' as never);

    expect(context.availableOptions.length).toBeGreaterThan(0);
    expect(context.availableOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          npcId: 'npc-village-chief',
        }),
      ])
    );
    expect(context.availableOptions.every((option) => option.npcId === 'npc-village-chief')).toBe(true);
  });

  it('getDialogueContext 多次获取同一 NPC 对话选项时应保持稳定 optionId', async () => {
    const { dialogueRepo, npcService, questService, inventoryService, txManager } = createMockDeps();
    const service = new DialogueService(
      dialogueRepo,
      npcService,
      questService,
      inventoryService,
      txManager,
    );

    const first = await service.getDialogueContext('save-1' as never, 'npc-village-chief' as never);
    const second = await service.getDialogueContext('save-1' as never, 'npc-village-chief' as never);

    expect(first.availableOptions.length).toBeGreaterThan(0);
    expect(second.availableOptions.length).toBe(first.availableOptions.length);
    expect(second.availableOptions.map((option) => option.id)).toEqual(
      first.availableOptions.map((option) => option.id)
    );
  });
});
