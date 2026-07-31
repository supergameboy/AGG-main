---
tool: challenge_service
method: get_status_effects
description: "获取当前所有参与者的状态效果"
summary: "获取参与者状态效果"
since: "1.0"
---

# combat_service.get_status_effects

## 功能
获取当前战斗中所有拥有活跃状态效果的参与者及其状态效果列表。只返回拥有至少一个活跃状态效果的参与者。用于了解战场上的增益/减益情况，辅助决策。

## 参数详解

无参数。系统自动返回所有拥有活跃状态效果的参与者。

## 返回值
```typescript
{
  effects: Array<{
    participantName: string;   // 参与者名称
    effects: StatusEffect[];   // 该参与者的活跃状态效果列表
  }>;
  hint?: string;  // 可选提示（无战斗或无状态效果时）
}

interface StatusEffect {
  name: string;              // 效果名称
  type: "buff" | "debuff";  // 效果类型
  remainingTurns: number;    // 剩余回合数
  power: number;             // 效果数值（正数）
  source: string;            // 效果来源
}
```

无战斗或无状态效果时：
```typescript
{
  effects: [];
  hint: "当前无战斗状态效果";
}
```

## 注意事项
- 此方法为只读操作，不修改任何状态
- 只返回拥有至少一个活跃状态效果的参与者，无效果的参与者不包含在结果中
- 状态效果每回合自动 tick（remainingTurns 递减，到期后移除）
- buff 类型中名称含 "regen"/"heal" 的效果每回合恢复 HP，含 "mana"/"restore" 的效果每回合恢复 MP
- debuff 类型中名称含 "poison"/"burn" 的效果每回合造成伤害
- 防御姿态（isDefending）不是 StatusEffect，不在此方法返回中

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | 战斗尚未开始或无活跃状态效果 | 先确认战斗已开始，状态效果由技能等途径施加 |
