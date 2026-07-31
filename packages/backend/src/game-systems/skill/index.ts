/**
 * skill/ 模块桶导出（S2-2 Repository 模式重构）。
 *
 * 导出内容:
 * - Service: SkillService
 * - ServiceTool: SkillServiceTool（组合根，createSkillService 工厂方法）
 * - Repository: SkillPoolRepository（skill_pool 表）+ CharacterSkillRepository（character_skills 表）
 * - 端口接口: ISkillPoolRepository + ICharacterSkillRepository
 * - 共享映射: mapSkillPoolRowToEntry + mapCharacterSkillRow
 * - 实体类型: CharacterSkill + EntitySkill + LearnSkillResult + UpgradeSkillResult + SkillTreeInfo + UseSkillResult + SkillCategory + SkillElement + CooldownSystemType + OwnerType
 */

// Service + ServiceTool
export { SkillService } from './SkillService.js';
export { SkillServiceTool } from './SkillServiceTool.js';

// Repository
export { SkillPoolRepository } from './SkillPoolRepository.js';
export { CharacterSkillRepository } from './CharacterSkillRepository.js';

// 共享映射函数（供消费方共享 row → entity 转换）
export { mapSkillPoolRowToEntry, mapCharacterSkillRow } from './mappers.js';

// 端口接口 + 实体类型
export type {
  ISkillPoolRepository,
  ICharacterSkillRepository,
  CharacterSkill,
  EntitySkill,
  LearnSkillResult,
  UpgradeSkillResult,
  SkillTreeInfo,
  UseSkillResult,
  SkillCategory,
  SkillElement,
  CooldownSystemType,
  OwnerType,
} from './types.js';
