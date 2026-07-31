---
tool: challenge_service
method: queue_action
description: "动态战斗专用:玩家排队动作(存入actionQueue,后续executeStep执行)"
summary: "动态战斗排队动作"
paramTypes:
  action: "object{type:string,actorId:string,targetIds:array,skillId:string,itemId:string} (required) - 排队的动作"
since: "1.0"
---

# challenge_service.queue_action

## 功能
动态战斗专用方法，将玩家排队的动作存入 `ChallengeState.metadata.actionQueue`。后续调用 `execute_turn` 时，策略层会按队列顺序执行所有排队动作。

适用于 `dynamic_combat` 模式下，双方同时排队、统一结算的玩法（不同于回合制严格按速度顺序）。

## 参数详解

### action (required)
排队的动作对象，包含以下字段：

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| type | 是 | string | 动作类型，枚举值：`attack` / `skill` / `defend` / `item` / `flee` |
| actorId | 是 | string | 执行者参与者 ID |
| targetIds | 否 | string[] | 目标参与者 ID 或名称列表（**13.2 name/id 兼容**，延迟到 executeStep 时由策略层解析） |
| skillId | 否 | string | 技能 ID 或名称（**13.2 name/id 兼容**，仅 type=skill 时使用） |
| itemId | 否 | string | 物品 ID 或名称（**13.2 name/id 兼容**，仅 type=item 时使用） |

合法示例：
```json
{
  "type": "attack",
  "actorId": "char_xxx",
  "targetIds": ["goblin_1", "哥布林弓手"]
}
```

```json
{
  "type": "skill",
  "actorId": "char_xxx",
  "skillId": "火球术",
  "targetIds": ["goblin_1", "goblin_2"]
}
```

## 返回值
```typescript
{
  success: boolean;       // 操作是否成功
  data?: {                // 成功时返回
    queuePosition: number;  // 队列位置（1-based，表示该动作排在队列第几位）
    message: string;        // 确认信息，如"动作已排队，当前位置 2，后续 execute_turn 将按队列执行"
  };
  error?: string;         // 失败时返回错误信息
}
```

## 注意事项
- **仅适用于 dynamic_combat 模式**。若当前不是动态战斗，调用此方法会失败
- 排队动作存入 `ChallengeState.metadata.actionQueue`，并经 StagingPool 代理持久化（13.1 合规）
- name/id 解析**延迟到 executeStep 时**由策略层处理（策略层持有 resolvers Map），queue_action 仅原样存储
- 同一存档的 actionQueue 跨请求持久化，玩家可在多个 WS 消息中累积排队动作
- 队列位置 1-based：第 1 个排队动作 queuePosition=1，第 2 个 queuePosition=2，依此类推

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 无进行中的战斗，请先调用 start_combat | 当前没有活跃战斗 | 先调用 `start_combat` 启动战斗 |
| 战斗已结束 | 战斗状态 active=false | 战斗已结束，无法继续排队 |
| 无法读取挑战状态 | ChallengeState 读取失败（数据库异常或状态损坏） | 调用 `get_combat_state` 排查战斗状态 |
