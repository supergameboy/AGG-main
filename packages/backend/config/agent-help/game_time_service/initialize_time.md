---
tool: game_time_service
method: initialize_time
description: "初始化存档的游戏时间(第1天08:00)"
summary: "初始化游戏时间"
since: "1.0"
---

# game_time_service.initialize_time

## 功能
初始化当前存档的游戏时间，设置为第 1 天 08:00（由配置 startHour=8, startMinute=0 决定）。通常在新游戏开始时调用，确保游戏时间系统正常工作。

## 参数详解
无参数。

## 返回值

```typescript
interface GameTime {
  totalMinutes: number;      // 初始累计分钟数（默认480，即8×60）
  day: number;               // 游戏天数（初始为1）
  hour: number;              // 当前小时（初始为8）
  minute: number;            // 当前分钟（初始为0）
  periodOfDay: PeriodOfDay;  // 初始时段（morning，因为8点属于上午）
  season: Season;            // 初始季节（spring）
}

type PeriodOfDay = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night' | 'midnight';
type Season = 'spring' | 'summer' | 'autumn' | 'winter';
```

## 注意事项
- 这是写操作，会修改游戏状态（持久化到数据库）
- 使用 upsert 语义（ON CONFLICT MERGE），若存档已有游戏时间记录，会覆盖重置
- 初始时间由配置决定：startHour=8, startMinute=0, minutesPerDay=1440
- 初始季节固定为 spring（春天）
- 后续时间推进通过 `advance_time` 方法实现

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 时间被重置 | 对已有时间的存档调用了 initialize_time | 仅在新存档创建时调用此方法 |
