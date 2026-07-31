import { readFileSync, existsSync, watch, type FSWatcher } from 'fs';
import { resolve, dirname, basename } from 'path';
import * as yaml from 'js-yaml';
import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import { estimateTokens } from '@ai-rpg/shared/utils/token-estimate';
import type { ID } from '../../../shared/src/types/core.js';
import { ContextOverflowError } from '../../../shared/src/types/errors.js';
import type { ContextManifest, ContextSection, ExpandContext } from '../../../shared/src/types/context-manifest.js';
import { mergeManifest } from '../../../shared/src/types/context-manifest.js';
import type { GameDataExpander } from './game-data-expander.js';

const logger = createChildLogger('context-injector');

interface ContextRule {
  id: string;
  source: string;
  method: string;
  format: 'compact' | 'summary' | 'full';
  params?: Record<string, unknown>;
  description: string;
}

interface AgentContextRules {
  required: ContextRule[];
  max_context_tokens: number;
}

interface ContextRulesConfig {
  context_rules: Record<string, AgentContextRules>;
  default_manifests?: Record<string, Record<string, ManifestRuleEntry>>;
}

interface ManifestRuleEntry {
  sections: ContextSection[];
  description?: string;
}

interface RuleFetchResult {
  rule: ContextRule;
  data: unknown;
  error: Error | null;
}

export interface InjectedMethod {
  source: string;
  method: string;
}

export interface ContextInjectionResult {
  context: string | null;
  injectedMethods: InjectedMethod[];
}

export type ContextFetchFn = (
  source: string,
  method: string,
  params: Record<string, unknown>,
  saveId: ID,
  templateId?: string,
) => Promise<unknown>;

/**
 * injectForAgentWithManifest 的参数选项（归并为对象，符合函数参数最佳实践）。
 */
export interface InjectWithManifestOptions {
  agentType: string;
  saveId: ID;
  fetcher: ContextFetchFn;
  manifest: ContextManifest;
  gameDataExpander: GameDataExpander;
  expandContext: ExpandContext;
  sharedFetchCache?: Map<string, Promise<RuleFetchResult>>;
  overrideMaxContextTokens?: number;
  templateId?: string;
  requestId?: string;
}

/** 重新导出 mergeManifest 供 coordinator 使用 */
export { mergeManifest };

export class ContextInjector {
  private rules: Record<string, AgentContextRules> = {};
  private defaultManifests: Record<string, Record<string, ManifestRuleEntry>> = {};
  private configPath: string;
  private inFlightSnapshots = new Map<string, Promise<string | null>>();
  private watcher: FSWatcher | null = null;
  private reloadTimer: NodeJS.Timeout | null = null;
  private static readonly RELOAD_DEBOUNCE_MS = 300;

  constructor(configPath?: string) {
    const defaultPath = resolve(process.env.AGENT_CONFIG_DIR || resolve(process.cwd(), 'config'), 'agent-context-rules.yaml');
    this.configPath = configPath || defaultPath;
    this.loadRules();
    this.startWatching();
  }

  reloadRules(): void {
    this.rules = {};
    this.defaultManifests = {};
    this.loadRules();
  }

  /**
   * 释放文件监听器与防抖定时器。
   * 调用后不再监听 agent-context-rules.yaml 变化，可重复调用（幂等）。
   */
  dispose(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * 启动目录监听：监听 configPath 所在目录，当 agent-context-rules.yaml
   * 变化时防抖触发 reloadRules()。目录不存在或启动失败时 warn 降级，不抛错。
   */
  private startWatching(): void {
    try {
      const dir = dirname(this.configPath);
      const targetFile = basename(this.configPath);
      if (!existsSync(dir)) {
        logger.warn('Cannot start context rules file watcher, config directory not found', { dir });
        return;
      }
      this.watcher = watch(dir, { persistent: false }, (_eventType, changedFile) => {
        if (changedFile === targetFile) {
          this.scheduleReload();
        }
      });
      this.watcher.on('error', (error) => {
        logger.warn('Context rules file watcher error', { error: getErrorMessage(error) });
      });
      logger.info('Context rules file watcher started', { path: this.configPath });
    } catch (error) {
      logger.warn('Failed to start context rules file watcher', { error: getErrorMessage(error) });
    }
  }

  /**
   * 防抖调度重载：300ms 内多次调用合并为一次 reloadRules()。
   */
  private scheduleReload(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
    }
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      logger.info('Context rules file changed, reloading rules');
      this.reloadRules();
    }, ContextInjector.RELOAD_DEBOUNCE_MS);
  }

  private loadRules(): void {
    try {
      const resolvedPath = resolve(this.configPath);
      if (!existsSync(resolvedPath)) {
        logger.warn('Context rules config not found, context injection disabled', { path: resolvedPath });
        return;
      }

      const content = readFileSync(resolvedPath, 'utf-8');
      const config = yaml.load(content) as ContextRulesConfig;

      if (config?.context_rules) {
        this.rules = config.context_rules;
        logger.info('Context rules loaded', { agentCount: Object.keys(this.rules).length });
      } else {
        logger.warn('Context rules config has no context_rules section');
      }

      // v2: 加载 default_manifests（manifest 路径，按 agentType+action）
      if (config?.default_manifests) {
        this.defaultManifests = config.default_manifests;
        const manifestCount = Object.values(config.default_manifests).reduce((sum, m) => sum + Object.keys(m).length, 0);
        logger.info('Default manifests loaded', { agentTypeCount: Object.keys(this.defaultManifests).length, manifestCount });
      }
    } catch (error) {
      logger.error('Failed to load context rules config', {
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * 检查某 Agent 是否配置了上下文注入规则
   */
  hasRules(agentType: string): boolean {
    return agentType in this.rules;
  }

  /**
   * 获取某 Agent 的上下文注入规则
   */
  getRules(agentType: string): AgentContextRules | undefined {
    return this.rules[agentType];
  }

  /**
   * 获取默认 manifest（按 agentType+action 从 agent-context-rules.yaml v2 查）。
   * 程序自动构建路径用。返回深拷贝避免修改缓存。
   */
  getDefaultManifest(agentType: string, action?: string): ContextManifest | null {
    const byAction = this.defaultManifests[agentType];
    if (!byAction) return null;
    const entry = action ? byAction[action] : undefined;
    if (!entry) return null;
    // 深拷贝避免调用方修改缓存
    return { sections: entry.sections.map((s) => ({ ...s, filter: s.filter ? { ...s.filter } : undefined })) };
  }

  /**
   * 注入扩展：支持 manifest 参数（参数归并为 options 对象）。
   * 先走 manifest 路径（GameDataExpander），再合并现有 v1 rules 结果。
   *
   * V-3 token预算分配：manifest路径先执行占用预算，v1 rules在剩余预算内执行。
   * 若v1 rules预算不足，v1路径内部会降级为name_list格式或跳过非关键项。
   *
   * 失败处理（B-9）：manifest 路径失败时分类处理，不整体回退到 v1 rules。
   */
  async injectForAgentWithManifest(options: InjectWithManifestOptions): Promise<ContextInjectionResult> {
    const { agentType, saveId, fetcher, manifest, gameDataExpander, expandContext, sharedFetchCache, overrideMaxContextTokens, templateId, requestId } = options;

    // 1. manifest 路径：GameDataExpander.expand
    let manifestContext = '';
    try {
      manifestContext = await gameDataExpander.expand(manifest, expandContext);
    } catch (error) {
      // 数据源不可用/程序错误 → 抛出阻断（不降级回退 v1）
      logger.error('Manifest expansion failed (blocking)', { agentType, error: getErrorMessage(error) });
      throw error;
    }

    // V-3 token预算分配：计算manifest路径占用的token数，v1路径用剩余预算
    const rules = this.rules[agentType];
    const totalBudget = overrideMaxContextTokens ?? rules?.max_context_tokens ?? 184000;
    const manifestTokens = manifestContext ? estimateTokens(manifestContext) : 0;
    const remainingBudget = Math.max(0, totalBudget - manifestTokens);

    if (manifestTokens > 0 && manifestTokens >= totalBudget) {
      logger.warn('Manifest path consumed entire token budget, v1 rules path will have no space', {
        agentType, manifestTokens, totalBudget,
      });
    }

    // 2. v1 rules 路径：用剩余预算执行（预算不足时v1内部降级为name_list或跳过非关键项）
    const v1Result = await this.injectForAgentDetailed(agentType, saveId, fetcher, sharedFetchCache, remainingBudget > 0 ? remainingBudget : 1, templateId, requestId);

    // 3. 合并结果（manifest 先，v1 后）
    const combined = [manifestContext, v1Result.context].filter(Boolean).join('\n\n');
    return {
      context: combined || null,
      injectedMethods: v1Result.injectedMethods,
    };
  }

  /**
   * 从现有 context rules 自动构建 agentType → Set<source> 映射。
   * 当 peerResults 中存在某个 agentType 的结果时，
   * 该 agentType 处理过的所有 source 数据已被 peerResults 覆盖。
   */
  private buildAgentSourceMap(): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    for (const [agentType, rules] of Object.entries(this.rules)) {
      const sources = new Set(rules.required.map(rule => rule.source));
      if (sources.size > 0) {
        map.set(agentType, sources);
      }
    }
    return map;
  }

  /**
   * 计算 peerResult keys 覆盖的所有 source。
   * 当 peerResults 包含某个 Agent 的结果时，该 Agent 处理过的 source 数据
   * 已由 peerResults 提供（且是更新版本），预加载上下文中同 source 的项应跳过。
   */
  getCoveredSources(peerResultKeys: string[]): Set<string> {
    const agentSourceMap = this.buildAgentSourceMap();
    const coveredSources = new Set<string>();
    for (const key of peerResultKeys) {
      const sources = agentSourceMap.get(key);
      if (sources) {
        for (const source of sources) {
          coveredSources.add(source);
        }
      }
    }
    return coveredSources;
  }

  /**
   * 为指定的 Agent 注入上下文
   *
   * @returns 格式化后的上下文字符串（可直接注入 SystemPrompt），或 null 表示无需注入
   */
  private lastInjectedMethods = new Map<string, InjectedMethod[]>();

  async injectForAgent(
    agentType: string,
    saveId: ID,
    fetcher: ContextFetchFn,
    sharedFetchCache?: Map<string, Promise<RuleFetchResult>>,
    templateId?: string,
    requestId?: string,
  ): Promise<string | null> {
    const result = await this.injectForAgentDetailed(agentType, saveId, fetcher, sharedFetchCache, undefined, templateId, requestId);
    return result.context;
  }

  async injectForAgentDetailed(
    agentType: string,
    saveId: ID,
    fetcher: ContextFetchFn,
    sharedFetchCache?: Map<string, Promise<RuleFetchResult>>,
    overrideMaxContextTokens?: number,
    templateId?: string,
    requestId?: string,
  ): Promise<ContextInjectionResult> {
    const snapshotKey = this.buildSnapshotKey(agentType, saveId, templateId);
    const existingSnapshot = this.inFlightSnapshots.get(snapshotKey);
    if (existingSnapshot) {
      const context = await existingSnapshot;
      const cached = this.lastInjectedMethods.get(snapshotKey) ?? [];
      return { context, injectedMethods: cached };
    }

    const snapshotPromise = this.buildContextSnapshotDetailed(agentType, saveId, fetcher, sharedFetchCache, undefined, overrideMaxContextTokens, templateId, requestId);
    this.inFlightSnapshots.set(snapshotKey, snapshotPromise.then(r => r.context));

    try {
      const result = await snapshotPromise;
      this.lastInjectedMethods.set(snapshotKey, result.injectedMethods);
      return result;
    } finally {
      this.inFlightSnapshots.delete(snapshotKey);
    }
  }

  async prefetchForAgents(
    agentTypes: string[],
    saveId: ID,
    fetcher: ContextFetchFn,
    templateId?: string,
  ): Promise<Map<string, string | null>> {
    const sharedFetchCache = new Map<string, Promise<RuleFetchResult>>();
    const uniqueAgentTypes = [...new Set(agentTypes)];
    const snapshots = await Promise.all(
      uniqueAgentTypes.map(async (agentType) => {
        try {
          const result = await this.buildContextSnapshotDetailed(agentType, saveId, fetcher, sharedFetchCache, undefined, undefined, templateId);
          return [
            agentType,
            result.context,
          ] as const;
        } catch (error) {
          logger.info('Context prefetch skipped for agent', {
            agentType,
            error: getErrorMessage(error),
          });
          return [agentType, null] as const;
        }
      }),
    );
    return new Map(snapshots);
  }

  /**
   * 构建去重后的预加载上下文。
   * 自动过滤掉 source 被 peerResults 覆盖的预加载项，
   * 避免 preloaded context 与 peerResults 数据冲突。
   */
  async buildContextSnapshotFiltered(
    agentType: string,
    saveId: ID,
    fetcher: ContextFetchFn,
    peerResultKeys: string[],
    sharedFetchCache?: Map<string, Promise<RuleFetchResult>>,
    templateId?: string,
    requestId?: string,
  ): Promise<ContextInjectionResult> {
    const rules = this.rules[agentType];
    if (!rules || rules.required.length === 0) {
      return { context: null, injectedMethods: [] };
    }

    // 自动计算被 peerResults 覆盖的 sources
    const coveredSources = this.getCoveredSources(peerResultKeys);

    // 过滤掉 source 被 peerResults 覆盖的 context rules
    const filteredRules: AgentContextRules = {
      ...rules,
      required: rules.required.filter(rule => {
        if (!coveredSources.has(rule.source)) {
          return true;  // source 未被覆盖，保留
        }
        logger.info('Context rule auto-suppressed (source covered by peerResults)', {
          agentType,
          ruleId: rule.id,
          source: rule.source,
          peerResultKeys,
        });
        return false;
      }),
    };

    // 使用 overrideRules 参数传入过滤后的规则，避免临时修改实例属性
    return await this.buildContextSnapshotDetailed(agentType, saveId, fetcher, sharedFetchCache, filteredRules, undefined, templateId, requestId);
  }

  /**
   * 为多个 Agent 预获取去重后的上下文。
   * @param agentPeerKeys 每个 Agent 对应的 peerResult keys，用于自动去重
   */
  async prefetchForAgentsFiltered(
    agentTypes: string[],
    saveId: ID,
    fetcher: ContextFetchFn,
    agentPeerKeys: Map<string, string[]>,
    templateId?: string,
  ): Promise<Map<string, string | null>> {
    const sharedFetchCache = new Map<string, Promise<RuleFetchResult>>();
    const uniqueAgentTypes = [...new Set(agentTypes)];
    const snapshots = await Promise.all(
      uniqueAgentTypes.map(async (agentType) => {
        try {
          const peerKeys = agentPeerKeys.get(agentType) ?? [];
          const result = await this.buildContextSnapshotFiltered(
            agentType, saveId, fetcher, peerKeys, sharedFetchCache, templateId,
          );
          return [agentType, result.context] as const;
        } catch (error) {
          logger.info('Context prefetch (filtered) skipped for agent', {
            agentType,
            error: getErrorMessage(error),
          });
          return [agentType, null] as const;
        }
      }),
    );
    return new Map(snapshots);
  }

  private async buildContextSnapshotDetailed(
    agentType: string,
    saveId: ID,
    fetcher: ContextFetchFn,
    sharedFetchCache?: Map<string, Promise<RuleFetchResult>>,
    overrideRules?: AgentContextRules,
    overrideMaxContextTokens?: number,
    templateId?: string,
    requestId?: string,
  ): Promise<ContextInjectionResult> {
    const rules = overrideRules ?? this.rules[agentType];
    if (!rules || rules.required.length === 0) {
      return { context: null, injectedMethods: [] };
    }

    // 优先使用外部传入的差异化值，否则使用agent-context-rules.yaml中的值，最终fallback 184000
    const maxContextTokens = overrideMaxContextTokens ?? rules.max_context_tokens ?? 184000;

    const contextParts: string[] = [];
    const injectedRules: string[] = [];
    const injectedRuleDetails: Array<{ id: string; source: string; method: string; recordCount: number; estimatedTokens: number; content: string }> = [];
    const injectedMethods: InjectedMethod[] = [];
    const skippedRules: string[] = [];
    let totalTokens = 0;

    const fetchedRuleResults: Array<Promise<RuleFetchResult> | undefined> = new Array(rules.required.length);
    let nextToFetch = 0;
    let inFlightCount = 0;
    const startFetch = (index: number) => {
      if (index >= rules.required.length || fetchedRuleResults[index]) {
        return;
      }
      inFlightCount += 1;
      fetchedRuleResults[index] = this.fetchRule(
        rules.required[index],
        saveId,
        fetcher,
        sharedFetchCache,
        templateId,
      ).finally(() => {
        inFlightCount -= 1;
      });
    };
    const fillWindow = () => {
      while (nextToFetch < rules.required.length && inFlightCount < 2) {
        startFetch(nextToFetch);
        nextToFetch += 1;
      }
    };
    let currentWindowEnd = -1;
    const advanceWindowIfNeeded = (processedIndex: number) => {
      if (processedIndex < currentWindowEnd) {
        return;
      }
      fillWindow();
      currentWindowEnd = nextToFetch - 1;
    };

    fillWindow();
    currentWindowEnd = nextToFetch - 1;

    for (let index = 0; index < rules.required.length; index++) {
      const resultPromise = fetchedRuleResults[index];
      if (!resultPromise) {
        break;
      }
      const result = await resultPromise;
      const { rule, data, error } = result;

      if (error) {
        skippedRules.push(`${rule.id}(fetch_error)`);
        logger.info(`Failed to fetch context for rule: ${rule.id}`, {
          agentType,
          error: error.message,
        });
        advanceWindowIfNeeded(index);
        continue;
      }

      if (data === null || data === undefined) {
        skippedRules.push(`${rule.id}(no_data)`);
        advanceWindowIfNeeded(index);
        continue;
      }

      const formatted = this.formatContextItem(rule, data);
      const section = this.buildContextSection(rule, formatted);
      const estimatedTokens = estimateTokens(section);

      if (totalTokens + estimatedTokens > maxContextTokens) {
        skippedRules.push(`${rule.id}(token_limit)`);
        logger.info('Context token limit reached, skipping remaining rules', {
          agentType, totalTokens, maxTokens: maxContextTokens, skippedRule: rule.id,
        });
        break;
      }

      contextParts.push(section);
      totalTokens += estimatedTokens;
      injectedRules.push(rule.id);
      injectedMethods.push({ source: rule.source, method: rule.method });
      injectedRuleDetails.push({
        id: rule.id,
        source: rule.source,
        method: rule.method,
        recordCount: Array.isArray(data) ? data.length : 1,
        estimatedTokens,
        content: formatted,
      });
      advanceWindowIfNeeded(index);
    }

    if (contextParts.length === 0) {
      if (rules.required.length > 0) {
        logger.warn('Context overflow: all context rules skipped due to token limits or fetch failures', {
          agentType,
          maxTokens: maxContextTokens,
          ruleCount: rules.required.length,
        });
        throw new ContextOverflowError({
          agentType,
          currentTokens: totalTokens,
          maxTokens: maxContextTokens,
          suggestion: 'Reduce context rules or increase max_context_tokens',
        });
      }
      return { context: null, injectedMethods: [] };
    }

    const contextStr = '\n\n---\n## 预加载上下文（GameMasterAgent注入）\n' +
      '⚠️ 以下数据已由系统预先查询并注入，禁止调用Tool重复获取相同数据。直接使用下方数据即可：\n\n' +
      contextParts.join('\n\n') +
      '\n\n---';

    logger.info(`Context injected for ${agentType}, ${injectedRuleDetails.length} rules, ${totalTokens} tokens`, {
      tag: 'CONTEXT-INJECT',
      requestId,
      agent: agentType,
      injectedRules: injectedRuleDetails.map(r => ({
        ruleId: r.id,
        source: r.source,
        method: r.method,
        recordCount: r.recordCount,
        estimatedTokens: r.estimatedTokens,
        content: r.content,
      })),
      skippedRules: skippedRules.length > 0 ? skippedRules : undefined,
      totalTokens,
      maxTokens: maxContextTokens,
    });
    return { context: contextStr, injectedMethods };
  }

  private buildSnapshotKey(agentType: string, saveId: ID, templateId?: string): string {
    return `${agentType}::${saveId}::${templateId ?? ''}`;
  }

  private buildRuleFetchKey(rule: ContextRule, saveId: ID, templateId?: string): string {
    return `${rule.source}::${rule.method}::${JSON.stringify({ ...rule.params, saveId, templateId })}`;
  }

  private async fetchRule(
    rule: ContextRule,
    saveId: ID,
    fetcher: ContextFetchFn,
    sharedFetchCache?: Map<string, Promise<RuleFetchResult>>,
    templateId?: string,
  ): Promise<RuleFetchResult> {
    const runFetch = async (): Promise<RuleFetchResult> => {
      try {
        const params: Record<string, unknown> = { ...rule.params, saveId };
        if (templateId) {
          params.templateId = templateId;
        }
        const data = await fetcher(rule.source, rule.method, params, saveId, templateId);
        return { rule, data, error: null };
      } catch (error) {
        return {
          rule,
          data: undefined,
          error: error instanceof Error ? error : new Error('Unknown error'),
        };
      }
    };

    if (!sharedFetchCache) {
      return runFetch();
    }

    const fetchKey = this.buildRuleFetchKey(rule, saveId, templateId);
    const existingFetch = sharedFetchCache.get(fetchKey);
    if (existingFetch) {
      return existingFetch;
    }

    const fetchPromise = runFetch();
    sharedFetchCache.set(fetchKey, fetchPromise);
    return fetchPromise;
  }

  private buildContextSection(rule: ContextRule, formatted: string): string {
    // 不在标题中暴露 source.method：之前的格式「来源: character_service.get_full_status」
    // 会让 LLM 推断出工具调用名 character_service__get_full_status，破坏 pre-load 第一层
    // 隐藏机制。预加载数据契约通过 GM 主 prompt 显式说明，不依赖 section 标题泄露。
    return `## ${rule.description}\n${formatted}`;
  }

  private formatContextItem(rule: ContextRule, data: unknown): string {
    if (typeof data === 'string') {
      return data;
    }

    if (rule.format === 'compact') {
      return this.formatCompact(data);
    }

    if (rule.format === 'summary') {
      if (typeof data === 'object' && data !== null && 'summary' in data) {
        return String((data as Record<string, unknown>).summary);
      }
      return this.formatCompact(data);
    }

    return JSON.stringify(data, null, 2);
  }

  private static readonly COMPACT_EXCLUDED_KEYS = [
    'created_at', 'updated_at',
    'saveId', 'save_id',
    'triggeredAt', 'triggered_at',
    'resolvedAt', 'resolved_at',
    'timestamp', 'joinedPartyAt', 'joined_party_at',
    'locationId', 'locationName', 'parentId', 'mapId',
  ];

  private static readonly IDENTITY_FIELDS = ['id', 'name', 'role', 'type'];

  private formatCompact(data: unknown): string {
    if (typeof data === 'string') {
      return data;
    }

    if (Array.isArray(data)) {
      if (data.length === 0) return '(空)';
      const lines: string[] = ['<entity_attributes>'];
      for (const item of data) {
        if (typeof item === 'object' && item !== null) {
          const record = item as Record<string, unknown>;
          const id = String(record.id ?? '');
          const tag = String(record.type ?? record.role ?? 'item');
          const attrs = Object.entries(record)
            .filter(([k]) => !ContextInjector.COMPACT_EXCLUDED_KEYS.includes(k) && !ContextInjector.IDENTITY_FIELDS.includes(k))
            .slice(0, 6)
            .map(([k, v]) => `${k}: ${this.stringifyCompactValue(v)}`)
            .join(' | ');
          lines.push(`<${tag} id="${id}">${attrs}</${tag}>`);
        } else {
          lines.push(`<item>${String(item).substring(0, 100)}</item>`);
        }
      }
      lines.push('</entity_attributes>');
      return lines.join('\n');
    }

    if (typeof data === 'object' && data !== null) {
      const record = data as Record<string, unknown>;
      const parts: string[] = [];
      for (const [k, v] of Object.entries(record)) {
        if (v === null || v === undefined || ContextInjector.COMPACT_EXCLUDED_KEYS.includes(k) || ContextInjector.IDENTITY_FIELDS.includes(k)) continue;
        if (Array.isArray(v)) {
          const formatted = this.formatCompact(v);
          parts.push(`${k}:\n${formatted}`);
        } else {
          const value = this.stringifyCompactValue(v);
          parts.push(`${k}: ${value.length > 200 ? value.substring(0, 200) + '...' : value}`);
        }
      }
      return parts.join('\n');
    }

    return String(data);
  }

  private stringifyCompactValue(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v !== 'object') return String(v);
    return JSON.stringify(this.stripExcludedKeysDeep(v));
  }

  private stripExcludedKeysDeep(data: unknown): unknown {
    if (Array.isArray(data)) {
      return data.map(item => this.stripExcludedKeysDeep(item));
    }
    if (typeof data === 'object' && data !== null) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (ContextInjector.COMPACT_EXCLUDED_KEYS.includes(key)) continue;
        result[key] = this.stripExcludedKeysDeep(value);
      }
      return result;
    }
    return data;
  }
}
