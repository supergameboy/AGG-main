---
tool: game_time_service
method: is_shop_open
description: "检查商店是否营业"
summary: "检查商店是否营业"
since: "1.0"
---

# game_time_service.is_shop_open

## 功能
检查商店当前是否营业。根据当前游戏小时判断是否在营业时间内。

## 参数详解

### shopType（可选）
- **类型**: string
- **说明**: 商店类型参数（当前实现未使用此参数，预留未来按商店类型区分营业时间）
- **不传**: 检查默认营业状态

## 返回值

```typescript
{
  isOpen: boolean;  // true=营业中，false=已关门
}
```

**营业时间规则**: 08:00 - 20:00（即 hour >= 8 且 hour < 20 时返回 true）

## 注意事项
- 这是只读操作，不会修改游戏状态
- 营业时间硬编码为 08:00-20:00，所有商店类型统一规则
- shopType 参数当前未使用，传入任何值不影响结果
- 可配合 `get_period_of_day` 了解当前时间段

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回 false | 当前游戏时间不在 08:00-20:00 营业时段 | 通过 advance_time 推进时间到营业时段 |
