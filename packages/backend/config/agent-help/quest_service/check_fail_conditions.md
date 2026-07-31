---
tool: quest_service
method: check_fail_conditions
description: "检查任务失败条件(超时/NPC死亡/物品丢失/敌人逃跑)"
summary: "检查任务失败条件"
paramTypes:
  questId: "string (required)"
  event: "string (required) - 事件类型(timeout/npc_death/item_lost/enemy_escapes)"
  eventData: "object (optional) - 事件数据(如{npcId:xxx}或{itemId:xxx,itemName:xxx}或{enemyId:xxx,enemyName:xxx})"
since: "1.0"
---

# quest_service.check_fail_conditions

## 功能
检查指定任务的失败条件是否满足。根据触发事件判断任务是否应该失败，如果条件满足会自动调用 `failQuest` 将任务标记为失败。

## 参数详解

### questId（必填）
- **类型**: string
- **说明**: 要检查的任务ID，可读ID格式（如 quest_暗影初现_1779730545205）
- **获取方式**: 从 `get_active_quests` 返回结果或预加载上下文中获取

### event（必填）
- **类型**: string
- **说明**: 触发事件类型，用于判断哪种失败条件需要检查
  - `"timeout"` — 超时事件，检查任务是否超过 timeLimit
  - `"npc_death"` — NPC死亡事件，检查任务发布者NPC是否死亡

### eventData（可选）
- **类型**: object
- **说明**: 事件相关数据
  - `npc_death` 事件需传 `{ npcId: "xxx" }`，用于匹配任务的 giverNpcId

## 返回值

```typescript
{
  questId: string;   // 任务ID
  failed: boolean;   // 是否触发了失败条件（true 表示任务已被标记为失败）
}
```

## 注意事项
- **这是写操作**: 如果失败条件满足，会自动调用 `failQuest` 将任务标记为 `failed`
- 只有状态为 `active` 的任务才会检查失败条件，其他状态返回 `false`
- 失败条件由 YAML 配置中的 `fail_conditions` 决定，如果配置为空则始终返回 `false`
- `timeout` 事件需要 YAML 配置中 `fail_conditions` 包含 `timeout` 且 `time_system` 已启用
- `npc_death` 事件需要 YAML 配置中 `fail_conditions` 包含 `npc_death`
- 如果检查过程中发生异常，方法返回 `false` 而非抛出错误

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 始终返回 false | YAML 配置中未启用对应失败条件 | 检查 fail_conditions 配置是否包含对应事件类型 |
| npc_death 检查无效 | 未传 eventData 或缺少 npcId | 传入 `{ npcId: "xxx" }` |
| 任务未被标记失败 | 任务不是 active 状态 | 只有进行中的任务才会检查失败条件 |
