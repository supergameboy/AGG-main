import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { randomUUID } from 'crypto';
import type { AgentTraceData, CoordinatorDecision } from './TraceCollector.js';
import type { TemplateService } from './template.js';
import type { LLMMetricsService } from './llm-metrics/index.js';

// === 预设角色数据接口（匹配前端 CharacterData） ===

export interface DevPresetData {
  templateId: string | null;
  name: string;
  gender: 'male' | 'female' | 'custom';
  customGender?: string | null;
  race: string;
  classType: string;
  background: string;
  attributes: Record<string, number>;
  customOptions?: Record<string, unknown> | null;
  language: string;
}

// === 请求上下文存储 ===

interface DevRequestContext {
  requestId: string;
  createdAt: number;
  coordinatorDecisions?: CoordinatorDecision[];
  agentTrace?: AgentTraceData;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

// === 校验结果 ===

export interface PresetValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface CharacterOptionsForValidation {
  races: Array<{ id: string; available_classes?: string[] }>;
  classes: Array<{ id: string }>;
  backgrounds: Array<{ id: string }>;
  attributes: Array<{ id: string; min_value?: number; max_value?: number }>;
  custom_options: Array<{ id: string }>;
}

export class DevModeService {
  private requestContexts: Map<string, DevRequestContext> = new Map();
  private readonly MAX_CONTEXTS = 100;
  private readonly CONTEXT_TTL_MS = 10 * 60 * 1000; // 10 minutes
  private readonly templateService: TemplateService;
  private readonly llmMetricsService: LLMMetricsService;

  constructor(templateService: TemplateService, llmMetricsService: LLMMetricsService) {
    this.templateService = templateService;
    this.llmMetricsService = llmMetricsService;
  }

  // === 请求上下文管理 ===

  createRequestContext(): string {
    // Enforce max contexts limit
    if (this.requestContexts.size >= this.MAX_CONTEXTS) {
      this.evictOldestContext();
    }

    const requestId = randomUUID();
    const context: DevRequestContext = {
      requestId,
      createdAt: Date.now(),
    };

    // Auto-cleanup after TTL
    context.cleanupTimer = setTimeout(() => {
      this.cleanupRequestContext(requestId);
    }, this.CONTEXT_TTL_MS);

    this.requestContexts.set(requestId, context);
    return requestId;
  }

  setCoordinatorDecisions(requestId: string, decisions: CoordinatorDecision[]): void {
    const context = this.requestContexts.get(requestId);
    if (context) {
      context.coordinatorDecisions = decisions;
    }
  }

  setAgentTrace(requestId: string, trace: AgentTraceData): void {
    const context = this.requestContexts.get(requestId);
    if (context) {
      context.agentTrace = trace;
    }
  }

  getRequestContext(requestId: string): DevRequestContext | undefined {
    return this.requestContexts.get(requestId);
  }

  cleanupRequestContext(requestId: string): void {
    const context = this.requestContexts.get(requestId);
    if (context?.cleanupTimer) {
      clearTimeout(context.cleanupTimer);
    }
    this.requestContexts.delete(requestId);
  }

  private evictOldestContext(): void {
    let oldest: DevRequestContext | null = null;
    for (const ctx of this.requestContexts.values()) {
      if (!oldest || ctx.createdAt < oldest.createdAt) {
        oldest = ctx;
      }
    }
    if (oldest) {
      this.cleanupRequestContext(oldest.requestId);
    }
  }

  // === 预设读取 ===

  async loadPreset(preset: string): Promise<DevPresetData> {
    const [templateName, presetName] = preset.split('/');
    if (!templateName || !presetName) {
      throw new Error(`Invalid preset format: "${preset}". Expected "templateName/presetName" (e.g. "medieval-fantasy/warrior")`);
    }

    const configDir = process.env.AGENT_CONFIG_DIR || path.resolve(process.cwd(), 'config');
    const presetPath = path.join(configDir, 'dev-presets', templateName, `${presetName}.yaml`);

    if (!fs.existsSync(presetPath)) {
      // List available presets for helpful error message
      const presetsDir = path.join(configDir, 'dev-presets', templateName);
      let available: string[] = [];
      if (fs.existsSync(presetsDir)) {
        available = fs.readdirSync(presetsDir)
          .filter(f => f.endsWith('.yaml'))
          .map(f => f.replace('.yaml', ''));
      }
      throw new Error(
        `Preset not found: "${preset}". ` +
        (available.length > 0
          ? `Available presets for "${templateName}": ${available.join(', ')}`
          : `No presets directory found for template "${templateName}"`)
      );
    }

    const content = fs.readFileSync(presetPath, 'utf-8');
    const raw = yaml.load(content);

    if (typeof raw !== 'object' || raw === null) {
      throw new Error(`Preset "${preset}" is not a valid YAML object`);
    }

    const data = raw as Record<string, unknown>;

    if (!data.name || !data.race || !data.classType || !data.background) {
      throw new Error(`Preset "${preset}" is missing required fields (name, race, classType, background)`);
    }

    return {
      templateId: (data.templateId as string) ?? templateName,
      name: data.name as string,
      gender: (data.gender as DevPresetData['gender']) ?? 'male',
      customGender: (data.customGender as string | null) ?? null,
      race: data.race as string,
      classType: data.classType as string,
      background: data.background as string,
      attributes: (data.attributes as Record<string, number>) ?? {},
      customOptions: (data.customOptions as Record<string, unknown> | null) ?? null,
      language: (data.language as string) ?? 'zh-CN',
    };
  }

  listPresets(templateName?: string): Array<{ template: string; preset: string }> {
    const configDir = process.env.AGENT_CONFIG_DIR || path.resolve(process.cwd(), 'config');
    const presetsDir = path.join(configDir, 'dev-presets');
    const results: Array<{ template: string; preset: string }> = [];

    if (!fs.existsSync(presetsDir)) {
      return results;
    }

    const templates = templateName
      ? [templateName]
      : fs.readdirSync(presetsDir).filter(d => fs.statSync(path.join(presetsDir, d)).isDirectory());

    for (const tmpl of templates) {
      const tmplDir = path.join(presetsDir, tmpl);
      if (!fs.existsSync(tmplDir)) continue;

      const files = fs.readdirSync(tmplDir).filter(f => f.endsWith('.yaml'));
      for (const file of files) {
        results.push({ template: tmpl, preset: file.replace('.yaml', '') });
      }
    }

    return results;
  }

  // === 预设校验 ===

  async validatePreset(presetData: DevPresetData, templateId: string): Promise<PresetValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    let options: CharacterOptionsForValidation;
    try {
      const template = await this.templateService.getTemplate(templateId);
      const cc = template.characterCreation as Record<string, unknown>;
      options = {
        races: (cc.races ?? []) as Array<{ id: string; available_classes?: string[] }>,
        classes: (cc.classes ?? []) as Array<{ id: string }>,
        backgrounds: (cc.backgrounds ?? []) as Array<{ id: string }>,
        attributes: (cc.attributes ?? []) as Array<{ id: string; min_value?: number; max_value?: number }>,
        custom_options: (cc.custom_options ?? []) as Array<{ id: string }>,
      };
    } catch {
      errors.push(`Template "${templateId}" not found`);
      return { valid: false, errors, warnings };
    }

    // Validate race
    const raceIds = options.races.map(r => r.id);
    if (!raceIds.includes(presetData.race)) {
      errors.push(`Race "${presetData.race}" not in template "${templateId}", available: [${raceIds.join(', ')}]`);
    }

    // Validate classType (check race's available_classes if present)
    const classIds = options.classes.map(c => c.id);
    if (!classIds.includes(presetData.classType)) {
      errors.push(`Class "${presetData.classType}" not in template "${templateId}", available: [${classIds.join(', ')}]`);
    } else {
      const selectedRace = options.races.find(r => r.id === presetData.race);
      if (selectedRace?.available_classes && !selectedRace.available_classes.includes(presetData.classType)) {
        errors.push(`Class "${presetData.classType}" not available for race "${presetData.race}", available: [${selectedRace.available_classes.join(', ')}]`);
      }
    }

    // Validate background
    const bgIds = options.backgrounds.map(b => b.id);
    if (!bgIds.includes(presetData.background)) {
      errors.push(`Background "${presetData.background}" not in template "${templateId}", available: [${bgIds.join(', ')}]`);
    }

    // Validate attributes
    for (const [key, value] of Object.entries(presetData.attributes)) {
      const attrDef = options.attributes.find(a => a.id === key);
      if (!attrDef) {
        errors.push(`Attribute "${key}" not in template "${templateId}", available: [${options.attributes.map(a => a.id).join(', ')}]`);
      } else if (attrDef.min_value !== undefined && attrDef.max_value !== undefined) {
        if (value < attrDef.min_value || value > attrDef.max_value) {
          errors.push(`Attribute "${key}" value ${value} out of range [${attrDef.min_value}, ${attrDef.max_value}]`);
        }
      }
    }

    // Check for missing attributes
    const presetAttrKeys = new Set(Object.keys(presetData.attributes));
    for (const attr of options.attributes) {
      if (!presetAttrKeys.has(attr.id)) {
        warnings.push(`Attribute "${attr.id}" not specified in preset, will use template default`);
      }
    }

    // Validate customOptions
    if (presetData.customOptions) {
      for (const key of Object.keys(presetData.customOptions)) {
        const optDef = options.custom_options.find(o => o.id === key);
        if (!optDef) {
          warnings.push(`Custom option "${key}" not defined in template "${templateId}"`);
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  // === 解析预设的 templateId ===

  async resolveTemplateId(presetData: DevPresetData): Promise<string> {
    if (presetData.templateId) {
      return presetData.templateId;
    }

    // Try to find template by matching preset directory name with template id
    const templates = await this.templateService.getTemplates();
    // Preset path contains template name, but we need to find the actual templateId
    // Convention: template directory name matches template id
    return templates[0]?.id ?? 'medieval-fantasy';
  }

  // === Token 统计查询（复用 LLMMetricsService） ===

  async getTokenUsageForSave(saveId: string, sinceTimestamp: number): Promise<{
    input: number; output: number; total: number; cacheHit: number; cacheMiss: number;
  }> {
    return this.llmMetricsService.getTokenUsageForSave(saveId, sinceTimestamp);
  }

  // === 冗余读取检测 ===

  detectRedundantReads(traces: Array<{ toolCalls: Array<{ tool: string; isReadOperation: boolean; args: Record<string, unknown> }> }>): number {
    const readSignatures = new Map<string, number>();
    let redundantCount = 0;

    for (const trace of traces) {
      for (const tc of trace.toolCalls) {
        if (tc.isReadOperation) {
          const sig = `${tc.tool}:${JSON.stringify(tc.args)}`;
          const count = readSignatures.get(sig) || 0;
          if (count > 0) {
            redundantCount++;
          }
          readSignatures.set(sig, count + 1);
        }
      }
    }

    return redundantCount;
  }
}
