import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import yaml from 'js-yaml';
import type {
  AgentProfile,
  AgentConfig,
  PermissionConfig,
  ValidationResult,
} from '../../../../shared/src/types/agent-config.js';
import type { ToolRegistry } from '../ToolRegistry.js';
import type { AgentType } from '../../../../shared/src/types/agent.js';
import { generateDeterministicId } from '../../../../shared/src/types/core.js';
import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { IAgentProfileRepository, AgentProfileRow } from '../../game-systems/config/types.js';
import {
  validateHookPlacementConfig,
  type HookPlacementConfig,
  type HookRefLookup,
} from '../runtime/hook-placement-config.js';

const logger = createChildLogger('ConfigLoader');

function profileToRow(profile: AgentProfile, isBuiltin: boolean, source: 'yaml' | 'database'): Omit<AgentProfileRow, 'created_at'> {
  return {
    id: generateDeterministicId('profile', 'global', profile.name),
    name: profile.name,
    description: profile.description || '',
    game_mode: profile.game_mode,
    agents: JSON.stringify(profile.agents),
    coordinator: '{}',
    permissions: JSON.stringify(profile.permissions || {}),
    tools: JSON.stringify(profile.tools || []),
    is_builtin: isBuiltin ? 1 : 0,
    source,
    updated_at: Date.now(),
  };
}

function rowToProfile(row: AgentProfileRow): AgentProfile {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    game_mode: row.game_mode,
    agents: JSON.parse(row.agents),
    permissions: JSON.parse(row.permissions || '{}'),
    tools: JSON.parse(row.tools || '[]'),
    is_builtin: row.is_builtin === 1,
    source: row.source as 'yaml' | 'database',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class ConfigLoader {
  private profiles: Map<string, AgentProfile> = new Map();
  private toolRegistry: ToolRegistry | null = null;
  private configDir: string;
  private profileRepo: IAgentProfileRepository | null;
  private contextInjector: { reloadRules?: () => void } | null = null;

  constructor(configDir: string, profileRepo?: IAgentProfileRepository) {
    this.configDir = resolve(configDir);
    this.profileRepo = profileRepo ?? null;
  }

  setContextInjector(injector: { reloadRules?: () => void }): void {
    this.contextInjector = injector;
  }

  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry;
  }

  async loadAll(): Promise<void> {
    logger.info(`Loading config from directory: ${this.configDir}`);

    this.loadProfiles();

    if (this.profileRepo) {
      await this.loadProfilesFromDB();
    }

    const validation = this.validateProfiles();
    if (!validation.valid) {
      logger.error(`Profile validation failed: ${validation.errors.join(', ')}`);
      throw new Error(`Profile validation failed: ${validation.errors.join(', ')}`);
    }

    logger.info(
      `Config loaded successfully: ${this.profiles.size} profiles`
    );
  }

  /** 在 ToolRegistry 注册完成后调用，校验工具引用和 context rules */
  validateToolReferences(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const RUNTIME_TOOLS = new Set(['rule_service', 'skill_loader', 'help_service', 'coordinator_service']);

    for (const [profileName, profile] of this.profiles) {
      for (const [agentKey, agent] of Object.entries(profile.agents)) {
        for (const toolName of agent.tools) {
          if (toolName === 'all' || RUNTIME_TOOLS.has(toolName)) continue;
          if (this.toolRegistry && !this.toolRegistry.hasTool(toolName as import('../../../../shared/src/types/agent.js').ToolType)) {
            warnings.push(
              `[${profileName}/${agentKey}] Tool "${toolName}" not found in ToolRegistry`
            );
          }
        }
      }
    }

    const contextRulesValidation = this.validateContextRules();
    errors.push(...contextRulesValidation.errors);
    warnings.push(...contextRulesValidation.warnings);

    return { valid: errors.length === 0, errors, warnings };
  }

  private async loadProfilesFromDB(): Promise<void> {
    if (!this.profileRepo) return;

    try {
      const rows = await this.profileRepo.findAll();
      for (const row of rows) {
        // 对于builtin（YAML来源）的配置，YAML文件已加载最新版本，跳过数据库中的旧数据
        if (row.is_builtin === 1) {
          logger.debug(`Skipping builtin profile from DB (using YAML): ${row.name}`);
          continue;
        }
        const profile = rowToProfile(row);
        this.profiles.set(profile.name, profile);
        logger.debug(`Loaded profile from DB: ${profile.name} (source=${row.source})`);
      }
      logger.info(`Loaded ${rows.filter(r => r.is_builtin !== 1).length} non-builtin profiles from database (${rows.filter(r => r.is_builtin === 1).length} builtin skipped, using YAML)`);
    } catch (error) {
      logger.warn(`Failed to load profiles from DB: ${error}`);
    }
  }

  async seedFromYaml(): Promise<number> {
    if (!this.profileRepo) {
      throw new Error('Database connection is required for seedFromYaml');
    }

    const yamlProfiles = this.loadProfilesFromYamlFiles();
    let seeded = 0;

    for (const profile of yamlProfiles) {
      const existing = await this.profileRepo.findByName(profile.name);

      if (!existing) {
        const row = profileToRow(profile, true, 'yaml');
        const { id: _id, ...insertRow } = row;
        await this.profileRepo.insert(insertRow);
        seeded++;
        logger.info(`Seeded profile from YAML to DB: ${profile.name}`);
      } else if (existing.is_builtin === 1) {
        // builtin配置已存在，用YAML最新版本更新数据库
        const row = profileToRow(profile, true, 'yaml');
        await this.profileRepo.updateByName(profile.name, {
          description: row.description,
          game_mode: row.game_mode,
          agents: row.agents,
          coordinator: row.coordinator,
          permissions: row.permissions,
          tools: row.tools,
        });
        logger.info(`Updated builtin profile from YAML: ${profile.name}`);
      } else {
        logger.debug(`Profile already exists in DB (non-builtin), skipping: ${profile.name}`);
      }
    }

    logger.info(`Seeded ${seeded} profiles from YAML to database`);
    return seeded;
  }

  private loadProfilesFromYamlFiles(): AgentProfile[] {
    const profiles: AgentProfile[] = [];
    const profilesDir = join(this.configDir, 'agent-profiles');
    if (!existsSync(profilesDir)) {
      return profiles;
    }

    const files = readdirSync(profilesDir).filter(
      (f) => f.endsWith('.yaml') || f.endsWith('.yml')
    );
    for (const file of files) {
      const filePath = join(profilesDir, file);
      try {
        const content = readFileSync(filePath, 'utf-8');
        const parsed = yaml.load(content, { schema: yaml.JSON_SCHEMA }) as AgentProfile;
        if (parsed?.name) {
          profiles.push(parsed);
        }
      } catch (error) {
        logger.error(`Failed to load profile from ${file}: ${error}`);
      }
    }
    return profiles;
  }

  async createProfile(profile: AgentProfile): Promise<AgentProfile> {
    if (!this.profileRepo) {
      throw new Error('Database connection is required for createProfile');
    }

    const validation = this.validateProfile(profile);
    if (!validation.valid) {
      throw new Error(`Profile validation failed: ${validation.errors.join(', ')}`);
    }

    const row = profileToRow(profile, false, 'database');
    const { id: _id, ...insertRow } = row;
    await this.profileRepo.insert(insertRow);

    this.profiles.set(profile.name, profile);
    logger.info(`Created profile in DB: ${profile.name}`);
    return profile;
  }

  async updateProfile(name: string, updates: Partial<AgentProfile>): Promise<AgentProfile> {
    if (!this.profileRepo) {
      throw new Error('Database connection is required for updateProfile');
    }

    const existing = await this.profileRepo.findByName(name);

    if (!existing) {
      throw new Error(`Profile not found in DB: ${name}`);
    }

    const currentProfile = rowToProfile(existing);
    const merged: AgentProfile = {
      ...currentProfile,
      ...updates,
      name: currentProfile.name,
    };

    const validation = this.validateProfile(merged);
    if (!validation.valid) {
      throw new Error(`Profile validation failed: ${validation.errors.join(', ')}`);
    }

    await this.profileRepo.updateByName(name, {
      description: merged.description || '',
      game_mode: merged.game_mode,
      agents: JSON.stringify(merged.agents),
      coordinator: '{}',
    });

    this.profiles.set(name, merged);
    logger.info(`Updated profile in DB: ${name}`);
    return merged;
  }

  async deleteProfile(name: string): Promise<void> {
    if (!this.profileRepo) {
      throw new Error('Database connection is required for deleteProfile');
    }

    const existing = await this.profileRepo.findByName(name);

    if (!existing) {
      throw new Error(`Profile not found in DB: ${name}`);
    }

    if (existing.is_builtin === 1) {
      throw new Error(`Cannot delete builtin profile: ${name}`);
    }

    await this.profileRepo.deleteByName(name);

    this.profiles.delete(name);
    logger.info(`Deleted profile from DB: ${name}`);
  }

  async getProfileFromDB(name: string): Promise<AgentProfile | null> {
    if (!this.profileRepo) {
      throw new Error('Database connection is required for getProfileFromDB');
    }

    const row = await this.profileRepo.findByName(name);

    if (!row) return null;
    return rowToProfile(row);
  }

  async getAllProfilesFromDB(): Promise<AgentProfile[]> {
    if (!this.profileRepo) {
      throw new Error('Database connection is required for getAllProfilesFromDB');
    }

    const rows = await this.profileRepo.findAll();
    return rows.map(rowToProfile);
  }

  private loadProfiles(): void {
    const profilesDir = join(this.configDir, 'agent-profiles');
    if (!existsSync(profilesDir)) {
      logger.info('No agent-profiles directory found, skipping profiles');
      return;
    }

    const files = readdirSync(profilesDir).filter(
      (f) => f.endsWith('.yaml') || f.endsWith('.yml')
    );
    for (const file of files) {
      const filePath = join(profilesDir, file);
      try {
        const content = readFileSync(filePath, 'utf-8');
        const parsed = yaml.load(content, { schema: yaml.JSON_SCHEMA }) as AgentProfile;

        if (parsed?.name) {
          parsed.source = parsed.source || 'yaml';
          parsed.is_builtin = parsed.is_builtin ?? true;
          delete (parsed as unknown as Record<string, unknown>).coordinator;
          parsed.permissions = parsed.permissions || {};
          parsed.tools = parsed.tools || [];
          this.profiles.set(parsed.name, parsed);
          logger.info(`Loaded agent profile: ${parsed.name}`);
        }
      } catch (error) {
        logger.error(`Failed to load profile from ${file}: ${error}`);
      }
    }
  }

  async reloadAll(): Promise<AgentProfile[]> {
    logger.info('Reloading all configurations');

    // 清空内存中的配置
    this.profiles.clear();
    // 重新从文件和数据库加载
    this.loadProfiles();

    if (this.profileRepo) {
      await this.loadProfilesFromDB();
    }

    const validation = this.validateProfiles();
    if (!validation.valid) {
      logger.error(`Profile validation failed: ${validation.errors.join(', ')}`);
      throw new Error(`Profile validation failed: ${validation.errors.join(', ')}`);
    }

    // 重新校验工具引用（ToolRegistry 是单例，工具已注册）
    const toolValidation = this.validateToolReferences();
    if (!toolValidation.valid) {
      logger.error(`Tool reference validation failed: ${toolValidation.errors.join(', ')}`);
      throw new Error(`Tool reference validation failed: ${toolValidation.errors.join(', ')}`);
    }
    for (const w of toolValidation.warnings) {
      logger.warn(w);
    }

    logger.info(`Reloaded all configurations: ${this.profiles.size} profiles`);

    // 重载 ContextInjector 规则
    if (this.contextInjector?.reloadRules) {
      this.contextInjector.reloadRules();
    }

    return this.getAllProfiles();
  }

  async reloadProfile(profileName: string): Promise<AgentProfile> {
    const profilesDir = join(this.configDir, 'agent-profiles');
    const files = readdirSync(profilesDir).filter(
      (f) => f.endsWith('.yaml') || f.endsWith('.yml')
    );

    for (const file of files) {
      const filePath = join(profilesDir, file);
      const content = readFileSync(filePath, 'utf-8');
      const parsed = yaml.load(content, { schema: yaml.JSON_SCHEMA }) as AgentProfile;

      if (parsed?.name === profileName) {
        parsed.source = parsed.source || 'yaml';
        parsed.is_builtin = parsed.is_builtin ?? true;
        delete (parsed as unknown as Record<string, unknown>).coordinator;
        parsed.permissions = parsed.permissions || {};
        parsed.tools = parsed.tools || [];
        const validation = this.validateProfile(parsed);
        if (!validation.valid) {
          throw new Error(`Profile validation failed: ${validation.errors.join(', ')}`);
        }
        this.profiles.set(profileName, parsed);
        logger.info(`Reloaded agent profile: ${profileName}`);
        return parsed;
      }
    }

    throw new Error(`Profile not found: ${profileName}`);
  }

  getProfile(name: string): AgentProfile | undefined {
    const cached = this.profiles.get(name);
    if (cached) return cached;
    return undefined;
  }

  async getProfileWithDBFallback(name: string): Promise<AgentProfile | undefined> {
    const cached = this.profiles.get(name);
    if (cached) return cached;

    if (this.profileRepo) {
      const dbProfile = await this.getProfileFromDB(name);
      if (dbProfile) {
        this.profiles.set(name, dbProfile);
        return dbProfile;
      }
    }

    return undefined;
  }

  getAgentConfig(profileName: string, agentKey: string): AgentConfig | undefined {
    const profile = this.profiles.get(profileName);
    return profile?.agents[agentKey];
  }

  getPermissions(): PermissionConfig | null {
    if (this.profiles.size === 0) {
      return null;
    }

    const agents: PermissionConfig['agents'] = {};

    for (const profile of this.profiles.values()) {
      for (const [agentKey, agentConfig] of Object.entries(profile.agents)) {
        agents[agentKey] = {
          tools: agentConfig.tools ?? [],
        };
      }
    }

    return { agents };
  }

  getCapabilitiesFromProfiles(): Record<string, import('../types.js').AgentCapability> {
    const capabilities: Record<string, import('../types.js').AgentCapability> = {};
    for (const [, profile] of this.profiles) {
      if (profile.agents) {
        for (const [agentKey, agentConfig] of Object.entries(profile.agents)) {
          const cap = agentConfig.capabilities;
          if (cap) {
            capabilities[agentKey] = {
              agentType: agentKey as AgentType,
              description: agentConfig.description || '',
              whenToInvoke: agentConfig.whenToInvoke || '',
              supportedIntents: cap.supported_intents || [],
              requiredFields: cap.required_fields || [],
              optionalFields: cap.optional_fields || [],
            };
          }
        }
      }
    }
    return capabilities;
  }

  getAllProfiles(): AgentProfile[] {
    return Array.from(this.profiles.values());
  }

  loadSystemPrompt(profileName: string, agentKey: string): string {
    const agentConfig = this.getAgentConfig(profileName, agentKey);
    if (!agentConfig) {
      throw new Error(`Agent config not found: ${profileName}/${agentKey}`);
    }

    const promptPath = resolve(
      join(this.configDir, 'agent-profiles', agentConfig.system_prompt_file)
    );

    const allowedDir = resolve(join(this.configDir, 'agent-profiles'));
    if (!promptPath.startsWith(allowedDir)) {
      logger.error(`Path traversal detected: ${agentConfig.system_prompt_file}`);
      throw new Error('Invalid prompt file path');
    }

    if (!existsSync(promptPath)) {
      logger.warn(`System prompt file not found: ${promptPath}`);
      return `You are ${agentConfig.name}. ${agentConfig.description}`;
    }

    return readFileSync(promptPath, 'utf-8');
  }

  /**
   * 加载 hook-placement.yaml 并执行 V1-V8 启动期校验（M4 §11，fail-fast）。
   *
   * 文件缺失 → 返回空 entries（§13：仅默认链生效，等价现状），不视为错误；
   * 校验失败 → 抛错（配置缺陷必须在组合根装配期暴露，禁止运行期才发现）。
   *
   * @param hookRefs HookImplRegistry（V2 校验 hookRef 存在性，防幽灵引用）
   */
  loadHookPlacement(hookRefs: HookRefLookup): HookPlacementConfig {
    const configPath = join(this.configDir, 'hook-placement.yaml');
    if (!existsSync(configPath)) {
      logger.warn(`hook-placement.yaml not found at ${configPath}, using empty entries (default hook chain only)`);
      return { version: 1, entries: [] };
    }

    // 系统边界（YAML 文件）解析后即由 validateHookPlacementConfig 全量校验结构，
    // 此处的类型断言是边界单点窄化，非法形态在下方校验中 fail-fast 暴露
    const config = yaml.load(readFileSync(configPath, 'utf-8')) as HookPlacementConfig;
    validateHookPlacementConfig(config, hookRefs);
    logger.info(`hook-placement config loaded: ${config.entries.length} entries`);
    return config;
  }

  validateProfile(profile: AgentProfile): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!profile.name) errors.push('Profile name is required');
    if (!profile.agents) {
      profile.agents = {};
    }
    if (Object.keys(profile.agents).length === 0) {
      warnings.push('Profile has no sub-agents configured. GameMasterAgent will handle all tasks directly.');
    }

    const englishIds = new Set<string>();
    for (const [key, agent] of Object.entries(profile.agents)) {
      if (!agent.name) errors.push(`Agent ${key}: name is required`);
      if (!agent.description) warnings.push(`Agent ${key}: description is recommended`);
      if (!agent.tools || agent.tools.length === 0) {
        warnings.push(`Agent ${key}: no tools configured`);
      }
      if (!agent.system_prompt_file) {
        errors.push(`Agent ${key}: system_prompt_file is required`);
      }

      // englishId 唯一性检查
      if (agent.englishId) {
        if (englishIds.has(agent.englishId)) {
          errors.push(`Agent ${key}: englishId "${agent.englishId}" is not unique within profile`);
        }
        englishIds.add(agent.englishId);
      }

      // isSubAgent=false 的Agent必须有 enableSpawnAgent=true
      if (agent.isSubAgent === false && !agent.enableSpawnAgent) {
        errors.push(`Agent ${key}: non-subAgent must have enableSpawnAgent=true`);
      }

      // rules/skills/help 目录存在性检查
      if (agent.rules?.dir) {
        const rulesDir = join(this.configDir, agent.rules.dir);
        if (!existsSync(rulesDir)) {
          warnings.push(`Agent ${key}: rules dir "${agent.rules.dir}" does not exist`);
        } else {
          // rules.alwaysApply 文件存在性校验
          if (agent.rules.alwaysApply) {
            for (const ruleName of agent.rules.alwaysApply) {
              const ruleFile = this.findRuleFile(rulesDir, ruleName, 'always-apply');
              if (!ruleFile) {
                warnings.push(`Agent ${key}: rules.alwaysApply "${ruleName}" file not found in ${agent.rules.dir}`);
              }
            }
          }
          // rules.hooked 文件存在性校验
          if (agent.rules.hooked) {
            for (const ruleName of agent.rules.hooked) {
              const ruleFile = this.findRuleFile(rulesDir, ruleName, 'hooked');
              if (!ruleFile) {
                warnings.push(`Agent ${key}: rules.hooked "${ruleName}" file not found in ${agent.rules.dir}`);
              }
            }
          }
        }
      }
      if (agent.skills?.dir) {
        const skillsDir = join(this.configDir, agent.skills.dir);
        if (!existsSync(skillsDir)) {
          warnings.push(`Agent ${key}: skills dir "${agent.skills.dir}" does not exist`);
        } else if (agent.skills.list) {
          // skills.list 文件存在性校验
          for (const skillName of agent.skills.list) {
            const skillFile = join(skillsDir, `${skillName}.md`);
            if (!existsSync(skillFile)) {
              warnings.push(`Agent ${key}: skills.list "${skillName}" file not found in ${agent.skills.dir}`);
            }
          }
        }
      }
      if (agent.help?.dir) {
        const helpDir = join(this.configDir, agent.help.dir);
        if (!existsSync(helpDir)) {
          warnings.push(`Agent ${key}: help dir "${agent.help.dir}" does not exist`);
        }
      }
      if (agent.help?.dirs) {
        for (const dir of agent.help.dirs) {
          const helpDir = join(this.configDir, dir);
          if (!existsSync(helpDir)) {
            warnings.push(`Agent ${key}: help dir "${dir}" does not exist`);
          }
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  private validateProfiles(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const [profileName, profile] of this.profiles) {
      const result = this.validateProfile(profile);
      errors.push(...result.errors.map((e) => `[${profileName}] ${e}`));
      warnings.push(...result.warnings.map((w) => `[${profileName}] ${w}`));
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * 在rules目录中查找规则文件，支持子目录分类（always-apply/hooked）和扁平结构
   */
  private findRuleFile(rulesDir: string, ruleName: string, subDir: string): string | null {
    // 优先查找子目录分类：dir/always-apply/{name}.md 或 dir/hooked/{name}.md
    const categorized = join(rulesDir, subDir, `${ruleName}.md`);
    if (existsSync(categorized)) return categorized;
    // 兼容扁平结构：dir/{name}.md
    const flat = join(rulesDir, `${ruleName}.md`);
    if (existsSync(flat)) return flat;
    return null;
  }

  /**
   * 校验 agent-context-rules.yaml 中的跨文件引用是否与 ToolRegistry 一致
   * - source/method 不存在 → error（启动阻断）
   * - is_write 方法被引用 → error（危险副作用）
   * - params/format/id/agentKey 问题 → warning
   */
  private validateContextRules(): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const contextRulesPath = join(this.configDir, 'agent-context-rules.yaml');
    if (!existsSync(contextRulesPath)) {
      return { errors, warnings };
    }

    if (!this.toolRegistry) {
      warnings.push('ToolRegistry not set, skipping context rules validation');
      return { errors, warnings };
    }

    let contextRules: Record<string, {
      required: Array<{
        id?: string; source?: string; method?: string;
        format?: string; description?: string; params?: Record<string, unknown>;
      }>;
      max_context_tokens?: number;
    }>;
    try {
      const content = readFileSync(contextRulesPath, 'utf-8');
      const parsed = yaml.load(content, { schema: yaml.JSON_SCHEMA }) as {
        context_rules: typeof contextRules;
      };
      contextRules = parsed?.context_rules;
      if (!contextRules) return { errors, warnings };
    } catch (error) {
      errors.push(`Failed to parse agent-context-rules.yaml: ${getErrorMessage(error)}`);
      return { errors, warnings };
    }

    const validFormats = new Set(['compact', 'summary', 'full']);
    const knownAgentKeys = new Set(Array.from(this.profiles.values()).flatMap(p => Object.keys(p.agents ?? {})));

    for (const [agentKey, rules] of Object.entries(contextRules)) {
      // Agent key 对应性校验
      if (knownAgentKeys.size > 0 && !knownAgentKeys.has(agentKey)) {
        warnings.push(`Context rule agent "${agentKey}" has no matching agent profile in fantasy_rpg.yaml`);
      }

      if (!rules.required) continue;
      const seenIds = new Set<string>();

      for (const rule of rules.required) {
        const ruleRef = `[${agentKey}/${rule.id ?? '?'}]`;

        // 必填字段完整性
        if (!rule.id) { warnings.push(`Context rule ${ruleRef}: missing required field "id"`); }
        if (!rule.source) { errors.push(`Context rule ${ruleRef}: missing required field "source"`); continue; }
        if (!rule.method) { errors.push(`Context rule ${ruleRef}: missing required field "method"`); continue; }
        if (!rule.description) { warnings.push(`Context rule ${ruleRef}: missing recommended field "description"`); }

        // id 唯一性
        if (rule.id) {
          if (seenIds.has(rule.id)) {
            warnings.push(`Context rule ${ruleRef}: duplicate id "${rule.id}" within agent "${agentKey}"`);
          }
          seenIds.add(rule.id);
        }

        // format 枚举校验
        if (rule.format && !validFormats.has(rule.format)) {
          warnings.push(`Context rule ${ruleRef}: invalid format "${rule.format}", must be one of: compact, summary, full`);
        }

        // source 存在性（error 级别）——从 ToolRegistry 查询
        const tool = this.toolRegistry.getTool(rule.source as import('../../../../shared/src/types/agent.js').ToolType);
        if (!tool) {
          errors.push(`Context rule ${ruleRef}: source "${rule.source}" not found in ToolRegistry`);
          continue;
        }

        // method 存在性（error 级别）
        const methodDef = tool.getMethodDefinition(rule.method);
        if (!methodDef) {
          errors.push(`Context rule ${ruleRef}: method "${rule.source}.${rule.method}" not found in ToolRegistry`);
          continue;
        }

        // is_write 检查（error 级别——context 注入不应调用写操作）
        if (methodDef.isWrite) {
          errors.push(`Context rule ${ruleRef}: method "${rule.source}.${rule.method}" is a write operation (isWrite=true), cannot be used in context injection`);
        }

        // params 参数校验
        if (rule.params && methodDef.parameters) {
          const paramDefs = methodDef.parameters as Record<string, { type?: string; required?: boolean }>;
          for (const [paramKey, paramValue] of Object.entries(rule.params)) {
            if (!paramDefs[paramKey]) {
              warnings.push(`Context rule ${ruleRef}: param "${paramKey}" not defined in method "${rule.source}.${rule.method}"`);
            } else if (paramDefs[paramKey].type) {
              const expectedType = paramDefs[paramKey].type;
              const actualType = Array.isArray(paramValue) ? 'array' : typeof paramValue;
              if (expectedType !== actualType && !(expectedType === 'number' && actualType === 'number')) {
                warnings.push(`Context rule ${ruleRef}: param "${paramKey}" type mismatch: expected ${expectedType}, got ${actualType}`);
              }
            }
          }
        }
      }
    }

    return { errors, warnings };
  }
}
