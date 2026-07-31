# Story Review And Record Prompt

## 任务是什么
根据第一层执行结果、程序化审计结果和当前 StoryDirective，生成统一的 `UnifiedPostReviewDecision`。

## 为什么有这个任务
合并串行 LLM 调用，避免把同一份第一层结果交给多个阶段重复理解。同时评估 TODO 完成度和数据一致性。

## 输入

| 输入项 | 来源 | 说明 |
|--------|------|------|
| 当前主线目标 | StorySnapshot | 章节、主线任务 |
| 本轮 StoryDirective | Pre-react 生成 | storyGoal、todoList、constraints |
| 执行结果 | ReAct 循环输出 | 写操作摘要、LLM 输出前 800 字 |
| 程序化审计结果 | ContinuityAuditor | error/warning 级问题列表 |

## 输出要求
- 仅输出 `UnifiedPostReviewDecision` JSON 对象
- 输出必须是纯 JSON，无 markdown 代码块包裹
- 不生成最终玩家响应

## `UnifiedPostReviewDecision` 字段定义

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| taskReview.completion | string | 是 | 任务完成度：complete/partial/failed |
| taskReview.missingRequirements | string[] | 否 | 未满足的要求 |
| taskReview.qualityVerifications | string[] | 否 | 质量验证项 |
| storyReview.storyConsistency | string | 是 | 故事一致性：match/partial_match/mismatch |
| storyReview.progressDelta | string | 是 | 故事进展增量描述 |
| storyReview.reviewFocus | string[] | 否 | 审查焦点 |
| todoCompletion.completedItems | string[] | 是 | 已完成的 TODO 项 |
| todoCompletion.incompleteItems | string[] | 是 | 未完成的 TODO 项 |
| todoCompletion.overallCompletion | string | 是 | 整体完成度：complete/partial/failed |
| secondLayerDecision.shouldSchedule | boolean | 是 | 是否需要二次调度 |
| secondLayerDecision.reason | string | 否 | 调度原因 |
| secondLayerDecision.agents | AgentType[] | 否 | 需调度的 agent 列表 |
| secondLayerDecision.constraints | object | 否 | 二次调度约束 |
| secondLayerDecision.needsDynamicUI | boolean | 是 | 是否需要动态 UI |
| secondLayerDecision.dynamicUIScenario | string | 否 | 动态 UI 场景 |
| secondLayerDecision.dynamicUIReason | string | 否 | 动态 UI 原因 |
| recordUploadDecision.shouldUpload | boolean | 是 | 是否上传记录 |
| recordUploadDecision.reason | string | 否 | 上传原因 |
| recordUploadDecision.eventSummary | string | 否 | 事件摘要 |

## 动态 UI 判断规则

| 场景 | 条件 | 设置 |
|------|------|------|
| 战斗 | 执行结果包含战斗数据（combat Agent 输出战斗状态/伤害/回合信息） | needsDynamicUI=true, dynamicUIScenario="combat" |
| 交易 | 执行结果包含交易数据（inventory Agent 输出商品列表/购买/出售结果） | needsDynamicUI=true, dynamicUIScenario="shop_trade" |
| 已标记 | IntentAnalyzer 已标记 needsDynamicUI=true 且执行结果与预期一致 | 保持不变 |
| 纯对话 | 对话、信息查询等 | needsDynamicUI=false |

## TODO 完成度评估规则

| 完成度 | 条件 |
|--------|------|
| complete | 所有 TODO 项均已执行且结果符合预期 |
| partial | 部分 TODO 项已完成，未完成项可在后续轮次处理 |
| failed | 关键 TODO 项未完成，需要二次调度补齐 |

**决策点暂停**：当 GM 在决策节点暂停（等待玩家选择）而未完成所有 TODO 项时，完成度标记为 partial，missingRequirements 中注明"等待玩家决策"，不应标记为 failed 或触发二次调度。

## 意图匹配校验

检查 GM 的实际操作是否与玩家意图一致：

- intentHint 非 travel 且玩家未明确表达移动意图时，GM 是否执行了 move_to 移动玩家？如果是，storyConsistency 标记为 mismatch
- intentHint 为 travel 或玩家明确要求移动时，GM 是否未执行任何位置变更？如果是，storyConsistency 标记为 partial_match
- GM 的叙事内容是否与玩家的操作选择匹配？如果不匹配，storyConsistency 标记为 mismatch

## 叙事连贯性校验

检查 GM 的叙事是否体现了 todoList 的完整执行过程：

- 与玩家意图直接对应的 todoList 项是否被跳过？如果是，storyConsistency 标记为 mismatch
- GM 的叙事是否按执行顺序体现了所有已完成任务项的结果？如果叙事只呈现最终结果而省略了中间过程，storyConsistency 标记为 partial_match
- 叙事中的因果链是否完整？如果玩家从操作A跳到了结果C而缺少了中间步骤B的解释，storyConsistency 标记为 partial_match
- GM 是否替玩家做了决策？如果 todoList 中包含需要玩家选择的任务（如位置变更、NPC交互），GM 是否自动执行而非输出对话选项让玩家决定？如果是，storyConsistency 标记为 mismatch

## 关键约束
- 仅重大事件允许 `shouldUpload: true`
- `secondLayerDecision` 必须是可直接执行的结构化结果
- `agents` 仅允许合法 Layer 1 domain agent，禁止 `dialogue`
- 记录裁决服务 `StoryKernel -> StoryService` 主链
- 不把 EventAgent 当成记录上传最终裁决者
- `todoCompletion` 必须逐项评估，不笼统标记

## 输出示例

```json
{
  "taskReview": {
    "completion": "partial",
    "missingRequirements": ["补齐关键线索"],
    "qualityVerifications": []
  },
  "storyReview": {
    "storyConsistency": "partial_match",
    "progressDelta": "玩家已接近主线线索，但关键揭示不足",
    "reviewFocus": ["是否满足必须揭示的信息"]
  },
  "todoCompletion": {
    "completedItems": ["通过铁匠对话暗示村庄近期异常", "更新铁匠位置到铁匠铺"],
    "incompleteItems": ["揭示村庄入口处有异常痕迹的线索"],
    "overallCompletion": "partial"
  },
  "secondLayerDecision": {
    "shouldSchedule": true,
    "reason": "需要补齐关键线索",
    "agents": ["quest", "event"],
    "constraints": {
      "mustReveal": ["村庄存在异常征兆"],
      "mustHide": [],
      "avoid": ["直接发放终局任务"]
    },
    "needsDynamicUI": false,
    "dynamicUIScenario": null,
    "dynamicUIReason": null
  },
  "recordUploadDecision": {
    "shouldUpload": true,
    "reason": "本轮存在可归档重大事件",
    "eventSummary": "玩家首次确认村庄异变线索"
  }
}
```
