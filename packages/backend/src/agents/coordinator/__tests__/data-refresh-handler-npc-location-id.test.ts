import { describe, expect, it } from 'vitest';
import { createNPCRefreshConfig } from '../DataRefreshHandler';
import type { INPCRepository, NPCProfile } from '../../../game-systems/npc/types';

/**
 * Bug 20260721 修复回归测试：DataRefreshHandler 的 mapNpcProfileToNpcData
 * 必须同时填充 NPCData.locationId 和 NPCData.location（同值）。
 *
 * 根因：后端推送的 NPCData.location 实际携带 location ID，但接口语义模糊。
 * 修复：新增 NPCData.locationId 字段明确语义，mapNpcProfileToNpcData 双填两个字段。
 */

function createMockNpcRepo(npcs: NPCProfile[]): INPCRepository {
  return {
    findBySaveId: async () => npcs,
  } as unknown as INPCRepository;
}

function makeNpcProfile(overrides: Partial<NPCProfile> = {}): NPCProfile {
  return {
    id: 'npc_采药人罗恩_1784572228240_74',
    saveId: 'save_人类_1784571558052_0',
    templateNpcId: null,
    name: '采药人罗恩',
    title: '',
    description: '一位采药人',
    role: 'merchant',
    race: 'human',
    locationId: 'loc_白杨村广场_1784571637682_6',
    level: 1,
    services: [{ type: 'trade', name: '药草交易' }],
    dialogueHistory: [],
    reputation: 0,
    mood: 50,
    inParty: false,
    visible: true,
    attrInitialized: false,
    invInitialized: false,
    skillInitialized: false,
    visibility: 'visible',
    attributes: {},
    derivedAttributes: {},
    currentHp: 100,
    maxHp: 100,
    currentMp: 50,
    maxMp: 50,
    customData: {},
    ...overrides,
  } as unknown as NPCProfile;
}

describe('DataRefreshHandler — mapNpcProfileToNpcData locationId 填充（Bug 20260721）', () => {
  it('refresh 返回的 nearby NPC 应同时包含 locationId 和 location（同值）', async () => {
    const npc = makeNpcProfile();
    const repos = { npcRepo: createMockNpcRepo([npc]) } as any;
    const config = createNPCRefreshConfig();

    const result = await config.refresh(repos, 'save_人类_1784571558052_0' as any, undefined);

    expect(result?.nearby).toHaveLength(1);
    const npcData = result!.nearby![0];
    // 关键断言：locationId 字段必须被填充为 NPCProfile.locationId
    expect(npcData.locationId).toBe('loc_白杨村广场_1784571637682_6');
    // location 字段保留兼容（与 locationId 同值）
    expect(npcData.location).toBe('loc_白杨村广场_1784571637682_6');
  });

  it('NPCProfile.locationId 为 null 时 locationId 和 location 都应为 undefined', async () => {
    const npc = makeNpcProfile({ locationId: null });
    const repos = { npcRepo: createMockNpcRepo([npc]) } as any;
    const config = createNPCRefreshConfig();

    const result = await config.refresh(repos, 'save_人类_1784571558052_0' as any, undefined);

    const npcData = result!.nearby![0];
    expect(npcData.locationId).toBeUndefined();
    expect(npcData.location).toBeUndefined();
  });

  it('refresh 合并已存在 nearby 时应保留新刷新 NPC 的 locationId 字段', async () => {
    const npc = makeNpcProfile();
    const repos = { npcRepo: createMockNpcRepo([npc]) } as any;
    const config = createNPCRefreshConfig();

    // 模拟 existing.nearby 已有同 ID NPC，但 locationId 缺失（修复前的状态）
    const existing = {
      nearby: [
        {
          id: 'npc_采药人罗恩_1784572228240_74',
          name: '采药人罗恩',
          // 修复前：只有 location 字段，没有 locationId
          location: 'loc_白杨村广场_1784571637682_6',
        },
      ],
    };

    const result = await config.refresh(repos, 'save_人类_1784571558052_0' as any, existing as any);

    const npcData = result!.nearby![0];
    // 关键断言：合并后 locationId 字段必须被填充
    expect(npcData.locationId).toBe('loc_白杨村广场_1784571637682_6');
    expect(npcData.location).toBe('loc_白杨村广场_1784571637682_6');
  });

  it('refresh 多个 NPC 时每个 NPC 都应填充 locationId', async () => {
    const npcs = [
      makeNpcProfile({
        id: 'npc_采药人罗恩_1784572228240_74',
        name: '采药人罗恩',
        locationId: 'loc_白杨村广场_1784571637682_6',
      }),
      makeNpcProfile({
        id: 'npc_铁匠加雷斯_1784572000000_10',
        name: '铁匠加雷斯',
        locationId: 'loc_铁匠铺_1784571637700_8',
      }),
      makeNpcProfile({
        id: 'npc_村长艾德温_1784571558000_2',
        name: '村长艾德温',
        locationId: 'loc_村长宅邸_1784571637900_5',
      }),
    ];
    const repos = { npcRepo: createMockNpcRepo(npcs) } as any;
    const config = createNPCRefreshConfig();

    const result = await config.refresh(repos, 'save_人类_1784571558052_0' as any, undefined);

    expect(result?.nearby).toHaveLength(3);
    const locationIds = result!.nearby!.map((n) => n.locationId);
    expect(locationIds).toEqual([
      'loc_白杨村广场_1784571637682_6',
      'loc_铁匠铺_1784571637700_8',
      'loc_村长宅邸_1784571637900_5',
    ]);
    // location 字段与 locationId 同值
    const locations = result!.nearby!.map((n) => n.location);
    expect(locations).toEqual(locationIds);
  });
});
