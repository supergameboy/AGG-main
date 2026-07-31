# Init Convergence Review Prompt

## 任务是什么
根据 init 路径的执行结果和程序化收敛性校验结果，生成统一的 `UnifiedPostReviewDecision`，评估初始化是否收敛。

## 为什么有这个任务
初始化阶段需要确保角色/地点/NPC/技能/物品/任务等核心资源达到最小数量阈值。程序化校验已检查资源数量是否达标，LLM 仅需评估完成度和质量，决策是否需要 repair 循环补充缺失资源。

## 输入

| 输入项 | 来源 | 说明 |
|--------|------|------|
| 本轮 init 执行结果 | ReAct 循环输出 | 写操作摘要、LLM 输出前 800 字 |
| 程序化校验结果 | ContinuityAuditor.checkInitConvergence | 资源数量未达标项列表 |

## 输出要求
- 仅输出 `UnifiedPostReviewDecision` JSON 对象
- 输出必须是纯 JSON，无 markdown 代码块包裹
- 不生成最终玩家响应
- `continuityAudit` 字段由程序注入，LLM 无需生成

## `UnifiedPostReviewDecision` 字段定义（init 路径相关）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| taskReview.completion | string | 是 | 任务完成度：complete/partial/failed |
| taskReview.missingRequirements | string[] | 否 | 未满足的要求（对应 missing 列表） |
| taskReview.qualityVerifications | string[] | 否 | 质量验证项（如 NPC 是否有合理技能分配） |
| todoCompletion.completedItems | string[] | 是 | 已完成的资源创建项 |
| todoCompletion.incompleteItems | string[] | 是 | 未完成的资源创建项（对应 missing） |
| todoCompletion.overallCompletion | string | 是 | 整体完成度：complete/partial/failed |
| storyReview.storyConsistency | string | 否 | init 路径可省略或标记为 match |
| storyReview.progressDelta | string | 否 | init 进度增量描述 |
| secondLayerDecision.shouldSchedule | boolean | 否 | init 路径通常为 false |
| recordUploadDecision.shouldUpload | boolean | 否 | init 路径通常为 false |

## 完成度评估规则

| 完成度 | 条件 |
|--------|------|
| complete | 程序化校验全部通过（missing 为空），资源数量达标 |
| partial | 部分资源缺失，但已创建核心资源（角色+至少 1 地点），repair 可补充 |
| failed | 关键资源全缺（无角色或无地点），repair 无法在 2 轮内补齐 |

**关键约束**：
- `continuityAudit.passed` 由程序注入，LLM 不能覆盖
- LLM 的 `taskReview.completion` 应与 `continuityAudit.passed` 一致：passed=true → complete，passed=false → partial 或 failed
- `incompleteItems` 必须对应程序化校验的 missing 列表，不能凭空创造

## 输出示例

### 全部达标

```json
{
  "taskReview": {
    "completion": "complete",
    "missingRequirements": [],
    "qualityVerifications": []
  },
  "todoCompletion": {
    "completedItems": ["创建角色", "创建地点", "创建NPC", "创建技能", "创建物品", "创建任务"],
    "incompleteItems": [],
    "overallCompletion": "complete"
  },
  "storyReview": {
    "storyConsistency": "match",
    "progressDelta": "初始化完成，所有资源就绪"
  },
  "secondLayerDecision": {
    "shouldSchedule": false
  },
  "recordUploadDecision": {
    "shouldUpload": false
  }
}
```

### 部分缺失

```json
{
  "taskReview": {
    "completion": "partial",
    "missingRequirements": ["npcs(2/3)", "quests(1/2)"],
    "qualityVerifications": []
  },
  "todoCompletion": {
    "completedItems": ["创建角色", "创建地点", "创建技能", "创建物品"],
    "incompleteItems": ["npcs(2/3)", "quests(1/2)"],
    "overallCompletion": "partial"
  },
  "storyReview": {
    "storyConsistency": "partial_match",
    "progressDelta": "初始化部分完成，缺失 NPC 和任务"
  },
  "secondLayerDecision": {
    "shouldSchedule": false
  },
  "recordUploadDecision": {
    "shouldUpload": false
  }
}
```
