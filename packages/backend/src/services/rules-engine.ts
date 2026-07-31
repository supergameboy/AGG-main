import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { RuleDefinition, IRulesEngine } from '@ai-rpg/shared/types/prompt';
import {
  parseFrontmatter,
  ruleFrontmatterSchema,
  validateAttributes,
} from '../game-systems/shared/frontmatter/index.js';

const logger = createChildLogger('rules-engine');

// ─── RulesEngine ─────────────────────────────────────────────

export class RulesEngine implements IRulesEngine {
  private rules = new Map<string, RuleDefinition>();
  private rulesByAgent = new Map<string, RuleDefinition[]>();
  private rulesByHook = new Map<string, RuleDefinition[]>();
  private loaded = false;

  constructor(private configDir: string) {}

  async loadAllRules(): Promise<void> {
    if (this.loaded) return;

    const files = await this.discoverRuleFiles(this.configDir);
    logger.info(`Discovered ${files.length} rule files`, { dir: this.configDir });

    for (const filePath of files) {
      try {
        const rule = await this.loadRuleFile(filePath);
        if (rule) {
          this.indexRule(rule);
        }
      } catch (error) {
        logger.error(`Failed to load rule file: ${filePath}`, {
          error: getErrorMessage(error),
        });
      }
    }

    this.loaded = true;
    logger.info(`Rules engine loaded: ${this.rules.size} rules`, {
      alwaysApply: this.getAlwaysApplyRules('*').length,
      hooked: [...this.rulesByHook.keys()],
    });
  }

  getAlwaysApplyRules(agentType: string): RuleDefinition[] {
    const all = this.rulesByAgent.get(agentType) ?? [];
    const wildcard = this.rulesByAgent.get('*') ?? [];
    const combined = [...all, ...wildcard];
    return combined
      .filter(r => r.alwaysApply && r.enabled)
      .sort((a, b) => b.priority - a.priority);
  }

  getHookedRules(agentType: string, intentHint: string): RuleDefinition[] {
    const agentRules = this.rulesByAgent.get(agentType) ?? [];
    const wildcardRules = this.rulesByAgent.get('*') ?? [];
    const combined = [...agentRules, ...wildcardRules];

    const hooked = combined.filter(r => {
      if (r.alwaysApply || !r.enabled) return false;
      return r.hook.includes(intentHint) || r.hook.includes('*');
    });

    return hooked.sort((a, b) => b.priority - a.priority);
  }

  getAllRulesForAgent(agentType: string, intentHint?: string): RuleDefinition[] {
    const alwaysApply = this.getAlwaysApplyRules(agentType);
    const hooked = intentHint ? this.getHookedRules(agentType, intentHint) : [];

    // 去重（同一规则可能同时出现在 alwaysApply 和 hooked 中不会发生，但以防万一）
    const seen = new Set<string>();
    const result: RuleDefinition[] = [];
    for (const rule of [...alwaysApply, ...hooked]) {
      if (!seen.has(rule.name)) {
        seen.add(rule.name);
        result.push(rule);
      }
    }
    return result;
  }

  formatRulesForPrompt(rules: RuleDefinition[]): string {
    if (rules.length === 0) return '';
    const parts = rules.map(r =>
      `<rule name="${r.name}" priority="${r.priority}">\n${r.content}\n</rule>`
    );
    return `<rules>\n${parts.join('\n\n')}\n</rules>`;
  }

  getRuleByName(name: string): RuleDefinition | undefined {
    return this.rules.get(name);
  }

  async reloadRule(name: string): Promise<void> {
    const rule = this.rules.get(name);
    if (!rule) return;
    // 从索引中移除
    this.unindexRule(rule);
    // 重新加载
    try {
      const newRule = await this.loadRuleFile(rule.filePath);
      if (newRule) {
        this.indexRule(newRule);
      }
    } catch (error) {
      logger.error(`Failed to reload rule: ${name}`, {
        error: getErrorMessage(error),
      });
      // 重新索引旧规则
      this.indexRule(rule);
    }
  }

  async reloadAll(): Promise<void> {
    this.rules.clear();
    this.rulesByAgent.clear();
    this.rulesByHook.clear();
    this.loaded = false;
    await this.loadAllRules();
  }

  get ruleCount(): number {
    return this.rules.size;
  }

  get ruleNames(): string[] {
    return [...this.rules.keys()];
  }

  // ─── 私有方法 ──────────────────────────────────────────────

  private async discoverRuleFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stats = await stat(fullPath);
        if (stats.isDirectory()) {
          const subFiles = await this.discoverRuleFiles(fullPath);
          files.push(...subFiles);
        } else if (extname(entry) === '.md') {
          files.push(fullPath);
        }
      }
    } catch {
      // 目录不存在时返回空数组
    }
    return files;
  }

  private async loadRuleFile(filePath: string): Promise<RuleDefinition | null> {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = parseFrontmatter(raw, { filePath });
    if (!parsed.hasFrontmatter) {
      logger.warn(`Rule file has no frontmatter: ${filePath}`);
      return null;
    }

    const frontmatter = validateAttributes(parsed.attributes, ruleFrontmatterSchema, filePath);

    return {
      name: frontmatter.name,
      alwaysApply: frontmatter.alwaysApply,
      hook: frontmatter.hook,
      targetAgent: frontmatter.targetAgent,
      description: frontmatter.description,
      priority: frontmatter.priority,
      enabled: frontmatter.enabled,
      content: parsed.body,
      filePath,
    };
  }

  private indexRule(rule: RuleDefinition): void {
    this.rules.set(rule.name, rule);

    // 按 targetAgent 索引
    for (const agent of rule.targetAgent) {
      const list = this.rulesByAgent.get(agent) ?? [];
      list.push(rule);
      this.rulesByAgent.set(agent, list);
    }

    // 按 hook 索引
    for (const hook of rule.hook) {
      const list = this.rulesByHook.get(hook) ?? [];
      list.push(rule);
      this.rulesByHook.set(hook, list);
    }
  }

  private unindexRule(rule: RuleDefinition): void {
    this.rules.delete(rule.name);

    for (const agent of rule.targetAgent) {
      const list = this.rulesByAgent.get(agent);
      if (list) {
        const idx = list.findIndex(r => r.name === rule.name);
        if (idx !== -1) list.splice(idx, 1);
      }
    }

    for (const hook of rule.hook) {
      const list = this.rulesByHook.get(hook);
      if (list) {
        const idx = list.findIndex(r => r.name === rule.name);
        if (idx !== -1) list.splice(idx, 1);
      }
    }
  }
}
