---
tool: challenge_service
method: end_combat
description: "结束战斗(更新角色HP/MP、记录日志)"
summary: "结束战斗"
paramTypes:
  result: "object (required) - 战斗结果(victory/fled/defeat)"
since: "1.0"
---

# combat_service.end_combat

## 功能
结束当前战斗，更新角色HP/MP到数据库，记录战斗日志，处理战利品结算，并将战斗记录归档到 combat_history 表。这是战斗流程的出口方法，必须在战斗结束后调用以完成状态同步。

## 参数详解

### result (required)
战斗结果对象，描述战斗的最终结局。支持两种格式：

**标准格式**（推荐）：
```json
{
  "victory": true,
  "fled": false,
  "defeat": false,
  "experience": 100,
  "currency": {"gold": 50},
  "drops": [],
  "turnsElapsed": 5,
  "participantResults": []
}
```

**简化格式**（LLM 友好）：
```json
{"result": "victory"}
{"result": "fled"}
{"result": "defeat"}
```

简化格式会自动转换为标准格式，experience/currency/drops 等字段默认为0/空。

**result 对象字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| victory | boolean | 是否胜利 |
| fled | boolean | 是否逃跑成功 |
| defeat | boolean | 是否失败 |
| permadeath | boolean? | 是否触发永久死亡（仅 defeat 时由模板 special_rules.permadeath 决定） |
| experience | number | 获得经验值 |
| currency | Record<string, number> | 获得货币（如 {"gold": 50}） |
| drops | Array<{item: string, quantity: number}> | 掉落物品列表 |
| turnsElapsed | number | 战斗持续回合数 |
| participantResults | ParticipantResult[] | 参与者结算数据 |

## 返回值
```typescript
{
  message: "Combat ended successfully";
}
```

## 注意事项
- 调用后角色 HP/MP 会同步到 characters 表，反映战斗中的变化
- 胜利时：经验值累加到 characters.experience，货币合并到 characters.currency
- 失败且模板配置 permadeath 为 true 时：角色状态标记 permadeath: true
- 战斗结束后自动清除内存缓存，并将战斗记录从 combat_states 移至 combat_history
- 无活跃战斗时抛出错误

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| No active combat found | 当前无活跃战斗 | 确认战斗已开始且未结束 |
| result 格式无效 | 传入空对象或非对象 | 使用标准格式或简化格式 {result: "victory"} |
