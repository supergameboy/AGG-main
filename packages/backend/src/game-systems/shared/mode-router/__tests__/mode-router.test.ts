import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ModeRouter } from '../mode-router.js';
import type { ISaveRepository, SaveRecord } from '../../../save/types.js';
import type { ID } from '@ai-rpg/shared';

/**
 * ModeRouter 单元测试
 *
 * 验证点：
 * - 根据 save.game_mode + intentHint 查 MODE_AGENT_MAPPING 返回候选 Agent
 * - challengeMode 从 save.active_challenge_mode 读取（nullish coalescing 兼容 undefined）
 * - save 不存在时抛错（禁止 fallback，符合 architecture-standards §13.3）
 * - 未映射的 intentHint 返回空数组（走 universal 组）
 * - reason 字符串包含 game_mode、intentHint、候选数量
 */

const mockSaveRepository = {
  findById: vi.fn(),
} as unknown as ISaveRepository;

/**
 * 创建完整 SaveRecord（覆盖测试所需字段，其余使用默认值）
 */
function makeSaveRecord(overrides: Partial<SaveRecord> = {}): SaveRecord {
  return {
    id: 'save-1',
    name: '测试存档',
    type: 'free',
    template_id: 'tpl-1',
    game_mode: 'text_adventure',
    chapter: '第一章',
    location: '起始村庄',
    level: 1,
    main_quest: '主线任务',
    play_time: 0,
    thumbnail: '',
    language: 'zh-CN',
    created_at: 0,
    updated_at: 0,
    active_challenge_mode: null,
    ...overrides,
  };
}

describe('ModeRouter', () => {
  let router: ModeRouter;

  beforeEach(() => {
    vi.clearAllMocks();
    router = new ModeRouter(mockSaveRepository);
  });

  describe('routeMode - 候选 Agent 映射', () => {
    it('text_adventure + combat → [gamemaster]，challengeMode=null', async () => {
      mockSaveRepository.findById.mockResolvedValue(
        makeSaveRecord({ game_mode: 'text_adventure' }),
      );

      const result = await router.routeMode('save-1' as ID, 'combat');

      expect(result.candidateAgentTypes).toEqual(['gamemaster']);
      expect(result.gameMode).toBe('text_adventure');
      expect(result.challengeMode).toBeNull();
    });

    it('text_rpg + combat → [challenge, gamemaster]', async () => {
      mockSaveRepository.findById.mockResolvedValue(
        makeSaveRecord({ game_mode: 'text_rpg' }),
      );

      const result = await router.routeMode('save-1' as ID, 'combat');

      expect(result.candidateAgentTypes).toEqual(['challenge', 'gamemaster']);
      expect(result.gameMode).toBe('text_rpg');
    });

    it('text_rpg + explore → [gamemaster]', async () => {
      mockSaveRepository.findById.mockResolvedValue(
        makeSaveRecord({ game_mode: 'text_rpg' }),
      );

      const result = await router.routeMode('save-1' as ID, 'explore');

      expect(result.candidateAgentTypes).toEqual(['gamemaster']);
    });

    it('rpg_2d + combat → [challenge, gamemaster]', async () => {
      mockSaveRepository.findById.mockResolvedValue(
        makeSaveRecord({ game_mode: 'rpg_2d' }),
      );

      const result = await router.routeMode('save-1' as ID, 'combat');

      expect(result.candidateAgentTypes).toEqual(['challenge', 'gamemaster']);
      expect(result.gameMode).toBe('rpg_2d');
    });

    it('sandbox + combat → [gamemaster]', async () => {
      mockSaveRepository.findById.mockResolvedValue(
        makeSaveRecord({ game_mode: 'sandbox' }),
      );

      const result = await router.routeMode('save-1' as ID, 'combat');

      expect(result.candidateAgentTypes).toEqual(['gamemaster']);
      expect(result.gameMode).toBe('sandbox');
    });

    it('visual_novel + dialogue → [gamemaster]', async () => {
      mockSaveRepository.findById.mockResolvedValue(
        makeSaveRecord({ game_mode: 'visual_novel' }),
      );

      const result = await router.routeMode('save-1' as ID, 'dialogue');

      expect(result.candidateAgentTypes).toEqual(['gamemaster']);
      expect(result.gameMode).toBe('visual_novel');
    });
  });

  describe('routeMode - challengeMode 读取（DF-007 持久化字段）', () => {
    it("active_challenge_mode = 'turn_based_combat' → challengeMode = 'turn_based_combat'", async () => {
      mockSaveRepository.findById.mockResolvedValue(
        makeSaveRecord({ active_challenge_mode: 'turn_based_combat' }),
      );

      const result = await router.routeMode('save-1' as ID, 'combat');

      expect(result.challengeMode).toBe('turn_based_combat');
    });

    it('active_challenge_mode = null → challengeMode = null', async () => {
      mockSaveRepository.findById.mockResolvedValue(
        makeSaveRecord({ active_challenge_mode: null }),
      );

      const result = await router.routeMode('save-1' as ID, 'combat');

      expect(result.challengeMode).toBeNull();
    });

    it('active_challenge_mode = undefined → challengeMode = null（nullish coalescing 兜底）', async () => {
      const save = makeSaveRecord();
      delete save.active_challenge_mode;
      mockSaveRepository.findById.mockResolvedValue(save);

      const result = await router.routeMode('save-1' as ID, 'combat');

      expect(result.challengeMode).toBeNull();
    });
  });

  describe('routeMode - 边界场景', () => {
    it('save 不存在时抛错 "存档不存在: {saveId}"（禁止 fallback）', async () => {
      mockSaveRepository.findById.mockResolvedValue(null);

      await expect(router.routeMode('nonexistent' as ID, 'combat')).rejects.toThrow(
        '存档不存在: nonexistent',
      );
    });

    it('未映射的 intentHint → 空候选数组（走 universal 组）', async () => {
      mockSaveRepository.findById.mockResolvedValue(
        makeSaveRecord({ game_mode: 'text_adventure' }),
      );

      const result = await router.routeMode('save-1' as ID, 'unknown_intent');

      expect(result.candidateAgentTypes).toEqual([]);
    });

    it('reason 字符串包含 game_mode、intentHint 和候选数量', async () => {
      mockSaveRepository.findById.mockResolvedValue(
        makeSaveRecord({ game_mode: 'text_rpg' }),
      );

      const result = await router.routeMode('save-1' as ID, 'combat');

      expect(result.reason).toContain('game_mode=text_rpg');
      expect(result.reason).toContain('intentHint=combat');
      expect(result.reason).toContain('2 个候选 Agent');
    });
  });

  describe('routeMode - 废弃别名归一化（2026-07-26 别名清理）', () => {
    it('turn_based_rpg → 归一化为 text_rpg，候选 [challenge, gamemaster]', async () => {
      mockSaveRepository.findById.mockResolvedValue(
        makeSaveRecord({ game_mode: 'turn_based_rpg' }),
      );

      const result = await router.routeMode('save-1' as ID, 'combat');

      expect(result.gameMode).toBe('text_rpg');
      expect(result.candidateAgentTypes).toEqual(['challenge', 'gamemaster']);
      // reason 字符串显示归一化过程
      expect(result.reason).toContain('game_mode=turn_based_rpg→text_rpg');
    });

    it('dynamic_combat → 归一化为 text_rpg', async () => {
      mockSaveRepository.findById.mockResolvedValue(
        makeSaveRecord({ game_mode: 'dynamic_combat' }),
      );

      const result = await router.routeMode('save-1' as ID, 'combat');

      expect(result.gameMode).toBe('text_rpg');
      expect(result.candidateAgentTypes).toEqual(['challenge', 'gamemaster']);
    });

    it('narrative_focus → 归一化为 text_rpg', async () => {
      mockSaveRepository.findById.mockResolvedValue(
        makeSaveRecord({ game_mode: 'narrative_focus' }),
      );

      const result = await router.routeMode('save-1' as ID, 'combat');

      expect(result.gameMode).toBe('text_rpg');
      // narrative_focus 原映射 combat=[gamemaster]，归一化为 text_rpg 后 combat=[challenge, gamemaster]
      // 这是预期行为：废弃别名归一化后行为与规范值一致
      expect(result.candidateAgentTypes).toEqual(['challenge', 'gamemaster']);
    });

    it('规范值不触发归一化（reason 不含 rawGameMode→canonical 模式）', async () => {
      mockSaveRepository.findById.mockResolvedValue(
        makeSaveRecord({ game_mode: 'text_rpg' }),
      );

      const result = await router.routeMode('save-1' as ID, 'combat');

      // 归一化未触发：reason 中 game_mode= 后直接跟规范值，不含 rawMode→canonical 形式
      expect(result.reason).toContain('game_mode=text_rpg +');
      expect(result.reason).not.toContain('text_rpg→');
    });
  });
});
