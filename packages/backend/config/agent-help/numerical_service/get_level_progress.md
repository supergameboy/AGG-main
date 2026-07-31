---
tool: numerical_service
method: get_level_progress
description: "获取等级进度信息"
summary: "获取等级进度信息"
paramTypes:
  currentExp: "number (required) - 当前经验值"
  level: "number (required) - 当前等级"
returnType: "LevelProgress"
since: "1.0"
---

# numerical_service.get_level_progress

## 功能
根据当前经验值和等级，获取详细的等级进度信息。包括当前经验、下一级所需经验、进度百分比等。纯计算方法，不修改任何数据。

## 参数详解

### currentExp（必填）
- **类型**: number
- **说明**: 角色当前的经验总值

### level（必填）
- **类型**: number
- **说明**: 角色的当前等级

## 返回值
```typescript
interface LevelProgress {
  currentLevel: number;      // 当前等级
  currentExp: number;        // 当前经验值
  expForNextLevel: number;   // 下一级所需的总经验值
  expToNextLevel: number;    // 距离下一级还需要的经验值
  totalExpForLevel: number;  // 当前等级所需的总经验值
  progressPercent: number;   // 当前进度百分比(0~100)
  canLevelUp: boolean;       // 当前经验是否已满足升级条件
}
```

## 注意事项
- 此方法为只读操作，纯数值计算，不修改任何数据
- 进度百分比为0~100之间的浮点数，保留两位小数
- expToNextLevel 最低为0（不会出现负数）
- canLevelUp 为 true 时表示经验已满足升级条件
- 用于显示UI上的经验条或向玩家报告进度

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 数据异常 | level 为0或负数 | 等级必须 >= 1 |
| progressPercent 为负 | currentExp 小于 totalExpForLevel | 检查传入的 currentExp 是否正确 |
