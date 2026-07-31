import type {
  AgentRuntimeSnapshot,
  HelpSnapshot,
  ToolVisibilitySnapshot,
} from './agent-runtime-snapshot.js';

export interface ChildRuntimeSnapshotInput {
  agentKey: string;
  configuredTools: string[];
  templateId?: string;
}

function filterAllowedFunctionNames(
  allowedFunctionNames: string[],
  allowedToolTypes: string[],
): string[] {
  return allowedFunctionNames.filter((functionName) =>
    allowedToolTypes.some((toolType) => functionName.startsWith(`${toolType}__`))
  );
}

function filterHelpSnapshot(
  helpSnapshot: HelpSnapshot[],
  allowedToolTypes: string[],
): HelpSnapshot[] {
  return helpSnapshot.filter((entry) => allowedToolTypes.includes(entry.tool));
}

function buildToolVisibilitySnapshot(
  parentSnapshot: AgentRuntimeSnapshot,
  allowedToolTypes: string[],
): ToolVisibilitySnapshot {
  return {
    allowedToolTypes,
    allowedFunctionNames: filterAllowedFunctionNames(
      parentSnapshot.toolVisibilitySnapshot.allowedFunctionNames,
      allowedToolTypes,
    ),
    deferredFunctionNames: filterAllowedFunctionNames(
      parentSnapshot.toolVisibilitySnapshot.deferredFunctionNames ?? [],
      allowedToolTypes,
    ),
    toolExposureBudget: structuredClone(parentSnapshot.toolVisibilitySnapshot.toolExposureBudget),
  };
}

export function deriveChildRuntimeSnapshot(
  parentSnapshot: AgentRuntimeSnapshot | null | undefined,
  input: ChildRuntimeSnapshotInput,
): AgentRuntimeSnapshot | null {
  if (!parentSnapshot) {
    return null;
  }

  const allowedToolTypes = parentSnapshot.toolVisibilitySnapshot.allowedToolTypes.filter((toolType) =>
    input.configuredTools.includes(toolType)
  );

  // v2 模块H H4: 4 次 structuredClone → 1 次，直接在克隆体上修改
  const clone = structuredClone(parentSnapshot);
  clone.agentKey = input.agentKey;
  clone.parentAgentRunId = parentSnapshot.requestId;
  clone.permissionSnapshot.configuredTools = allowedToolTypes;
  clone.helpSnapshot = filterHelpSnapshot(parentSnapshot.helpSnapshot, allowedToolTypes);
  clone.toolVisibilitySnapshot = buildToolVisibilitySnapshot(parentSnapshot, allowedToolTypes);
  clone.contextSnapshot.templateId = input.templateId ?? parentSnapshot.contextSnapshot.templateId;

  // L4.2 修复：显式重置 GM-only 字段，阻断 parent 状态继承
  // 依据：在 bindRuntimeSnapshot（AgentRuntime.ts:874）覆盖之前，task_start Hook
  // （AgentRuntime.ts:805）会触发 dispatchHook，dispatchHook 通过 getRuntimeSnapshot()
  // 读取 snapshot。若不重置，Hook 处理器在 race window 内可读到 GM 的内部状态。
  // 重置策略：
  //   - 标识类字段：置空，由 bindRuntimeSnapshot 后续设置
  //   - 时间类字段：使用子 Agent 自己的创建时间
  //   - 内容类字段：置空数组/空对象，避免泄漏 GM 的 prompt/model/rule/skill/debug 配置
  //   - progressContext：置 undefined，子 Agent 在 processMessage（AgentRuntime.ts:678）自行构建
  clone.requestId = '';
  clone.sessionId = '';
  clone.createdAt = Date.now();
  clone.progressContext = undefined;
  clone.modelSnapshot = {
    providerId: null,
    model: null,
    temperature: null,
    maxTokens: null,
  };
  clone.promptSnapshot = {
    systemPrompt: '',
    userPrompt: '',
  };
  clone.ruleSnapshot = [];
  clone.skillSnapshot = [];
  clone.debugSnapshot = { source: '' };
  return clone;
}
