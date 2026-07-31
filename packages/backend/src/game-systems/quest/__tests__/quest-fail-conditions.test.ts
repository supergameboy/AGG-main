import { describe, expect, it, vi } from 'vitest';
import { QuestService } from '../QuestService.js';
import type { QuestDetail } from '../types.js';

const FAIL_CONDITIONS_ALL = ['timeout', 'npc_death', 'item_lost', 'enemy_escapes'];

function createMockQuest(overrides?: Partial<QuestDetail>): QuestDetail {
  return {
    id: 'quest_测试任务_001',
    saveId: 'save1',
    name: '测试任务',
    description: '测试用',
    type: 'main',
    status: 'active',
    visible: true,
    prerequisiteQuestIds: [],
    giverNpcId: 'npc_村长_001',
    giverLocationId: null,
    questChainId: null,
    rewards: { experience: 100, currency: { gold: 50 } },
    timeLimit: 0,
    customData: {},
    createdAt: Date.now() as any,
    updatedAt: Date.now() as any,
    objectives: [],
    progressPercent: 0,
    canComplete: false,
    ...overrides,
  };
}

/**
 * S3-1 Phase B: QuestService 测试适配新的 9 参数构造函数（Repository 模式 + 端口注入）。
 *
 * checkFailConditions 仅依赖 ruleParser.getQuestRules()；getQuest 和 failQuest 在每个
 * 用例中通过 vi.spyOn mock 掉，因此 questRepo/objectiveRepo/txManager/eventBus 留空对象，
 * 4 个跨领域服务可选（不调用），ruleParser 通过构造函数注入 stub。
 */
function createService(failConditions: string[] = FAIL_CONDITIONS_ALL) {
  const ruleParserStub = {
    getQuestRules: () => ({
      max_active: 10,
      time_system: true,
      fail_conditions: failConditions,
    }),
  } as any;

  return new QuestService(
    {} as any, // questRepo — getQuest 被 spy，不实际调用
    {} as any, // objectiveRepo — 同上
    {} as any, // txManager — checkFailConditions 无事务路径
    ruleParserStub,
    undefined, undefined, undefined, undefined, // 4 个跨领域服务可选，checkFailConditions 不触及
    undefined, // eventBus — failQuest 被 spy，emitQuestUpdate 不实际调用
  );
}

describe('QuestService — 任务失败条件扩展', () => {
  describe('item_lost 条件', () => {
    it('丢失收集目标物品时任务失败', async () => {
      const service = createService();
      const quest = createMockQuest({
        objectives: [{
          id: 'obj1', questId: 'quest_测试任务_001', description: '收集龙鳞',
          type: 'collect' as const, target: 'item_龙鳞_001', required: 1, current: 0, completed: false,
        }],
      });
      vi.spyOn(service as any, 'getQuest').mockResolvedValue(quest);
      vi.spyOn(service as any, 'failQuest').mockResolvedValue(quest);

      const result = await service.checkFailConditions('save1', 'quest_测试任务_001', 'item_lost', {
        itemId: 'item_龙鳞_001',
      });

      expect(result).toBe(true);
      expect(service.failQuest).toHaveBeenCalledWith('save1', 'quest_测试任务_001');
    });

    it('丢失非目标物品时任务不失败', async () => {
      const service = createService();
      const quest = createMockQuest({
        objectives: [{
          id: 'obj1', questId: 'quest_测试任务_001', description: '收集龙鳞',
          type: 'collect' as const, target: 'item_龙鳞_001', required: 1, current: 0, completed: false,
        }],
      });
      vi.spyOn(service as any, 'getQuest').mockResolvedValue(quest);

      const result = await service.checkFailConditions('save1', 'quest_测试任务_001', 'item_lost', {
        itemId: 'item_铁剑_002',
      });

      expect(result).toBe(false);
    });

    it('已完成的收集目标不受影响', async () => {
      const service = createService();
      const quest = createMockQuest({
        objectives: [{
          id: 'obj1', questId: 'quest_测试任务_001', description: '收集龙鳞',
          type: 'collect' as const, target: 'item_龙鳞_001', required: 1, current: 1, completed: true,
        }],
      });
      vi.spyOn(service as any, 'getQuest').mockResolvedValue(quest);

      const result = await service.checkFailConditions('save1', 'quest_测试任务_001', 'item_lost', {
        itemId: 'item_龙鳞_001',
      });

      expect(result).toBe(false);
    });

    it('fail_conditions 不含 item_lost 时不触发', async () => {
      const service = createService(['timeout', 'npc_death']);
      const quest = createMockQuest({
        objectives: [{
          id: 'obj1', questId: 'quest_测试任务_001', description: '收集龙鳞',
          type: 'collect' as const, target: 'item_龙鳞_001', required: 1, current: 0, completed: false,
        }],
      });
      vi.spyOn(service as any, 'getQuest').mockResolvedValue(quest);

      const result = await service.checkFailConditions('save1', 'quest_测试任务_001', 'item_lost', {
        itemId: 'item_龙鳞_001',
      });

      expect(result).toBe(false);
    });

    it('通过物品名称匹配', async () => {
      const service = createService();
      const quest = createMockQuest({
        objectives: [{
          id: 'obj1', questId: 'quest_测试任务_001', description: '收集龙鳞',
          type: 'collect' as const, target: '龙鳞', required: 1, current: 0, completed: false,
        }],
      });
      vi.spyOn(service as any, 'getQuest').mockResolvedValue(quest);
      vi.spyOn(service as any, 'failQuest').mockResolvedValue(quest);

      const result = await service.checkFailConditions('save1', 'quest_测试任务_001', 'item_lost', {
        itemName: '龙鳞',
      });

      expect(result).toBe(true);
    });
  });

  describe('enemy_escapes 条件', () => {
    it('击杀目标敌人逃跑时任务失败', async () => {
      const service = createService();
      const quest = createMockQuest({
        objectives: [{
          id: 'obj1', questId: 'quest_测试任务_001', description: '击杀暗影刺客',
          type: 'kill' as const, target: 'npc_暗影刺客_001', required: 1, current: 0, completed: false,
        }],
      });
      vi.spyOn(service as any, 'getQuest').mockResolvedValue(quest);
      vi.spyOn(service as any, 'failQuest').mockResolvedValue(quest);

      const result = await service.checkFailConditions('save1', 'quest_测试任务_001', 'enemy_escapes', {
        enemyId: 'npc_暗影刺客_001',
      });

      expect(result).toBe(true);
      expect(service.failQuest).toHaveBeenCalledWith('save1', 'quest_测试任务_001');
    });

    it('非目标敌人逃跑时任务不失败', async () => {
      const service = createService();
      const quest = createMockQuest({
        objectives: [{
          id: 'obj1', questId: 'quest_测试任务_001', description: '击杀暗影刺客',
          type: 'kill' as const, target: 'npc_暗影刺客_001', required: 1, current: 0, completed: false,
        }],
      });
      vi.spyOn(service as any, 'getQuest').mockResolvedValue(quest);

      const result = await service.checkFailConditions('save1', 'quest_测试任务_001', 'enemy_escapes', {
        enemyId: 'npc_哥布林_002',
      });

      expect(result).toBe(false);
    });

    it('通过敌人名称匹配', async () => {
      const service = createService();
      const quest = createMockQuest({
        objectives: [{
          id: 'obj1', questId: 'quest_测试任务_001', description: '击杀暗影刺客',
          type: 'kill' as const, target: '暗影刺客', required: 1, current: 0, completed: false,
        }],
      });
      vi.spyOn(service as any, 'getQuest').mockResolvedValue(quest);
      vi.spyOn(service as any, 'failQuest').mockResolvedValue(quest);

      const result = await service.checkFailConditions('save1', 'quest_测试任务_001', 'enemy_escapes', {
        enemyName: '暗影刺客',
      });

      expect(result).toBe(true);
    });

    it('fail_conditions 不含 enemy_escapes 时不触发', async () => {
      const service = createService(['timeout', 'npc_death']);
      const quest = createMockQuest({
        objectives: [{
          id: 'obj1', questId: 'quest_测试任务_001', description: '击杀暗影刺客',
          type: 'kill' as const, target: 'npc_暗影刺客_001', required: 1, current: 0, completed: false,
        }],
      });
      vi.spyOn(service as any, 'getQuest').mockResolvedValue(quest);

      const result = await service.checkFailConditions('save1', 'quest_测试任务_001', 'enemy_escapes', {
        enemyId: 'npc_暗影刺客_001',
      });

      expect(result).toBe(false);
    });
  });

  describe('已有条件不受影响', () => {
    it('timeout 条件仍然正常工作', async () => {
      const service = createService();
      const quest = createMockQuest({
        timeLimit: 1000,
        createdAt: (Date.now() - 2000) as any,
      });
      vi.spyOn(service as any, 'getQuest').mockResolvedValue(quest);
      vi.spyOn(service as any, 'failQuest').mockResolvedValue(quest);

      const result = await service.checkFailConditions('save1', 'quest_测试任务_001', 'timeout');

      expect(result).toBe(true);
    });

    it('npc_death 条件仍然正常工作', async () => {
      const service = createService();
      const quest = createMockQuest({ giverNpcId: 'npc_村长_001' });
      vi.spyOn(service as any, 'getQuest').mockResolvedValue(quest);
      vi.spyOn(service as any, 'failQuest').mockResolvedValue(quest);

      const result = await service.checkFailConditions('save1', 'quest_测试任务_001', 'npc_death', {
        npcId: 'npc_村长_001',
      });

      expect(result).toBe(true);
    });
  });
});
