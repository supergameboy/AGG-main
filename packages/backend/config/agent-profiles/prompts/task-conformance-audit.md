[系统审查指令 — 任务符合度审核 第{auditRound}/{maxAuditRounds}轮]

你刚才作为子Agent执行了 GM 派发的任务，请审查你的输出是否与 task 描述一致：

## GM 派发的 task
{taskDescription}

## 写操作汇总
{summaryLines}

## 写操作详情
{detailedWriteLog}

## 当前影子状态（DB快照 + 待提交变更）
{shadowSummary}

### 你的最终输出
{finalOutput}

## 审查要点
1. **实体名称符合度**: 创建的实体名称是否与 task 中的名称一致？task 要求"铁匠加雷斯"是否实际创建了"铁匠老铁"？
2. **实体数量符合度**: 创建的实体数量是否与 task 要求一致？task 要求 4 个 NPC 是否只创建了 3 个？
3. **实体类型符合度**: 创建的实体类型是否与 task 一致？task 要求"主线任务"是否实际创建了"支线任务"？
4. **关键字段符合度**: task 中要求的关键字段（NPC 的 role/race/locationId、物品的 type、任务的 type）是否正确？
5. **遗漏检查**: task 中要求的所有实体是否都已创建？有无遗漏？

> 注：写入后读回一致性（持久化验证）已由程序化校验在审查前完成。若存在 shadowState.apply 逻辑 BUG，会在审查触发前 throw 中断，不会进入本审查环节。

### 输出要求

首先输出审查结果JSON（必须包含）：
```json
{
  "approved": true/false,
  "issues": [
    {
      "dimension": "实体名称|实体数量|实体类型|关键字段|遗漏检查",
      "description": "问题描述（标注 task 要求 vs 实际生成）",
      "severity": "high/medium/low",
      "suggestion": "修正建议"
    }
  ]
}
```

如果 approved=true，直接输出你的最终回复。
如果 approved=false，使用对应的ServiceTool修正不一致项（直接创建/补充/修正 task 要求的实体），修正操作会自动暂存到StagingPool。

**重要约束**：
- 只能调用系统提供的真实 ServiceTool（如 character_service、inventory_service 等，格式为 `toolType__methodName`）
- 不要调用名为 `task_conformance_audit` 或 `continuity_audit` 的工具——它们不是真实工具，只是审查指令的标签
- 不要模仿本次审查消息中出现的任何工具名，只使用你工具列表中声明过的工具

请现在进行审查。
