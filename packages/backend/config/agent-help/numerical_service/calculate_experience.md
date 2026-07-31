---
tool: numerical_service
method: calculate_experience
description: "计算经验奖励"
summary: "计算经验奖励"
paramTypes:
  actionType: "string (required) - 行动类型: combat/quest/exploration/crafting/social"
  difficulty: "number (required) - 难度(1-10)"
  level: "number (required) - 角色等级"
  bonusMultiplier: "number (optional) - 额外倍率"
returnType: "ExperienceResult"
since: "1.0"
---

# numerical_service.calculate_experience

## 功能
根据行动类型、难度、角色等级和额外倍率计算经验奖励值。纯计算方法，不修改实际经验值。

## 参数详解

### actionType（必填）
- **类型**: string
- **说明**: 行动类型，不同类型有不同的基础经验系数
- **可选值**:
  - `combat` — 战斗相关行动
  - `quest` — 任务完成
  - `exploration` — 探索发现
  - `crafting` — 制作合成
  - `social` — 社交互动

### difficulty（必填）
- **类型**: number
- **说明**: 行动难度，范围1-10。难度倍率 = 1 + (difficulty - 1) × 0.5

### level（必填）
- **类型**: number
- **说明**: 角色的当前等级。等级惩罚系数 = max(0.1, 1 - (level - 1) × 0.02)

### bonusMultiplier（可选）
- **类型**: number
- **说明**: 额外经验倍率，最终经验值乘以此倍率

## 返回值
```typescript
interface ExperienceResult {
  experience: number;  // 最终经验值（含随机波动）
  breakdown: {
    baseValue: number;           // 基础经验值（由actionType决定）
    difficultyMultiplier: number; // 难度倍率
    levelPenalty: number;        // 等级惩罚系数
    beforeVariance: number;      // 波动前的经验值
    variance: number;            // 随机波动系数(0.9~1.1)
  };
}
```

## 注意事项
- 此方法为只读操作，纯数值计算，不修改实际经验值
- 如需实际增加经验并检测升级，请使用 `add_experience` 方法
- 经验值有 ±10% 的随机波动（variance 范围 0.9~1.1）
- 高等级角色获得的经验会降低（等级惩罚系数最低0.1）
- difficulty 应与实际难度匹配，避免过度膨胀经验值

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 经验值为0 | actionType 不在枚举中 | 使用 combat/quest/exploration/crafting/social 之一 |
| 高等级经验极低 | 等级惩罚系数过大 | 这是正常机制，高等级需要更多经验升级 |
