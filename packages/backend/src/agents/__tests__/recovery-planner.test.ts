import { describe, expect, it } from 'vitest';
import { RecoveryPlanner } from '../runtime/recovery-planner.js';

describe('RecoveryPlanner', () => {
  it('连续参数失败应切换到帮助全文重注入', () => {
    const planner = new RecoveryPlanner();

    const decision = planner.plan({
      reason: 'Tool parameter schema mismatch',
    }, 1);

    expect(decision).toEqual({
      action: 'reload_help',
      reason: 'Tool parameter schema mismatch',
      attempt: 1,
      finalDecision: false,
    });
  });

  it('高风险写操作被拒绝后应降级到只读工具集', () => {
    const planner = new RecoveryPlanner();

    const decision = planner.plan({
      reason: 'permission denied for write operation',
    }, 1);

    expect(decision).toEqual({
      action: 'degrade_readonly',
      reason: 'permission denied for write operation',
      attempt: 1,
      finalDecision: false,
    });
  });

  it('provider 超时应切换稳定模型并限制重试次数', () => {
    const planner = new RecoveryPlanner({
      maxAttempts: 2,
    });

    const retryDecision = planner.plan({
      reason: 'provider timeout',
      stableModel: 'gpt-stable',
    }, 1);
    const fallbackDecision = planner.plan({
      reason: 'provider timeout',
      stableModel: 'gpt-stable',
      fallbackAgentType: 'output',
    }, 2);

    expect(retryDecision).toEqual({
      action: 'retry_with_stable_model',
      reason: 'provider timeout',
      attempt: 1,
      finalDecision: false,
      stableModel: 'gpt-stable',
    });
    expect(fallbackDecision).toEqual({
      action: 'fallback_agent',
      reason: 'provider timeout',
      attempt: 2,
      finalDecision: true,
      fallbackAgentType: 'output',
    });
  });

  it('连续恢复后仍失败应切换 fallback agent', () => {
    const planner = new RecoveryPlanner({
      maxAttempts: 2,
      enableFallbackAgent: true,
    });

    const decision = planner.plan({
      action: 'retry_with_stable_model',
      reason: 'provider timeout',
      stableModel: 'gpt-stable',
      fallbackAgentType: 'output',
    }, 2);

    expect(decision).toEqual({
      action: 'fallback_agent',
      reason: 'provider timeout',
      attempt: 2,
      finalDecision: true,
      fallbackAgentType: 'output',
      stableModel: 'gpt-stable',
    });
  });
});
