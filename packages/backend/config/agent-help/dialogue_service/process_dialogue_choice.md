---
tool: dialogue_service
method: process_dialogue_choice
description: "处理对话选择(验证条件→记录选择→触发效果→NPC回复→更新选项)"
summary: "处理对话选择"
paramTypes:
  npcId: "string (required) - NPC ID"
  choiceId: "string (required) - 选择的选项ID"
returnType: "DialogueChoiceResult"
since: "1.0"
---

# dialogue_service.process_dialogue_choice

## 功能
处理玩家在对话中做出的选择，执行完整的对话选择流程：验证前置条件 → 记录选择 → 触发效果（如任务触发、物品获取、话题切换、情绪变化等）→ 生成NPC回复 → 更新可用对话选项。这是对话交互的核心方法，每次玩家选择对话选项时都应调用此方法。

> **模块2 简化**：`DialogueEffect.type` 已删除 `'relation_change'`。NPC 关系数据由 GM 通过 `entity_graph_service.set_relationship` 维护，对话流程不再产生关系变更效果。

## 参数详解

### npcId（必填）
- **类型**: string
- **说明**: 对话目标NPC的ID
- **要求**: 必须是已存在的有效NPC ID

### choiceId（必填）
- **类型**: string
- **说明**: 玩家选择的对话选项ID
- **来源**: 从 `get_dialogue_context` 返回的 availableOptions 列表中获取
- **格式**: 通常为 `{npcId}:{key}` 格式（如 `npc-merchant:deep-talk`）

## 返回值

```typescript
{
  success: boolean;           // 选择是否成功处理
  choiceId: string;           // 选择的选项ID
  effectsApplied: DialogueEffect[];  // 已触发的效果列表
  npcResponse?: DialogueMessage;     // NPC的回复消息（仅选项配置了response时存在）
  newOptions?: DialogueOption[];     // 更新后的可用对话选项列表
  error?: string;             // 失败时的错误信息
}
```

其中 DialogueEffect 结构：

```typescript
{
  type: 'quest_trigger' | 'item_grant' | 'topic_switch' | 'emotion_change';
  target?: string;            // 效果目标（如物品ID）
  value?: number | string;    // 效果值（如情绪标签名）
  data?: Record<string, unknown>;  // 附加数据（如questType）
}
```

**效果类型说明**：
- `quest_trigger`：触发新任务，从 data.questType 读取任务类型
- `item_grant`：给予物品，从 target 读取物品模板ID
- `topic_switch`：切换话题（仅记录，无DB操作）
- `emotion_change`：改变情绪（仅记录，无DB操作）

**处理流程**：
1. 调用 `check_conditional_dialogue` 验证选项可用性
2. 条件不满足时返回 success=false，附带错误原因
3. 记录玩家选择消息（speaker="player"，content="Player selected choice: {choiceId}"）
4. 依次执行选项的 effects 列表中的每个效果
5. 如果选项配置了 response，生成NPC回复（responseTemplate 中的 {npcName} 会被替换）
6. 重新获取对话上下文，返回更新后的可用选项

## 注意事项
- 此方法为写操作，会修改对话状态、任务进度等数据
- 如果前置条件不满足，选择将不会被处理，返回 success=false 和错误原因
- 建议先使用 `check_conditional_dialogue` 确认条件满足后再调用此方法
- 每次选择可能触发连锁效果（如情绪变化影响后续对话选项），注意处理返回的 newOptions
- 选择一旦处理即不可撤销
- 即使 success=false，effectsApplied 也会返回空数组而非 undefined

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| npcId 或 choiceId 缺失 | 未传入必填参数 | 必须同时传入 npcId 和 choiceId |
| 条件不满足 | 前置条件未达成 | 先用 check_conditional_dialogue 检查，完成前置条件后再选择 |
| choiceId 无效 | 对话选项不存在于可用选项中 | 从 get_dialogue_context 获取当前可用的选项ID |
| 效果未触发 | 对话选项未配置 effects | 检查对话选项的配置是否包含效果定义 |
