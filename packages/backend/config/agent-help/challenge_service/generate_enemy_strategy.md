---
tool: challenge_service
method: generate_enemy_strategy
description: "生成敌人策略(战斗开始时由combat_director调用,一次性写入,禁止覆盖)"
summary: "生成敌人策略"
paramTypes:
  strategy: "object{aggression:string,targetPreference:string,skillPriority:array,fleeThreshold:number,preferItems:boolean,description:string} (required) - 敌人策略对象"
since: "1.0"
---

# challenge_service.generate_enemy_strategy

## 功能
生成敌人策略并写入 `ChallengeState.enemyStrategy`。战斗开始时由 `combat_director` 调用，一次性写入，后续 `processEnemyTurn` 将按此策略决定敌人行动。

此方法**禁止覆盖**：若 ChallengeState 已存在 enemyStrategy，再次调用会触发策略层校验失败（设计决策：保证策略一致性，避免战斗中途变策略导致行为不一致）。

## 参数详解

### strategy (required)
敌人策略对象，包含以下字段：

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| aggression | 是 | string | 进攻倾向，枚举值：`aggressive` / `defensive` / `tactical` |
| targetPreference | 是 | string | 目标选择策略，枚举值：`nearest` / `weakest` / `strongest` / `healer` |
| skillPriority | 否 | string[] | 技能优先级（技能 ID 或名称，**13.2 name/id 兼容**） |
| fleeThreshold | 否 | number | 逃跑 HP 阈值（百分比，0 = 死战不逃，例如 30 表示 HP 低于 30% 时尝试逃跑） |
| preferItems | 否 | boolean | 是否优先使用物品 |
| description | 是 | string | 战术说明（人类可读，便于 GM 理解策略意图） |

合法示例：
```json
{
  "aggression": "aggressive",
  "targetPreference": "weakest",
  "skillPriority": ["重击", "旋风斩"],
  "fleeThreshold": 20,
  "preferItems": false,
  "description": "优先集火最弱目标，HP 低于 20% 时尝试逃跑"
}
```

## 返回值
```typescript
{
  success: boolean;       // 操作是否成功
  data?: {                // 成功时返回
    message: string;              // 确认信息，如"敌人策略已写入，后续 processEnemyTurn 将使用此策略"
    strategyDescription: string; // 策略描述（与入参 description 一致）
  };
  error?: string;         // 失败时返回错误信息
}
```

## 注意事项
- **一次性写入**：若 ChallengeState 已存在 enemyStrategy，再次调用会被策略层拒绝（保证策略一致性）
- 调用时机：战斗开始时由 `combat_director` 调用，写入后由 `processEnemyTurn` 在每回合读取
- skillPriority 字段支持 13.2 name/id 兼容：可传入技能名称或技能 ID
- fleeThreshold=0 表示死战不逃（默认行为）；非零值表示 HP 低于该百分比时尝试逃跑
- 此方法会经 StagingPool 代理写入 DB（13.1 合规），更新 ChallengeState.enemyStrategy 字段

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| EnemyStrategy already exists | ChallengeState 已存在 enemyStrategy，禁止覆盖 | 策略只能写入一次，若需变更策略应先 `end_combat` 再 `start_combat` |
| Invalid aggression value | aggression 不是 `aggressive` / `defensive` / `tactical` 之一 | 检查枚举值拼写 |
| Invalid targetPreference value | targetPreference 不是合法枚举值 | 检查枚举值拼写 |
| Combat not found | saveId 对应的战斗不存在或已结束 | 确认战斗在进行中 |
