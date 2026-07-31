// Prompt 模块端口接口 + 域类型
// 被 services/（实现）和 agents/（消费）共同引用，符合依赖倒置原则

// ─── 域类型 ────────────────────────────────────────────────

export interface RuleFrontmatter {
  name: string;
  alwaysApply: boolean;
  hook?: string | string[];
  targetAgent: string[];
  description: string;
  priority?: number;
  enabled?: boolean;
}

export interface RuleDefinition {
  name: string;
  alwaysApply: boolean;
  hook: string[];
  targetAgent: string[];
  description: string;
  priority: number;
  enabled: boolean;
  content: string;
  filePath: string;
}

export interface SkillDefinition {
  name: string;
  description: string;
  targetAgent: string[];
  trigger: string[];
  whenToUse: string;
  recommendedTools: string[];
  relatedRules: string[];
  completionCriteria: string;
  version: string;
  enabled: boolean;
  content: string | null;
  filePath: string;
}

export interface SkillSummary {
  name: string;
  description: string;
  whenToUse: string;
  trigger: string[];
}

// ─── 端口接口 ────────────────────────────────────────────────

export interface IRulesEngine {
  loadAllRules(): Promise<void>;
  getAlwaysApplyRules(agentType: string): RuleDefinition[];
  getHookedRules(agentType: string, intentHint: string): RuleDefinition[];
  getAllRulesForAgent(agentType: string, intentHint?: string): RuleDefinition[];
  formatRulesForPrompt(rules: RuleDefinition[]): string;
  getRuleByName(name: string): RuleDefinition | undefined;
  reloadRule(name: string): Promise<void>;
  reloadAll(): Promise<void>;
  readonly ruleCount: number;
  readonly ruleNames: string[];
}

export interface ISkillRegistry {
  loadAllSkills(): Promise<void>;
  getSkillListForAgent(agentType: string): SkillSummary[];
  getSkillsByIntent(agentType: string, intentHint: string): SkillSummary[];
  loadSkillContent(name: string): Promise<string | null>;
  formatSkillListForPrompt(agentType: string, intentHint?: string): string;
  getSkillByName(name: string): SkillDefinition | undefined;
  reloadSkill(name: string): Promise<void>;
  reloadAll(): Promise<void>;
  readonly skillCount: number;
  readonly skillNames: string[];
}
