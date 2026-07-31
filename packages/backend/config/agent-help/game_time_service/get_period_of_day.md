---
tool: game_time_service
method: get_period_of_day
description: "获取当前时段(dawn/morning/noon/afternoon/evening/night/midnight)"
summary: "获取当前时间段"
since: "1.0"
---

# game_time_service.get_period_of_day

## 功能
获取当前游戏时间所属的时间段。时间段由当前小时自动计算，影响 NPC 行为、商店营业、怪物出没等游戏机制。

## 参数详解
无参数。

## 返回值

```typescript
{
  period: PeriodOfDay;  // 当前时间段标识
}

type PeriodOfDay = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night' | 'midnight';
```

**时段与小时对应关系**:

| 时段 | 英文标识 | 对应小时范围 |
|------|---------|-------------|
| 黎明 | `dawn` | 05:00 - 06:59 |
| 上午 | `morning` | 07:00 - 10:59 |
| 中午 | `noon` | 11:00 - 13:59 |
| 下午 | `afternoon` | 14:00 - 16:59 |
| 傍晚 | `evening` | 17:00 - 19:59 |
| 夜晚 | `night` | 20:00 - 22:59 |
| 午夜 | `midnight` | 23:00 - 04:59 |

## 注意事项
- 这是只读操作，不会修改游戏状态
- 时间段由当前游戏时间自动计算，无需手动设置
- 不同时间段可能影响：
  - NPC 是否在岗
  - 商店是否营业（可配合 `is_shop_open` 检查，营业时间 08:00-20:00）
  - 特定事件是否触发
  - 环境描述和氛围

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 时间段异常 | 游戏时间未初始化 | 先调用 initialize_time 初始化 |
