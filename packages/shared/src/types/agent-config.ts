export interface AgentProfile {
  id?: string;
  name: string;
  description: string;
  game_mode: string;
  agents: Record<string, AgentConfig>;
  permissions?: Record<string, unknown>;
  tools?: unknown[];
  is_builtin?: boolean;
  source?: 'yaml' | 'database';
  created_at?: number;
  updated_at?: number;
}

export interface AgentConfig {
  name: string;
  englishId?: string;
  description: string;
  whenToInvoke?: string;
  system_prompt_file: string;
  model?: string;
  provider_id?: string;
  temperature?: number;
  max_tokens?: number;
  max_iterations?: number;
  max_context_tokens?: number;
  force_structured_output?: boolean;
  isSubAgent?: boolean;
  enableSpawnAgent?: boolean;
  deterministicActions?: string[];
  initDeterministicActions?: string[];
  enableStagingPool?: boolean;
  enableContinuityAudit?: boolean;
  enableTaskConformanceAudit?: boolean;
  tools: string[];
  capabilities?: AgentCapabilityConfig;
  rules?: AgentRulesConfig;
  skills?: AgentSkillsConfig;
  help?: AgentHelpConfig;
  toolBudget?: ToolExposureBudgetConfig;
  hookPolicies?: AgentHookPoliciesConfig;
  /** M5: 循环内动态切模型 hook 配置（可选，缺省不启用） */
  prepareNextTurn?: PrepareNextTurnConfig;
}

/** M5: prepareNextTurn hook 配置（fantasy_rpg.yaml agents.<key>.prepareNextTurn） */
export interface PrepareNextTurnConfig {
  /** 是否启用，缺省 false */
  enabled?: boolean;
  /** 策略名。本期实现 'iteration-tier'；未知值 → warn + 不启用（扩展点，非 stub） */
  strategy?: 'iteration-tier';
  /** iteration-tier 策略参数 */
  iterationTier?: IterationTierStrategyConfig;
  /** 模型切换 guard（缺省用默认值） */
  guard?: ModelSwitchGuardConfig;
}

export interface IterationTierStrategyConfig {
  /** iteration > N 时切换 fast tier（N >= 1） */
  fastAfterIteration: number;
}

export interface ModelSwitchGuardConfig {
  /** 每个 ReAct loop 最多模型切换次数，缺省 2 */
  maxSwitchesPerLoop?: number;
  /** 切换后冷却轮数（冷却期内禁止再次切换），缺省 1 */
  cooldownIterations?: number;
  /** 是否允许切回 baseline，缺省 true */
  allowSwitchBack?: boolean;
}

export interface ToolExposureBudgetConfig {
  maxVisibleTools?: number;
  maxVisibleHelpDocs?: number;
  maxToolSummaryTokens?: number;
  maxHelpSummaryTokens?: number;
  maxOnDemandLoadsPerTurn?: number;
}

export interface AgentRulesConfig {
  dir: string;
  alwaysApply?: string[];
  hooked?: string[];
}

export interface AgentSkillsConfig {
  dir: string;
  list?: string[];
}

export interface AgentHelpConfig {
  dir?: string;
  dirs?: string[];
  autoLoadOnFirstUse?: boolean;
}

export interface AgentCapabilityConfig {
  supported_intents: string[];
  required_fields: string[];
  optional_fields?: string[];
}

export interface AgentHookPoliciesConfig {
  disable?: string[];
  recovery?: AgentRecoveryPolicyConfig;
}

export interface AgentRecoveryPolicyConfig {
  enableReadonlyDegrade?: boolean;
  enableFallbackAgent?: boolean;
  enableHelpReload?: boolean;
  enableStableModelRetry?: boolean;
  maxAttempts?: number;
}

export interface PermissionConfig {
  agents: Record<string, AgentPermissionConfig>;
}

export interface AgentPermissionConfig {
  tools: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
