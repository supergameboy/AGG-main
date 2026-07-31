import type { AgentRecoveryPolicyConfig } from '../../../../shared/src/types/agent-config.js';

export type RecoveryAction =
  | 'reload_help'
  | 'degrade_readonly'
  | 'retry_with_stable_model'
  | 'fallback_agent'
  | 'explain_only';

export interface RecoveryPlannerInput {
  action?: RecoveryAction;
  reason?: string;
  stableModel?: string;
  fallbackAgentType?: string;
}

export interface RecoveryDecision {
  action: RecoveryAction;
  reason: string;
  attempt: number;
  finalDecision: boolean;
  stableModel?: string;
  fallbackAgentType?: string;
}

function normalizeReason(reason: string | undefined): string {
  return (reason ?? '').trim().toLowerCase();
}

function shouldEscalateToFallback(
  action: RecoveryAction,
  overLimit: boolean,
  enableFallbackAgent: boolean,
): boolean {
  if (!overLimit || !enableFallbackAgent) {
    return false;
  }

  return action !== 'fallback_agent' && action !== 'explain_only';
}

export class RecoveryPlanner {
  private readonly config: Required<AgentRecoveryPolicyConfig>;

  constructor(config?: AgentRecoveryPolicyConfig) {
    this.config = {
      enableReadonlyDegrade: config?.enableReadonlyDegrade ?? true,
      enableFallbackAgent: config?.enableFallbackAgent ?? true,
      enableHelpReload: config?.enableHelpReload ?? true,
      enableStableModelRetry: config?.enableStableModelRetry ?? true,
      maxAttempts: config?.maxAttempts ?? 2,
    };
  }

  plan(input: RecoveryPlannerInput | undefined, attempt: number): RecoveryDecision {
    const reason = normalizeReason(input?.reason);
    const explicitAction = input?.action;
    const overLimit = attempt >= this.config.maxAttempts;

    if (explicitAction) {
      if (shouldEscalateToFallback(explicitAction, overLimit, this.config.enableFallbackAgent)) {
        return {
          action: 'fallback_agent',
          reason: input?.reason ?? explicitAction,
          attempt,
          finalDecision: true,
          stableModel: input?.stableModel,
          fallbackAgentType: input?.fallbackAgentType,
        };
      }

      return {
        action: explicitAction,
        reason: input?.reason ?? explicitAction,
        attempt,
        finalDecision: overLimit && explicitAction !== 'fallback_agent',
        stableModel: input?.stableModel,
        fallbackAgentType: input?.fallbackAgentType,
      };
    }

    if (reason.includes('parameter') || reason.includes('argument') || reason.includes('schema')) {
      return {
        action: this.config.enableHelpReload ? 'reload_help' : 'explain_only',
        reason: input?.reason ?? 'parameter failure',
        attempt,
        finalDecision: overLimit,
      };
    }

    if (reason.includes('readonly') || reason.includes('write denied') || reason.includes('permission denied')) {
      return {
        action: this.config.enableReadonlyDegrade ? 'degrade_readonly' : 'explain_only',
        reason: input?.reason ?? 'readonly degrade',
        attempt,
        finalDecision: overLimit,
      };
    }

    if (reason.includes('timeout') || reason.includes('provider')) {
      if (overLimit && this.config.enableFallbackAgent) {
        return {
          action: 'fallback_agent',
          reason: input?.reason ?? 'stable retry exhausted',
          attempt,
          finalDecision: true,
          fallbackAgentType: input?.fallbackAgentType,
        };
      }

      return {
        action: this.config.enableStableModelRetry ? 'retry_with_stable_model' : 'explain_only',
        reason: input?.reason ?? 'provider timeout',
        attempt,
        finalDecision: overLimit,
        stableModel: input?.stableModel,
      };
    }

    if (overLimit && this.config.enableFallbackAgent) {
      return {
        action: 'fallback_agent',
        reason: input?.reason ?? 'fallback agent',
        attempt,
        finalDecision: true,
        fallbackAgentType: input?.fallbackAgentType,
      };
    }

    return {
      action: 'explain_only',
      reason: input?.reason ?? 'no recovery strategy matched',
      attempt,
      finalDecision: true,
    };
  }
}
