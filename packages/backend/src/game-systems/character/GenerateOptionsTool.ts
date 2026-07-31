import { BaseTool } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse, ActionHandler } from '@ai-rpg/shared/types/tool';
import { ToolType } from '../../../../shared/src/types/agent.js';
import type {
  CharacterCreationRules,
  RaceDefinition,
  ClassDefinition,
  BackgroundDefinition,
  WorldSetting,
  StartingScene,
} from '../../../../shared/src/types/template.js';
import type { ConfigLoader } from '../../agents/config/ConfigLoader.js';
import type { ITemplateProvider } from '../shared/types.js';
import { LLMService } from '@ai-rpg/ai';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import { parseLLMJson } from '../../utils/llm-json.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('generate-options-tool');

/** AI生成结果类型，字段与shared类型一致但全部必填 */
type GeneratedRace = Required<Pick<RaceDefinition, 'id' | 'name' | 'description' | 'bonuses' | 'penalties' | 'abilities' | 'available_classes'>>;
type GeneratedClass = Required<Pick<ClassDefinition, 'id' | 'name' | 'description' | 'primary_attributes' | 'hit_die' | 'skill_proficiencies' | 'starting_equipment'>>;
type GeneratedBackground = Required<Pick<BackgroundDefinition, 'id' | 'name' | 'description' | 'feature' | 'attribute_bonuses' | 'skill_proficiencies' | 'languages' | 'equipment'>>;

interface GeneratedOptionsResult {
  races: GeneratedRace[];
  classes: GeneratedClass[];
  backgrounds: GeneratedBackground[];
}

/** AI生成类型枚举 */
export type GenerateType =
  | 'race' | 'class' | 'background'
  | 'world_setting' | 'npc' | 'item' | 'quest' | 'scene'
  | 'races' | 'classes' | 'backgrounds';

/** AI生成世界设定结果 */
export interface GeneratedWorldSetting {
  name: string;
  description: string;
  era: string;
  magic_system: string;
  technology_level: string;
}

/** AI生成NPC结果 */
export interface GeneratedNPC {
  id: string;
  name: string;
  title: string;
  description: string;
  role: string;
  race: string;
  base_level: number;
  default_location: string;
  base_stats: Record<string, number>;
}

/** AI生成物品结果 */
export interface GeneratedItem {
  id: string;
  name: string;
  description: string;
  category: string;
  quality: string;
  effects: string[];
  value: number;
}

/** AI生成任务结果 */
export interface GeneratedQuest {
  id: string;
  name: string;
  description: string;
  type: string;
  objectives: string[];
  rewards: string[];
}

/** AI生成场景结果 */
export interface GeneratedScene {
  location: string;
  description: string;
  atmosphere: string;
  npcs: string[];
  items: string[];
}

/** AI生成统一结果 */
export type GeneratedResult =
  | { type: 'race' | 'class' | 'background'; data: GeneratedOptionsResult }
  | { type: 'races'; data: GeneratedRace[] }
  | { type: 'classes'; data: GeneratedClass[] }
  | { type: 'backgrounds'; data: GeneratedBackground[] }
  | { type: 'world_setting'; data: GeneratedWorldSetting }
  | { type: 'npc'; data: GeneratedNPC }
  | { type: 'item'; data: GeneratedItem }
  | { type: 'quest'; data: GeneratedQuest }
  | { type: 'scene'; data: GeneratedScene };

const VALID_ATTRIBUTE_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const VALID_HIT_DICE = ['d6', 'd8', 'd10', 'd12'];

export class GenerateOptionsTool extends BaseTool {
  private configLoader: ConfigLoader | null = null;
  private llmService: LLMService | null = null;
  private templateProvider: ITemplateProvider | null = null;
  /** 从模板 initial_data.default_equipment 读取的默认装备ID */
  private _defaultEquipment: string | null = null;

  constructor() {
    super(
      'generate_options' as ToolType,
      'Generate Options Service',
      'AI角色选项生成服务。详细使用方法请调用 get_tool_help 工具。',
      '2.0.0',
      [
        {
          action: 'generate_character_options',
          method: 'generate_options',
          paramMapping: {
            templateId: 'templateId'
          },
          priority: 5,
          description: 'AI创造全新角色选项(种族/职业/背景)，排除模板已有选项，增加游戏随机性，游戏前操作，不需要saveId'
        }
      ] as ActionHandler[]
    );

    this.registerMethods();
  }

  setDependencies(configLoader: ConfigLoader, llmService: LLMService): void {
    this.configLoader = configLoader;
    this.llmService = llmService;
  }

  /** 注入 ITemplateProvider 实例，在 init.ts 中调用（v1.8 替代方法内 new TemplateService()） */
  setTemplateProvider(provider: ITemplateProvider): void {
    this.templateProvider = provider;
  }

  /** 获取默认装备ID，优先从模板配置读取 */
  get defaultEquipment(): string | null {
    return this._defaultEquipment;
  }

  /** 设置默认装备ID（由调用方从模板 initial_data.default_equipment 传入） */
  setDefaultEquipment(equipmentId: string | undefined): void {
    this._defaultEquipment = equipmentId ?? null;
  }

  private registerMethods(): void {
    this.registerMethod({
      name: 'generate_options',
      description: 'AI创造全新角色选项(种族/职业/背景)，排除模板已有选项，增加游戏随机性，游戏前操作，不需要saveId',
      parameters: {
        templateId: { type: 'string', required: true, description: '模板ID' }
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            description: 'AI生成的角色选项',
            properties: {
              races: { type: 'array', description: '生成的种族列表' },
              classes: { type: 'array', description: '生成的职业列表' },
              backgrounds: { type: 'array', description: '生成的背景列表' },
            },
          },
          error: { type: 'string' },
        },
        required: ['success'],
      },
      handler: async (params: Record<string, unknown>, _context: ToolContext): Promise<ToolResponse> => {
        const templateId = params.templateId as string;
        if (!templateId) {
          return { success: false, error: 'templateId is required' };
        }

        try {
          if (!this.configLoader) {
            logger.warn('ConfigLoader not set, cannot generate options');
            return { success: true, data: { races: [], classes: [], backgrounds: [] } };
          }
          if (!this.templateProvider) {
            logger.warn('TemplateProvider not set, cannot generate options');
            return { success: true, data: { races: [], classes: [], backgrounds: [] } };
          }

          const template = await this.templateProvider.getTemplate(templateId);
          const characterCreation = (template.characterCreation || {}) as Partial<CharacterCreationRules>;

          const existingRaces = characterCreation.races || [];
          const existingClasses = characterCreation.classes || [];
          const existingBackgrounds = characterCreation.backgrounds || [];

          if (!this.llmService) {
            logger.warn('LLMService not set, cannot generate options');
            return { success: true, data: { races: [], classes: [], backgrounds: [] } };
          }

          const aiResult = await this.generateWithLLM(
            templateId,
            template.name || templateId,
            existingRaces,
            existingClasses,
            existingBackgrounds
          );

          return {
            success: true,
            data: aiResult
          };
        } catch (error) {
          const errMsg = getErrorMessage(error);
          logger.error('Failed to generate options', { templateId, error: errMsg });
          return { success: false, error: errMsg };
        }
      }
    });
  }

  private async generateWithLLM(
    templateId: string,
    templateName: string,
    existingRaces: RaceDefinition[],
    existingClasses: ClassDefinition[],
    existingBackgrounds: BackgroundDefinition[]
  ): Promise<GeneratedOptionsResult> {
    const existingRaceIds = existingRaces.map(r => r.id);
    const existingClassIds = existingClasses.map(c => c.id);
    const existingBackgroundIds = existingBackgrounds.map(b => b.id);

    const systemPrompt = `你是一个RPG世界观设计师。根据提供的模板世界观风格和已有种族/职业/背景数据，创造全新的种族、职业和背景选项，为游戏增加随机性和多样性。

## 输出格式
返回纯JSON对象（不要用markdown代码块包裹），格式如下：
{
  "races": [
    {
      "id": "英文小写id",
      "name": "中文名称",
      "description": "50-100字描述",
      "bonuses": {"str": 2, "cha": 1},
      "penalties": {"dex": -1},
      "abilities": ["能力1", "能力2"],
      "available_classes": ["warrior", "新职业id"]
    }
  ],
  "classes": [
    {
      "id": "英文小写id",
      "name": "中文名称",
      "description": "50-100字描述",
      "primary_attributes": ["str", "cha"],
      "hit_die": "d10",
      "skill_proficiencies": ["技能1", "技能2"],
      "starting_equipment": ["装备1", "装备2"]
    }
  ],
  "backgrounds": [
    {
      "id": "英文小写id",
      "name": "中文名称",
      "description": "50-100字描述",
      "feature": "特性名称 - 特性描述",
      "attribute_bonuses": {"cha": 1},
      "skill_proficiencies": ["技能1", "技能2"],
      "languages": ["语言1"],
      "equipment": ["装备1", "装备2"]
    }
  ]
}

## 创造规则

### 种族规则
- 创造3-5个全新种族，ID不能与已有种族重复（已有: ${existingRaceIds.join(', ')}）
- 每个种族必须有bonuses和penalties，属性加成/惩罚总和在-1到+2之间
- bonuses和penalties的key只能是: str, dex, con, int, wis, cha
- 每个种族2-3个abilities（种族特有能力）
- available_classes可以引用已有职业ID（${existingClassIds.join(', ')}）和你创造的新职业ID
- 每个种族至少2个可用职业

### 职业规则
- 创造3-5个全新职业，ID不能与已有职业重复（已有: ${existingClassIds.join(', ')}）
- primary_attributes从str/dex/con/int/wis/cha中选2个
- hit_die只能是: d6(脆皮), d8(中等), d10(坦克), d12(超肉)
- 2-3个skill_proficiencies
- 2-3个starting_equipment（用英文kebab-case ID）

### 背景规则
- 创造3-5个全新背景，ID不能与已有背景重复（已有: ${existingBackgroundIds.join(', ')}）
- feature格式: "特性名称 - 特性描述"
- attribute_bonuses总和在0到+2之间
- 2个skill_proficiencies
- 1-2个languages
- 2-3个equipment（用英文kebab-case ID）

### 世界观一致性
- 新选项必须符合模板世界观风格
- 名称和描述要有创意，避免与已有选项雷同
- 种族/职业/背景之间要有合理的搭配逻辑`;

    const userPrompt = `模板: ${templateName} (${templateId})

已有种族（供参考，不要重复）:
${existingRaces.map(r => `- ${r.id}: ${r.name} - ${r.description} (加成: ${JSON.stringify(r.bonuses)}, 惩罚: ${JSON.stringify(r.penalties)}, 可用职业: ${r.available_classes?.join('/')})`).join('\n')}

已有职业（供参考，不要重复）:
${existingClasses.map(c => `- ${c.id}: ${c.name} - ${c.description} (主属性: ${c.primary_attributes?.join('/')}, 生命骰: ${c.hit_die})`).join('\n')}

已有背景（供参考，不要重复）:
${existingBackgrounds.map(b => `- ${b.id}: ${b.name} - ${b.description} (特性: ${b.feature})`).join('\n')}

请创造全新的种族、职业和背景选项。`;

    try {
      const response = await this.llmService!.chat(
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        { temperature: 0.9, maxTokens: 4000 },
        undefined,
        'generate_options'
      );

      const content = response.content || '';

      let parsed: Record<string, unknown>;
      try {
        parsed = parseLLMJson<Record<string, unknown>>(content, `GenerateOptionsTool:generateWithLLM:${templateId}`);
      } catch {
        logger.warn('LLM response is not valid JSON', { templateId });
        return { races: [], classes: [], backgrounds: [] };
      }

      const generatedRaces = this.validateAndSanitizeRaces(
        parsed.races as GeneratedRace[],
        new Set(existingRaceIds)
      );

      const generatedClasses = this.validateAndSanitizeClasses(
        parsed.classes as GeneratedClass[],
        new Set(existingClassIds)
      );

      const generatedBackgrounds = this.validateAndSanitizeBackgrounds(
        parsed.backgrounds as GeneratedBackground[],
        new Set(existingBackgroundIds)
      );

      const validClassIds = new Set([
        ...existingClassIds,
        ...generatedClasses.map(c => c.id)
      ]);
      for (const race of generatedRaces) {
        race.available_classes = race.available_classes.filter(id => validClassIds.has(id));
        if (race.available_classes.length === 0) {
          race.available_classes = existingClassIds.slice(0, 2);
        }
      }

      logger.info('AI generated new options successfully', {
        templateId,
        raceCount: generatedRaces.length,
        classCount: generatedClasses.length,
        backgroundCount: generatedBackgrounds.length
      });

      return {
        races: generatedRaces,
        classes: generatedClasses,
        backgrounds: generatedBackgrounds
      };
    } catch (error) {
      const errMsg = getErrorMessage(error);
      logger.warn('LLM generation failed', { templateId, error: errMsg });
      return { races: [], classes: [], backgrounds: [] };
    }
  }

  private validateAndSanitizeRaces(
    races: GeneratedRace[] | undefined,
    existingIds: Set<string>
  ): GeneratedRace[] {
    if (!Array.isArray(races)) return [];

    const seenIds = new Set<string>();
    const result: GeneratedRace[] = [];

    for (const race of races) {
      if (!race || typeof race !== 'object') continue;
      if (!race.id || typeof race.id !== 'string') continue;
      if (existingIds.has(race.id) || seenIds.has(race.id)) continue;

      const sanitized: GeneratedRace = {
        id: race.id.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        name: typeof race.name === 'string' && race.name.trim() ? race.name.trim() : race.id,
        description: typeof race.description === 'string' ? race.description.trim() : '',
        bonuses: this.sanitizeAttributeMap(race.bonuses),
        penalties: this.sanitizeAttributeMap(race.penalties),
        abilities: Array.isArray(race.abilities)
          ? race.abilities.filter((a: unknown) => typeof a === 'string').slice(0, 4)
          : [],
        available_classes: Array.isArray(race.available_classes)
          ? race.available_classes.filter((c: unknown) => typeof c === 'string')
          : []
      };

      const bonusSum = Object.values(sanitized.bonuses).reduce((s, v) => s + v, 0);
      const penaltySum = Object.values(sanitized.penalties).reduce((s, v) => s + v, 0);
      const total = bonusSum + penaltySum;
      if (total < -2 || total > 3) {
        logger.warn('Race attribute total out of range, adjusting', { id: sanitized.id, total });
        if (total > 2) {
          const keys = Object.keys(sanitized.bonuses);
          if (keys.length > 0) {
            const excess = total - 2;
            sanitized.bonuses[keys[0]] = Math.max(0, sanitized.bonuses[keys[0]] - excess);
          }
        }
      }

      if (sanitized.abilities.length === 0) {
        sanitized.abilities = ['天赋本能'];
      }

      seenIds.add(sanitized.id);
      result.push(sanitized);
    }

    return result;
  }

  private validateAndSanitizeClasses(
    classes: GeneratedClass[] | undefined,
    existingIds: Set<string>
  ): GeneratedClass[] {
    if (!Array.isArray(classes)) return [];

    const seenIds = new Set<string>();
    const result: GeneratedClass[] = [];

    for (const cls of classes) {
      if (!cls || typeof cls !== 'object') continue;
      if (!cls.id || typeof cls.id !== 'string') continue;
      if (existingIds.has(cls.id) || seenIds.has(cls.id)) continue;

      const sanitized: GeneratedClass = {
        id: cls.id.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        name: typeof cls.name === 'string' && cls.name.trim() ? cls.name.trim() : cls.id,
        description: typeof cls.description === 'string' ? cls.description.trim() : '',
        primary_attributes: Array.isArray(cls.primary_attributes)
          ? cls.primary_attributes
              .filter((a: unknown) => typeof a === 'string' && VALID_ATTRIBUTE_KEYS.includes(a as string))
              .slice(0, 2)
          : ['str'],
        hit_die: VALID_HIT_DICE.includes(cls.hit_die) ? cls.hit_die : 'd8',
        skill_proficiencies: Array.isArray(cls.skill_proficiencies)
          ? cls.skill_proficiencies.filter((s: unknown) => typeof s === 'string').slice(0, 3)
          : [],
        starting_equipment: Array.isArray(cls.starting_equipment)
          ? cls.starting_equipment.filter((e: unknown) => typeof e === 'string').slice(0, 3)
          : []
      };

      if (sanitized.primary_attributes.length === 0) {
        sanitized.primary_attributes = ['str'];
      }
      if (sanitized.skill_proficiencies.length === 0) {
        sanitized.skill_proficiencies = ['基础训练'];
      }
      if (sanitized.starting_equipment.length === 0) {
        // 优先使用模板 initial_data.default_equipment，fallback 到 'basic-weapon'
        const defaultEquipment = this.defaultEquipment || 'basic-weapon';
        sanitized.starting_equipment = [defaultEquipment];
      }

      seenIds.add(sanitized.id);
      result.push(sanitized);
    }

    return result;
  }

  private validateAndSanitizeBackgrounds(
    backgrounds: GeneratedBackground[] | undefined,
    existingIds: Set<string>
  ): GeneratedBackground[] {
    if (!Array.isArray(backgrounds)) return [];

    const seenIds = new Set<string>();
    const result: GeneratedBackground[] = [];

    for (const bg of backgrounds) {
      if (!bg || typeof bg !== 'object') continue;
      if (!bg.id || typeof bg.id !== 'string') continue;
      if (existingIds.has(bg.id) || seenIds.has(bg.id)) continue;

      const sanitized: GeneratedBackground = {
        id: bg.id.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        name: typeof bg.name === 'string' && bg.name.trim() ? bg.name.trim() : bg.id,
        description: typeof bg.description === 'string' ? bg.description.trim() : '',
        feature: typeof bg.feature === 'string' && bg.feature.trim() ? bg.feature.trim() : '特殊背景 - 拥有独特的背景经历',
        attribute_bonuses: this.sanitizeAttributeMap(bg.attribute_bonuses),
        skill_proficiencies: Array.isArray(bg.skill_proficiencies)
          ? bg.skill_proficiencies.filter((s: unknown) => typeof s === 'string').slice(0, 3)
          : [],
        languages: Array.isArray(bg.languages)
          ? bg.languages.filter((l: unknown) => typeof l === 'string').slice(0, 2)
          : [],
        equipment: Array.isArray(bg.equipment)
          ? bg.equipment.filter((e: unknown) => typeof e === 'string').slice(0, 3)
          : []
      };

      const bonusTotal = Object.values(sanitized.attribute_bonuses).reduce((s, v) => s + v, 0);
      if (bonusTotal > 2) {
        logger.warn('Background attribute_bonuses total too high, capping', { id: sanitized.id, total: bonusTotal });
        const keys = Object.keys(sanitized.attribute_bonuses);
        if (keys.length > 0) {
          sanitized.attribute_bonuses[keys[0]] = sanitized.attribute_bonuses[keys[0]] - (bonusTotal - 2);
        }
      }

      if (sanitized.skill_proficiencies.length === 0) {
        sanitized.skill_proficiencies = ['生存技能'];
      }

      seenIds.add(sanitized.id);
      result.push(sanitized);
    }

    return result;
  }

  private sanitizeAttributeMap(map: Record<string, number> | undefined): Record<string, number> {
    if (!map || typeof map !== 'object') return {};
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(map)) {
      if (VALID_ATTRIBUTE_KEYS.includes(key) && typeof value === 'number' && isFinite(value)) {
        result[key] = Math.round(value);
      }
    }
    return result;
  }

  // ===== 新增：多类型AI生成入口 =====

  /**
   * 根据生成类型调用对应的AI生成方法
   * @param type 生成类型
   * @param templateId 模板ID
   * @param userPrompt 用户自定义提示（可选）
   */
  async generateByType(
    type: GenerateType,
    templateId: string,
    userPrompt?: string
  ): Promise<GeneratedResult> {
    if (!this.configLoader) {
      throw new Error('ConfigLoader not set, cannot generate');
    }
    if (!this.llmService) {
      throw new Error('LLMService not set, cannot generate');
    }
    if (!this.templateProvider) {
      throw new Error('TemplateProvider not set, cannot generate');
    }

    const template = await this.templateProvider.getTemplate(templateId);
    const templateName = template.name || templateId;
    const worldSetting = (template.worldSetting || {}) as Partial<WorldSetting>;
    const characterCreation = (template.characterCreation || {}) as Partial<CharacterCreationRules>;
    const startingScene = (template.startingScene || {}) as Partial<StartingScene>;

    switch (type) {
      case 'race':
      case 'class':
      case 'background': {
        const result = await this.generateWithLLM(
          templateId,
          templateName,
          characterCreation.races || [],
          characterCreation.classes || [],
          characterCreation.backgrounds || []
        );
        return { type, data: result };
      }
      case 'races': {
        const data = await this.generateRaces(
          templateId, templateName, worldSetting, characterCreation, userPrompt
        );
        return { type: 'races', data };
      }
      case 'classes': {
        const data = await this.generateClasses(
          templateId, templateName, worldSetting, characterCreation, userPrompt
        );
        return { type: 'classes', data };
      }
      case 'backgrounds': {
        const data = await this.generateBackgrounds(
          templateId, templateName, worldSetting, characterCreation, userPrompt
        );
        return { type: 'backgrounds', data };
      }
      case 'world_setting': {
        const data = await this.generateWorldSetting(
          templateId, templateName, worldSetting, userPrompt
        );
        return { type: 'world_setting', data };
      }
      case 'npc': {
        const data = await this.generateNPC(
          templateId, templateName, worldSetting, characterCreation, startingScene, userPrompt
        );
        return { type: 'npc', data };
      }
      case 'item': {
        const data = await this.generateItem(
          templateId, templateName, worldSetting, userPrompt
        );
        return { type: 'item', data };
      }
      case 'quest': {
        const data = await this.generateQuest(
          templateId, templateName, worldSetting, startingScene, userPrompt
        );
        return { type: 'quest', data };
      }
      case 'scene': {
        const data = await this.generateScene(
          templateId, templateName, worldSetting, startingScene, userPrompt
        );
        return { type: 'scene', data };
      }
      default:
        throw new Error(`Unknown generate type: ${type}`);
    }
  }

  // ===== 1. 生成世界设定 =====

  private async generateWorldSetting(
    templateId: string,
    templateName: string,
    worldSetting: Partial<WorldSetting>,
    userPrompt?: string
  ): Promise<GeneratedWorldSetting> {
    const systemPrompt = `你是一个RPG世界观设计师。根据提供的模板信息，创造一个完整的世界设定。

## 输出格式
返回纯JSON对象（不要用markdown代码块包裹），格式如下：
{
  "name": "世界名称",
  "description": "100-200字的世界描述，包含历史、文化、地理特色",
  "era": "时代背景（如：中世纪、未来、远古等）",
  "magic_system": "魔法体系描述（如：元素魔法、无魔法、灵力等）",
  "technology_level": "科技水平（如：石器时代、中世纪、蒸汽朋克、赛博朋克等）"
}

## 创造规则
- 世界名称要有特色，避免通用名称
- 描述要包含世界观的核心冲突和特色
- 时代、魔法体系和科技水平要相互协调
- 如果模板已有部分世界设定，在此基础上扩展和深化`;

    const userContent = `模板: ${templateName} (${templateId})

已有世界设定:
- 名称: ${worldSetting.name || '未设置'}
- 时代: ${worldSetting.era || '未设置'}
- 魔法体系: ${worldSetting.magic_system || '未设置'}
- 科技水平: ${worldSetting.technology_level || '未设置'}
- 描述: ${worldSetting.description || '未设置'}
${userPrompt ? `\n用户要求: ${userPrompt}` : ''}

请创造一个完整的世界设定。`;

    return this.callLLMAndParse<GeneratedWorldSetting>(
      templateId, 'generate_world_setting', systemPrompt, userContent,
      (parsed) => this.sanitizeWorldSetting(parsed)
    );
  }

  // ===== 2. 生成NPC =====

  private async generateNPC(
    templateId: string,
    templateName: string,
    worldSetting: Partial<WorldSetting>,
    characterCreation: Partial<CharacterCreationRules>,
    startingScene: Partial<StartingScene>,
    userPrompt?: string
  ): Promise<GeneratedNPC> {
    const existingRaces = (characterCreation.races || []).map(r => r.name).join('、');
    const existingNPCs = (startingScene.npcs || []).map(n => n.name).join('、');

    const systemPrompt = `你是一个RPG角色设计师。根据提供的模板世界观信息，创造一个生动的NPC角色。

## 输出格式
返回纯JSON对象（不要用markdown代码块包裹），格式如下：
{
  "id": "英文小写id（kebab-case）",
  "name": "NPC中文名称",
  "title": "NPC头衔或称号",
  "description": "50-100字的角色描述，包含外貌、性格特点",
  "role": "角色定位（如：商人、任务发布者、导师、敌人、盟友等）",
  "race": "种族（必须是模板中已有的种族）",
  "base_level": 1,
  "default_location": "默认所在位置",
  "base_stats": {"str": 10, "dex": 10, "con": 10, "int": 10, "wis": 10, "cha": 10}
}

## 创造规则
- NPC名称要有特色，符合世界观风格
- 角色描述要生动，有辨识度
- 种族必须从模板已有种族中选择
- base_level范围1-20，根据角色定位合理设定
- base_stats各项5-20之间，总和60-90，符合角色定位
- role要明确，便于游戏系统使用`;

    const userContent = `模板: ${templateName} (${templateId})

世界观:
- 名称: ${worldSetting.name || '未设置'}
- 时代: ${worldSetting.era || '未设置'}
- 魔法体系: ${worldSetting.magic_system || '未设置'}

可用种族: ${existingRaces || '无'}
已有NPC（不要重复）: ${existingNPCs || '无'}
${userPrompt ? `\n用户要求: ${userPrompt}` : ''}

请创造一个全新的NPC角色。`;

    return this.callLLMAndParse<GeneratedNPC>(
      templateId, 'generate_npc', systemPrompt, userContent,
      (parsed) => this.sanitizeNPC(parsed, characterCreation)
    );
  }

  // ===== 3. 生成物品 =====

  private async generateItem(
    templateId: string,
    templateName: string,
    worldSetting: Partial<WorldSetting>,
    userPrompt?: string
  ): Promise<GeneratedItem> {
    const systemPrompt = `你是一个RPG物品设计师。根据提供的模板世界观信息，创造一个有趣的物品。

## 输出格式
返回纯JSON对象（不要用markdown代码块包裹），格式如下：
{
  "id": "英文小写id（kebab-case）",
  "name": "物品中文名称",
  "description": "30-80字的物品描述，包含外观和功能",
  "category": "物品类别（weapon/armor/consumable/accessory/material/quest_item）",
  "quality": "稀有度（common/uncommon/rare/epic/legendary）",
  "effects": ["效果1", "效果2"],
  "value": 100
}

## 创造规则
- 物品名称要有特色，符合世界观风格
- category只能是: weapon, armor, consumable, accessory, material, quest_item
- quality只能是: common, uncommon, rare, epic, legendary
- effects描述物品的特殊效果，1-3个
- value表示物品价值（金币），common: 1-50, uncommon: 51-200, rare: 201-1000, epic: 1001-5000, legendary: 5001-50000
- 物品要与世界观风格协调`;

    const userContent = `模板: ${templateName} (${templateId})

世界观:
- 名称: ${worldSetting.name || '未设置'}
- 时代: ${worldSetting.era || '未设置'}
- 魔法体系: ${worldSetting.magic_system || '未设置'}
- 科技水平: ${worldSetting.technology_level || '未设置'}
${userPrompt ? `\n用户要求: ${userPrompt}` : ''}

请创造一个全新的物品。`;

    return this.callLLMAndParse<GeneratedItem>(
      templateId, 'generate_item', systemPrompt, userContent,
      (parsed) => this.sanitizeItem(parsed)
    );
  }

  // ===== 4. 生成任务 =====

  private async generateQuest(
    templateId: string,
    templateName: string,
    worldSetting: Partial<WorldSetting>,
    startingScene: Partial<StartingScene>,
    userPrompt?: string
  ): Promise<GeneratedQuest> {
    const existingQuests = (startingScene.quests || []).map(q => q.name).join('、');

    const systemPrompt = `你是一个RPG任务设计师。根据提供的模板世界观信息，创造一个引人入胜的任务。

## 输出格式
返回纯JSON对象（不要用markdown代码块包裹），格式如下：
{
  "id": "英文小写id（kebab-case）",
  "name": "任务中文名称",
  "description": "50-150字的任务描述，包含背景和目标",
  "type": "任务类型（main/side/daily/bounty/exploration）",
  "objectives": ["目标1", "目标2", "目标3"],
  "rewards": ["奖励1", "奖励2"]
}

## 创造规则
- 任务名称要吸引人，暗示任务内容
- type只能是: main, side, daily, bounty, exploration
- objectives包含2-4个具体可执行的目标
- rewards包含1-3个奖励描述（如"100金币"、"经验值x50"、"稀有武器"等）
- 任务要与世界观风格协调
- 任务设计要有层次感，目标逐步推进`;

    const userContent = `模板: ${templateName} (${templateId})

世界观:
- 名称: ${worldSetting.name || '未设置'}
- 时代: ${worldSetting.era || '未设置'}
- 魔法体系: ${worldSetting.magic_system || '未设置'}

已有任务（不要重复）: ${existingQuests || '无'}
${userPrompt ? `\n用户要求: ${userPrompt}` : ''}

请创造一个全新的任务。`;

    return this.callLLMAndParse<GeneratedQuest>(
      templateId, 'generate_quest', systemPrompt, userContent,
      (parsed) => this.sanitizeQuest(parsed)
    );
  }

  // ===== 5. 生成场景 =====

  private async generateScene(
    templateId: string,
    templateName: string,
    worldSetting: Partial<WorldSetting>,
    startingScene: Partial<StartingScene>,
    userPrompt?: string
  ): Promise<GeneratedScene> {
    const existingNPCs = (startingScene.npcs || []).map(n => n.name);
    const existingItems = (startingScene.items || []).map(i => i.name);

    const systemPrompt = `你是一个RPG场景设计师。根据提供的模板世界观信息，创造一个富有氛围的场景。

## 输出格式
返回纯JSON对象（不要用markdown代码块包裹），格式如下：
{
  "location": "场景位置名称",
  "description": "100-200字的场景描述，包含环境细节、感官体验",
  "atmosphere": "氛围关键词（如：阴森、热闹、神秘、宁静等）",
  "npcs": ["可能出现的NPC名称1", "NPC名称2"],
  "items": ["可能发现的物品名称1", "物品名称2"]
}

## 创造规则
- 场景位置名称要有画面感
- 描述要调动多种感官（视觉、听觉、嗅觉等）
- atmosphere用一个词概括场景氛围
- npcs列出1-3个可能在此场景出现的NPC名称
- items列出1-3个可能在此场景发现的物品名称
- 场景要与世界观风格协调`;

    const userContent = `模板: ${templateName} (${templateId})

世界观:
- 名称: ${worldSetting.name || '未设置'}
- 时代: ${worldSetting.era || '未设置'}
- 魔法体系: ${worldSetting.magic_system || '未设置'}

已有NPC（可引用）: ${existingNPCs.join('、') || '无'}
已有物品（可引用）: ${existingItems.join('、') || '无'}
${userPrompt ? `\n用户要求: ${userPrompt}` : ''}

请创造一个全新的场景。`;

    return this.callLLMAndParse<GeneratedScene>(
      templateId, 'generate_scene', systemPrompt, userContent,
      (parsed) => this.sanitizeScene(parsed)
    );
  }

  // ===== 6. 批量生成种族 =====

  private async generateRaces(
    templateId: string,
    templateName: string,
    worldSetting: Partial<WorldSetting>,
    characterCreation: Partial<CharacterCreationRules>,
    userPrompt?: string
  ): Promise<GeneratedRace[]> {
    const existingRaces = characterCreation.races || [];
    const existingClasses = characterCreation.classes || [];
    const existingRaceIds = existingRaces.map(r => r.id);
    const existingClassIds = existingClasses.map(c => c.id);

    const systemPrompt = `你是一个RPG种族设计师。根据提供的模板世界观信息，创造3-5个全新的种族。

## 输出格式
返回纯JSON对象（不要用markdown代码块包裹），格式如下：
{
  "races": [
    {
      "id": "英文小写id",
      "name": "中文名称",
      "description": "50-100字描述",
      "bonuses": {"str": 2, "cha": 1},
      "penalties": {"dex": -1},
      "abilities": ["能力1", "能力2"],
      "available_classes": ["warrior", "新职业id"]
    }
  ]
}

## 创造规则
- 创造3-5个全新种族，ID不能与已有种族重复（已有: ${existingRaceIds.join(', ')}）
- 每个种族必须有bonuses和penalties，属性加成/惩罚总和在-1到+2之间
- bonuses和penalties的key只能是: str, dex, con, int, wis, cha
- 每个种族2-3个abilities（种族特有能力）
- available_classes可以引用已有职业ID（${existingClassIds.join(', ')}）
- 每个种族至少2个可用职业
- 种族要符合世界观风格`;

    const userContent = `模板: ${templateName} (${templateId})

世界观:
- 名称: ${worldSetting.name || '未设置'}
- 时代: ${worldSetting.era || '未设置'}
- 魔法体系: ${worldSetting.magic_system || '未设置'}

已有种族（供参考，不要重复）:
${existingRaces.map(r => `- ${r.id}: ${r.name} - ${r.description}`).join('\n')}

已有职业（供available_classes引用）:
${existingClasses.map(c => `- ${c.id}: ${c.name}`).join('\n')}
${userPrompt ? `\n用户要求: ${userPrompt}` : ''}

请创造全新的种族选项。`;

    try {
      const response = await this.llmService!.chat(
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
        { temperature: 0.9, maxTokens: 3000 },
        undefined,
        'generate_races'
      );

      const parsed = this.parseLLMResponse(response.content, templateId);
      if (!parsed) return [];

      const generatedRaces = this.validateAndSanitizeRaces(
        parsed.races as GeneratedRace[],
        new Set(existingRaceIds)
      );

      const validClassIds = new Set([...existingClassIds, ...generatedRaces.map(c => c.id)]);
      for (const race of generatedRaces) {
        race.available_classes = race.available_classes.filter(id => validClassIds.has(id));
        if (race.available_classes.length === 0) {
          race.available_classes = existingClassIds.slice(0, 2);
        }
      }

      logger.info('AI generated races successfully', { templateId, count: generatedRaces.length });
      return generatedRaces;
    } catch (error) {
      const errMsg = getErrorMessage(error);
      logger.warn('LLM generateRaces failed', { templateId, error: errMsg });
      return [];
    }
  }

  // ===== 7. 批量生成职业 =====

  private async generateClasses(
    templateId: string,
    templateName: string,
    worldSetting: Partial<WorldSetting>,
    characterCreation: Partial<CharacterCreationRules>,
    userPrompt?: string
  ): Promise<GeneratedClass[]> {
    const existingClasses = characterCreation.classes || [];
    const existingClassIds = existingClasses.map(c => c.id);

    const systemPrompt = `你是一个RPG职业设计师。根据提供的模板世界观信息，创造3-5个全新的职业。

## 输出格式
返回纯JSON对象（不要用markdown代码块包裹），格式如下：
{
  "classes": [
    {
      "id": "英文小写id",
      "name": "中文名称",
      "description": "50-100字描述",
      "primary_attributes": ["str", "cha"],
      "hit_die": "d10",
      "skill_proficiencies": ["技能1", "技能2"],
      "starting_equipment": ["装备1", "装备2"]
    }
  ]
}

## 创造规则
- 创造3-5个全新职业，ID不能与已有职业重复（已有: ${existingClassIds.join(', ')}）
- primary_attributes从str/dex/con/int/wis/cha中选2个
- hit_die只能是: d6(脆皮), d8(中等), d10(坦克), d12(超肉)
- 2-3个skill_proficiencies
- 2-3个starting_equipment（用英文kebab-case ID）
- 职业要符合世界观风格`;

    const userContent = `模板: ${templateName} (${templateId})

世界观:
- 名称: ${worldSetting.name || '未设置'}
- 时代: ${worldSetting.era || '未设置'}
- 魔法体系: ${worldSetting.magic_system || '未设置'}

已有职业（供参考，不要重复）:
${existingClasses.map(c => `- ${c.id}: ${c.name} - ${c.description} (主属性: ${c.primary_attributes?.join('/')}, 生命骰: ${c.hit_die})`).join('\n')}
${userPrompt ? `\n用户要求: ${userPrompt}` : ''}

请创造全新的职业选项。`;

    try {
      const response = await this.llmService!.chat(
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
        { temperature: 0.9, maxTokens: 3000 },
        undefined,
        'generate_classes'
      );

      const parsed = this.parseLLMResponse(response.content, templateId);
      if (!parsed) return [];

      const generatedClasses = this.validateAndSanitizeClasses(
        parsed.classes as GeneratedClass[],
        new Set(existingClassIds)
      );

      logger.info('AI generated classes successfully', { templateId, count: generatedClasses.length });
      return generatedClasses;
    } catch (error) {
      const errMsg = getErrorMessage(error);
      logger.warn('LLM generateClasses failed', { templateId, error: errMsg });
      return [];
    }
  }

  // ===== 8. 批量生成背景 =====

  private async generateBackgrounds(
    templateId: string,
    templateName: string,
    worldSetting: Partial<WorldSetting>,
    characterCreation: Partial<CharacterCreationRules>,
    userPrompt?: string
  ): Promise<GeneratedBackground[]> {
    const existingBackgrounds = characterCreation.backgrounds || [];
    const existingBackgroundIds = existingBackgrounds.map(b => b.id);

    const systemPrompt = `你是一个RPG背景设计师。根据提供的模板世界观信息，创造3-5个全新的角色背景。

## 输出格式
返回纯JSON对象（不要用markdown代码块包裹），格式如下：
{
  "backgrounds": [
    {
      "id": "英文小写id",
      "name": "中文名称",
      "description": "50-100字描述",
      "feature": "特性名称 - 特性描述",
      "attribute_bonuses": {"cha": 1},
      "skill_proficiencies": ["技能1", "技能2"],
      "languages": ["语言1"],
      "equipment": ["装备1", "装备2"]
    }
  ]
}

## 创造规则
- 创造3-5个全新背景，ID不能与已有背景重复（已有: ${existingBackgroundIds.join(', ')}）
- feature格式: "特性名称 - 特性描述"
- attribute_bonuses总和在0到+2之间
- 2个skill_proficiencies
- 1-2个languages
- 2-3个equipment（用英文kebab-case ID）
- 背景要符合世界观风格`;

    const userContent = `模板: ${templateName} (${templateId})

世界观:
- 名称: ${worldSetting.name || '未设置'}
- 时代: ${worldSetting.era || '未设置'}
- 魔法体系: ${worldSetting.magic_system || '未设置'}

已有背景（供参考，不要重复）:
${existingBackgrounds.map(b => `- ${b.id}: ${b.name} - ${b.description} (特性: ${b.feature})`).join('\n')}
${userPrompt ? `\n用户要求: ${userPrompt}` : ''}

请创造全新的背景选项。`;

    try {
      const response = await this.llmService!.chat(
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
        { temperature: 0.9, maxTokens: 3000 },
        undefined,
        'generate_backgrounds'
      );

      const parsed = this.parseLLMResponse(response.content, templateId);
      if (!parsed) return [];

      const generatedBackgrounds = this.validateAndSanitizeBackgrounds(
        parsed.backgrounds as GeneratedBackground[],
        new Set(existingBackgroundIds)
      );

      logger.info('AI generated backgrounds successfully', { templateId, count: generatedBackgrounds.length });
      return generatedBackgrounds;
    } catch (error) {
      const errMsg = getErrorMessage(error);
      logger.warn('LLM generateBackgrounds failed', { templateId, error: errMsg });
      return [];
    }
  }

  // ===== LLM调用与解析通用方法 =====

  private parseLLMResponse(content: string | undefined, templateId: string): Record<string, unknown> | null {
    if (!content) return null;

    try {
      return parseLLMJson<Record<string, unknown>>(content, `GenerateOptionsTool:${templateId}`);
    } catch {
      logger.warn('LLM response JSON parse failed', { templateId });
      return null;
    }
  }

  private async callLLMAndParse<T>(
    templateId: string,
    agentType: string,
    systemPrompt: string,
    userContent: string,
    sanitizer: (parsed: Record<string, unknown>) => T
  ): Promise<T> {
    try {
      const response = await this.llmService!.chat(
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
        { temperature: 0.9, maxTokens: 2000 },
        undefined,
        agentType
      );

      const parsed = this.parseLLMResponse(response.content, templateId);
      if (!parsed) {
        throw new Error(`LLM response parsing failed for ${agentType}`);
      }

      const result = sanitizer(parsed);
      logger.info(`AI generated ${agentType} successfully`, { templateId });
      return result;
    } catch (error) {
      const errMsg = getErrorMessage(error);
      logger.warn(`LLM ${agentType} generation failed`, { templateId, error: errMsg });
      throw error;
    }
  }

  // ===== 各类型的清洗/校验方法 =====

  private sanitizeWorldSetting(parsed: Record<string, unknown>): GeneratedWorldSetting {
    return {
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : '未名世界',
      description: typeof parsed.description === 'string' ? parsed.description.trim() : '一个神秘的世界。',
      era: typeof parsed.era === 'string' && parsed.era.trim() ? parsed.era.trim() : '中世纪',
      magic_system: typeof parsed.magic_system === 'string' && parsed.magic_system.trim() ? parsed.magic_system.trim() : '元素魔法',
      technology_level: typeof parsed.technology_level === 'string' && parsed.technology_level.trim() ? parsed.technology_level.trim() : '中世纪',
    };
  }

  private sanitizeNPC(parsed: Record<string, unknown>, characterCreation: Partial<CharacterCreationRules>): GeneratedNPC {
    const validRaces = (characterCreation.races || []).map(r => r.id);
    const race = typeof parsed.race === 'string' && validRaces.includes(parsed.race)
      ? parsed.race
      : (validRaces[0] || 'human');

    const rawStats = (parsed.base_stats && typeof parsed.base_stats === 'object')
      ? parsed.base_stats as Record<string, unknown>
      : {};

    const baseStats: Record<string, number> = {};
    for (const key of VALID_ATTRIBUTE_KEYS) {
      const val = rawStats[key];
      baseStats[key] = typeof val === 'number' && isFinite(val)
        ? Math.max(1, Math.min(20, Math.round(val)))
        : 10;
    }

    return {
      id: typeof parsed.id === 'string'
        ? parsed.id.toLowerCase().replace(/[^a-z0-9-]/g, '-')
        : `npc-${Date.now()}`,
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : '无名NPC',
      title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : '神秘人',
      description: typeof parsed.description === 'string' ? parsed.description.trim() : '一个神秘的NPC。',
      role: typeof parsed.role === 'string' && parsed.role.trim() ? parsed.role.trim() : 'npc',
      race,
      base_level: typeof parsed.base_level === 'number' && isFinite(parsed.base_level)
        ? Math.max(1, Math.min(20, Math.round(parsed.base_level)))
        : 1,
      default_location: typeof parsed.default_location === 'string' && parsed.default_location.trim()
        ? parsed.default_location.trim()
        : '未知地点',
      base_stats: baseStats,
    };
  }

  private sanitizeItem(parsed: Record<string, unknown>): GeneratedItem {
    const validCategories = ['weapon', 'armor', 'consumable', 'accessory', 'material', 'quest_item'];
    const validQualities = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

    const quality = typeof parsed.quality === 'string' && validQualities.includes(parsed.quality)
      ? parsed.quality
      : 'common';

    const qualityValueRanges: Record<string, [number, number]> = {
      common: [1, 50],
      uncommon: [51, 200],
      rare: [201, 1000],
      epic: [1001, 5000],
      legendary: [5001, 50000],
    };

    const [minVal, maxVal] = qualityValueRanges[quality] || [1, 50];
    const rawValue = typeof parsed.value === 'number' && isFinite(parsed.value)
      ? parsed.value
      : minVal;

    return {
      id: typeof parsed.id === 'string'
        ? parsed.id.toLowerCase().replace(/[^a-z0-9-]/g, '-')
        : `item-${Date.now()}`,
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : '未名物品',
      description: typeof parsed.description === 'string' ? parsed.description.trim() : '一个普通的物品。',
      category: typeof parsed.category === 'string' && validCategories.includes(parsed.category)
        ? parsed.category
        : 'consumable',
      quality,
      effects: Array.isArray(parsed.effects)
        ? parsed.effects.filter((e: unknown) => typeof e === 'string').slice(0, 3)
        : [],
      value: Math.max(minVal, Math.min(maxVal, Math.round(rawValue))),
    };
  }

  private sanitizeQuest(parsed: Record<string, unknown>): GeneratedQuest {
    const validTypes = ['main', 'side', 'daily', 'bounty', 'exploration'];

    return {
      id: typeof parsed.id === 'string'
        ? parsed.id.toLowerCase().replace(/[^a-z0-9-]/g, '-')
        : `quest-${Date.now()}`,
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : '未名任务',
      description: typeof parsed.description === 'string' ? parsed.description.trim() : '一个神秘的任务。',
      type: typeof parsed.type === 'string' && validTypes.includes(parsed.type)
        ? parsed.type
        : 'side',
      objectives: Array.isArray(parsed.objectives)
        ? parsed.objectives.filter((o: unknown) => typeof o === 'string').slice(0, 4)
        : ['完成任务目标'],
      rewards: Array.isArray(parsed.rewards)
        ? parsed.rewards.filter((r: unknown) => typeof r === 'string').slice(0, 3)
        : ['经验值'],
    };
  }

  private sanitizeScene(parsed: Record<string, unknown>): GeneratedScene {
    return {
      location: typeof parsed.location === 'string' && parsed.location.trim()
        ? parsed.location.trim()
        : '未知地点',
      description: typeof parsed.description === 'string' ? parsed.description.trim() : '一个普通的场景。',
      atmosphere: typeof parsed.atmosphere === 'string' && parsed.atmosphere.trim()
        ? parsed.atmosphere.trim()
        : '平静',
      npcs: Array.isArray(parsed.npcs)
        ? parsed.npcs.filter((n: unknown) => typeof n === 'string').slice(0, 3)
        : [],
      items: Array.isArray(parsed.items)
        ? parsed.items.filter((i: unknown) => typeof i === 'string').slice(0, 3)
        : [],
    };
  }

}
