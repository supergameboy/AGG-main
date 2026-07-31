import type { ToolExposureTrace } from '../prompt/types.js';

export interface ToolExposureRuntimeState {
  maxOnDemandLoadsPerTurn: number;
  usedOnDemandLoads: number;
}

export function createToolExposureRuntimeState(
  trace: ToolExposureTrace | undefined,
): ToolExposureRuntimeState | undefined {
  if (!trace) {
    return undefined;
  }

  return {
    maxOnDemandLoadsPerTurn: trace.budget.maxOnDemandLoadsPerTurn,
    usedOnDemandLoads: trace.budget.usedOnDemandLoads,
  };
}

export function consumeOnDemandLoad(
  state: ToolExposureRuntimeState | undefined,
): { success: true } | { success: false; error: string } {
  if (!state) {
    return { success: true };
  }

  if (state.usedOnDemandLoads >= state.maxOnDemandLoadsPerTurn) {
    return {
      success: false,
      error: 'On-demand help load budget exceeded for this turn',
    };
  }

  state.usedOnDemandLoads += 1;
  return { success: true };
}

export function resetOnDemandLoads(state: ToolExposureRuntimeState | undefined): boolean {
  if (!state || state.usedOnDemandLoads === 0) {
    return false;
  }

  state.usedOnDemandLoads = 0;
  return true;
}

export function mergeToolExposureBudget(
  budget: ToolExposureTrace['budget'] | undefined,
  state: ToolExposureRuntimeState | undefined,
): ToolExposureTrace['budget'] | undefined {
  if (!budget) {
    return undefined;
  }

  if (!state) {
    return structuredClone(budget);
  }

  return {
    ...structuredClone(budget),
    maxOnDemandLoadsPerTurn: state.maxOnDemandLoadsPerTurn,
    usedOnDemandLoads: state.usedOnDemandLoads,
  };
}
