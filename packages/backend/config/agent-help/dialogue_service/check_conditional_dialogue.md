---
tool: dialogue_service
method: check_conditional_dialogue
description: "检查对话选项是否满足条件(关系/任务/物品要求)"
summary: "检查对话选项条件"
paramTypes:
  npcId: "string (required) - NPC ID"
  optionId: "string (required) - 对话选项ID"
returnType: "ConditionalCheckResult"
since: "1.0"
---

# dialogue_service.check_conditional_dialogue

## 功能
检查指定的对话选项是否满足触发条件。对话选项可能设有前置条件，如与NPC的关系值达到一定水平、完成特定任务、拥有特定物品等。此方法在不实际选择该选项的情况下，预先检查条件是否满足，返回满足/不满足的状态及具体原因。

## 参数详解

### npcId（必填）
- **类型**: string
- **说明**: 目标NPC的ID
- **要求**: 必须是已存在的有效NPC ID

### optionId（必填）
- **类型**: string
- **说明**: 要检查的对话选项ID
- **来源**: 从 `get_dialogue_context` 返回的 availableOptions 列表中获取
- **格式**: 通常为 `{npcId}:{key}` 格式（如 `npc-merchant:deep-talk`）

## 返回值

```typescript
{
  available: boolean;       // 选项是否可用（所有条件满足时为true）
  optionId: string;         // 被检查的选项ID
  blockedReason?: string;   // 不可用时的原因（如"Option not found"、"Relation insufficient: need 50, have 30"）
  requirements: {
    relationMet?: boolean;       // 关系值条件是否满足
    relationRequired?: number;   // 所需关系值
    relationCurrent?: number;    // 当前关系值
    questCompleted?: boolean;    // 任务完成条件是否满足
    questRequired?: string;      // 所需任务ID
    itemOwned?: boolean;         // 物品拥有条件是否满足
    itemRequired?: string;       // 所需物品ID
  }
}
```

**检查逻辑**：
1. 先获取对话上下文，在 availableOptions 中查找匹配 optionId 的选项
2. 如果选项不存在，返回 available=false，blockedReason="Option not found"
3. 检查关系值要求（requiresRelation）：当前关系值 ≥ 所需值时通过
4. 检查任务完成要求（requiresQuest）：在 quests 表中查找状态为 completed 的记录
5. 检查物品拥有要求（requiresItem）：在 inventory 表中查找对应物品

## 注意事项
- 此方法为只读操作，不会修改任何数据，也不会触发对话选项的效果
- 仅检查条件，不执行选择。如需执行选择，请使用 `process_dialogue_choice` 方法
- 建议在 `process_dialogue_choice` 之前先调用此方法，确认条件满足后再执行
- optionId 必须是当前可用的对话选项ID，不在 availableOptions 中的ID会返回 not found
- 关系值检查失败时会同时设置 available=false 和 blockedReason

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| npcId 或 optionId 缺失 | 未传入必填参数 | 必须同时传入 npcId 和 optionId |
| optionId 无效 | 对话选项ID不存在于可用选项中 | 从 get_dialogue_context 获取当前可用的选项ID |
| 条件检查失败 | 关系值/任务/物品等不满足 | 根据返回的 requirements 详情，先完成前置条件 |
