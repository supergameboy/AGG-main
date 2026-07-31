/**
 * V2 集成测试：use_skill 在 StagingPool 启用时不抛 "Skill not found after cooldown update"
 *
 * 验证 bug-hunt-20260721-shadow-state-character-skills-missing 的修复方案 A.1 + A.2：
 * 1. character_skills 表注册到 SHADOW_STATE_TABLES（A.1）
 * 2. ShadowStateLayer.apply update 末尾清理空 Map（A.2 防御补强）
 *
 * 测试覆盖三类（参照 design-first.md 测试覆盖维度）：
 * - 正确情况：use_skill 成功设置冷却，返回 success: true
 * - 错误情况（修复前）：use_skill 抛 "Skill not found after cooldown update"
 * - 部分正确情况：skill 不存在时返回 success: false, error: "Skill not found: xxx"（非 update 抛错）
 *
 * 测试架构：
 * - 真实 SQLite 内存 DB（runMigrations 创建完整 schema）
 * - 真实 ShadowStateLayer + StagingPool + StagingKnex 代理
 * - 真实 CharacterSkillRepository（通过代理 db）
 * - 真实 CharacterSkillRow 数据（baseSnapshot 预加载）
 * - SkillService 其他依赖 mock（characterService/npcService/inventoryService/saveRepo/txManager）
 *
 * 失败链路（修复前）：
 *   LLM → use_skill → SkillService.useSkill → setCooldown
 *     → CharacterSkillRepository.update（StagingKnex 代理）
 *     → StagingKnex 拦截 update → shadowState.apply（空 Map 污染）
 *     → re-fetch 走 StagingKnex.first → shadowState.read 返回 []
 *     → first() 返回 undefined → update 返回 null
 *     → setCooldown 抛 "Skill not found after cooldown update"
 *
 * 修复后期望：
 *   - character_skills 注册到 SHADOW_STATE_TABLES → ensureSnapshot 预加载该表
 *   - apply update 命中 PK → pendingUpdates 填充非空 Map
 *   - read 返回更新后的行 → first() 返回 row → update 返回 entity
 *   - setCooldown 成功 → useSkill 返回 success: true
 */
import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../../migrations/runner.js';
import { ShadowStateLayer } from '../../../services/ShadowStateLayer.js';
import { StagingPool } from '../../../services/StagingPool.js';
import { createStagingKnex } from '@ai-rpg/shared/tool-core';
import type { IDevTraceHook } from '@ai-rpg/shared/tool-core';
import { CharacterSkillRepository } from '../CharacterSkillRepository.js';
import { SkillService } from '../SkillService.js';
import { TemplateRuleParser } from '../../shared/rule-parser/TemplateRuleParser.js';

const mockDevTraceHook: IDevTraceHook = {
  emit: vi.fn(),
};

const SAVE_ID = 'save-skill-staging-test';
const CHARACTER_ID = 'char_1';
const NOW = 1_700_000_000_000;
const SKILL_ID = 'skill_奥术洞察_1784571718530_24';
const SKILL_POOL_ID = 'arcane_insight';

/**
 * 构造测试上下文：真实 SQLite 内存 DB + 真实 StagingPool/ShadowStateLayer + StagingKnex 代理 db。
 * character_skills 表配置 scopeField='save_id'（与 init.ts SHADOW_STATE_TABLES 配置一致）。
 */
async function buildContext(options?: { registerCharacterSkills?: boolean }) {
  const registerCharacterSkills = options?.registerCharacterSkills ?? true;

  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await runMigrations(db);

  // 插入 save（character_skills 的 FK 依赖）
  await db('saves').insert({
    id: SAVE_ID,
    name: 'skill-staging-test',
    template_id: 'tpl-1',
    game_mode: 'turn_based_rpg',
    chapter: '',
    location: '',
    level: 1,
    main_quest: '',
    play_time: 0,
    thumbnail: '',
    created_at: NOW,
    updated_at: NOW,
  });

  // 插入 character（owner_id FK 指向 characters.id，但 character_skills 表无 FK 约束，仅逻辑关联）
  await db('characters').insert({
    save_id: SAVE_ID,
    id: CHARACTER_ID,
    current_location_id: 'village-square',
    name: '主角',
    race: '人类',
    class: '法师',
    background: '奥术学院学生',
    level: 1,
    experience: 0,
    attributes: '{}',
    derived_attributes: '{}',
    current_hp: 100,
    max_hp: 100,
    current_mp: 50,
    max_mp: 50,
    currency: '{}',
    status: '{}',
    custom_data: '{}',
    created_at: NOW,
    updated_at: NOW,
  });

  // 插入测试 skill（模拟玩家学得的奥术洞察）
  await db('character_skills').insert({
    save_id: SAVE_ID,
    id: SKILL_ID,
    skill_id: SKILL_POOL_ID,
    category: 'spell',
    effects: JSON.stringify({ cooldown_turns: 2 }),
    element: 'arcane',
    experience: 0,
    cost: JSON.stringify([]),  // 无消耗，简化测试
    max_level: 10,
    name: '奥术洞察',
    description: '洞察目标弱点',
    level: 1,
    cooldown_remaining: 0,
    unlocked: 1,
    visible: 1,
    custom_data: '{}',
    pool_id: SKILL_POOL_ID,
    owner_id: CHARACTER_ID,
    owner_type: 'character',
    consecutive_uses: 0,
    last_used_at: 0,
    created_at: NOW,
    updated_at: NOW,
  });

  // ShadowStateLayer 配置
  // - 修复后（registerCharacterSkills=true）：character_skills 已注册
  // - 修复前 BUG 复现（registerCharacterSkills=false）：character_skills 未注册
  const snapshotTables = registerCharacterSkills
    ? [
        { table: 'character_skills', scopeField: 'save_id' },
        { table: 'characters', scopeField: 'save_id' },
      ]
    : [
        { table: 'characters', scopeField: 'save_id' },
      ];

  const shadowState = new ShadowStateLayer(db, { save_id: SAVE_ID }, snapshotTables);
  await shadowState.ensureSnapshot();

  const stagingPool = new StagingPool(mockDevTraceHook);
  stagingPool.bindShadowState(shadowState);

  const proxyDb = createStagingKnex(db, {
    stagingPool,
    shadowState,
    toolType: 'gamemaster',
    method: 'use_skill',
    source: 'gamemaster',
  });

  // 通过代理 db 创建 Repository（模拟 SkillServiceTool.buildSkillService 路径）
  const characterSkillRepo = new CharacterSkillRepository(proxyDb);

  return { db, shadowState, stagingPool, proxyDb, characterSkillRepo };
}

/**
 * 构造 SkillService（其他依赖 mock）。
 * - characterService: getCharacterBasicInfo 返回 characterId
 * - characterService.getCharacter: 返回 attributes（用于 damage scaling）
 * - npcService: 仅占位，use_skill 不传 targetId 时不调用
 * - inventoryService: 仅占位
 * - saveRepo: getTemplateIdBySaveId 返回 null（跳过模板池回写）
 * - txManager: 简单事务包装，传入 proxyDb 作为 trx（SQLite 中 transaction 即 db 代理）
 * - ruleParser: cooldown_system='turn'，无 weight cooldown
 */
function buildSkillService(characterSkillRepo: CharacterSkillRepository, proxyDb: knex.Knex) {
  const characterService = {
    getCharacterBasicInfo: vi.fn().mockResolvedValue({
      characterId: CHARACTER_ID,
      currency: { gold: 100 },
    }),
    getCharacter: vi.fn().mockResolvedValue({ attributes: { intelligence: 10 } }),
    modifyHealth: vi.fn().mockResolvedValue({ previous: 100, current: 100, max: 100 }),
  } as any;

  const npcService = {
    resolveNpcId: vi.fn(),
    modifyNpcHealth: vi.fn(),
  } as any;

  const inventoryService = {} as any;

  const saveRepo = {
    getTemplateIdBySaveId: vi.fn().mockResolvedValue(null),  // 跳过模板池回写
  } as any;

  // txManager: 传入 proxyDb 作为 trx
  // 真实 TransactionManager.transaction(work) 会创建一个事务并传入 trx
  // SQLite 中事务通过 BEGIN/COMMIT 实现，trx 与 db 实例等价
  // 测试中直接传入 proxyDb，让 Repository.query(trx) 使用代理 db
  const txManager = {
    transaction: vi.fn(async (cb: (trx: any) => Promise<any>) => cb(proxyDb)),
  } as any;

  // ruleParser: cooldown_system='turn'（触发 setCooldown 路径）
  const ruleParser = {
    getSkillRules: () => ({
      cooldown_system: 'turn',
      upgrade_cost: { base: 100, multiplier: 1.5 },
    }),
    getWeightCooldownConfig: () => null,  // 无 weight cooldown
  } as unknown as TemplateRuleParser;

  const skillService = new SkillService(
    {} as any,  // skillPoolRepo（saveRepo.getTemplateIdBySaveId 返回 null 时不会调用）
    characterSkillRepo,
    characterService,
    npcService,
    inventoryService,
    saveRepo,
    txManager,
    ruleParser,
    null,  // templateService（让 damage 走 customData 分支）
    null,  // templatePoolService
  );

  return { skillService, characterService, npcService };
}

describe('V2 集成测试：use_skill 在 StagingPool 启用时不抛错', () => {
  let db: knex.Knex;

  afterEach(async () => {
    if (db) await db.destroy();
  });

  describe('正确情况：character_skills 已注册 → use_skill 成功', () => {
    beforeEach(() => {
      // 每个 it 重建 context，避免状态污染
    });

    it('use_skill 成功设置冷却，返回 success: true', async () => {
      const ctx = await buildContext({ registerCharacterSkills: true });
      db = ctx.db;
      const { skillService } = buildSkillService(ctx.characterSkillRepo, ctx.proxyDb);

      // 执行 use_skill（trigger setCooldown 路径）
      const result = await skillService.useSkill(
        SAVE_ID as any,
        SKILL_ID,  // skillId（character_skills.id）
        undefined,  // targetId（不传，不应用伤害）
        'character',  // ownerType
        CHARACTER_ID,  // ownerId
      );

      // 修复后预期：success: true
      expect(result.success).toBe(true);
      expect(result.skill).toBeDefined();
      expect(result.skill!.cooldownRemaining).toBe(2);  // cooldown_turns=2
      expect(result.cooldownSet).toBe(2);
    });

    it('use_skill 设置冷却后，ShadowState 已同步更新（同请求内查询返回新值）', async () => {
      const ctx = await buildContext({ registerCharacterSkills: true });
      db = ctx.db;
      const { skillService } = buildSkillService(ctx.characterSkillRepo, ctx.proxyDb);

      // 第一次 use_skill
      await skillService.useSkill(
        SAVE_ID as any, SKILL_ID, undefined, 'character', CHARACTER_ID,
      );

      // 通过代理 db 查询 ShadowState（验证同请求内可见性）
      const row = await ctx.proxyDb('character_skills')
        .where({ save_id: SAVE_ID, id: SKILL_ID })
        .first();

      expect(row).toBeDefined();
      expect(row.cooldown_remaining).toBe(2);  // 已更新为 2
    });
  });

  describe('错误情况复现：character_skills 未注册 → 防御补强后不抛错', () => {
    it('未注册表 + use_skill → 防御补强使 setCooldown 不抛错（fallback DB 返回旧值）', async () => {
      // 场景：复现修复前的 BUG 配置（character_skills 未注册）
      // 修复后的 ShadowStateLayer.apply 会清理空 Map，使 read 返回 undefined
      // → StagingKnex.first fallback DB → 返回真实行（但 UPDATE 尚未 flush，故为旧值）
      //
      // 注意：此场景验证 A.2 防御补强——防止 setCooldown 抛错。
      // 但 A.2 单独无法保证数据可见性——返回的 cooldownRemaining 仍是旧值（0），
      // 因为 UPDATE 尚未 flush 到 DB。完整修复需 A.1（注册表）。
      const ctx = await buildContext({ registerCharacterSkills: false });
      db = ctx.db;
      const { skillService } = buildSkillService(ctx.characterSkillRepo, ctx.proxyDb);

      // 修复后预期：不抛 "Skill not found after cooldown update"
      // 防御补强使 re-fetch fallback 到真实 DB，返回旧行（cooldownRemaining=0）
      const result = await skillService.useSkill(
        SAVE_ID as any, SKILL_ID, undefined, 'character', CHARACTER_ID,
      );

      expect(result.success).toBe(true);
      expect(result.skill).toBeDefined();
      // A.2 单独的局限：返回的 skill 仍是旧值（DB 未 flush）
      // 完整修复需 A.1（注册表），此处仅验证不抛错
      expect(result.skill!.cooldownRemaining).toBe(0);
    });
  });

  describe('部分正确情况：skill 不存在 → 返回明确错误（非 update 抛错）', () => {
    it('use_skill 传入不存在的 skillId → 返回 success: false, error: "Skill not found: xxx"', async () => {
      const ctx = await buildContext({ registerCharacterSkills: true });
      db = ctx.db;
      const { skillService } = buildSkillService(ctx.characterSkillRepo, ctx.proxyDb);

      const result = await skillService.useSkill(
        SAVE_ID as any,
        'skill_不存在_12345',  // 不存在的 skillId
        undefined,
        'character',
        CHARACTER_ID,
      );

      // 修复后预期：返回 success: false（findBySkillIdOrName 返回 null）
      // 不应抛 "Skill not found after cooldown update"（那是 update re-fetch 失败的错误）
      expect(result.success).toBe(false);
      expect(result.error).toContain('Skill not found');
      // 关键：错误信息是 "Skill not found: xxx"（findBySkillIdOrName 阶段）
      // 而非 "Skill not found after cooldown update"（update re-fetch 阶段）
      expect(result.error).not.toContain('after cooldown update');
    });

    it('use_skill 传入 name（非 id）→ findBySkillIdOrName 兼容 name 查询', async () => {
      const ctx = await buildContext({ registerCharacterSkills: true });
      db = ctx.db;
      const { skillService } = buildSkillService(ctx.characterSkillRepo, ctx.proxyDb);

      // 传入技能名称（findBySkillIdOrName 应兼容 name 查询）
      const result = await skillService.useSkill(
        SAVE_ID as any,
        '奥术洞察',  // name 而非 id
        undefined,
        'character',
        CHARACTER_ID,
      );

      expect(result.success).toBe(true);
      expect(result.skill).toBeDefined();
      expect(result.skill!.name).toBe('奥术洞察');
    });
  });

  describe('回归验证：StagingPool flush 后数据正确落库', () => {
    it('use_skill 后 StagingPool.flush → 真实 DB 中 cooldown_remaining 已更新', async () => {
      const ctx = await buildContext({ registerCharacterSkills: true });
      db = ctx.db;
      const { skillService } = buildSkillService(ctx.characterSkillRepo, ctx.proxyDb);

      await skillService.useSkill(
        SAVE_ID as any, SKILL_ID, undefined, 'character', CHARACTER_ID,
      );

      // flush StagingPool（将 pending changes 落库）
      // IWriteQueue 需要 enqueueFn + getDb 两个方法
      const writeQueue = {
        enqueueFn: async <T>(fn: () => Promise<T>) => fn(),
        getDb: () => ctx.db,
      } as any;
      await ctx.stagingPool.flush(writeQueue);

      // 通过原始 db（非代理）查询，验证数据已落库
      const row = await db('character_skills')
        .where({ save_id: SAVE_ID, id: SKILL_ID })
        .first();

      expect(row).toBeDefined();
      expect(row.cooldown_remaining).toBe(2);
    });
  });
});
