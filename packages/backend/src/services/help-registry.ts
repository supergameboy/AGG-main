import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import {
  parseFrontmatter,
  helpFrontmatterSchema,
  validateAttributes,
} from '../game-systems/shared/frontmatter/index.js';

const logger = createChildLogger('help-registry');

// ─── 类型定义 ────────────────────────────────────────────────

export interface HelpEntry {
  tool: string;           // ServiceTool type name, e.g. "challenge_service"
  method: string;         // Method name, e.g. "execute_turn"
  description: string;    // Brief description from frontmatter
  summary?: string;       // Short summary for prompt-time discovery
  whenToUse?: string[];   // Intent hints for on-demand discovery
  returnsSummary?: string; // Short return value summary
  filePath: string;       // Absolute path to the .md file
  content: string | null; // Lazy-loaded: null until first access
}

export interface HelpSummary {
  tool: string;
  method: string;
  description: string;
  summary?: string;
  whenToUse?: string[];
  returnsSummary?: string;
}

// ─── HelpRegistry ───────────────────────────────────────────

export class HelpRegistry {
  private helpIndex = new Map<string, Map<string, HelpEntry>>();  // toolType → method → entry
  private loaded = false;

  constructor(private configDir: string) {}

  async loadAllHelp(): Promise<void> {
    if (this.loaded) return;

    const files = await this.discoverHelpFiles(this.configDir);
    logger.info(`Discovered ${files.length} help files`, { dir: this.configDir });

    for (const filePath of files) {
      try {
        const entry = await this.loadHelpFile(filePath);
        if (entry) {
          this.indexEntry(entry);
        }
      } catch (error) {
        logger.error(`Failed to load help file: ${filePath}`, {
          error: getErrorMessage(error),
        });
      }
    }

    this.loaded = true;
    logger.info(`Help registry loaded: ${this.helpIndex.size} tools`, {
      tools: [...this.helpIndex.keys()],
    });
  }

  async getHelp(toolType: string, method: string): Promise<string | null> {
    const toolMap = this.helpIndex.get(toolType);
    if (!toolMap) return null;
    const entry = toolMap.get(method);
    if (!entry) return null;

    // 懒加载正文内容
    if (entry.content === null) {
      try {
        const raw = await readFile(entry.filePath, 'utf-8');
        const parsed = parseFrontmatter(raw, { filePath: entry.filePath });
        if (parsed.hasFrontmatter) entry.content = parsed.body;
      } catch (error) {
        logger.error(`Failed to load help content: ${entry.filePath}`, {
          error: getErrorMessage(error),
        });
        return null;
      }
    }
    return entry.content;
  }

  getHelpSummary(toolType: string): HelpSummary[] {
    const toolMap = this.helpIndex.get(toolType);
    if (!toolMap) return [];
    return [...toolMap.values()].map(entry => this.toHelpSummary(entry));
  }

  getHelpSummaryByMethod(toolType: string, method: string): HelpSummary | null {
    const entry = this.helpIndex.get(toolType)?.get(method);
    return entry ? this.toHelpSummary(entry) : null;
  }

  searchCapabilities(query: string): HelpSummary[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [];

    const matches: HelpSummary[] = [];

    for (const toolMap of this.helpIndex.values()) {
      for (const entry of toolMap.values()) {
        const haystack = [
          entry.tool,
          entry.method,
          entry.description,
          entry.summary,
          ...(entry.whenToUse ?? []),
          entry.returnsSummary,
        ]
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .join(' ')
          .toLowerCase();

        if (haystack.includes(normalizedQuery)) {
          matches.push(this.toHelpSummary(entry));
        }
      }
    }

    return matches;
  }

  hasHelp(toolType: string, method: string): boolean {
    return this.helpIndex.get(toolType)?.has(method) ?? false;
  }

  formatHelpForPrompt(content: string, toolType: string, method: string): string {
    return `<tool_help tool="${toolType}" method="${method}">\n${content}\n</tool_help>`;
  }

  async reloadAll(): Promise<void> {
    this.helpIndex.clear();
    this.loaded = false;
    await this.loadAllHelp();
  }

  get toolCount(): number {
    return this.helpIndex.size;
  }

  get totalMethodCount(): number {
    let count = 0;
    for (const toolMap of this.helpIndex.values()) {
      count += toolMap.size;
    }
    return count;
  }

  getAllHelpDocs(): Array<{ name: string; service: string; methodCount: number; filePath: string }> {
    const docs: Array<{ name: string; service: string; methodCount: number; filePath: string }> = [];
    for (const [service, toolMap] of this.helpIndex) {
      const entries = [...toolMap.values()];
      const methodCount = entries.length;
      const filePath = entries[0]?.filePath ?? '';
      docs.push({ name: service, service, methodCount, filePath });
    }
    return docs;
  }

  getHelpEntryByName(name: string): HelpEntry | undefined {
    for (const toolMap of this.helpIndex.values()) {
      const entry = toolMap.get(name);
      if (entry) return entry;
    }
    return undefined;
  }

  /** 按 service 名称查找该 service 下的所有 help 文档 */
  getHelpDocsByService(serviceName: string): HelpEntry[] {
    const toolMap = this.helpIndex.get(serviceName);
    if (!toolMap) return [];
    return [...toolMap.values()];
  }

  // ─── 私有方法 ──────────────────────────────────────────────

  private async discoverHelpFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stats = await stat(fullPath);
        if (stats.isDirectory()) {
          const subFiles = await this.discoverHelpFiles(fullPath);
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

  private async loadHelpFile(filePath: string): Promise<HelpEntry | null> {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = parseFrontmatter(raw, { filePath });
    if (!parsed.hasFrontmatter) {
      logger.warn(`Help file has no frontmatter: ${filePath}`);
      return null;
    }

    const frontmatter = validateAttributes(parsed.attributes, helpFrontmatterSchema, filePath);

    return {
      tool: frontmatter.tool,
      method: frontmatter.method,
      description: frontmatter.description,
      summary: frontmatter.summary,
      whenToUse: frontmatter.whenToUse,
      returnsSummary: frontmatter.returnsSummary,
      filePath,
      content: null, // 懒加载：启动时不读取正文内容
    };
  }

  private toHelpSummary(entry: HelpEntry): HelpSummary {
    return {
      tool: entry.tool,
      method: entry.method,
      description: entry.description,
      summary: entry.summary,
      whenToUse: entry.whenToUse,
      returnsSummary: entry.returnsSummary,
    };
  }

  private indexEntry(entry: HelpEntry): void {
    let toolMap = this.helpIndex.get(entry.tool);
    if (!toolMap) {
      toolMap = new Map();
      this.helpIndex.set(entry.tool, toolMap);
    }
    toolMap.set(entry.method, entry);
  }
}
