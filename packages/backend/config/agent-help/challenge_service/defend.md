---
tool: challenge_service
method: defend
description: "防御姿态(下回合减伤50%)"
summary: "防御姿态"
returnType: "TurnResult"
since: "1.0"
---

# combat_service.defend

## 功能
进入防御姿态，将玩家的 isDefending 标记设为 true。在伤害计算时，防御姿态会使受到的伤害乘以 (1 - damage_reduction)。damage_reduction 由模板配置 defend.damage_reduction 决定，默认为 0.5（即减伤50%）。防御效果持续到本回合结束（回合结束时所有参与者的 isDefending 会被重置为 false）。

## 参数详解

无参数。系统自动为当前角色施加防御状态。

## 返回值
```typescript
interface TurnResult {
  actorName: string;       // 角色名称
  actionType: "defend";    // 固定为 "defend"
  effect: "defense_boosted";  // 固定效果标识
  logMessage: string;      // 如 "{角色名} takes a defensive stance. Next attack damage reduced by 50%."
}
```

## 注意事项
- 减伤比例由模板配置 defend.damage_reduction 决定，默认 0.5（50%），非固定值
- 防御效果仅持续到本回合结束，回合结束时所有参与者的 isDefending 自动重置为 false
- 减伤效果对所有来源的伤害生效（物理攻击/技能攻击）
- 防御不消耗 MP
- 防御姿态在伤害计算公式中的体现：`reducedDamage *= (1 - damage_reduction)`
- 无活跃战斗或战斗已结束时抛出错误

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| No active combat found | 当前无活跃战斗 | 先调用 start_combat 开始战斗 |
| Combat is not active | 战斗已结束 | 不应再调用 defend |
| Player not found in combat | 战斗参与者中无玩家 | 检查战斗状态是否异常 |
