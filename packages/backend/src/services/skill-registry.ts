import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { SkillDefinition, SkillSummary, ISkillRegistry } from '@ai-rpg/shared/types/prompt';
import {
  parseFrontmatter,
  skillFrontmatterSchema,
  validateAttributes,
} from '../game-systems/shared/frontmatter/index.js';

const logger = createChildLogger('skill-registry');

// ─── SkillRegistry ───────────────────────────────────────────

export class SkillRegistry implements ISkillRegistry {
  private skills = new Map<string, SkillDefinition>();
  private skillsByAgent = new Map<string, SkillDefinition[]>();
  private loaded = false;

  constructor(private configDir: string) {}

  async loadAllSkills(): Promise<void> {
    if (this.loaded) return;

    const files = await this.discoverSkillFiles(this.configDir);
    logger.info(`Discovered ${files.length} skill files`, { dir: this.configDir });

    for (const filePath of files) {
      try {
        const skill = await this.loadSkillFile(filePath);
        if (skill) {
          this.indexSkill(skill);
        }
      } catch (error) {
        logger.error(`Failed to load skill file: ${filePath}`, {
          error: getErrorMessage(error),
        });
      }
    }

    this.loaded = true;
    logger.info(`Skill registry loaded: ${this.skills.size} skills`, {
      agents: [...this.skillsByAgent.keys()],
    });
  }

  getSkillListForAgent(agentType: string): SkillSummary[] {
    const agentSkills = this.skillsByAgent.get(agentType) ?? [];
    const wildcardSkills = this.skillsByAgent.get('*') ?? [];
    const combined = [...agentSkills, ...wildcardSkills];
    const seen = new Set<string>();
    return combined
      .filter(s => s.enabled)
      .filter(s => {
        if (seen.has(s.name)) return false;
        seen.add(s.name);
        return true;
      })
      .map(s => ({ name: s.name, description: s.description, whenToUse: s.whenToUse, trigger: s.trigger }));
  }

  getSkillsByIntent(agentType: string, intentHint: string): SkillSummary[] {
    const allSkills = this.getSkillListForAgent(agentType);
    return allSkills.filter(s =>
      s.trigger.length === 0 || s.trigger.includes(intentHint) || s.trigger.includes('*')
    );
  }

  async loadSkillContent(name: string): Promise<string | null> {
    const skill = this.skills.get(name);
    if (!skill || !skill.enabled) return null;

    if (skill.content) return skill.content;

    const raw = await readFile(skill.filePath, 'utf-8');
    const parsed = parseFrontmatter(raw, { filePath: skill.filePath });
    if (!parsed.hasFrontmatter) return null;

    skill.content = parsed.body;
    return skill.content;
  }

  formatSkillListForPrompt(agentType: string, intentHint?: string): string {
    const skills = intentHint
      ? this.getSkillsByIntent(agentType, intentHint)
      : this.getSkillListForAgent(agentType);
    if (skills.length === 0) return '';

    const parts = skills.map(s =>
      `<skill name="${s.name}">\n${s.description}\n何时使用: ${s.whenToUse}\n</skill>`
    );
    return `<available_skills>\n${parts.join('\n\n')}\n</available_skills>`;
  }

  getSkillByName(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  async reloadSkill(name: string): Promise<void> {
    const skill = this.skills.get(name);
    if (!skill) return;
    this.unindexSkill(skill);
    try {
      const newSkill = await this.loadSkillFile(skill.filePath);
      if (newSkill) {
        this.indexSkill(newSkill);
      }
    } catch (error) {
      logger.error(`Failed to reload skill: ${name}`, {
        error: getErrorMessage(error),
      });
      this.indexSkill(skill);
    }
  }

  async reloadAll(): Promise<void> {
    this.skills.clear();
    this.skillsByAgent.clear();
    this.loaded = false;
    await this.loadAllSkills();
  }

  get skillCount(): number {
    return this.skills.size;
  }

  get skillNames(): string[] {
    return [...this.skills.keys()];
  }

  // ─── 私有方法 ──────────────────────────────────────────────

  private async discoverSkillFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stats = await stat(fullPath);
        if (stats.isDirectory()) {
          const subFiles = await this.discoverSkillFiles(fullPath);
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

  private async loadSkillFile(filePath: string): Promise<SkillDefinition | null> {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = parseFrontmatter(raw, { filePath });
    if (!parsed.hasFrontmatter) {
      logger.warn(`Skill file has no frontmatter: ${filePath}`);
      return null;
    }

    const frontmatter = validateAttributes(parsed.attributes, skillFrontmatterSchema, filePath);

    return {
      name: frontmatter.name,
      description: frontmatter.description,
      targetAgent: frontmatter.targetAgent,
      trigger: frontmatter.trigger,
      whenToUse: frontmatter.whenToUse,
      recommendedTools: frontmatter.recommendedTools,
      relatedRules: frontmatter.relatedRules,
      completionCriteria: frontmatter.completionCriteria,
      version: frontmatter.version,
      enabled: frontmatter.enabled,
      content: null, // 懒加载：启动时不读取正文内容
      filePath,
    };
  }

  private indexSkill(skill: SkillDefinition): void {
    this.skills.set(skill.name, skill);

    for (const agent of skill.targetAgent) {
      const list = this.skillsByAgent.get(agent) ?? [];
      list.push(skill);
      this.skillsByAgent.set(agent, list);
    }
  }

  private unindexSkill(skill: SkillDefinition): void {
    this.skills.delete(skill.name);

    for (const agent of skill.targetAgent) {
      const list = this.skillsByAgent.get(agent);
      if (list) {
        const idx = list.findIndex(s => s.name === skill.name);
        if (idx !== -1) list.splice(idx, 1);
      }
    }
  }
}
