---
tool: game_time_service
method: get_current_time
description: "获取当前游戏时间详情"
summary: "获取当前游戏时间"
since: "1.0"
---

# game_time_service.get_current_time

## 功能
获取当前游戏时间的完整详情，包括累计分钟数、天数、小时、分钟、时段和季节。用于了解游戏中的当前时间状态。

## 参数详解
无参数。

## 返回值

```typescript
interface GameTime {
  totalMinutes: number;      // 从游戏开始累计的总分钟数
  day: number;               // 游戏天数（从1开始）
  hour: number;              // 当前小时（0-23）
  minute: number;            // 当前分钟（0-59）
  periodOfDay: PeriodOfDay;  // 当前时段
  season: Season;            // 当前季节
}

type PeriodOfDay = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night' | 'midnight';
type Season = 'spring' | 'summer' | 'autumn' | 'winter';
```

## 注意事项
- 这是只读操作，不会修改游戏状态
- 返回的时间为游戏内时间，非现实时间
- 游戏时间通过 `advance_time` 方法推进
- 初始时间为第 1 天 08:00（通过 `initialize_time` 设置）
- 若存档尚未初始化游戏时间，会自动调用 `initialize_time` 初始化后返回

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回初始时间 | 存档尚未初始化游戏时间 | 系统会自动初始化，无需手动处理 |
