/**
 * map/ 模块桶导出（S2-1 Repository 模式重构）。
 *
 * 导出内容:
 * - Service: MapService（implements IMapService）
 * - ServiceTool: MapServiceTool（组合根，createMapService 工厂方法）
 * - Repository: LocationRepository + LocationConnectionRepository
 * - 端口接口: ILocationRepository + ILocationConnectionRepository + IMapService
 * - 实体类型: LocationData + LocationConnection + ExploreResult + NavigationPath + RegionConnection + Coordinates
 * - 共享映射: mapLocationRowToData（供 DataRefreshHandler 共享）
 */

// Service + ServiceTool
export { MapService } from './MapService.js';
export { MapServiceTool } from './MapServiceTool.js';

// Repository
export { LocationRepository } from './LocationRepository.js';
export { LocationConnectionRepository } from './LocationConnectionRepository.js';

// 共享映射函数（供 DataRefreshHandler 等共享消费方使用）
export { mapLocationRowToData } from './mappers.js';

// 端口接口 + 实体类型
export type {
  ILocationRepository,
  ILocationConnectionRepository,
  IMapService,
  LocationData,
  LocationConnection,
  ExploreResult,
  NavigationPath,
  RegionConnection,
  Coordinates,
} from './types.js';
