export { GameTimeService } from './time/GameTimeService.js';
export type {
  GameTime,
  TimePassageResult,
  TimeAdvanceParams,
  ActionType,
  PeriodOfDay,
  GameTimeConfig
} from './time/types.js';

export { GameTimeServiceTool } from './time/GameTimeServiceTool.js';
export type {} from './time/types.js';

export { NumericalService } from './numerical/NumericalService.js';
export type {
  BaseAttributes,
  DerivedAttributes,
  DamageFormula,
  DamageParams,
  DamageResult,
  ExperienceParams,
  ExperienceResult,
  LevelProgress,
  LevelUpResult,
  DropTableItem,
  LootResult
} from './numerical/types.js';

export { DecayCurveCalculator } from './numerical/DecayCurveCalculator.js';

export { NumericalServiceTool } from './numerical/NumericalServiceTool.js';
export type {} from './numerical/types.js';

export { CharacterService } from './character/CharacterService.js';
export type {
  CreateCharacterInput,
  CharacterData,
  CharacterStatusPanel
} from './character/types.js';

export { CharacterServiceTool } from './character/CharacterServiceTool.js';
export type {} from './character/types.js';

export { InventoryService } from './inventory/InventoryService.js';
export type {
  InventoryItem,
  AddItemParams,
  EquipResult,
  UseItemResult
} from './inventory/types.js';

export { InventoryServiceTool } from './inventory/InventoryServiceTool.js';
export type {} from './inventory/types.js';

export { SkillService } from './skill/SkillService.js';
export type {
  CharacterSkill,
  LearnSkillResult,
  UpgradeSkillResult,
  SkillTreeInfo
} from './skill/types.js';

export { SkillServiceTool } from './skill/SkillServiceTool.js';
export type {} from './skill/types.js';

export { MapService } from './map/MapService.js';
export type {
  LocationData,
  ExploreResult,
  NavigationPath
} from './map/types.js';

export { MapServiceTool } from './map/MapServiceTool.js';
export type {} from './map/types.js';

export { NPCService } from './npc/NPCService.js';
export type {
  NPCProfile,
  // 模块2 简化：删除 NPCRelation 类型导出（npc_relations 表已删除）
  PartyMember,
  NPCStatusPanel
} from './npc/types.js';

export { NPCServiceTool } from './npc/NPCServiceTool.js';
export type {} from './npc/types.js';

export { EventService } from './event/EventService.js';

export { EventServiceTool } from './event/EventServiceTool.js';

export { DialogueService } from './dialogue/DialogueService.js';
export type {
  DialogueMessage,
  DialogueSession,
  DialogueOption,
  DialogueContext,
  CreateDialogueParams
} from './dialogue/types.js';

export { DialogueServiceTool } from './dialogue/DialogueServiceTool.js';
export type {} from './dialogue/types.js';

export { QuestService } from './quest/QuestService.js';
export type {
  Quest,
  QuestObjective,
  QuestReward,
  QuestStatus,
  QuestType,
  ObjectiveType,
  QuestDetail,
  CreateQuestInput
} from './quest/types.js';

export { QuestServiceTool } from './quest/QuestServiceTool.js';
export type {} from './quest/types.js';

export { CombatService } from './combat/CombatService.js';
export type {
  CombatParticipant,
  EnemyTemplate,
  CombatAction,
  CombatState,
  CombatResult,
  TurnResult,
  StatusEffect,
  DamageBreakdown
} from './combat/types.js';

export { CombatServiceTool } from './combat/CombatServiceTool.js';
export type {} from './combat/types.js';

export { GameInitServiceTool } from './init/GameInitServiceTool.js';
export type {
  TemplateData,
  TemplateInitialData,
} from './init/types.js';

export { StoryService } from './story/StoryService.js';
export type {
  StoryContext,
  StoryEventInput,
  StoryEvent,
  ChapterInfo,
  ContextUpdateData,
  AdvanceChapterResult
} from './story/types.js';

export { StoryServiceTool } from './story/StoryServiceTool.js';
export type {} from './story/types.js';

export type { EntityType, RelationType, EntityNode, EntityEdge, EntityEdgeProperties, EntitySubgraph, GraphSnapshot } from './entity-graph/types.js';
export { EntityGraphServiceTool } from './entity-graph/EntityGraphServiceTool.js';

export { ConditionEvaluator } from './condition/ConditionEvaluator.js';
export type { ConditionContext } from './condition/ConditionEvaluator.js';
