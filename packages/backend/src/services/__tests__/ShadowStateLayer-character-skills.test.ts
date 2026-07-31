/**
 * V1 单元测试：ShadowStateLayer 未注册表兜底修复
 *
 * 验证 bug-hunt-20260721-shadow-state-character-skills-missing 的修复方案 A.2：
 * ShadowStateLayer.apply update 分支末尾清理空 Map，避免污染 read 判定。
 *
 * 测试场景覆盖三类（参照 design-first.md 测试覆盖维度 + code-standards 反模式清单）：
 * - 正确情况：表已注册 + where 命中行 → read 返回更新后的行
 * - 错误情况：表未注册 + apply update → read 返回 undefined（允许 DB fallback），不返回 []
 * - 部分正确情况：表已注册 + where 不命中任何行 → read 返回 undefined（允许 DB fallback）
 *
 * BUG 现象（修复前，错误情况）：
 *   1. character_skills 表未注册到 SHADOW_STATE_TABLES
 *   2. apply('character_skills', 'update', {cooldownRemaining: 5}, {id: 'skill_1', save_id: 'save_1'})
 *   3. findMatchingPks 返回 []（baseSnapshot 无此表，pendingInserts 无此表）
 *   4. pendingUpdates['character_skills'] = new Map()（空 Map，但 truthy）
 *   5. read('character_skills', {id: 'skill_1', save_id: 'save_1'})
 *      → tableUpdates = pendingUpdates.get('character_skills') = 空 Map (truthy)
 *      → 不进入 `if (!tableInserts && !tableUpdates && !tableHasDeletes) return undefined;`
 *      → baseRows = baseSnapshot.get('character_skills') = undefined
 *      → results = []
 *      → return []  ← 权威空，禁止 DB fallback
 *   6. StagingKnex.first() 看到 [] 返回 undefined
 *   7. CharacterSkillRepository.update re-fetch 返回 null
 *   8. SkillService.setCooldown 抛 "Skill not found after cooldown update"
 *
 * 修复后预期（错误情况）：read 返回 undefined，StagingKnex.first fallback 到真实 DB
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShadowStateLayer } from '../ShadowStateLayer.js';

// Mock logger 避免真实日志输出
vi.mock('../../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('V1: ShadowStateLayer 未注册表兜底修复', () => {
  describe('正确情况：表已注册 + where 命中行', () => {
    let layer: ShadowStateLayer;

    beforeEach(() => {
      // 模拟真实场景：character_skills 表已注册到 SHADOW_STATE_TABLES
      // baseSnapshot 已通过 ensureSnapshot 预加载该表数据
      const mockDb = {
        'character_skills': () => ({
          where: () => Promise.resolve([
            {
              save_id: 'save_1',
              id: 'skill_奥术洞察_1784571718530_24',
              skill_id: 'arcane_insight',
              name: '奥术洞察',
              cooldown_remaining: 0,
              owner_type: 'character',
              owner_id: 'char_1',
              level: 1,
            },
          ]),
        }),
      } as unknown as ConstructorParameters<typeof ShadowStateLayer>[0];

      layer = new ShadowStateLayer(mockDb, { save_id: 'save_1' }, [
        { table: 'character_skills', scopeField: 'save_id' },
      ]);

      // 注入预加载的 baseSnapshot（模拟 ensureSnapshot 已执行）
      // 通过 apply insert 模拟，因 ensureSnapshot 是异步的，单元测试中直接构造状态
      // 这里采用更直接的方式：apply insert 一行，再 apply update，验证 read 返回合并后数据
    });

    it('character_skills 已注册 + update 命中行 → read 返回更新后的行', () => {
      // 1. 模拟 ensureSnapshot 预加载的 character_skills 行（通过 insert 注入）
      // 注意：真实路径是 ensureSnapshot 从 DB 读取，这里用 apply('insert') 模拟预加载状态
      layer.apply('character_skills', 'insert', {
        save_id: 'save_1',
        id: 'skill_奥术洞察_1784571718530_24',
        skill_id: 'arcane_insight',
        name: '奥术洞察',
        cooldown_remaining: 0,
        owner_type: 'character',
        owner_id: 'char_1',
        level: 1,
      });

      // 2. 模拟 setCooldown 调用 characterSkillRepo.update
      layer.apply('character_skills', 'update', {
        cooldown_remaining: 5,
      }, {
        save_id: 'save_1',
        id: 'skill_奥术洞察_1784571718530_24',
      });

      // 3. read 应返回合并后的行（cooldown_remaining 更新为 5）
      const result = layer.readOne('character_skills', {
        save_id: 'save_1',
        id: 'skill_奥术洞察_1784571718530_24',
      });

      expect(result).toBeDefined();
      expect(result!.cooldown_remaining).toBe(5);
      expect(result!.name).toBe('奥术洞察');
      expect(result!.level).toBe(1);  // 其他字段保持不变
    });

    it('character_skills 已注册 + 多次 update 同一行 → read 返回所有 update 的合并结果', () => {
      layer.apply('character_skills', 'insert', {
        save_id: 'save_1',
        id: 'skill_1',
        cooldown_remaining: 0,
        consecutive_uses: 0,
      });

      layer.apply('character_skills', 'update',
        { cooldown_remaining: 3 }, { save_id: 'save_1', id: 'skill_1' });
      layer.apply('character_skills', 'update',
        { consecutive_uses: 1 }, { save_id: 'save_1', id: 'skill_1' });

      const result = layer.readOne('character_skills', {
        save_id: 'save_1', id: 'skill_1',
      });

      expect(result).toBeDefined();
      expect(result!.cooldown_remaining).toBe(3);
      expect(result!.consecutive_uses).toBe(1);
    });
  });

  describe('错误情况：表未注册到 SHADOW_STATE_TABLES（修复重点）', () => {
    let layer: ShadowStateLayer;

    beforeEach(() => {
      // 模拟修复前的 BUG 场景：character_skills 表未注册到 SHADOW_STATE_TABLES
      // snapshotTables 不包含 character_skills
      const mockDb = {} as never;
      layer = new ShadowStateLayer(mockDb, { save_id: 'save_1' }, [
        // 故意不注册 character_skills
        { table: 'npcs', scopeField: 'save_id' },
      ]);
    });

    it('未注册表 + apply update → read 返回 undefined（不返回 []）', () => {
      // 这是修复的核心验证点：未注册表 apply update 后，read 必须返回 undefined

      // 1. apply update（模拟 CharacterSkillRepository.update 的 StagingKnex 拦截）
      layer.apply('character_skills', 'update', {
        cooldown_remaining: 5,
      }, {
        save_id: 'save_1',
        id: 'skill_奥术洞察_1784571718530_24',
      });

      // 2. read 必须返回 undefined（允许 DB fallback），而非 [] 权威空
      const result = layer.read('character_skills', {
        save_id: 'save_1',
        id: 'skill_奥术洞察_1784571718530_24',
      });

      // 修复后预期：undefined（允许 DB fallback）
      // 修复前 BUG：返回 []（权威空，禁止 DB fallback）
      expect(result).toBeUndefined();
    });

    it('未注册表 + apply update + readOne → 返回 undefined（不返回 undefined-in-array）', () => {
      layer.apply('character_skills', 'update',
        { cooldown_remaining: 5 },
        { save_id: 'save_1', id: 'skill_1' });

      const result = layer.readOne('character_skills', {
        save_id: 'save_1', id: 'skill_1',
      });

      expect(result).toBeUndefined();
    });

    it('未注册表 + apply update 后 apply insert 同表 → insert 仍正常工作', () => {
      // 验证防御性清理不影响后续 insert 路径
      layer.apply('character_skills', 'update',
        { cooldown_remaining: 5 },
        { save_id: 'save_1', id: 'skill_1' });

      // 即使 update 被清理，insert 仍应正常工作
      layer.apply('character_skills', 'insert', {
        save_id: 'save_1',
        id: 'skill_1',
        name: '奥术洞察',
        cooldown_remaining: 5,
      });

      const result = layer.readOne('character_skills', {
        save_id: 'save_1', id: 'skill_1',
      });

      expect(result).toBeDefined();
      expect(result!.name).toBe('奥术洞察');
      expect(result!.cooldown_remaining).toBe(5);
    });

    it('未注册表 + apply update 多次 → 每次都返回 undefined', () => {
      // 验证 shadow state 不会被污染（修复前 BUG：第一次 update 后所有 read 都返回 []）
      layer.apply('character_skills', 'update',
        { cooldown_remaining: 5 },
        { save_id: 'save_1', id: 'skill_1' });

      const result1 = layer.read('character_skills', { save_id: 'save_1' });
      expect(result1).toBeUndefined();

      // 第二次 update 不同的 skill
      layer.apply('character_skills', 'update',
        { cooldown_remaining: 3 },
        { save_id: 'save_1', id: 'skill_2' });

      const result2 = layer.read('character_skills', { save_id: 'save_1' });
      expect(result2).toBeUndefined();
    });
  });

  describe('部分正确情况：表已注册 + where 不命中任何行', () => {
    let layer: ShadowStateLayer;

    beforeEach(() => {
      // 表已注册到 SHADOW_STATE_TABLES，但 where 条件不命中任何行
      // 场景：skill_id 拼写错误，或 owner 过滤后无匹配
      const mockDb = {} as never;
      layer = new ShadowStateLayer(mockDb, { save_id: 'save_1' }, [
        { table: 'character_skills', scopeField: 'save_id' },
      ]);
    });

    it('已注册表 + where 不命中 → read 返回 undefined（允许 DB fallback）', () => {
      // 场景：character_skills 表已注册但 baseSnapshot 为空（DB 中无此 save_id 的 skill），
      //       LLM 传入错误的 skill_id，apply update 无匹配行
      layer.apply('character_skills', 'update',
        { cooldown_remaining: 5 },
        { save_id: 'save_1', id: 'skill_不存在_123' });

      const result = layer.read('character_skills', {
        save_id: 'save_1', id: 'skill_不存在_123',
      });

      // 期望：undefined（允许 DB fallback，由真实 DB 返回空）
      expect(result).toBeUndefined();
    });

    it('已注册表 + 部分行命中 + 部分行不命中 → read 返回命中的行', () => {
      // 场景：baseSnapshot 有 skill_1，但 update where 命中 skill_1 和不存在的 skill_2
      //       匹配到 skill_1 的 update 应正常工作

      // 注入 skill_1
      layer.apply('character_skills', 'insert', {
        save_id: 'save_1',
        id: 'skill_1',
        name: '奥术洞察',
        cooldown_remaining: 0,
      });

      // update where 仅命中 skill_1（skill_2 不存在，不会污染）
      layer.apply('character_skills', 'update',
        { cooldown_remaining: 5 },
        { save_id: 'save_1', id: 'skill_1' });

      // 第二次 update 不存在的 skill_2
      layer.apply('character_skills', 'update',
        { cooldown_remaining: 3 },
        { save_id: 'save_1', id: 'skill_2' });

      // read skill_1 应正常返回更新后的数据
      const result1 = layer.readOne('character_skills', {
        save_id: 'save_1', id: 'skill_1',
      });
      expect(result1).toBeDefined();
      expect(result1!.cooldown_remaining).toBe(5);

      // read skill_2 应返回 undefined（不存在且未匹配）
      const result2 = layer.readOne('character_skills', {
        save_id: 'save_1', id: 'skill_2',
      });
      expect(result2).toBeUndefined();
    });

    it('已注册表 + update 无 where（应匹配所有行）→ read 返回所有行更新后的数据', () => {
      // 注入 2 行
      layer.apply('character_skills', 'insert', {
        save_id: 'save_1', id: 'skill_1', cooldown_remaining: 0,
      });
      layer.apply('character_skills', 'insert', {
        save_id: 'save_1', id: 'skill_2', cooldown_remaining: 0,
      });

      // 无 where 的 update 应匹配所有行（findMatchingPks 返回所有 PK）
      layer.apply('character_skills', 'update',
        { cooldown_remaining: 99 },
        undefined);

      const results = layer.read('character_skills', { save_id: 'save_1' });
      expect(results).toBeDefined();
      expect(results!.length).toBe(2);
      for (const row of results!) {
        expect((row as Record<string, unknown>).cooldown_remaining).toBe(99);
      }
    });
  });

  describe('回归验证：getSnapshotSummary 在防御性清理后仍正确工作', () => {
    it('未注册表 apply update → getSnapshotSummary 不显示该表', () => {
      const mockDb = {} as never;
      const layer = new ShadowStateLayer(mockDb, { save_id: 'save_1' }, [
        { table: 'npcs', scopeField: 'save_id' },
      ]);

      // 未注册表 update（应被清理，不出现在摘要）
      layer.apply('character_skills', 'update',
        { cooldown_remaining: 5 },
        { save_id: 'save_1', id: 'skill_1' });

      // 已注册表 insert（应出现在摘要）
      layer.apply('npcs', 'insert', {
        save_id: 'save_1', id: 'npc_1', name: '村长',
      });

      const summary = layer.getSnapshotSummary();

      // 摘要应包含 npcs 的 INSERT
      expect(summary).toContain('[npcs]');
      expect(summary).toContain('村长');
      // 摘要不应包含 character_skills（已被清理）
      expect(summary).not.toContain('character_skills');
    });
  });
});
