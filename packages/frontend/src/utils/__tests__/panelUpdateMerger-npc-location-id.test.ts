import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPanelUpdates, type MergeableState } from '../panelUpdateMerger';

/**
 * Bug 20260721 修复回归测试：panelUpdateMerger 的 NPC locationId 同步。
 *
 * 根因：后端推送的 NPCData.location 实际携带 location ID，前端 merger 只把它
 * 解析为名称存到 FrontendNPCInfo.location，未同步到 locationId 字段。
 * 导致 MapPanel.tsx 依赖 npc.locationId 过滤当前位置 NPC 时，新 NPC 被过滤掉。
 *
 * 修复：mapNPCDataToNew / mapNPCDataToExisting 同时维护 location（名称）和
 * locationId（ID）两个字段。locationId 优先取 data.locationId，fallback 到 data.location。
 */

function createState(locations: Array<{ id: string; name: string }> = []): MergeableState {
  return {
    player: null,
    inventory: [],
    quests: [],
    combat: {
      active: true,
      playerHP: 100,
      playerMaxHP: 100,
      playerMP: 20,
      playerMaxMP: 20,
      isPlayerTurn: true,
      currentTurn: 1,
      availableActions: [],
      enemies: [],
      log: [],
    } as any,
    mapState: {
      currentLocationId: 'loc_白杨村广场_1784571637682_6',
      discoveredLocationIds: [],
      locations,
      connections: [],
    } as any,
    skills: [],
    npcInfoList: [],
  };
}

describe('panelUpdateMerger — NPC locationId 同步（Bug 20260721）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('新 NPC 推送（带 locationId）应同时填充 locationId 和 location', () => {
    const state = createState([
      { id: 'loc_白杨村广场_1784571637682_6', name: '白杨村广场' },
    ]);

    applyPanelUpdates(state, {
      npc: {
        nearby: [
          {
            id: 'npc_采药人罗恩_1784572228240_74',
            name: '采药人罗恩',
            locationId: 'loc_白杨村广场_1784571637682_6',
            location: 'loc_白杨村广场_1784571637682_6',
          },
        ],
      },
    } as any);

    expect(state.npcInfoList).toHaveLength(1);
    const npc = state.npcInfoList[0];
    expect(npc.id).toBe('npc_采药人罗恩_1784572228240_74');
    // 关键断言：locationId 必须被填充为 location ID
    expect(npc.locationId).toBe('loc_白杨村广场_1784571637682_6');
    // location 字段应为可读名称（通过 locationLookup 解析）
    expect(npc.location).toBe('白杨村广场');
  });

  it('新 NPC 推送（仅 location 兼容旧后端）应 fallback 到 location 作为 locationId', () => {
    const state = createState([
      { id: 'loc_白杨村广场_1784571637682_6', name: '白杨村广场' },
    ]);

    applyPanelUpdates(state, {
      npc: {
        nearby: [
          {
            id: 'npc_采药人罗恩_1784572228240_74',
            name: '采药人罗恩',
            // 模拟旧后端：只有 location 字段，没有 locationId
            location: 'loc_白杨村广场_1784571637682_6',
          },
        ],
      },
    } as any);

    expect(state.npcInfoList).toHaveLength(1);
    const npc = state.npcInfoList[0];
    // 关键断言：fallback 到 location 字段作为 locationId
    expect(npc.locationId).toBe('loc_白杨村广场_1784571637682_6');
    expect(npc.location).toBe('白杨村广场');
  });

  it('新 NPC 推送（loc_xxx 格式 ID 无 locationLookup）应通过 ID 解析名称', () => {
    const state = createState([]); // 空 locationLookup

    applyPanelUpdates(state, {
      npc: {
        nearby: [
          {
            id: 'npc_采药人罗恩_1784572228240_74',
            name: '采药人罗恩',
            locationId: 'loc_白杨村广场_1784571637682_6',
          },
        ],
      },
    } as any);

    const npc = state.npcInfoList[0];
    expect(npc.locationId).toBe('loc_白杨村广场_1784571637682_6');
    // 无 lookup 时通过 ID 格式解析（loc_<name>_<timestamp>_<seq> → <name>_<timestamp>）
    // resolveLocationName 用 parts.slice(1, -1).join('_')，保留中间段
    expect(npc.location).toBe('白杨村广场_1784571637682');
  });

  it('更新已存在 NPC 时应同步更新 locationId 字段', () => {
    const state = createState([
      { id: 'loc_白杨村广场_1784571637682_6', name: '白杨村广场' },
      { id: 'loc_铁匠铺_1784571637700_8', name: '铁匠铺' },
    ]);
    // 预置已存在 NPC，原位置为白杨村广场
    state.npcInfoList = [
      {
        id: 'npc_采药人罗恩_1784572228240_74',
        name: '采药人罗恩',
        locationId: 'loc_白杨村广场_1784571637682_6',
        location: '白杨村广场',
        inParty: false,
        visible: true,
      } as any,
    ];

    applyPanelUpdates(state, {
      npc: {
        nearby: [
          {
            id: 'npc_采药人罗恩_1784572228240_74',
            name: '采药人罗恩',
            // NPC 移动到铁匠铺
            locationId: 'loc_铁匠铺_1784571637700_8',
            location: 'loc_铁匠铺_1784571637700_8',
          },
        ],
      },
    } as any);

    expect(state.npcInfoList).toHaveLength(1);
    const npc = state.npcInfoList[0];
    // 关键断言：locationId 同步更新为新位置 ID
    expect(npc.locationId).toBe('loc_铁匠铺_1784571637700_8');
    expect(npc.location).toBe('铁匠铺');
  });

  it('更新已存在 NPC 时（仅 location 兼容旧后端）也应同步 locationId', () => {
    const state = createState([
      { id: 'loc_白杨村广场_1784571637682_6', name: '白杨村广场' },
      { id: 'loc_铁匠铺_1784571637700_8', name: '铁匠铺' },
    ]);
    state.npcInfoList = [
      {
        id: 'npc_采药人罗恩_1784572228240_74',
        name: '采药人罗恩',
        locationId: 'loc_白杨村广场_1784571637682_6',
        location: '白杨村广场',
        inParty: false,
        visible: true,
      } as any,
    ];

    applyPanelUpdates(state, {
      npc: {
        nearby: [
          {
            id: 'npc_采药人罗恩_1784572228240_74',
            name: '采药人罗恩',
            // 模拟旧后端：只有 location 字段
            location: 'loc_铁匠铺_1784571637700_8',
          },
        ],
      },
    } as any);

    const npc = state.npcInfoList[0];
    expect(npc.locationId).toBe('loc_铁匠铺_1784571637700_8');
    expect(npc.location).toBe('铁匠铺');
  });

  it('NPC 推送不携带任何 location 信息时应保留 existing 的 locationId 不变', () => {
    const state = createState([
      { id: 'loc_白杨村广场_1784571637682_6', name: '白杨村广场' },
    ]);
    state.npcInfoList = [
      {
        id: 'npc_采药人罗恩_1784572228240_74',
        name: '采药人罗恩',
        locationId: 'loc_白杨村广场_1784571637682_6',
        location: '白杨村广场',
        inParty: false,
        visible: true,
      } as any,
    ];

    // 推送只更新 mood，不带 location/locationId
    applyPanelUpdates(state, {
      npc: {
        nearby: [
          {
            id: 'npc_采药人罗恩_1784572228240_74',
            name: '采药人罗恩',
            mood: 80,
          },
        ],
      },
    } as any);

    const npc = state.npcInfoList[0];
    // locationId 不应被破坏
    expect(npc.locationId).toBe('loc_白杨村广场_1784571637682_6');
    expect(npc.location).toBe('白杨村广场');
    expect(npc.mood).toBe(80);
  });

  it('模拟 MapPanel 过滤逻辑：新创建的 NPC 应能被当前位置过滤命中', () => {
    const state = createState([
      { id: 'loc_白杨村广场_1784571637682_6', name: '白杨村广场' },
    ]);

    applyPanelUpdates(state, {
      npc: {
        nearby: [
          {
            id: 'npc_采药人罗恩_1784572228240_74',
            name: '采药人罗恩',
            locationId: 'loc_白杨村广场_1784571637682_6',
            location: 'loc_白杨村广场_1784571637682_6',
          },
        ],
      },
    } as any);

    // 复制 MapPanel.tsx:63-72 的过滤逻辑
    const currentLocationId = 'loc_白杨村广场_1784571637682_6';
    const npcsAtCurrentLocation = state.npcInfoList.filter(
      (npc) => npc.locationId === currentLocationId,
    );

    expect(npcsAtCurrentLocation.map((n) => n.name)).toEqual(['采药人罗恩']);
  });
});
