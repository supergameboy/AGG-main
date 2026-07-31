import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPanelUpdates, isValidEntityIdFor, type MergeableState } from '../panelUpdateMerger';

function createState(): MergeableState {
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
      currentLocationId: 'start',
      discoveredLocationIds: [],
      locations: [],
      connections: [],
    } as any,
    skills: [],
    npcInfoList: [],
  };
}

describe('panelUpdateMerger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('应保留后端生成的 enemy-0 战斗敌人 ID', () => {
    const state = createState();

    applyPanelUpdates(state, {
      combat: {
        enemies: [
          {
            id: 'enemy-0',
            name: 'Slime',
            hp: 12,
            maxHP: 12,
            level: 1,
            status: [],
          },
        ],
      },
    } as any);

    expect(state.combat?.enemies.map((enemy) => enemy.id)).toEqual(['enemy-0']);
  });

  it('应保留后端真实使用的 item/quest/npc/map ID 格式', () => {
    const state = createState();

    applyPanelUpdates(state, {
      inventory: {
        added: [
          {
            id: 'item_生锈的铁剑_1779785527271_0',
            itemId: 'medieval-fantasy__rusty-sword',
            name: '生锈的铁剑',
            description: '一把生锈的铁剑',
            quantity: 1,
            ownerType: 'character',
          },
        ],
      },
      quest: {
        added: [
          {
            id: 'quest_村长的委托_1779785551112_1',
            name: '村长的委托',
            type: 'main',
            description: '调查暗影森林的哥布林',
            status: 'active',
            objectives: [],
            rewards: {},
          },
        ],
      },
      npc: {
        nearby: [
          {
            id: 'npc_村长艾德温_1779785527379_2',
            name: '村长艾德温',
            role: 'quest_giver',
          },
        ],
      },
      map: {
        newLocations: [
          {
            id: 'village-square',
            name: 'Village Square',
            description: 'Center of the town',
            type: 'town',
            x: 0,
            y: 0,
            npcs: [],
            dangerLevel: 0,
          },
          {
            id: 'loc_village_square_1779785527311_3',
            name: 'Forest Edge',
            description: 'A quiet path',
            type: 'wild',
            x: 1,
            y: 1,
            npcs: [],
            dangerLevel: 1,
          },
        ],
      },
    } as any);

    expect(state.inventory.map((item) => item.id)).toEqual(['item_生锈的铁剑_1779785527271_0']);
    expect(state.quests.map((quest) => quest.id)).toEqual(['quest_村长的委托_1779785551112_1']);
    expect(state.npcInfoList.map((npc) => npc.id)).toEqual(['npc_村长艾德温_1779785527379_2']);
    expect(state.mapState?.locations.map((location) => location.id)).toEqual([
      'village-square',
      'loc_village_square_1779785527311_3',
    ]);
  });

  it('新增 quest 时缺少 description 应拒绝该增量，避免生成空白任务', () => {
    const state = createState();

    applyPanelUpdates(state, {
      quest: {
        added: [
          {
            id: 'quest_空白任务_1779785551199_4',
            name: 'No Description Quest',
            type: 'side',
            status: 'active',
            objectives: [],
            rewards: {},
          },
        ],
      },
    } as any);

    expect(state.quests).toEqual([]);
  });

  it('inventory.updated 只下发 equippedSlot 时应更新已有物品槽位', () => {
    const state = createState();
    state.inventory = [
      {
        id: 'item_铁剑_1779785527200_5',
        save_id: 'save-1',
        item_id: 'iron-sword',
        name: '铁剑',
        description: '一把普通铁剑',
        quantity: 1,
        equipped: true,
        equippedSlot: 'main_hand',
        created_at: 1,
        updated_at: 1,
      } as any,
    ];

    applyPanelUpdates(state, {
      inventory: {
        updated: [
          {
            id: 'item_铁剑_1779785527200_5',
            itemId: 'iron-sword',
            name: '铁剑',
            quantity: 1,
            equippedSlot: 'off_hand',
            ownerType: 'character',
          },
        ],
      },
    } as any);

    expect(state.inventory[0]).toEqual(
      expect.objectContaining({
        equippedSlot: 'off_hand',
      }),
    );
  });

  it('inventory.replace 应保留后端传入的 saveId', () => {
    const state = createState();

    applyPanelUpdates(state, {
      inventory: {
        replace: true,
        added: [
          {
            id: 'item_皮甲_1779785527276_10',
            saveId: 'save-hero',
            itemId: 'leather-armor',
            name: '皮甲',
            description: '轻便护甲',
            quantity: 1,
            ownerType: 'character',
          },
        ],
      },
    } as any);

    expect(state.inventory).toEqual([
      expect.objectContaining({
        id: 'item_皮甲_1779785527276_10',
        saveId: 'save-hero',
      }),
    ]);
  });

  it('inventory.updated 将 equipped 设为 false 时应同步清空 equippedSlot', () => {
    const state = createState();
    state.inventory = [
      {
        id: 'item_铁剑_1779785527200_11',
        saveId: 'save-1',
        itemId: 'iron-sword',
        name: '铁剑',
        description: '一把普通铁剑',
        quantity: 1,
        equipped: true,
        equippedSlot: 'main_hand',
      } as any,
    ];

    applyPanelUpdates(state, {
      inventory: {
        updated: [
          {
            id: 'item_铁剑_1779785527200_11',
            itemId: 'iron-sword',
            name: '铁剑',
            quantity: 1,
            equipped: false,
            ownerType: 'character',
          },
        ],
      },
    } as any);

    expect(state.inventory[0]).toEqual(
      expect.objectContaining({
        equipped: false,
        equippedSlot: null,
      }),
    );
  });

  it('npc.partyChanges 缺少 inParty 时应保留原状态而不是翻转', () => {
    const state = createState();
    state.npcInfoList = [
      {
        id: 'npc_旅行商人_1779785527400_6',
        name: '旅行商人',
        role: 'merchant',
        inParty: true,
      } as any,
    ];

    applyPanelUpdates(state, {
      npc: {
        partyChanges: [
          {
            id: 'npc_旅行商人_1779785527400_6',
            name: '旅行商人',
          },
        ],
      },
    } as any);

    expect(state.npcInfoList[0]?.inParty).toBe(true);
  });

  it('应拒绝各实体类型的明显脏 ID', () => {
    const state = createState();

    applyPanelUpdates(state, {
      inventory: {
        added: [
          {
            id: 'placeholder',
            itemId: 'loot-potion',
            name: 'Bad Item',
            description: 'invalid',
            quantity: 1,
            ownerType: 'character',
          },
        ],
      },
      quest: {
        added: [
          {
            id: 'temp',
            name: 'Bad Quest',
            type: 'main',
            description: 'invalid',
            status: 'active',
            objectives: [],
            rewards: {},
          },
        ],
      },
      npc: {
        nearby: [
          {
            id: 'npc_bad',
            name: 'Bad NPC',
            role: 'merchant',
          },
        ],
      },
      map: {
        newLocations: [
          {
            id: 'bad id',
            name: 'Bad Map',
            description: 'invalid',
            type: 'wild',
            x: 0,
            y: 0,
            npcs: [],
            dangerLevel: 0,
          },
        ],
      },
      combat: {
        enemies: [
          {
            id: 'enemy-boss',
            name: 'Bad Enemy',
            hp: 10,
            maxHP: 10,
            level: 1,
            status: [],
          },
        ],
      },
      skills: {
        learned: [
          {
            id: 'skill-fireball',
            name: 'Fireball',
            type: 'magic',
            description: 'invalid',
            ownerType: 'character',
          },
        ],
      },
    } as any);

    expect(state.inventory).toEqual([]);
    expect(state.quests).toEqual([]);
    expect(state.npcInfoList).toEqual([]);
    expect(state.mapState?.locations).toEqual([]);
    expect(state.combat?.enemies).toEqual([]);
    expect(state.skills).toEqual([]);
  });

  it('应在 replace 分支中过滤 inventory 与 skills 的脏 ID', () => {
    const state = createState();

    applyPanelUpdates(state, {
      inventory: {
        replace: true,
        added: [
          {
            id: 'placeholder',
            itemId: 'bad-item',
            name: 'Bad Item',
            description: 'invalid',
            quantity: 1,
            ownerType: 'character',
          },
          {
            id: 'item_皮甲_1779785527276_7',
            itemId: 'good-item',
            name: 'Good Item',
            description: 'valid',
            quantity: 2,
            ownerType: 'character',
          },
        ],
      },
      skills: {
        replace: true,
        learned: [
          {
            id: 'skill-fireball',
            name: 'Bad Skill',
            type: 'magic',
            description: 'invalid',
            ownerType: 'character',
          },
          {
            id: 'skill_火球术_1779785527401_8',
            skillId: 'fireball',
            name: 'Good Skill',
            type: 'magic',
            description: 'valid',
            ownerType: 'character',
          },
        ],
      },
    } as any);

    expect(state.inventory.map((item) => item.id)).toEqual(['item_皮甲_1779785527276_7']);
    expect(state.skills.map((skill) => skill.id)).toEqual(['skill_火球术_1779785527401_8']);
  });

  it('应在 subStoreHandlers 路径中过滤 map 与 combat 的脏 ID', () => {
    const state = {
      ...createState(),
      combat: undefined,
      mapState: undefined,
    };
    const onCombatUpdate = vi.fn();
    const onMapUpdate = vi.fn();

    applyPanelUpdates(
      state,
      {
        combat: {
          enemies: [
            {
              id: 'enemy-boss',
              name: 'Bad Enemy',
              hp: 10,
              maxHP: 10,
              level: 1,
              status: [],
            },
            {
              id: 'enemy-0',
              name: 'Good Enemy',
              hp: 12,
              maxHP: 12,
              level: 1,
              status: [],
            },
          ],
        },
        map: {
          currentLocationId: 'bad id',
          discoveredLocationIds: ['bad id', 'village-square'],
          newLocations: [
            {
              id: 'bad id',
              name: 'Bad Map',
              description: 'invalid',
              type: 'wild',
              x: 0,
              y: 0,
              npcs: [],
              dangerLevel: 0,
            },
            {
              id: 'loc_village_square_1779785527311_9',
              name: 'Good Map',
              description: 'valid',
              type: 'wild',
              x: 1,
              y: 1,
              npcs: [],
              dangerLevel: 1,
            },
          ],
        },
      } as any,
      {
        onCombatUpdate,
        onMapUpdate,
      }
    );

    expect(onCombatUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        enemies: [
          expect.objectContaining({
            id: 'enemy-0',
          }),
        ],
      })
    );
    expect(onMapUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        currentLocationId: undefined,
        discoveredLocationIds: ['village-square'],
        newLocations: [
          expect.objectContaining({
            id: 'loc_village_square_1779785527311_9',
          }),
        ],
      })
    );
  });

  it('应按实体类型区分校验规则', () => {
    // 后端 generateReadableId 格式: {source}_{name}_{timestamp}_{counter}
    expect(isValidEntityIdFor('inventory', 'item_生锈的铁剑_1779785527271_0')).toBe(true);
    expect(isValidEntityIdFor('quest', 'quest_村长的委托_1779785551112_1')).toBe(true);
    expect(isValidEntityIdFor('npc', 'npc_村长艾德温_1779785527379_2')).toBe(true);
    expect(isValidEntityIdFor('mapLocation', 'village-square')).toBe(true);
    expect(isValidEntityIdFor('mapLocation', 'loc_village_square_1779785527311_3')).toBe(true);
    expect(isValidEntityIdFor('mapLocation', 'save-550e8400-e29b-41d4-a716-446655440000-main-map')).toBe(true);
    expect(isValidEntityIdFor('combatEnemy', 'enemy-0')).toBe(true);
    expect(isValidEntityIdFor('skill', 'skill_火球术_1779785527401_4')).toBe(true);
    expect(isValidEntityIdFor('skill', 'custom_火球术_1779785527400_5')).toBe(true);

    // 旧 UUID 格式仍兼容
    expect(isValidEntityIdFor('inventory', '550e8400-e29b-41d4-a716-446655440000')).toBe(true);

    // 跨类型拒绝
    expect(isValidEntityIdFor('quest', 'village-square')).toBe(false);
    expect(isValidEntityIdFor('inventory', 'npc_村长_1779785527379_6')).toBe(false);
    expect(isValidEntityIdFor('combatEnemy', 'enemy-boss')).toBe(false);

    // 脏ID拒绝
    expect(isValidEntityIdFor('inventory', 'placeholder')).toBe(false);
    expect(isValidEntityIdFor('quest', 'temp')).toBe(false);
  });
});
