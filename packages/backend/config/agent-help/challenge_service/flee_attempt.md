---
tool: challenge_service
method: flee_attempt
description: "逃跑尝试(概率计算)"
summary: "逃跑尝试"
since: "1.0"
---

# combat_service.flee_attempt

## 功能
尝试从当前战斗中逃跑。逃跑成功率由模板配置决定，基础概率为 base_chance（默认0.3），每有一个已死亡的敌人额外增加 per_dead_enemy_bonus（默认0.1）。逃跑成功后战斗自动结束。

## 参数详解

无参数。系统自动读取当前战斗状态计算逃跑概率。

## 返回值
```typescript
{
  success: boolean;   // 是否成功逃跑
  chance: number;     // 逃跑概率（0~1之间，保留2位小数）
  message: string;    // 结果描述
}
// 成功: { success: true, chance: 0.4, message: "Successfully fled from combat!" }
// 失败: { success: false, chance: 0.3, message: "Failed to flee!" }
```

## 注意事项
- 逃跑概率公式：`fleeChance = base_chance + deadEnemyCount × per_dead_enemy_bonus`
  - base_chance 默认 0.3（30%）
  - per_dead_enemy_bonus 默认 0.1（每死一个敌人+10%）
- 逃跑概率不受角色属性影响，仅与已击杀敌人数相关
- 逃跑成功后战斗状态设为 inactive，并记录逃跑日志
- 逃跑失败后战斗继续，不额外消耗回合（日志记录但敌人不会因此额外攻击）
- 无活跃战斗或战斗已结束时抛出错误

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| No active combat found | 当前无活跃战斗 | 确认战斗已开始 |
| Combat is not active | 战斗已结束 | 不应再尝试逃跑 |
