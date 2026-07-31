import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import yaml from 'js-yaml';
import type { Knex } from 'knex';
import { ID, Timestamp } from '../../../shared/src/types/core.js';
import type { ConfigLoader } from '../agents/config/ConfigLoader.js';
import { TemplatePoolService } from './template-pool.js';
import { randomUUID } from 'crypto';
import type { ITemplateProvider } from '../game-systems/shared/types.js';
import { TemplateRuleParser } from '../game-systems/shared/rule-parser/TemplateRuleParser.js';
import type { InventoryRuleSet } from '../../../shared/src/types/template.js';
import type { ChallengeMode } from '../../../shared/src/types/challenge.js';
import { isChallengeMode } from '../../../shared/src/types/challenge.js';

const DEFAULT_GAME_MODES = [
  'text_adventure',
  'turn_based_rpg',
  'action_rpg',
  'sandbox',
  'visual_novel',
  'roguelike',
  'strategy',
] as const;

/**
 * 从已加载的模板中动态提取所有有效的 game_mode 值。
 * 如果传入了模板列表且包含 game_mode，则去重后返回；
 * 否则回退到 DEFAULT_GAME_MODES。
 */
export function getValidGameModes(loadedTemplates?: Array<{ gameMode: string }>): string[] {
  if (loadedTemplates && loadedTemplates.length > 0) {
    const modes = [...new Set(loadedTemplates.map(t => t.gameMode).filter(Boolean))];
    if (modes.length > 0) return modes;
  }
  return [...DEFAULT_GAME_MODES];
}

/**
 * 解析后的模板结构——从 raw_content 解析而来，作为内存缓存的值类型。
 * 对外暴露时仍使用 TemplateRecord 名称，但内部结构统一为 ParsedTemplate。
 */
export interface TemplateRecord {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  tags: string[];
  gameMode: string;
  /** 模板配置的默认挑战模式（未配置为 null，由组合根回退到 turn_based_combat） */
  defaultChallengeMode: ChallengeMode | null;
  numericalComplexity: string;
  agentProfile: string;
  isBuiltin: boolean;
  source: string;
  // 结构化数据段
  worldSetting: Record<string, unknown>;
  characterCreation: Record<string, unknown>;
  gameRules: Record<string, unknown>;
  aiConstraints: Record<string, unknown>;
  startingScene: Record<string, unknown>;
  initialData: Record<string, unknown>;
  skills: Record<string, unknown>[];
  items: Record<string, unknown>[];
  npcs: Record<string, unknown>[];
  locations: Record<string, unknown>[];
  uiTheme: Record<string, unknown>;
  uiLayout: Record<string, unknown>;
  specialRules: Record<string, unknown>;
  combat: Record<string, unknown>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PromptConfig {
  id: ID;
  agent_type: string;
  prompt_type: string;
  name: string;
  content: string;
  variables: string[];
  version: string;
  is_active: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ field: string; message: string; severity: 'error' | 'warning' }>;
  warnings: Array<{ field: string; message: string }>;
  score: number;
}

/** DB 行结构——新表只有 raw_content + 元数据列 */
interface TemplateRow {
  id: string;
  raw_content: string;
  source: string;
  is_builtin: number;
  created_at: number;
  updated_at: number;
}

/** YAML 解析后的原始结构（字段名保持 snake_case 与 YAML 一致） */
interface RawYamlTemplate {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  tags?: string[];
  game_mode?: string;
  default_challenge_mode?: string;
  numerical_complexity?: string;
  agent_profile?: string;
  is_builtin?: boolean;
  world_setting?: Record<string, unknown>;
  character_creation?: Record<string, unknown>;
  game_rules?: Record<string, unknown>;
  ai_constraints?: Record<string, unknown>;
  starting_scene?: Record<string, unknown>;
  initial_data?: Record<string, unknown>;
  skills?: Record<string, unknown>[];
  items?: Record<string, unknown>[];
  ui_theme?: Record<string, unknown>;
  ui_layout?: Record<string, unknown>;
  special_rules?: Record<string, unknown>;
  combat?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * 将 YAML 解析后的原始数据转换为 ParsedTemplate（TemplateRecord）。
 * 字段名从 snake_case 转换为 camelCase。
 */
function rawToRecord(raw: RawYamlTemplate, row: TemplateRow): TemplateRecord {
  const startingScene = (raw.starting_scene ?? {}) as Record<string, unknown>;
  const sceneNpcs = (startingScene.npcs as Record<string, unknown>[]) ?? [];

  return {
    id: raw.id ?? row.id,
    name: (raw.name as string) || 'Untitled Template',
    description: (raw.description as string) || '',
    version: (raw.version as string) || '1.0.0',
    author: (raw.author as string) || '',
    tags: (raw.tags as string[]) || [],
    gameMode: (raw.game_mode as string) || 'text_adventure',
    defaultChallengeMode: isChallengeMode(raw.default_challenge_mode) ? raw.default_challenge_mode : null,
    numericalComplexity: (raw.numerical_complexity as string) || 'medium',
    agentProfile: (raw.agent_profile as string) || '',
    isBuiltin: !!row.is_builtin,
    source: row.source || 'yaml',
    worldSetting: (raw.world_setting as Record<string, unknown>) ?? {},
    characterCreation: (raw.character_creation as Record<string, unknown>) ?? {},
    gameRules: (raw.game_rules as Record<string, unknown>) ?? {},
    aiConstraints: (raw.ai_constraints as Record<string, unknown>) ?? {},
    startingScene,
    initialData: (raw.initial_data as Record<string, unknown>) ?? {},
    skills: (raw.skills as Record<string, unknown>[]) ?? [],
    items: (raw.items as Record<string, unknown>[]) ?? [],
    npcs: sceneNpcs,
    locations: (raw.locations as Record<string, unknown>[]) ?? [],
    uiTheme: (raw.ui_theme as Record<string, unknown>) ?? {},
    uiLayout: (raw.ui_layout as Record<string, unknown>) ?? {},
    specialRules: (raw.special_rules as Record<string, unknown>) ?? {},
    combat: (raw.combat as Record<string, unknown>) ?? {},
    createdAt: row.created_at as Timestamp,
    updatedAt: row.updated_at as Timestamp,
  };
}

/**
 * 将 ParsedTemplate 序列化为 YAML 原始结构（snake_case），
 * 用于写入 raw_content。
 */
function recordToRaw(template: TemplateRecord): RawYamlTemplate {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    version: template.version,
    author: template.author,
    tags: template.tags,
    game_mode: template.gameMode,
    // 未配置时不写入该字段（避免 raw_content 中出现 null 值污染 YAML）
    ...(template.defaultChallengeMode ? { default_challenge_mode: template.defaultChallengeMode } : {}),
    numerical_complexity: template.numericalComplexity,
    agent_profile: template.agentProfile,
    is_builtin: template.isBuiltin,
    world_setting: template.worldSetting,
    character_creation: template.characterCreation,
    game_rules: template.gameRules,
    ai_constraints: template.aiConstraints,
    starting_scene: {
      ...template.startingScene,
      npcs: template.npcs,
    },
    initial_data: template.initialData,
    skills: template.skills,
    items: template.items,
    locations: template.locations,
    ui_theme: template.uiTheme,
    ui_layout: template.uiLayout,
    special_rules: template.specialRules,
    combat: template.combat,
  };
}

export class TemplateService implements ITemplateProvider {
  private db: Knex;
  private logger: ReturnType<typeof createChildLogger>;
  private configDir: string;
  private cache: Map<string, TemplateRecord> = new Map();
  private configLoader: ConfigLoader | null;
  private templatePoolService: TemplatePoolService | null;

  constructor(db: Knex, configDir?: string, configLoader?: ConfigLoader) {
    this.db = db;
    this.logger = createChildLogger('template');
    this.configDir = resolve(configDir || 'config');
    this.configLoader = configLoader || null;
    this.templatePoolService = null;
  }

  setTemplatePoolService(service: TemplatePoolService): void {
    this.templatePoolService = service;
  }

  /**
   * 启动入口：扫描 YAML 文件 → 同步到 DB → 从 DB 加载缓存
   */
  async loadAll(): Promise<void> {
    try {
      await this.syncYamlFilesToDb();
    } catch {
      this.logger.info('Database not available, skipping YAML sync');
    }

    try {
      await this.refreshCache();
    } catch {
      this.logger.info('Database not available, skipping cache refresh');
    }

    this.logger.info('TemplateService loaded', {
      cachedTemplates: this.cache.size,
    });
  }

  /**
   * 扫描 config/templates/ 目录下所有 YAML 文件，同步到 DB。
   * - 不存在则 INSERT
   * - 存在且 source='yaml' 则 UPDATE（YAML 文件可能更新了）
   * - 存在且 source='editor' 则跳过（编辑器创建的模板不覆盖）
   */
  private async syncYamlFilesToDb(): Promise<void> {
    const templatesDir = join(this.configDir, 'templates');
    if (!existsSync(templatesDir)) {
      this.logger.info('No templates directory found, skipping YAML sync');
      return;
    }

    const files = readdirSync(templatesDir).filter(
      (f) => f.endsWith('.yaml') || f.endsWith('.yml')
    );

    let synced = 0;
    for (const file of files) {
      const filePath = join(templatesDir, file);
      try {
        const content = readFileSync(filePath, 'utf-8');
        const parsed = yaml.load(content, { schema: yaml.DEFAULT_SCHEMA }) as RawYamlTemplate;
        if (!parsed?.id) {
          this.logger.warn(`YAML file ${file} has no id, skipping`);
          continue;
        }
        const syncedThis = await this.syncYamlToDb(parsed.id as string, content, parsed);
        if (syncedThis) synced++;
      } catch (error) {
        this.logger.error(`Failed to sync template from ${file}: ${error}`);
      }
    }

    this.logger.info(`Synced ${synced} templates from YAML to database`);
  }

  /**
   * 同步单个 YAML 文件到 DB。
   * @returns true 如果执行了 INSERT 或 UPDATE，false 如果跳过
   */
  async syncYamlToDb(templateId: string, rawContent: string, parsed?: RawYamlTemplate): Promise<boolean> {
    if (!parsed) {
      parsed = yaml.load(rawContent, { schema: yaml.DEFAULT_SCHEMA }) as RawYamlTemplate;
    }

    const isBuiltin = parsed.is_builtin === true || String(parsed.is_builtin) === 'true' || parsed.isBuiltin === true;
    const now = Date.now();

    const existing = await this.db('templates').where({ id: templateId }).first();

    let synced = false;
    if (!existing) {
      await this.db('templates').insert({
        id: templateId,
        raw_content: rawContent,
        source: 'yaml',
        is_builtin: isBuiltin ? 1 : 0,
        created_at: now,
        updated_at: now,
      });
      this.logger.info(`Synced template from YAML to DB: ${templateId}`);
      synced = true;
    } else if (existing.source === 'yaml') {
      await this.db('templates').where({ id: templateId }).update({
        raw_content: rawContent,
        is_builtin: isBuiltin ? 1 : 0,
        updated_at: now,
      });
      TemplateRuleParser.invalidate(templateId);
      this.logger.info(`Updated YAML template in DB: ${templateId}`);
      synced = true;
    } else {
      this.logger.debug(`Template ${templateId} exists with source='${existing.source}', skipping YAML sync`);
    }

    return synced;
  }

  /**
   * 从 DB 重新加载所有模板到内存缓存。
   * 读取每行的 raw_content，用 yaml.load() 解析为 ParsedTemplate。
   */
  async refreshCache(): Promise<void> {
    const rows = await this.db<TemplateRow>('templates').select();
    const newCache = new Map<string, TemplateRecord>();

    for (const row of rows) {
      try {
        const raw = yaml.load(row.raw_content, { schema: yaml.DEFAULT_SCHEMA }) as RawYamlTemplate;
        const record = rawToRecord(raw, row);
        newCache.set(row.id, record);
      } catch (error) {
        this.logger.error(`Failed to parse template ${row.id} from raw_content: ${error}`);
      }
    }

    this.cache = newCache;
    this.logger.info(`Cache refreshed with ${this.cache.size} templates`);
  }

  /**
   * 获取模板的某个数据段。
   */
  getTemplateBySection(templateId: string, sectionKey: string): Record<string, unknown> | Record<string, unknown>[] | undefined {
    const template = this.cache.get(templateId);
    if (!template) return undefined;

    // 注意：此方法是同步的，调用方应确保缓存已加载

    const sectionMap: Record<string, unknown> = {
      worldSetting: template.worldSetting,
      characterCreation: template.characterCreation,
      gameRules: template.gameRules,
      aiConstraints: template.aiConstraints,
      startingScene: template.startingScene,
      initialData: template.initialData,
      skills: template.skills,
      items: template.items,
      npcs: template.npcs,
      locations: template.locations,
      uiTheme: template.uiTheme,
      uiLayout: template.uiLayout,
      specialRules: template.specialRules,
      combat: template.combat,
    };

    return sectionMap[sectionKey] as Record<string, unknown> | Record<string, unknown>[] | undefined;
  }

  /**
   * 获取模板中所有技能定义。
   * 从内存缓存中直接返回 ParsedTemplate.skills 数组。
   */
  getTemplateSkills(templateId: string): Record<string, unknown>[] {
    const template = this.cache.get(templateId);
    if (!template) return [];
    return template.skills ?? [];
  }

  async getTemplates(): Promise<TemplateRecord[]> {
    if (this.cache.size === 0) {
      await this.refreshCache();
    }
    const templates = Array.from(this.cache.values());
    templates.sort((a, b) => a.name.localeCompare(b.name));
    this.logger.debug(`Listed ${templates.length} templates`);
    return templates;
  }

  /** ITemplateProvider 端口：获取模板默认挑战模式（未配置返回 null） */
  async getDefaultChallengeMode(templateId: ID): Promise<ChallengeMode | null> {
    if (this.cache.size === 0) {
      await this.refreshCache();
    }
    return this.cache.get(templateId)?.defaultChallengeMode ?? null;
  }

  async getTemplate(id: ID): Promise<TemplateRecord> {
    if (this.cache.size === 0) {
      await this.refreshCache();
    }
    const template = this.cache.get(id);
    if (!template) {
      throw new Error(`Template not found: ${id}`);
    }
    this.logger.debug('Template loaded from cache', { id, name: template.name });
    return template;
  }

  /**
   * 同步获取 TemplateRecord（从缓存，方案L DataProviders 用）。
   * 调用方应确保缓存已加载（init.ts 启动时已 refreshCache）。
   * 缓存未命中返回 null（不抛错，由 adapter 决定如何处理）。
   */
  getTemplateRecordSync(id: ID): TemplateRecord | null {
    return this.cache.get(id) ?? null;
  }

  /**
   * 将 TemplateRecord 转换为 API 响应格式（snake_case），
   * 保持与前端 StoryTemplate 类型的兼容性。
   */
  static toApiResponse(template: TemplateRecord): Record<string, unknown> {
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      version: template.version,
      author: template.author,
      tags: template.tags,
      game_mode: template.gameMode,
      default_challenge_mode: template.defaultChallengeMode,
      numerical_complexity: template.numericalComplexity,
      agent_profile: template.agentProfile,
      is_builtin: template.isBuiltin,
      source: template.source,
      world_setting: template.worldSetting,
      character_creation: template.characterCreation,
      game_rules: template.gameRules,
      ai_constraints: template.aiConstraints,
      starting_scene: {
        ...template.startingScene,
        npcs: template.npcs,
      },
      initial_data: template.initialData,
      skills: template.skills,
      items: template.items,
      ui_theme: template.uiTheme,
      ui_layout: template.uiLayout,
      special_rules: template.specialRules,
      combat: template.combat,
      created_at: template.createdAt,
      updated_at: template.updatedAt,
    };
  }

  async getTemplatePrompts(templateId: ID): Promise<Record<string, PromptConfig[]>> {
    try {
      const template = await this.getTemplate(templateId);
      const prompts = await this.db('prompts')
        .where({ is_active: 1 })
        .select();

      const promptMap: Record<string, PromptConfig[]> = {};
      for (const p of prompts) {
        const agentType = p.agent_type;
        if (!promptMap[agentType]) {
          promptMap[agentType] = [];
        }
        promptMap[agentType].push({
          id: p.id,
          agent_type: p.agent_type,
          prompt_type: p.prompt_type,
          name: p.name,
          content: p.content,
          variables: JSON.parse(p.variables || '[]'),
          version: p.version,
          is_active: !!p.is_active,
        });
      }

      // 从 ConfigLoader 读取各 Agent 的 prompt 文件并合并到结果中
      if (this.configLoader) {
        const profiles = this.configLoader.getAllProfiles();
        if (profiles.length > 0) {
          const defaultProfile = profiles[0];
          for (const [agentKey, agentConfig] of Object.entries(defaultProfile.agents)) {
            if (!promptMap[agentKey]) {
              try {
                const systemPrompt = this.configLoader.loadSystemPrompt(defaultProfile.name, agentKey);
                if (systemPrompt) {
                  promptMap[agentKey] = [{
                    id: `agent-${agentKey}`,
                    agent_type: agentKey,
                    prompt_type: 'system',
                    name: agentConfig.name,
                    content: systemPrompt,
                    variables: [],
                    version: '1.0.0',
                    is_active: true,
                  }];
                }
              } catch (error) {
                this.logger.warn(`Failed to load system prompt for agent ${agentKey}`, {
                  agentKey,
                  error: getErrorMessage(error),
                });
              }
            }
          }
        }
      }

      promptMap['_template'] = [{
        id: templateId,
        agent_type: '_template',
        prompt_type: 'system',
        name: `${template.name} - System Context`,
        content: this.buildSystemContext(template),
        variables: ['worldSetting', 'gameRules', 'aiConstraints'],
        version: template.version,
        is_active: true,
      }];

      this.logger.debug('Template prompts loaded', {
        templateId,
        agentTypes: Object.keys(promptMap),
      });

      return promptMap;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get template prompts', { templateId, error: errorMessage });
      throw error;
    }
  }

  validateTemplate(template: unknown): boolean {
    try {
      if (!template || typeof template !== 'object') {
        this.logger.warn('Invalid template: not an object');
        return false;
      }

      const t = template as Record<string, unknown>;

      if (!t.name || typeof t.name !== 'string' || (t.name as string).trim().length === 0) {
        this.logger.warn('Invalid template: name is required');
        return false;
      }

      const validModes = getValidGameModes(
        Array.from(this.cache.values()) as Array<{ gameMode: string }>
      );
      const gameMode = (t.gameMode || t.game_mode) as string;
      if (!gameMode || !validModes.includes(gameMode)) {
        this.logger.warn(`Invalid template: invalid game_mode: ${gameMode}`);
        return false;
      }

      this.logger.debug('Template validation passed', { name: t.name });
      return true;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Template validation error', { error: errorMessage });
      return false;
    }
  }

  /**
   * 根据模板ID获取系统上下文（公开异步方法）
   * 用于在Agent处理消息时动态注入模板的世界设定和AI约束
   */
  async getSystemContext(templateId: string): Promise<string> {
    try {
      const template = await this.getTemplate(templateId as ID);
      return this.buildSystemContext(template);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.warn('Failed to get system context for template, returning empty', {
        templateId,
        error: errorMessage,
      });
      return '';
    }
  }

  async getWorldContext(templateId: string): Promise<string> {
    try {
      const template = await this.getTemplate(templateId as ID);
      return this.buildWorldContext(template);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.warn('Failed to get world context for template, returning empty', {
        templateId,
        error: errorMessage,
      });
      return '';
    }
  }

  async getInventoryRules(templateId: ID): Promise<InventoryRuleSet> {
    const ruleParser = await TemplateRuleParser.fromTemplateId(this.db, templateId);
    return ruleParser.getInventoryRules();
  }

  buildWorldContext(template: TemplateRecord): string {
    const ws = template.worldSetting;
    const parts = [
      `# Game World: ${template.name}`,
      '',
      `## World Setting`,
      `- Name: ${ws.name || 'Unknown'}`,
      `- Era: ${ws.era || 'Unspecified'}`,
      `- Magic System: ${ws.magic_system || 'None'}`,
      `- Technology Level: ${ws.technology_level || 'Unspecified'}`,
      `- Game Mode: ${template.gameMode}`,
      '',
      `## Rules`,
      ...Object.entries(template.gameRules).map(([key, value]) => `- ${key}: ${JSON.stringify(value)}`),
      '',
      `## AI Constraints`,
      ...Object.entries(template.aiConstraints).map(([key, value]) => `- ${key}: ${JSON.stringify(value)}`),
    ];

    const sr = template.specialRules;
    if (sr && Object.keys(sr).length > 0) {
      parts.push(
        '',
        `## Special Rules`,
        `- Has KP (Keeper): ${sr.has_kp ? 'Yes' : 'No'}`,
        `- Permadeath: ${sr.permadeath ? 'Yes' : 'No'}`,
        `- Save Restriction: ${sr.save_restriction || 'free'}`,
      );
      const customRules = sr.custom_rules as string[] | undefined;
      if (customRules && customRules.length > 0) {
        parts.push(`- Custom Rules: ${customRules.join('; ')}`);
      }
    }

    // 展开 world_setting.custom_fields
    const customFields = ws.custom_fields as Record<string, unknown> | undefined;
    if (customFields && Object.keys(customFields).length > 0) {
      parts.push('', '## World Details');
      if (customFields.pantheon) {
        parts.push(`<pantheon>${JSON.stringify(customFields.pantheon)}</pantheon>`);
      }
      if (customFields.calendar) {
        parts.push(`<calendar>${JSON.stringify(customFields.calendar)}</calendar>`);
      }
      if (customFields.currency) {
        parts.push(`<currency_system>${JSON.stringify(customFields.currency)}</currency_system>`);
      }
      if (customFields.factions) {
        parts.push(`<factions>${JSON.stringify(customFields.factions)}</factions>`);
      }
    }

    return parts.join('\n');
  }

  buildSystemContext(template: TemplateRecord): string {
    const worldContext = this.buildWorldContext(template);
    const parts = [worldContext];

    const ss = template.startingScene;
    parts.push(
      '',
      `## Starting Scene`,
      (ss.description as string) || 'No starting scene defined',
    );

    const explorableAreas = ss.explorable_areas as Array<{ id: string; name: string }> | undefined;
    if (explorableAreas && explorableAreas.length > 0) {
      parts.push(
        '',
        '## Known Locations',
        ...explorableAreas.map(area => `- ${area.name} (ID: ${area.id})`)
      );
    }
    if (ss.location) {
      if (!explorableAreas || explorableAreas.length === 0) {
        parts.push('', '## Known Locations');
      }
      parts.push(`- Starting location ID: ${ss.location}`);
    }

    return parts.join('\n');
  }

  validateTemplateDetailed(template: unknown): ValidationResult {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      score: 0,
    };

    let totalChecks = 0;
    let passedChecks = 0;

    try {
      if (!template || typeof template !== 'object') {
        result.errors.push({
          field: 'root',
          message: 'Template must be an object',
          severity: 'error',
        });
        result.valid = false;
        totalChecks++;
        return result;
      }
      passedChecks++;
      totalChecks++;

      const t = template as Record<string, unknown>;

      totalChecks++;
      if (!t.name || typeof t.name !== 'string' || (t.name as string).trim().length === 0) {
        result.errors.push({
          field: 'name',
          message: 'Template name is required',
          severity: 'error',
        });
        result.valid = false;
      } else {
        passedChecks++;
      }

      totalChecks++;
      const validModes = getValidGameModes(
        Array.from(this.cache.values()) as Array<{ gameMode: string }>
      );
      const gameMode = (t.gameMode || t.game_mode) as string;
      if (!gameMode || !validModes.includes(gameMode)) {
        result.errors.push({
          field: 'game_mode',
          message: `Invalid game_mode: ${gameMode}. Must be one of: ${validModes.join(', ')}`,
          severity: 'error',
        });
        result.valid = false;
      } else {
        passedChecks++;
      }

      // world_setting 支持 snake_case 和 camelCase 两种字段名
      const worldSetting = (t.world_setting || t.worldSetting) as Record<string, unknown> | undefined;
      totalChecks++;
      if (worldSetting && typeof worldSetting === 'object') {
        passedChecks++;
        totalChecks++;
        if (!worldSetting.name) {
          result.warnings.push({
            field: 'world_setting.name',
            message: 'world_setting.name is recommended',
          });
        } else {
          passedChecks++;
        }
      } else if (!worldSetting) {
        result.warnings.push({
          field: 'world_setting',
          message: 'world_setting is missing',
        });
      }

      // character_creation
      const characterCreation = (t.character_creation || t.characterCreation) as Record<string, unknown> | undefined;
      totalChecks++;
      if (characterCreation && typeof characterCreation === 'object') {
        passedChecks++;

        totalChecks++;
        if (typeof characterCreation.attribute_points === 'number' && characterCreation.attribute_points >= 1 && characterCreation.attribute_points <= 100) {
          passedChecks++;
        } else if (characterCreation.attribute_points !== undefined) {
          result.errors.push({
            field: 'character_creation.attribute_points',
            message: `attribute_points must be between 1 and 100, got: ${characterCreation.attribute_points}`,
            severity: 'error',
          });
          result.valid = false;
        }

        totalChecks++;
        if (characterCreation.attributes && Array.isArray(characterCreation.attributes)) {
          const hasValidStructure = characterCreation.attributes.every(
            (attr: unknown) =>
              attr &&
              typeof attr === 'object' &&
              (attr as Record<string, unknown>).id &&
              (attr as Record<string, unknown>).name
          );
          if (hasValidStructure && characterCreation.attributes.length > 0) {
            passedChecks++;
          } else {
            result.warnings.push({
              field: 'character_creation.attributes',
              message: 'attributes should be a non-empty array with id and name',
            });
          }
        } else {
          result.warnings.push({
            field: 'character_creation.attributes',
            message: 'attributes array is missing or empty',
          });
        }
      } else if (!characterCreation) {
        result.warnings.push({
          field: 'character_creation',
          message: 'character_creation is missing',
        });
      }

      // initial_data
      const initialData = (t.initial_data || t.initialData) as Record<string, unknown> | undefined;
      totalChecks++;
      if (initialData && typeof initialData === 'object') {
        passedChecks++;

        totalChecks++;
        if (initialData.skills && typeof initialData.skills === 'object') {
          passedChecks++;
        } else {
          result.warnings.push({
            field: 'initial_data.skills',
            message: 'skills is missing or invalid',
          });
        }

        totalChecks++;
        if (initialData.items_by_class && typeof initialData.items_by_class === 'object') {
          passedChecks++;
        } else {
          result.warnings.push({
            field: 'initial_data.items_by_class',
            message: 'items_by_class is missing or invalid',
          });
        }

        totalChecks++;
        if (initialData.items_by_background && typeof initialData.items_by_background === 'object') {
          passedChecks++;
        } else {
          result.warnings.push({
            field: 'initial_data.items_by_background',
            message: 'items_by_background is recommended',
          });
        }

        totalChecks++;
        if (initialData.equipment && typeof initialData.equipment === 'object') {
          passedChecks++;
        } else {
          result.warnings.push({
            field: 'initial_data.equipment',
            message: 'equipment is recommended',
          });
        }

        totalChecks++;
        if (initialData.gold && typeof initialData.gold === 'object') {
          passedChecks++;
        } else {
          result.warnings.push({
            field: 'initial_data.gold',
            message: 'gold is missing or invalid',
          });
        }
      } else if (!initialData) {
        result.warnings.push({
          field: 'initial_data',
          message: 'initial_data is missing',
        });
      }

      // starting_scene
      const startingScene = (t.starting_scene || t.startingScene) as Record<string, unknown> | undefined;
      totalChecks++;
      if (startingScene && typeof startingScene === 'object') {
        passedChecks++;
        totalChecks++;
        if (startingScene.location) {
          passedChecks++;
        } else {
          result.warnings.push({
            field: 'starting_scene.location',
            message: 'starting_scene.location is recommended',
          });
        }

        totalChecks++;
        if (startingScene.description && typeof startingScene.description === 'string') {
          passedChecks++;
        } else {
          result.warnings.push({
            field: 'starting_scene.description',
            message: 'starting_scene.description is recommended',
          });
        }
      } else if (!startingScene) {
        result.warnings.push({
          field: 'starting_scene',
          message: 'starting_scene is missing',
        });
      }

      // ai_constraints
      const aiConstraints = (t.ai_constraints || t.aiConstraints) as Record<string, unknown> | undefined;
      totalChecks++;
      if (aiConstraints && typeof aiConstraints === 'object') {
        passedChecks++;
        totalChecks++;
        if (aiConstraints.tone && typeof aiConstraints.tone === 'string') {
          passedChecks++;
        } else {
          result.warnings.push({
            field: 'ai_constraints.tone',
            message: 'ai_constraints.tone is recommended',
          });
        }

        totalChecks++;
        if (aiConstraints.ai_behavior && typeof aiConstraints.ai_behavior === 'object') {
          passedChecks++;
        } else {
          result.warnings.push({
            field: 'ai_constraints.ai_behavior',
            message: 'ai_constraints.ai_behavior is recommended',
          });
        }
      } else if (!aiConstraints) {
        result.warnings.push({
          field: 'ai_constraints',
          message: 'ai_constraints is missing',
        });
      }

      // game_rules
      const gameRules = (t.game_rules || t.gameRules) as Record<string, unknown> | undefined;
      totalChecks++;
      if (gameRules && typeof gameRules === 'object') {
        passedChecks++;

        totalChecks++;
        if (gameRules.currency_system && typeof gameRules.currency_system === 'object') {
          const cs = gameRules.currency_system as Record<string, unknown>;
          if (cs.id && cs.name) {
            passedChecks++;
          } else {
            result.warnings.push({
              field: 'game_rules.currency_system',
              message: 'currency_system should have id and name',
            });
          }
        } else {
          result.warnings.push({
            field: 'game_rules.currency_system',
            message: 'currency_system is recommended',
          });
        }

        totalChecks++;
        if (gameRules.combat_system && typeof gameRules.combat_system === 'object') {
          const cs = gameRules.combat_system as Record<string, unknown>;
          if (cs.flee && cs.defend && cs.damage_formula) {
            passedChecks++;
          } else {
            result.warnings.push({
              field: 'game_rules.combat_system',
              message: 'combat_system should have flee, defend, and damage_formula',
            });
          }
        } else {
          result.warnings.push({
            field: 'game_rules.combat_system',
            message: 'combat_system is recommended',
          });
        }
      } else {
        result.warnings.push({
          field: 'game_rules',
          message: 'game_rules is missing',
        });
      }

      // ui_theme / ui_layout
      const uiTheme = t.ui_theme || t.uiTheme;
      totalChecks++;
      if (!uiTheme) {
        result.warnings.push({
          field: 'ui_theme',
          message: 'ui_theme is not defined',
        });
      } else {
        passedChecks++;
      }

      const uiLayout = t.ui_layout || t.uiLayout;
      totalChecks++;
      if (!uiLayout) {
        result.warnings.push({
          field: 'ui_layout',
          message: 'ui_layout is not defined',
        });
      } else {
        passedChecks++;
      }

      result.score = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0;

      this.logger.debug('Detailed template validation completed', {
        valid: result.valid,
        errors: result.errors.length,
        warnings: result.warnings.length,
        score: result.score,
      });

      return result;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Detailed template validation error', { error: errorMessage });
      result.errors.push({
        field: 'root',
        message: `Validation error: ${errorMessage}`,
        severity: 'error',
      });
      result.valid = false;
      return result;
    }
  }

  async importTemplate(data: unknown): Promise<TemplateRecord> {
    try {
      let parsedData: Record<string, unknown>;

      if (typeof data === 'string') {
        try {
          parsedData = JSON.parse(data);
        } catch (parseError) {
          throw new Error(`Invalid JSON format: ${parseError instanceof Error ? parseError.message : 'Parse error'}`);
        }
      } else if (data && typeof data === 'object') {
        parsedData = data as Record<string, unknown>;
      } else {
        throw new Error('Import data must be a JSON string or object');
      }

      const validationResult = this.validateTemplateDetailed(parsedData);

      if (!validationResult.valid && validationResult.errors.length > 0) {
        const errorMessages = validationResult.errors
          .filter((e) => e.severity === 'error')
          .map((e) => `[${e.field}] ${e.message}`)
          .join('; ');
        throw new Error(`Template validation failed: ${errorMessages}`);
      }

      if (validationResult.warnings.length > 0) {
        this.logger.warn('Import template with warnings', {
          warnings: validationResult.warnings,
        });
      }

      let templateId = parsedData.id as string;
      if (!templateId) {
        templateId = `custom-${randomUUID()}`;
        this.logger.info('Generated new ID for imported template', { id: templateId });
      } else {
        const existingTemplate = this.cache.get(templateId);
        if (existingTemplate) {
          templateId = `${templateId}-imported-${Date.now()}`;
          this.logger.info('ID conflict detected, generated new ID', { newId: templateId });
        }
      }

      // 将传入的 JSON 数据序列化为 YAML 文本存入 raw_content
      parsedData.id = templateId;
      const rawContent = yaml.dump(parsedData, { schema: yaml.DEFAULT_SCHEMA, lineWidth: -1 });

      const now = Date.now();
      await this.db('templates').insert({
        id: templateId,
        raw_content: rawContent,
        source: 'editor',
        is_builtin: 0,
        created_at: now,
        updated_at: now,
      });

      // 刷新缓存
      await this.refreshCache();

      this.logger.info('Template imported successfully', {
        id: templateId,
        name: parsedData.name || 'Untitled Template',
        warnings: validationResult.warnings.length,
      });

      return this.getTemplate(templateId as ID);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to import template', { error: errorMessage });
      throw error;
    }
  }

  async updateTemplate(id: ID, updates: Record<string, unknown>): Promise<TemplateRecord> {
    const existing = await this.getTemplate(id);

    if (existing.isBuiltin) {
      throw new Error('Cannot modify built-in templates');
    }

    // 将 updates 合并到现有 ParsedTemplate，然后序列化为 YAML 存入 raw_content
    const merged: TemplateRecord = {
      ...existing,
      ...this.applyUpdates(existing, updates),
      updatedAt: Date.now() as Timestamp,
    };

    const rawObj = recordToRaw(merged);
    const rawContent = yaml.dump(rawObj, { schema: yaml.DEFAULT_SCHEMA, lineWidth: -1 });

    await this.db('templates').where({ id }).update({
      raw_content: rawContent,
      updated_at: Date.now(),
    });

    TemplateRuleParser.invalidate(id);

    // 刷新缓存
    await this.refreshCache();

    return this.getTemplate(id);
  }

  /**
   * 将 snake_case 的 updates 字段映射到 camelCase 的 TemplateRecord 字段
   */
  private applyUpdates(_existing: TemplateRecord, updates: Record<string, unknown>): Partial<TemplateRecord> {
    const fieldMapping: Record<string, keyof TemplateRecord> = {
      name: 'name',
      description: 'description',
      version: 'version',
      author: 'author',
      tags: 'tags',
      game_mode: 'gameMode',
      gameMode: 'gameMode',
      default_challenge_mode: 'defaultChallengeMode',
      defaultChallengeMode: 'defaultChallengeMode',
      numerical_complexity: 'numericalComplexity',
      numericalComplexity: 'numericalComplexity',
      agent_profile: 'agentProfile',
      agentProfile: 'agentProfile',
      world_setting: 'worldSetting',
      worldSetting: 'worldSetting',
      character_creation: 'characterCreation',
      characterCreation: 'characterCreation',
      game_rules: 'gameRules',
      gameRules: 'gameRules',
      ai_constraints: 'aiConstraints',
      aiConstraints: 'aiConstraints',
      starting_scene: 'startingScene',
      startingScene: 'startingScene',
      initial_data: 'initialData',
      initialData: 'initialData',
      skills: 'skills',
      items: 'items',
      npcs: 'npcs',
      locations: 'locations',
      ui_theme: 'uiTheme',
      uiTheme: 'uiTheme',
      ui_layout: 'uiLayout',
      uiLayout: 'uiLayout',
      special_rules: 'specialRules',
      specialRules: 'specialRules',
      combat: 'combat',
    };

    const applied: Partial<TemplateRecord> = {};
    for (const [key, value] of Object.entries(updates)) {
      const mappedKey = fieldMapping[key];
      if (mappedKey) {
        (applied as Record<string, unknown>)[mappedKey] = value;
      }
    }

    return applied;
  }

  async deleteTemplate(id: ID): Promise<void> {
    const existing = await this.getTemplate(id);
    if (existing.isBuiltin) {
      throw new Error('Cannot delete built-in templates');
    }
    await this.db('templates').where({ id }).delete();
    TemplateRuleParser.invalidate(id);
    this.cache.delete(id);
    this.logger.info(`Template deleted: ${id}`);
  }

  async duplicateTemplate(id: ID): Promise<TemplateRecord> {
    const existing = await this.getTemplate(id);

    const newId = `tpl_${randomUUID()}`;
    const now = Date.now();

    const duplicated: TemplateRecord = {
      ...existing,
      id: newId,
      name: `${existing.name}（副本）`,
      version: '1.0.0',
      isBuiltin: false,
      source: 'editor',
      createdAt: now as Timestamp,
      updatedAt: now as Timestamp,
    };

    const rawObj = recordToRaw(duplicated);
    rawObj.id = newId;
    rawObj.name = duplicated.name;
    rawObj.version = '1.0.0';
    rawObj.is_builtin = false;

    const rawContent = yaml.dump(rawObj, { schema: yaml.DEFAULT_SCHEMA, lineWidth: -1 });

    await this.db('templates').insert({
      id: newId,
      raw_content: rawContent,
      source: 'editor',
      is_builtin: 0,
      created_at: now,
      updated_at: now,
    });

    // 复制模板池数据（技能池 + 物品池）
    if (this.templatePoolService) {
      const skills = await this.templatePoolService.listSkills(id);
      if (skills.length > 0) {
        await this.templatePoolService.createSkills(newId, skills.map(s => ({
          name: s.name,
          description: s.description,
          category: s.category,
          element: s.element,
          cost: s.cost,
          damage: s.damage,
          effects: s.effects,
          cooldown: s.cooldown,
          maxLevel: s.maxLevel,
          targetType: s.targetType,
          range: s.range,
          customData: s.customData,
          recommendedClasses: s.recommendedClasses,
          source: s.source,
        })));
      }

      const items = await this.templatePoolService.listItems(id);
      if (items.length > 0) {
        await this.templatePoolService.createItems(newId, items.map(i => ({
          name: i.name,
          description: i.description,
          category: i.category,
          quality: i.quality,
          stats: i.stats,
          effects: i.effects,
          value: i.value,
          tags: i.tags,
          weight: i.weight,
          maxStack: i.maxStack,
          equippedSlot: i.equippedSlot,
          durability: i.durability,
          maxDurability: i.maxDurability,
          customData: i.customData,
          recommendedClasses: i.recommendedClasses,
          source: i.source,
        })));
      }
    }

    // 刷新缓存
    await this.refreshCache();

    this.logger.info('Template duplicated', {
      sourceId: id,
      newId,
      newName: duplicated.name,
    });

    return this.getTemplate(newId as ID);
  }

  async exportTemplate(templateId: ID): Promise<Record<string, unknown>> {
    try {
      const template = await this.getTemplate(templateId);

      const exportData: Record<string, unknown> = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        template: {
          ...template,
        },
      };

      this.logger.debug('Template exported successfully', {
        templateId,
        name: template.name,
        exportedAt: exportData.exportedAt,
      });

      return exportData;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to export template', { templateId, error: errorMessage });
      throw error;
    }
  }
}
