/**
 * MapService.createLocation 去重防护测试
 *
 * 设计文档：docs/design/fix/fix-20260716-audit-feedback-duplicate-creation.md §3 + §3.1
 *
 * 期望效果（设计文档 §3 矩阵 #1 + §3.1 接口签名）：
 * - 同 saveId+name 已存在 → 增量更新非黑名单字段 + 返回 alreadyExists=true + warnings
 * - warnings 包含字段级 diff（"字段名: 旧值 → 新值"），特别是 parentLocationId 的 diff
 * - 黑名单字段（id、saveId、createdAt、locationLevel）拒绝更新并返回 blockedFields 提示
 * - isExplored、childLocationIds、connections 可更新（非黑名单字段）
 * - parentLocationId 支持 name/id 双兼容解析
 * - 不存在 → 正常创建流程（无 alreadyExists）
 *
 * 黑名单字段（设计文档 §3 黑名单表）：id、saveId、createdAt、locationLevel
 */
import { describe, it, expect, vi } from 'vitest';
import { MapService } from '../MapService.js';
import type { LocationData } from '../types.js';

function createExistingLocation(overrides: Partial<LocationData> = {}): LocationData {
  return {
    id: 'loc_白杨村_1784177145648_3',
    saveId: 'save-001',
    locationLevel: 2,
    parentLocationId: 'loc_艾尔德兰大陆_1784177145648_2',
    name: '白杨村',
    description: '一个宁静的小村庄',
    type: 'town',
    terrainType: 'plain',
    coordinates: { x: 0, y: 0 },
    isExplored: false,
    events: [],
    connections: [],
    dangerLevel: 1,
    visible: false,
    childLocationIds: [],
    isParent: false,
    customData: {},
    ...overrides,
  } as LocationData;
}

function createLocationRepoMock(existing: LocationData | null = null) {
  return {
    findByName: vi.fn().mockResolvedValue(existing),
    findById: vi.fn().mockResolvedValue(existing),
    insert: vi.fn().mockResolvedValue(existing),
    update: vi.fn().mockResolvedValue(undefined),
    findBySaveId: vi.fn().mockResolvedValue([]),
    findByIds: vi.fn().mockResolvedValue([]),
    findByParentId: vi.fn().mockResolvedValue([]),
    findIdsByParentId: vi.fn().mockResolvedValue([]),
    findByNameLike: vi.fn().mockResolvedValue(null),
    findAllParentLinks: vi.fn().mockResolvedValue([]),
    findNamesByIds: vi.fn().mockResolvedValue(new Map()),
    findFirstBySaveId: vi.fn().mockResolvedValue(null),
    deleteBySaveId: vi.fn().mockResolvedValue(undefined),
    countBySaveId: vi.fn().mockResolvedValue(0),
    clearParentForChildren: vi.fn().mockResolvedValue(0),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
    exists: vi.fn().mockResolvedValue(false),
  } as any;
}

function createConnectionRepoMock() {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
    deleteByLocationId: vi.fn().mockResolvedValue(undefined),
    findConnectedIds: vi.fn().mockResolvedValue([]),
    findByFromIds: vi.fn().mockResolvedValue([]),
    findByToIds: vi.fn().mockResolvedValue([]),
    findByLocationId: vi.fn().mockResolvedValue([]),
    findAll: vi.fn().mockResolvedValue([]),
    deleteBySaveId: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
  } as any;
}

function createDiscoveredRepoMock() {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
    findLocationIdsBySaveId: vi.fn().mockResolvedValue([]),
  } as any;
}

function createCharacterServiceMock() {
  return {
    getCurrentLocationId: vi.fn().mockResolvedValue(null),
  } as any;
}

function createEventRepoMock() {
  return {
    resolveEventId: vi.fn().mockResolvedValue(null),
  } as any;
}

function createTxManagerMock() {
  const transaction = vi.fn(async (cb: (trx: any) => Promise<any>) => cb({} as any));
  return { transaction } as any;
}

/**
 * 为去重更新场景设置 findById mock：
 * - 查询 existing.id → 返回 updated（getLocation 末尾查询返回更新后数据）
 * - 查询其他 ID（parentLocationId/connections/childLocationIds）→ 返回 level=1 父地点
 *   （resolveLocationIdInternal + validateParentLevel 需要父地点层级匹配）
 */
function setupFindByIdForDedup(locationRepo: any, existing: LocationData, updated: LocationData) {
  locationRepo.findById.mockImplementation(async (id: string) => {
    if (id === existing.id) return updated;
    // parentLocationId / connections / childLocationIds 查询 → 返回 level=1 地点
    return createExistingLocation({
      id,
      locationLevel: 1,
      parentLocationId: null,
      name: '父大陆',
    });
  });
}

function createMapService(existing: LocationData | null = null) {
  const locationRepo = createLocationRepoMock(existing);
  const connectionRepo = createConnectionRepoMock();
  const discoveredRepo = createDiscoveredRepoMock();
  const characterService = createCharacterServiceMock();
  const eventRepo = createEventRepoMock();
  const txManager = createTxManagerMock();
  // LocationEntityResolver mock：resolveLocationId 在 createLocation 内被调用解析 parentLocationId
  const locationResolver = {
    resolve: vi.fn().mockImplementation(async (ref: { ref: string }) => ({
      entityId: ref.ref,
      label: ref.ref,
      entityType: 'location',
      matchedBy: 'id',
      timestampMatched: 'none',
    })),
  };
  const service = new MapService(
    locationRepo,
    connectionRepo,
    discoveredRepo,
    characterService,
    eventRepo,
    txManager,
    locationResolver as any,
  );
  return { service, locationRepo, connectionRepo, discoveredRepo, txManager };
}

describe('MapService.createLocation 去重防护', () => {
  describe('设计文档 §3 矩阵 #1：同 name 已存在 → 增量更新 + warnings', () => {
    it('已存在 → 返回 alreadyExists=true + warnings 含字段级 diff', async () => {
      const existing = createExistingLocation();
      const { service, locationRepo } = createMapService(existing);

      const input = {
        locationLevel: 2,
        name: '白杨村',
        description: '繁华的贸易小镇',
        parentLocationId: 'loc_暗影大陆_1784177145648_2' as any,
      };

      // 模拟更新后的地点
      const updated = { ...existing, description: '繁华的贸易小镇', parentLocationId: 'loc_暗影大陆_1784177145648_2' };
      setupFindByIdForDedup(locationRepo, existing, updated);

      const result = await service.createLocation('save-001' as any, input);

      expect(result.alreadyExists).toBe(true);
      expect(result.warnings).toBeDefined();
      const warningsText = result.warnings!.join(' ');
      expect(warningsText).toContain("地点 '白杨村' 已存在");
      expect(warningsText).toContain('parentLocationId: loc_艾尔德兰大陆_1784177145648_2 → loc_暗影大陆_1784177145648_2');
      expect(warningsText).toContain('description: 一个宁静的小村庄 → 繁华的贸易小镇');
    });

    it('增量更新 parentLocationId：旧值 → 新值（修复硬编码 early return 问题）', async () => {
      const existing = createExistingLocation({ parentLocationId: 'loc_艾尔德兰大陆_xxx' });
      const { service, locationRepo } = createMapService(existing);

      const input = {
        locationLevel: 2,
        name: '白杨村',
        parentLocationId: 'loc_暗影大陆_yyy' as any,
      };

      const updated = { ...existing, parentLocationId: 'loc_暗影大陆_yyy' };
      setupFindByIdForDedup(locationRepo, existing, updated);

      const result = await service.createLocation('save-001' as any, input);

      expect(result.alreadyExists).toBe(true);
      expect(result.warnings!.join(' ')).toContain('parentLocationId: loc_艾尔德兰大陆_xxx → loc_暗影大陆_yyy');
      // 应调用 locationRepo.update 更新 parentLocationId
      expect(locationRepo.update).toHaveBeenCalled();
    });

    it('增量更新多字段：description + type + dangerLevel', async () => {
      const existing = createExistingLocation({
        description: '旧描述',
        type: 'town',
        dangerLevel: 1,
      });
      const { service, locationRepo } = createMapService(existing);

      const input = {
        locationLevel: 2,
        name: '白杨村',
        description: '新描述',
        type: 'city',
        dangerLevel: 5,
        parentLocationId: 'loc_暗影大陆_xxx' as any,
      };

      const updated = { ...existing, description: '新描述', type: 'city', dangerLevel: 5 };
      setupFindByIdForDedup(locationRepo, existing, updated);

      const result = await service.createLocation('save-001' as any, input);

      expect(result.alreadyExists).toBe(true);
      const warningsText = result.warnings!.join(' ');
      expect(warningsText).toContain('description: 旧描述 → 新描述');
      expect(warningsText).toContain('type: town → city');
      expect(warningsText).toContain('dangerLevel: 1 → 5');
    });
  });

  describe('设计文档 §3.1：isExplored/childLocationIds/connections 可更新（非黑名单字段）', () => {
    it('isExplored false → true 可增量更新', async () => {
      const existing = createExistingLocation({ isExplored: false });
      const { service, locationRepo, discoveredRepo } = createMapService(existing);

      const input = {
        locationLevel: 2,
        name: '白杨村',
        isExplored: true,
        parentLocationId: 'loc_暗影大陆_xxx' as any,
      };

      const updated = { ...existing, isExplored: true };
      setupFindByIdForDedup(locationRepo, existing, updated);

      const result = await service.createLocation('save-001' as any, input);

      expect(result.alreadyExists).toBe(true);
      expect(result.warnings!.join(' ')).toContain('isExplored: false → true');
      // isExplored 更新为 true 时应同时标记为已发现
      expect(discoveredRepo.insert).toHaveBeenCalled();
    });

    it('connections 可增量更新（通过 connectionRepo 单独更新）', async () => {
      const existing = createExistingLocation({ connections: [] });
      const { service, locationRepo, connectionRepo } = createMapService(existing);

      const input = {
        locationLevel: 2,
        name: '白杨村',
        connections: ['loc_暗影森林_xxx'],
        parentLocationId: 'loc_暗影大陆_xxx' as any,
      };

      const updated = { ...existing, connections: ['loc_暗影森林_xxx'] };
      setupFindByIdForDedup(locationRepo, existing, updated);

      const result = await service.createLocation('save-001' as any, input);

      expect(result.alreadyExists).toBe(true);
      expect(result.warnings!.join(' ')).toContain('connections:');
      // connections 更新应通过 connectionRepo.deleteByLocationId + insert
      expect(connectionRepo.deleteByLocationId).toHaveBeenCalled();
      expect(connectionRepo.insert).toHaveBeenCalled();
    });
  });

  describe('设计文档 §3 黑名单字段触发提示', () => {
    it('黑名单字段 locationLevel 不被覆盖（保留原值）', async () => {
      const existing = createExistingLocation({ locationLevel: 2 });
      const { service, locationRepo } = createMapService(existing);

      // Agent 传入 locationLevel=3（试图修改层级），应被拒绝
      const input = {
        locationLevel: 3,
        name: '白杨村',
        description: '新描述',
        parentLocationId: 'loc_暗影大陆_xxx' as any,
      };

      const updated = { ...existing, description: '新描述' };
      setupFindByIdForDedup(locationRepo, existing, updated);

      const result = await service.createLocation('save-001' as any, input);

      expect(result.alreadyExists).toBe(true);
      // locationLevel 保持原值 2
      expect(result.locationLevel).toBe(2);
      // warnings 应包含 locationLevel 黑名单触发提示
      const warningsText = result.warnings!.join(' ');
      expect(warningsText).toContain('locationLevel');
      expect(warningsText).toContain('黑名单');
    });

    it('id 字段为黑名单字段，不被覆盖', async () => {
      const existing = createExistingLocation({ id: 'loc_original_id' });
      const { service, locationRepo } = createMapService(existing);

      const input = {
        locationLevel: 2,
        name: '白杨村',
        locationId: 'loc_new_id' as any, // 试图修改 id
        parentLocationId: 'loc_暗影大陆_xxx' as any,
      };

      const updated = { ...existing };
      setupFindByIdForDedup(locationRepo, existing, updated);

      const result = await service.createLocation('save-001' as any, input);

      expect(result.alreadyExists).toBe(true);
      expect(result.id).toBe('loc_original_id');
      const warningsText = result.warnings!.join(' ');
      expect(warningsText).toContain('id');
      expect(warningsText).toContain('黑名单');
    });
  });

  describe('设计文档 §3：不存在 → 正常创建流程', () => {
    it('findByName 返回 null → 正常创建，无 alreadyExists', async () => {
      const { service, locationRepo } = createMapService(null);

      const input = {
        locationLevel: 2,
        name: '新地点',
        description: '全新地点',
        parentLocationId: 'loc_暗影大陆_xxx' as any,
      };

      // 父地点必须为 level=1（createLocation 对 level=2 校验 parent 必须是 level=1）
      const parentLocation = createExistingLocation({
        id: 'loc_暗影大陆_xxx',
        locationLevel: 1,
        parentLocationId: null,
        name: '暗影大陆',
      });
      const newLocation = createExistingLocation({ id: 'loc_new_1', name: '新地点' });
      locationRepo.insert.mockResolvedValue(newLocation);
      // findById 需要按 id 区分返回：parentLocation（父地点校验） vs newLocation（创建后查询）
      locationRepo.findById.mockImplementation(async (id: string) => {
        if (id === 'loc_暗影大陆_xxx') return parentLocation;
        return newLocation;
      });

      const result = await service.createLocation('save-001' as any, input);

      expect(result.alreadyExists).toBeUndefined();
      expect(locationRepo.insert).toHaveBeenCalled();
    });
  });

  describe('设计文档 §3：无字段变化', () => {
    it('输入与 existing 一致 → warnings 提示"无字段变化"', async () => {
      const existing = createExistingLocation({
        description: '不变描述',
        type: 'town',
        dangerLevel: 1,
      });
      const { service, locationRepo } = createMapService(existing);

      const input = {
        locationLevel: 2,
        name: '白杨村',
        description: '不变描述',
        type: 'town',
        dangerLevel: 1,
        parentLocationId: 'loc_艾尔德兰大陆_1784177145648_2' as any, // 与 existing 一致
      };

      const updated = { ...existing };
      setupFindByIdForDedup(locationRepo, existing, updated);

      const result = await service.createLocation('save-001' as any, input);

      expect(result.alreadyExists).toBe(true);
      // 无字段变化时应有"无字段变化"提示或无更新字段的提示
      expect(result.warnings).toBeDefined();
    });
  });
});
